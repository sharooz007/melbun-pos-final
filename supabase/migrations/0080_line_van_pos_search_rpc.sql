-- Migration: 0080_line_van_pos_search_rpc.sql
-- 1. Updates search_pos_variants to accept optional p_staff_id UUID
-- When p_staff_id is provided, search exclusively queries line_van_inventory for that linesman.

DROP FUNCTION IF EXISTS search_pos_variants(TEXT);
DROP FUNCTION IF EXISTS search_pos_variants(TEXT, UUID);

CREATE OR REPLACE FUNCTION search_pos_variants(
    p_query TEXT,
    p_staff_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    barcode TEXT,
    selling_price DECIMAL,
    stock_quantity INTEGER,
    stock_sets INTEGER,
    product_id UUID,
    product_name TEXT,
    pieces_per_set INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_query TEXT := NULLIF(trim(p_query), '');
BEGIN
    IF p_staff_id IS NOT NULL THEN
        -- Van-Only Search for Line Sales
        RETURN QUERY
        SELECT 
            v.id,
            (p.name || ' - ' || v.name)::TEXT AS name,
            v.barcode,
            v.selling_price,
            lvi.quantity AS stock_quantity,
            lvi.sets_quantity AS stock_sets,
            p.id AS product_id,
            p.name AS product_name,
            COALESCE(v.pieces_per_set, p.pieces_per_set, 1)::INTEGER AS pieces_per_set
        FROM line_van_inventory lvi
        JOIN variants v ON lvi.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        WHERE lvi.staff_id = p_staff_id
          AND lvi.quantity > 0
          AND v.is_active = TRUE 
          AND p.is_active = TRUE
          AND (
              v_clean_query IS NULL OR
              v.name ILIKE '%' || v_clean_query || '%' OR
              v.barcode ILIKE '%' || v_clean_query || '%' OR
              p.name ILIKE '%' || v_clean_query || '%'
          )
        ORDER BY p.name, v.name
        LIMIT 50;
    ELSE
        -- Main Warehouse / Store Search
        RETURN QUERY
        SELECT 
            v.id,
            (p.name || ' - ' || v.name)::TEXT AS name,
            v.barcode,
            v.selling_price,
            v.stock_quantity,
            v.stock_sets,
            p.id AS product_id,
            p.name AS product_name,
            COALESCE(v.pieces_per_set, p.pieces_per_set, 1)::INTEGER AS pieces_per_set
        FROM variants v
        JOIN products p ON v.product_id = p.id
        WHERE v.is_active = TRUE 
          AND p.is_active = TRUE
          AND (
              v_clean_query IS NULL OR
              v.name ILIKE '%' || v_clean_query || '%' OR
              v.barcode ILIKE '%' || v_clean_query || '%' OR
              p.name ILIKE '%' || v_clean_query || '%'
          )
        ORDER BY p.name, v.name
        LIMIT 50;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION search_pos_variants(TEXT, UUID) TO authenticated, service_role;
