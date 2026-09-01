-- Migration: 0076_harden_stock_arrivals_variant_pps.sql
-- Updates process_stock_arrival to prioritize variant-level pieces_per_set over product-level pieces_per_set.

CREATE OR REPLACE FUNCTION process_stock_arrival(
    p_movements JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_movement RECORD;
    v_total_added INTEGER;
    v_effective_pps INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_movements IS NULL OR jsonb_typeof(p_movements) <> 'array' OR jsonb_array_length(p_movements) = 0 THEN
        RAISE EXCEPTION 'Stock arrival movements cannot be empty.';
    END IF;

    FOR v_movement IN 
        WITH parsed AS (
            SELECT (x->>'variant_id')::UUID AS variant_id, 
                   COALESCE((x->>'sets_quantity')::INTEGER, 0) AS sets_quantity, 
                   COALESCE((x->>'loose_quantity')::INTEGER, 0) AS loose_quantity, 
                   x->>'notes' AS notes 
            FROM jsonb_array_elements(p_movements) AS x
        )
        SELECT p.variant_id, p.sets_quantity, p.loose_quantity, p.notes, 
               COALESCE(v.pieces_per_set, pr.pieces_per_set, 1) AS effective_pps
        FROM parsed p
        JOIN variants v ON p.variant_id = v.id
        JOIN products pr ON v.product_id = pr.id
        ORDER BY p.variant_id
    LOOP
        IF v_movement.sets_quantity < 0 OR v_movement.loose_quantity < 0 THEN 
            RAISE EXCEPTION 'Quantities cannot be negative.'; 
        END IF;

        v_effective_pps := GREATEST(1, v_movement.effective_pps);
        v_total_added := (v_movement.sets_quantity * v_effective_pps) + v_movement.loose_quantity;
        
        IF v_total_added = 0 THEN
            CONTINUE;
        END IF;

        INSERT INTO stock_movements (variant_id, type, quantity_change, notes, created_at)
        VALUES (
            v_movement.variant_id, 
            'ARRIVAL'::stock_movement_type, 
            v_total_added, 
            COALESCE(NULLIF(trim(v_movement.notes), ''), 'Stock Arrival'),
            NOW()
        );

        UPDATE variants 
        SET stock_quantity = stock_quantity + v_total_added,
            stock_sets = stock_sets + v_movement.sets_quantity,
            updated_at = NOW()
        WHERE id = v_movement.variant_id;
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION process_stock_arrival(JSONB) TO authenticated, service_role;
