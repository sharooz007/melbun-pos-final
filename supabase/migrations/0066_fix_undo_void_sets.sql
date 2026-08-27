-- Migration: 0066_fix_undo_void_sets.sql
-- Deducts exact snapshotted sets recorded in invoice_items upon undo_void_invoice,
-- strictly adhering to Store Policy 9 (INV-07) and preventing phantom sets if catalog pack size was modified.

CREATE OR REPLACE FUNCTION undo_void_invoice(
    p_invoice_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_item RECORD;
    v_var_req RECORD;
    v_returned_pieces INTEGER;
    v_returned_sets INTEGER;
    v_net_pieces_to_deduct INTEGER;
    v_sets_to_deduct INTEGER;
    v_store_credit_amount DECIMAL(10, 2) := 0.00;
    v_customer_credit DECIMAL(10, 2) := 0.00;
    v_new_customer_credit DECIMAL(10, 2) := 0.00;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice ID is required'; END IF;

    -- 1. Lock invoice
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF NOT v_invoice.is_voided THEN RAISE EXCEPTION 'Invoice is not voided'; END IF;
    IF v_invoice.is_hidden THEN RAISE EXCEPTION 'Cannot undo void on a permanently deleted invoice'; END IF;

    -- 2. Ordered locking of variants to prevent deadlocks
    PERFORM 1 FROM variants v
    JOIN invoice_items ii ON ii.variant_id = v.id
    WHERE ii.invoice_id = p_invoice_id
    ORDER BY v.id
    FOR UPDATE OF v;

    -- 3. Pre-validate stock availability by aggregating total net required pieces per variant
    FOR v_var_req IN
        SELECT 
            ii.variant_id,
            v.name AS variant_name,
            v.stock_quantity,
            SUM(GREATEST(0, ii.quantity - COALESCE(r.ret_qty, 0))) AS total_req_pieces
        FROM invoice_items ii
        JOIN variants v ON ii.variant_id = v.id
        LEFT JOIN (
            SELECT invoice_item_id, SUM(quantity) AS ret_qty
            FROM returns
            GROUP BY invoice_item_id
        ) r ON r.invoice_item_id = ii.id
        WHERE ii.invoice_id = p_invoice_id
        GROUP BY ii.variant_id, v.name, v.stock_quantity
    LOOP
        IF v_var_req.total_req_pieces > 0 AND v_var_req.stock_quantity < v_var_req.total_req_pieces THEN
            RAISE EXCEPTION 'Insufficient stock to undo void for variant "%" (available: %, required: %)',
                v_var_req.variant_name, v_var_req.stock_quantity, v_var_req.total_req_pieces;
        END IF;
    END LOOP;

    -- 4. Re-apply Store Credit Wallet deductions if store credit was used
    IF v_invoice.customer_id IS NOT NULL THEN
        SELECT COALESCE(SUM(amount), 0.00) INTO v_store_credit_amount
        FROM payments
        WHERE invoice_id = p_invoice_id AND method = 'STORE_CREDIT';

        IF v_store_credit_amount > 0 THEN
            SELECT credit_balance INTO v_customer_credit
            FROM customers WHERE id = v_invoice.customer_id FOR UPDATE;

            IF v_customer_credit < v_store_credit_amount THEN
                RAISE EXCEPTION 'Insufficient store credit in customer wallet to re-apply store credit payment of ₹% (current wallet: ₹%)',
                    v_store_credit_amount, v_customer_credit;
            END IF;

            UPDATE customers
            SET credit_balance = credit_balance - v_store_credit_amount,
                updated_at = NOW()
            WHERE id = v_invoice.customer_id
            RETURNING credit_balance INTO v_new_customer_credit;

            INSERT INTO customer_credit_ledger (
                customer_id,
                type,
                amount,
                balance_after,
                reference_invoice_id,
                notes
            ) VALUES (
                v_invoice.customer_id,
                'PAYMENT_APPLIED'::credit_movement_type,
                -v_store_credit_amount,
                v_new_customer_credit,
                p_invoice_id,
                'Undo Void: Re-applied store credit to invoice ' || v_invoice.invoice_number
            );
        END IF;
    END IF;

    -- 5. Re-deduct exact snapshotted sets & pieces (Policy 9)
    FOR v_item IN 
        SELECT ii.*
        FROM invoice_items ii
        WHERE ii.invoice_id = p_invoice_id
    LOOP
        SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(sets_quantity), 0)
        INTO v_returned_pieces, v_returned_sets
        FROM returns WHERE invoice_item_id = v_item.id;

        v_net_pieces_to_deduct := GREATEST(0, v_item.quantity - v_returned_pieces);
        v_sets_to_deduct := GREATEST(0, COALESCE(v_item.sets_quantity, 0) - v_returned_sets);

        IF v_net_pieces_to_deduct > 0 THEN
            UPDATE variants
            SET stock_quantity = stock_quantity - v_net_pieces_to_deduct,
                stock_sets = GREATEST(0, stock_sets - v_sets_to_deduct),
                updated_at = NOW()
            WHERE id = v_item.variant_id;

            INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
            VALUES (
                v_item.id,
                v_item.variant_id,
                'SALE'::stock_movement_type,
                -v_net_pieces_to_deduct,
                'Undo Void: ' || v_invoice.invoice_number
            );
        END IF;
    END LOOP;

    -- 6. Reactivate invoice
    UPDATE invoices
    SET is_voided = FALSE,
        updated_at = NOW()
    WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'invoice_number', v_invoice.invoice_number,
        'is_voided', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION undo_void_invoice(UUID) TO authenticated, service_role;
