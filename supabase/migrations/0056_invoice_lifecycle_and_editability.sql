-- Migration 0056: Invoice Lifecycle Engine (Undo Void, Permanent Deletion, Retroactive Editing)
-- Fully compliant with pos-v2, postgres-best-practices, and audit-v2

-- =========================================================================
-- 1. undo_void_invoice RPC
-- =========================================================================
CREATE OR REPLACE FUNCTION undo_void_invoice(
    p_invoice_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_item RECORD;
    v_returned_pieces INTEGER;
    v_net_pieces_to_deduct INTEGER;
    v_sets_to_deduct INTEGER;
    v_pieces_per_set INTEGER;
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

    -- Pre-validate stock availability for all items before any modifications
    FOR v_item IN 
        SELECT ii.*, p.pieces_per_set, v.name AS variant_name, v.stock_quantity, v.stock_sets
        FROM invoice_items ii
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        WHERE ii.invoice_id = p_invoice_id
    LOOP
        SELECT COALESCE(SUM(quantity), 0) INTO v_returned_pieces
        FROM returns WHERE invoice_item_id = v_item.id;

        v_net_pieces_to_deduct := GREATEST(0, v_item.quantity - v_returned_pieces);

        IF v_net_pieces_to_deduct > 0 AND v_item.stock_quantity < v_net_pieces_to_deduct THEN
            RAISE EXCEPTION 'Insufficient stock to undo void for variant "%" (available: %, required: %)',
                v_item.variant_name, v_item.stock_quantity, v_net_pieces_to_deduct;
        END IF;
    END LOOP;

    -- 3. Re-apply Store Credit Wallet deductions if store credit was used
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

    -- 4. Re-deduct stock and log stock_movements
    FOR v_item IN 
        SELECT ii.*, p.pieces_per_set
        FROM invoice_items ii
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        WHERE ii.invoice_id = p_invoice_id
    LOOP
        SELECT COALESCE(SUM(quantity), 0) INTO v_returned_pieces
        FROM returns WHERE invoice_item_id = v_item.id;

        v_net_pieces_to_deduct := GREATEST(0, v_item.quantity - v_returned_pieces);
        v_pieces_per_set := GREATEST(COALESCE(v_item.pieces_per_set, 1), 1);
        v_sets_to_deduct := LEAST(COALESCE(v_item.sets_quantity, 0), FLOOR(v_net_pieces_to_deduct / v_pieces_per_set));

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

    -- 5. Reactivate invoice
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

-- =========================================================================
-- 2. permanently_delete_invoice RPC
-- =========================================================================
CREATE OR REPLACE FUNCTION permanently_delete_invoice(
    p_invoice_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice ID is required'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

    IF NOT v_invoice.is_voided THEN
        RAISE EXCEPTION 'Active invoices must be voided before they can be permanently deleted';
    END IF;

    IF v_invoice.is_hidden THEN
        RAISE EXCEPTION 'Invoice is already permanently deleted';
    END IF;

    UPDATE invoices
    SET is_hidden = TRUE,
        updated_at = NOW()
    WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'is_hidden', true
    );
END;
$$;

-- =========================================================================
-- 3. update_invoice_details RPC
-- =========================================================================
CREATE OR REPLACE FUNCTION update_invoice_details(
    p_invoice_id UUID,
    p_created_at TIMESTAMPTZ DEFAULT NULL,
    p_customer_id UUID DEFAULT NULL,
    p_update_customer BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_new_created_at TIMESTAMPTZ;
    v_target_customer_id UUID;
    v_has_store_credit BOOLEAN := FALSE;
    v_total_paid DECIMAL(10,2) := 0.00;
    v_min_return_date TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice ID is required'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

    IF v_invoice.is_hidden THEN 
        RAISE EXCEPTION 'Cannot edit a permanently deleted invoice'; 
    END IF;

    -- Resolve Timestamp
    v_new_created_at := COALESCE(p_created_at, v_invoice.created_at);
    IF v_new_created_at > (NOW() + INTERVAL '1 day') THEN
        RAISE EXCEPTION 'Invoice date cannot be in the future';
    END IF;

    -- Ensure backdated invoice is not newer than its existing returns
    SELECT MIN(created_at) INTO v_min_return_date FROM returns WHERE invoice_id = p_invoice_id;
    IF v_min_return_date IS NOT NULL AND v_new_created_at > v_min_return_date THEN
        RAISE EXCEPTION 'Invoice date cannot be after existing return date (%)', v_min_return_date;
    END IF;

    -- Resolve Customer Update
    IF p_update_customer THEN
        v_target_customer_id := p_customer_id;

        -- If customer is changing, enforce integrity rules
        IF (v_invoice.customer_id IS DISTINCT FROM v_target_customer_id) THEN
            -- Block customer changes if store credit was used
            SELECT EXISTS (
                SELECT 1 FROM payments WHERE invoice_id = p_invoice_id AND method = 'STORE_CREDIT'
            ) INTO v_has_store_credit;

            IF v_has_store_credit THEN
                RAISE EXCEPTION 'Cannot change customer on an invoice that used Store Credit payment';
            END IF;

            -- Check if invoice has unpaid dues; anonymous walk-ins cannot hold debt tabs
            SELECT COALESCE(SUM(amount), 0.00) INTO v_total_paid FROM payments WHERE invoice_id = p_invoice_id;
            IF v_target_customer_id IS NULL AND v_total_paid < v_invoice.final_total THEN
                RAISE EXCEPTION 'Customer is required for invoices with unpaid credit balances';
            END IF;

            -- Verify active status of target customer if not null
            IF v_target_customer_id IS NOT NULL THEN
                IF NOT EXISTS (SELECT 1 FROM customers WHERE id = v_target_customer_id AND is_active = TRUE) THEN
                    RAISE EXCEPTION 'Selected customer does not exist or is inactive';
                END IF;
            END IF;

            -- Synchronize customer on associated payment records
            UPDATE payments
            SET customer_id = v_target_customer_id
            WHERE invoice_id = p_invoice_id;

            -- Synchronize customer on associated returns
            UPDATE returns
            SET customer_id = v_target_customer_id
            WHERE invoice_id = p_invoice_id;
        END IF;
    ELSE
        v_target_customer_id := v_invoice.customer_id;
    END IF;

    -- Update invoice header
    UPDATE invoices
    SET created_at = v_new_created_at,
        customer_id = v_target_customer_id,
        updated_at = NOW()
    WHERE id = p_invoice_id;

    -- Synchronize timestamps across all associated ledgers
    UPDATE invoice_items
    SET created_at = v_new_created_at
    WHERE invoice_id = p_invoice_id;

    UPDATE payments
    SET created_at = v_new_created_at
    WHERE invoice_id = p_invoice_id;

    UPDATE stock_movements
    SET created_at = v_new_created_at
    WHERE invoice_item_id IN (SELECT id FROM invoice_items WHERE invoice_id = p_invoice_id);

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'created_at', v_new_created_at,
        'customer_id', v_target_customer_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION undo_void_invoice(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION permanently_delete_invoice(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_invoice_details(UUID, TIMESTAMPTZ, UUID, BOOLEAN) TO authenticated, service_role;
