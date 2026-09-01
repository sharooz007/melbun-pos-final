-- Migration: 0073_variant_pieces_per_set_rpcs.sql
-- Enables variant-level pieces_per_set in create_product_with_variants and update_product_with_variants
-- Hardened against phantom stock, negative inventory injection, and missing ledger write-offs.

CREATE OR REPLACE FUNCTION create_product_with_variants(
    p_name TEXT,
    p_category_id UUID,
    p_pieces_per_set INTEGER,
    p_variants JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_product_id UUID;
    v_variant RECORD;
    v_barcode TEXT;
    v_new_variant_id UUID;
    v_pps INTEGER;
    v_total_pieces INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;

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
        pieces_per_set INTEGER, initial_sets INTEGER, initial_loose INTEGER
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

        v_pps := COALESCE(v_variant.pieces_per_set, p_pieces_per_set, 1);
        IF v_pps <= 0 THEN v_pps := 1; END IF;

        v_barcode := COALESCE(NULLIF(trim(v_variant.barcode), ''), generate_unique_barcode());
        v_total_pieces := (COALESCE(v_variant.initial_sets, 0) * v_pps) + COALESCE(v_variant.initial_loose, 0);
        
        INSERT INTO variants (
            product_id, name, barcode, cost_price, selling_price, 
            pieces_per_set, stock_quantity, stock_sets, is_active
        ) VALUES (
            v_product_id, trim(v_variant.name), v_barcode, COALESCE(v_variant.cost_price, 0), v_variant.selling_price, 
            v_pps, v_total_pieces, COALESCE(v_variant.initial_sets, 0), TRUE
        ) RETURNING id INTO v_new_variant_id;

        IF v_total_pieces > 0 THEN
            INSERT INTO stock_movements (variant_id, type, quantity_change, notes, created_at)
            VALUES (
                v_new_variant_id,
                'ARRIVAL'::stock_movement_type,
                v_total_pieces,
                format('Initial variant stock added: %s sets, %s loose pcs', 
                       COALESCE(v_variant.initial_sets, 0), COALESCE(v_variant.initial_loose, 0)),
                NOW()
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'product_id', v_product_id,
        'name', trim(p_name)
    );
END;
$$;

CREATE OR REPLACE FUNCTION update_product_with_variants(
    p_product_id UUID,
    p_name TEXT,
    p_category_id UUID,
    p_pieces_per_set INT,
    p_variants JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_old_pieces_per_set INT;
    v_variant RECORD;
    v_var_rec RECORD;
    v_incoming_variant_ids UUID[] := ARRAY[]::UUID[];
    v_new_variant_id UUID;
    v_cost_price DECIMAL(10,2);
    v_barcode TEXT;
    v_loose_pieces INT;
    v_new_total_pieces INT;
    v_piece_delta INT;
    v_new_stock_qty INT;
    v_pps INT;
    v_old_var_pps INT;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_product_id IS NULL THEN RAISE EXCEPTION 'Product ID is required'; END IF;
    IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'Product name is required'; END IF;
    IF p_pieces_per_set IS NULL OR p_pieces_per_set < 1 THEN RAISE EXCEPTION 'Pack size must be at least 1 piece per set'; END IF;
    IF p_variants IS NULL OR jsonb_typeof(p_variants) <> 'array' OR jsonb_array_length(p_variants) = 0 THEN
        RAISE EXCEPTION 'Product must contain at least one variant';
    END IF;

    -- Fetch old pack size and lock product
    SELECT pieces_per_set INTO v_old_pieces_per_set FROM products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;

    -- Update parent product
    UPDATE products
    SET name = trim(p_name),
        category_id = p_category_id,
        pieces_per_set = p_pieces_per_set,
        updated_at = NOW()
    WHERE id = p_product_id;

    -- Process variants
    FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_variants) AS x(
        id UUID, name TEXT, barcode TEXT, cost_price DECIMAL, selling_price DECIMAL,
        pieces_per_set INTEGER, initial_sets INTEGER, initial_loose INTEGER
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

        v_pps := COALESCE(v_variant.pieces_per_set, p_pieces_per_set, 1);
        IF v_pps <= 0 THEN v_pps := 1; END IF;

        v_barcode := COALESCE(NULLIF(trim(v_variant.barcode), ''), generate_unique_barcode());
        v_cost_price := COALESCE(v_variant.cost_price, 0.00);

        IF v_variant.id IS NOT NULL THEN
            SELECT * INTO v_var_rec FROM variants WHERE id = v_variant.id AND product_id = p_product_id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Variant % does not belong to this product', v_variant.id; END IF;

            v_old_var_pps := COALESCE(v_var_rec.pieces_per_set, v_old_pieces_per_set, 1);

            -- Update existing variant without overwriting live stock
            UPDATE variants
            SET name = trim(v_variant.name),
                barcode = v_barcode,
                cost_price = v_cost_price,
                selling_price = v_variant.selling_price,
                pieces_per_set = v_pps,
                updated_at = NOW()
            WHERE id = v_variant.id AND product_id = p_product_id;

            -- If variant pack size changed, adjust stock_quantity based on preserved sets and loose pieces
            IF v_old_var_pps <> v_pps THEN
                v_loose_pieces := GREATEST(0, v_var_rec.stock_quantity - (COALESCE(v_var_rec.stock_sets, 0) * v_old_var_pps));
                v_new_total_pieces := (COALESCE(v_var_rec.stock_sets, 0) * v_pps) + v_loose_pieces;
                v_piece_delta := v_new_total_pieces - v_var_rec.stock_quantity;

                UPDATE variants 
                SET stock_quantity = v_new_total_pieces,
                    updated_at = NOW()
                WHERE id = v_variant.id;

                IF v_piece_delta <> 0 THEN
                    INSERT INTO stock_movements (
                        variant_id, type, quantity_change, notes, created_at
                    ) VALUES (
                        v_variant.id,
                        'MANUAL_ADJUST'::stock_movement_type,
                        v_piece_delta,
                        format('Pack size updated from %s to %s pcs/set', v_old_var_pps, v_pps),
                        NOW()
                    );
                END IF;
            END IF;

            v_incoming_variant_ids := array_append(v_incoming_variant_ids, v_variant.id);
        ELSE
            -- Insert new variant with ARRIVAL movement type
            v_new_stock_qty := (COALESCE(v_variant.initial_sets, 0) * v_pps) + COALESCE(v_variant.initial_loose, 0);

            INSERT INTO variants (
                product_id, name, barcode, cost_price, selling_price,
                pieces_per_set, stock_sets, stock_quantity, is_active
            ) VALUES (
                p_product_id, trim(v_variant.name), v_barcode, v_cost_price, v_variant.selling_price,
                v_pps, COALESCE(v_variant.initial_sets, 0), v_new_stock_qty, TRUE
            ) RETURNING id INTO v_new_variant_id;

            IF v_new_stock_qty > 0 THEN
                INSERT INTO stock_movements (
                    variant_id, type, quantity_change, notes, created_at
                ) VALUES (
                    v_new_variant_id,
                    'ARRIVAL'::stock_movement_type,
                    v_new_stock_qty,
                    format('Initial variant stock added: %s sets, %s loose pcs', 
                           COALESCE(v_variant.initial_sets, 0), COALESCE(v_variant.initial_loose, 0)),
                    NOW()
                );
            END IF;

            v_incoming_variant_ids := array_append(v_incoming_variant_ids, v_new_variant_id);
        END IF;
    END LOOP;

    -- Deactivate variants omitted from payload & log accurate negative quantity change in stock_movements (Bug #7 hardening)
    FOR v_var_rec IN
        SELECT id, stock_quantity FROM variants
        WHERE product_id = p_product_id 
          AND is_active = TRUE
          AND NOT (id = ANY(v_incoming_variant_ids))
    LOOP
        UPDATE variants 
        SET is_active = FALSE,
            stock_quantity = 0,
            stock_sets = 0,
            updated_at = NOW() 
        WHERE id = v_var_rec.id;

        IF COALESCE(v_var_rec.stock_quantity, 0) > 0 THEN
            INSERT INTO stock_movements (
                variant_id, type, quantity_change, notes, created_at
            ) VALUES (
                v_var_rec.id,
                'MANUAL_ADJUST'::stock_movement_type,
                -v_var_rec.stock_quantity,
                'Variant removed from product during edit - stock written off to zero',
                NOW()
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'product_id', p_product_id,
        'variant_count', array_length(v_incoming_variant_ids, 1)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION create_product_with_variants(TEXT, UUID, INTEGER, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_product_with_variants(UUID, TEXT, UUID, INT, JSONB) TO authenticated, service_role;
