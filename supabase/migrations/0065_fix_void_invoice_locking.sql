-- Migration: 0065_fix_void_invoice_locking.sql
-- Adds deterministic ascending-order variant pre-locking and customer row locking to void_invoice,
-- eliminating concurrency deadlocks with checkout and invoice edit transactions.

CREATE OR REPLACE FUNCTION void_invoice(
    p_invoice_id UUID,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_item RECORD;
    v_variant RECORD;
    v_restored_pieces INTEGER;
    v_returned_pieces INTEGER;
    v_restored_sets INTEGER;
    v_returned_sets INTEGER;
    v_pieces_per_set INTEGER;
    v_net_store_credit_paid DECIMAL(10,2) := 0;
    v_restored_balance DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice ID is required.'; END IF;

    -- 1. Lock invoice row
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Invoice is already voided.'; END IF;

    -- 2. Deterministic pre-locking of variants in ascending ID order (Prevents Deadlock with checkout / edit)
    PERFORM 1 FROM variants v
    WHERE v.id IN (SELECT variant_id FROM invoice_items WHERE invoice_id = p_invoice_id)
    ORDER BY v.id FOR UPDATE OF v;

    -- 3. Pre-lock customer if linked
    IF v_invoice.customer_id IS NOT NULL THEN
        PERFORM 1 FROM customers WHERE id = v_invoice.customer_id FOR UPDATE;
    END IF;

    -- Mark invoice voided
    UPDATE invoices 
    SET is_voided = TRUE, updated_at = NOW() 
    WHERE id = p_invoice_id;

    -- Restore Stock with dual-inventory ratio guard
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id FOR UPDATE LOOP
        SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(sets_quantity), 0)
        INTO v_returned_pieces, v_returned_sets
        FROM returns WHERE invoice_item_id = v_item.id;

        SELECT v.*, p.pieces_per_set INTO v_variant
        FROM variants v JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;

        v_pieces_per_set := COALESCE(v_variant.pieces_per_set, 1);
        v_restored_pieces := GREATEST(0, v_item.quantity - v_returned_pieces);

        v_restored_sets := LEAST(
            COALESCE(v_item.sets_quantity, 0),
            FLOOR(v_restored_pieces / GREATEST(COALESCE(v_pieces_per_set, 1), 1))
        );

        IF v_restored_pieces > 0 THEN
            UPDATE variants 
            SET stock_quantity = stock_quantity + v_restored_pieces,
                stock_sets = stock_sets + v_restored_sets,
                updated_at = NOW()
            WHERE id = v_item.variant_id;

            INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
            VALUES (
                v_item.id, v_item.variant_id, 'VOID_RESTOCK'::stock_movement_type, v_restored_pieces,
                'Invoice Voided: ' || v_invoice.invoice_number || COALESCE(' (' || p_reason || ')', '')
            );
        END IF;
    END LOOP;

    -- Restore net Store Credit to customer wallet
    SELECT COALESCE(SUM(amount), 0) INTO v_net_store_credit_paid
    FROM payments WHERE invoice_id = p_invoice_id AND method = 'STORE_CREDIT';

    IF v_net_store_credit_paid > 0 AND v_invoice.customer_id IS NOT NULL THEN
        UPDATE customers 
        SET credit_balance = credit_balance + v_net_store_credit_paid,
            updated_at = NOW()
        WHERE id = v_invoice.customer_id
        RETURNING credit_balance INTO v_restored_balance;

        INSERT INTO customer_credit_ledger (
            customer_id, type, amount, balance_after, reference_invoice_id, notes
        ) VALUES (
            v_invoice.customer_id,
            'MANUAL_ADJUST'::credit_movement_type,
            v_net_store_credit_paid,
            v_restored_balance,
            p_invoice_id,
            'Reversed store credit from voided Invoice ' || v_invoice.invoice_number
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'invoice_number', v_invoice.invoice_number,
        'is_voided', true
    );
END;
$$;

GRANT EXECUTE ON FUNCTION void_invoice(UUID, TEXT) TO authenticated, service_role;
