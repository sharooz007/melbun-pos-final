-- Migration: 0048_critical_data_integrity_fixes.sql
-- 1. Hardened Product Soft-Delete with Stock Write-Off & Movement Ledger Recording
CREATE OR REPLACE FUNCTION soft_delete_product(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_updated_rows INTEGER;
    v_variant RECORD;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_product_id IS NULL THEN RAISE EXCEPTION 'Product ID is required'; END IF;

    UPDATE products 
    SET is_active = FALSE, updated_at = NOW() 
    WHERE id = p_product_id;
    
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows = 0 THEN
        RAISE EXCEPTION 'Product not found or already deleted';
    END IF;

    -- Write off stock and record movements for any active variants with non-zero stock
    FOR v_variant IN 
        SELECT id, stock_quantity, stock_sets 
        FROM variants 
        WHERE product_id = p_product_id AND is_active = TRUE
        FOR UPDATE
    LOOP
        IF v_variant.stock_quantity <> 0 THEN
            INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
            VALUES (
                v_variant.id, 
                'MANUAL_ADJUST'::stock_movement_type, 
                -v_variant.stock_quantity, 
                'Product deleted (Stock written off to zero)'
            );
        END IF;

        UPDATE variants 
        SET is_active = FALSE,
            stock_quantity = 0,
            stock_sets = 0,
            updated_at = NOW()
        WHERE id = v_variant.id;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'product_id', p_product_id);
END;
$$;

-- 2. Customer Metrics View Update (credit_balance appended to maintain column order compatibility)
CREATE OR REPLACE VIEW customer_metrics WITH (security_invoker = true) AS
WITH invoice_totals AS (
    -- Total visits and gross sales from non-voided invoices
    SELECT 
        customer_id,
        COUNT(id) AS total_visits,
        COALESCE(SUM(final_total), 0) AS gross_spend
    FROM invoices
    WHERE is_voided = FALSE AND customer_id IS NOT NULL
    GROUP BY customer_id
),
return_totals AS (
    -- Total refunds from non-voided invoices
    SELECT 
        r.customer_id,
        COALESCE(SUM(r.total_refund_amount), 0) AS total_returned
    FROM returns r
    JOIN invoices i ON r.invoice_id = i.id
    WHERE r.customer_id IS NOT NULL
      AND i.is_voided = FALSE
    GROUP BY r.customer_id
),
payment_totals AS (
    -- Total net payments excluding payments linked to voided invoices
    SELECT 
        p.customer_id,
        COALESCE(SUM(p.amount), 0) AS total_paid
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    WHERE p.customer_id IS NOT NULL
      AND (p.invoice_id IS NULL OR i.is_voided = FALSE)
    GROUP BY p.customer_id
)
SELECT 
    c.id,
    c.name,
    c.phone,
    c.gstin,
    c.address,
    c.credit_limit,
    c.is_active,
    c.created_at,
    c.updated_at,
    COALESCE(i.total_visits, 0) AS total_visits,
    -- Net spend correctly deducts returned goods
    (COALESCE(i.gross_spend, 0) - COALESCE(r.total_returned, 0)) AS total_spend,
    COALESCE(r.total_returned, 0) AS total_returned,
    COALESCE(p.total_paid, 0) AS total_paid,
    -- Unclamped pending dues (Positive = Dues, Negative = Store Credit / Advance)
    ((COALESCE(i.gross_spend, 0) - COALESCE(r.total_returned, 0)) - COALESCE(p.total_paid, 0)) AS pending_dues,
    c.credit_balance
FROM customers c
LEFT JOIN invoice_totals i ON c.id = i.customer_id
LEFT JOIN return_totals r ON c.id = r.customer_id
LEFT JOIN payment_totals p ON c.id = p.customer_id;

-- 3. Hardened Customer Deactivation Guard against active store credit
CREATE OR REPLACE FUNCTION deactivate_customer(p_customer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_credit DECIMAL(10,2) := 0;
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

    UPDATE customers 
    SET is_active = FALSE, 
        updated_at = NOW() 
    WHERE id = p_customer_id;

    RETURN jsonb_build_object('success', true, 'customer_id', p_customer_id, 'is_active', false);
END;
$$;

-- 4. Permissions
GRANT SELECT ON customer_metrics TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION soft_delete_product(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION deactivate_customer(UUID) TO authenticated, service_role;
