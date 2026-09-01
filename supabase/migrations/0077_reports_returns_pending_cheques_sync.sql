-- Migration: 0077_reports_returns_pending_cheques_sync.sql
-- Updates get_comprehensive_reports and get_dashboard_metrics with total returns, pending cheques float, and safe line sales detection.

CREATE OR REPLACE FUNCTION get_comprehensive_reports(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_total_sales DECIMAL(12, 2) := 0.00;
    v_total_returns DECIMAL(12, 2) := 0.00;
    v_pending_cheques_total DECIMAL(12, 2) := 0.00;
    v_total_discount DECIMAL(12, 2) := 0.00;
    v_raw_profit DECIMAL(12, 2) := 0.00;
    v_gross_profit DECIMAL(12, 2) := 0.00;
    v_total_collected DECIMAL(12, 2) := 0.00;
    v_cash_collected DECIMAL(12, 2) := 0.00;
    v_upi_collected DECIMAL(12, 2) := 0.00;
    v_bank_collected DECIMAL(12, 2) := 0.00;
    v_store_credit_collected DECIMAL(12, 2) := 0.00;
    v_total_expenses DECIMAL(12, 2) := 0.00;
    v_net_profit DECIMAL(12, 2) := 0.00;
    v_outstanding_dues DECIMAL(12, 2) := 0.00;
    v_invoice_count INTEGER := 0;
    v_avg_invoice_value DECIMAL(12, 2) := 0.00;
    v_stock_at_cost DECIMAL(12, 2) := 0.00;

    v_sales_trend JSONB := '[]'::jsonb;
    v_invoices JSONB := '[]'::jsonb;
    v_expenses_list JSONB := '[]'::jsonb;
    v_daily_sales JSONB := '[]'::jsonb;
    v_monthly_sales JSONB := '[]'::jsonb;
    v_credits JSONB := '[]'::jsonb;
    v_monthly_profit JSONB := '[]'::jsonb;
    v_profit_by_product JSONB := '[]'::jsonb;
    v_by_product JSONB := '[]'::jsonb;
    v_by_category JSONB := '[]'::jsonb;
    v_stock_cost JSONB := '[]'::jsonb;
    v_stock_moves JSONB := '[]'::jsonb;
    v_stock_by_category JSONB := '[]'::jsonb;

    v_cutoff_hour INTEGER := 6;
    v_timezone TEXT := 'Asia/Kolkata';
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
        RAISE EXCEPTION 'Invalid date range provided';
    END IF;

    SELECT business_day_start_hour, timezone 
    INTO v_cutoff_hour, v_timezone
    FROM store_settings 
    LIMIT 1;

    v_cutoff_hour := COALESCE(v_cutoff_hour, 6);
    v_timezone := COALESCE(v_timezone, 'Asia/Kolkata');

    -- 1. Sales & Revenue (Gross Sales are NOT reduced per user requirement)
    SELECT 
        COALESCE(SUM(final_total), 0.00),
        COALESCE(SUM(discount_amount), 0.00),
        COUNT(id)
    INTO 
        v_total_sales,
        v_total_discount,
        v_invoice_count
    FROM invoices
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE AND is_hidden = FALSE;

    IF v_invoice_count > 0 THEN
        v_avg_invoice_value := ROUND(v_total_sales / v_invoice_count, 2);
    ELSE
        v_avg_invoice_value := 0.00;
    END IF;

    -- 2. Returns Total in Period (Excludes returns on voided/hidden invoices)
    SELECT COALESCE(SUM(r.total_refund_amount), 0.00)
    INTO v_total_returns
    FROM returns r
    LEFT JOIN invoices inv ON r.invoice_id = inv.id
    WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
      AND (r.invoice_id IS NULL OR (inv.is_voided = FALSE AND inv.is_hidden = FALSE));

    -- 3. Pending Uncleared Cheques Float (Excludes cheques on voided/hidden invoices)
    SELECT COALESCE(SUM(cc.amount), 0.00)
    INTO v_pending_cheques_total
    FROM customer_cheques cc
    LEFT JOIN invoices inv ON cc.invoice_id = inv.id
    WHERE cc.status = 'PENDING'
      AND (cc.invoice_id IS NULL OR (inv.is_voided = FALSE AND inv.is_hidden = FALSE));

    -- 4. Profit Calculation
    SELECT COALESCE(SUM(ii.profit_snapshot), 0.00)
    INTO v_raw_profit
    FROM invoice_items ii
    JOIN invoices inv ON ii.invoice_id = inv.id
    WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
      AND inv.is_voided = FALSE AND inv.is_hidden = FALSE;

    v_gross_profit := v_raw_profit - v_total_discount;

    -- 5. Collections Breakdown (Including BANK and excluding voided/hidden invoices)
    SELECT 
        COALESCE(SUM(p.amount), 0.00),
        COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'CASH'), 0.00),
        COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'UPI'), 0.00),
        COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'BANK'), 0.00),
        COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'STORE_CREDIT'), 0.00)
    INTO 
        v_total_collected,
        v_cash_collected,
        v_upi_collected,
        v_bank_collected,
        v_store_credit_collected
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
      AND (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE));

    -- 6. Expenses
    SELECT COALESCE(SUM(amount), 0.00)
    INTO v_total_expenses
    FROM expenses
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE AND is_hidden = FALSE;

    v_net_profit := v_gross_profit - v_total_expenses;

    -- 7. Customer Dues
    SELECT COALESCE(SUM(pending_dues), 0.00)
    INTO v_outstanding_dues
    FROM customer_metrics
    WHERE is_active = TRUE AND pending_dues > 0;

    -- 8. Current Stock at Cost
    SELECT COALESCE(SUM(v.stock_quantity * v.cost_price), 0.00)
    INTO v_stock_at_cost
    FROM variants v
    JOIN products p ON v.product_id = p.id
    WHERE v.is_active = TRUE AND p.is_active = TRUE;

    -- Sales Trend with Business Day Cutoff
    WITH invoice_days AS (
        SELECT 
            ((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(inv.final_total), 0.00) AS sales
        FROM invoices inv
        WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
          AND inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1
    ),
    payment_days AS (
        SELECT 
            ((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(p.amount), 0.00) AS collected
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
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'label', to_char(ad.b_day, 'DD Mon'),
            'date', ad.b_day::TEXT,
            'sales', COALESCE(id.sales, 0.00),
            'collected', COALESCE(pd.collected, 0.00)
        ) ORDER BY ad.b_day ASC
    ), '[]'::jsonb)
    INTO v_sales_trend
    FROM all_days ad
    LEFT JOIN invoice_days id ON ad.b_day = id.b_day
    LEFT JOIN payment_days pd ON ad.b_day = pd.b_day;

    -- Tab 1: Invoices List with Lateral Payment Summary & Safe Line Sale Flag
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', sub.id,
            'invoice_number', sub.invoice_number,
            'created_at', sub.created_at,
            'customer_name', sub.customer_name,
            'subtotal', sub.subtotal,
            'discount_amount', sub.discount_amount,
            'final_total', sub.final_total,
            'paid_amount', sub.paid_amount,
            'primary_method', sub.primary_method,
            'status', sub.status,
            'is_voided', sub.is_voided,
            'is_line_sale', sub.is_line_sale
        ) ORDER BY sub.created_at DESC
    ), '[]'::jsonb)
    INTO v_invoices
    FROM (
        SELECT 
            inv.id,
            inv.invoice_number,
            inv.created_at,
            COALESCE(c.name, 'Walk-in') AS customer_name,
            inv.subtotal,
            inv.discount_amount,
            inv.final_total,
            COALESCE(pm.paid_amount, 0.00) AS paid_amount,
            COALESCE(pm.primary_method, 'CREDIT') AS primary_method,
            CASE 
                WHEN inv.is_voided THEN 'Void'
                WHEN COALESCE(pm.paid_amount, 0.00) >= inv.final_total THEN 'Paid'
                WHEN COALESCE(pm.paid_amount, 0.00) > 0 THEN 'Partial'
                ELSE 'Unpaid'
            END AS status,
            inv.is_voided,
            (
                EXISTS (SELECT 1 FROM line_staff ls WHERE ls.customer_id = inv.customer_id)
                OR EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = inv.id AND (p.notes ILIKE '%line%' OR p.notes ILIKE '%van%'))
            ) AS is_line_sale
        FROM invoices inv
        LEFT JOIN customers c ON inv.customer_id = c.id
        LEFT JOIN (
            SELECT 
                invoice_id,
                COALESCE(SUM(amount), 0.00) AS paid_amount,
                (ARRAY_AGG(method::text ORDER BY amount DESC))[1] AS primary_method
            FROM payments
            GROUP BY invoice_id
        ) pm ON pm.invoice_id = inv.id
        WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
          AND inv.is_hidden = FALSE
    ) sub;

    -- Tab 2: Expenses List
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', e.id,
            'category', e.category,
            'amount', e.amount,
            'payment_method', e.payment_method,
            'notes', e.notes,
            'created_at', e.created_at
        ) ORDER BY e.created_at DESC
    ), '[]'::jsonb)
    INTO v_expenses_list
    FROM expenses e
    WHERE e.created_at >= p_start_date AND e.created_at <= p_end_date
      AND e.is_voided = FALSE AND e.is_hidden = FALSE;

    -- Tab 3: Daily Sales
    WITH invoice_days AS (
        SELECT 
            ((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(inv.final_total), 0.00) AS gross_sales,
            COALESCE(SUM(inv.discount_amount), 0.00) AS discount,
            COUNT(inv.id) AS inv_count
        FROM invoices inv
        WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
          AND inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1
    ),
    payment_days AS (
        SELECT 
            ((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(p.amount), 0.00) AS collected
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
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'date', ad.b_day::TEXT,
            'gross_sales', COALESCE(id.gross_sales, 0.00),
            'net_sales', COALESCE(id.gross_sales, 0.00),
            'discount', COALESCE(id.discount, 0.00),
            'invoice_count', COALESCE(id.inv_count, 0),
            'collected', COALESCE(pd.collected, 0.00)
        ) ORDER BY ad.b_day DESC
    ), '[]'::jsonb)
    INTO v_daily_sales
    FROM all_days ad
    LEFT JOIN invoice_days id ON ad.b_day = id.b_day
    LEFT JOIN payment_days pd ON ad.b_day = pd.b_day;

    -- Tab 4: Monthly Sales
    WITH invoice_months AS (
        SELECT 
            to_char(((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            to_char(((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'Mon YYYY') AS b_month_label,
            COALESCE(SUM(inv.final_total), 0.00) AS gross_sales,
            COALESCE(SUM(inv.discount_amount), 0.00) AS discount,
            COUNT(inv.id) AS inv_count
        FROM invoices inv
        WHERE inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1, 2
    ),
    payment_months AS (
        SELECT 
            to_char(((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            to_char(((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'Mon YYYY') AS b_month_label,
            COALESCE(SUM(p.amount), 0.00) AS collected
        FROM payments p
        LEFT JOIN invoices i ON p.invoice_id = i.id
        WHERE p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE)
        GROUP BY 1, 2
    ),
    all_months AS (
        SELECT b_month_key, b_month_label FROM invoice_months
        UNION
        SELECT b_month_key, b_month_label FROM payment_months
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', ms.b_month_label,
            'gross_sales', ms.gross_sales,
            'net_sales', ms.gross_sales,
            'discount', ms.discount,
            'invoice_count', ms.inv_count,
            'collected', ms.collected
        ) ORDER BY ms.b_month_key DESC
    ), '[]'::jsonb)
    INTO v_monthly_sales
    FROM (
        SELECT 
            am.b_month_key, 
            am.b_month_label, 
            COALESCE(im.gross_sales, 0.00) AS gross_sales, 
            COALESCE(im.discount, 0.00) AS discount, 
            COALESCE(im.inv_count, 0) AS inv_count, 
            COALESCE(pm.collected, 0.00) AS collected
        FROM all_months am
        LEFT JOIN invoice_months im ON am.b_month_key = im.b_month_key
        LEFT JOIN payment_months pm ON am.b_month_key = pm.b_month_key
        ORDER BY am.b_month_key DESC
        LIMIT 12
    ) ms;

    -- Tab 5: Customer Credits
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
    WHERE cm.is_active = TRUE AND cm.pending_dues > 0;

    -- Tab 6: Monthly Profit
    WITH invoice_items_per_inv AS (
        SELECT 
            invoice_id,
            COALESCE(SUM(quantity * cost_price_snapshot), 0.00) AS cogs,
            COALESCE(SUM(profit_snapshot), 0.00) AS raw_profit
        FROM invoice_items
        GROUP BY invoice_id
    ),
    invoice_months AS (
        SELECT 
            to_char(((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            to_char(((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'Mon YYYY') AS b_month_label,
            COALESCE(SUM(inv.final_total), 0.00) AS sales,
            COALESCE(SUM(inv.discount_amount), 0.00) AS discount,
            COALESCE(SUM(ii.cogs), 0.00) AS cogs,
            COALESCE(SUM(ii.raw_profit), 0.00) AS raw_profit
        FROM invoices inv
        LEFT JOIN invoice_items_per_inv ii ON ii.invoice_id = inv.id
        WHERE inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1, 2
    ),
    expense_months AS (
        SELECT 
            to_char(((e.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            to_char(((e.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'Mon YYYY') AS b_month_label,
            COALESCE(SUM(e.amount), 0.00) AS expenses
        FROM expenses e
        WHERE e.is_voided = FALSE AND e.is_hidden = FALSE
        GROUP BY 1, 2
    ),
    all_months AS (
        SELECT b_month_key, b_month_label FROM invoice_months
        UNION
        SELECT b_month_key, b_month_label FROM expense_months
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', mp.b_month_label,
            'sales', mp.sales,
            'cogs', mp.cogs,
            'gross_profit', (mp.raw_profit - mp.discount),
            'expenses', mp.expenses,
            'net_profit', ((mp.raw_profit - mp.discount) - mp.expenses)
        ) ORDER BY mp.b_month_key DESC
    ), '[]'::jsonb)
    INTO v_monthly_profit
    FROM (
        SELECT 
            am.b_month_key,
            am.b_month_label,
            COALESCE(im.sales, 0.00) AS sales,
            COALESCE(im.cogs, 0.00) AS cogs,
            COALESCE(im.discount, 0.00) AS discount,
            COALESCE(im.raw_profit, 0.00) AS raw_profit,
            COALESCE(em.expenses, 0.00) AS expenses
        FROM all_months am
        LEFT JOIN invoice_months im ON am.b_month_key = im.b_month_key
        LEFT JOIN expense_months em ON am.b_month_key = em.b_month_key
        ORDER BY am.b_month_key DESC
        LIMIT 12
    ) mp;

    -- Tab 7: Profit by Product
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_id', pp.prod_id,
            'variant_id', pp.var_id,
            'product_name', pp.prod_name,
            'variant_name', pp.var_name,
            'quantity_sold', pp.qty,
            'revenue', pp.rev,
            'cogs', pp.cogs,
            'profit', pp.prof,
            'margin_percent', CASE WHEN pp.rev > 0 THEN ROUND((pp.prof / pp.rev) * 100, 1) ELSE 0.0 END
        ) ORDER BY pp.prof DESC
    ), '[]'::jsonb)
    INTO v_profit_by_product
    FROM (
        SELECT 
            p.id AS prod_id,
            v.id AS var_id,
            p.name AS prod_name,
            v.name AS var_name,
            SUM(ii.quantity) AS qty,
            SUM(ii.quantity * ii.selling_price_snapshot) AS rev,
            SUM(ii.quantity * ii.cost_price_snapshot) AS cogs,
            SUM(ii.profit_snapshot) AS prof
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
          AND i.is_voided = FALSE AND i.is_hidden = FALSE
        GROUP BY p.id, v.id, p.name, v.name
    ) pp;

    -- Tab 8: Top Products by Volume
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_id', tp.p_id,
            'product_name', tp.p_name,
            'quantity_sold', tp.tot_qty,
            'total_sales', tp.tot_sales
        ) ORDER BY tp.tot_qty DESC
    ), '[]'::jsonb)
    INTO v_by_product
    FROM (
        SELECT 
            p.id AS p_id,
            p.name AS p_name,
            SUM(ii.quantity) AS tot_qty,
            SUM(ii.quantity * ii.selling_price_snapshot) AS tot_sales
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
          AND i.is_voided = FALSE AND i.is_hidden = FALSE
        GROUP BY p.id, p.name
        ORDER BY tot_qty DESC
        LIMIT 50
    ) tp;

    -- Tab 9: Sales by Category
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'category_name', tc.c_name,
            'quantity_sold', tc.tot_qty,
            'total_sales', tc.tot_sales,
            'total_profit', tc.tot_prof
        ) ORDER BY tc.tot_sales DESC
    ), '[]'::jsonb)
    INTO v_by_category
    FROM (
        SELECT 
            COALESCE(c.name, 'Uncategorized') AS c_name,
            SUM(ii.quantity) AS tot_qty,
            SUM(ii.quantity * ii.selling_price_snapshot) AS tot_sales,
            SUM(ii.profit_snapshot) AS tot_prof
        FROM invoice_items ii
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        JOIN invoices i ON ii.invoice_id = i.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
          AND i.is_voided = FALSE AND i.is_hidden = FALSE
        GROUP BY c.name
    ) tc;

    -- Tab 10: Stock Cost Valuation
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_id', p.id,
            'variant_id', v.id,
            'product_name', p.name,
            'variant_name', v.name,
            'barcode', v.barcode,
            'stock_quantity', v.stock_quantity,
            'cost_price', v.cost_price,
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
            'created_at', sub.created_at,
            'product_name', sub.p_name,
            'variant_name', sub.v_name,
            'type', sub.type,
            'quantity_change', sub.quantity_change,
            'notes', sub.notes
        ) ORDER BY sub.created_at DESC
    ), '[]'::jsonb)
    INTO v_stock_moves
    FROM (
        SELECT sm.id, sm.created_at, p.name AS p_name, v.name AS v_name, sm.type, sm.quantity_change, sm.notes
        FROM stock_movements sm
        JOIN variants v ON sm.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        WHERE sm.created_at >= p_start_date AND sm.created_at <= p_end_date
        ORDER BY sm.created_at DESC
        LIMIT 500
    ) sub;

    -- Tab 12: Stock By Category
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'category_id', sbc.category_id,
            'category_name', sbc.category_name,
            'total_pieces', sbc.tot_pieces,
            'total_valuation', sbc.tot_val
        ) ORDER BY sbc.tot_val DESC
    ), '[]'::jsonb)
    INTO v_stock_by_category
    FROM (
        SELECT 
            COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::UUID) AS category_id,
            COALESCE(c.name, 'Uncategorized') AS category_name,
            COALESCE(SUM(v.stock_quantity), 0) AS tot_pieces,
            COALESCE(SUM(v.stock_quantity * v.cost_price), 0.00) AS tot_val
        FROM variants v
        JOIN products p ON v.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE v.is_active = TRUE AND p.is_active = TRUE
        GROUP BY c.id, c.name
    ) sbc;

    RETURN jsonb_build_object(
        'total_sales', v_total_sales,
        'total_returns', v_total_returns,
        'pending_cheques_total', v_pending_cheques_total,
        'total_discount', v_total_discount,
        'collected', v_total_collected,
        'outstanding_dues', v_outstanding_dues,
        'invoice_count', v_invoice_count,
        'avg_invoice_value', v_avg_invoice_value,
        'expenses', v_total_expenses,
        'total_expenses', v_total_expenses,
        'gross_profit', v_gross_profit,
        'net_profit', v_net_profit,
        'stock_at_cost', v_stock_at_cost,
        'payment_breakdown', jsonb_build_object(
            'total_collected', v_total_collected,
            'cash_amount', v_cash_collected,
            'cash_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_cash_collected / v_total_collected) * 100, 1) ELSE 0.0 END,
            'upi_amount', v_upi_collected,
            'upi_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_upi_collected / v_total_collected) * 100, 1) ELSE 0.0 END,
            'bank_amount', v_bank_collected,
            'bank_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_bank_collected / v_total_collected) * 100, 1) ELSE 0.0 END,
            'store_credit_amount', v_store_credit_collected,
            'store_credit_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_store_credit_collected / v_total_collected) * 100, 1) ELSE 0.0 END,
            'pending_cheques_amount', v_pending_cheques_total
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

CREATE OR REPLACE FUNCTION get_dashboard_metrics(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_gross_sales DECIMAL(12, 2) := 0.00;
    v_total_returns DECIMAL(12, 2) := 0.00;
    v_pending_cheques_total DECIMAL(12, 2) := 0.00;
    v_total_discount DECIMAL(12, 2) := 0.00;
    v_raw_profit DECIMAL(12, 2) := 0.00;
    v_gross_profit DECIMAL(12, 2) := 0.00;
    v_total_expenses DECIMAL(12, 2) := 0.00;
    v_net_profit DECIMAL(12, 2) := 0.00;
    v_total_collected DECIMAL(12, 2) := 0.00;
    v_invoice_count INTEGER := 0;
    v_low_stock_items JSONB := '[]'::jsonb;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
        RAISE EXCEPTION 'Invalid date range provided';
    END IF;

    -- 1. Gross Sales, Discount & Invoice Count
    SELECT 
        COALESCE(SUM(final_total), 0.00),
        COALESCE(SUM(discount_amount), 0.00),
        COUNT(id)
    INTO v_gross_sales, v_total_discount, v_invoice_count
    FROM invoices
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE AND is_hidden = FALSE;

    -- 2. Returns in Period (Excludes returns on voided/hidden invoices)
    SELECT COALESCE(SUM(r.total_refund_amount), 0.00)
    INTO v_total_returns
    FROM returns r
    LEFT JOIN invoices inv ON r.invoice_id = inv.id
    WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
      AND (r.invoice_id IS NULL OR (inv.is_voided = FALSE AND inv.is_hidden = FALSE));

    -- 3. Pending Cheques Float (Excludes cheques linked to voided/hidden invoices)
    SELECT COALESCE(SUM(cc.amount), 0.00)
    INTO v_pending_cheques_total
    FROM customer_cheques cc
    LEFT JOIN invoices inv ON cc.invoice_id = inv.id
    WHERE cc.status = 'PENDING'
      AND (cc.invoice_id IS NULL OR (inv.is_voided = FALSE AND inv.is_hidden = FALSE));

    -- 4. Raw Profit & Gross Profit
    SELECT COALESCE(SUM(ii.profit_snapshot), 0.00)
    INTO v_raw_profit
    FROM invoice_items ii
    JOIN invoices inv ON ii.invoice_id = inv.id
    WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
      AND inv.is_voided = FALSE AND inv.is_hidden = FALSE;

    v_gross_profit := v_raw_profit - v_total_discount;

    -- 5. Total Expenses
    SELECT COALESCE(SUM(amount), 0.00)
    INTO v_total_expenses
    FROM expenses
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE AND is_hidden = FALSE;

    -- 6. Net Profit
    v_net_profit := v_gross_profit - v_total_expenses;

    -- 7. Total Collected Payments (Excluding voided/hidden invoices)
    SELECT COALESCE(SUM(p.amount), 0.00)
    INTO v_total_collected
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
      AND (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE));

    -- 8. Low Stock Items
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

    RETURN jsonb_build_object(
        'gross_sales', v_gross_sales,
        'net_sales', v_gross_sales,
        'total_discount', v_total_discount,
        'total_returns', v_total_returns,
        'pending_cheques_total', v_pending_cheques_total,
        'collected_payments', v_total_collected,
        'expenses', v_total_expenses,
        'total_expenses', v_total_expenses,
        'gross_profit', v_gross_profit,
        'net_profit', v_net_profit,
        'invoice_count', v_invoice_count,
        'low_stock_items', v_low_stock_items
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_comprehensive_reports(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_dashboard_metrics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
