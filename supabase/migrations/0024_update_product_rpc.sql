-- Migration: 0024_update_product_rpc.sql

CREATE OR REPLACE FUNCTION update_product_with_variants(
    p_product_id UUID,
    p_name TEXT,
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
    v_variant RECORD;
    v_barcode TEXT;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    -- Update Product
    UPDATE products 
    SET name = p_name, category_id = p_category_id, pieces_per_set = p_pieces_per_set, updated_at = NOW()
    WHERE id = p_product_id;

    -- Upsert Variants
    -- Note: We assume the frontend passes the variant ID if it exists, otherwise it's a new variant.
    FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_variants) AS x(id UUID, name TEXT, barcode TEXT, cost_price DECIMAL, selling_price DECIMAL)
    LOOP
        v_barcode := COALESCE(NULLIF(trim(v_variant.barcode), ''), generate_unique_barcode());
        
        IF v_variant.id IS NOT NULL THEN
            UPDATE variants 
            SET name = v_variant.name, barcode = v_barcode, cost_price = v_variant.cost_price, selling_price = v_variant.selling_price, updated_at = NOW()
            WHERE id = v_variant.id AND product_id = p_product_id;
        ELSE
            INSERT INTO variants (product_id, name, barcode, cost_price, selling_price, stock_quantity, stock_sets)
            VALUES (p_product_id, v_variant.name, v_barcode, v_variant.cost_price, v_variant.selling_price, 0, 0);
        END IF;
    END LOOP;

    -- Note: We are not handling hard-deleting variants here because they might have sales history.
    -- If a user deletes a variant in the UI, we would typically soft-delete it.

    RETURN jsonb_build_object('success', true, 'product_id', p_product_id);
END;
$$;
