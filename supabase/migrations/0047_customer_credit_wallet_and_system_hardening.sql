-- Migration: 0047_customer_credit_wallet_and_system_hardening.sql
-- Implements Customer Store Credit Wallet, Incremental Return Credit Engine, Void Wallet Restoration, and System Hardening.

-- 1. Add STORE_CREDIT to payment_method enum if not exists
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'STORE_CREDIT';

-- 2. Add credit_balance to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00;
CREATE INDEX IF NOT EXISTS idx_customers_credit_balance ON customers(credit_balance);

-- 3. Create customer_credit_ledger table
DO $$ BEGIN
    CREATE TYPE credit_movement_type AS ENUM ('RETURN_CREDIT', 'PAYMENT_APPLIED', 'MANUAL_ADJUST');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS customer_credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    type credit_movement_type NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    balance_after DECIMAL(10,2) NOT NULL,
    reference_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_customer ON customer_credit_ledger(customer_id, created_at DESC);

-- Enable RLS on customer_credit_ledger
ALTER TABLE customer_credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users full access to customer_credit_ledger" ON customer_credit_ledger;
CREATE POLICY "Authenticated users full access to customer_credit_ledger" ON customer_credit_ledger FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Hardened process_return with Incremental Excess Credit & Payment Ledger Payouts
CREATE OR REPLACE FUNCTION process_return(
    p_invoice_item_id UUID,
    p_sets_quantity INTEGER,
    p_loose_quantity INTEGER,
    p_refund_method payment_method,
    p_return_type TEXT,
    p_notes TEXT DEFAULT NULL
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
    v_product RECORD;
    v_past_returned_sets INTEGER := 0;
    v_past_returned_total INTEGER := 0;
    v_total_pieces_to_return INTEGER;
    v_remaining_returnable_pieces INTEGER;
    v_remaining_returnable_sets INTEGER;
    
    v_invoice_past_refunds DECIMAL(10,2) := 0;
    v_item_past_refunds DECIMAL(10,2) := 0;
    v_item_max_refundable DECIMAL(10,2) := 0;
    v_invoice_remaining_refundable DECIMAL(10,2) := 0;
    
    v_invoice_effective_ratio DECIMAL := 0;
    v_total_refund DECIMAL(10,2) := 0;
    v_prorated_unit_price DECIMAL(10,2) := 0;
    v_return_id UUID;
    v_movement_type stock_movement_type;
    
    v_old_effective_total DECIMAL(10,2) := 0;
    v_new_effective_total DECIMAL(10,2) := 0;
    v_net_paid DECIMAL(10,2) := 0;
    v_incremental_excess DECIMAL(10,2) := 0;
    v_new_credit_balance DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_sets_quantity < 0 OR p_loose_quantity < 0 THEN RAISE EXCEPTION 'Return quantities cannot be negative.'; END IF;
    IF p_return_type NOT IN ('RESTOCK', 'DAMAGED') THEN RAISE EXCEPTION 'Invalid return type. Must be RESTOCK or DAMAGED.'; END IF;

    SELECT * INTO v_item FROM invoice_items WHERE id = p_invoice_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice line item not found.'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = v_item.invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Associated invoice not found.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Cannot process return: The invoice has been completely voided.'; END IF;

    SELECT * INTO v_variant FROM variants WHERE id = v_item.variant_id FOR UPDATE;
    SELECT * INTO v_product FROM products WHERE id = v_variant.product_id;

    v_total_pieces_to_return := (p_sets_quantity * COALESCE(v_product.pieces_per_set, 1)) + p_loose_quantity;
    IF v_total_pieces_to_return <= 0 THEN RAISE EXCEPTION 'Total return pieces must be greater than zero.'; END IF;

    SELECT 
        COALESCE(SUM(quantity), 0),
        COALESCE(SUM(sets_quantity), 0),
        COALESCE(SUM(total_refund_amount), 0)
    INTO v_past_returned_total, v_past_returned_sets, v_item_past_refunds
    FROM returns
    WHERE invoice_item_id = p_invoice_item_id;

    v_remaining_returnable_pieces := v_item.quantity - v_past_returned_total;
    IF v_total_pieces_to_return > v_remaining_returnable_pieces THEN
        RAISE EXCEPTION 'Over-return blocked! Line qty: %, Already returned: %, Requested: %', 
            v_item.quantity, v_past_returned_total, v_total_pieces_to_return;
    END IF;

    v_remaining_returnable_sets := v_item.sets_quantity - v_past_returned_sets;
    IF p_sets_quantity > v_remaining_returnable_sets THEN
        RAISE EXCEPTION 'Cannot return % packaged set(s). Only % packaged set(s) were originally purchased on this line item.',
            p_sets_quantity, v_remaining_returnable_sets;
    END IF;

    -- Proration calculation
    IF v_invoice.subtotal > 0 AND v_invoice.final_total > 0 THEN
        v_invoice_effective_ratio := v_invoice.final_total / v_invoice.subtotal;
    ELSE
        v_invoice_effective_ratio := 0.0;
    END IF;

    v_total_refund := ROUND(v_item.selling_price_snapshot * v_total_pieces_to_return * v_invoice_effective_ratio, 2);
    v_item_max_refundable := ROUND(v_item.selling_price_snapshot * v_item.quantity * v_invoice_effective_ratio, 2);
    IF (v_item_past_refunds + v_total_refund) > v_item_max_refundable THEN
        v_total_refund := GREATEST(0.00, v_item_max_refundable - v_item_past_refunds);
    END IF;

    SELECT COALESCE(SUM(total_refund_amount), 0) INTO v_invoice_past_refunds
    FROM returns WHERE invoice_id = v_invoice.id;

    v_invoice_remaining_refundable := GREATEST(0.00, v_invoice.final_total - v_invoice_past_refunds);
    IF v_total_refund > v_invoice_remaining_refundable THEN
        v_total_refund := v_invoice_remaining_refundable;
    END IF;

    IF v_total_pieces_to_return > 0 THEN
        v_prorated_unit_price := ROUND(v_total_refund / v_total_pieces_to_return, 2);
    ELSE
        v_prorated_unit_price := 0.00;
    END IF;

    -- Insert Return Record
    INSERT INTO returns (
        invoice_id, invoice_item_id, variant_id, customer_id, 
        quantity, sets_quantity, loose_quantity,
        unit_refund_price, total_refund_amount, 
        refund_method, return_type, notes, processed_by
    ) VALUES (
        v_invoice.id, v_item.id, v_variant.id, v_invoice.customer_id,
        v_total_pieces_to_return, p_sets_quantity, p_loose_quantity,
        v_prorated_unit_price, v_total_refund,
        p_refund_method, p_return_type, p_notes, v_user_id
    ) RETURNING id INTO v_return_id;

    -- Incremental Excess Payment Calculation (Mathematically Immune to Multi-Return Leaks)
    v_old_effective_total := GREATEST(0.00, v_invoice.final_total - v_invoice_past_refunds);
    v_new_effective_total := GREATEST(0.00, v_invoice.final_total - (v_invoice_past_refunds + v_total_refund));
    
    SELECT COALESCE(SUM(amount), 0) INTO v_net_paid 
    FROM payments WHERE invoice_id = v_invoice.id;

    v_incremental_excess := GREATEST(0.00, LEAST(v_net_paid, v_old_effective_total) - v_new_effective_total);

    -- Route excess based on refund_method
    IF p_refund_method = 'STORE_CREDIT' THEN
        IF v_incremental_excess > 0 THEN
            IF v_invoice.customer_id IS NULL THEN
                RAISE EXCEPTION 'Customer account is required to issue store credit.';
            END IF;

            UPDATE customers 
            SET credit_balance = credit_balance + v_incremental_excess,
                updated_at = NOW()
            WHERE id = v_invoice.customer_id
            RETURNING credit_balance INTO v_new_credit_balance;

            INSERT INTO customer_credit_ledger (
                customer_id, type, amount, balance_after, reference_invoice_id, notes
            ) VALUES (
                v_invoice.customer_id,
                'RETURN_CREDIT',
                v_incremental_excess,
                v_new_credit_balance,
                v_invoice.id,
                'Store credit from return on Invoice ' || v_invoice.invoice_number
            );

            -- Record negative STORE_CREDIT payment row to balance invoice ledger
            INSERT INTO payments (invoice_id, customer_id, amount, method)
            VALUES (v_invoice.id, v_invoice.customer_id, -v_incremental_excess, 'STORE_CREDIT');
        END IF;
    ELSIF p_refund_method IN ('CASH', 'UPI') THEN
        IF v_incremental_excess > 0 THEN
            INSERT INTO payments (invoice_id, customer_id, amount, method)
            VALUES (v_invoice.id, v_invoice.customer_id, -v_incremental_excess, p_refund_method);
        END IF;
    END IF;

    -- Stock Mutation
    IF p_return_type = 'RESTOCK' THEN
        UPDATE variants 
        SET stock_quantity = stock_quantity + v_total_pieces_to_return,
            stock_sets = stock_sets + p_sets_quantity,
            updated_at = NOW()
        WHERE id = v_variant.id;
        
        v_movement_type := 'RETURN_RESTOCK';
        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
        VALUES (v_item.id, v_variant.id, v_movement_type, v_total_pieces_to_return, 'Return ID: ' || v_return_id || ' Invoice: ' || v_invoice.invoice_number);
    ELSE
        v_movement_type := 'RETURN_DAMAGE';
        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
        VALUES (v_item.id, v_variant.id, v_movement_type, 0, 'Return ID: ' || v_return_id || ' Invoice: ' || v_invoice.invoice_number || ' (DAMAGED SCRAP)');
    END IF;

    RETURN jsonb_build_object(
        'success', true, 
        'return_id', v_return_id,
        'refund_amount', v_total_refund,
        'cash_refunded', v_incremental_excess,
        'excess_refunded', v_incremental_excess,
        'unit_refund_price', v_prorated_unit_price,
        'pieces_returned', v_total_pieces_to_return,
        'sets_returned', p_sets_quantity,
        'invoice_remaining_due', GREATEST(0.00, v_new_effective_total - v_net_paid)
    );
END;
$$;

-- 5. Hardened pay_invoice supporting STORE_CREDIT
CREATE OR REPLACE FUNCTION pay_invoice(
    p_invoice_id UUID,
    p_customer_id UUID,
    p_amount DECIMAL(10,2),
    p_method payment_method
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_total_paid DECIMAL(10,2) := 0;
    v_total_refunds DECIMAL(10,2) := 0;
    v_effective_total DECIMAL(10,2) := 0;
    v_net_due DECIMAL(10,2) := 0;
    v_customer_credit DECIMAL(10,2) := 0;
    v_new_credit_balance DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero.'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Cannot record payment for a voided invoice.'; END IF;

    IF v_invoice.customer_id IS DISTINCT FROM p_customer_id THEN
        RAISE EXCEPTION 'Invoice does not belong to this customer.';
    END IF;

    SELECT COALESCE(SUM(total_refund_amount), 0) INTO v_total_refunds
    FROM returns WHERE invoice_id = p_invoice_id;

    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM payments WHERE invoice_id = p_invoice_id;

    v_effective_total := GREATEST(0.00, v_invoice.final_total - v_total_refunds);
    v_net_due := GREATEST(0.00, v_effective_total - v_total_paid);

    IF p_amount > v_net_due THEN
        RAISE EXCEPTION 'Payment amount (%) exceeds remaining net due on invoice (%).', p_amount, v_net_due;
    END IF;

    -- Fetch current customer credit balance
    SELECT credit_balance INTO v_customer_credit 
    FROM customers WHERE id = p_customer_id FOR UPDATE;
    v_new_credit_balance := v_customer_credit;

    -- Handle Store Credit deduction
    IF p_method = 'STORE_CREDIT' THEN
        IF v_customer_credit < p_amount THEN
            RAISE EXCEPTION 'Insufficient store credit balance. Available: %, Requested: %', v_customer_credit, p_amount;
        END IF;

        UPDATE customers 
        SET credit_balance = credit_balance - p_amount,
            updated_at = NOW()
        WHERE id = p_customer_id
        RETURNING credit_balance INTO v_new_credit_balance;

        INSERT INTO customer_credit_ledger (
            customer_id, type, amount, balance_after, reference_invoice_id, notes
        ) VALUES (
            p_customer_id,
            'PAYMENT_APPLIED',
            -p_amount,
            v_new_credit_balance,
            p_invoice_id,
            'Applied store credit to Invoice ' || v_invoice.invoice_number
        );
    END IF;

    INSERT INTO payments (invoice_id, customer_id, amount, method)
    VALUES (p_invoice_id, p_customer_id, p_amount, p_method);

    RETURN jsonb_build_object(
        'success', true, 
        'invoice_id', p_invoice_id, 
        'amount_paid', p_amount,
        'remaining_due', GREATEST(0.00, v_net_due - p_amount),
        'customer_credit_balance', v_new_credit_balance
    );
END;
$$;

-- 6. Hardened process_checkout matching 0033 Signature & Catalog Anti-Tampering
CREATE OR REPLACE FUNCTION process_checkout(
    p_customer_id UUID,
    p_subtotal DECIMAL(10,2),
    p_discount_amount DECIMAL(10,2),
    p_round_off DECIMAL(10,2),
    p_gst_applied BOOLEAN,
    p_cgst_amount DECIMAL(10,2),
    p_sgst_amount DECIMAL(10,2),
    p_final_total DECIMAL(10,2),
    p_items JSONB,
    p_payments JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_item RECORD;
    v_payment RECORD;
    v_variant RECORD;
    v_total_paid DECIMAL(10,2) := 0;
    v_total_pieces INTEGER;
    v_line_subtotal DECIMAL(10,2);
    v_line_cogs DECIMAL(10,2);
    v_line_profit DECIMAL(10,2);
    v_calculated_subtotal DECIMAL(10,2) := 0;
    v_expected_cgst DECIMAL(10,2) := 0;
    v_expected_sgst DECIMAL(10,2) := 0;
    v_expected_final_total DECIMAL(10,2) := 0;
    v_customer_credit DECIMAL(10,2) := 0;
    v_new_credit_balance DECIMAL(10,2) := 0;
    v_item_id UUID;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    done BOOLEAN := FALSE;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart cannot be empty.'; END IF;
    IF p_subtotal < 0 OR p_discount_amount < 0 OR p_final_total < 0 THEN
        RAISE EXCEPTION 'Financial values cannot be negative.';
    END IF;

    -- Prevent duplicate variants in single checkout
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in checkout items. Please consolidate cart quantities.';
    END IF;

    -- Validate Customer requirement for Store Credit and Credit Tabs
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                IF v_payment.method = 'STORE_CREDIT' AND p_customer_id IS NULL THEN
                    RAISE EXCEPTION 'Customer is required when paying with store credit.';
                END IF;
                v_total_paid := v_total_paid + v_payment.amount;
            END IF;
        END LOOP;
    END IF;

    -- Block Uncollected Balance for Anonymous Walk-in Customers
    IF p_customer_id IS NULL AND v_total_paid < p_final_total THEN
        RAISE EXCEPTION 'Customer is required for credit/partial credit sales.';
    END IF;

    -- Lock variants in deterministic order to prevent race conditions & deadlocks
    PERFORM 1 FROM variants v
    WHERE v.id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x)
    ORDER BY v.id FOR UPDATE OF v;

    -- Validate Prices and Stock Availability Against Authoritative Database Records
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER, selling_price DECIMAL
    )
    LOOP
        IF v_item.sets_quantity < 0 OR v_item.loose_quantity < 0 THEN
            RAISE EXCEPTION 'Quantities cannot be negative.';
        END IF;

        SELECT v.*, p.pieces_per_set INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id 
        WHERE v.id = v_item.variant_id AND v.is_active = TRUE AND p.is_active = TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product variant is inactive or no longer exists.';
        END IF;

        -- Anti-Tampering: Verify Client Selling Price Matches Catalog
        IF v_item.selling_price <> v_variant.selling_price THEN
            RAISE EXCEPTION 'Price tampering detected for variant %: catalog price %, sent %',
                v_variant.name, v_variant.selling_price, v_item.selling_price;
        END IF;

        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * COALESCE(v_variant.pieces_per_set, 1)) + COALESCE(v_item.loose_quantity, 0);
        IF v_total_pieces <= 0 THEN
            RAISE EXCEPTION 'Total pieces for variant % must be greater than zero.', v_variant.name;
        END IF;

        -- Stock Availability Validation
        IF v_variant.stock_quantity < v_total_pieces THEN
            RAISE EXCEPTION 'Insufficient stock for variant %. Available: %, Requested: %',
                v_variant.name, v_variant.stock_quantity, v_total_pieces;
        END IF;

        IF v_variant.stock_sets < COALESCE(v_item.sets_quantity, 0) THEN
            RAISE EXCEPTION 'Insufficient packaged sets for variant %. Available: %, Requested: %',
                v_variant.name, v_variant.stock_sets, v_item.sets_quantity;
        END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_total_pieces * v_variant.selling_price);
    END LOOP;

    v_calculated_subtotal := ROUND(v_calculated_subtotal, 2);

    -- Authoritative Tax & Final Total Verification
    IF p_gst_applied THEN
        v_expected_cgst := ROUND(GREATEST(0, v_calculated_subtotal - p_discount_amount) * 0.025, 2);
        v_expected_sgst := ROUND(GREATEST(0, v_calculated_subtotal - p_discount_amount) * 0.025, 2);
    END IF;

    v_expected_final_total := ROUND(v_calculated_subtotal - p_discount_amount + p_round_off + (v_expected_cgst + v_expected_sgst), 2);
    IF ABS(p_final_total - v_expected_final_total) > 0.05 THEN
        RAISE EXCEPTION 'Invoice total mismatch: calculated %, received %', v_expected_final_total, p_final_total;
    END IF;

    -- Generate Unique Invoice Number (Collision-Safe Loop)
    WHILE NOT done LOOP
        v_invoice_number := 'MELBUN/' || to_char(NOW(), 'YYYY') || '/' || upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6));
        IF NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = v_invoice_number) THEN 
            done := TRUE; 
        END IF;
    END LOOP;

    INSERT INTO invoices (
        invoice_number, customer_id, subtotal, discount_amount, round_off,
        gst_applied, cgst_amount, sgst_amount, final_total
    ) VALUES (
        v_invoice_number, p_customer_id, v_calculated_subtotal, p_discount_amount, p_round_off,
        p_gst_applied, v_expected_cgst, v_expected_sgst, p_final_total
    ) RETURNING id INTO v_invoice_id;

    -- Deduct Stock and Insert Line Items
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER, selling_price DECIMAL
    )
    LOOP
        SELECT v.*, p.pieces_per_set INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id 
        WHERE v.id = v_item.variant_id;

        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * COALESCE(v_variant.pieces_per_set, 1)) + COALESCE(v_item.loose_quantity, 0);
        v_line_subtotal := ROUND(v_total_pieces * v_variant.selling_price, 2);
        v_line_cogs := ROUND(v_total_pieces * v_variant.cost_price, 2);
        v_line_profit := v_line_subtotal - v_line_cogs;

        INSERT INTO invoice_items (
            invoice_id, variant_id, quantity, sets_quantity, loose_quantity,
            selling_price_snapshot, cost_price_snapshot, profit_snapshot
        ) VALUES (
            v_invoice_id, v_item.variant_id, v_total_pieces, v_item.sets_quantity, v_item.loose_quantity,
            v_variant.selling_price, v_variant.cost_price, v_line_profit
        ) RETURNING id INTO v_item_id;

        UPDATE variants 
        SET stock_quantity = stock_quantity - v_total_pieces,
            stock_sets = GREATEST(0, stock_sets - COALESCE(v_item.sets_quantity, 0)),
            updated_at = NOW()
        WHERE id = v_item.variant_id;

        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
        VALUES (v_item_id, v_item.variant_id, 'SALE', -v_total_pieces, 'Sale: ' || v_invoice_number);
    END LOOP;

    -- Process Payments and Handle Store Credit Deductions
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                IF v_payment.method = 'STORE_CREDIT' THEN
                    SELECT credit_balance INTO v_customer_credit 
                    FROM customers WHERE id = p_customer_id FOR UPDATE;

                    IF v_customer_credit < v_payment.amount THEN
                        RAISE EXCEPTION 'Insufficient store credit balance. Available: %, Requested: %', v_customer_credit, v_payment.amount;
                    END IF;

                    UPDATE customers 
                    SET credit_balance = credit_balance - v_payment.amount,
                        updated_at = NOW()
                    WHERE id = p_customer_id
                    RETURNING credit_balance INTO v_new_credit_balance;

                    INSERT INTO customer_credit_ledger (
                        customer_id, type, amount, balance_after, reference_invoice_id, notes
                    ) VALUES (
                        p_customer_id,
                        'PAYMENT_APPLIED',
                        -v_payment.amount,
                        v_new_credit_balance,
                        v_invoice_id,
                        'Applied store credit to Invoice ' || v_invoice_number
                    );
                END IF;

                INSERT INTO payments (invoice_id, customer_id, amount, method)
                VALUES (v_invoice_id, p_customer_id, v_payment.amount, v_payment.method);
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number);
END;
$$;

-- 7. Hardened void_invoice with Strict Ratio Calculation and Net Store Credit Restoration
CREATE OR REPLACE FUNCTION void_invoice(
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
    v_restored_pieces INTEGER;
    v_returned_pieces INTEGER;
    v_restored_sets INTEGER;
    v_returned_sets INTEGER;
    v_pieces_per_set INTEGER;
    v_net_store_credit_paid DECIMAL(10,2) := 0;
    v_restored_balance DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Invoice is already voided.'; END IF;

    -- Mark invoice voided
    UPDATE invoices 
    SET is_voided = TRUE, updated_at = NOW() 
    WHERE id = p_invoice_id;

    -- Restore Stock with dual-inventory ratio guard
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id FOR UPDATE LOOP
        SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(sets_quantity), 0)
        INTO v_returned_pieces, v_returned_sets
        FROM returns WHERE invoice_item_id = v_item.id;

        SELECT v.*, p.pieces_per_set INTO v_variant
        FROM variants v JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;

        v_pieces_per_set := COALESCE(v_variant.pieces_per_set, 1);
        v_restored_pieces := GREATEST(0, v_item.quantity - v_returned_pieces);

        v_restored_sets := LEAST(
            COALESCE(v_item.sets_quantity, 0),
            FLOOR(v_restored_pieces / GREATEST(COALESCE(v_pieces_per_set, 1), 1))
        );

        IF v_restored_pieces > 0 THEN
            UPDATE variants 
            SET stock_quantity = stock_quantity + v_restored_pieces,
                stock_sets = stock_sets + v_restored_sets,
                updated_at = NOW()
            WHERE id = v_item.variant_id;

            INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
            VALUES (
                v_item.id, v_item.variant_id, 'VOID_RESTOCK', v_restored_pieces,
                'Invoice Voided: ' || v_invoice.invoice_number || COALESCE(' (' || p_reason || ')', '')
            );
        END IF;
    END LOOP;

    -- Restore net unrefunded Store Credit to customer wallet
    SELECT COALESCE(SUM(amount), 0) INTO v_net_store_credit_paid
    FROM payments WHERE invoice_id = p_invoice_id AND method = 'STORE_CREDIT';

    IF v_net_store_credit_paid > 0 AND v_invoice.customer_id IS NOT NULL THEN
        UPDATE customers 
        SET credit_balance = credit_balance + v_net_store_credit_paid,
            updated_at = NOW()
        WHERE id = v_invoice.customer_id
        RETURNING credit_balance INTO v_restored_balance;

        INSERT INTO customer_credit_ledger (
            customer_id, type, amount, balance_after, reference_invoice_id, notes
        ) VALUES (
            v_invoice.customer_id,
            'MANUAL_ADJUST',
            v_net_store_credit_paid,
            v_restored_balance,
            p_invoice_id,
            'Reversed store credit from voided Invoice ' || v_invoice.invoice_number
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$$;

-- 8. Explicit Grants
GRANT EXECUTE ON FUNCTION process_return(UUID, INTEGER, INTEGER, payment_method, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pay_invoice(UUID, UUID, DECIMAL, payment_method) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION void_invoice(UUID, TEXT) TO authenticated, service_role;
GRANT ALL ON customer_credit_ledger TO authenticated, service_role;
