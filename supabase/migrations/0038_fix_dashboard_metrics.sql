-- Migration: 0038_fix_dashboard_metrics.sql
-- Fixes soft-deleted variants leaking into Low Stock Alerts.

CREATE OR REPLACE FUNCTION get_dashboard_metrics(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_total_sales DECIMAL(10,2) := 0;
    v_total_discount DECIMAL(10,2) := 0;
    v_raw_profit DECIMAL(10,2) := 0;
    v_gross_profit DECIMAL(10,2) := 0;
    v_total_collected DECIMAL(10,2) := 0;
    v_total_expenses DECIMAL(10,2) := 0;
    v_net_profit DECIMAL(10,2) := 0;
    v_total_invoices INTEGER := 0;
    v_low_stock_items JSONB;
BEGIN
    -- 1. Auth Check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    -- 2. Boundary & Null Parameter Defense
    IF p_start_date IS NULL OR p_end_date IS NULL THEN
        RAISE EXCEPTION 'p_start_date and p_end_date parameters are required.';
    END IF;

    IF p_start_date > p_end_date THEN
        RAISE EXCEPTION 'p_start_date cannot be greater than p_end_date.';
    END IF;

    -- 3. Invoices Aggregation (Sales, Discounts, Count)
    SELECT 
        COALESCE(SUM(final_total), 0),
        COALESCE(SUM(discount_amount), 0),
        COUNT(id)
    INTO v_total_sales, v_total_discount, v_total_invoices
    FROM invoices
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE;

    -- 4. Gross Profit (Snapshot Items minus Invoice-Level Global Discounts)
    SELECT COALESCE(SUM(ii.profit_snapshot), 0)
    INTO v_raw_profit
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
      AND i.is_voided = FALSE;

    v_gross_profit := v_raw_profit - v_total_discount;

    -- 5. Total Collected Payments (Including Standalone Tab Payments, Excluding Voided Invoices)
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_total_collected
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
      AND (p.invoice_id IS NULL OR i.is_voided = FALSE);

    -- 6. Total Expenses (Excluding Voided)
    SELECT COALESCE(SUM(amount), 0)
    INTO v_total_expenses
    FROM expenses
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE;

    -- 7. Net Profit Calculation
    v_net_profit := v_gross_profit - v_total_expenses;

    -- 8. Deterministic Low Stock Alert (Sorted by lowest stock first, stock <= 5)
    -- BUG FIX: Filter by is_active = TRUE so soft-deleted variants don't show up.
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'variant_id', sub.id,
            'name', sub.name,
            'stock_quantity', sub.stock_quantity
        )
    ), '[]'::jsonb)
    INTO v_low_stock_items
    FROM (
        SELECT id, name, stock_quantity
        FROM variants
        WHERE stock_quantity <= 5 AND is_active = TRUE
        ORDER BY stock_quantity ASC, name ASC
        LIMIT 10
    ) sub;

    -- 10. Return Structured Metrics
    RETURN jsonb_build_object(
        'net_sales', v_total_sales,
        'gross_profit', v_gross_profit,
        'total_expenses', v_total_expenses,
        'net_profit', v_net_profit,
        'collected_payments', v_total_collected,
        'invoice_count', v_total_invoices,
        'low_stock_items', v_low_stock_items
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_metrics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
