-- Migration: 0085_fix_checkout_overload_and_columns.sql
-- Resolves:
-- 1. Missing columns on invoices table (notes, void_reason)
-- 2. PGRST203 candidate overload ambiguity for process_checkout, undo_void_invoice, bill_line_staff_sales
-- 3. payments column name fix (method instead of payment_method)
-- 4. line_stock_movements column name fix (movement_type instead of type)
-- 5. customer_cheques column schema fix (cheque_date, amount, status)
-- 6. Idempotency key sanitization (NULLIF(trim(...), '')) to avoid unique constraint collisions
-- 7. Restores full server-side financial and anti-tampering validation

-- ============================================================================
-- STEP 1: SCHEMA EXTENSIONS (invoices table)
-- ============================================================================
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- ============================================================================
-- STEP 2: DROP ALL HISTORICAL OVERLOAD SIGNATURES
-- ============================================================================

-- Drop all process_checkout historical signatures
DROP FUNCTION IF EXISTS public.process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB, TEXT);

DROP FUNCTION IF EXISTS process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB);
DROP FUNCTION IF EXISTS process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB, TEXT);

-- Drop historical signatures of void_invoice and undo_void_invoice
DROP FUNCTION IF EXISTS public.void_invoice(UUID);
DROP FUNCTION IF EXISTS public.void_invoice(UUID, TEXT);
DROP FUNCTION IF EXISTS void_invoice(UUID);
DROP FUNCTION IF EXISTS void_invoice(UUID, TEXT);

DROP FUNCTION IF EXISTS public.undo_void_invoice(UUID);
DROP FUNCTION IF EXISTS public.undo_void_invoice(UUID, TEXT);
DROP FUNCTION IF EXISTS undo_void_invoice(UUID);
DROP FUNCTION IF EXISTS undo_void_invoice(UUID, TEXT);

-- Drop historical signatures of bill_line_staff_sales
DROP FUNCTION IF EXISTS public.bill_line_staff_sales(UUID, JSONB, JSONB, DECIMAL, DECIMAL, TEXT);
DROP FUNCTION IF EXISTS public.bill_line_staff_sales(UUID, JSONB, JSONB, DECIMAL, DECIMAL, TEXT, BOOLEAN, DECIMAL, DECIMAL, TEXT);
DROP FUNCTION IF EXISTS bill_line_staff_sales(UUID, JSONB, JSONB, DECIMAL, DECIMAL, TEXT);
DROP FUNCTION IF EXISTS bill_line_staff_sales(UUID, JSONB, JSONB, DECIMAL, DECIMAL, TEXT, BOOLEAN, DECIMAL, DECIMAL, TEXT);

-- ============================================================================
-- STEP 3: RECREATE SINGLE AUTHORITATIVE process_checkout (13 PARAMETERS)
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
    done BOOLEAN := FALSE;
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

    -- 7. Verify active customer and acquire pessimistic lock
    IF p_customer_id IS NOT NULL THEN
        PERFORM 1 FROM customers WHERE id = p_customer_id FOR UPDATE;
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND is_active = TRUE) THEN
            RAISE EXCEPTION 'Customer does not exist or is inactive.';
        END IF;
    END IF;

    -- 8. Lock variants in deterministic ascending UUID order (Deadlock Prevention)
    PERFORM 1 FROM variants v
    WHERE v.id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x)
    ORDER BY v.id FOR UPDATE OF v;

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

    -- 10. Collision-resistant Invoice Number Generation
    WHILE NOT done LOOP
        v_invoice_number := 'INV-' || to_char(v_invoice_created_at, 'YYMM') || '-' || LPAD(FLOOR(random() * 10000)::text, 4, '0');
        IF NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = v_invoice_number) THEN 
            done := TRUE; 
        END IF;
    END LOOP;

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

    -- 12. Process Payments (Correct column: method)
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

    -- 13. Atomic Cheque Creation (Correct columns: customer_id, invoice_id, cheque_number, bank_name, cheque_date, amount, status, created_at)
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

GRANT EXECUTE ON FUNCTION public.process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB, TEXT) TO authenticated, service_role;

-- ============================================================================
-- STEP 4: FIX void_invoice (Uses method on payments, movement_type on line_stock_movements)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.void_invoice(
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
    v_restored_sets INTEGER;
    v_returned_pieces INTEGER;
    v_pieces_per_set INTEGER;
    v_net_store_credit_paid DECIMAL(10,2) := 0;
    v_restored_balance DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized.'; END IF;
    IF p_invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice ID is required.'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Invoice is already voided.'; END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO v_returned_pieces FROM returns WHERE invoice_id = p_invoice_id;
    IF v_returned_pieces > 0 THEN RAISE EXCEPTION 'Cannot void an invoice that has active returns. Void the returns first.'; END IF;

    PERFORM 1 FROM variants v WHERE v.id IN (SELECT variant_id FROM invoice_items WHERE invoice_id = p_invoice_id) ORDER BY v.id FOR UPDATE OF v;
    IF v_invoice.customer_id IS NOT NULL THEN PERFORM 1 FROM customers WHERE id = v_invoice.customer_id FOR UPDATE; END IF;

    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant FROM variants v JOIN products p ON v.product_id = p.id WHERE v.id = v_item.variant_id;
        v_pieces_per_set := GREATEST(COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1), 1);
        v_restored_pieces := v_item.quantity;
        v_restored_sets := COALESCE(v_item.sets_quantity, 0);

        IF v_restored_pieces > 0 THEN
            IF v_invoice.line_staff_id IS NOT NULL THEN
                INSERT INTO line_van_inventory (staff_id, variant_id, quantity, sets_quantity, updated_at)
                VALUES (v_invoice.line_staff_id, v_item.variant_id, v_restored_pieces, v_restored_sets, NOW())
                ON CONFLICT (staff_id, variant_id) DO UPDATE SET 
                    quantity = line_van_inventory.quantity + EXCLUDED.quantity,
                    sets_quantity = line_van_inventory.sets_quantity + EXCLUDED.sets_quantity,
                    updated_at = NOW();

                -- Corrected to movement_type instead of type
                INSERT INTO line_stock_movements (staff_id, variant_id, movement_type, sets_quantity, quantity, notes)
                VALUES (v_invoice.line_staff_id, v_item.variant_id, 'MANUAL_RETURN', v_restored_sets, v_restored_pieces, 'Void Invoice ' || v_invoice.invoice_number);
            ELSE
                UPDATE variants SET stock_quantity = stock_quantity + v_restored_pieces, stock_sets = stock_sets + v_restored_sets, updated_at = NOW() WHERE id = v_item.variant_id;
                INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, sets_change, loose_change, notes)
                VALUES (v_item.id, v_item.variant_id, 'MANUAL_ADJUST'::stock_movement_type, v_restored_pieces, v_restored_sets, COALESCE(v_item.loose_quantity, 0), 'Void Restock: ' || v_invoice.invoice_number);
            END IF;
        END IF;
    END LOOP;

    IF v_invoice.customer_id IS NOT NULL THEN
        -- Corrected to method instead of payment_method
        SELECT COALESCE(SUM(amount), 0) INTO v_net_store_credit_paid 
        FROM payments 
        WHERE invoice_id = p_invoice_id AND method = 'STORE_CREDIT';

        IF v_net_store_credit_paid > 0 THEN
            UPDATE customers SET credit_balance = credit_balance + v_net_store_credit_paid, updated_at = NOW() WHERE id = v_invoice.customer_id RETURNING credit_balance INTO v_restored_balance;
            INSERT INTO customer_credit_ledger (customer_id, type, amount, balance_after, reference_invoice_id, notes)
            VALUES (v_invoice.customer_id, 'MANUAL_ADJUST'::credit_movement_type, v_net_store_credit_paid, v_restored_balance, p_invoice_id, 'Refund Store Credit from Voided Invoice ' || v_invoice.invoice_number);
        END IF;
    END IF;

    UPDATE invoices SET is_voided = TRUE, void_reason = p_reason, updated_at = NOW() WHERE id = p_invoice_id;
    RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_invoice(UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- STEP 5: FIX undo_void_invoice (Uses method on payments, movement_type on line_stock_movements)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.undo_void_invoice(
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
    v_van_item RECORD;
    v_net_pieces_to_deduct INTEGER;
    v_sets_to_deduct INTEGER;
    v_pieces_per_set INTEGER;
    v_net_store_credit_paid DECIMAL(10,2) := 0;
    v_new_balance DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized.'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF NOT v_invoice.is_voided THEN RAISE EXCEPTION 'Invoice is not voided.'; END IF;

    PERFORM 1 FROM variants v WHERE v.id IN (SELECT variant_id FROM invoice_items WHERE invoice_id = p_invoice_id) ORDER BY v.id FOR UPDATE OF v;
    IF v_invoice.customer_id IS NOT NULL THEN PERFORM 1 FROM customers WHERE id = v_invoice.customer_id FOR UPDATE; END IF;

    -- Validate stock
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant FROM variants v JOIN products p ON v.product_id = p.id WHERE v.id = v_item.variant_id;
        v_pieces_per_set := GREATEST(COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1), 1);
        v_net_pieces_to_deduct := v_item.quantity;

        IF v_net_pieces_to_deduct > 0 THEN
            IF v_invoice.line_staff_id IS NOT NULL THEN
                SELECT * INTO v_van_item FROM line_van_inventory WHERE staff_id = v_invoice.line_staff_id AND variant_id = v_item.variant_id FOR UPDATE;
                IF NOT FOUND OR v_van_item.quantity < v_net_pieces_to_deduct THEN
                    RAISE EXCEPTION 'Insufficient van stock for variant % to undo void.', v_variant.name;
                END IF;
            ELSE
                IF v_variant.stock_quantity < v_net_pieces_to_deduct THEN
                    RAISE EXCEPTION 'Insufficient warehouse stock for variant % to undo void.', v_variant.name;
                END IF;
            END IF;
        END IF;
    END LOOP;

    -- Deduct stock
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant FROM variants v JOIN products p ON v.product_id = p.id WHERE v.id = v_item.variant_id;
        v_pieces_per_set := GREATEST(COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1), 1);
        v_net_pieces_to_deduct := v_item.quantity;
        
        v_sets_to_deduct := LEAST(COALESCE(v_item.sets_quantity, 0), FLOOR(v_net_pieces_to_deduct::numeric / v_pieces_per_set));

        IF v_net_pieces_to_deduct > 0 THEN
            IF v_invoice.line_staff_id IS NOT NULL THEN
                UPDATE line_van_inventory SET quantity = quantity - v_net_pieces_to_deduct, sets_quantity = GREATEST(0, sets_quantity - v_sets_to_deduct), updated_at = NOW() 
                WHERE staff_id = v_invoice.line_staff_id AND variant_id = v_item.variant_id;
                
                -- Corrected to movement_type instead of type
                INSERT INTO line_stock_movements (staff_id, variant_id, movement_type, sets_quantity, quantity, notes)
                VALUES (v_invoice.line_staff_id, v_item.variant_id, 'SALE_DEDUCT', v_sets_to_deduct, v_net_pieces_to_deduct, 'Undo Void ' || v_invoice.invoice_number);
            ELSE
                UPDATE variants SET stock_quantity = stock_quantity - v_net_pieces_to_deduct, stock_sets = GREATEST(0, stock_sets - v_sets_to_deduct), updated_at = NOW() WHERE id = v_item.variant_id;
                INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, sets_change, loose_change, notes)
                VALUES (v_item.id, v_item.variant_id, 'SALE'::stock_movement_type, -v_net_pieces_to_deduct, -v_sets_to_deduct, -COALESCE(v_item.loose_quantity, 0), 'Undo Void ' || v_invoice.invoice_number);
            END IF;
        END IF;
    END LOOP;

    IF v_invoice.customer_id IS NOT NULL THEN
        -- Corrected to method instead of payment_method
        SELECT COALESCE(SUM(amount), 0) INTO v_net_store_credit_paid 
        FROM payments 
        WHERE invoice_id = p_invoice_id AND method = 'STORE_CREDIT';

        IF v_net_store_credit_paid > 0 THEN
            SELECT credit_balance INTO v_new_balance FROM customers WHERE id = v_invoice.customer_id FOR UPDATE;
            IF v_new_balance < v_net_store_credit_paid THEN RAISE EXCEPTION 'Insufficient store credit to undo void.'; END IF;
            UPDATE customers SET credit_balance = credit_balance - v_net_store_credit_paid, updated_at = NOW() WHERE id = v_invoice.customer_id RETURNING credit_balance INTO v_new_balance;
            INSERT INTO customer_credit_ledger (customer_id, type, amount, balance_after, reference_invoice_id, notes)
            VALUES (v_invoice.customer_id, 'PAYMENT_APPLIED'::credit_movement_type, -v_net_store_credit_paid, v_new_balance, p_invoice_id, 'Re-apply Store Credit for Undo Void ' || v_invoice.invoice_number);
        END IF;
    END IF;

    UPDATE invoices SET is_voided = FALSE, void_reason = NULL, updated_at = NOW() WHERE id = p_invoice_id;
    RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.undo_void_invoice(UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- STEP 6: FIX bill_line_staff_sales (Uses method, movement_type, and sanitizes idempotency_key)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bill_line_staff_sales(
    p_staff_id UUID,
    p_items JSONB,
    p_payments JSONB DEFAULT '[]'::jsonb,
    p_discount_amount DECIMAL DEFAULT 0.00,
    p_round_off DECIMAL DEFAULT 0.00,
    p_notes TEXT DEFAULT NULL,
    p_gst_applied BOOLEAN DEFAULT FALSE,
    p_cgst_amount DECIMAL DEFAULT 0.00,
    p_sgst_amount DECIMAL DEFAULT 0.00,
    p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_staff RECORD;
    v_customer RECORD;
    v_customer_id UUID := NULL;
    v_van_item RECORD;
    v_item RECORD;
    v_variant RECORD;
    v_payment RECORD;
    v_pps INTEGER;
    v_total_pieces INTEGER;
    v_subtotal DECIMAL(10,2) := 0;
    v_taxable_amount DECIMAL(10,2) := 0;
    v_cgst DECIMAL(10,2) := 0;
    v_sgst DECIMAL(10,2) := 0;
    v_final_total DECIMAL(10,2) := 0;
    v_total_paid DECIMAL(10,2) := 0;
    v_store_credit_paid DECIMAL(10,2) := 0;
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_item_id UUID;
    v_customer_name TEXT;
    v_line_profit DECIMAL(10,2) := 0;
    v_idempotency_key TEXT := NULLIF(trim(p_idempotency_key), '');
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_staff_id IS NULL THEN RAISE EXCEPTION 'Staff ID is required.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart is empty.'; END IF;

    -- Idempotency Check with Sanitized Key
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

    -- 1. Fetch line staff & customer linking
    SELECT * INTO v_staff FROM line_staff WHERE id = p_staff_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line staff not found.'; END IF;
    IF NOT v_staff.is_active THEN RAISE EXCEPTION 'Line staff is inactive.'; END IF;

    IF v_staff.customer_id IS NOT NULL THEN
        SELECT * INTO v_customer FROM customers WHERE id = v_staff.customer_id FOR UPDATE;
        IF FOUND THEN
            v_customer_id := v_customer.id;
        END IF;
    END IF;

    IF v_customer_id IS NULL THEN
        v_customer_name := v_staff.name || ' (Line Sales - ' || UPPER(SUBSTRING(v_staff.id::TEXT FROM 1 FOR 4)) || ')';
        INSERT INTO customers (name, phone, is_active)
        VALUES (v_customer_name, NULLIF(trim(v_staff.phone), ''), TRUE)
        RETURNING * INTO v_customer;
        v_customer_id := v_customer.id;
        UPDATE line_staff SET customer_id = v_customer_id WHERE id = p_staff_id;
    END IF;

    -- 2. Deterministic Lock on Van Inventory rows
    PERFORM 1 FROM line_van_inventory lvi
    WHERE lvi.staff_id = p_staff_id 
      AND lvi.variant_id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x)
    ORDER BY lvi.variant_id FOR UPDATE;

    -- 3. Calculate Subtotal & Deduct Van Inventory
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID,
        sets_quantity INTEGER,
        loose_quantity INTEGER,
        selling_price DECIMAL
    )
    LOOP
        IF COALESCE(v_item.sets_quantity, 0) < 0 OR COALESCE(v_item.loose_quantity, 0) < 0 THEN
            RAISE EXCEPTION 'Quantities cannot be negative.';
        END IF;

        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;
        
        IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found: %', v_item.variant_id; END IF;

        v_pps := COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1);
        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_pps) + COALESCE(v_item.loose_quantity, 0);

        IF v_total_pieces <= 0 THEN RAISE EXCEPTION 'Sold pieces must be greater than 0 for variant %', v_variant.name; END IF;

        SELECT * INTO v_van_item FROM line_van_inventory 
        WHERE staff_id = p_staff_id AND variant_id = v_item.variant_id;

        IF NOT FOUND OR v_van_item.quantity < v_total_pieces THEN
            RAISE EXCEPTION 'Insufficient van stock for %. Van holds: % pcs, Sold: % pcs',
                v_variant.name, COALESCE(v_van_item.quantity, 0), v_total_pieces;
        END IF;

        UPDATE line_van_inventory
        SET quantity = quantity - v_total_pieces,
            sets_quantity = GREATEST(0, sets_quantity - COALESCE(v_item.sets_quantity, 0)),
            updated_at = NOW()
        WHERE staff_id = p_staff_id AND variant_id = v_item.variant_id;

        -- Corrected to movement_type instead of type
        INSERT INTO line_stock_movements (staff_id, variant_id, movement_type, sets_quantity, quantity, notes)
        VALUES (p_staff_id, v_item.variant_id, 'SALE_DEDUCT', COALESCE(v_item.sets_quantity, 0), v_total_pieces, 'Line Sale Dispatch');

        v_subtotal := v_subtotal + ROUND(v_total_pieces * COALESCE(v_item.selling_price, v_variant.selling_price), 2);
    END LOOP;

    -- 4. Calculate Final Total (GST Aware)
    v_taxable_amount := GREATEST(0.00, v_subtotal - COALESCE(p_discount_amount, 0));
    IF p_gst_applied THEN
        v_cgst := COALESCE(NULLIF(p_cgst_amount, 0), ROUND(v_taxable_amount * 0.025, 2));
        v_sgst := COALESCE(NULLIF(p_sgst_amount, 0), ROUND(v_taxable_amount * 0.025, 2));
        v_final_total := ROUND(v_taxable_amount + v_cgst + v_sgst + COALESCE(p_round_off, 0), 2);
    ELSE
        v_cgst := 0; v_sgst := 0;
        v_final_total := ROUND(v_taxable_amount + COALESCE(p_round_off, 0), 2);
    END IF;

    -- Validate Payments & Store Credit Bounds
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                IF v_payment.method = 'STORE_CREDIT' THEN
                    v_store_credit_paid := v_store_credit_paid + v_payment.amount;
                END IF;
                v_total_paid := v_total_paid + v_payment.amount;
            END IF;
        END LOOP;
    END IF;

    IF v_total_paid > v_final_total THEN
        RAISE EXCEPTION 'Total payment (₹%) cannot exceed invoice final total (₹%).', v_total_paid, v_final_total;
    END IF;

    IF v_store_credit_paid > 0 THEN
        IF v_customer.credit_balance < v_store_credit_paid THEN
            RAISE EXCEPTION 'Insufficient store credit balance (Available: ₹%, Requested: ₹%).',
                v_customer.credit_balance, v_store_credit_paid;
        END IF;

        UPDATE customers 
        SET credit_balance = credit_balance - v_store_credit_paid,
            updated_at = NOW()
        WHERE id = v_customer_id
        RETURNING credit_balance INTO v_customer.credit_balance;

        INSERT INTO customer_credit_ledger (
            customer_id, type, amount, balance_after, notes
        ) VALUES (
            v_customer_id, 'PAYMENT_APPLIED'::credit_movement_type, -v_store_credit_paid, 
            v_customer.credit_balance, 'Line Sale Redemption'
        );
    END IF;

    -- 5. Create Invoice (with notes and sanitized idempotency_key)
    v_invoice_number := 'INV-LS-' || to_char(NOW(), 'YYMMDD') || '-' || LPAD(FLOOR(random() * 1000)::text, 3, '0');

    INSERT INTO invoices (
        invoice_number, customer_id, line_staff_id, subtotal, discount_amount, round_off,
        gst_applied, cgst_amount, sgst_amount, final_total, notes, idempotency_key
    ) VALUES (
        v_invoice_number, v_customer_id, p_staff_id, v_subtotal, p_discount_amount, p_round_off,
        p_gst_applied, v_cgst, v_sgst, v_final_total, p_notes, v_idempotency_key
    ) RETURNING id INTO v_invoice_id;

    -- 6. Insert Items & Payments
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER, selling_price DECIMAL)
    LOOP
        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;

        v_pps := COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1);
        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_pps) + COALESCE(v_item.loose_quantity, 0);
        v_line_profit := (COALESCE(v_item.selling_price, v_variant.selling_price) - COALESCE(v_variant.cost_price, 0)) * v_total_pieces;

        INSERT INTO invoice_items (
            invoice_id, variant_id, quantity, sets_quantity, loose_quantity,
            selling_price_snapshot, cost_price_snapshot, profit_snapshot
        ) VALUES (
            v_invoice_id, v_item.variant_id, v_total_pieces,
            COALESCE(v_item.sets_quantity, 0), COALESCE(v_item.loose_quantity, 0),
            COALESCE(v_item.selling_price, v_variant.selling_price), COALESCE(v_variant.cost_price, 0), v_line_profit
        );
    END LOOP;

    -- Corrected to method instead of payment_method
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                INSERT INTO payments (invoice_id, customer_id, amount, method, notes)
                VALUES (v_invoice_id, v_customer_id, v_payment.amount, v_payment.method, 'Line Sale Payment');
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bill_line_staff_sales(UUID, JSONB, JSONB, DECIMAL, DECIMAL, TEXT, BOOLEAN, DECIMAL, DECIMAL, TEXT) TO authenticated, service_role;
