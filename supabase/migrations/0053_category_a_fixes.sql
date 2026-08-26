-- Migration 0053: Category A Bug Fixes & Reports RPC Hardening
-- 1. Variant soft-delete stock movement logging with accurate negative quantity change (Bug #7)
-- 2. Reports RPC monthly sales business-day cutoff alignment (Bugs #10 & #137)
-- 3. Daily and monthly sales extra columns: invoice_count, discount_amount (Bug #138)
-- 4. Reports Invoices tab schema contract alignment (Bug #139)

-- 1. UPDATE update_product_with_variants
CREATE OR REPLACE FUNCTION update_product_with_variants(
    p_product_id UUID,
    p_name TEXT,
    p_category_id UUID,
    p_pieces_per_set INTEGER,
    p_variants JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_variant RECORD;
    v_var_rec RECORD;
    v_incoming_variant_ids UUID[] := ARRAY[]::UUID[];
    v_barcode TEXT;
    v_cost_price DECIMAL(10, 2);
    v_new_stock_qty INTEGER;
    v_new_variant_id UUID;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'Product name is required'; END IF;
    IF p_pieces_per_set IS NULL OR p_pieces_per_set <= 0 THEN RAISE EXCEPTION 'Pieces per set must be greater than 0'; END IF;
    IF p_variants IS NULL OR jsonb_array_length(p_variants) = 0 THEN RAISE EXCEPTION 'At least one variant is required'; END IF;

    -- Update Product record
    UPDATE products
    SET name = trim(p_name),
        category_id = p_category_id,
        pieces_per_set = p_pieces_per_set,
        updated_at = NOW()
    WHERE id = p_product_id;

    -- Process variants
    FOR v_variant IN SELECT * FROM jsonb_to_recordset(p_variants) AS x(
        id UUID, name TEXT, barcode TEXT, cost_price DECIMAL, selling_price DECIMAL,
        initial_sets INTEGER, initial_loose INTEGER
    )
    LOOP
        IF v_variant.name IS NULL OR trim(v_variant.name) = '' THEN 
            RAISE EXCEPTION 'Variant name cannot be empty'; 
        END IF;
        IF v_variant.selling_price IS NULL OR v_variant.selling_price < 0 THEN 
            RAISE EXCEPTION 'Variant selling price must be non-negative'; 
        END IF;
        IF v_variant.cost_price IS NOT NULL AND v_variant.cost_price < 0 THEN 
            RAISE EXCEPTION 'Cost price cannot be negative'; 
        END IF;

        v_barcode := COALESCE(NULLIF(trim(v_variant.barcode), ''), generate_unique_barcode());
        v_cost_price := COALESCE(v_variant.cost_price, 0.00);

        IF v_variant.id IS NOT NULL THEN
            -- Update existing variant without overwriting live stock
            UPDATE variants
            SET name = trim(v_variant.name),
                barcode = v_barcode,
                cost_price = v_cost_price,
                selling_price = v_variant.selling_price,
                updated_at = NOW()
            WHERE id = v_variant.id AND product_id = p_product_id;

            v_incoming_variant_ids := array_append(v_incoming_variant_ids, v_variant.id);
        ELSE
            -- Insert new variant
            v_new_stock_qty := (COALESCE(v_variant.initial_sets, 0) * p_pieces_per_set) + COALESCE(v_variant.initial_loose, 0);

            INSERT INTO variants (
                product_id, name, barcode, cost_price, selling_price,
                stock_sets, stock_quantity, is_active
            ) VALUES (
                p_product_id, trim(v_variant.name), v_barcode, v_cost_price, v_variant.selling_price,
                COALESCE(v_variant.initial_sets, 0), v_new_stock_qty, TRUE
            )
            RETURNING id INTO v_new_variant_id;

            v_incoming_variant_ids := array_append(v_incoming_variant_ids, v_new_variant_id);

            IF v_new_stock_qty > 0 THEN
                INSERT INTO stock_movements (
                    variant_id, type, quantity_change, notes
                ) VALUES (
                    v_new_variant_id,
                    'INITIAL_STOCK'::stock_movement_type,
                    v_new_stock_qty,
                    format('Initial variant stock added: %s sets, %s loose pcs', 
                           COALESCE(v_variant.initial_sets, 0), COALESCE(v_variant.initial_loose, 0))
                );
            END IF;
        END IF;
    END LOOP;

    -- Deactivate variants omitted from payload & log accurate negative quantity change in stock_movements (Bug #7)
    FOR v_var_rec IN
        SELECT id, stock_quantity FROM variants
        WHERE product_id = p_product_id 
          AND is_active = TRUE
          AND id <> ALL(v_incoming_variant_ids)
    LOOP
        UPDATE variants 
        SET is_active = FALSE,
            stock_quantity = 0,
            stock_sets = 0,
            updated_at = NOW() 
        WHERE id = v_var_rec.id;

        IF COALESCE(v_var_rec.stock_quantity, 0) > 0 THEN
            INSERT INTO stock_movements (
                variant_id, type, quantity_change, notes
            ) VALUES (
                v_var_rec.id,
                'MANUAL_ADJUST'::stock_movement_type,
                -v_var_rec.stock_quantity,
                'Variant removed from product during edit - stock written off to zero'
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'product_id', p_product_id);
END;
$$;


-- 2. UPDATE get_comprehensive_reports (Full schema alignment, monthly business-day cutoff, and extra columns)
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
    v_total_discount DECIMAL(12, 2) := 0.00;
    v_raw_profit DECIMAL(12, 2) := 0.00;
    v_gross_profit DECIMAL(12, 2) := 0.00;
    v_total_collected DECIMAL(12, 2) := 0.00;
    v_cash_collected DECIMAL(12, 2) := 0.00;
    v_upi_collected DECIMAL(12, 2) := 0.00;
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

    SELECT business_day_start_hour, timezone 
    INTO v_cutoff_hour, v_timezone
    FROM store_settings 
    LIMIT 1;

    v_cutoff_hour := COALESCE(v_cutoff_hour, 6);
    v_timezone := COALESCE(v_timezone, 'Asia/Kolkata');

    -- 1. Sales & Revenue
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

    -- 2. Profit Calculation (Raw profit minus discount)
    SELECT COALESCE(SUM(ii.profit_snapshot), 0.00)
    INTO v_raw_profit
    FROM invoice_items ii
    JOIN invoices inv ON ii.invoice_id = inv.id
    WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
      AND inv.is_voided = FALSE AND inv.is_hidden = FALSE;

    v_gross_profit := v_raw_profit - v_total_discount;

    -- 3. Collections Breakdown
    SELECT 
        COALESCE(SUM(amount), 0.00),
        COALESCE(SUM(amount) FILTER (WHERE method = 'CASH'), 0.00),
        COALESCE(SUM(amount) FILTER (WHERE method = 'UPI'), 0.00),
        COALESCE(SUM(amount) FILTER (WHERE method = 'STORE_CREDIT'), 0.00)
    INTO 
        v_total_collected,
        v_cash_collected,
        v_upi_collected,
        v_store_credit_collected
    FROM payments
    WHERE created_at >= p_start_date AND created_at <= p_end_date;

    -- 4. Expenses
    SELECT COALESCE(SUM(amount), 0.00)
    INTO v_total_expenses
    FROM expenses
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE AND is_hidden = FALSE;

    v_net_profit := v_gross_profit - v_total_expenses;

    -- 5. Customer Dues
    SELECT COALESCE(SUM(pending_dues), 0.00)
    INTO v_outstanding_dues
    FROM customer_metrics
    WHERE is_active = TRUE AND pending_dues > 0;

    -- 6. Current Stock at Cost
    SELECT COALESCE(SUM(v.stock_quantity * v.cost_price), 0.00)
    INTO v_stock_at_cost
    FROM variants v
    JOIN products p ON v.product_id = p.id
    WHERE v.is_active = TRUE AND p.is_active = TRUE;

    -- Sales Trend with Cutoff
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'label', to_char(st.d, 'DD Mon'),
            'date', to_char(st.d, 'YYYY-MM-DD'),
            'sales', st.tot_sales,
            'collected', st.tot_col
        ) ORDER BY st.d ASC
    ), '[]'::jsonb)
    INTO v_sales_trend
    FROM (
        SELECT 
            date_trunc('day', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval) AS d,
            SUM(inv.final_total) AS tot_sales,
            (
                SELECT COALESCE(SUM(p.amount), 0)
                FROM payments p
                WHERE date_trunc('day', (p.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval) = date_trunc('day', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval)
            ) AS tot_col
        FROM invoices inv
        WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
          AND inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY date_trunc('day', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval)
    ) st;

    -- Tab 1: Invoices List with Schema Contract Alignment (Bug #139)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', inv.id,
            'invoice_number', inv.invoice_number,
            'created_at', inv.created_at,
            'customer_name', COALESCE(c.name, 'Walk-in'),
            'subtotal', inv.subtotal,
            'discount_amount', inv.discount_amount,
            'final_total', inv.final_total,
            'paid_amount', (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = inv.id),
            'primary_method', COALESCE((SELECT method::text FROM payments WHERE invoice_id = inv.id ORDER BY amount DESC LIMIT 1), 'CREDIT'),
            'status', CASE 
                WHEN inv.is_voided THEN 'Void'
                WHEN (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = inv.id) >= inv.final_total THEN 'Paid'
                WHEN (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = inv.id) > 0 THEN 'Partial'
                ELSE 'Unpaid'
            END,
            'is_voided', inv.is_voided
        ) ORDER BY inv.created_at DESC
    ), '[]'::jsonb)
    INTO v_invoices
    FROM invoices inv
    LEFT JOIN customers c ON inv.customer_id = c.id
    WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
      AND inv.is_hidden = FALSE;

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

    -- Tab 3: Daily Sales with invoice_count and discount (Bug #138)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'date', to_char(ds.d, 'YYYY-MM-DD'),
            'gross_sales', ds.tot_sales,
            'net_sales', ds.tot_sales,
            'discount', ds.tot_disc,
            'invoice_count', ds.cnt,
            'collected', ds.tot_col
        ) ORDER BY ds.d DESC
    ), '[]'::jsonb)
    INTO v_daily_sales
    FROM (
        SELECT 
            date_trunc('day', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval) AS d,
            SUM(inv.final_total) AS tot_sales,
            SUM(inv.discount_amount) AS tot_disc,
            COUNT(inv.id) AS cnt,
            (
                SELECT COALESCE(SUM(p.amount), 0)
                FROM payments p
                WHERE date_trunc('day', (p.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval) = date_trunc('day', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval)
            ) AS tot_col
        FROM invoices inv
        WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
          AND inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY date_trunc('day', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval)
    ) ds;

    -- Tab 4: Monthly Sales with Monthly Cutoff & extra columns (Bugs #10, #137, #138)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', to_char(ms.m, 'Mon YYYY'),
            'gross_sales', ms.tot_sales,
            'net_sales', ms.tot_sales,
            'discount', ms.tot_disc,
            'invoice_count', ms.cnt,
            'collected', ms.tot_col
        ) ORDER BY ms.m DESC
    ), '[]'::jsonb)
    INTO v_monthly_sales
    FROM (
        SELECT 
            date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval) AS m,
            SUM(inv.final_total) AS tot_sales,
            SUM(inv.discount_amount) AS tot_disc,
            COUNT(inv.id) AS cnt,
            (
                SELECT COALESCE(SUM(p.amount), 0)
                FROM payments p
                WHERE date_trunc('month', (p.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval) = date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval)
            ) AS tot_col
        FROM invoices inv
        WHERE inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval)
        ORDER BY m DESC
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
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', to_char(mp.m, 'Mon YYYY'),
            'sales', mp.tot_sales,
            'cogs', mp.tot_cogs,
            'gross_profit', mp.gross_p,
            'expenses', mp.tot_exp,
            'net_profit', (mp.gross_p - mp.tot_exp)
        ) ORDER BY mp.m DESC
    ), '[]'::jsonb)
    INTO v_monthly_profit
    FROM (
        SELECT 
            date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval) AS m,
            SUM(inv.final_total) AS tot_sales,
            SUM((SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) FROM invoice_items ii WHERE ii.invoice_id = inv.id)) AS tot_cogs,
            SUM((SELECT COALESCE(SUM(ii.profit_snapshot), 0) FROM invoice_items ii WHERE ii.invoice_id = inv.id) - inv.discount_amount) AS gross_p,
            (
                SELECT COALESCE(SUM(e.amount), 0)
                FROM expenses e
                WHERE date_trunc('month', (e.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval) = date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval)
                  AND e.is_voided = FALSE AND e.is_hidden = FALSE
            ) AS tot_exp
        FROM invoices inv
        WHERE inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone - (v_cutoff_hour || ' hours')::interval)
        ORDER BY m DESC
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
            'margin_percent', CASE WHEN pp.rev > 0 THEN ROUND((pp.prof / pp.rev) * 100, 1) ELSE 0 END
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
        JOIN invoices i ON ii.invoice_id = i.id
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
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
        'total_discount', v_total_discount,
        'collected', v_total_collected,
        'outstanding_dues', v_outstanding_dues,
        'invoice_count', v_invoice_count,
        'avg_invoice_value', v_avg_invoice_value,
        'expenses', v_total_expenses,
        'gross_profit', v_gross_profit,
        'net_profit', v_net_profit,
        'stock_at_cost', v_stock_at_cost,
        'payment_breakdown', jsonb_build_object(
            'total_collected', v_total_collected,
            'cash_amount', v_cash_collected,
            'cash_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_cash_collected / v_total_collected) * 100, 1) ELSE 0 END,
            'upi_amount', v_upi_collected,
            'upi_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_upi_collected / v_total_collected) * 100, 1) ELSE 0 END,
            'store_credit_amount', v_store_credit_collected,
            'store_credit_percent', CASE WHEN v_total_collected > 0 THEN ROUND((v_store_credit_collected / v_total_collected) * 100, 1) ELSE 0 END
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

GRANT EXECUTE ON FUNCTION update_product_with_variants(UUID, TEXT, UUID, INT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_comprehensive_reports(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
