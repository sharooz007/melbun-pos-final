-- Migration: 0045_stock_ledger_paged_rpc.sql
-- High performance paginated stock ledger with multi-column search and deterministic ordering

CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(type);

CREATE OR REPLACE FUNCTION get_stock_ledger_paged(
    p_page INT DEFAULT 1,
    p_page_size INT DEFAULT 25,
    p_search TEXT DEFAULT NULL,
    p_type TEXT DEFAULT NULL,
    p_start_date TIMESTAMPTZ DEFAULT NULL,
    p_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    type TEXT,
    quantity_change INT,
    notes TEXT,
    created_at TIMESTAMPTZ,
    variant_id UUID,
    variant_name TEXT,
    variant_barcode TEXT,
    product_id UUID,
    product_name TEXT,
    pieces_per_set INT,
    total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_offset INT;
    v_clean_search TEXT := NULLIF(trim(p_search), '');
    v_clean_type TEXT := NULLIF(trim(p_type), '');
BEGIN
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; 
    END IF;

    p_page := GREATEST(1, COALESCE(p_page, 1));
    p_page_size := LEAST(100, GREATEST(1, COALESCE(p_page_size, 25)));
    v_offset := (p_page - 1) * p_page_size;

    RETURN QUERY
    WITH filtered AS (
        SELECT 
            sm.id,
            sm.type::TEXT AS type,
            sm.quantity_change,
            sm.notes,
            sm.created_at,
            v.id AS variant_id,
            v.name AS variant_name,
            v.barcode AS variant_barcode,
            p.id AS product_id,
            p.name AS product_name,
            COALESCE(p.pieces_per_set, 1) AS pieces_per_set
        FROM stock_movements sm
        LEFT JOIN variants v ON sm.variant_id = v.id
        LEFT JOIN products p ON v.product_id = p.id
        WHERE (v_clean_type IS NULL OR v_clean_type = 'ALL' OR sm.type::TEXT = v_clean_type)
          AND (p_start_date IS NULL OR sm.created_at >= p_start_date)
          AND (p_end_date IS NULL OR sm.created_at <= p_end_date)
          AND (
            v_clean_search IS NULL OR
            p.name ILIKE '%' || v_clean_search || '%' OR
            v.name ILIKE '%' || v_clean_search || '%' OR
            v.barcode ILIKE '%' || v_clean_search || '%' OR
            sm.notes ILIKE '%' || v_clean_search || '%'
          )
    ),
    counted AS (
        SELECT COUNT(*) AS total_count FROM filtered
    )
    SELECT 
        f.*,
        COALESCE(c.total_count, 0::BIGINT) AS total_count
    FROM filtered f
    CROSS JOIN counted c
    ORDER BY f.created_at DESC, f.id DESC
    OFFSET v_offset
    LIMIT p_page_size;
END;
$$;

GRANT EXECUTE ON FUNCTION get_stock_ledger_paged(INT, INT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
