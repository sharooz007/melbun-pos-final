-- Migration: 0009_harden_checkout_rpc.sql (Auditor Hardened V4)
-- Enforces Zero-Trust Database Catalog Pricing, Full Financial Math Re-validation, and Deterministic Locking.

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
    v_calculated_subtotal DECIMAL(10,2) := 0;
    v_expected_cgst DECIMAL(10,2) := 0;
    v_expected_sgst DECIMAL(10,2) := 0;
    v_expected_final_total DECIMAL(10,2) := 0;
    done BOOLEAN := FALSE;
BEGIN
    -- 1. Auth Check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    -- 2. Input Sanity & Type Validation
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Checkout requires a valid non-empty items array.';
    END IF;

    IF p_final_total < 0 OR p_subtotal < 0 OR p_discount_amount < 0 OR p_cgst_amount < 0 OR p_sgst_amount < 0 THEN
        RAISE EXCEPTION 'Financial amounts cannot be negative.';
    END IF;

    -- Duplicate Variant Detection
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in checkout items. Please consolidate cart quantities.';
    END IF;

    -- Catalog Existence Check
    SELECT COUNT(*)
    INTO v_found_count
    FROM variants
    WHERE id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) AS x);

    IF v_found_count <> v_item_count THEN
        RAISE EXCEPTION 'One or more items in the cart do not exist in the inventory catalog.';
    END IF;

    -- 3. Collision-Safe Invoice Number Generation
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

    -- 5. Deterministic Variant Locking & Authoritative Catalog Price Verification
    FOR v_variant IN 
        WITH parsed_items AS (
            SELECT variant_id, quantity 
            FROM jsonb_to_recordset(p_items) AS x(variant_id UUID, quantity INTEGER)
        )
        SELECT 
            v.id, 
            v.cost_price, 
            v.selling_price, 
            v.stock_quantity, 
            v.name, 
            p.quantity
        FROM variants v
        JOIN parsed_items p ON v.id = p.variant_id
        ORDER BY v.id
        FOR UPDATE OF v
    LOOP
        IF v_variant.quantity <= 0 THEN
            RAISE EXCEPTION 'Quantity for variant "%" must be greater than zero.', v_variant.name;
        END IF;

        IF v_variant.stock_quantity < v_variant.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for "%" (Requested: %, Available: %)', 
                v_variant.name, v_variant.quantity, v_variant.stock_quantity;
        END IF;

        -- Accumulate authoritative subtotal using DB selling price
        v_calculated_subtotal := v_calculated_subtotal + (v_variant.selling_price * v_variant.quantity);
    END LOOP;

    -- 6. Strict Price Tampering & Mathematical Integrity Check
    IF ABS(p_subtotal - v_calculated_subtotal) > 0.01 THEN
        RAISE EXCEPTION 'Price tampering detected: Provided subtotal (%) does not match database catalog subtotal (%).', 
            p_subtotal, v_calculated_subtotal;
    END IF;

    IF p_gst_applied THEN
        v_expected_cgst := ROUND((v_calculated_subtotal - p_discount_amount) * 0.025, 2);
        v_expected_sgst := ROUND((v_calculated_subtotal - p_discount_amount) * 0.025, 2);
        IF ABS(p_cgst_amount - v_expected_cgst) > 0.05 OR ABS(p_sgst_amount - v_expected_sgst) > 0.05 THEN
            RAISE EXCEPTION 'GST calculation mismatch.';
        END IF;
    END IF;

    v_expected_final_total := ROUND(v_calculated_subtotal - p_discount_amount + p_round_off + (CASE WHEN p_gst_applied THEN (p_cgst_amount + p_sgst_amount) ELSE 0 END), 2);
    IF ABS(p_final_total - v_expected_final_total) > 0.01 THEN
        RAISE EXCEPTION 'Final total mismatch: Expected %, but received %', v_expected_final_total, p_final_total;
    END IF;

    -- 7. Insert Invoice
    INSERT INTO invoices (
        invoice_number, customer_id, subtotal, discount_amount, round_off, 
        gst_applied, cgst_amount, sgst_amount, final_total
    ) VALUES (
        v_invoice_number, p_customer_id, p_subtotal, p_discount_amount, p_round_off,
        p_gst_applied, p_cgst_amount, p_sgst_amount, p_final_total
    ) RETURNING id INTO v_invoice_id;

    -- 8. Record Line Items, COGS Snapshot & Stock Reductions
    FOR v_variant IN 
        WITH parsed_items AS (
            SELECT variant_id, quantity 
            FROM jsonb_to_recordset(p_items) AS x(variant_id UUID, quantity INTEGER)
        )
        SELECT 
            v.id, 
            v.cost_price, 
            v.selling_price, 
            p.quantity
        FROM variants v
        JOIN parsed_items p ON v.id = p.variant_id
        ORDER BY v.id
    LOOP
        v_profit_snapshot := (v_variant.selling_price - v_variant.cost_price) * v_variant.quantity;

        INSERT INTO invoice_items (
            invoice_id, variant_id, quantity, cost_price_snapshot, selling_price_snapshot, profit_snapshot
        ) VALUES (
            v_invoice_id, v_variant.id, v_variant.quantity, v_variant.cost_price, v_variant.selling_price, v_profit_snapshot
        ) RETURNING id INTO v_invoice_item_id;

        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
        VALUES (v_invoice_item_id, v_variant.id, 'SALE'::stock_movement_type, -(v_variant.quantity), 'Sale via Invoice ' || v_invoice_number);

        UPDATE variants
        SET stock_quantity = stock_quantity - v_variant.quantity,
            updated_at = NOW()
        WHERE id = v_variant.id;
    END LOOP;

    -- 9. Insert Validated Payments
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) = 'array' AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL(10,2), method payment_method)
        LOOP
            INSERT INTO payments (invoice_id, customer_id, amount, method)
            VALUES (v_invoice_id, p_customer_id, v_payment.amount, v_payment.method);
        END LOOP;
    END IF;

    -- 10. Return Success Payload
    RETURN jsonb_build_object(
        'success', true, 
        'invoice_id', v_invoice_id, 
        'invoice_number', v_invoice_number,
        'final_total', p_final_total,
        'total_paid', v_total_paid
    );
END;
$$;
