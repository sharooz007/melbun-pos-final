-- Migration: 0087_fix_p1_high_integrity_issues.sql
-- Description: Comprehensive P1 High Integrity Fixes
-- 1. High 3: undo_void_invoice packaged sets validation & clamping
-- 2. High 6: get_comprehensive_reports van inventory inclusion in asset valuation
-- 3. High 7: get_expense_summary_metrics aggregation RPC (bypasses 1000-row PostgREST cap)
-- 4. High 8: get_or_create_customer discrete customer creation for un-phoned walk-ins

-- ============================================================================
-- 1. High 3: Hardened undo_void_invoice with Packaged Sets Validation & Clamping
-- ============================================================================
CREATE OR REPLACE FUNCTION undo_void_invoice(
    p_invoice_id UUID,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_item RECORD;
    v_variant RECORD;
    v_van_item RECORD;
    v_var_req RECORD;
    v_net_pieces_to_deduct INTEGER;
    v_sets_to_deduct INTEGER;
    v_pieces_per_set INTEGER;
    v_net_store_credit_paid DECIMAL(10,2) := 0;
    v_new_balance DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Unauthorized.'; 
    END IF;
    IF p_invoice_id IS NULL THEN 
        RAISE EXCEPTION 'Invoice ID is required.'; 
    END IF;

    -- 1. Lock invoice
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Invoice not found.'; 
    END IF;
    IF NOT v_invoice.is_voided THEN 
        RAISE EXCEPTION 'Invoice is not voided.'; 
    END IF;
    IF v_invoice.is_hidden THEN 
        RAISE EXCEPTION 'Cannot undo void on a permanently deleted invoice.'; 
    END IF;

    -- 2. Ordered variant row locks to avoid deadlocks
    PERFORM 1 FROM variants v 
    WHERE v.id IN (SELECT variant_id FROM invoice_items WHERE invoice_id = p_invoice_id) 
    ORDER BY v.id FOR UPDATE OF v;

    IF v_invoice.customer_id IS NOT NULL THEN 
        PERFORM 1 FROM customers WHERE id = v_invoice.customer_id FOR UPDATE; 
    END IF;

    -- 3. Pre-aggregate and validate both pieces AND sets availability per variant
    FOR v_var_req IN
        SELECT 
            ii.variant_id,
            v.name AS variant_name,
            v.stock_quantity,
            v.stock_sets,
            GREATEST(COALESCE(v.pieces_per_set, p.pieces_per_set, 1), 1) AS effective_pps,
            SUM(ii.quantity) AS total_req_pieces,
            SUM(LEAST(COALESCE(ii.sets_quantity, 0), FLOOR(ii.quantity::numeric / GREATEST(COALESCE(v.pieces_per_set, p.pieces_per_set, 1), 1)))) AS total_req_sets
        FROM invoice_items ii
        JOIN variants v ON ii.variant_id = v.id
        JOIN products p ON v.product_id = p.id
        WHERE ii.invoice_id = p_invoice_id
        GROUP BY ii.variant_id, v.name, v.stock_quantity, v.stock_sets, v.pieces_per_set, p.pieces_per_set
    LOOP
        IF v_var_req.total_req_pieces > 0 THEN
            IF v_invoice.line_staff_id IS NOT NULL THEN
                SELECT * INTO v_van_item 
                FROM line_van_inventory 
                WHERE staff_id = v_invoice.line_staff_id AND variant_id = v_var_req.variant_id 
                FOR UPDATE;

                IF NOT FOUND OR v_van_item.quantity < v_var_req.total_req_pieces THEN
                    RAISE EXCEPTION 'Insufficient van stock for variant "%" to undo void (available: %, required: %).', 
                        v_var_req.variant_name, COALESCE(v_van_item.quantity, 0), v_var_req.total_req_pieces;
                END IF;
                IF v_van_item.sets_quantity < v_var_req.total_req_sets THEN
                    RAISE EXCEPTION 'Insufficient van sets for variant "%" to undo void (available: %, required: %).', 
                        v_var_req.variant_name, COALESCE(v_van_item.sets_quantity, 0), v_var_req.total_req_sets;
                END IF;
            ELSE
                IF v_var_req.stock_quantity < v_var_req.total_req_pieces THEN
                    RAISE EXCEPTION 'Insufficient warehouse stock for variant "%" to undo void (available: %, required: %).', 
                        v_var_req.variant_name, v_var_req.stock_quantity, v_var_req.total_req_pieces;
                END IF;
                IF v_var_req.stock_sets < v_var_req.total_req_sets THEN
                    RAISE EXCEPTION 'Insufficient warehouse sets for variant "%" to undo void (available: %, required: %).', 
                        v_var_req.variant_name, v_var_req.stock_sets, v_var_req.total_req_sets;
                END IF;
            END IF;
        END IF;
    END LOOP;

    -- 4. Deduct stock with mathematical dual-inventory set clamping
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant 
        FROM variants v 
        JOIN products p ON v.product_id = p.id 
        WHERE v.id = v_item.variant_id;

        v_pieces_per_set := GREATEST(COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1), 1);
        v_net_pieces_to_deduct := v_item.quantity;
        v_sets_to_deduct := LEAST(COALESCE(v_item.sets_quantity, 0), FLOOR(v_net_pieces_to_deduct::numeric / v_pieces_per_set));

        IF v_net_pieces_to_deduct > 0 THEN
            IF v_invoice.line_staff_id IS NOT NULL THEN
                UPDATE line_van_inventory 
                SET quantity = quantity - v_net_pieces_to_deduct, 
                    sets_quantity = GREATEST(0, LEAST(sets_quantity - v_sets_to_deduct, FLOOR((quantity - v_net_pieces_to_deduct)::numeric / v_pieces_per_set))), 
                    updated_at = NOW() 
                WHERE staff_id = v_invoice.line_staff_id AND variant_id = v_item.variant_id;
                
                INSERT INTO line_stock_movements (staff_id, variant_id, movement_type, sets_quantity, quantity, notes)
                VALUES (v_invoice.line_staff_id, v_item.variant_id, 'SALE_DEDUCT', v_sets_to_deduct, v_net_pieces_to_deduct, 'Undo Void ' || v_invoice.invoice_number);
            ELSE
                UPDATE variants 
                SET stock_quantity = stock_quantity - v_net_pieces_to_deduct, 
                    stock_sets = GREATEST(0, LEAST(stock_sets - v_sets_to_deduct, FLOOR((stock_quantity - v_net_pieces_to_deduct)::numeric / v_pieces_per_set))), 
                    updated_at = NOW() 
                WHERE id = v_item.variant_id;

                INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, sets_change, loose_change, notes)
                VALUES (v_item.id, v_item.variant_id, 'SALE'::stock_movement_type, -v_net_pieces_to_deduct, -v_sets_to_deduct, -COALESCE(v_item.loose_quantity, 0), 'Undo Void ' || v_invoice.invoice_number);
            END IF;
        END IF;
    END LOOP;

    -- 5. Customer store credit re-application if applicable
    IF v_invoice.customer_id IS NOT NULL THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_net_store_credit_paid 
        FROM payments 
        WHERE invoice_id = p_invoice_id AND method = 'STORE_CREDIT';

        IF v_net_store_credit_paid > 0 THEN
            SELECT credit_balance INTO v_new_balance FROM customers WHERE id = v_invoice.customer_id FOR UPDATE;
            IF v_new_balance < v_net_store_credit_paid THEN 
                RAISE EXCEPTION 'Insufficient store credit to undo void.'; 
            END IF;
            UPDATE customers SET credit_balance = credit_balance - v_net_store_credit_paid, updated_at = NOW() WHERE id = v_invoice.customer_id RETURNING credit_balance INTO v_new_balance;
            INSERT INTO customer_credit_ledger (customer_id, type, amount, balance_after, reference_invoice_id, notes)
            VALUES (v_invoice.customer_id, 'PAYMENT_APPLIED'::credit_movement_type, -v_net_store_credit_paid, v_new_balance, p_invoice_id, 'Re-apply Store Credit for Undo Void ' || v_invoice.invoice_number);
        END IF;
    END IF;

    -- 6. Un-void invoice
    UPDATE invoices SET is_voided = FALSE, void_reason = NULL, updated_at = NOW() WHERE id = p_invoice_id;
    RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.undo_void_invoice(UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 2. High 7: Database RPC get_expense_summary_metrics
-- ============================================================================
CREATE OR REPLACE FUNCTION get_expense_summary_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_total_active_sum NUMERIC(12, 2) := 0.00;
    v_cash_sum NUMERIC(12, 2) := 0.00;
    v_upi_sum NUMERIC(12, 2) := 0.00;
    v_voided_count BIGINT := 0;
    v_total_count BIGINT := 0;
BEGIN
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; 
    END IF;

    SELECT 
        COALESCE(SUM(amount) FILTER (WHERE is_voided = FALSE), 0.00),
        COALESCE(SUM(amount) FILTER (WHERE is_voided = FALSE AND payment_method = 'CASH'), 0.00),
        COALESCE(SUM(amount) FILTER (WHERE is_voided = FALSE AND payment_method = 'UPI'), 0.00),
        COALESCE(COUNT(*) FILTER (WHERE is_voided = TRUE), 0),
        COALESCE(COUNT(*) FILTER (WHERE is_voided = FALSE), 0)
    INTO 
        v_total_active_sum,
        v_cash_sum,
        v_upi_sum,
        v_voided_count,
        v_total_count
    FROM expenses
    WHERE is_hidden = FALSE;

    RETURN jsonb_build_object(
        'totalActiveSum', v_total_active_sum,
        'cashSum', v_cash_sum,
        'upiSum', v_upi_sum,
        'voidedCount', v_voided_count,
        'totalCount', v_total_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_expense_summary_metrics() TO authenticated, service_role;

-- ============================================================================
-- 3. High 8: get_or_create_customer Discrete Walk-in Creation (No LOWER(name) merge)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_or_create_customer(
    p_name TEXT,
    p_phone TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_customer RECORD;
    v_clean_phone TEXT := NULLIF(trim(p_phone), '');
    v_clean_name TEXT := NULLIF(trim(p_name), '');
BEGIN
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Unauthorized.'; 
    END IF;
    
    -- At least one identifier (name or phone) must be provided
    IF v_clean_name IS NULL AND v_clean_phone IS NULL THEN 
        RAISE EXCEPTION 'Customer name or phone number is required'; 
    END IF;

    -- Default name for phone-only customer if name was omitted
    IF v_clean_name IS NULL THEN
        v_clean_name := 'Customer (' || v_clean_phone || ')';
    END IF;

    -- 1. If phone is provided, lookup by phone (Authoritative Unique Identifier)
    IF v_clean_phone IS NOT NULL THEN
        SELECT * INTO v_customer FROM customers WHERE phone = v_clean_phone;
        
        IF FOUND THEN
            -- Upgrade placeholder name if a real name is now supplied
            IF v_customer.name LIKE 'Customer (%)' AND v_clean_name NOT LIKE 'Customer (%)' THEN
                UPDATE customers 
                SET name = v_clean_name, 
                    is_active = TRUE,
                    updated_at = NOW()
                WHERE id = v_customer.id
                RETURNING * INTO v_customer;
            ELSIF v_customer.is_active = FALSE THEN
                UPDATE customers 
                SET is_active = TRUE, 
                    updated_at = NOW()
                WHERE id = v_customer.id
                RETURNING * INTO v_customer;
            END IF;

            RETURN jsonb_build_object(
                'success', true, 
                'customer', jsonb_build_object(
                    'id', v_customer.id, 
                    'name', v_customer.name, 
                    'phone', v_customer.phone
                )
            );
        END IF;

        -- Phone provided but not found: create new customer with conflict safety
        INSERT INTO customers (name, phone, is_active) 
        VALUES (v_clean_name, v_clean_phone, TRUE)
        ON CONFLICT (phone) WHERE phone IS NOT NULL 
        DO UPDATE SET 
            name = CASE 
                WHEN customers.name LIKE 'Customer (%)' AND EXCLUDED.name NOT LIKE 'Customer (%)' THEN EXCLUDED.name 
                ELSE customers.name 
            END,
            is_active = TRUE,
            updated_at = NOW()
        RETURNING * INTO v_customer;

        RETURN jsonb_build_object(
            'success', true, 
            'customer', jsonb_build_object(
                'id', v_customer.id, 
                'name', v_customer.name, 
                'phone', v_customer.phone
            )
        );
    END IF;

    -- 2. No phone provided (Un-phoned walk-in):
    -- High 8 Fix: NEVER merge by name alone to prevent accidental cross-customer debt / credit collisions.
    -- Always create a new discrete customer record with its own unique UUID.
    INSERT INTO customers (name, phone, is_active) 
    VALUES (v_clean_name, NULL, TRUE) 
    RETURNING * INTO v_customer;

    RETURN jsonb_build_object(
        'success', true, 
        'customer', jsonb_build_object(
            'id', v_customer.id, 
            'name', v_customer.name, 
            'phone', v_customer.phone
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_customer(TEXT, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 4. High 6: get_comprehensive_reports (Van Inventory Fleet Asset Valuation)
-- ============================================================================
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
    v_returned_profit DECIMAL(12, 2) := 0.00;
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

    -- 2. Returns Total in Period
    SELECT COALESCE(SUM(r.total_refund_amount), 0.00)
    INTO v_total_returns
    FROM returns r
    LEFT JOIN invoices inv ON r.invoice_id = inv.id
    WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
      AND (r.invoice_id IS NULL OR (inv.is_voided = FALSE AND inv.is_hidden = FALSE));

    -- 3. Pending Uncleared Cheques
    SELECT COALESCE(SUM(cc.amount), 0.00)
    INTO v_pending_cheques_total
    FROM customer_cheques cc
    LEFT JOIN invoices inv ON cc.invoice_id = inv.id
    WHERE cc.status = 'PENDING'
      AND (cc.invoice_id IS NULL OR (inv.is_voided = FALSE AND inv.is_hidden = FALSE));

    -- 4. Profit Calculation (Net of Returns)
    SELECT COALESCE(SUM(ii.profit_snapshot), 0.00)
    INTO v_raw_profit
    FROM invoice_items ii
    JOIN invoices inv ON ii.invoice_id = inv.id
    WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
      AND inv.is_voided = FALSE AND inv.is_hidden = FALSE;

    SELECT COALESCE(SUM(r.quantity * (ii.selling_price_snapshot - ii.cost_price_snapshot)), 0.00)
    INTO v_returned_profit
    FROM returns r
    JOIN invoice_items ii ON r.invoice_item_id = ii.id
    JOIN invoices inv ON r.invoice_id = inv.id
    WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
      AND inv.is_voided = FALSE AND inv.is_hidden = FALSE;

    v_raw_profit := v_raw_profit - v_returned_profit;
    v_gross_profit := v_raw_profit - v_total_discount;

    -- 5. Collections Breakdown (STORE_CREDIT excluded from v_total_collected)
    SELECT 
        COALESCE(SUM(p.amount) FILTER (WHERE p.method IS DISTINCT FROM 'STORE_CREDIT'), 0.00),
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

    -- 8. High 6: Current Stock at Cost (Warehouse + Van Fleet Inventory)
    SELECT COALESCE(SUM((v.stock_quantity + COALESCE(lvi.van_qty, 0)) * v.cost_price), 0.00)
    INTO v_stock_at_cost
    FROM variants v
    JOIN products p ON v.product_id = p.id
    LEFT JOIN (
        SELECT variant_id, SUM(quantity) AS van_qty
        FROM line_van_inventory
        GROUP BY variant_id
    ) lvi ON lvi.variant_id = v.id
    WHERE v.is_active = TRUE AND p.is_active = TRUE;

    -- Sales Trend
    WITH invoice_days AS (
        SELECT 
            ((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(inv.final_total), 0.00) AS sales
        FROM invoices inv
        WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
          AND inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1
    ),
    return_days AS (
        SELECT 
            ((r.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(r.total_refund_amount), 0.00) AS returns
        FROM returns r
        JOIN invoices i ON r.invoice_id = i.id
        WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
          AND i.is_voided = FALSE AND i.is_hidden = FALSE
        GROUP BY 1
    ),
    payment_days AS (
        SELECT 
            ((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(p.amount) FILTER (WHERE p.method IS DISTINCT FROM 'STORE_CREDIT'), 0.00) AS collected
        FROM payments p
        LEFT JOIN invoices i ON p.invoice_id = i.id
        WHERE p.created_at >= p_start_date AND p.created_at <= p_end_date
          AND (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE))
        GROUP BY 1
    ),
    all_days AS (
        SELECT b_day FROM invoice_days UNION
        SELECT b_day FROM return_days UNION
        SELECT b_day FROM payment_days
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'label', to_char(ad.b_day, 'DD Mon'),
            'date', ad.b_day::TEXT,
            'sales', GREATEST(0.00, COALESCE(id.sales, 0.00) - COALESCE(rd.returns, 0.00)),
            'collected', COALESCE(pd.collected, 0.00)
        ) ORDER BY ad.b_day ASC
    ), '[]'::jsonb)
    INTO v_sales_trend
    FROM all_days ad
    LEFT JOIN invoice_days id ON ad.b_day = id.b_day
    LEFT JOIN return_days rd ON ad.b_day = rd.b_day
    LEFT JOIN payment_days pd ON ad.b_day = pd.b_day;

    -- Tab 1: Invoices List
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
            COALESCE(c.name, 'Walk-in Customer') AS customer_name,
            inv.subtotal,
            inv.discount_amount,
            inv.final_total,
            COALESCE(SUM(p.amount), 0.00) AS paid_amount,
            COALESCE(MIN(p.method), 'UNPAID') AS primary_method,
            CASE 
                WHEN inv.is_voided THEN 'Void'
                WHEN COALESCE(SUM(p.amount), 0.00) >= inv.final_total THEN 'Paid'
                WHEN COALESCE(SUM(p.amount), 0.00) > 0 THEN 'Partial'
                ELSE 'Unpaid'
            END AS status,
            inv.is_voided,
            (inv.line_staff_id IS NOT NULL) AS is_line_sale
        FROM invoices inv
        LEFT JOIN customers c ON inv.customer_id = c.id
        LEFT JOIN payments p ON inv.id = p.invoice_id
        WHERE inv.created_at >= p_start_date AND inv.created_at <= p_end_date
          AND inv.is_hidden = FALSE
        GROUP BY inv.id, c.name
        ORDER BY inv.created_at DESC
        LIMIT 500
    ) sub;

    -- Tab 2: Expenses List
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', e.id, 'category', e.category, 'amount', e.amount, 'notes', e.notes,
            'payment_method', e.payment_method, 'created_at', e.created_at, 'is_voided', e.is_voided
        ) ORDER BY e.created_at DESC
    ), '[]'::jsonb)
    INTO v_expenses_list
    FROM expenses e
    WHERE e.created_at >= p_start_date AND e.created_at <= p_end_date
      AND e.is_hidden = FALSE
    LIMIT 500;

    -- Tab 3: Daily Sales (Strict Cutoff Hour Timezone Grouping)
    WITH invoice_days AS (
        SELECT 
            ((inv.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(inv.final_total), 0.00) AS gross_sales,
            COALESCE(SUM(inv.discount_amount), 0.00) AS discount,
            COUNT(inv.id) AS inv_count
        FROM invoices inv
        WHERE inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1
    ),
    return_days AS (
        SELECT 
            ((r.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(r.total_refund_amount), 0.00) AS returns
        FROM returns r
        JOIN invoices i ON r.invoice_id = i.id
        WHERE i.is_voided = FALSE AND i.is_hidden = FALSE
        GROUP BY 1
    ),
    payment_days AS (
        SELECT 
            ((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE AS b_day,
            COALESCE(SUM(p.amount) FILTER (WHERE p.method IS DISTINCT FROM 'STORE_CREDIT'), 0.00) AS collected
        FROM payments p
        LEFT JOIN invoices i ON p.invoice_id = i.id
        WHERE (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE))
        GROUP BY 1
    ),
    all_days AS (
        SELECT b_day FROM invoice_days UNION
        SELECT b_day FROM return_days UNION
        SELECT b_day FROM payment_days
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'date', to_char(ad.b_day, 'DD Mon YYYY'),
            'raw_date', ad.b_day::TEXT,
            'gross_sales', COALESCE(id.gross_sales, 0.00),
            'net_sales', GREATEST(0.00, COALESCE(id.gross_sales, 0.00) - COALESCE(rd.returns, 0.00)),
            'discount', COALESCE(id.discount, 0.00),
            'invoice_count', COALESCE(id.inv_count, 0),
            'collected', COALESCE(pd.collected, 0.00)
        ) ORDER BY ad.b_day DESC
    ), '[]'::jsonb)
    INTO v_daily_sales
    FROM (
        SELECT ad.b_day
        FROM all_days ad
        WHERE ad.b_day >= (((p_start_date AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE)
          AND ad.b_day <= (((p_end_date AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval)::DATE)
        ORDER BY ad.b_day DESC
        LIMIT 60
    ) ad
    LEFT JOIN invoice_days id ON ad.b_day = id.b_day
    LEFT JOIN return_days rd ON ad.b_day = rd.b_day
    LEFT JOIN payment_days pd ON ad.b_day = pd.b_day;

    -- Tab 4: Monthly Sales (Strict 12-Month Subquery Limit)
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
    return_months AS (
        SELECT 
            to_char(((r.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            COALESCE(SUM(r.total_refund_amount), 0.00) AS returns
        FROM returns r
        JOIN invoices i ON r.invoice_id = i.id
        WHERE i.is_voided = FALSE AND i.is_hidden = FALSE
        GROUP BY 1
    ),
    payment_months AS (
        SELECT 
            to_char(((p.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            COALESCE(SUM(p.amount) FILTER (WHERE p.method IS DISTINCT FROM 'STORE_CREDIT'), 0.00) AS collected
        FROM payments p
        LEFT JOIN invoices i ON p.invoice_id = i.id
        WHERE (p.invoice_id IS NULL OR (i.is_voided = FALSE AND i.is_hidden = FALSE))
        GROUP BY 1
    ),
    all_months AS (
        SELECT b_month_key FROM invoice_months UNION
        SELECT b_month_key FROM return_months UNION
        SELECT b_month_key FROM payment_months
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', ms.b_month_label,
            'gross_sales', ms.gross_sales,
            'net_sales', ms.net_sales,
            'discount', ms.discount,
            'invoice_count', ms.invoice_count,
            'collected', ms.collected
        ) ORDER BY ms.b_month_key DESC
    ), '[]'::jsonb)
    INTO v_monthly_sales
    FROM (
        SELECT 
            am.b_month_key,
            COALESCE(im.b_month_label, to_char(TO_DATE(am.b_month_key || '-01', 'YYYY-MM-DD'), 'Mon YYYY')) AS b_month_label,
            COALESCE(im.gross_sales, 0.00) AS gross_sales,
            GREATEST(0.00, COALESCE(im.gross_sales, 0.00) - COALESCE(rm.returns, 0.00)) AS net_sales,
            COALESCE(im.discount, 0.00) AS discount,
            COALESCE(im.inv_count, 0) AS invoice_count,
            COALESCE(pm.collected, 0.00) AS collected
        FROM all_months am
        LEFT JOIN invoice_months im ON am.b_month_key = im.b_month_key
        LEFT JOIN return_months rm ON am.b_month_key = rm.b_month_key
        LEFT JOIN payment_months pm ON am.b_month_key = pm.b_month_key
        ORDER BY am.b_month_key DESC
        LIMIT 12
    ) ms;

    -- Tab 5: Customer Credits
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'customer_id', cm.id, 'customer_name', cm.name, 'phone', cm.phone,
            'total_spend', cm.total_spend, 'total_paid', cm.total_paid, 'pending_dues', cm.pending_dues
        ) ORDER BY cm.pending_dues DESC
    ), '[]'::jsonb)
    INTO v_credits
    FROM customer_metrics cm WHERE cm.is_active = TRUE AND cm.pending_dues > 0;

    -- Tab 6: Monthly Profit (Net of Returns, Strict 12-Month Subquery Limit)
    WITH invoice_items_per_inv AS (
        SELECT invoice_id, COALESCE(SUM(quantity * cost_price_snapshot), 0.00) AS cogs, COALESCE(SUM(profit_snapshot), 0.00) AS raw_profit
        FROM invoice_items GROUP BY invoice_id
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
    return_months AS (
        SELECT 
            to_char(((r.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            COALESCE(SUM(r.total_refund_amount), 0.00) AS ret_sales,
            COALESCE(SUM(r.quantity * ii.cost_price_snapshot), 0.00) AS ret_cogs,
            COALESCE(SUM(r.quantity * (ii.selling_price_snapshot - ii.cost_price_snapshot)), 0.00) AS ret_profit
        FROM returns r
        JOIN invoice_items ii ON r.invoice_item_id = ii.id
        JOIN invoices inv ON r.invoice_id = inv.id
        WHERE inv.is_voided = FALSE AND inv.is_hidden = FALSE
        GROUP BY 1
    ),
    expense_months AS (
        SELECT 
            to_char(((e.created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval), 'YYYY-MM') AS b_month_key,
            COALESCE(SUM(e.amount), 0.00) AS expenses
        FROM expenses e
        WHERE e.is_voided = FALSE AND e.is_hidden = FALSE
        GROUP BY 1
    ),
    all_months AS (
        SELECT b_month_key FROM invoice_months UNION
        SELECT b_month_key FROM return_months UNION
        SELECT b_month_key FROM expense_months
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'month', mp.b_month_label,
            'sales', mp.sales,
            'cogs', mp.cogs,
            'gross_profit', mp.gross_profit,
            'expenses', mp.expenses,
            'net_profit', mp.net_profit
        ) ORDER BY mp.b_month_key DESC
    ), '[]'::jsonb)
    INTO v_monthly_profit
    FROM (
        SELECT 
            am.b_month_key,
            COALESCE(im.b_month_label, to_char(TO_DATE(am.b_month_key || '-01', 'YYYY-MM-DD'), 'Mon YYYY')) AS b_month_label,
            GREATEST(0.00, COALESCE(im.sales, 0.00) - COALESCE(rm.ret_sales, 0.00)) AS sales,
            GREATEST(0.00, COALESCE(im.cogs, 0.00) - COALESCE(rm.ret_cogs, 0.00)) AS cogs,
            ((COALESCE(im.raw_profit, 0.00) - COALESCE(rm.ret_profit, 0.00)) - COALESCE(im.discount, 0.00)) AS gross_profit,
            COALESCE(em.expenses, 0.00) AS expenses,
            (((COALESCE(im.raw_profit, 0.00) - COALESCE(rm.ret_profit, 0.00)) - COALESCE(im.discount, 0.00)) - COALESCE(em.expenses, 0.00)) AS net_profit
        FROM all_months am
        LEFT JOIN invoice_months im ON am.b_month_key = im.b_month_key
        LEFT JOIN return_months rm ON am.b_month_key = rm.b_month_key
        LEFT JOIN expense_months em ON am.b_month_key = em.b_month_key
        ORDER BY am.b_month_key DESC
        LIMIT 12
    ) mp;

    -- Tab 7: Profit by Product (Net of Returns)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_id', pp.prod_id, 'variant_id', pp.var_id, 'product_name', pp.prod_name, 'variant_name', pp.var_name,
            'quantity_sold', pp.qty, 'revenue', pp.rev, 'cogs', pp.cogs, 'profit', pp.prof,
            'margin_percent', CASE WHEN pp.rev > 0 THEN ROUND((pp.prof / pp.rev) * 100, 1) ELSE 0.0 END
        ) ORDER BY pp.prof DESC
    ), '[]'::jsonb)
    INTO v_profit_by_product
    FROM (
        SELECT 
            p_id AS prod_id, v_id AS var_id, p_name AS prod_name, v_name AS var_name,
            SUM(qty) AS qty, SUM(rev) AS rev, SUM(cogs) AS cogs, SUM(prof) AS prof
        FROM (
            SELECT 
                p.id AS p_id, v.id AS v_id, p.name AS p_name, v.name AS v_name,
                ii.quantity AS qty,
                (ii.quantity * ii.selling_price_snapshot) AS rev,
                (ii.quantity * ii.cost_price_snapshot) AS cogs,
                ii.profit_snapshot AS prof
            FROM invoice_items ii
            JOIN invoices i ON ii.invoice_id = i.id
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
            
            UNION ALL
            
            SELECT 
                p.id AS p_id, v.id AS v_id, p.name AS p_name, v.name AS v_name,
                -r.quantity AS qty,
                -r.total_refund_amount AS rev,
                -(r.quantity * ii.cost_price_snapshot) AS cogs,
                -(r.quantity * (ii.selling_price_snapshot - ii.cost_price_snapshot)) AS prof
            FROM returns r
            JOIN invoice_items ii ON r.invoice_item_id = ii.id
            JOIN invoices i ON r.invoice_id = i.id
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
        ) combined
        GROUP BY p_id, v_id, p_name, v_name
    ) pp;

    -- Tab 8: Top Products by Volume (Net of Returns)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_id', tp.p_id, 'product_name', tp.p_name, 'quantity_sold', tp.tot_qty, 'total_sales', tp.tot_sales
        ) ORDER BY tp.tot_qty DESC
    ), '[]'::jsonb)
    INTO v_by_product
    FROM (
        SELECT p_id, p_name, SUM(qty) AS tot_qty, SUM(rev) AS tot_sales
        FROM (
            SELECT 
                p.id AS p_id, p.name AS p_name, ii.quantity AS qty, (ii.quantity * ii.selling_price_snapshot) AS rev
            FROM invoice_items ii
            JOIN invoices i ON ii.invoice_id = i.id
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
            UNION ALL
            SELECT 
                p.id AS p_id, p.name AS p_name, -r.quantity AS qty, -r.total_refund_amount AS rev
            FROM returns r
            JOIN invoice_items ii ON r.invoice_item_id = ii.id
            JOIN invoices i ON r.invoice_id = i.id
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
        ) combined
        GROUP BY p_id, p_name
        ORDER BY tot_qty DESC
        LIMIT 50
    ) tp;

    -- Tab 9: Sales by Category (Net of Returns)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'category_name', tc.c_name, 'quantity_sold', tc.tot_qty, 'total_sales', tc.tot_sales, 'total_profit', tc.tot_prof
        ) ORDER BY tc.tot_sales DESC
    ), '[]'::jsonb)
    INTO v_by_category
    FROM (
        SELECT c_name, SUM(qty) AS tot_qty, SUM(rev) AS tot_sales, SUM(prof) AS tot_prof
        FROM (
            SELECT 
                COALESCE(c.name, 'Uncategorized') AS c_name, ii.quantity AS qty,
                (ii.quantity * ii.selling_price_snapshot) AS rev, ii.profit_snapshot AS prof
            FROM invoice_items ii
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            JOIN invoices i ON ii.invoice_id = i.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE i.created_at >= p_start_date AND i.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
            UNION ALL
            SELECT 
                COALESCE(c.name, 'Uncategorized') AS c_name, -r.quantity AS qty,
                -r.total_refund_amount AS rev, -(r.quantity * (ii.selling_price_snapshot - ii.cost_price_snapshot)) AS prof
            FROM returns r
            JOIN invoice_items ii ON r.invoice_item_id = ii.id
            JOIN variants v ON ii.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            JOIN invoices i ON r.invoice_id = i.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE r.created_at >= p_start_date AND r.created_at <= p_end_date
              AND i.is_voided = FALSE AND i.is_hidden = FALSE
        ) combined
        GROUP BY c_name
    ) tc;

    -- Tab 10: High 6 Fix - Stock Cost Valuation (Warehouse + Van Fleet Inventory)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'product_id', p.id, 'variant_id', v.id, 'product_name', p.name, 'variant_name', v.name,
            'barcode', v.barcode, 
            'stock_quantity', (v.stock_quantity + COALESCE(lvi.van_qty, 0)), 
            'cost_price', v.cost_price,
            'total_cost', ((v.stock_quantity + COALESCE(lvi.van_qty, 0)) * v.cost_price)
        ) ORDER BY ((v.stock_quantity + COALESCE(lvi.van_qty, 0)) * v.cost_price) DESC
    ), '[]'::jsonb)
    INTO v_stock_cost
    FROM variants v
    JOIN products p ON v.product_id = p.id
    LEFT JOIN (
        SELECT variant_id, SUM(quantity) AS van_qty
        FROM line_van_inventory
        GROUP BY variant_id
    ) lvi ON lvi.variant_id = v.id
    WHERE v.is_active = TRUE AND p.is_active = TRUE;

    -- Tab 11: Stock Movements in Period
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', sub.id, 'created_at', sub.created_at, 'product_name', sub.p_name, 'variant_name', sub.v_name,
            'type', sub.type, 'quantity_change', sub.quantity_change, 'notes', sub.notes
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

    -- Tab 12: High 6 Fix - Stock By Category (Warehouse + Van Fleet Inventory)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'category_id', sbc.category_id, 'category_name', sbc.category_name, 'total_pieces', sbc.tot_pieces, 'total_valuation', sbc.tot_val
        ) ORDER BY sbc.tot_val DESC
    ), '[]'::jsonb)
    INTO v_stock_by_category
    FROM (
        SELECT 
            COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::UUID) AS category_id,
            COALESCE(c.name, 'Uncategorized') AS category_name,
            COALESCE(SUM(v.stock_quantity + COALESCE(lvi.van_qty, 0)), 0) AS tot_pieces,
            COALESCE(SUM((v.stock_quantity + COALESCE(lvi.van_qty, 0)) * v.cost_price), 0.00) AS tot_val
        FROM variants v
        JOIN products p ON v.product_id = p.id
        LEFT JOIN (
            SELECT variant_id, SUM(quantity) AS van_qty
            FROM line_van_inventory
            GROUP BY variant_id
        ) lvi ON lvi.variant_id = v.id
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
            'store_credit_percent', CASE WHEN (v_total_collected + v_store_credit_collected) > 0 THEN ROUND((v_store_credit_collected / (v_total_collected + v_store_credit_collected)) * 100, 1) ELSE 0.0 END,
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

GRANT EXECUTE ON FUNCTION public.get_comprehensive_reports(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
