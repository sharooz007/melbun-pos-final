-- Migration: 0042_harden_product_variant_updates.sql
-- Fixes Dual Inventory Desync on pieces_per_set modification (Bug 10) 
-- and Orphaned Inventory on Variant Deletion (Bug 11).

CREATE OR REPLACE FUNCTION update_product_with_variants(
    p_product_id UUID,
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
    v_old_product RECORD;
    v_old_pieces_per_set INTEGER;
    v_variant RECORD;
    v_var_rec RECORD;
    v_deleted_var RECORD;
    v_barcode TEXT;
    v_new_variant_id UUID;
    v_active_variant_ids UUID[] := '{}';
    v_sets INTEGER;
    v_loose INTEGER;
    v_new_total_pieces INTEGER;
    v_piece_delta INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;

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

    -- Lock and Fetch existing product
    SELECT * INTO v_old_product FROM products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Product not found'; 
    END IF;

    v_old_pieces_per_set := COALESCE(v_old_product.pieces_per_set, 1);

    -- Update Product Details
    UPDATE products 
    SET name = trim(p_name), 
        category_id = p_category_id, 
        pieces_per_set = p_pieces_per_set, 
        is_active = TRUE, 
        updated_at = NOW()
    WHERE id = p_product_id;

    -- BUG 10 FIX: If pieces_per_set changed, recalculate total pieces for existing variants
    -- Rule: Preserve loose count L = stock_quantity - (stock_sets * old_pieces_per_set)
    -- New total = (stock_sets * new_pieces_per_set) + L
    IF v_old_pieces_per_set <> p_pieces_per_set THEN
        FOR v_var_rec IN 
            SELECT id, stock_quantity, stock_sets 
            FROM variants 
            WHERE product_id = p_product_id AND is_active = TRUE 
            FOR UPDATE 
        LOOP
            v_sets := GREATEST(0, COALESCE(v_var_rec.stock_sets, 0));
            v_loose := GREATEST(0, v_var_rec.stock_quantity - (v_sets * v_old_pieces_per_set));
            v_new_total_pieces := (v_sets * p_pieces_per_set) + v_loose;
            v_piece_delta := v_new_total_pieces - v_var_rec.stock_quantity;

            UPDATE variants 
            SET stock_quantity = v_new_total_pieces,
                updated_at = NOW()
            WHERE id = v_var_rec.id;

            IF v_piece_delta <> 0 THEN
                INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
                VALUES (
                    v_var_rec.id, 
                    'MANUAL_ADJUST'::stock_movement_type, 
                    v_piece_delta, 
                    'Pieces per set changed from ' || v_old_pieces_per_set || ' to ' || p_pieces_per_set
                );
            END IF;
        END LOOP;
    END IF;

    -- Upsert Variants in the payload
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
            SET name = trim(v_variant.name), 
                barcode = v_barcode, 
                cost_price = COALESCE(v_variant.cost_price, 0), 
                selling_price = v_variant.selling_price, 
                is_active = TRUE, 
                updated_at = NOW()
            WHERE id = v_variant.id AND product_id = p_product_id;
            
            IF FOUND THEN
                v_active_variant_ids := array_append(v_active_variant_ids, v_variant.id);
            ELSE
                -- If ID was supplied but did not match this product, insert cleanly as new
                IF COALESCE(v_variant.initial_sets, 0) < 0 OR COALESCE(v_variant.initial_loose, 0) < 0 THEN 
                    RAISE EXCEPTION 'Initial stock quantities cannot be negative'; 
                END IF;

                v_new_total_pieces := (COALESCE(v_variant.initial_sets, 0) * p_pieces_per_set) + COALESCE(v_variant.initial_loose, 0);
                INSERT INTO variants (product_id, name, barcode, cost_price, selling_price, stock_quantity, stock_sets, is_active)
                VALUES (p_product_id, trim(v_variant.name), v_barcode, COALESCE(v_variant.cost_price, 0), v_variant.selling_price, v_new_total_pieces, COALESCE(v_variant.initial_sets, 0), TRUE)
                RETURNING id INTO v_new_variant_id;
                
                IF v_new_total_pieces > 0 THEN
                    INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
                    VALUES (v_new_variant_id, 'ARRIVAL'::stock_movement_type, v_new_total_pieces, 'Initial stock on creation');
                END IF;

                v_active_variant_ids := array_append(v_active_variant_ids, v_new_variant_id);
            END IF;
        ELSE
            -- Insert new variant added during edit
            IF COALESCE(v_variant.initial_sets, 0) < 0 OR COALESCE(v_variant.initial_loose, 0) < 0 THEN 
                RAISE EXCEPTION 'Initial stock quantities cannot be negative'; 
            END IF;

            v_new_total_pieces := (COALESCE(v_variant.initial_sets, 0) * p_pieces_per_set) + COALESCE(v_variant.initial_loose, 0);
            INSERT INTO variants (product_id, name, barcode, cost_price, selling_price, stock_quantity, stock_sets, is_active)
            VALUES (p_product_id, trim(v_variant.name), v_barcode, COALESCE(v_variant.cost_price, 0), v_variant.selling_price, v_new_total_pieces, COALESCE(v_variant.initial_sets, 0), TRUE)
            RETURNING id INTO v_new_variant_id;
            
            IF v_new_total_pieces > 0 THEN
                INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
                VALUES (v_new_variant_id, 'ARRIVAL'::stock_movement_type, v_new_total_pieces, 'Initial stock on creation');
            END IF;

            v_active_variant_ids := array_append(v_active_variant_ids, v_new_variant_id);
        END IF;
    END LOOP;

    -- BUG 11 FIX: Write off orphaned stock and soft-delete variants removed from this product
    IF array_length(v_active_variant_ids, 1) > 0 THEN
        FOR v_deleted_var IN 
            SELECT id, stock_quantity, stock_sets 
            FROM variants 
            WHERE product_id = p_product_id 
              AND NOT (id = ANY(v_active_variant_ids)) 
              AND is_active = TRUE
            FOR UPDATE
        LOOP
            IF v_deleted_var.stock_quantity <> 0 THEN
                INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
                VALUES (
                    v_deleted_var.id, 
                    'MANUAL_ADJUST'::stock_movement_type, 
                    -v_deleted_var.stock_quantity, 
                    'Variant removed during product edit (Stock written off to zero)'
                );
            END IF;

            UPDATE variants 
            SET is_active = FALSE,
                stock_quantity = 0,
                stock_sets = 0,
                updated_at = NOW()
            WHERE id = v_deleted_var.id;
        END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true, 'product_id', p_product_id);
END;
$$;

GRANT EXECUTE ON FUNCTION update_product_with_variants(UUID, TEXT, UUID, INTEGER, JSONB) TO authenticated, service_role;
