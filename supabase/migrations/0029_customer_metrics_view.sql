-- Migration: 0029_customer_metrics_view.sql (Auditor Hardened V2)

-- 1. Schema Extensions on Customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(10,2) CHECK (credit_limit IS NULL OR credit_limit >= 0);

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_customers_is_active ON customers(is_active);
CREATE INDEX IF NOT EXISTS idx_returns_customer_id ON returns(customer_id);

-- 3. Customer Metrics View (Full Return & Void Protection)
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
    ((COALESCE(i.gross_spend, 0) - COALESCE(r.total_returned, 0)) - COALESCE(p.total_paid, 0)) AS pending_dues
FROM customers c
LEFT JOIN invoice_totals i ON c.id = i.customer_id
LEFT JOIN return_totals r ON c.id = r.customer_id
LEFT JOIN payment_totals p ON c.id = p.customer_id;

-- 4. Customer Deactivation & Reactivation RPCs
CREATE OR REPLACE FUNCTION deactivate_customer(p_customer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Customer ID is required'; END IF;

    UPDATE customers 
    SET is_active = FALSE, 
        updated_at = NOW() 
    WHERE id = p_customer_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found';
    END IF;

    RETURN jsonb_build_object('success', true, 'customer_id', p_customer_id, 'is_active', false);
END;
$$;

CREATE OR REPLACE FUNCTION reactivate_customer(p_customer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Customer ID is required'; END IF;

    UPDATE customers 
    SET is_active = TRUE, 
        updated_at = NOW() 
    WHERE id = p_customer_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found';
    END IF;

    RETURN jsonb_build_object('success', true, 'customer_id', p_customer_id, 'is_active', true);
END;
$$;

-- 5. Explicit Permissions & Grants
GRANT SELECT ON customer_metrics TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION deactivate_customer(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reactivate_customer(UUID) TO authenticated, service_role;
