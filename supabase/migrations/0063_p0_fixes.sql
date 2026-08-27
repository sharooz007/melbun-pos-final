-- Migration: 0063_p0_fixes.sql
-- Fixes P0 foreign key crash on editing un-voided invoices and maintains ledger integrity.

ALTER TABLE stock_movements
DROP CONSTRAINT IF EXISTS stock_movements_invoice_item_id_fkey,
ADD CONSTRAINT stock_movements_invoice_item_id_fkey 
  FOREIGN KEY (invoice_item_id) 
  REFERENCES invoice_items(id) 
  ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION update_full_invoice(
    p_invoice_id UUID,
    p_customer_id UUID,
    p_created_at TIMESTAMPTZ,
    p_subtotal DECIMAL,
    p_discount_amount DECIMAL,
    p_round_off DECIMAL,
    p_gst_applied BOOLEAN,
    p_cgst_amount DECIMAL,
    p_sgst_amount DECIMAL,
    p_final_total DECIMAL,
    p_items JSONB,
    p_payments JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_old_item RECORD;
    v_item RECORD;
    v_payment RECORD;
    v_variant RECORD;
    v_total_paid DECIMAL(10,2) := 0;
    v_total_pieces INTEGER;
    v_line_subtotal DECIMAL(10,2);
    v_line_cogs DECIMAL(10,2);
    v_line_profit DECIMAL(10,2);
    v_calculated_subtotal DECIMAL(10,2) := 0;
    v_expected_cgst DECIMAL(10,2) := 0;
    v_expected_sgst DECIMAL(10,2) := 0;
    v_expected_final_total DECIMAL(10,2) := 0;
    v_old_store_credit DECIMAL(10,2) := 0;
    v_new_store_credit DECIMAL(10,2) := 0;
    v_customer_credit DECIMAL(10,2) := 0;
    v_new_credit_balance DECIMAL(10,2) := 0;
    v_item_id UUID;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    v_invoice_created_at TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice ID is required.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart cannot be empty.'; END IF;
    IF p_subtotal < 0 OR p_discount_amount < 0 OR p_final_total < 0 THEN
        RAISE EXCEPTION 'Financial values cannot be negative.';
    END IF;

    -- 1. Lock invoice
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_invoice.is_hidden THEN RAISE EXCEPTION 'Cannot edit a permanently deleted invoice.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Cannot edit a voided invoice (Undo void first).'; END IF;

    -- 2. Foreign Key & Return Integrity Guard
    IF EXISTS (SELECT 1 FROM returns WHERE invoice_id = p_invoice_id) THEN
        RAISE EXCEPTION 'Cannot edit cart on an invoice that has returns processed. Please void or adjust returns first.';
    END IF;

    -- 3. Timestamp validations
    v_invoice_created_at := COALESCE(p_created_at, v_invoice.created_at);
    IF v_invoice_created_at > (NOW() + INTERVAL '1 day') THEN
        RAISE EXCEPTION 'Invoice date cannot be in the future.';
    END IF;

    -- 4. Prevent duplicate variants in new items
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in items. Please consolidate quantities.';
    END IF;

    -- 5. Calculate total paid and validate customer credit rules
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                IF v_payment.method = 'STORE_CREDIT' THEN
                    IF p_customer_id IS NULL THEN
                        RAISE EXCEPTION 'Customer is required when paying with store credit.';
                    END IF;
                    v_new_store_credit := v_new_store_credit + v_payment.amount;
                END IF;
                v_total_paid := v_total_paid + v_payment.amount;
            END IF;
        END LOOP;
    END IF;

    -- Walk-in credit check (Policy 10)
    IF p_customer_id IS NULL AND v_total_paid < p_final_total THEN
        RAISE EXCEPTION 'Customer is required for credit/partial credit sales.';
    END IF;

    -- Verify active customer if provided
    IF p_customer_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND is_active = TRUE) THEN
            RAISE EXCEPTION 'Customer does not exist or is inactive.';
        END IF;
    END IF;

    -- 6. Lock all involved variants (both old and new) in deterministic order
    PERFORM 1 FROM variants v
    WHERE v.id IN (
        SELECT variant_id FROM invoice_items WHERE invoice_id = p_invoice_id
        UNION
        SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x
    )
    ORDER BY v.id FOR UPDATE OF v;

    -- 7. REVERT OLD STOCK: Add back old quantities
    FOR v_old_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        UPDATE variants
        SET stock_quantity = stock_quantity + v_old_item.quantity,
            stock_sets = stock_sets + COALESCE(v_old_item.sets_quantity, 0),
            updated_at = NOW()
        WHERE id = v_old_item.variant_id;
    END LOOP;

    -- 7b. DELETE OLD SALE STOCK MOVEMENTS & DECOUPLE HISTORICAL AUDIT MOVEMENTS
    DELETE FROM stock_movements 
    WHERE invoice_item_id IN (SELECT id FROM invoice_items WHERE invoice_id = p_invoice_id)
       OR notes = 'Sale: ' || v_invoice.invoice_number
       OR notes = 'Invoice Edit: ' || v_invoice.invoice_number
       OR notes = 'Undo Void: ' || v_invoice.invoice_number;

    UPDATE stock_movements
    SET invoice_item_id = NULL
    WHERE invoice_item_id IN (SELECT id FROM invoice_items WHERE invoice_id = p_invoice_id);

    -- 8. VALIDATE & CALCULATE NEW STOCK & SUBTOTAL
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER, selling_price DECIMAL
    )
    LOOP
        IF v_item.sets_quantity < 0 OR v_item.loose_quantity < 0 THEN
            RAISE EXCEPTION 'Quantities cannot be negative.';
        END IF;

        IF v_item.selling_price < 0 THEN
            RAISE EXCEPTION 'Selling price cannot be negative.';
        END IF;

        SELECT v.*, p.pieces_per_set INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id 
        WHERE v.id = v_item.variant_id AND v.is_active = TRUE AND p.is_active = TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product variant is inactive or no longer exists.';
        END IF;

        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * COALESCE(v_variant.pieces_per_set, 1)) + COALESCE(v_item.loose_quantity, 0);
        IF v_total_pieces <= 0 THEN
            RAISE EXCEPTION 'Total pieces for variant % must be greater than zero.', v_variant.name;
        END IF;

        -- Stock Availability Validation against restored stock
        IF v_variant.stock_quantity < v_total_pieces THEN
            RAISE EXCEPTION 'Insufficient stock for variant %. Available: %, Requested: %',
                v_variant.name, v_variant.stock_quantity, v_total_pieces;
        END IF;

        IF v_variant.stock_sets < COALESCE(v_item.sets_quantity, 0) THEN
            RAISE EXCEPTION 'Insufficient packaged sets for variant %. Available: %, Requested: %',
                v_variant.name, v_variant.stock_sets, v_item.sets_quantity;
        END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_total_pieces * v_item.selling_price);
    END LOOP;

    v_calculated_subtotal := ROUND(v_calculated_subtotal, 2);

    -- Authoritative Tax & Final Total Verification
    IF p_gst_applied THEN
        v_expected_cgst := ROUND(GREATEST(0, v_calculated_subtotal - p_discount_amount) * 0.025, 2);
        v_expected_sgst := ROUND(GREATEST(0, v_calculated_subtotal - p_discount_amount) * 0.025, 2);
    END IF;

    v_expected_final_total := ROUND(v_calculated_subtotal - p_discount_amount + p_round_off + (v_expected_cgst + v_expected_sgst), 2);
    IF ABS(p_final_total - v_expected_final_total) > 0.05 THEN
        RAISE EXCEPTION 'Invoice total mismatch: calculated %, received %', v_expected_final_total, p_final_total;
    END IF;

    -- 9. RECONCILE STORE CREDIT WALLET WITH DETERMINISTIC CUSTOMER LOCKING
    SELECT COALESCE(SUM(amount), 0.00) INTO v_old_store_credit
    FROM payments WHERE invoice_id = p_invoice_id AND method = 'STORE_CREDIT';

    IF (v_old_store_credit > 0 AND v_invoice.customer_id IS NOT NULL) OR v_new_store_credit > 0 THEN
        PERFORM 1 FROM customers c
        WHERE c.id IN (v_invoice.customer_id, p_customer_id)
        ORDER BY c.id FOR UPDATE OF c;
    END IF;

    IF v_old_store_credit > 0 AND v_invoice.customer_id IS NOT NULL THEN
        UPDATE customers
        SET credit_balance = credit_balance + v_old_store_credit,
            updated_at = NOW()
        WHERE id = v_invoice.customer_id
        RETURNING credit_balance INTO v_new_credit_balance;

        INSERT INTO customer_credit_ledger (
            customer_id, type, amount, balance_after, reference_invoice_id, notes, created_at
        ) VALUES (
            v_invoice.customer_id,
            'MANUAL_ADJUST'::credit_movement_type,
            v_old_store_credit,
            v_new_credit_balance,
            p_invoice_id,
            'Invoice Edit: Reverted previous store credit payment for ' || v_invoice.invoice_number,
            v_invoice_created_at
        );
    END IF;

    IF v_new_store_credit > 0 THEN
        SELECT credit_balance INTO v_customer_credit
        FROM customers WHERE id = p_customer_id;

        IF v_customer_credit < v_new_store_credit THEN
            RAISE EXCEPTION 'Insufficient store credit balance (Available: %, Requested: %)',
                v_customer_credit, v_new_store_credit;
        END IF;

        UPDATE customers
        SET credit_balance = credit_balance - v_new_store_credit,
            updated_at = NOW()
        WHERE id = p_customer_id
        RETURNING credit_balance INTO v_new_credit_balance;

        INSERT INTO customer_credit_ledger (
            customer_id, type, amount, balance_after, reference_invoice_id, notes, created_at
        ) VALUES (
            p_customer_id,
            'PAYMENT_APPLIED'::credit_movement_type,
            -v_new_store_credit,
            v_new_credit_balance,
            p_invoice_id,
            'Invoice Edit: Re-applied store credit for ' || v_invoice.invoice_number,
            v_invoice_created_at
        );
    END IF;

    -- 10. REPLACE INVOICE ITEMS
    DELETE FROM invoice_items WHERE invoice_id = p_invoice_id;

    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER, selling_price DECIMAL
    )
    LOOP
        SELECT v.*, p.pieces_per_set INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id 
        WHERE v.id = v_item.variant_id;

        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * COALESCE(v_variant.pieces_per_set, 1)) + COALESCE(v_item.loose_quantity, 0);
        v_line_subtotal := ROUND(v_total_pieces * v_item.selling_price, 2);
        v_line_cogs := ROUND(v_total_pieces * v_variant.cost_price, 2);
        v_line_profit := v_line_subtotal - v_line_cogs;

        INSERT INTO invoice_items (
            invoice_id, variant_id, quantity, sets_quantity, loose_quantity,
            selling_price_snapshot, cost_price_snapshot, profit_snapshot, created_at
        ) VALUES (
            p_invoice_id, v_item.variant_id, v_total_pieces, v_item.sets_quantity, v_item.loose_quantity,
            v_item.selling_price, v_variant.cost_price, v_line_profit, v_invoice_created_at
        ) RETURNING id INTO v_item_id;

        UPDATE variants 
        SET stock_quantity = stock_quantity - v_total_pieces,
            stock_sets = GREATEST(0, stock_sets - COALESCE(v_item.sets_quantity, 0)),
            updated_at = NOW()
        WHERE id = v_item.variant_id;

        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes, created_at)
        VALUES (v_item_id, v_item.variant_id, 'SALE', -v_total_pieces, 'Invoice Edit: ' || v_invoice.invoice_number, v_invoice_created_at);
    END LOOP;

    -- 11. REPLACE PAYMENTS
    DELETE FROM payments WHERE invoice_id = p_invoice_id;

    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                INSERT INTO payments (invoice_id, customer_id, amount, method, created_at)
                VALUES (p_invoice_id, p_customer_id, v_payment.amount, v_payment.method, v_invoice_created_at);
            END IF;
        END LOOP;
    END IF;

    -- 12. UPDATE INVOICE RECORD
    UPDATE invoices
    SET customer_id = p_customer_id,
        subtotal = v_calculated_subtotal,
        discount_amount = p_discount_amount,
        round_off = p_round_off,
        gst_applied = p_gst_applied,
        cgst_amount = v_expected_cgst,
        sgst_amount = v_expected_sgst,
        final_total = p_final_total,
        created_at = v_invoice_created_at,
        updated_at = NOW()
    WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'invoice_number', v_invoice.invoice_number,
        'final_total', p_final_total
    );
END;
$$;

GRANT EXECUTE ON FUNCTION update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB) TO authenticated, service_role;
