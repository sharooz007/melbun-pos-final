-- Migration: 0049_reports_and_medium_fixes.sql
-- Hardens get_comprehensive_reports to include STORE_CREDIT in payment breakdown while preserving all 8 KPIs, business-day cutoff, and 12 drilldown tabs.

CREATE OR REPLACE FUNCTION get_comprehensive_reports(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_cutoff_hour INTEGER := 6;
    v_timezone TEXT := 'Asia/Kolkata';
    v_total_sales DECIMAL(10,2) := 0;
    v_total_discount DECIMAL(10,2) := 0;
    v_invoice_count INTEGER := 0;
    v_total_collected DECIMAL(10,2) := 0;
    v_cash_collected DECIMAL(10,2) := 0;
    v_upi_collected DECIMAL(10,2) := 0;
    v_store_credit_collected DECIMAL(10,2) := 0;
    v_outstanding_dues DECIMAL(10,2) := 0;
    v_total_expenses DECIMAL(10,2) := 0;
    v_raw_profit DECIMAL(10,2) := 0;
    v_gross_profit DECIMAL(10,2) := 0;
    v_net_profit DECIMAL(10,2) := 0;
    v_stock_at_cost DECIMAL(10,2) := 0;

    -- Tab datasets
    v_invoices JSONB;
    v_expenses_list JSONB;
    v_daily_sales JSONB;
    v_monthly_sales JSONB;
    v_credits JSONB;
    v_monthly_profit JSONB;
    v_profit_by_product JSONB;
    v_by_product JSONB;
    v_by_category JSONB;
    v_stock_cost JSONB;
    v_stock_moves JSONB;
    v_stock_by_category JSONB;
    v_sales_trend JSONB;
BEGIN
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; 
    END IF;

    IF p_start_date IS NULL OR p_end_date IS NULL THEN
        RAISE EXCEPTION 'p_start_date and p_end_date are required.';
    END IF;

    IF p_start_date > p_end_date THEN
        RAISE EXCEPTION 'p_start_date cannot be greater than p_end_date.';
    END IF;

    -- Fetch store settings for business day cutoff
    SELECT 
        COALESCE(business_day_start_hour, 6),
        COALESCE(timezone, 'Asia/Kolkata')
    INTO v_cutoff_hour, v_timezone
    FROM store_settings
    ORDER BY created_at ASC
    LIMIT 1;

    -- 1. Sales & Invoice Count (Non-voided & Non-hidden)
    SELECT 
        COALESCE(SUM(final_total), 0),
        COALESCE(SUM(discount_amount), 0),
        COUNT(id)
    INTO v_total_sales, v_total_discount, v_invoice_count
    FROM invoices
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE
      AND is_hidden = FALSE;

    -- 2. Gross Profit (Snapshot item profits minus invoice discounts)
    SELECT COALESCE(SUM(ii.profit_snapshot), 0)
    INTO v_raw_profit
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
      AND i.is_voided = FALSE
      AND i.is_hidden = FALSE;

    v_gross_profit := GREATEST(0.00, v_raw_profit - v_total_discount);

    -- 3. Payments Collected in Period (Including STORE_CREDIT)
    SELECT 
        COALESCE(SUM(p.amount), 0),
        COALESCE(SUM(CASE WHEN p.method = 'CASH' THEN p.amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN p.method = 'UPI' THEN p.amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN p.method = 'STORE_CREDIT' THEN p.amount ELSE 0 END), 0)
    INTO v_total_collected, v_cash_collected, v_upi_collected, v_store_credit_collected
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
      AND (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE));

    -- 4. Outstanding Dues (All-time open positive dues across active customers)
    SELECT COALESCE(SUM(GREATEST(0.00, pending_dues)), 0)
    INTO v_outstanding_dues
    FROM customer_metrics
    WHERE is_active = TRUE;

    -- 5. Total Expenses in Period (Non-voided & Non-hidden)
    SELECT COALESCE(SUM(amount), 0)
    INTO v_total_expenses
    FROM expenses
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE
      AND is_hidden = FALSE;

    -- 6. Net Profit
    v_net_profit := v_gross_profit - v_total_expenses;

    -- 7. Current Stock Valuation at Cost (Active variants of active products)
    SELECT COALESCE(SUM(v.stock_quantity * v.cost_price), 0)
    INTO v_stock_at_cost
    FROM variants v
    JOIN products p ON v.product_id = p.id
    WHERE v.is_active = TRUE AND p.is_active = TRUE;

    -- Tab 1: Invoices List
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', inv.id,
            'invoice_number', inv.invoice_number,
            'created_at', inv.created_at,
            'final_total', inv.final_total,
            'is_voided', inv.is_voided,
            'customer_name', COALESCE(c.name, 'Walk-in Customer'),
            'paid_amount', COALESCE(pm.total_paid, 0),
            'primary_method', COALESCE(pm.primary_method, 'CASH'),
            'status', CASE 
                WHEN inv.is_voided THEN 'Void'
                WHEN COALESCE(pm.total_paid, 0) >= inv.final_total THEN 'Paid'
                WHEN COALESCE(pm.total_paid, 0) > 0 THEN 'Partial'
                ELSE 'Unpaid'
            END
        ) ORDER BY inv.created_at DESC
    ), '[]'::jsonb)
    INTO v_invoices
    FROM invoices inv
    LEFT JOIN customers c ON inv.customer_id = c.id
    LEFT JOIN LATERAL (
        SELECT 
            COALESCE(SUM(amount), 0) AS total_paid,
            (ARRAY_AGG(method ORDER BY amount DESC))[1]::TEXT AS primary_method
        FROM payments
        WHERE invoice_id = inv.id
    ) pm ON true
    WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
      AND inv.is_hidden = FALSE;

    -- Tab 2: Expenses List
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', e.id,
            'category', e.category,
            'amount', e.amount,
            'payment_method', e.payment_method,
            'created_at', e.created_at,
            'notes', e.notes
        ) ORDER BY e.created_at DESC
    ), '[]'::jsonb)
    INTO v_expenses_list
    FROM expenses e
    WHERE e.created_at >= p_start_date AND e.created_at <= p_end_date
      AND e.is_voided = FALSE
      AND e.is_hidden = FALSE;

    -- Tab 3: Daily Sales (Grouped by Business Day with Timezone Shift)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'date', d.b_day::TEXT,
            'invoice_count', COALESCE(inv_d.inv_count, 0),
            'gross_sales', COALESCE(inv_d.gross_sales, 0),
            'discount', COALESCE(inv_d.discount, 0),
            'net_sales', COALESCE(inv_d.net_sales, 0),
            'collected', COALESCE(pay_d.collected, 0)
        ) ORDER BY d.b_day DESC
    ), '[]'::jsonb)
    INTO v_daily_sales
    FROM (
        WITH invoice_days AS (
            SELECT 
                ((i.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::INTERVAL)::DATE AS b_day,
                COUNT(i.id) AS inv_count,
                COALESCE(SUM(i.subtotal), 0) AS gross_sales,
                COALESCE(SUM(i.discount_amount), 0) AS discount,
                COALESCE(SUM(i.final_total), 0) AS net_sales
            FROM invoices i
            WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
            GROUP BY 1
        ),
        payment_days AS (
            SELECT 
                ((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::INTERVAL)::DATE AS b_day,
                COALESCE(SUM(p.amount), 0) AS collected
            FROM payments p
            LEFT JOIN invoices i ON p.invoice_id = i.id
            WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
              AND (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE))
            GROUP BY 1
        ),
        all_days AS (
            SELECT b_day FROM invoice_days
            UNION
            SELECT b_day FROM payment_days
        )
        SELECT 
            all_days.b_day,
            inv_d.inv_count,
            inv_d.gross_sales,
            inv_d.discount,
            inv_d.net_sales,
            pay_d.collected
        FROM all_days
        LEFT JOIN invoice_days inv_d ON all_days.b_day = inv_d.b_day
        LEFT JOIN payment_days pay_d ON all_days.b_day = pay_d.b_day
    ) d;

    -- Tab 4: Monthly Sales
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', m.b_month,
            'invoice_count', COALESCE(inv_m.inv_count, 0),
            'gross_sales', COALESCE(inv_m.gross_sales, 0),
            'discount', COALESCE(inv_m.discount, 0),
            'net_sales', COALESCE(inv_m.net_sales, 0),
            'collected', COALESCE(pay_m.collected, 0)
        ) ORDER BY m.b_month DESC
    ), '[]'::jsonb)
    INTO v_monthly_sales
    FROM (
        WITH invoice_months AS (
            SELECT 
                to_char(((i.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::INTERVAL), 'YYYY-MM') AS b_month,
                COUNT(i.id) AS inv_count,
                COALESCE(SUM(i.subtotal), 0) AS gross_sales,
                COALESCE(SUM(i.discount_amount), 0) AS discount,
                COALESCE(SUM(i.final_total), 0) AS net_sales
            FROM invoices i
            WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
            GROUP BY 1
        ),
        payment_months AS (
            SELECT 
                to_char(((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::INTERVAL), 'YYYY-MM') AS b_month,
                COALESCE(SUM(p.amount), 0) AS collected
            FROM payments p
            LEFT JOIN invoices i ON p.invoice_id = i.id
            WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
              AND (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE))
            GROUP BY 1
        ),
        all_months AS (
            SELECT b_month FROM invoice_months
            UNION
            SELECT b_month FROM payment_months
        )
        SELECT 
            all_months.b_month,
            inv_m.inv_count,
            inv_m.gross_sales,
            inv_m.discount,
            inv_m.net_sales,
            pay_m.collected
        FROM all_months
        LEFT JOIN invoice_months inv_m ON all_months.b_month = inv_m.b_month
        LEFT JOIN payment_months pay_m ON all_months.b_month = pay_m.b_month
    ) m;

    -- Tab 5: Credits & Receivables
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'customer_id', cm.id,
            'customer_name', cm.name,
            'phone', cm.phone,
            'total_spend', cm.total_spend,
            'total_paid', cm.total_paid,
            'pending_dues', cm.pending_dues
        ) ORDER BY cm.pending_dues DESC
    ), '[]'::jsonb)
    INTO v_credits
    FROM customer_metrics cm
    WHERE cm.is_active = TRUE AND cm.pending_dues <> 0;

    -- Tab 6: Monthly Profit
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', m.b_month,
            'sales', COALESCE(im.sales, 0),
            'cogs', COALESCE(im.cogs, 0),
            'gross_profit', GREATEST(0.00, COALESCE(im.profit_sum, 0) - COALESCE(im.discount, 0)),
            'expenses', COALESCE(em.expenses, 0),
            'net_profit', (GREATEST(0.00, COALESCE(im.profit_sum, 0) - COALESCE(im.discount, 0)) - COALESCE(em.expenses, 0))
        ) ORDER BY m.b_month DESC
    ), '[]'::jsonb)
    INTO v_monthly_profit
    FROM (
        WITH invoice_months AS (
            SELECT 
                to_char(((i.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::INTERVAL), 'YYYY-MM') AS b_month,
                COALESCE(SUM(i.final_total), 0) AS sales,
                COALESCE(SUM(i.discount_amount), 0) AS discount,
                COALESCE(SUM(ii_summary.cost_sum), 0) AS cost_sum,
                COALESCE(SUM(ii_summary.profit_sum), 0) AS profit_sum
            FROM invoices i
            LEFT JOIN LATERAL (
                SELECT 
                    COALESCE(SUM(quantity * cost_price_snapshot), 0) AS cost_sum,
                    COALESCE(SUM(profit_snapshot), 0) AS profit_sum
                FROM invoice_items
                WHERE invoice_id = i.id
            ) ii_summary ON true
            WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
            GROUP BY 1
        ),
        expense_months AS (
            SELECT 
                to_char(((e.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::INTERVAL), 'YYYY-MM') AS b_month,
                COALESCE(SUM(e.amount), 0) AS expenses
            FROM expenses e
            WHERE e.created_at >= p_start_date AND e.created_at <= p_end_date
              AND e.is_voided = FALSE AND e.is_hidden = FALSE
            GROUP BY 1
        ),
        all_months AS (
            SELECT b_month FROM invoice_months
            UNION
            SELECT b_month FROM expense_months
        )
        SELECT 
            all_months.b_month,
            im.sales,
            im.cogs,
            im.profit_sum,
            im.discount,
            em.expenses
        FROM all_months
        LEFT JOIN invoice_months im ON all_months.b_month = im.b_month
        LEFT JOIN expense_months em ON all_months.b_month = em.b_month
    ) m;

    -- Tab 7: Profit by Product
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_name', sub.p_name,
            'variant_name', sub.v_name,
            'quantity_sold', sub.qty_sold,
            'revenue', sub.revenue,
            'cogs', sub.cogs,
            'profit', sub.profit,
            'margin_percent', CASE WHEN sub.revenue > 0 THEN ROUND((sub.profit / sub.revenue) * 100, 1) ELSE 0 END
        ) ORDER BY sub.profit DESC
    ), '[]'::jsonb)
    INTO v_profit_by_product
    FROM (
        SELECT 
            p.name AS p_name,
            v.name AS v_name,
            SUM(ii.quantity) AS qty_sold,
            SUM(ii.quantity * ii.selling_price_snapshot) AS revenue,
            SUM(ii.quantity * ii.cost_price_snapshot) AS cogs,
            SUM(ii.profit_snapshot) AS profit
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
          AND i.is_voided = FALSE AND i.is_hidden = FALSE
        GROUP BY p.id, v.id, p.name, v.name
    ) sub;

    -- Tab 8: By Product (Volume & Gross Sales)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_name', sub.p_name,
            'quantity_sold', sub.qty_sold,
            'total_sales', sub.sales
        ) ORDER BY sub.sales DESC
    ), '[]'::jsonb)
    INTO v_by_product
    FROM (
        SELECT 
            p.name AS p_name,
            SUM(ii.quantity) AS qty_sold,
            SUM(ii.quantity * ii.selling_price_snapshot) AS sales
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
          AND i.is_voided = FALSE AND i.is_hidden = FALSE
        GROUP BY p.id, p.name
    ) sub;

    -- Tab 9: By Category
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'category_name', sub.c_name,
            'quantity_sold', sub.qty_sold,
            'total_sales', sub.sales,
            'total_profit', sub.profit
        ) ORDER BY sub.sales DESC
    ), '[]'::jsonb)
    INTO v_by_category
    FROM (
        SELECT 
            COALESCE(c.name, 'Uncategorized') AS c_name,
            SUM(ii.quantity) AS qty_sold,
            SUM(ii.quantity * ii.selling_price_snapshot) AS sales,
            SUM(ii.profit_snapshot) AS profit
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
          AND i.is_voided = FALSE AND i.is_hidden = FALSE
        GROUP BY COALESCE(c.name, 'Uncategorized')
    ) sub;

    -- Tab 10: Stock Cost Valuation per Variant
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_name', p.name,
            'variant_name', v.name,
            'barcode', v.barcode,
            'stock_quantity', v.stock_quantity,
            'stock_sets', v.stock_sets,
            'cost_price', v.cost_price,
            'selling_price', v.selling_price,
            'total_cost', (v.stock_quantity * v.cost_price)
        ) ORDER BY (v.stock_quantity * v.cost_price) DESC
    ), '[]'::jsonb)
    INTO v_stock_cost
    FROM variants v
    JOIN products p ON v.product_id = p.id
    WHERE v.is_active = TRUE AND p.is_active = TRUE;

    -- Tab 11: Stock Movements in Period
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', sub.id,
            'type', sub.type::TEXT,
            'quantity_change', sub.quantity_change,
            'created_at', sub.created_at,
            'product_name', sub.p_name,
            'variant_name', sub.v_name,
            'notes', sub.notes
        ) ORDER BY sub.created_at DESC
    ), '[]'::jsonb)
    INTO v_stock_moves
    FROM (
        SELECT sm.id, sm.type, sm.quantity_change, sm.created_at, p.name AS p_name, v.name AS v_name, sm.notes
        FROM stock_movements sm
        LEFT JOIN variants v ON sm.variant_id = v.id
        LEFT JOIN products p ON v.product_id = p.id
        WHERE sm.created_at >= p_start_date AND sm.created_at <= p_end_date
        ORDER BY sm.created_at DESC
        LIMIT 500
    ) sub;

    -- Tab 12: Stock Valuation by Category
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'category_name', sub.c_name,
            'total_pieces', sub.total_qty,
            'total_valuation', sub.total_cost
        ) ORDER BY sub.total_cost DESC
    ), '[]'::jsonb)
    INTO v_stock_by_category
    FROM (
        SELECT 
            COALESCE(c.name, 'Uncategorized') AS c_name,
            SUM(v.stock_quantity) AS total_qty,
            SUM(v.stock_quantity * v.cost_price) AS total_cost
        FROM variants v
        JOIN products p ON v.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE v.is_active = TRUE AND p.is_active = TRUE
        GROUP BY COALESCE(c.name, 'Uncategorized')
    ) sub;

    -- Sales & Collections Trend Series for Graph
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'label', to_char(d.b_day, 'DD Mon'),
            'date', d.b_day::TEXT,
            'sales', COALESCE(inv_d.sales, 0),
            'collected', COALESCE(pay_d.collected, 0)
        ) ORDER BY d.b_day ASC
    ), '[]'::jsonb)
    INTO v_sales_trend
    FROM (
        WITH invoice_days AS (
            SELECT 
                ((i.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::INTERVAL)::DATE AS b_day,
                COALESCE(SUM(i.final_total), 0) AS sales
            FROM invoices i
            WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
            GROUP BY 1
        ),
        payment_days AS (
            SELECT 
                ((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::INTERVAL)::DATE AS b_day,
                COALESCE(SUM(p.amount), 0) AS collected
            FROM payments p
            LEFT JOIN invoices i ON p.invoice_id = i.id
            WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
              AND (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE))
            GROUP BY 1
        ),
        all_days AS (
            SELECT b_day FROM invoice_days
            UNION
            SELECT b_day FROM payment_days
        )
        SELECT 
            all_days.b_day,
            inv_d.sales,
            pay_d.collected
        FROM all_days
        LEFT JOIN invoice_days inv_d ON all_days.b_day = inv_d.b_day
        LEFT JOIN payment_days pay_d ON all_days.b_day = pay_d.b_day
    ) d;

    -- Final Report Response Payload
    RETURN jsonb_build_object(
        'total_sales', v_total_sales,
        'collected', v_total_collected,
        'outstanding_dues', v_outstanding_dues,
        'invoice_count', v_invoice_count,
        'avg_invoice_value', CASE WHEN v_invoice_count > 0 THEN ROUND(v_total_sales / v_invoice_count, 2) ELSE 0.00 END,
        'expenses', v_total_expenses,
        'gross_profit', v_gross_profit,
        'net_profit', v_net_profit,
        'stock_at_cost', v_stock_at_cost,
        'payment_breakdown', jsonb_build_object(
            'cash_amount', v_cash_collected,
            'cash_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_cash_collected / v_total_collected) * 100, 1) ELSE 0 END,
            'upi_amount', v_upi_collected,
            'upi_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_upi_collected / v_total_collected) * 100, 1) ELSE 0 END,
            'store_credit_amount', v_store_credit_collected,
            'store_credit_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_store_credit_collected / v_total_collected) * 100, 1) ELSE 0 END,
            'total_collected', v_total_collected
        ),
        'sales_trend', v_sales_trend,
        'invoices', v_invoices,
        'expenses_list', v_expenses_list,
        'daily_sales', v_daily_sales,
        'monthly_sales', v_monthly_sales,
        'credits', v_credits,
        'monthly_profit', v_monthly_profit,
        'profit_by_product', v_profit_by_product,
        'by_product', v_by_product,
        'by_category', v_by_category,
        'stock_cost', v_stock_cost,
        'stock_moves', v_stock_moves,
        'stock_by_category', v_stock_by_category
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_comprehensive_reports(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
