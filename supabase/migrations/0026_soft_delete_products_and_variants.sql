-- Migration: 0026_soft_delete_products_and_variants.sql

-- 1. Add Soft Delete Columns
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Add Performance Indexes
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_variants_is_active ON variants(is_active);
CREATE INDEX IF NOT EXISTS idx_variants_product_is_active ON variants(product_id, is_active);

-- 3. Replace Global Unique Barcode Constraint with Partial Unique Index (Active only)
ALTER TABLE variants DROP CONSTRAINT IF EXISTS variants_barcode_key;
DROP INDEX IF EXISTS idx_variants_barcode_active;
CREATE UNIQUE INDEX idx_variants_barcode_active ON variants(barcode) WHERE is_active = TRUE;

-- 4. Harden Barcode Generator to avoid collisions with active barcodes
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
        new_barcode := 'MB' || upper(substring(encode(extensions.gen_random_bytes(6), 'hex') from 1 for 6));
        IF NOT EXISTS (SELECT 1 FROM variants WHERE barcode = new_barcode AND is_active = TRUE) THEN
            done := TRUE;
        END IF;
    END LOOP;
    RETURN new_barcode;
END;
$$;

-- 5. Hardened Soft Delete RPC
CREATE OR REPLACE FUNCTION soft_delete_product(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_updated_rows INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    UPDATE products 
    SET is_active = FALSE, updated_at = NOW() 
    WHERE id = p_product_id;
    
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows = 0 THEN
        RAISE EXCEPTION 'Product not found or already deleted';
    END IF;

    UPDATE variants 
    SET is_active = FALSE, updated_at = NOW() 
    WHERE product_id = p_product_id;

    RETURN jsonb_build_object('success', true, 'product_id', p_product_id);
END;
$$;

-- 6. Hardened Update Product With Variants RPC
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
    SET name = trim(p_name), 
        category_id = p_category_id, 
        pieces_per_set = p_pieces_per_set, 
        is_active = TRUE, 
        updated_at = NOW()
    WHERE id = p_product_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found';
    END IF;

    -- Upsert Variants
    FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_variants) AS x(id UUID, name TEXT, barcode TEXT, cost_price DECIMAL, selling_price DECIMAL)
    LOOP
        IF v_variant.name IS NULL OR trim(v_variant.name) = '' THEN
            RAISE EXCEPTION 'Variant name cannot be empty';
        END IF;

        IF v_variant.selling_price IS NULL OR v_variant.selling_price < 0 THEN
            RAISE EXCEPTION 'Variant selling price must be non-negative';
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
                -- If an ID was supplied that did not match this product, insert cleanly
                INSERT INTO variants (product_id, name, barcode, cost_price, selling_price, stock_quantity, stock_sets, is_active)
                VALUES (p_product_id, trim(v_variant.name), v_barcode, COALESCE(v_variant.cost_price, 0), v_variant.selling_price, 0, 0, TRUE)
                RETURNING id INTO v_new_variant_id;
                
                v_active_variant_ids := array_append(v_active_variant_ids, v_new_variant_id);
            END IF;
        ELSE
            -- CRITICAL FIX: Capture RETURNING id and append to active array
            INSERT INTO variants (product_id, name, barcode, cost_price, selling_price, stock_quantity, stock_sets, is_active)
            VALUES (p_product_id, trim(v_variant.name), v_barcode, COALESCE(v_variant.cost_price, 0), v_variant.selling_price, 0, 0, TRUE)
            RETURNING id INTO v_new_variant_id;
            
            v_active_variant_ids := array_append(v_active_variant_ids, v_new_variant_id);
        END IF;
    END LOOP;

    -- Soft-delete only variants that exist on this product but were removed in this payload
    IF array_length(v_active_variant_ids, 1) > 0 THEN
        UPDATE variants 
        SET is_active = FALSE, updated_at = NOW() 
        WHERE product_id = p_product_id 
          AND NOT (id = ANY(v_active_variant_ids))
          AND is_active = TRUE;
    END IF;

    RETURN jsonb_build_object('success', true, 'product_id', p_product_id);
END;
$$;
