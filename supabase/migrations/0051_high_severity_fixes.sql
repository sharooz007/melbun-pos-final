-- =====================================================================================
-- Migration 0051: High Severity (P1) Fixes
-- 1. deactivate_customer: Zero-trust database guard against outstanding debt
-- 2. get_dashboard_metrics: Align Gross Profit calculation with get_comprehensive_reports
-- =====================================================================================

-- 1. DEACTIVATE CUSTOMER RPC (With Debt & Store Credit Guards)
CREATE OR REPLACE FUNCTION deactivate_customer(p_customer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_credit DECIMAL(10,2) := 0;
    v_dues DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Customer ID is required'; END IF;

    SELECT COALESCE(credit_balance, 0) INTO v_credit 
    FROM customers 
    WHERE id = p_customer_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found';
    END IF;

    IF v_credit > 0 THEN
        RAISE EXCEPTION 'Cannot deactivate customer with an active store credit wallet balance of %.', v_credit;
    END IF;

    SELECT COALESCE(pending_dues, 0) INTO v_dues
    FROM customer_metrics
    WHERE id = p_customer_id;

    IF v_dues > 0 THEN
        RAISE EXCEPTION 'Cannot deactivate customer with an outstanding debt balance of %.', v_dues;
    END IF;

    UPDATE customers 
    SET is_active = FALSE, 
        updated_at = NOW() 
    WHERE id = p_customer_id;

    RETURN jsonb_build_object('success', true, 'customer_id', p_customer_id, 'is_active', false);
END;
$$;


-- 2. GET DASHBOARD METRICS RPC (Align Gross Profit with Comprehensive Reports)
CREATE OR REPLACE FUNCTION get_dashboard_metrics(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_gross_sales DECIMAL(12, 2) := 0.00;
    v_total_collected DECIMAL(12, 2) := 0.00;
    v_invoice_count INTEGER := 0;
    v_raw_profit DECIMAL(12, 2) := 0.00;
    v_total_discount DECIMAL(12, 2) := 0.00;
    v_gross_profit DECIMAL(12, 2) := 0.00;
    v_total_expenses DECIMAL(12, 2) := 0.00;
    v_net_profit DECIMAL(12, 2) := 0.00;
BEGIN
    -- 1. Gross Sales, Discounts & Invoice Count
    SELECT 
        COALESCE(SUM(final_total), 0),
        COALESCE(SUM(discount_amount), 0),
        COUNT(id)
    INTO v_gross_sales, v_total_discount, v_invoice_count
    FROM invoices
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE
      AND is_hidden = FALSE;

    -- 2. Payments Collected in Period (Including STORE_CREDIT)
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_total_collected
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
      AND (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE));

    -- 3. Gross Profit (Snapshot item profits minus invoice discounts) - UNCLAMPED
    SELECT COALESCE(SUM(ii.profit_snapshot), 0)
    INTO v_raw_profit
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
      AND i.is_voided = FALSE
      AND i.is_hidden = FALSE;

    v_gross_profit := v_raw_profit - v_total_discount;

    -- 4. Total Expenses in Period
    SELECT COALESCE(SUM(amount), 0)
    INTO v_total_expenses
    FROM expenses
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE
      AND is_hidden = FALSE;

    -- 5. Net Profit
    v_net_profit := v_gross_profit - v_total_expenses;

    RETURN jsonb_build_object(
        'success', true,
        'gross_sales', v_gross_sales,
        'total_collected', v_total_collected,
        'invoice_count', v_invoice_count,
        'gross_profit', v_gross_profit,
        'total_expenses', v_total_expenses,
        'net_profit', v_net_profit
    );
END;
$$;
