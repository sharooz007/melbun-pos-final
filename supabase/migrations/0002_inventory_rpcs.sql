-- Migration: 0002_inventory_rpcs.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Helper to generate collision-resistant barcode if none supplied
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
        new_barcode := 'MB' || upper(substring(encode(gen_random_bytes(6), 'hex') from 1 for 6));
        IF NOT EXISTS (SELECT 1 FROM variants WHERE barcode = new_barcode) THEN
            done := TRUE;
        END IF;
    END LOOP;
    RETURN new_barcode;
END;
$$;

-- 1. Create Product & Variants Atomically
CREATE OR REPLACE FUNCTION create_product_with_variants(
    p_name TEXT,
    p_brand TEXT,
    p_pieces_per_set INTEGER DEFAULT 1,
    p_variants JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_new_product_id UUID;
    v_new_variant_id UUID;
    v_variant RECORD;
    v_barcode TEXT;
    v_result JSONB;
BEGIN
    -- Auth check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated';
    END IF;

    -- Defensive validation on Product
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'Product name cannot be empty';
    END IF;

    IF p_brand IS NULL OR trim(p_brand) = '' THEN
        RAISE EXCEPTION 'Product brand cannot be empty';
    END IF;

    IF p_pieces_per_set IS NULL OR p_pieces_per_set < 1 THEN
        RAISE EXCEPTION 'pieces_per_set must be at least 1';
    END IF;

    IF p_variants IS NULL OR jsonb_typeof(p_variants) <> 'array' OR jsonb_array_length(p_variants) = 0 THEN
        RAISE EXCEPTION 'At least one variant is required to create a product';
    END IF;

    -- 1. Insert Product
    INSERT INTO products (name, brand, pieces_per_set)
    VALUES (trim(p_name), trim(p_brand), p_pieces_per_set)
    RETURNING id INTO v_new_product_id;

    -- 2. Insert Variants & Record Initial Stock Movements if any
    FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_variants) AS x(
        name TEXT,
        barcode TEXT,
        cost_price DECIMAL(10,2),
        selling_price DECIMAL(10,2),
        initial_stock INTEGER
    )
    LOOP
        IF v_variant.name IS NULL OR trim(v_variant.name) = '' THEN
            RAISE EXCEPTION 'Variant name cannot be empty';
        END IF;

        IF v_variant.cost_price IS NULL OR v_variant.cost_price < 0 THEN
            RAISE EXCEPTION 'Cost price must be non-negative';
        END IF;

        IF v_variant.selling_price IS NULL OR v_variant.selling_price < 0 THEN
            RAISE EXCEPTION 'Selling price must be non-negative';
        END IF;

        IF v_variant.initial_stock IS NOT NULL AND v_variant.initial_stock < 0 THEN
            RAISE EXCEPTION 'Initial stock cannot be negative';
        END IF;

        -- Use supplied barcode or generate unique one
        IF v_variant.barcode IS NOT NULL AND trim(v_variant.barcode) <> '' THEN
            v_barcode := upper(trim(v_variant.barcode));
            IF EXISTS (SELECT 1 FROM variants WHERE barcode = v_barcode) THEN
                RAISE EXCEPTION 'Barcode % already exists in the system', v_barcode;
            END IF;
        ELSE
            v_barcode := generate_unique_barcode();
        END IF;

        INSERT INTO variants (
            product_id,
            barcode,
            name,
            cost_price,
            selling_price,
            stock_quantity
        ) VALUES (
            v_new_product_id,
            v_barcode,
            trim(v_variant.name),
            v_variant.cost_price,
            v_variant.selling_price,
            COALESCE(v_variant.initial_stock, 0)
        )
        RETURNING id INTO v_new_variant_id;

        -- Audit Trail for Initial Stock (pos-v2 No Phantom Stock rule)
        IF COALESCE(v_variant.initial_stock, 0) > 0 THEN
            INSERT INTO stock_movements (
                variant_id,
                type,
                quantity_change,
                notes
            ) VALUES (
                v_new_variant_id,
                'ARRIVAL'::stock_movement_type,
                v_variant.initial_stock,
                'Initial opening stock on product creation'
            );
        END IF;
    END LOOP;

    -- 3. Return full aggregated object
    SELECT jsonb_build_object(
        'product', (SELECT row_to_json(p) FROM products p WHERE p.id = v_new_product_id),
        'variants', (SELECT jsonb_agg(row_to_json(v)) FROM variants v WHERE v.product_id = v_new_product_id)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 2. Bulk Stock Arrival Atomically
CREATE OR REPLACE FUNCTION process_stock_arrival(
    p_movements JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_item RECORD;
    v_updated_count INTEGER := 0;
BEGIN
    -- Auth check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated';
    END IF;

    IF p_movements IS NULL OR jsonb_typeof(p_movements) <> 'array' OR jsonb_array_length(p_movements) = 0 THEN
        RAISE EXCEPTION 'Movements array cannot be empty';
    END IF;

    -- Validate all items before making any modifications
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_movements) AS x(
        variant_id UUID,
        quantity INTEGER,
        notes TEXT
    )
    LOOP
        IF v_item.variant_id IS NULL THEN
            RAISE EXCEPTION 'variant_id cannot be null in stock arrival';
        END IF;

        IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Stock arrival quantity must be greater than zero. Received: % for variant %', v_item.quantity, v_item.variant_id;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM variants WHERE id = v_item.variant_id) THEN
            RAISE EXCEPTION 'Variant ID % does not exist', v_item.variant_id;
        END IF;
    END LOOP;

    -- Set-based stock movements insertion
    INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
    SELECT 
        m.variant_id,
        'ARRIVAL'::stock_movement_type,
        m.quantity,
        COALESCE(m.notes, 'Stock Arrival')
    FROM jsonb_to_recordset(p_movements) AS m(variant_id UUID, quantity INTEGER, notes TEXT);

    -- Set-based aggregated stock quantity update
    WITH aggregated_arrivals AS (
        SELECT 
            variant_id, 
            SUM(quantity)::INTEGER AS total_quantity
        FROM jsonb_to_recordset(p_movements) AS x(variant_id UUID, quantity INTEGER, notes TEXT)
        GROUP BY variant_id
        ORDER BY variant_id
    )
    UPDATE variants v
    SET stock_quantity = v.stock_quantity + a.total_quantity
    FROM aggregated_arrivals a
    WHERE v.id = a.variant_id;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'variants_updated', v_updated_count,
        'total_movements_logged', jsonb_array_length(p_movements)
    );
END;
$$;
