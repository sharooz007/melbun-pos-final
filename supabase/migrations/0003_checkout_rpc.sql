-- Phase 3: Hardened POS Checkout Atomic RPC (V3 - Auditor Approved)

CREATE OR REPLACE FUNCTION process_checkout(
    p_customer_id UUID,
    p_subtotal DECIMAL(10,2),
    p_discount_amount DECIMAL(10,2),
    p_round_off DECIMAL(10,2),
    p_gst_applied BOOLEAN,
    p_cgst_amount DECIMAL(10,2),
    p_sgst_amount DECIMAL(10,2),
    p_final_total DECIMAL(10,2),
    p_items JSONB,
    p_payments JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_payment RECORD;
    v_profit_snapshot DECIMAL(10,2);
    v_variant RECORD;
    v_invoice_item_id UUID;
    v_total_paid DECIMAL(10,2) := 0;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    v_found_count INTEGER;
    done BOOLEAN := FALSE;
BEGIN
    -- 1. Auth Check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    -- 2. Input Validation (Sanity & Types)
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Checkout requires a valid non-empty items array.';
    END IF;

    IF p_final_total < 0 OR p_subtotal < 0 OR p_discount_amount < 0 OR p_cgst_amount < 0 OR p_sgst_amount < 0 THEN
        RAISE EXCEPTION 'Financial amounts cannot be negative.';
    END IF;

    -- Check for duplicate variant IDs in the payload to prevent stale stock updates
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in checkout items. Please consolidate cart quantities.';
    END IF;

    -- Verify all variant IDs exist in database
    SELECT COUNT(*)
    INTO v_found_count
    FROM variants
    WHERE id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) AS x);

    IF v_found_count <> v_item_count THEN
        RAISE EXCEPTION 'One or more items in the cart do not exist in the inventory catalog.';
    END IF;

    -- 3. Collision-Safe Invoice Number Generation (Cryptographic Loop)
    WHILE NOT done LOOP
        v_invoice_number := 'MELBUN/' || to_char(NOW(), 'YYYY') || '/' || upper(substring(encode(gen_random_bytes(4), 'hex') from 1 for 6));
        IF NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = v_invoice_number) THEN
            done := TRUE;
        END IF;
    END LOOP;

    -- 4. Payment Calculation & Walk-In Credit Guard
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) = 'array' AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL(10,2), method payment_method)
        LOOP
            IF v_payment.amount <= 0 THEN
                RAISE EXCEPTION 'Payment amount must be greater than zero.';
            END IF;
            IF v_payment.method = 'CREDIT' THEN
                RAISE EXCEPTION 'CREDIT must not be recorded in payments ledger. Outstanding balance is calculated from invoice final total minus actual payments.';
            END IF;
            v_total_paid := v_total_paid + v_payment.amount;
        END LOOP;
    END IF;

    IF v_total_paid < p_final_total AND p_customer_id IS NULL THEN
        RAISE EXCEPTION 'Cannot issue credit or unpaid balance to an anonymous walk-in customer.';
    END IF;

    -- 5. Insert Invoice
    INSERT INTO invoices (
        invoice_number, customer_id, subtotal, discount_amount, round_off, 
        gst_applied, cgst_amount, sgst_amount, final_total
    ) VALUES (
        v_invoice_number, p_customer_id, p_subtotal, p_discount_amount, p_round_off,
        p_gst_applied, p_cgst_amount, p_sgst_amount, p_final_total
    ) RETURNING id INTO v_invoice_id;

    -- 6. Lock Variants Deterministically (In-Memory CTE, No Temp Table Bloat)
    FOR v_variant IN 
        WITH parsed_items AS (
            SELECT 
                variant_id, 
                quantity, 
                selling_price_snapshot
            FROM jsonb_to_recordset(p_items) AS x(
                variant_id UUID, 
                quantity INTEGER, 
                selling_price_snapshot DECIMAL(10,2)
            )
        )
        SELECT 
            v.id, 
            v.cost_price, 
            v.stock_quantity, 
            v.name, 
            p.quantity, 
            COALESCE(p.selling_price_snapshot, v.selling_price) AS selling_price_snapshot
        FROM variants v
        JOIN parsed_items p ON v.id = p.variant_id
        ORDER BY v.id
        FOR UPDATE OF v
    LOOP
        -- Sanity Check on Quantity
        IF v_variant.quantity <= 0 THEN
            RAISE EXCEPTION 'Quantity for variant "%" must be greater than zero.', v_variant.name;
        END IF;

        IF v_variant.selling_price_snapshot < 0 THEN
            RAISE EXCEPTION 'Selling price for variant "%" cannot be negative.', v_variant.name;
        END IF;

        -- Strict Stock Availability Enforcement
        IF v_variant.stock_quantity < v_variant.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for "%" (Requested: %, Available: %)', 
                v_variant.name, v_variant.quantity, v_variant.stock_quantity;
        END IF;

        -- Authoritative Profit Snapshot (using Database Cost Price)
        v_profit_snapshot := (v_variant.selling_price_snapshot - v_variant.cost_price) * v_variant.quantity;

        -- Insert Line Item
        INSERT INTO invoice_items (
            invoice_id, variant_id, quantity, cost_price_snapshot, selling_price_snapshot, profit_snapshot
        ) VALUES (
            v_invoice_id, v_variant.id, v_variant.quantity, v_variant.cost_price, v_variant.selling_price_snapshot, v_profit_snapshot
        ) RETURNING id INTO v_invoice_item_id;

        -- Deduct Stock (Linked audit trail to invoice_item_id)
        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
        VALUES (v_invoice_item_id, v_variant.id, 'SALE'::stock_movement_type, -(v_variant.quantity), 'Sale via Invoice ' || v_invoice_number);

        -- Update Variant Stock Quantity
        UPDATE variants
        SET stock_quantity = stock_quantity - v_variant.quantity
        WHERE id = v_variant.id;
    END LOOP;

    -- 7. Insert Validated Payments
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) = 'array' AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL(10,2), method payment_method)
        LOOP
            INSERT INTO payments (invoice_id, customer_id, amount, method)
            VALUES (v_invoice_id, p_customer_id, v_payment.amount, v_payment.method);
        END LOOP;
    END IF;

    -- 8. Return Success Payload
    RETURN jsonb_build_object(
        'success', true, 
        'invoice_id', v_invoice_id, 
        'invoice_number', v_invoice_number,
        'final_total', p_final_total,
        'total_paid', v_total_paid
    );
END;
$$;
