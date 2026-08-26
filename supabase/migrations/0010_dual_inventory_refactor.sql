-- Migration: 0010_dual_inventory_refactor.sql
-- Auditor Hardened: Prevents Phantom Stock when voiding sets/loose pieces.

-- 1. Alter Tables
ALTER TABLE variants ADD COLUMN stock_sets INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN sets_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN loose_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE returns ADD COLUMN sets_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE returns ADD COLUMN loose_quantity INTEGER NOT NULL DEFAULT 0;

-- 2. Checkout RPC Refactor
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
        v_invoice_number := 'MELBUN/' || to_char(NOW(), 'YYYY') || '/' || upper(substring(encode(gen_random_bytes(4), 'hex') from 1 for 6));
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

-- 3. Void RPC Refactor (Hardened against Phantom Stock)
CREATE OR REPLACE FUNCTION void_invoice(p_invoice_id UUID, p_reason TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_role TEXT;
    v_invoice RECORD;
    v_variant RECORD;
    v_past_returned_sets INTEGER;
    v_past_returned_loose INTEGER;
    v_net_void_restock_sets INTEGER;
    v_net_void_restock_loose INTEGER;
    v_net_void_restock_total INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    v_user_role := public.get_my_role();
    IF v_user_role IS DISTINCT FROM 'ADMIN' THEN RAISE EXCEPTION 'Forbidden'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Invoice is already voided.'; END IF;

    UPDATE invoices SET is_voided = true, updated_at = NOW() WHERE id = p_invoice_id;

    FOR v_variant IN 
        WITH invoice_items_to_void AS (
            SELECT id AS item_id, variant_id, quantity, sets_quantity, loose_quantity FROM invoice_items WHERE invoice_id = p_invoice_id
        )
        SELECT v.id AS variant_id, i.quantity, i.sets_quantity, i.loose_quantity, i.item_id, pr.pieces_per_set
        FROM variants v 
        JOIN products pr ON v.product_id = pr.id
        JOIN invoice_items_to_void i ON v.id = i.variant_id 
        ORDER BY v.id, i.item_id FOR UPDATE OF v
    LOOP
        -- Calculate ALL pieces already returned
        SELECT 
            COALESCE(SUM(sets_quantity), 0),
            COALESCE(SUM(loose_quantity), 0)
        INTO v_past_returned_sets, v_past_returned_loose
        FROM returns
        WHERE invoice_item_id = v_variant.item_id AND return_type = 'RESTOCK';

        v_net_void_restock_sets := v_variant.sets_quantity - v_past_returned_sets;
        v_net_void_restock_loose := v_variant.loose_quantity - v_past_returned_loose;
        v_net_void_restock_total := v_variant.quantity - ((v_past_returned_sets * v_variant.pieces_per_set) + v_past_returned_loose);

        IF v_net_void_restock_total > 0 THEN
            INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
            VALUES (v_variant.item_id, v_variant.variant_id, 'VOID_RESTOCK'::stock_movement_type, v_net_void_restock_total, 'Voided Invoice: ' || COALESCE(p_reason, 'No reason'));

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
