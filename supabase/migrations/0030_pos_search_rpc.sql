-- Migration: 0030_pos_search_rpc.sql

CREATE OR REPLACE FUNCTION search_pos_variants(p_query TEXT)
RETURNS TABLE (
    id UUID,
    name TEXT,
    barcode TEXT,
    selling_price DECIMAL,
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
    LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION search_pos_variants(TEXT) TO authenticated, service_role;
