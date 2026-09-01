-- Migration: 0078_harden_line_staff_customer_link.sql
-- Hardens line staff customer account auto-provisioning with deterministic uniqueness and complete audit integrity.

CREATE OR REPLACE FUNCTION bill_line_staff_sales(
    p_staff_id UUID,
    p_items JSONB,
    p_payments JSONB DEFAULT '[]'::jsonb,
    p_discount_amount DECIMAL DEFAULT 0.00,
    p_round_off DECIMAL DEFAULT 0.00,
    p_notes TEXT DEFAULT NULL
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
    v_final_total DECIMAL(10,2) := 0;
    v_total_paid DECIMAL(10,2) := 0;
    v_store_credit_paid DECIMAL(10,2) := 0;
    v_new_credit_bal DECIMAL(10,2) := 0;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_year TEXT := TO_CHAR(NOW(), 'YYYY');
    v_retries INTEGER := 0;
    v_customer_name TEXT;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_staff_id IS NULL THEN RAISE EXCEPTION 'Staff ID is required.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Sold items list cannot be empty.'; END IF;

    IF COALESCE(p_discount_amount, 0) < 0 OR COALESCE(p_round_off, 0) < -50.00 OR COALESCE(p_round_off, 0) > 50.00 THEN
        RAISE EXCEPTION 'Invalid discount or round-off bounds.';
    END IF;

    -- Duplicate variants guard
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in sold items. Please consolidate quantities.';
    END IF;

    -- 1. Lock Staff
    SELECT * INTO v_staff FROM line_staff WHERE id = p_staff_id AND is_active = TRUE FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active line staff member not found.'; END IF;

    -- Resolve or create customer account for linesman with deterministic uniqueness
    IF v_staff.customer_id IS NOT NULL THEN
        SELECT * INTO v_customer FROM customers WHERE id = v_staff.customer_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Linked customer account not found.'; END IF;
        v_customer_id := v_customer.id;
    ELSE
        -- Query existing by phone if available
        IF v_staff.phone IS NOT NULL AND trim(v_staff.phone) <> '' THEN
            SELECT * INTO v_customer FROM customers WHERE phone = trim(v_staff.phone) FOR UPDATE;
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
        END IF;

        UPDATE line_staff SET customer_id = v_customer_id WHERE id = p_staff_id;
    END IF;

    -- 2. Deterministic Lock on Van Inventory rows
    PERFORM 1 FROM line_van_inventory lvi
    WHERE lvi.staff_id = p_staff_id 
      AND lvi.variant_id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x)
    ORDER BY lvi.variant_id FOR UPDATE;

    -- 3. Calculate Subtotal & Deduct Sold Items from Line Van Inventory
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID,
        sets_quantity INTEGER,
        loose_quantity INTEGER,
        selling_price DECIMAL
    )
    LOOP
        IF COALESCE(v_item.sets_quantity, 0) < 0 OR COALESCE(v_item.loose_quantity, 0) < 0 THEN
            RAISE EXCEPTION 'Sold quantities cannot be negative.';
        END IF;

        SELECT v.*, COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps
        INTO v_variant
        FROM variants v
        JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;

        IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found: %', v_item.variant_id; END IF;

        v_pps := v_variant.effective_pps;
        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_pps) + COALESCE(v_item.loose_quantity, 0);

        IF v_total_pieces <= 0 THEN RAISE EXCEPTION 'Sold pieces must be greater than 0 for variant %', v_variant.name; END IF;

        -- Check Van Inventory
        SELECT * INTO v_van_item FROM line_van_inventory 
        WHERE staff_id = p_staff_id AND variant_id = v_item.variant_id;

        IF NOT FOUND OR v_van_item.quantity < v_total_pieces THEN
            RAISE EXCEPTION 'Insufficient van stock for %. Van holds: % pcs, Sold: % pcs',
                v_variant.name, COALESCE(v_van_item.quantity, 0), v_total_pieces;
        END IF;

        -- Deduct from Van
        UPDATE line_van_inventory
        SET quantity = quantity - v_total_pieces,
            sets_quantity = GREATEST(0, sets_quantity - COALESCE(v_item.sets_quantity, 0)),
            updated_at = NOW()
        WHERE staff_id = p_staff_id AND variant_id = v_item.variant_id;

        -- Log movement
        INSERT INTO line_stock_movements (
            staff_id,
            variant_id,
            movement_type,
            sets_quantity,
            quantity,
            notes,
            created_at
        ) VALUES (
            p_staff_id,
            v_item.variant_id,
            'SALE_DEDUCT',
            COALESCE(v_item.sets_quantity, 0),
            v_total_pieces,
            COALESCE(p_notes, 'Billed sold stock from van'),
            NOW()
        );

        v_subtotal := v_subtotal + ROUND(v_total_pieces * COALESCE(v_item.selling_price, v_variant.selling_price), 2);
    END LOOP;

    -- 4. Calculate Final Total (Normal Non-GST)
    IF p_discount_amount > v_subtotal THEN
        RAISE EXCEPTION 'Discount amount (₹%) cannot exceed subtotal (₹%).', p_discount_amount, v_subtotal;
    END IF;

    v_final_total := GREATEST(0.00, v_subtotal - COALESCE(p_discount_amount, 0) + COALESCE(p_round_off, 0));

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
            RAISE EXCEPTION 'Insufficient store credit balance (₹%). Requested: ₹%',
                v_customer.credit_balance, v_store_credit_paid;
        END IF;

        UPDATE customers
        SET credit_balance = credit_balance - v_store_credit_paid,
            updated_at = NOW()
        WHERE id = v_customer_id
        RETURNING credit_balance INTO v_new_credit_bal;
    END IF;

    -- Generate Collision-Resistant Invoice Number
    LOOP
        v_retries := v_retries + 1;
        v_invoice_number := 'MELBUN/' || v_year || '/' || UPPER(SUBSTRING(MD5(gen_random_uuid()::TEXT) FROM 1 FOR 6));
        PERFORM 1 FROM invoices WHERE invoice_number = v_invoice_number;
        IF NOT FOUND THEN EXIT; END IF;
        IF v_retries > 50 THEN RAISE EXCEPTION 'Failed to generate unique invoice number after 50 attempts.'; END IF;
    END LOOP;

    -- Create Normal Non-GST Invoice
    INSERT INTO invoices (
        invoice_number,
        customer_id,
        subtotal,
        discount_amount,
        round_off,
        gst_applied,
        cgst_amount,
        sgst_amount,
        final_total,
        is_voided,
        is_hidden,
        created_at,
        updated_at
    ) VALUES (
        v_invoice_number,
        v_customer_id,
        v_subtotal,
        COALESCE(p_discount_amount, 0),
        COALESCE(p_round_off, 0),
        FALSE,
        0.00,
        0.00,
        v_final_total,
        FALSE,
        FALSE,
        NOW(),
        NOW()
    ) RETURNING id INTO v_invoice_id;

    -- Insert Invoice Items (preserving sets_quantity and loose_quantity snapshots)
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID,
        sets_quantity INTEGER,
        loose_quantity INTEGER,
        selling_price DECIMAL
    )
    LOOP
        SELECT v.*, COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps
        INTO v_variant
        FROM variants v
        JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;

        v_pps := v_variant.effective_pps;
        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_pps) + COALESCE(v_item.loose_quantity, 0);

        INSERT INTO invoice_items (
            invoice_id,
            variant_id,
            quantity,
            sets_quantity,
            loose_quantity,
            selling_price_snapshot,
            cost_price_snapshot,
            profit_snapshot,
            created_at
        ) VALUES (
            v_invoice_id,
            v_item.variant_id,
            v_total_pieces,
            COALESCE(v_item.sets_quantity, 0),
            COALESCE(v_item.loose_quantity, 0),
            COALESCE(v_item.selling_price, v_variant.selling_price),
            v_variant.cost_price,
            ROUND(v_total_pieces * (COALESCE(v_item.selling_price, v_variant.selling_price) - v_variant.cost_price), 2),
            NOW()
        );
    END LOOP;

    -- Insert Payments & Log Store Credit Ledger
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                INSERT INTO payments (
                    invoice_id,
                    customer_id,
                    amount,
                    method,
                    notes,
                    created_at
                ) VALUES (
                    v_invoice_id,
                    v_customer_id,
                    v_payment.amount,
                    v_payment.method,
                    COALESCE(p_notes, 'Line Sales settlement: ' || v_staff.name),
                    NOW()
                );

                IF v_payment.method = 'STORE_CREDIT' THEN
                    INSERT INTO customer_credit_ledger (
                        customer_id,
                        type,
                        amount,
                        balance_after,
                        reference_invoice_id,
                        notes,
                        created_at
                    ) VALUES (
                        v_customer_id,
                        'PAYMENT_APPLIED'::credit_movement_type,
                        -v_payment.amount,
                        v_new_credit_bal,
                        v_invoice_id,
                        'Store Credit Applied on Line Sales Invoice ' || v_invoice_number,
                        NOW()
                    );
                END IF;
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'final_total', v_final_total,
        'paid_amount', v_total_paid,
        'customer_id', v_customer_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION bill_line_staff_sales(UUID, JSONB, JSONB, DECIMAL, DECIMAL, TEXT) TO authenticated, service_role;
