-- Migration: 0088_fix_remaining_p2_p3_issues.sql
-- Addresses:
-- 1. P2-12: Van Inventory check during product soft-delete, deadlock prevention (ORDER BY id FOR UPDATE), and RPC alias
-- 2. P2-06: Universal 6-digit collision-free invoice number generator with microsecond clock_timestamp fallback
-- 3. P2-06: Fully authoritative 13-parameter process_checkout retaining full cheque, anti-tampering, and reference_invoice_id logic
-- 4. P2-06: Explicit pre-drop of any rogue 9-parameter process_checkout overload (PGRST203 prevention)
-- 5. P2-06: Updated bill_line_staff_sales using generate_invoice_number('INV-LS', 6, NOW()) and reference_invoice_id
-- 6. P2-08: Zero-trust referential check against unpaid invoices in customer deactivation factoring in returns
-- 7. P2-02: Strict date range filtering for Tab 4 (monthly_sales) and Tab 6 (monthly_profit) in get_comprehensive_reports

-- ==============================================================================
-- 0. PREVENT PGRST203: Cleanly Drop Any Rogue Overload Signatures
-- ==============================================================================
DROP FUNCTION IF EXISTS public.process_checkout(UUID, JSONB, JSONB, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS process_checkout(UUID, JSONB, JSONB, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, TEXT, TIMESTAMPTZ);

-- ==============================================================================
-- 1. P2-12: Harden soft_delete_product with Concurrency Locks & Van Fleet Checks
-- ==============================================================================
CREATE OR REPLACE FUNCTION soft_delete_product(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_updated_rows INTEGER;
    v_variant RECORD;
    v_van_qty NUMERIC := 0;
    v_product_pps INTEGER := 1;
    v_pps INTEGER;
BEGIN
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; 
    END IF;
    
    IF p_product_id IS NULL THEN 
        RAISE EXCEPTION 'Product ID is required.'; 
    END IF;

    -- 1. Lock master products row first to prevent concurrent modifications
    SELECT pieces_per_set INTO v_product_pps 
    FROM products 
    WHERE id = p_product_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found.';
    END IF;

    -- 2. Guard: Check if active van inventory exists across any line sales van for this product
    SELECT COALESCE(SUM(quantity), 0) + COALESCE(SUM(sets_quantity), 0) INTO v_van_qty
    FROM line_van_inventory
    WHERE variant_id IN (SELECT id FROM variants WHERE product_id = p_product_id)
      AND (quantity > 0 OR sets_quantity > 0);

    IF v_van_qty > 0 THEN
        RAISE EXCEPTION 'Cannot delete product: % unit(s)/set(s) remain allocated across van fleet. Please unload or return van stock to the warehouse before deleting.', v_van_qty;
    END IF;

    -- 3. Deactivate Master Product
    UPDATE products 
    SET is_active = FALSE, updated_at = NOW() 
    WHERE id = p_product_id;
    
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows = 0 THEN
        RAISE EXCEPTION 'Product not found or already deleted.';
    END IF;

    -- 4. Lock variants deterministically (ORDER BY id FOR UPDATE) to prevent 40P01 deadlocks
    FOR v_variant IN 
        SELECT id, stock_quantity, stock_sets, pieces_per_set
        FROM variants 
        WHERE product_id = p_product_id AND is_active = TRUE
        ORDER BY id FOR UPDATE
    LOOP
        v_pps := COALESCE(v_variant.pieces_per_set, v_product_pps, 1);

        IF v_variant.stock_quantity <> 0 OR COALESCE(v_variant.stock_sets, 0) <> 0 THEN
            INSERT INTO stock_movements (
                variant_id, 
                type, 
                quantity_change, 
                sets_change, 
                loose_change, 
                notes
            )
            VALUES (
                v_variant.id, 
                'MANUAL_ADJUST'::stock_movement_type, 
                -v_variant.stock_quantity, 
                -COALESCE(v_variant.stock_sets, 0),
                -(v_variant.stock_quantity - (COALESCE(v_variant.stock_sets, 0) * v_pps)),
                'Product soft-deleted (Warehouse stock written off to zero)'
            );
        END IF;

        UPDATE variants 
        SET is_active = FALSE,
            stock_quantity = 0,
            stock_sets = 0,
            updated_at = NOW()
        WHERE id = v_variant.id;
    END LOOP;

    -- Clean up zero-quantity van allocation rows to eliminate orphan references
    DELETE FROM line_van_inventory
    WHERE variant_id IN (SELECT id FROM variants WHERE product_id = p_product_id)
      AND quantity <= 0 AND sets_quantity <= 0;

    RETURN jsonb_build_object('success', true, 'product_id', p_product_id);
END;
$$;

GRANT EXECUTE ON FUNCTION soft_delete_product(UUID) TO authenticated, service_role;

-- Backward-compatibility wrapper for delete_product_with_variants
CREATE OR REPLACE FUNCTION delete_product_with_variants(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN soft_delete_product(p_product_id);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_product_with_variants(UUID) TO authenticated, service_role;

-- ==============================================================================
-- 2. P2-08: Zero-Trust Customer Deactivation with Direct Invoice & Return Checks
-- ==============================================================================
CREATE OR REPLACE FUNCTION deactivate_customer(p_customer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_credit DECIMAL(10,2) := 0;
    v_dues DECIMAL(10,2) := 0;
    v_unpaid_count INTEGER := 0;
BEGIN
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; 
    END IF;
    
    IF p_customer_id IS NULL THEN 
        RAISE EXCEPTION 'Customer ID is required.'; 
    END IF;

    -- 1. Check Wallet Balance
    SELECT COALESCE(credit_balance, 0) INTO v_credit 
    FROM customers 
    WHERE id = p_customer_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found.';
    END IF;

    IF v_credit > 0 THEN
        RAISE EXCEPTION 'Cannot deactivate customer with an active store credit wallet balance of ₹%. Please refund or utilize wallet credit first.', v_credit;
    END IF;

    -- 2. Check Customer Metrics View Pending Dues
    SELECT COALESCE(pending_dues, 0) INTO v_dues
    FROM customer_metrics
    WHERE id = p_customer_id;

    IF v_dues > 0 THEN
        RAISE EXCEPTION 'Cannot deactivate customer with an outstanding debt balance of ₹%. Settle dues first.', v_dues;
    END IF;

    -- 3. Direct Referential Check against invoices, payments, and returns
    SELECT COUNT(inv.id) INTO v_unpaid_count
    FROM invoices inv
    LEFT JOIN (
        SELECT invoice_id, SUM(amount) AS total_paid
        FROM payments
        GROUP BY invoice_id
    ) p ON inv.id = p.invoice_id
    LEFT JOIN (
        SELECT invoice_id, SUM(total_refund_amount) AS total_refunds
        FROM returns
        GROUP BY invoice_id
    ) r ON inv.id = r.invoice_id
    WHERE inv.customer_id = p_customer_id
      AND inv.is_voided = FALSE
      AND inv.is_hidden = FALSE
      AND COALESCE(p.total_paid, 0) < GREATEST(0, inv.final_total - COALESCE(r.total_refunds, 0));

    IF v_unpaid_count > 0 THEN
        RAISE EXCEPTION 'Cannot deactivate customer: % unpaid or partially paid invoice(s) exist. Settle all open bills first.', v_unpaid_count;
    END IF;

    -- Deactivate
    UPDATE customers 
    SET is_active = FALSE, 
        updated_at = NOW() 
    WHERE id = p_customer_id;

    RETURN jsonb_build_object('success', true, 'customer_id', p_customer_id);
END;
$$;

GRANT EXECUTE ON FUNCTION deactivate_customer(UUID) TO authenticated, service_role;

-- ==============================================================================
-- 3. P2-06: Universal Collision-Free Invoice Number Generator
-- ==============================================================================
CREATE OR REPLACE FUNCTION generate_invoice_number(
    p_prefix TEXT DEFAULT 'INV',
    p_digits INTEGER DEFAULT 6,
    p_created_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_num TEXT;
    v_min INTEGER := (10 ^ (p_digits - 1))::INTEGER;
    v_max INTEGER := ((10 ^ p_digits) - 1)::INTEGER;
    v_attempts INTEGER := 0;
BEGIN
    LOOP
        v_attempts := v_attempts + 1;
        IF v_attempts <= 10 THEN
            v_num := p_prefix || '-' || to_char(p_created_at, 'YYMM') || '-' || LPAD(FLOOR(random() * (v_max - v_min + 1) + v_min)::text, p_digits, '0');
        ELSE
            -- Dynamic clock_timestamp() with microsecond precision ensures zero collisions under concurrent load
            v_num := p_prefix || '-' || to_char(clock_timestamp(), 'YYMMDD-HH24MISSUS-') || LPAD(FLOOR(random() * 10000)::text, 4, '0');
        END IF;

        IF NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = v_num) THEN
            RETURN v_num;
        END IF;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_invoice_number(TEXT, INTEGER, TIMESTAMPTZ) TO authenticated, service_role;

-- ==============================================================================
-- 4. P2-06: Authoritative 13-Parameter process_checkout
-- ==============================================================================
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

    -- 10. Generate 6-Digit Collision-Free Invoice Number via Universal Generator
    v_invoice_number := generate_invoice_number('INV', 6, v_invoice_created_at);

    INSERT INTO invoices (
        invoice_number, customer_id, subtotal, discount_amount, round_off,
        gst_applied, cgst_amount, sgst_amount, final_total, created_at, updated_at, idempotency_key
    ) VALUES (
        v_invoice_number, p_customer_id, v_calculated_subtotal, p_discount_amount, p_round_off,
        p_gst_applied, v_expected_cgst, v_expected_sgst, p_final_total, v_invoice_created_at, v_invoice_created_at, p_idempotency_key
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

GRANT EXECUTE ON FUNCTION public.process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB, TEXT) TO authenticated, service_role;

-- ==============================================================================
-- 5. P2-06: Updated bill_line_staff_sales with generate_invoice_number
-- ==============================================================================
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

        IF v_van_item.sets_quantity < COALESCE(v_item.sets_quantity, 0) THEN
            RAISE EXCEPTION 'Insufficient van sets for variant %. Available on van: %, Requested: %',
                v_variant.name, COALESCE(v_van_item.sets_quantity, 0), v_item.sets_quantity;
        END IF;

        v_subtotal := v_subtotal + ROUND(v_total_pieces * COALESCE(v_item.selling_price, v_variant.selling_price), 2);

        -- Deduct from van inventory
        UPDATE line_van_inventory
        SET quantity = quantity - v_total_pieces,
            sets_quantity = GREATEST(0, sets_quantity - COALESCE(v_item.sets_quantity, 0)),
            updated_at = NOW()
        WHERE staff_id = p_staff_id AND variant_id = v_item.variant_id;

        INSERT INTO line_stock_movements (staff_id, variant_id, movement_type, sets_quantity, quantity, notes)
        VALUES (
            p_staff_id, v_item.variant_id, 'SALE_DEDUCT', 
            COALESCE(v_item.sets_quantity, 0), v_total_pieces, 
            'Van Sale Dispatch'
        );
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

    -- 5. Process Store Credit Bounds
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount < 0 THEN RAISE EXCEPTION 'Payment amount cannot be negative'; END IF;
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

    -- 6. Generate 6-Digit Collision-Free Invoice Number via Universal Generator
    v_invoice_number := generate_invoice_number('INV-LS', 6, NOW());

    INSERT INTO invoices (
        invoice_number, customer_id, line_staff_id, subtotal, discount_amount, round_off,
        gst_applied, cgst_amount, sgst_amount, final_total, notes, idempotency_key
    ) VALUES (
        v_invoice_number, v_customer_id, p_staff_id, v_subtotal, p_discount_amount, p_round_off,
        p_gst_applied, v_cgst, v_sgst, v_final_total, p_notes, v_idempotency_key
    ) RETURNING id INTO v_invoice_id;

    -- Settle Store Credit with reference_invoice_id
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
            customer_id, type, amount, balance_after, reference_invoice_id, notes
        ) VALUES (
            v_customer_id, 'PAYMENT_APPLIED'::credit_movement_type, -v_store_credit_paid, 
            v_customer.credit_balance, v_invoice_id, 'Line Sale Redemption #' || v_invoice_number
        );
    END IF;

    -- 7. Insert Line Items & Payments
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

-- Compatibility alias for create_line_sale
CREATE OR REPLACE FUNCTION public.create_line_sale(
    p_staff_id UUID,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_items JSONB,
    p_payments JSONB,
    p_discount_amount DECIMAL DEFAULT 0,
    p_round_off DECIMAL DEFAULT 0,
    p_gst_applied BOOLEAN DEFAULT FALSE,
    p_notes TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN bill_line_staff_sales(
        p_staff_id, p_items, p_payments, p_discount_amount, p_round_off,
        p_notes, p_gst_applied, 0.00, 0.00, p_idempotency_key
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_line_sale(UUID, TEXT, TEXT, JSONB, JSONB, DECIMAL, DECIMAL, BOOLEAN, TEXT, TEXT) TO authenticated, service_role;

-- ==============================================================================
-- 6. P2-02: Strict Filtered Date Range for Tab 4 & Tab 6 in get_comprehensive_reports
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_comprehensive_reports(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_total_sales DECIMAL(12, 2) := 0.00;
    v_total_returns DECIMAL(12, 2) := 0.00;
    v_pending_cheques_total DECIMAL(12, 2) := 0.00;
    v_total_discount DECIMAL(12, 2) := 0.00;
    v_raw_profit DECIMAL(12, 2) := 0.00;
    v_returned_profit DECIMAL(12, 2) := 0.00;
    v_gross_profit DECIMAL(12, 2) := 0.00;
    v_total_collected DECIMAL(12, 2) := 0.00;
    v_cash_collected DECIMAL(12, 2) := 0.00;
    v_upi_collected DECIMAL(12, 2) := 0.00;
    v_bank_collected DECIMAL(12, 2) := 0.00;
    v_store_credit_collected DECIMAL(12, 2) := 0.00;
    v_total_expenses DECIMAL(12, 2) := 0.00;
    v_net_profit DECIMAL(12, 2) := 0.00;
    v_outstanding_dues DECIMAL(12, 2) := 0.00;
    v_invoice_count INTEGER := 0;
    v_avg_invoice_value DECIMAL(12, 2) := 0.00;
    v_stock_at_cost DECIMAL(12, 2) := 0.00;

    v_sales_trend JSONB := '[]'::jsonb;
    v_invoices JSONB := '[]'::jsonb;
    v_expenses_list JSONB := '[]'::jsonb;
    v_daily_sales JSONB := '[]'::jsonb;
    v_monthly_sales JSONB := '[]'::jsonb;
    v_credits JSONB := '[]'::jsonb;
    v_monthly_profit JSONB := '[]'::jsonb;
    v_profit_by_product JSONB := '[]'::jsonb;
    v_by_product JSONB := '[]'::jsonb;
    v_by_category JSONB := '[]'::jsonb;
    v_stock_cost JSONB := '[]'::jsonb;
    v_stock_moves JSONB := '[]'::jsonb;
    v_stock_by_category JSONB := '[]'::jsonb;

    v_cutoff_hour INTEGER := 6;
    v_timezone TEXT := 'Asia/Kolkata';
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
        RAISE EXCEPTION 'Invalid date range provided';
    END IF;

    -- Fetch store configuration
    SELECT 
        COALESCE(business_day_start_hour, 6),
        COALESCE(timezone, 'Asia/Kolkata')
    INTO v_cutoff_hour, v_timezone
    FROM store_settings
    LIMIT 1;

    -- 1. Sales & Invoices in period
    SELECT 
        COALESCE(SUM(inv.final_total), 0.00),
        COALESCE(SUM(inv.discount_amount), 0.00),
        COUNT(inv.id)
    INTO v_total_sales, v_total_discount, v_invoice_count
    FROM invoices inv
    WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
      AND inv.is_voided = FALSE AND inv.is_hidden = FALSE;

    IF v_invoice_count > 0 THEN
        v_avg_invoice_value := ROUND(v_total_sales / v_invoice_count, 2);
    ELSE
        v_avg_invoice_value := 0.00;
    END IF;

    -- 2. Returns in period
    SELECT COALESCE(SUM(r.total_refund_amount), 0.00)
    INTO v_total_returns
    FROM returns r
    JOIN invoices i ON r.invoice_id = i.id
    WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
      AND i.is_voided = FALSE AND i.is_hidden = FALSE;

    -- 3. Profit calculations in period
    SELECT COALESCE(SUM(profit_snapshot), 0.00)
    INTO v_raw_profit
    FROM invoice_items ii
    JOIN invoices inv ON ii.invoice_id = inv.id
    WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
      AND inv.is_voided = FALSE AND inv.is_hidden = FALSE;

    SELECT COALESCE(SUM(r.quantity * (ii.selling_price_snapshot - ii.cost_price_snapshot)), 0.00)
    INTO v_returned_profit
    FROM returns r
    JOIN invoice_items ii ON r.invoice_item_id = ii.id
    JOIN invoices inv ON r.invoice_id = inv.id
    WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
      AND inv.is_voided = FALSE AND inv.is_hidden = FALSE;

    v_gross_profit := (v_raw_profit - v_returned_profit) - v_total_discount;

    -- 4. Payments collected in period (STORE_CREDIT excluded from v_total_collected per 0083/0087)
    SELECT 
        COALESCE(SUM(p.amount) FILTER (WHERE p.method IS DISTINCT FROM 'STORE_CREDIT'), 0.00),
        COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'CASH'), 0.00),
        COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'UPI'), 0.00),
        COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'BANK'), 0.00),
        COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'STORE_CREDIT'), 0.00)
    INTO 
        v_total_collected,
        v_cash_collected,
        v_upi_collected,
        v_bank_collected,
        v_store_credit_collected
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
      AND (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE));

    -- 5. Pending Uncleared Cheques
    SELECT COALESCE(SUM(cc.amount), 0.00)
    INTO v_pending_cheques_total
    FROM customer_cheques cc
    LEFT JOIN invoices inv ON cc.invoice_id = inv.id
    WHERE cc.status = 'PENDING'
      AND (cc.invoice_id IS NULL OR (inv.is_voided = FALSE AND inv.is_hidden = FALSE));

    -- 6. Expenses in period
    SELECT COALESCE(SUM(e.amount), 0.00)
    INTO v_total_expenses
    FROM expenses e
    WHERE e.created_at >= p_start_date AND e.created_at <= p_end_date
      AND e.is_voided = FALSE AND e.is_hidden = FALSE;

    v_net_profit := v_gross_profit - v_total_expenses;

    -- 7. Outstanding Customer Dues
    SELECT COALESCE(SUM(pending_dues), 0.00)
    INTO v_outstanding_dues
    FROM customer_metrics
    WHERE is_active = TRUE AND pending_dues > 0;

    -- 8. Current Stock at Cost (Warehouse + Van Fleet Inventory)
    SELECT COALESCE(SUM((v.stock_quantity + COALESCE(lvi.van_qty, 0)) * v.cost_price), 0.00)
    INTO v_stock_at_cost
    FROM variants v
    JOIN products p ON v.product_id = p.id
    LEFT JOIN (
        SELECT variant_id, SUM(quantity) AS van_qty
        FROM line_van_inventory
        GROUP BY variant_id
    ) lvi ON lvi.variant_id = v.id
    WHERE v.is_active = TRUE AND p.is_active = TRUE;

    -- Sales Trend
    WITH invoice_days AS (
        SELECT 
            ((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(inv.final_total), 0.00) AS sales
        FROM invoices inv
        WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
          AND inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1
    ),
    return_days AS (
        SELECT 
            ((r.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(r.total_refund_amount), 0.00) AS returns
        FROM returns r
        JOIN invoices i ON r.invoice_id = i.id
        WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
          AND i.is_voided = FALSE AND i.is_hidden = FALSE
        GROUP BY 1
    ),
    payment_days AS (
        SELECT 
            ((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(p.amount) FILTER (WHERE p.method IS DISTINCT FROM 'STORE_CREDIT'), 0.00) AS collected
        FROM payments p
        LEFT JOIN invoices i ON p.invoice_id = i.id
        WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
          AND (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE))
        GROUP BY 1
    ),
    all_days AS (
        SELECT b_day FROM invoice_days UNION
        SELECT b_day FROM return_days UNION
        SELECT b_day FROM payment_days
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'label', to_char(ad.b_day, 'DD Mon'),
            'date', ad.b_day::TEXT,
            'sales', GREATEST(0.00, COALESCE(id.sales, 0.00) - COALESCE(rd.returns, 0.00)),
            'collected', COALESCE(pd.collected, 0.00)
        ) ORDER BY ad.b_day ASC
    ), '[]'::jsonb)
    INTO v_sales_trend
    FROM all_days ad
    LEFT JOIN invoice_days id ON ad.b_day = id.b_day
    LEFT JOIN return_days rd ON ad.b_day = rd.b_day
    LEFT JOIN payment_days pd ON ad.b_day = pd.b_day;

    -- Tab 1: Invoices List
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', sub.id,
            'invoice_number', sub.invoice_number,
            'created_at', sub.created_at,
            'customer_name', sub.customer_name,
            'subtotal', sub.subtotal,
            'discount_amount', sub.discount_amount,
            'final_total', sub.final_total,
            'paid_amount', sub.paid_amount,
            'primary_method', sub.primary_method,
            'status', sub.status,
            'is_voided', sub.is_voided,
            'is_line_sale', sub.is_line_sale
        ) ORDER BY sub.created_at DESC
    ), '[]'::jsonb)
    INTO v_invoices
    FROM (
        SELECT 
            inv.id,
            inv.invoice_number,
            inv.created_at,
            COALESCE(c.name, 'Walk-in Customer') AS customer_name,
            inv.subtotal,
            inv.discount_amount,
            inv.final_total,
            COALESCE(SUM(p.amount), 0.00) AS paid_amount,
            COALESCE(MIN(p.method::TEXT), 'UNPAID') AS primary_method,
            CASE 
                WHEN inv.is_voided THEN 'Void'
                WHEN COALESCE(SUM(p.amount), 0.00) >= inv.final_total THEN 'Paid'
                WHEN COALESCE(SUM(p.amount), 0.00) > 0 THEN 'Partial'
                ELSE 'Unpaid'
            END AS status,
            inv.is_voided,
            (inv.line_staff_id IS NOT NULL) AS is_line_sale
        FROM invoices inv
        LEFT JOIN customers c ON inv.customer_id = c.id
        LEFT JOIN payments p ON inv.id = p.invoice_id
        WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
          AND inv.is_hidden = FALSE
        GROUP BY inv.id, c.name
        ORDER BY inv.created_at DESC
        LIMIT 500
    ) sub;

    -- Tab 2: Expenses List
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', e.id, 'category', e.category, 'amount', e.amount, 'notes', e.notes,
            'payment_method', e.payment_method, 'created_at', e.created_at, 'is_voided', e.is_voided
        ) ORDER BY e.created_at DESC
    ), '[]'::jsonb)
    INTO v_expenses_list
    FROM expenses e
    WHERE e.created_at >= p_start_date AND e.created_at <= p_end_date
      AND e.is_hidden = FALSE
    LIMIT 500;

    -- Tab 3: Daily Sales
    WITH invoice_days AS (
        SELECT 
            ((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(inv.final_total), 0.00) AS gross_sales,
            COALESCE(SUM(inv.discount_amount), 0.00) AS discount,
            COUNT(inv.id) AS inv_count
        FROM invoices inv
        WHERE inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1
    ),
    return_days AS (
        SELECT 
            ((r.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(r.total_refund_amount), 0.00) AS returns
        FROM returns r
        JOIN invoices i ON r.invoice_id = i.id
        WHERE i.is_voided = FALSE AND i.is_hidden = FALSE
        GROUP BY 1
    ),
    payment_days AS (
        SELECT 
            ((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(p.amount) FILTER (WHERE p.method IS DISTINCT FROM 'STORE_CREDIT'), 0.00) AS collected
        FROM payments p
        LEFT JOIN invoices i ON p.invoice_id = i.id
        WHERE (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE))
        GROUP BY 1
    ),
    all_days AS (
        SELECT b_day FROM invoice_days UNION
        SELECT b_day FROM return_days UNION
        SELECT b_day FROM payment_days
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'date', to_char(ad.b_day, 'DD Mon YYYY'),
            'raw_date', ad.b_day::TEXT,
            'gross_sales', COALESCE(id.gross_sales, 0.00),
            'net_sales', GREATEST(0.00, COALESCE(id.gross_sales, 0.00) - COALESCE(rd.returns, 0.00)),
            'discount', COALESCE(id.discount, 0.00),
            'invoice_count', COALESCE(id.inv_count, 0),
            'collected', COALESCE(pd.collected, 0.00)
        ) ORDER BY ad.b_day DESC
    ), '[]'::jsonb)
    INTO v_daily_sales
    FROM (
        SELECT ad.b_day
        FROM all_days ad
        WHERE ad.b_day >= (((p_start_date AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE)
          AND ad.b_day <= (((p_end_date AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE)
        ORDER BY ad.b_day DESC
        LIMIT 60
    ) ad
    LEFT JOIN invoice_days id ON ad.b_day = id.b_day
    LEFT JOIN return_days rd ON ad.b_day = rd.b_day
    LEFT JOIN payment_days pd ON ad.b_day = pd.b_day;

    -- Tab 4: Monthly Sales (Strict Filter on p_start_date and p_end_date)
    WITH invoice_months AS (
        SELECT 
            to_char(((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            to_char(((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'Mon YYYY') AS b_month_label,
            COALESCE(SUM(inv.final_total), 0.00) AS gross_sales,
            COALESCE(SUM(inv.discount_amount), 0.00) AS discount,
            COUNT(inv.id) AS inv_count
        FROM invoices inv
        WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
          AND inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1, 2
    ),
    return_months AS (
        SELECT 
            to_char(((r.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            COALESCE(SUM(r.total_refund_amount), 0.00) AS returns
        FROM returns r
        JOIN invoices i ON r.invoice_id = i.id
        WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
          AND (r.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE))
        GROUP BY 1
    ),
    payment_months AS (
        SELECT 
            to_char(((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            COALESCE(SUM(p.amount) FILTER (WHERE p.method IS DISTINCT FROM 'STORE_CREDIT'), 0.00) AS collected
        FROM payments p
        LEFT JOIN invoices i ON p.invoice_id = i.id
        WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
          AND (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE))
        GROUP BY 1
    ),
    all_months AS (
        SELECT b_month_key FROM invoice_months UNION
        SELECT b_month_key FROM return_months UNION
        SELECT b_month_key FROM payment_months
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', ms.b_month_label,
            'gross_sales', ms.gross_sales,
            'net_sales', ms.net_sales,
            'discount', ms.discount,
            'invoice_count', ms.invoice_count,
            'collected', ms.collected
        ) ORDER BY ms.b_month_key DESC
    ), '[]'::jsonb)
    INTO v_monthly_sales
    FROM (
        SELECT 
            am.b_month_key,
            COALESCE(im.b_month_label, to_char(TO_DATE(am.b_month_key || '-01', 'YYYY-MM-DD'), 'Mon YYYY')) AS b_month_label,
            COALESCE(im.gross_sales, 0.00) AS gross_sales,
            GREATEST(0.00, COALESCE(im.gross_sales, 0.00) - COALESCE(rm.returns, 0.00)) AS net_sales,
            COALESCE(im.discount, 0.00) AS discount,
            COALESCE(im.inv_count, 0) AS invoice_count,
            COALESCE(pm.collected, 0.00) AS collected
        FROM all_months am
        LEFT JOIN invoice_months im ON am.b_month_key = im.b_month_key
        LEFT JOIN return_months rm ON am.b_month_key = rm.b_month_key
        LEFT JOIN payment_months pm ON am.b_month_key = pm.b_month_key
        ORDER BY am.b_month_key DESC
        LIMIT 60
    ) ms;

    -- Tab 5: Customer Credits
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'customer_id', cm.id, 'customer_name', cm.name, 'phone', cm.phone,
            'total_spend', cm.total_spend, 'total_paid', cm.total_paid, 'pending_dues', cm.pending_dues
        ) ORDER BY cm.pending_dues DESC
    ), '[]'::jsonb)
    INTO v_credits
    FROM customer_metrics cm WHERE cm.is_active = TRUE AND cm.pending_dues > 0;

    -- Tab 6: Monthly Profit (Strict Filter on p_start_date and p_end_date)
    WITH invoice_items_per_inv AS (
        SELECT invoice_id, COALESCE(SUM(quantity * cost_price_snapshot), 0.00) AS cogs, COALESCE(SUM(profit_snapshot), 0.00) AS raw_profit
        FROM invoice_items GROUP BY invoice_id
    ),
    invoice_months AS (
        SELECT 
            to_char(((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            to_char(((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'Mon YYYY') AS b_month_label,
            COALESCE(SUM(inv.final_total), 0.00) AS sales,
            COALESCE(SUM(inv.discount_amount), 0.00) AS discount,
            COALESCE(SUM(ii.cogs), 0.00) AS cogs,
            COALESCE(SUM(ii.raw_profit), 0.00) AS raw_profit
        FROM invoices inv
        LEFT JOIN invoice_items_per_inv ii ON ii.invoice_id = inv.id
        WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
          AND inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1, 2
    ),
    return_months AS (
        SELECT 
            to_char(((r.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            COALESCE(SUM(r.total_refund_amount), 0.00) AS ret_sales,
            COALESCE(SUM(r.quantity * ii.cost_price_snapshot), 0.00) AS ret_cogs,
            COALESCE(SUM(r.quantity * (ii.selling_price_snapshot - ii.cost_price_snapshot)), 0.00) AS ret_profit
        FROM returns r
        JOIN invoice_items ii ON r.invoice_item_id = ii.id
        JOIN invoices inv ON r.invoice_id = inv.id
        WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
          AND inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1
    ),
    expense_months AS (
        SELECT 
            to_char(((e.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            COALESCE(SUM(e.amount), 0.00) AS expenses
        FROM expenses e
        WHERE e.created_at >= p_start_date AND e.created_at <= p_end_date
          AND e.is_voided = FALSE AND e.is_hidden = FALSE
        GROUP BY 1
    ),
    all_months AS (
        SELECT b_month_key FROM invoice_months UNION
        SELECT b_month_key FROM return_months UNION
        SELECT b_month_key FROM expense_months
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', mp.b_month_label,
            'sales', mp.sales,
            'cogs', mp.cogs,
            'gross_profit', mp.gross_profit,
            'expenses', mp.expenses,
            'net_profit', mp.net_profit
        ) ORDER BY mp.b_month_key DESC
    ), '[]'::jsonb)
    INTO v_monthly_profit
    FROM (
        SELECT 
            am.b_month_key,
            COALESCE(im.b_month_label, to_char(TO_DATE(am.b_month_key || '-01', 'YYYY-MM-DD'), 'Mon YYYY')) AS b_month_label,
            GREATEST(0.00, COALESCE(im.sales, 0.00) - COALESCE(rm.ret_sales, 0.00)) AS sales,
            GREATEST(0.00, COALESCE(im.cogs, 0.00) - COALESCE(rm.ret_cogs, 0.00)) AS cogs,
            ((COALESCE(im.raw_profit, 0.00) - COALESCE(rm.ret_profit, 0.00)) - COALESCE(im.discount, 0.00)) AS gross_profit,
            COALESCE(em.expenses, 0.00) AS expenses,
            (((COALESCE(im.raw_profit, 0.00) - COALESCE(rm.ret_profit, 0.00)) - COALESCE(im.discount, 0.00)) - COALESCE(em.expenses, 0.00)) AS net_profit
        FROM all_months am
        LEFT JOIN invoice_months im ON am.b_month_key = im.b_month_key
        LEFT JOIN return_months rm ON am.b_month_key = rm.b_month_key
        LEFT JOIN expense_months em ON am.b_month_key = em.b_month_key
        ORDER BY am.b_month_key DESC
        LIMIT 60
    ) mp;

    -- Tab 7: Profit by Product
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_id', pp.prod_id, 'variant_id', pp.var_id, 'product_name', pp.prod_name, 'variant_name', pp.var_name,
            'quantity_sold', pp.qty, 'revenue', pp.rev, 'cogs', pp.cogs, 'profit', pp.prof,
            'margin_percent', CASE WHEN pp.rev > 0 THEN ROUND((pp.prof / pp.rev) * 100, 1) ELSE 0.0 END
        ) ORDER BY pp.prof DESC
    ), '[]'::jsonb)
    INTO v_profit_by_product
    FROM (
        SELECT 
            p_id AS prod_id, v_id AS var_id, p_name AS prod_name, v_name AS var_name,
            SUM(qty) AS qty, SUM(rev) AS rev, SUM(cogs) AS cogs, SUM(prof) AS prof
        FROM (
            SELECT 
                p.id AS p_id, v.id AS v_id, p.name AS p_name, v.name AS v_name,
                ii.quantity AS qty,
                (ii.quantity * ii.selling_price_snapshot) AS rev,
                (ii.quantity * ii.cost_price_snapshot) AS cogs,
                ii.profit_snapshot AS prof
            FROM invoice_items ii
            JOIN invoices i ON ii.invoice_id = i.id
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
            
            UNION ALL
            
            SELECT 
                p.id AS p_id, v.id AS v_id, p.name AS p_name, v.name AS v_name,
                -r.quantity AS qty,
                -r.total_refund_amount AS rev,
                -(r.quantity * ii.cost_price_snapshot) AS cogs,
                -(r.quantity * (ii.selling_price_snapshot - ii.cost_price_snapshot)) AS prof
            FROM returns r
            JOIN invoice_items ii ON r.invoice_item_id = ii.id
            JOIN invoices i ON r.invoice_id = i.id
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
        ) combined
        GROUP BY p_id, v_id, p_name, v_name
    ) pp;

    -- Tab 8: Top Products by Volume
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_id', tp.p_id, 'product_name', tp.p_name, 'quantity_sold', tp.tot_qty, 'total_sales', tp.tot_sales
        ) ORDER BY tp.tot_qty DESC
    ), '[]'::jsonb)
    INTO v_by_product
    FROM (
        SELECT p_id, p_name, SUM(qty) AS tot_qty, SUM(rev) AS tot_sales
        FROM (
            SELECT 
                p.id AS p_id, p.name AS p_name, ii.quantity AS qty, (ii.quantity * ii.selling_price_snapshot) AS rev
            FROM invoice_items ii
            JOIN invoices i ON ii.invoice_id = i.id
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
            UNION ALL
            SELECT 
                p.id AS p_id, p.name AS p_name, -r.quantity AS qty, -r.total_refund_amount AS rev
            FROM returns r
            JOIN invoice_items ii ON r.invoice_item_id = ii.id
            JOIN invoices i ON r.invoice_id = i.id
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
        ) combined
        GROUP BY p_id, p_name
        ORDER BY tot_qty DESC
        LIMIT 50
    ) tp;

    -- Tab 9: Sales by Category
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'category_name', tc.c_name, 'quantity_sold', tc.tot_qty, 'total_sales', tc.tot_sales, 'total_profit', tc.tot_prof
        ) ORDER BY tc.tot_sales DESC
    ), '[]'::jsonb)
    INTO v_by_category
    FROM (
        SELECT c_name, SUM(qty) AS tot_qty, SUM(rev) AS tot_sales, SUM(prof) AS tot_prof
        FROM (
            SELECT 
                COALESCE(c.name, 'Uncategorized') AS c_name, ii.quantity AS qty,
                (ii.quantity * ii.selling_price_snapshot) AS rev, ii.profit_snapshot AS prof
            FROM invoice_items ii
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            JOIN invoices i ON ii.invoice_id = i.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
            UNION ALL
            SELECT 
                COALESCE(c.name, 'Uncategorized') AS c_name, -r.quantity AS qty,
                -r.total_refund_amount AS rev, -(r.quantity * (ii.selling_price_snapshot - ii.cost_price_snapshot)) AS prof
            FROM returns r
            JOIN invoice_items ii ON r.invoice_item_id = ii.id
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            JOIN invoices i ON r.invoice_id = i.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
        ) combined
        GROUP BY c_name
    ) tc;

    -- Tab 10: Stock Cost Valuation (Warehouse + Van Fleet Inventory)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_id', p.id, 'variant_id', v.id, 'product_name', p.name, 'variant_name', v.name,
            'barcode', v.barcode, 
            'stock_quantity', (v.stock_quantity + COALESCE(lvi.van_qty, 0)), 
            'cost_price', v.cost_price,
            'total_cost', ((v.stock_quantity + COALESCE(lvi.van_qty, 0)) * v.cost_price)
        ) ORDER BY ((v.stock_quantity + COALESCE(lvi.van_qty, 0)) * v.cost_price) DESC
    ), '[]'::jsonb)
    INTO v_stock_cost
    FROM variants v
    JOIN products p ON v.product_id = p.id
    LEFT JOIN (
        SELECT variant_id, SUM(quantity) AS van_qty
        FROM line_van_inventory
        GROUP BY variant_id
    ) lvi ON lvi.variant_id = v.id
    WHERE v.is_active = TRUE AND p.is_active = TRUE;

    -- Tab 11: Stock Movements in Period
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', sub.id, 'created_at', sub.created_at, 'product_name', sub.p_name, 'variant_name', sub.v_name,
            'type', sub.type, 'quantity_change', sub.quantity_change, 'notes', sub.notes
        ) ORDER BY sub.created_at DESC
    ), '[]'::jsonb)
    INTO v_stock_moves
    FROM (
        SELECT sm.id, sm.created_at, p.name AS p_name, v.name AS v_name, sm.type, sm.quantity_change, sm.notes
        FROM stock_movements sm
        JOIN variants v ON sm.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        WHERE sm.created_at >= p_start_date AND sm.created_at <= p_end_date
        ORDER BY sm.created_at DESC
        LIMIT 500
    ) sub;

    -- Tab 12: Stock By Category (Warehouse + Van Fleet Inventory)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'category_id', sbc.category_id, 'category_name', sbc.category_name, 'total_pieces', sbc.tot_pieces, 'total_valuation', sbc.tot_val
        ) ORDER BY sbc.tot_val DESC
    ), '[]'::jsonb)
    INTO v_stock_by_category
    FROM (
        SELECT 
            COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::UUID) AS category_id,
            COALESCE(c.name, 'Uncategorized') AS category_name,
            COALESCE(SUM(v.stock_quantity + COALESCE(lvi.van_qty, 0)), 0) AS tot_pieces,
            COALESCE(SUM((v.stock_quantity + COALESCE(lvi.van_qty, 0)) * v.cost_price), 0.00) AS tot_val
        FROM variants v
        JOIN products p ON v.product_id = p.id
        LEFT JOIN (
            SELECT variant_id, SUM(quantity) AS van_qty
            FROM line_van_inventory
            GROUP BY variant_id
        ) lvi ON lvi.variant_id = v.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE v.is_active = TRUE AND p.is_active = TRUE
        GROUP BY c.id, c.name
    ) sbc;

    RETURN jsonb_build_object(
        'total_sales', v_total_sales,
        'total_returns', v_total_returns,
        'pending_cheques_total', v_pending_cheques_total,
        'total_discount', v_total_discount,
        'collected', v_total_collected,
        'outstanding_dues', v_outstanding_dues,
        'invoice_count', v_invoice_count,
        'avg_invoice_value', v_avg_invoice_value,
        'expenses', v_total_expenses,
        'total_expenses', v_total_expenses,
        'gross_profit', v_gross_profit,
        'net_profit', v_net_profit,
        'stock_at_cost', v_stock_at_cost,
        'payment_breakdown', jsonb_build_object(
            'total_collected', v_total_collected,
            'cash_amount', v_cash_collected,
            'cash_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_cash_collected / v_total_collected) * 100, 1) ELSE 0.0 END,
            'upi_amount', v_upi_collected,
            'upi_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_upi_collected / v_total_collected) * 100, 1) ELSE 0.0 END,
            'bank_amount', v_bank_collected,
            'bank_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_bank_collected / v_total_collected) * 100, 1) ELSE 0.0 END,
            'store_credit_amount', v_store_credit_collected,
            'store_credit_percent', CASE WHEN (v_total_collected + v_store_credit_collected) > 0 THEN ROUND((v_store_credit_collected / (v_total_collected + v_store_credit_collected)) * 100, 1) ELSE 0.0 END,
            'pending_cheques_amount', v_pending_cheques_total
        ),
        'sales_trend', v_sales_trend,
        'invoices', v_invoices,
        'expenses_list', v_expenses_list,
        'daily_sales', v_daily_sales,
        'monthly_sales', v_monthly_sales,
        'credits', v_credits,
        'monthly_profit', v_monthly_profit,
        'profit_by_product', v_profit_by_product,
        'by_product', v_by_product,
        'by_category', v_by_category,
        'stock_cost', v_stock_cost,
        'stock_moves', v_stock_moves,
        'stock_by_category', v_stock_by_category
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_comprehensive_reports(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
