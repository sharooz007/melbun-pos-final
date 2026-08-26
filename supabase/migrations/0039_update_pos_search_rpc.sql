-- Migration: 0039_update_pos_search_rpc.sql
-- Return stock_quantity and stock_sets in search_pos_variants for POS and Lookup scanner

DROP FUNCTION IF EXISTS search_pos_variants(TEXT);

CREATE OR REPLACE FUNCTION search_pos_variants(p_query TEXT)
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
BEGIN
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
        p.pieces_per_set
    FROM variants v
    JOIN products p ON v.product_id = p.id
    WHERE v.is_active = TRUE 
      AND p.is_active = TRUE
      AND (
          v.name ILIKE '%' || p_query || '%' OR
          v.barcode ILIKE '%' || p_query || '%' OR
          p.name ILIKE '%' || p_query || '%'
      )
    ORDER BY p.name, v.name
    LIMIT 25;
END;
$$;

GRANT EXECUTE ON FUNCTION search_pos_variants(TEXT) TO authenticated, service_role;
