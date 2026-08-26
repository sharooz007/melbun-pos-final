-- ============================================================================
-- Migration: 0052_critical_fixes_cycle2.sql
-- Description:
-- 1. Fix update_product_with_variants to prevent resetting stock_sets to 0 on edit
-- 2. Synchronize get_comprehensive_reports return schema to match ReportsPage.tsx
-- ============================================================================

-- 1. UPDATE update_product_with_variants
CREATE OR REPLACE FUNCTION update_product_with_variants(
    p_product_id UUID,
    p_name TEXT,
    p_category_id UUID,
    p_pieces_per_set INT,
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
    v_incoming_variant_ids UUID[] := ARRAY[]::UUID[];
    v_old_pieces_per_set INT;
    v_existing_variant RECORD;
    v_loose_pieces INT;
    v_new_total_pieces INT;
    v_piece_delta INT;
    v_deleted_variant_id UUID;
    v_new_stock_qty INT;
    v_barcode TEXT;
    v_cost_price DECIMAL(10,2);
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_product_id IS NULL THEN RAISE EXCEPTION 'Product ID is required'; END IF;
    IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'Product name is required'; END IF;
    IF p_pieces_per_set IS NULL OR p_pieces_per_set <= 0 THEN RAISE EXCEPTION 'Pieces per set must be greater than 0'; END IF;

    -- Fetch existing pieces_per_set
    SELECT pieces_per_set INTO v_old_pieces_per_set
    FROM products
    WHERE id = p_product_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found';
    END IF;

    -- Update Product Header
    UPDATE products
    SET name = trim(p_name),
        category_id = p_category_id,
        pieces_per_set = p_pieces_per_set,
        updated_at = NOW()
    WHERE id = p_product_id;

    -- If pieces_per_set changed, recalculate inventory across all variants
    IF v_old_pieces_per_set <> p_pieces_per_set THEN
        FOR v_existing_variant IN
            SELECT id, stock_sets, stock_quantity
            FROM variants
            WHERE product_id = p_product_id AND is_active = TRUE
            FOR UPDATE
        LOOP
            v_loose_pieces := v_existing_variant.stock_quantity - (v_existing_variant.stock_sets * v_old_pieces_per_set);
            v_new_total_pieces := (v_existing_variant.stock_sets * p_pieces_per_set) + v_loose_pieces;
            v_piece_delta := v_new_total_pieces - v_existing_variant.stock_quantity;

            UPDATE variants
            SET stock_quantity = v_new_total_pieces,
                updated_at = NOW()
            WHERE id = v_existing_variant.id;

            IF v_piece_delta <> 0 THEN
                INSERT INTO stock_movements (
                    variant_id, type, quantity_change, notes
                ) VALUES (
                    v_existing_variant.id,
                    'MANUAL_ADJUST'::stock_movement_type,
                    v_piece_delta,
                    format('Pack size updated from %s to %s pcs/set (Sets: %s, Loose: %s)', 
                           v_old_pieces_per_set, p_pieces_per_set, v_existing_variant.stock_sets, v_loose_pieces)
                );
            END IF;
        END LOOP;
    END IF;

    -- Process Variants Array
    FOR v_variant IN 
        SELECT 
            (elem->>'id')::UUID AS id,
            (elem->>'name')::TEXT AS name,
            (elem->>'barcode')::TEXT AS barcode,
            (elem->>'cost_price')::DECIMAL(10,2) AS cost_price,
            (elem->>'selling_price')::DECIMAL(10,2) AS selling_price,
            (elem->>'initial_sets')::INT AS initial_sets,
            (elem->>'initial_loose')::INT AS initial_loose
        FROM jsonb_array_elements(p_variants) AS elem
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
            -- Update existing variant without overwriting stock_sets
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
            RETURNING id INTO v_deleted_variant_id;

            v_incoming_variant_ids := array_append(v_incoming_variant_ids, v_deleted_variant_id);

            IF v_new_stock_qty > 0 THEN
                INSERT INTO stock_movements (
                    variant_id, type, quantity_change, notes
                ) VALUES (
                    v_deleted_variant_id,
                    'INITIAL_STOCK'::stock_movement_type,
                    v_new_stock_qty,
                    format('Initial variant stock added: %s sets, %s loose pcs', 
                           COALESCE(v_variant.initial_sets, 0), COALESCE(v_variant.initial_loose, 0))
                );
            END IF;
        END IF;
    END LOOP;

    -- Deactivate variants omitted from payload
    FOR v_deleted_variant_id IN
        SELECT id FROM variants
        WHERE product_id = p_product_id 
          AND is_active = TRUE
          AND id <> ALL(v_incoming_variant_ids)
    LOOP
        UPDATE variants 
        SET is_active = FALSE,
            stock_quantity = 0,
            stock_sets = 0,
            updated_at = NOW() 
        WHERE id = v_deleted_variant_id;

        INSERT INTO stock_movements (
            variant_id, type, quantity_change, notes
        ) VALUES (
            v_deleted_variant_id,
            'MANUAL_ADJUST'::stock_movement_type,
            0,
            'Variant removed from product'
        );
    END LOOP;

    RETURN jsonb_build_object('success', true, 'product_id', p_product_id);
END;
$$;


-- 2. UPDATE get_comprehensive_reports (Full schema alignment with ReportsPage.tsx)
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
    v_outstanding_dues DECIMAL(12, 2) := 0.00;
    v_invoice_count INTEGER := 0;
    v_avg_invoice_value DECIMAL(12, 2) := 0.00;
    v_total_expenses DECIMAL(12, 2) := 0.00;
    v_net_profit DECIMAL(12, 2) := 0.00;
    v_stock_at_cost DECIMAL(12, 2) := 0.00;

    v_cutoff_hour INT := 6;
    v_timezone TEXT := 'Asia/Kolkata';

    -- Drilldown Data Containers
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
    v_sales_trend JSONB := '[]'::jsonb;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    -- Fetch Store Cutoff & Timezone Settings
    SELECT 
        COALESCE(business_day_start_hour, 6),
        COALESCE(timezone, 'Asia/Kolkata')
    INTO v_cutoff_hour, v_timezone
    FROM store_settings 
    LIMIT 1;

    IF v_cutoff_hour IS NULL THEN v_cutoff_hour := 6; END IF;
    IF v_timezone IS NULL OR v_timezone = '' THEN v_timezone := 'Asia/Kolkata'; END IF;

    -- 1. Total Sales, Discounts & Invoice Count
    SELECT 
        COALESCE(SUM(final_total), 0),
        COALESCE(SUM(discount_amount), 0),
        COUNT(id)
    INTO v_total_sales, v_total_discount, v_invoice_count
    FROM invoices
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE
      AND is_hidden = FALSE;

    IF v_invoice_count > 0 THEN
        v_avg_invoice_value := ROUND(v_total_sales / v_invoice_count, 2);
    ELSE
        v_avg_invoice_value := 0.00;
    END IF;

    -- 2. Raw Profit & Gross Profit (Unclamped)
    SELECT COALESCE(SUM(ii.profit_snapshot), 0)
    INTO v_raw_profit
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
      AND i.is_voided = FALSE
      AND i.is_hidden = FALSE;

    v_gross_profit := v_raw_profit - v_total_discount;

    -- 3. Payments Collected in Period
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

    -- 4. Outstanding Dues
    SELECT COALESCE(SUM(GREATEST(0.00, pending_dues)), 0)
    INTO v_outstanding_dues
    FROM customer_metrics
    WHERE is_active = TRUE;

    -- 5. Total Expenses
    SELECT COALESCE(SUM(amount), 0)
    INTO v_total_expenses
    FROM expenses
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE
      AND is_hidden = FALSE;

    -- 6. Net Operating Profit
    v_net_profit := v_gross_profit - v_total_expenses;

    -- 7. Current Stock at Cost
    SELECT COALESCE(SUM(v.stock_quantity * v.cost_price), 0)
    INTO v_stock_at_cost
    FROM variants v
    JOIN products p ON v.product_id = p.id
    WHERE v.is_active = TRUE AND p.is_active = TRUE;

    -- Sales Trend (Day-wise chart data)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'day', to_char(st.d, 'YYYY-MM-DD'),
            'label', to_char(st.d, 'DD Mon'),
            'sales', COALESCE(st.tot_sales, 0),
            'collected', COALESCE(st.tot_col, 0)
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

    -- Tab 1: Invoices List
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', inv.id,
            'invoice_number', inv.invoice_number,
            'created_at', inv.created_at,
            'customer_name', COALESCE(c.name, 'Walk-in'),
            'subtotal', inv.subtotal,
            'discount_amount', inv.discount_amount,
            'final_total', inv.final_total,
            'payment_status', inv.payment_status,
            'total_paid', (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = inv.id)
        ) ORDER BY inv.created_at DESC
    ), '[]'::jsonb)
    INTO v_invoices
    FROM invoices inv
    LEFT JOIN customers c ON inv.customer_id = c.id
    WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
      AND inv.is_voided = FALSE AND inv.is_hidden = FALSE;

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
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'date', to_char(ds.d, 'YYYY-MM-DD'),
            'gross_sales', ds.tot_sales,
            'net_sales', ds.tot_sales,
            'collected', ds.tot_col
        ) ORDER BY ds.d DESC
    ), '[]'::jsonb)
    INTO v_daily_sales
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
    ) ds;

    -- Tab 4: Monthly Sales
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', to_char(ms.m, 'Mon YYYY'),
            'gross_sales', ms.tot_sales,
            'net_sales', ms.tot_sales,
            'collected', ms.tot_col
        ) ORDER BY ms.m DESC
    ), '[]'::jsonb)
    INTO v_monthly_sales
    FROM (
        SELECT 
            date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone) AS m,
            SUM(inv.final_total) AS tot_sales,
            (
                SELECT COALESCE(SUM(p.amount), 0)
                FROM payments p
                WHERE date_trunc('month', (p.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone) = date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone)
            ) AS tot_col
        FROM invoices inv
        WHERE inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone)
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
            date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone) AS m,
            SUM(inv.final_total) AS tot_sales,
            SUM((SELECT COALESCE(SUM(ii.quantity * ii.cost_price_snapshot), 0) FROM invoice_items ii WHERE ii.invoice_id = inv.id)) AS tot_cogs,
            SUM((SELECT COALESCE(SUM(ii.profit_snapshot), 0) FROM invoice_items ii WHERE ii.invoice_id = inv.id) - inv.discount_amount) AS gross_p,
            (
                SELECT COALESCE(SUM(e.amount), 0)
                FROM expenses e
                WHERE date_trunc('month', (e.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone) = date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone)
                  AND e.is_voided = FALSE AND e.is_hidden = FALSE
            ) AS tot_exp
        FROM invoices inv
        WHERE inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY date_trunc('month', (inv.created_at AT TIME ZONE 'UTC') AT TIME ZONE v_timezone)
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

    -- Tab 11: Stock Movements
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'created_at', sm.created_at,
            'product_name', p.name,
            'variant_name', v.name,
            'type', sm.type,
            'quantity_change', sm.quantity_change,
            'notes', sm.notes
        )
    ), '[]'::jsonb)
    INTO v_stock_moves
    FROM (
        SELECT sm.*
        FROM stock_movements sm
        WHERE sm.created_at >= p_start_date AND sm.created_at <= p_end_date
        ORDER BY sm.created_at DESC
        LIMIT 500
    ) sm
    JOIN variants v ON sm.variant_id = v.id
    JOIN products p ON v.product_id = p.id;

    -- Tab 12: Stock by Category
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'category_id', c_stat.cat_id,
            'category_name', c_stat.cat_name,
            'total_pieces', c_stat.tot_qty,
            'total_valuation', c_stat.tot_val
        ) ORDER BY c_stat.tot_val DESC
    ), '[]'::jsonb)
    INTO v_stock_by_category
    FROM (
        SELECT 
            c.id AS cat_id,
            COALESCE(c.name, 'Uncategorized') AS cat_name,
            COALESCE(SUM(v.stock_quantity), 0) AS tot_qty,
            COALESCE(SUM(v.stock_quantity * v.cost_price), 0) AS tot_val
        FROM variants v
        JOIN products p ON v.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE v.is_active = TRUE AND p.is_active = TRUE
        GROUP BY c.id, c.name
    ) c_stat;

    -- Return JSON payload matching ReportsPage.tsx structure
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
