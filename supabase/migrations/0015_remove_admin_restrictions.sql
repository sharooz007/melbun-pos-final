-- Migration: 0015_remove_admin_restrictions.sql

-- 1. Remove admin check from create_product_with_variants
CREATE OR REPLACE FUNCTION create_product_with_variants(
    p_name TEXT,
    p_brand TEXT,
    p_category_id UUID,
    p_pieces_per_set INTEGER,
    p_variants JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_product_id UUID;
    v_variant RECORD;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    -- Create Product
    INSERT INTO products (name, brand, category_id, pieces_per_set)
    VALUES (p_name, p_brand, p_category_id, p_pieces_per_set)
    RETURNING id INTO v_product_id;

    -- Create Variants
    FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_variants) AS x(name TEXT, barcode TEXT, cost_price DECIMAL, selling_price DECIMAL)
    LOOP
        INSERT INTO variants (product_id, name, barcode, cost_price, selling_price, stock_quantity, stock_sets)
        VALUES (v_product_id, v_variant.name, v_variant.barcode, v_variant.cost_price, v_variant.selling_price, 0, 0);
    END LOOP;

    RETURN jsonb_build_object('success', true, 'product_id', v_product_id);
END;
$$;

-- 2. Remove admin check from process_stock_arrival
CREATE OR REPLACE FUNCTION process_stock_arrival(
    p_movements JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_movement RECORD;
    v_total_added INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    FOR v_movement IN 
        WITH parsed AS (
            SELECT variant_id, sets_quantity, loose_quantity, notes FROM jsonb_to_recordset(p_movements) AS x(variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER, notes TEXT)
        )
        SELECT p.variant_id, p.sets_quantity, p.loose_quantity, p.notes, pr.pieces_per_set
        FROM parsed p
        JOIN variants v ON p.variant_id = v.id
        JOIN products pr ON v.product_id = pr.id
        ORDER BY p.variant_id
    LOOP
        IF v_movement.sets_quantity < 0 OR v_movement.loose_quantity < 0 THEN 
            RAISE EXCEPTION 'Quantities cannot be negative'; 
        END IF;
        
        v_total_added := (v_movement.sets_quantity * v_movement.pieces_per_set) + v_movement.loose_quantity;
        
        IF v_total_added = 0 THEN
            CONTINUE;
        END IF;

        INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
        VALUES (v_movement.variant_id, 'RESTOCK'::stock_movement_type, v_total_added, COALESCE(v_movement.notes, 'Stock Arrival'));

        UPDATE variants 
        SET stock_quantity = stock_quantity + v_total_added,
            stock_sets = stock_sets + v_movement.sets_quantity,
            updated_at = NOW()
        WHERE id = v_movement.variant_id;
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;
