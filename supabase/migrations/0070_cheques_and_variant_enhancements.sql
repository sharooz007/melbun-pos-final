-- Migration: 0070_cheques_and_variant_enhancements.sql
-- 1. Extend payment_method enum with CHEQUE and BANK
-- 2. Add notes column to payments table for audit traceability
-- 3. Create customer_cheques table & clear_customer_cheque RPC (with ledger and wallet routing)
-- 4. Add pieces_per_set to variants table with product-level fallback backfill
-- 5. Add variant_templates JSONB to store_settings
-- 6. Create update_variant_cost_and_recalculate_profits RPC for retroactive profit cascade

-- 1. Enums
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'CHEQUE';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'BANK';

-- 2. Add notes to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes TEXT;

-- 3. Customer Cheques Table
CREATE TABLE IF NOT EXISTS customer_cheques (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    cheque_number TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    cheque_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CLEARED')),
    clearance_date TIMESTAMPTZ,
    clearance_method TEXT CHECK (clearance_method IS NULL OR clearance_method IN ('BANK', 'CASH')),
    clearance_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_cheques_customer ON customer_cheques(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_cheques_invoice ON customer_cheques(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_cheques_status ON customer_cheques(status);

ALTER TABLE customer_cheques ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users full access to customer_cheques" ON customer_cheques;
CREATE POLICY "Authenticated users full access to customer_cheques" 
ON customer_cheques FOR ALL TO authenticated 
USING (TRUE) WITH CHECK (TRUE);

GRANT ALL ON customer_cheques TO authenticated, service_role;

-- 4. Clear Customer Cheque RPC
CREATE OR REPLACE FUNCTION clear_customer_cheque(
    p_cheque_id UUID,
    p_clearance_method TEXT,
    p_clearance_date TIMESTAMPTZ DEFAULT NOW(),
    p_clearance_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_cheque RECORD;
    v_invoice RECORD;
    v_total_refunds DECIMAL(10,2) := 0;
    v_total_paid DECIMAL(10,2) := 0;
    v_effective_total DECIMAL(10,2) := 0;
    v_net_due DECIMAL(10,2) := 0;
    v_new_credit_balance DECIMAL(10,2) := 0;
    v_clear_date TIMESTAMPTZ := COALESCE(p_clearance_date, NOW());
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_cheque_id IS NULL THEN RAISE EXCEPTION 'Cheque ID is required.'; END IF;
    IF p_clearance_method NOT IN ('BANK', 'CASH') THEN
        RAISE EXCEPTION 'Clearance method must be either BANK or CASH.';
    END IF;

    -- 1. Lock Cheque
    SELECT * INTO v_cheque FROM customer_cheques WHERE id = p_cheque_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cheque record not found.'; END IF;
    IF v_cheque.status = 'CLEARED' THEN RAISE EXCEPTION 'Cheque is already cleared.'; END IF;

    -- 2. Update Cheque Status
    UPDATE customer_cheques
    SET status = 'CLEARED',
        clearance_date = v_clear_date,
        clearance_method = p_clearance_method,
        clearance_notes = p_clearance_notes,
        updated_at = NOW()
    WHERE id = p_cheque_id;

    -- 3. If tied to an invoice, validate balance and record invoice payment
    IF v_cheque.invoice_id IS NOT NULL THEN
        SELECT * INTO v_invoice FROM invoices WHERE id = v_cheque.invoice_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Linked invoice record not found.'; END IF;
        IF v_invoice.is_voided THEN RAISE EXCEPTION 'Cannot clear cheque against a voided invoice.'; END IF;
        IF v_invoice.is_hidden THEN RAISE EXCEPTION 'Cannot clear cheque against a deleted invoice.'; END IF;

        -- Calculate live due amount
        SELECT COALESCE(SUM(total_refund_amount), 0) INTO v_total_refunds
        FROM returns WHERE invoice_id = v_cheque.invoice_id;

        SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
        FROM payments WHERE invoice_id = v_cheque.invoice_id;

        v_effective_total := GREATEST(0.00, v_invoice.final_total - v_total_refunds);
        v_net_due := GREATEST(0.00, v_effective_total - v_total_paid);

        IF v_cheque.amount > v_net_due THEN
            RAISE EXCEPTION 'Cheque amount (₹%) exceeds remaining net due (₹%) on invoice %.',
                v_cheque.amount, v_net_due, v_invoice.invoice_number;
        END IF;

        -- Insert into payments table
        INSERT INTO payments (
            invoice_id,
            customer_id,
            amount,
            method,
            notes,
            created_at
        ) VALUES (
            v_cheque.invoice_id,
            v_cheque.customer_id,
            v_cheque.amount,
            p_clearance_method,
            'Cheque #' || v_cheque.cheque_number || ' (' || v_cheque.bank_name || ') Cleared via ' || p_clearance_method,
            v_clear_date
        );

        UPDATE invoices SET updated_at = NOW() WHERE id = v_cheque.invoice_id;
    ELSE
        -- 4. Unlinked Cheque (On-account deposit): Deposit directly to Customer Credit Wallet
        UPDATE customers
        SET credit_balance = credit_balance + v_cheque.amount,
            updated_at = NOW()
        WHERE id = v_cheque.customer_id
        RETURNING credit_balance INTO v_new_credit_balance;

        INSERT INTO customer_credit_ledger (
            customer_id,
            type,
            amount,
            balance_after,
            reference_invoice_id,
            notes,
            created_at
        ) VALUES (
            v_cheque.customer_id,
            'MANUAL_ADJUST'::credit_movement_type,
            v_cheque.amount,
            v_new_credit_balance,
            NULL,
            'Cheque #' || v_cheque.cheque_number || ' (' || v_cheque.bank_name || ') Cleared to Customer Credit via ' || p_clearance_method,
            v_clear_date
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'cheque_id', p_cheque_id,
        'status', 'CLEARED',
        'clearance_method', p_clearance_method,
        'clearance_date', v_clear_date,
        'customer_credit_balance', v_new_credit_balance
    );
END;
$$;

GRANT EXECUTE ON FUNCTION clear_customer_cheque(UUID, TEXT, TIMESTAMPTZ, TEXT) TO authenticated, service_role;

-- 5. Variant-Level Pack Size (pieces_per_set)
ALTER TABLE variants ADD COLUMN IF NOT EXISTS pieces_per_set INTEGER NOT NULL DEFAULT 1 CHECK (pieces_per_set >= 1);

UPDATE variants v
SET pieces_per_set = COALESCE(p.pieces_per_set, 1)
FROM products p
WHERE v.product_id = p.id AND v.pieces_per_set = 1 AND p.pieces_per_set > 1;

-- 6. Variant Templates in store_settings
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS variant_templates JSONB DEFAULT '[]'::jsonb;

-- 7. Retroactive Variant Cost Update & Profit Recalculation RPC
CREATE OR REPLACE FUNCTION update_variant_cost_and_recalculate_profits(
    p_variant_id UUID,
    p_new_cost_price DECIMAL(10,2)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_variant RECORD;
    v_updated_items_count INTEGER := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_variant_id IS NULL THEN RAISE EXCEPTION 'Variant ID is required.'; END IF;
    IF p_new_cost_price < 0 THEN RAISE EXCEPTION 'Cost price cannot be negative.'; END IF;

    -- Lock and update variant catalog cost
    SELECT * INTO v_variant FROM variants WHERE id = p_variant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found.'; END IF;

    UPDATE variants
    SET cost_price = p_new_cost_price,
        updated_at = NOW()
    WHERE id = p_variant_id;

    -- Retroactively update all invoice_items for this variant
    UPDATE invoice_items
    SET cost_price_snapshot = p_new_cost_price,
        profit_snapshot = ROUND((quantity * (selling_price_snapshot - p_new_cost_price)), 2)
    WHERE variant_id = p_variant_id;

    GET DIAGNOSTICS v_updated_items_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'variant_id', p_variant_id,
        'new_cost_price', p_new_cost_price,
        'updated_invoice_items_count', v_updated_items_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION update_variant_cost_and_recalculate_profits(UUID, DECIMAL) TO authenticated, service_role;
