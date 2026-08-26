-- Migration: 0021_fix_pgcrypto_schema.sql
-- Fixes "function gen_random_bytes(integer) does not exist"
-- by explicitly referencing the extensions schema

CREATE OR REPLACE FUNCTION generate_unique_barcode()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    new_barcode TEXT;
    done BOOLEAN := FALSE;
BEGIN
    WHILE NOT done LOOP
        -- FIXED: Added extensions. prefix
        new_barcode := 'MB' || upper(substring(encode(extensions.gen_random_bytes(6), 'hex') from 1 for 6));
        IF NOT EXISTS (SELECT 1 FROM variants WHERE barcode = new_barcode) THEN
            done := TRUE;
        END IF;
    END LOOP;
    RETURN new_barcode;
END;
$$;


CREATE OR REPLACE FUNCTION process_checkout(
    p_customer_id UUID, p_subtotal DECIMAL(10,2), p_discount_amount DECIMAL(10,2), p_round_off DECIMAL(10,2),
    p_gst_applied BOOLEAN, p_cgst_amount DECIMAL(10,2), p_sgst_amount DECIMAL(10,2), p_final_total DECIMAL(10,2),
    p_items JSONB, p_payments JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice_id UUID; v_invoice_number TEXT; v_variant RECORD; v_invoice_item_id UUID;
    v_total_paid DECIMAL(10,2) := 0; v_calculated_subtotal DECIMAL(10,2) := 0; done BOOLEAN := FALSE;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    
    WHILE NOT done LOOP
        -- FIXED: Added extensions. prefix
        v_invoice_number := 'MELBUN/' || to_char(NOW(), 'YYYY') || '/' || upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6));
        IF NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = v_invoice_number) THEN done := TRUE; END IF;
    END LOOP;

    INSERT INTO invoices (invoice_number, customer_id, subtotal, discount_amount, round_off, gst_applied, cgst_amount, sgst_amount, final_total) 
    VALUES (v_invoice_number, p_customer_id, p_subtotal, p_discount_amount, p_round_off, p_gst_applied, p_cgst_amount, p_sgst_amount, p_final_total) 
    RETURNING id INTO v_invoice_id;

    FOR v_variant IN 
        WITH parsed_items AS (
            SELECT variant_id, sets_quantity, loose_quantity FROM jsonb_to_recordset(p_items) AS x(variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER)
        )
        SELECT v.id, v.cost_price, v.selling_price, v.stock_quantity, v.stock_sets, v.name, p.sets_quantity, p.loose_quantity,
               (p.sets_quantity * pr.pieces_per_set) + p.loose_quantity AS total_pieces_to_deduct
        FROM variants v
        JOIN products pr ON v.product_id = pr.id
        JOIN parsed_items p ON v.id = p.variant_id
        ORDER BY v.id FOR UPDATE OF v
    LOOP
        IF v_variant.total_pieces_to_deduct <= 0 THEN RAISE EXCEPTION 'Quantity must be > 0'; END IF;
        IF v_variant.stock_quantity < v_variant.total_pieces_to_deduct THEN RAISE EXCEPTION 'Insufficient total stock'; END IF;
        IF v_variant.stock_sets < v_variant.sets_quantity THEN RAISE EXCEPTION 'Insufficient packaged sets. Please break a set first.'; END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_variant.selling_price * v_variant.total_pieces_to_deduct);

        INSERT INTO invoice_items (invoice_id, variant_id, quantity, sets_quantity, loose_quantity, cost_price_snapshot, selling_price_snapshot, profit_snapshot) 
        VALUES (v_invoice_id, v_variant.id, v_variant.total_pieces_to_deduct, v_variant.sets_quantity, v_variant.loose_quantity, v_variant.cost_price, v_variant.selling_price, (v_variant.selling_price - v_variant.cost_price) * v_variant.total_pieces_to_deduct) 
        RETURNING id INTO v_invoice_item_id;

        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
        VALUES (v_invoice_item_id, v_variant.id, 'SALE'::stock_movement_type, -(v_variant.total_pieces_to_deduct), 'Sale via Invoice ' || v_invoice_number);

        UPDATE variants
        SET stock_quantity = stock_quantity - v_variant.total_pieces_to_deduct,
            stock_sets = stock_sets - v_variant.sets_quantity,
            updated_at = NOW()
        WHERE id = v_variant.id;
    END LOOP;

    -- Payments...
    IF p_payments IS NOT NULL THEN
        FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL(10,2), method payment_method) LOOP
            INSERT INTO payments (invoice_id, customer_id, amount, method) VALUES (v_invoice_id, p_customer_id, v_variant.amount, v_variant.method);
        END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number);
END;
$$;
