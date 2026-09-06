-- Migration: 0089_fix_p0_02_lock_ordering.sql
-- Description: Fix inverted lock ordering deadlock between process_checkout and invoice operations (P0-02)
-- Enforces global lock hierarchy: variants (ORDER BY id ASC FOR UPDATE) -> customers (FOR UPDATE) -> invoices -> line_van_inventory
-- Fixes idempotency sanitization regression (ensures v_idempotency_key is inserted into invoices)

-- ============================================================================
-- STEP 1: DROP HISTORICAL OVERLOAD SIGNATURES TO PREVENT PGRST203 AMBIGUITY
-- ============================================================================
-- Schema-qualified drops
DROP FUNCTION IF EXISTS public.process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.process_checkout(UUID, JSONB, JSONB, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, TEXT, TIMESTAMPTZ);

-- Unqualified drops for robust search_path parity (matching 0085 migration standard)
DROP FUNCTION IF EXISTS process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB);
DROP FUNCTION IF EXISTS process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB, TEXT);
DROP FUNCTION IF EXISTS process_checkout(UUID, JSONB, JSONB, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, TEXT, TIMESTAMPTZ);

-- ============================================================================
-- STEP 2: RECREATE AUTHORITATIVE 13-PARAMETER process_checkout WITH STANDARDIZED LOCK ORDER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_checkout(
    p_customer_id UUID DEFAULT NULL,
    p_subtotal DECIMAL DEFAULT 0,
    p_discount_amount DECIMAL DEFAULT 0,
    p_round_off DECIMAL DEFAULT 0,
    p_gst_applied BOOLEAN DEFAULT FALSE,
    p_cgst_amount DECIMAL DEFAULT 0,
    p_sgst_amount DECIMAL DEFAULT 0,
    p_final_total DECIMAL DEFAULT 0,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_payments JSONB DEFAULT '[]'::jsonb,
    p_created_at TIMESTAMPTZ DEFAULT NULL,
    p_cheque_details JSONB DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_total_paid DECIMAL(10,2) := 0;
    v_item RECORD;
    v_payment RECORD;
    v_variant RECORD;
    v_total_pieces INTEGER;
    v_line_subtotal DECIMAL(10,2);
    v_line_cogs DECIMAL(10,2);
    v_line_profit DECIMAL(10,2);
    v_customer_credit DECIMAL(10,2);
    v_new_credit_balance DECIMAL(10,2);
    v_calculated_subtotal DECIMAL(10,2) := 0;
    v_expected_cgst DECIMAL(10,2) := 0;
    v_expected_sgst DECIMAL(10,2) := 0;
    v_expected_final_total DECIMAL(10,2) := 0;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    v_invoice_created_at TIMESTAMPTZ;
    v_item_id UUID;
    v_cheque_id UUID;
    v_idempotency_key TEXT := NULLIF(trim(p_idempotency_key), '');
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart cannot be empty.'; END IF;

    -- 1. Idempotency Check with Sanitized Key
    IF v_idempotency_key IS NOT NULL THEN
        SELECT id, invoice_number INTO v_invoice_id, v_invoice_number 
        FROM invoices 
        WHERE idempotency_key = v_idempotency_key;
        
        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true, 
                'invoice_id', v_invoice_id, 
                'invoice_number', v_invoice_number, 
                'already_processed', true
            );
        END IF;
    END IF;

    -- 2. Financial Bounds Checks
    IF p_subtotal < 0 OR p_discount_amount < 0 OR p_final_total < 0 THEN
        RAISE EXCEPTION 'Financial values cannot be negative.';
    END IF;

    IF p_discount_amount > p_subtotal THEN
        RAISE EXCEPTION 'Discount amount (₹%) cannot exceed subtotal (₹%).', p_discount_amount, p_subtotal;
    END IF;

    IF p_round_off < -50.00 OR p_round_off > 50.00 THEN
        RAISE EXCEPTION 'Round off (₹%) must be between -₹50.00 and +₹50.00.', p_round_off;
    END IF;

    v_invoice_created_at := COALESCE(p_created_at, NOW());
    IF v_invoice_created_at > (NOW() + INTERVAL '1 day') THEN
        RAISE EXCEPTION 'Invoice date cannot be in the future.';
    END IF;

    -- 3. Prevent duplicate variants in single checkout
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in checkout items. Please consolidate cart quantities.';
    END IF;

    -- 4. Validate payment array
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                IF v_payment.method = 'STORE_CREDIT' AND p_customer_id IS NULL THEN
                    RAISE EXCEPTION 'Customer is required when paying with store credit.';
                END IF;
                v_total_paid := v_total_paid + v_payment.amount;
            END IF;
        END LOOP;
    END IF;

    -- 5. Overpayment Guard
    IF v_total_paid > p_final_total THEN
        RAISE EXCEPTION 'Total payment (₹%) cannot exceed invoice final total (₹%).', v_total_paid, p_final_total;
    END IF;

    -- 6. Walk-in Zero Credit Invariant (Customer required for partial/credit sale unless cheque details provided)
    IF p_customer_id IS NULL AND v_total_paid < p_final_total AND (p_cheque_details IS NULL OR p_cheque_details->>'cheque_number' IS NULL) THEN
        RAISE EXCEPTION 'Customer is required for credit/partial credit sales.';
    END IF;

    -- 7. Lock variants in deterministic ascending UUID order (Global Lock Hierarchy: variants -> customers -> invoices -> line_van_inventory)
    PERFORM 1 FROM variants
    WHERE id IN (
        SELECT DISTINCT (x->>'variant_id')::UUID 
        FROM jsonb_array_elements(p_items) x 
        WHERE (x->>'variant_id') IS NOT NULL
    )
    ORDER BY id FOR UPDATE;

    -- 8. Verify active customer and acquire pessimistic lock (Acquired AFTER variants to eliminate cyclic deadlock)
    IF p_customer_id IS NOT NULL THEN
        PERFORM 1 FROM customers WHERE id = p_customer_id FOR UPDATE;
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND is_active = TRUE) THEN
            RAISE EXCEPTION 'Customer does not exist or is inactive.';
        END IF;
    END IF;

    -- 9. Validate Stock, Anti-Tampering, & Calculate Subtotal
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

        SELECT v.*, COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps 
        INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id 
        WHERE v.id = v_item.variant_id AND v.is_active = TRUE AND p.is_active = TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product variant is inactive or no longer exists.';
        END IF;

        IF v_item.selling_price <> v_variant.selling_price THEN
            RAISE EXCEPTION 'Price tampering detected for variant %: catalog price %, sent %',
                v_variant.name, v_variant.selling_price, v_item.selling_price;
        END IF;

        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_variant.effective_pps) + COALESCE(v_item.loose_quantity, 0);
        IF v_total_pieces <= 0 THEN
            RAISE EXCEPTION 'Total pieces for variant % must be greater than zero.', v_variant.name;
        END IF;

        IF v_variant.stock_quantity < v_total_pieces THEN
            RAISE EXCEPTION 'Insufficient stock for variant %. Available: %, Requested: %',
                v_variant.name, v_variant.stock_quantity, v_total_pieces;
        END IF;

        IF v_variant.stock_sets < COALESCE(v_item.sets_quantity, 0) THEN
            RAISE EXCEPTION 'Insufficient packaged sets for variant %. Available: %, Requested: %',
                v_variant.name, v_variant.stock_sets, v_item.sets_quantity;
        END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_total_pieces * v_variant.selling_price);
    END LOOP;

    v_calculated_subtotal := ROUND(v_calculated_subtotal, 2);

    IF p_gst_applied THEN
        v_expected_cgst := ROUND(GREATEST(0, v_calculated_subtotal - p_discount_amount) * 0.025, 2);
        v_expected_sgst := ROUND(GREATEST(0, v_calculated_subtotal - p_discount_amount) * 0.025, 2);
    END IF;

    v_expected_final_total := ROUND(v_calculated_subtotal - p_discount_amount + p_round_off + (v_expected_cgst + v_expected_sgst), 2);
    IF ABS(p_final_total - v_expected_final_total) > 0.05 THEN
        RAISE EXCEPTION 'Invoice total mismatch: calculated %, received %', v_expected_final_total, p_final_total;
    END IF;

    -- 10. Generate 6-Digit Collision-Free Invoice Number via Universal Generator
    v_invoice_number := generate_invoice_number('INV', 6, v_invoice_created_at);

    INSERT INTO invoices (
        invoice_number, customer_id, subtotal, discount_amount, round_off,
        gst_applied, cgst_amount, sgst_amount, final_total, created_at, updated_at, idempotency_key
    ) VALUES (
        v_invoice_number, p_customer_id, v_calculated_subtotal, p_discount_amount, p_round_off,
        p_gst_applied, v_expected_cgst, v_expected_sgst, p_final_total, v_invoice_created_at, v_invoice_created_at, v_idempotency_key
    ) RETURNING id INTO v_invoice_id;

    -- 11. Deduct Stock and Insert Line Items
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER, selling_price DECIMAL
    )
    LOOP
        SELECT v.*, COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps 
        INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id 
        WHERE v.id = v_item.variant_id;

        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_variant.effective_pps) + COALESCE(v_item.loose_quantity, 0);
        v_line_subtotal := v_total_pieces * v_variant.selling_price;
        v_line_cogs := v_total_pieces * v_variant.cost_price;
        v_line_profit := v_line_subtotal - v_line_cogs;

        INSERT INTO invoice_items (
            invoice_id, variant_id, quantity, sets_quantity, loose_quantity,
            selling_price_snapshot, cost_price_snapshot, profit_snapshot,
            created_at
        ) VALUES (
            v_invoice_id, v_item.variant_id, v_total_pieces,
            COALESCE(v_item.sets_quantity, 0), COALESCE(v_item.loose_quantity, 0),
            v_variant.selling_price, v_variant.cost_price, v_line_profit,
            v_invoice_created_at
        ) RETURNING id INTO v_item_id;

        UPDATE variants
        SET stock_quantity = stock_quantity - v_total_pieces,
            stock_sets = GREATEST(0, LEAST(stock_sets - COALESCE(v_item.sets_quantity, 0), FLOOR((stock_quantity - v_total_pieces) / v_variant.effective_pps))),
            updated_at = NOW()
        WHERE id = v_item.variant_id;

        INSERT INTO stock_movements (
            variant_id, invoice_item_id, type, quantity_change,
            sets_change, loose_change, notes, created_at
        ) VALUES (
            v_item.variant_id, v_item_id, 'SALE'::stock_movement_type,
            -v_total_pieces, -COALESCE(v_item.sets_quantity, 0), -COALESCE(v_item.loose_quantity, 0),
            'Sale: ' || v_invoice_number, v_invoice_created_at
        );
    END LOOP;

    -- 12. Process Payments & Update Store Credit Ledger using reference_invoice_id
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                IF v_payment.method = 'STORE_CREDIT' THEN
                    SELECT credit_balance INTO v_customer_credit
                    FROM customers WHERE id = p_customer_id FOR UPDATE;

                    IF v_customer_credit < v_payment.amount THEN
                        RAISE EXCEPTION 'Insufficient store credit balance (Available: ₹%, Requested: ₹%).',
                            v_customer_credit, v_payment.amount;
                    END IF;

                    UPDATE customers
                    SET credit_balance = credit_balance - v_payment.amount,
                        updated_at = NOW()
                    WHERE id = p_customer_id
                    RETURNING credit_balance INTO v_new_credit_balance;

                    -- Insert using reference_invoice_id (NOT invoice_id)
                    INSERT INTO customer_credit_ledger (
                        customer_id, type, amount, balance_after,
                        reference_invoice_id, notes, created_at
                    ) VALUES (
                        p_customer_id, 'PAYMENT_APPLIED'::credit_movement_type,
                        -v_payment.amount, v_new_credit_balance, v_invoice_id,
                        'Used store credit for invoice #' || v_invoice_number,
                        v_invoice_created_at
                    );
                END IF;

                INSERT INTO payments (
                    invoice_id, customer_id, amount, method, notes, created_at
                ) VALUES (
                    v_invoice_id, p_customer_id, v_payment.amount, v_payment.method,
                    'Payment for invoice #' || v_invoice_number, v_invoice_created_at
                );
            END IF;
        END LOOP;
    END IF;

    -- 13. Atomic Cheque Creation
    IF p_cheque_details IS NOT NULL AND jsonb_typeof(p_cheque_details) = 'object' AND p_cheque_details->>'cheque_number' IS NOT NULL THEN
        IF p_customer_id IS NULL THEN
            RAISE EXCEPTION 'Customer is required for Cheque payment.';
        END IF;

        INSERT INTO customer_cheques (
            customer_id,
            invoice_id,
            cheque_number,
            bank_name,
            cheque_date,
            amount,
            status,
            created_at
        ) VALUES (
            p_customer_id,
            v_invoice_id,
            trim(p_cheque_details->>'cheque_number'),
            trim(p_cheque_details->>'bank_name'),
            (p_cheque_details->>'cheque_date')::DATE,
            p_final_total,
            'PENDING',
            v_invoice_created_at
        ) RETURNING id INTO v_cheque_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'total_amount', p_final_total,
        'paid_amount', v_total_paid,
        'due_amount', GREATEST(0.00, p_final_total - v_total_paid)
    );
END;
$$;

-- Grant permissions matching existing migration standards
GRANT EXECUTE ON FUNCTION public.process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB, TEXT) TO authenticated, service_role;
