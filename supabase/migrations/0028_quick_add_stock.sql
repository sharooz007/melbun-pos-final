-- Migration: 0028_quick_add_stock.sql

-- 1. Hardened Create Product RPC to handle initial stock & full validation
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
    v_barcode TEXT;
    v_new_variant_id UUID;
    v_total_pieces INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    -- Validate product level inputs
    IF p_name IS NULL OR trim(p_name) = '' THEN 
        RAISE EXCEPTION 'Product name is required'; 
    END IF;
    IF p_pieces_per_set IS NULL OR p_pieces_per_set <= 0 THEN 
        RAISE EXCEPTION 'Pieces per set must be greater than 0'; 
    END IF;
    IF p_variants IS NULL OR jsonb_typeof(p_variants) <> 'array' OR jsonb_array_length(p_variants) = 0 THEN 
        RAISE EXCEPTION 'Product must contain at least one variant'; 
    END IF;

    -- Create Product
    INSERT INTO products (name, category_id, pieces_per_set, is_active)
    VALUES (trim(p_name), p_category_id, p_pieces_per_set, TRUE)
    RETURNING id INTO v_product_id;

    -- Create Variants
    FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_variants) AS x(
        name TEXT, barcode TEXT, cost_price DECIMAL, selling_price DECIMAL, 
        initial_sets INTEGER, initial_loose INTEGER
    )
    LOOP
        IF v_variant.name IS NULL OR trim(v_variant.name) = '' THEN 
            RAISE EXCEPTION 'Variant name cannot be empty'; 
        END IF;
        IF v_variant.selling_price IS NULL OR v_variant.selling_price < 0 THEN 
            RAISE EXCEPTION 'Variant selling price must be non-negative'; 
        END IF;
        IF v_variant.cost_price IS NOT NULL AND v_variant.cost_price < 0 THEN 
            RAISE EXCEPTION 'Cost price cannot be negative'; 
        END IF;
        IF COALESCE(v_variant.initial_sets, 0) < 0 OR COALESCE(v_variant.initial_loose, 0) < 0 THEN 
            RAISE EXCEPTION 'Initial stock quantities cannot be negative'; 
        END IF;

        v_barcode := COALESCE(NULLIF(trim(v_variant.barcode), ''), generate_unique_barcode());
        v_total_pieces := (COALESCE(v_variant.initial_sets, 0) * p_pieces_per_set) + COALESCE(v_variant.initial_loose, 0);
        
        INSERT INTO variants (product_id, name, barcode, cost_price, selling_price, stock_quantity, stock_sets, is_active)
        VALUES (v_product_id, trim(v_variant.name), v_barcode, COALESCE(v_variant.cost_price, 0), v_variant.selling_price, v_total_pieces, COALESCE(v_variant.initial_sets, 0), TRUE)
        RETURNING id INTO v_new_variant_id;

        IF v_total_pieces > 0 THEN
            INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
            VALUES (v_new_variant_id, 'ARRIVAL'::stock_movement_type, v_total_pieces, 'Initial stock on creation');
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'product_id', v_product_id);
END;
$$;

-- 2. Hardened Edit Product RPC
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
    v_new_variant_id UUID;
    v_active_variant_ids UUID[] := '{}';
    v_total_pieces INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    -- Validate input
    IF p_name IS NULL OR trim(p_name) = '' THEN 
        RAISE EXCEPTION 'Product name is required'; 
    END IF;
    IF p_pieces_per_set IS NULL OR p_pieces_per_set <= 0 THEN 
        RAISE EXCEPTION 'Pieces per set must be greater than 0'; 
    END IF;
    IF p_variants IS NULL OR jsonb_typeof(p_variants) <> 'array' OR jsonb_array_length(p_variants) = 0 THEN 
        RAISE EXCEPTION 'Product must contain at least one variant'; 
    END IF;

    -- Verify and Update Product (also ensure is_active = TRUE)
    UPDATE products 
    SET name = trim(p_name), category_id = p_category_id, pieces_per_set = p_pieces_per_set, is_active = TRUE, updated_at = NOW()
    WHERE id = p_product_id;

    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Product not found'; 
    END IF;

    -- Upsert Variants
    FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_variants) AS x(
        id UUID, name TEXT, barcode TEXT, cost_price DECIMAL, selling_price DECIMAL,
        initial_sets INTEGER, initial_loose INTEGER
    )
    LOOP
        IF v_variant.name IS NULL OR trim(v_variant.name) = '' THEN 
            RAISE EXCEPTION 'Variant name cannot be empty'; 
        END IF;
        IF v_variant.selling_price IS NULL OR v_variant.selling_price < 0 THEN 
            RAISE EXCEPTION 'Variant selling price must be non-negative'; 
        END IF;
        IF v_variant.cost_price IS NOT NULL AND v_variant.cost_price < 0 THEN 
            RAISE EXCEPTION 'Cost price cannot be negative'; 
        END IF;

        v_barcode := COALESCE(NULLIF(trim(v_variant.barcode), ''), generate_unique_barcode());
        
        IF v_variant.id IS NOT NULL THEN
            UPDATE variants 
            SET name = trim(v_variant.name), barcode = v_barcode, cost_price = COALESCE(v_variant.cost_price, 0), selling_price = v_variant.selling_price, is_active = TRUE, updated_at = NOW()
            WHERE id = v_variant.id AND product_id = p_product_id;
            
            IF FOUND THEN
                v_active_variant_ids := array_append(v_active_variant_ids, v_variant.id);
            ELSE
                -- If an ID was supplied that did not match this product, insert cleanly as new
                IF COALESCE(v_variant.initial_sets, 0) < 0 OR COALESCE(v_variant.initial_loose, 0) < 0 THEN 
                    RAISE EXCEPTION 'Initial stock quantities cannot be negative'; 
                END IF;

                v_total_pieces := (COALESCE(v_variant.initial_sets, 0) * p_pieces_per_set) + COALESCE(v_variant.initial_loose, 0);
                INSERT INTO variants (product_id, name, barcode, cost_price, selling_price, stock_quantity, stock_sets, is_active)
                VALUES (p_product_id, trim(v_variant.name), v_barcode, COALESCE(v_variant.cost_price, 0), v_variant.selling_price, v_total_pieces, COALESCE(v_variant.initial_sets, 0), TRUE)
                RETURNING id INTO v_new_variant_id;
                
                IF v_total_pieces > 0 THEN
                    INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
                    VALUES (v_new_variant_id, 'ARRIVAL'::stock_movement_type, v_total_pieces, 'Initial stock on creation');
                END IF;

                v_active_variant_ids := array_append(v_active_variant_ids, v_new_variant_id);
            END IF;
        ELSE
            -- Insert truly new variant
            IF COALESCE(v_variant.initial_sets, 0) < 0 OR COALESCE(v_variant.initial_loose, 0) < 0 THEN 
                RAISE EXCEPTION 'Initial stock quantities cannot be negative'; 
            END IF;

            v_total_pieces := (COALESCE(v_variant.initial_sets, 0) * p_pieces_per_set) + COALESCE(v_variant.initial_loose, 0);
            INSERT INTO variants (product_id, name, barcode, cost_price, selling_price, stock_quantity, stock_sets, is_active)
            VALUES (p_product_id, trim(v_variant.name), v_barcode, COALESCE(v_variant.cost_price, 0), v_variant.selling_price, v_total_pieces, COALESCE(v_variant.initial_sets, 0), TRUE)
            RETURNING id INTO v_new_variant_id;
            
            IF v_total_pieces > 0 THEN
                INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
                VALUES (v_new_variant_id, 'ARRIVAL'::stock_movement_type, v_total_pieces, 'Initial stock on creation');
            END IF;

            v_active_variant_ids := array_append(v_active_variant_ids, v_new_variant_id);
        END IF;
    END LOOP;

    -- Soft-delete only variants that exist on this product but were removed in this payload
    IF array_length(v_active_variant_ids, 1) > 0 THEN
        UPDATE variants SET is_active = FALSE, updated_at = NOW() 
        WHERE product_id = p_product_id AND NOT (id = ANY(v_active_variant_ids)) AND is_active = TRUE;
    END IF;

    RETURN jsonb_build_object('success', true, 'product_id', p_product_id);
END;
$$;
