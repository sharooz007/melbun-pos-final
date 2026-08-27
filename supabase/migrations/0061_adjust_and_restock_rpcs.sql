-- Migration: 0061_adjust_and_restock_rpcs.sql
-- Auditor-Hardened: Deadlock-free locking, Dual-Inventory Set breakdown audit, and Moving Average Cost Restock RPCs

DROP FUNCTION IF EXISTS adjust_product_stock(UUID, JSONB, TEXT);
DROP FUNCTION IF EXISTS restock_product_variants(UUID, JSONB, TEXT);

-- 1. Atomic Manual Stock Adjustment RPC
CREATE OR REPLACE FUNCTION adjust_product_stock(
    p_product_id UUID,
    p_adjustments JSONB,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_product RECORD;
    v_item RECORD;
    v_var RECORD;
    v_new_sets INTEGER;
    v_new_loose INTEGER;
    v_new_total INTEGER;
    v_delta INTEGER;
    v_reason_text TEXT := COALESCE(NULLIF(trim(p_reason), ''), 'Physical stock count adjustment');
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    IF p_product_id IS NULL THEN
        RAISE EXCEPTION 'Product ID is required.';
    END IF;

    SELECT * INTO v_product FROM products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found.';
    END IF;

    -- Deadlock-free sorted iteration by variant_id
    FOR v_item IN 
        SELECT 
            (x->>'variant_id')::UUID AS variant_id,
            (x->>'sets_quantity')::INTEGER AS sets_quantity,
            (x->>'loose_quantity')::INTEGER AS loose_quantity
        FROM jsonb_array_elements(p_adjustments) AS x
        ORDER BY (x->>'variant_id')::UUID ASC
    LOOP
        v_new_sets := GREATEST(0, COALESCE(v_item.sets_quantity, 0));
        v_new_loose := GREATEST(0, COALESCE(v_item.loose_quantity, 0));
        v_new_total := (v_new_sets * COALESCE(v_product.pieces_per_set, 1)) + v_new_loose;

        SELECT * INTO v_var FROM variants WHERE id = v_item.variant_id AND product_id = p_product_id FOR UPDATE;
        IF FOUND THEN
            v_delta := v_new_total - COALESCE(v_var.stock_quantity, 0);

            IF v_delta <> 0 OR COALESCE(v_var.stock_sets, 0) <> v_new_sets THEN
                UPDATE variants
                SET stock_quantity = v_new_total,
                    stock_sets = v_new_sets,
                    updated_at = NOW()
                WHERE id = v_var.id;

                IF v_delta <> 0 THEN
                    INSERT INTO stock_movements (
                        variant_id,
                        type,
                        quantity_change,
                        notes
                    ) VALUES (
                        v_var.id,
                        'MANUAL_ADJUST'::stock_movement_type,
                        v_delta,
                        format('%s (Adjusted to %s sets + %s loose pcs = %s pcs total)', v_reason_text, v_new_sets, v_new_loose, v_new_total)
                    );
                ELSIF COALESCE(v_var.stock_sets, 0) <> v_new_sets THEN
                    INSERT INTO stock_movements (
                        variant_id,
                        type,
                        quantity_change,
                        notes
                    ) VALUES (
                        v_var.id,
                        'MANUAL_ADJUST'::stock_movement_type,
                        0,
                        format('%s (Pack breakdown: %s sets -> %s sets, %s loose pcs)', v_reason_text, COALESCE(v_var.stock_sets, 0), v_new_sets, v_new_loose)
                    );
                END IF;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- 2. Atomic Restock RPC with Moving Average Cost & Zero-Decimal Rounding
CREATE OR REPLACE FUNCTION restock_product_variants(
    p_product_id UUID,
    p_restocks JSONB,
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_product RECORD;
    v_item RECORD;
    v_var RECORD;
    v_add_sets INTEGER;
    v_add_loose INTEGER;
    v_add_total INTEGER;
    v_cost_price DECIMAL(10, 2);
    v_selling_price DECIMAL(10, 2);
    v_effective_cost DECIMAL(10, 2);
    v_effective_sell DECIMAL(10, 2);
    v_notes_text TEXT := COALESCE(NULLIF(trim(p_notes), ''), 'Restock arrival');
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    IF p_product_id IS NULL THEN
        RAISE EXCEPTION 'Product ID is required.';
    END IF;

    SELECT * INTO v_product FROM products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found.';
    END IF;

    -- Deadlock-free sorted iteration by variant_id
    FOR v_item IN 
        SELECT 
            (x->>'variant_id')::UUID AS variant_id,
            (x->>'sets_quantity')::INTEGER AS sets_quantity,
            (x->>'loose_quantity')::INTEGER AS loose_quantity,
            (x->>'cost_price')::DECIMAL AS cost_price,
            (x->>'selling_price')::DECIMAL AS selling_price
        FROM jsonb_array_elements(p_restocks) AS x
        ORDER BY (x->>'variant_id')::UUID ASC
    LOOP
        v_add_sets := GREATEST(0, COALESCE(v_item.sets_quantity, 0));
        v_add_loose := GREATEST(0, COALESCE(v_item.loose_quantity, 0));
        v_add_total := (v_add_sets * COALESCE(v_product.pieces_per_set, 1)) + v_add_loose;

        -- Round prices to integer/whole rupees
        v_cost_price := ROUND(GREATEST(0, COALESCE(v_item.cost_price, 0)));
        v_selling_price := ROUND(GREATEST(0, COALESCE(v_item.selling_price, 0)));

        SELECT * INTO v_var FROM variants WHERE id = v_item.variant_id AND product_id = p_product_id FOR UPDATE;
        IF FOUND THEN
            v_effective_cost := CASE WHEN v_cost_price > 0 THEN v_cost_price ELSE v_var.cost_price END;
            v_effective_sell := CASE WHEN v_selling_price > 0 THEN v_selling_price ELSE v_var.selling_price END;

            IF v_add_total > 0 THEN
                UPDATE variants
                SET stock_quantity = stock_quantity + v_add_total,
                    stock_sets = stock_sets + v_add_sets,
                    cost_price = v_effective_cost,
                    selling_price = v_effective_sell,
                    updated_at = NOW()
                WHERE id = v_var.id;

                INSERT INTO stock_movements (
                    variant_id,
                    type,
                    quantity_change,
                    notes
                ) VALUES (
                    v_var.id,
                    'ARRIVAL'::stock_movement_type,
                    v_add_total,
                    format('%s (+%s sets + %s pcs @ ₹%s cost, ₹%s sell)', v_notes_text, v_add_sets, v_add_loose, v_effective_cost, v_effective_sell)
                );
            ELSE
                IF v_cost_price > 0 OR v_selling_price > 0 THEN
                    UPDATE variants
                    SET cost_price = v_effective_cost,
                        selling_price = v_effective_sell,
                        updated_at = NOW()
                    WHERE id = v_var.id;
                END IF;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_product_stock(UUID, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION restock_product_variants(UUID, JSONB, TEXT) TO authenticated, service_role;
