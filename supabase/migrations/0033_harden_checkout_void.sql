-- Migration: 0033_harden_checkout_void.sql
-- Fixes critical Phantom Stock bugs during void operations, enforces strict zero-trust checkout math, and fixes dual inventory ratios.

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
SET search_path = public, extensions 
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice_id UUID; 
    v_invoice_number TEXT; 
    v_variant RECORD; 
    v_payment RECORD;
    v_invoice_item_id UUID;
    v_total_paid DECIMAL(10,2) := 0; 
    v_calculated_subtotal DECIMAL(10,2) := 0; 
    v_expected_cgst DECIMAL(10,2) := 0; 
    v_expected_sgst DECIMAL(10,2) := 0; 
    v_expected_final_total DECIMAL(10,2) := 0;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    v_found_count INTEGER;
    done BOOLEAN := FALSE;
BEGIN
    -- 1. Authentication Check
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

    -- 3. Duplicate & Catalog Existence Checks
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in checkout items. Please consolidate cart quantities.';
    END IF;

    SELECT COUNT(*)
    INTO v_found_count
    FROM variants v
    JOIN products pr ON v.product_id = pr.id
    WHERE v.id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) AS x)
      AND v.is_active = TRUE 
      AND pr.is_active = TRUE;

    IF v_found_count <> v_item_count THEN
        RAISE EXCEPTION 'One or more items in the cart do not exist or are inactive in the catalog.';
    END IF;

    -- 4. Collision-Safe Invoice Number Generation
    WHILE NOT done LOOP
        v_invoice_number := 'MELBUN/' || to_char(NOW(), 'YYYY') || '/' || upper(substring(encode(gen_random_bytes(4), 'hex') from 1 for 6));
        IF NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = v_invoice_number) THEN 
            done := TRUE; 
        END IF;
    END LOOP;

    -- 5. Payment Validation & Ledger Rules
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) = 'array' AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL(10,2), method payment_method) LOOP
            IF v_payment.amount <= 0 THEN 
                RAISE EXCEPTION 'Payment amount must be greater than zero.'; 
            END IF;
            IF v_payment.method = 'CREDIT' THEN 
                RAISE EXCEPTION 'CREDIT must not be recorded in payments ledger.'; 
            END IF;
            v_total_paid := v_total_paid + v_payment.amount;
        END LOOP;
    END IF;

    IF v_total_paid < p_final_total AND p_customer_id IS NULL THEN
        RAISE EXCEPTION 'Cannot issue credit or unpaid balance to an anonymous walk-in customer.';
    END IF;

    -- 6. Deterministic Row Locking & Authoritative Stock/Price Verification
    FOR v_variant IN 
        WITH parsed_items AS (
            SELECT variant_id, sets_quantity, loose_quantity 
            FROM jsonb_to_recordset(p_items) AS x(variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER)
        )
        SELECT v.id, v.cost_price, v.selling_price, v.stock_quantity, v.stock_sets, v.name, 
               p.sets_quantity, p.loose_quantity,
               (p.sets_quantity * pr.pieces_per_set) + p.loose_quantity AS total_pieces_to_deduct
        FROM variants v
        JOIN products pr ON v.product_id = pr.id
        JOIN parsed_items p ON v.id = p.variant_id
        ORDER BY v.id FOR UPDATE OF v
    LOOP
        IF v_variant.sets_quantity < 0 OR v_variant.loose_quantity < 0 THEN
            RAISE EXCEPTION 'Sets quantity and loose quantity cannot be negative for "%".', v_variant.name;
        END IF;

        IF v_variant.total_pieces_to_deduct <= 0 THEN 
            RAISE EXCEPTION 'Total pieces for variant "%" must be greater than zero.', v_variant.name; 
        END IF;

        IF v_variant.stock_quantity < v_variant.total_pieces_to_deduct THEN 
            RAISE EXCEPTION 'Insufficient total stock for "%" (Requested: %, Available: %)', 
                v_variant.name, v_variant.total_pieces_to_deduct, v_variant.stock_quantity; 
        END IF;

        IF v_variant.stock_sets < v_variant.sets_quantity THEN 
            RAISE EXCEPTION 'Insufficient packaged sets for "%". Please break a set first.', v_variant.name; 
        END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_variant.selling_price * v_variant.total_pieces_to_deduct);
    END LOOP;

    -- 7. Strict Mathematical Integrity & Zero-Trust Checks
    IF ABS(p_subtotal - v_calculated_subtotal) > 0.01 THEN
        RAISE EXCEPTION 'Price tampering detected: Provided subtotal (%) does not match database catalog subtotal (%).', 
            p_subtotal, v_calculated_subtotal;
    END IF;

    IF p_discount_amount > v_calculated_subtotal THEN
        RAISE EXCEPTION 'Discount amount (%) cannot exceed calculated subtotal (%).', 
            p_discount_amount, v_calculated_subtotal;
    END IF;

    IF p_gst_applied THEN
        v_expected_cgst := ROUND((v_calculated_subtotal - p_discount_amount) * 0.025, 2);
        v_expected_sgst := ROUND((v_calculated_subtotal - p_discount_amount) * 0.025, 2);
        IF ABS(p_cgst_amount - v_expected_cgst) > 0.05 OR ABS(p_sgst_amount - v_expected_sgst) > 0.05 THEN
            RAISE EXCEPTION 'GST calculation mismatch.';
        END IF;
    ELSE
        v_expected_cgst := 0;
        v_expected_sgst := 0;
        p_cgst_amount := 0;
        p_sgst_amount := 0;
    END IF;

    v_expected_final_total := ROUND(v_calculated_subtotal - p_discount_amount + p_round_off + (v_expected_cgst + v_expected_sgst), 2);
    IF ABS(p_final_total - v_expected_final_total) > 0.01 THEN
        RAISE EXCEPTION 'Final total mismatch: Expected %, but received %', v_expected_final_total, p_final_total;
    END IF;

    -- 8. Insert Invoice Record
    INSERT INTO invoices (
        invoice_number, customer_id, subtotal, discount_amount, round_off, 
        gst_applied, cgst_amount, sgst_amount, final_total
    ) VALUES (
        v_invoice_number, p_customer_id, v_calculated_subtotal, p_discount_amount, p_round_off, 
        p_gst_applied, p_cgst_amount, p_sgst_amount, p_final_total
    ) RETURNING id INTO v_invoice_id;

    -- 9. Insert Invoice Line Items, Snapshots & Stock Movements
    FOR v_variant IN 
        WITH parsed_items AS (
            SELECT variant_id, sets_quantity, loose_quantity 
            FROM jsonb_to_recordset(p_items) AS x(variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER)
        )
        SELECT v.id, v.cost_price, v.selling_price, p.sets_quantity, p.loose_quantity,
               (p.sets_quantity * pr.pieces_per_set) + p.loose_quantity AS total_pieces_to_deduct
        FROM variants v
        JOIN products pr ON v.product_id = pr.id
        JOIN parsed_items p ON v.id = p.variant_id
        ORDER BY v.id
    LOOP
        INSERT INTO invoice_items (
            invoice_id, variant_id, quantity, sets_quantity, loose_quantity, 
            cost_price_snapshot, selling_price_snapshot, profit_snapshot
        ) VALUES (
            v_invoice_id, v_variant.id, v_variant.total_pieces_to_deduct, 
            v_variant.sets_quantity, v_variant.loose_quantity, 
            v_variant.cost_price, v_variant.selling_price, 
            (v_variant.selling_price - v_variant.cost_price) * v_variant.total_pieces_to_deduct
        ) RETURNING id INTO v_invoice_item_id;

        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
        VALUES (v_invoice_item_id, v_variant.id, 'SALE'::stock_movement_type, -(v_variant.total_pieces_to_deduct), 'Sale via Invoice ' || v_invoice_number);

        UPDATE variants
        SET stock_quantity = stock_quantity - v_variant.total_pieces_to_deduct,
            stock_sets = stock_sets - v_variant.sets_quantity,
            updated_at = NOW()
        WHERE id = v_variant.id;
    END LOOP;

    -- 10. Record Payments
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) = 'array' AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL(10,2), method payment_method) LOOP
            INSERT INTO payments (invoice_id, customer_id, amount, method) 
            VALUES (v_invoice_id, p_customer_id, v_payment.amount, v_payment.method);
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true, 
        'invoice_id', v_invoice_id, 
        'invoice_number', v_invoice_number,
        'final_total', p_final_total,
        'total_paid', v_total_paid
    );
END;
$$;


CREATE OR REPLACE FUNCTION void_invoice(p_invoice_id UUID, p_reason TEXT) RETURNS JSONB
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, extensions 
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_variant RECORD;
    v_total_returned_pieces INTEGER;
    v_net_void_restock_sets INTEGER;
    v_net_void_restock_total INTEGER;
BEGIN
    -- 1. Authentication Check (Purged admin-only check to match 0017)
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; 
    END IF;

    -- 2. Lock and Validate Invoice
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Invoice not found.'; 
    END IF;
    IF v_invoice.is_voided THEN 
        RAISE EXCEPTION 'Invoice is already voided.'; 
    END IF;

    -- 3. Mark Invoice as Voided
    UPDATE invoices SET is_voided = true, updated_at = NOW() WHERE id = p_invoice_id;

    -- 4. Calculate Net Restock per Line Item (Subtracting ALL returns: RESTOCK & DAMAGED)
    FOR v_variant IN 
        WITH invoice_items_to_void AS (
            SELECT id AS item_id, variant_id, quantity, sets_quantity, loose_quantity 
            FROM invoice_items 
            WHERE invoice_id = p_invoice_id
        )
        SELECT v.id AS variant_id, i.quantity, i.sets_quantity, i.loose_quantity, i.item_id, 
               COALESCE(pr.pieces_per_set, 1) AS pieces_per_set
        FROM variants v 
        JOIN products pr ON v.product_id = pr.id
        JOIN invoice_items_to_void i ON v.id = i.variant_id 
        ORDER BY v.id, i.item_id FOR UPDATE OF v
    LOOP
        -- Query ALL pieces returned against this line item (both RESTOCK and DAMAGED)
        SELECT COALESCE(SUM(quantity), 0)
        INTO v_total_returned_pieces
        FROM returns
        WHERE invoice_item_id = v_variant.item_id;

        v_net_void_restock_total := v_variant.quantity - v_total_returned_pieces;

        IF v_net_void_restock_total > 0 THEN
            -- Safely restore unbroken packaged sets without violating dual inventory ratios
            v_net_void_restock_sets := LEAST(
                v_variant.sets_quantity, 
                FLOOR(v_net_void_restock_total / GREATEST(v_variant.pieces_per_set, 1))
            );

            INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
            VALUES (
                v_variant.item_id, 
                v_variant.variant_id, 
                'VOID_RESTOCK'::stock_movement_type, 
                v_net_void_restock_total, 
                'Voided Invoice: ' || COALESCE(NULLIF(trim(p_reason), ''), 'No reason provided')
            );

            UPDATE variants 
            SET stock_quantity = stock_quantity + v_net_void_restock_total,
                stock_sets = stock_sets + v_net_void_restock_sets,
                updated_at = NOW()
            WHERE id = v_variant.variant_id;
        END IF;
    END LOOP;
    
    RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice.invoice_number);
END;
$$;
