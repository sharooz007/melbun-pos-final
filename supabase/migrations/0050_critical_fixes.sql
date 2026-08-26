-- =====================================================================================
-- Migration 0050: Critical Fixes (P0)
-- 1. update_product_with_variants: Pack size calculation & stock movement logging
-- 2. get_comprehensive_reports: Unclamping negative gross profit/losses for true net profit
-- =====================================================================================

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
AS $$
DECLARE
    v_old_pieces_per_set INTEGER;
    v_variant RECORD;
    v_var_rec RECORD;
    v_barcode TEXT;
    v_incoming_variant_ids UUID[] := '{}';
    v_cost_price DECIMAL(12, 2);
    v_sets INTEGER;
    v_loose INTEGER;
    v_new_total_pieces INTEGER;
    v_piece_delta INTEGER;
    v_new_stock_qty INTEGER;
    v_stock_delta INTEGER;
    v_deleted_variant_id UUID;
    v_deleted_stock INTEGER;
BEGIN
    -- Basic validation
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'Product name cannot be empty';
    END IF;
    IF p_pieces_per_set IS NULL OR p_pieces_per_set < 1 THEN
        RAISE EXCEPTION 'Pieces per set must be at least 1';
    END IF;

    -- Fetch existing product
    SELECT pieces_per_set INTO v_old_pieces_per_set
    FROM products
    WHERE id = p_product_id AND is_active = TRUE
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found or inactive';
    END IF;

    -- Update product master
    UPDATE products
    SET name = trim(p_name),
        category_id = p_category_id,
        pieces_per_set = p_pieces_per_set,
        updated_at = NOW()
    WHERE id = p_product_id;

    -- If pieces_per_set changed, recalculate total pieces for existing variants
    -- Rule: loose_pieces = stock_quantity - (stock_sets * old_pieces_per_set)
    -- New total = (stock_sets * new_pieces_per_set) + loose_pieces
    IF v_old_pieces_per_set <> p_pieces_per_set THEN
        FOR v_var_rec IN 
            SELECT id, stock_quantity, stock_sets 
            FROM variants 
            WHERE product_id = p_product_id AND is_active = TRUE 
            FOR UPDATE 
        LOOP
            v_sets := GREATEST(0, COALESCE(v_var_rec.stock_sets, 0));
            v_loose := GREATEST(0, v_var_rec.stock_quantity - (v_sets * v_old_pieces_per_set));
            v_new_total_pieces := (v_sets * p_pieces_per_set) + v_loose;
            v_piece_delta := v_new_total_pieces - v_var_rec.stock_quantity;

            UPDATE variants 
            SET stock_quantity = v_new_total_pieces,
                updated_at = NOW()
            WHERE id = v_var_rec.id;

            IF v_piece_delta <> 0 THEN
                INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
                VALUES (
                    v_var_rec.id, 
                    'MANUAL_ADJUST'::stock_movement_type, 
                    v_piece_delta, 
                    'Pack size updated from ' || v_old_pieces_per_set || ' to ' || p_pieces_per_set || ' pcs/set'
                );
            END IF;
        END LOOP;
    END IF;

    -- Upsert Variants in payload
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
            -- Update existing variant
            SELECT stock_quantity INTO v_new_stock_qty
            FROM variants WHERE id = v_variant.id;

            UPDATE variants
            SET name = trim(v_variant.name),
                barcode = v_barcode,
                cost_price = v_cost_price,
                selling_price = v_variant.selling_price,
                stock_sets = COALESCE(v_variant.initial_sets, stock_sets),
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
                INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
                VALUES (v_deleted_variant_id, 'ARRIVAL'::stock_movement_type, v_new_stock_qty, 'Initial stock for new variant');
            END IF;
        END IF;
    END LOOP;

    -- Soft-delete variants omitted from payload & write off stock to 0
    FOR v_deleted_variant_id, v_deleted_stock IN
        SELECT id, stock_quantity
        FROM variants
        WHERE product_id = p_product_id
          AND is_active = TRUE
          AND id != ALL(v_incoming_variant_ids)
    LOOP
        UPDATE variants 
        SET is_active = FALSE,
            stock_quantity = 0,
            stock_sets = 0,
            updated_at = NOW()
        WHERE id = v_deleted_variant_id;

        IF v_deleted_stock > 0 THEN
            INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
            VALUES (
                v_deleted_variant_id, 
                'MANUAL_ADJUST'::stock_movement_type, 
                -v_deleted_stock, 
                'Variant removed during product edit - stock written off to zero'
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'product_id', p_product_id);
END;
$$;


-- 2. UPDATE get_comprehensive_reports (Unclamp negative gross profit for true net loss reflection)
CREATE OR REPLACE FUNCTION get_comprehensive_reports(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
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
BEGIN
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

    -- 2. Gross Profit (Snapshot item profits minus invoice discounts) - UNCLAMPED
    SELECT COALESCE(SUM(ii.profit_snapshot), 0)
    INTO v_raw_profit
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
      AND i.is_voided = FALSE
      AND i.is_hidden = FALSE;

    v_gross_profit := v_raw_profit - v_total_discount;

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

    -- 4. Outstanding Dues
    SELECT COALESCE(SUM(GREATEST(0.00, pending_dues)), 0)
    INTO v_outstanding_dues
    FROM customer_metrics
    WHERE is_active = TRUE;

    -- 5. Total Expenses in Period
    SELECT COALESCE(SUM(amount), 0)
    INTO v_total_expenses
    FROM expenses
    WHERE created_at >= p_start_date AND created_at <= p_end_date
      AND is_voided = FALSE
      AND is_hidden = FALSE;

    -- 6. Net Profit
    v_net_profit := v_gross_profit - v_total_expenses;

    -- 7. Current Stock Valuation at Cost
    SELECT COALESCE(SUM(v.stock_quantity * v.cost_price), 0)
    INTO v_stock_at_cost
    FROM variants v
    JOIN products p ON v.product_id = p.id
    WHERE v.is_active = TRUE AND p.is_active = TRUE;

    -- =========================================================================
    -- DRILLDOWN DATASETS
    -- =========================================================================

    -- Tab 1: Invoices
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', i.id,
            'invoice_number', i.invoice_number,
            'customer_name', COALESCE(c.name, 'Walk-in Customer'),
            'phone', c.phone,
            'subtotal', i.subtotal,
            'discount_amount', i.discount_amount,
            'gst_applied', i.gst_applied,
            'cgst_amount', i.cgst_amount,
            'sgst_amount', i.sgst_amount,
            'round_off', i.round_off,
            'final_total', i.final_total,
            'paid_amount', COALESCE(p_summary.total_paid, 0),
            'due_amount', GREATEST(0.00, i.final_total - COALESCE(p_summary.total_paid, 0)),
            'created_at', i.created_at
        ) ORDER BY i.created_at DESC
    ), '[]'::jsonb)
    INTO v_invoices
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(amount), 0) AS total_paid
        FROM payments
        WHERE invoice_id = i.id
    ) p_summary ON true
    WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
      AND i.is_voided = FALSE
      AND i.is_hidden = FALSE;

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
      AND e.is_voided = FALSE
      AND e.is_hidden = FALSE;

    -- Tab 3: Daily Sales
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'date', d.b_day,
            'invoice_count', d.inv_count,
            'total_sales', d.sales,
            'discount_amount', d.discount,
            'total_collected', d.collected
        ) ORDER BY d.b_day DESC
    ), '[]'::jsonb)
    INTO v_daily_sales
    FROM (
        SELECT 
            to_char(((i.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::INTERVAL), 'YYYY-MM-DD') AS b_day,
            COUNT(i.id) AS inv_count,
            COALESCE(SUM(i.final_total), 0) AS sales,
            COALESCE(SUM(i.discount_amount), 0) AS discount,
            COALESCE(SUM(p_sub.paid_sum), 0) AS collected
        FROM invoices i
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(amount), 0) AS paid_sum
            FROM payments
            WHERE invoice_id = i.id
        ) p_sub ON true
        WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
          AND i.is_voided = FALSE
          AND i.is_hidden = FALSE
        GROUP BY 1
    ) d;

    -- Tab 4: Monthly Sales
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', m.b_month,
            'invoice_count', m.inv_count,
            'total_sales', m.sales,
            'discount_amount', m.discount,
            'total_collected', m.collected
        ) ORDER BY m.b_month DESC
    ), '[]'::jsonb)
    INTO v_monthly_sales
    FROM (
        SELECT 
            to_char(((i.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::INTERVAL), 'YYYY-MM') AS b_month,
            COUNT(i.id) AS inv_count,
            COALESCE(SUM(i.final_total), 0) AS sales,
            COALESCE(SUM(i.discount_amount), 0) AS discount,
            COALESCE(SUM(p_sub.paid_sum), 0) AS collected
        FROM invoices i
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(amount), 0) AS paid_sum
            FROM payments
            WHERE invoice_id = i.id
        ) p_sub ON true
        WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
          AND i.is_voided = FALSE
          AND i.is_hidden = FALSE
        GROUP BY 1
    ) m;

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
    WHERE cm.is_active = TRUE AND cm.pending_dues <> 0;

    -- Tab 6: Monthly Profit (UNCLAMPED)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', m.b_month,
            'sales', COALESCE(im.sales, 0),
            'cogs', COALESCE(im.cogs, 0),
            'gross_profit', (COALESCE(im.profit_sum, 0) - COALESCE(im.discount, 0)),
            'expenses', COALESCE(em.expenses, 0),
            'net_profit', ((COALESCE(im.profit_sum, 0) - COALESCE(im.discount, 0)) - COALESCE(em.expenses, 0))
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
              AND i.is_voided = FALSE
              AND i.is_hidden = FALSE
            GROUP BY 1
        ),
        expense_months AS (
            SELECT 
                to_char(((e.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::INTERVAL), 'YYYY-MM') AS b_month,
                COALESCE(SUM(e.amount), 0) AS expenses
            FROM expenses e
            WHERE e.created_at >= p_start_date AND e.created_at <= p_end_date
              AND e.is_voided = FALSE
              AND e.is_hidden = FALSE
            GROUP BY 1
        ),
        all_months AS (
            SELECT b_month FROM invoice_months
            UNION
            SELECT b_month FROM expense_months
        )
        SELECT 
            am.b_month,
            im.sales,
            im.cost_sum AS cogs,
            im.discount,
            im.profit_sum,
            em.expenses
        FROM all_months am
        LEFT JOIN invoice_months im ON am.b_month = im.b_month
        LEFT JOIN expense_months em ON am.b_month = em.b_month
    ) m;

    -- Tab 7: Profit by Product
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_name', p_stat.product_name,
            'variant_name', p_stat.variant_name,
            'barcode', p_stat.barcode,
            'category_name', p_stat.category_name,
            'quantity_sold', p_stat.qty,
            'revenue', p_stat.rev,
            'cogs', p_stat.cogs,
            'gross_profit', p_stat.prof,
            'margin_percent', CASE WHEN p_stat.rev > 0 THEN ROUND((p_stat.prof / p_stat.rev) * 100, 2) ELSE 0.00 END
        ) ORDER BY p_stat.prof DESC
    ), '[]'::jsonb)
    INTO v_profit_by_product
    FROM (
        SELECT 
            p.name AS product_name,
            v.name AS variant_name,
            v.barcode,
            COALESCE(c.name, 'Uncategorized') AS category_name,
            SUM(ii.quantity) AS qty,
            SUM(ii.quantity * ii.selling_price_snapshot) AS rev,
            SUM(ii.quantity * ii.cost_price_snapshot) AS cogs,
            SUM(ii.profit_snapshot) AS prof
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
          AND i.is_voided = FALSE
          AND i.is_hidden = FALSE
        GROUP BY p.name, v.name, v.barcode, c.name
    ) p_stat;

    -- Tab 8: Items Sold
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_name', p_stat.product_name,
            'variant_name', p_stat.variant_name,
            'barcode', p_stat.barcode,
            'category_name', p_stat.category_name,
            'pieces_per_set', p_stat.pieces_per_set,
            'total_pieces_sold', p_stat.qty,
            'sets_sold', p_stat.sets,
            'loose_sold', p_stat.loose,
            'total_revenue', p_stat.rev
        ) ORDER BY p_stat.qty DESC
    ), '[]'::jsonb)
    INTO v_by_product
    FROM (
        SELECT 
            p.name AS product_name,
            v.name AS variant_name,
            v.barcode,
            COALESCE(c.name, 'Uncategorized') AS category_name,
            p.pieces_per_set,
            SUM(ii.quantity) AS qty,
            SUM(ii.sets_quantity) AS sets,
            SUM(ii.loose_quantity) AS loose,
            SUM(ii.quantity * ii.selling_price_snapshot) AS rev
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
          AND i.is_voided = FALSE
          AND i.is_hidden = FALSE
        GROUP BY p.name, v.name, v.barcode, c.name, p.pieces_per_set
    ) p_stat;

    -- Tab 9: Category Breakdown
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'category_name', c_stat.cat_name,
            'total_pieces_sold', c_stat.qty,
            'total_revenue', c_stat.rev,
            'gross_profit', c_stat.prof
        ) ORDER BY c_stat.rev DESC
    ), '[]'::jsonb)
    INTO v_by_category
    FROM (
        SELECT 
            COALESCE(c.name, 'Uncategorized') AS cat_name,
            SUM(ii.quantity) AS qty,
            SUM(ii.quantity * ii.selling_price_snapshot) AS rev,
            SUM(ii.profit_snapshot) AS prof
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
          AND i.is_voided = FALSE
          AND i.is_hidden = FALSE
        GROUP BY c.name
    ) c_stat;

    -- Tab 10: Stock at Cost Breakdown
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_name', p.name,
            'variant_name', v.name,
            'barcode', v.barcode,
            'category_name', COALESCE(c.name, 'Uncategorized'),
            'stock_quantity', v.stock_quantity,
            'stock_sets', v.stock_sets,
            'cost_price', v.cost_price,
            'stock_valuation', (v.stock_quantity * v.cost_price)
        ) ORDER BY (v.stock_quantity * v.cost_price) DESC
    ), '[]'::jsonb)
    INTO v_stock_cost
    FROM variants v
    JOIN products p ON v.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE v.is_active = TRUE AND p.is_active = TRUE;

    -- Tab 11: Stock Movements
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', sm.id,
            'created_at', sm.created_at,
            'product_name', p.name,
            'variant_name', v.name,
            'barcode', v.barcode,
            'type', sm.type,
            'quantity_change', sm.quantity_change,
            'notes', sm.notes
        ) ORDER BY sm.created_at DESC
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
            'category_name', c_stat.cat_name,
            'total_stock_pieces', c_stat.tot_qty,
            'total_valuation', c_stat.tot_val
        ) ORDER BY c_stat.tot_val DESC
    ), '[]'::jsonb)
    INTO v_stock_by_category
    FROM (
        SELECT 
            COALESCE(c.name, 'Uncategorized') AS cat_name,
            COALESCE(SUM(v.stock_quantity), 0) AS tot_qty,
            COALESCE(SUM(v.stock_quantity * v.cost_price), 0) AS tot_val
        FROM variants v
        JOIN products p ON v.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE v.is_active = TRUE AND p.is_active = TRUE
        GROUP BY c.name
    ) c_stat;

    -- Return JSON payload
    RETURN jsonb_build_object(
        'success', true,
        'period_metrics', jsonb_build_object(
            'total_sales', v_total_sales,
            'total_discount', v_total_discount,
            'gross_profit', v_gross_profit,
            'total_collected', v_total_collected,
            'cash_collected', v_cash_collected,
            'upi_collected', v_upi_collected,
            'store_credit_collected', v_store_credit_collected,
            'outstanding_dues', v_outstanding_dues,
            'invoice_count', v_invoice_count,
            'total_expenses', v_total_expenses,
            'net_profit', v_net_profit,
            'stock_at_cost', v_stock_at_cost
        ),
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
