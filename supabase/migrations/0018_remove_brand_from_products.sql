-- Migration: 0018_remove_brand_from_products.sql

-- Explicitly drop the previous 5-argument function signature to prevent overloading
DROP FUNCTION IF EXISTS create_product_with_variants(TEXT, TEXT, UUID, INTEGER, JSONB);

-- Create new 4-argument function
CREATE OR REPLACE FUNCTION create_product_with_variants(
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
    v_product_id UUID;
    v_variant RECORD;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    -- Create Product (no brand)
    INSERT INTO products (name, category_id, pieces_per_set)
    VALUES (p_name, p_category_id, p_pieces_per_set)
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

-- Drop column from table
ALTER TABLE products DROP COLUMN IF EXISTS brand;
