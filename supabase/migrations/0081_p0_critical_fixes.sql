-- Migration: 0081_p0_critical_fixes.sql
-- Hardens system against 10 critical P0 vulnerabilities including enum crashes, missing columns, inventory loss, and idempotency.

-- 1. Schema Extensions
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS sets_change INT DEFAULT 0;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS loose_change INT DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS line_staff_id UUID REFERENCES line_staff(id);

-- 2. Drop bill_line_staff_sales to change signature
DROP FUNCTION IF EXISTS bill_line_staff_sales(UUID, JSONB, JSONB, DECIMAL, DECIMAL, TEXT);

CREATE OR REPLACE FUNCTION bill_line_staff_sales(
    p_staff_id UUID,
    p_items JSONB,
    p_payments JSONB DEFAULT '[]'::jsonb,
    p_discount_amount DECIMAL DEFAULT 0.00,
    p_round_off DECIMAL DEFAULT 0.00,
    p_notes TEXT DEFAULT NULL,
    p_gst_applied BOOLEAN DEFAULT FALSE,
    p_cgst_amount DECIMAL DEFAULT 0.00,
    p_sgst_amount DECIMAL DEFAULT 0.00,
    p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_staff RECORD;
    v_customer RECORD;
    v_customer_id UUID := NULL;
    v_van_item RECORD;
    v_item RECORD;
    v_variant RECORD;
    v_payment RECORD;
    v_pps INTEGER;
    v_total_pieces INTEGER;
    v_subtotal DECIMAL(10,2) := 0;
    v_taxable_amount DECIMAL(10,2) := 0;
    v_cgst DECIMAL(10,2) := 0;
    v_sgst DECIMAL(10,2) := 0;
    v_final_total DECIMAL(10,2) := 0;
    v_total_paid DECIMAL(10,2) := 0;
    v_store_credit_paid DECIMAL(10,2) := 0;
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_item_id UUID;
    v_customer_name TEXT;
    v_line_profit DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_staff_id IS NULL THEN RAISE EXCEPTION 'Staff ID is required.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart is empty.'; END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, invoice_number INTO v_invoice_id, v_invoice_number FROM invoices WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number, 'already_processed', true);
        END IF;
    END IF;

    -- 1. Fetch line staff & customer linking
    SELECT * INTO v_staff FROM line_staff WHERE id = p_staff_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line staff not found.'; END IF;
    IF NOT v_staff.is_active THEN RAISE EXCEPTION 'Line staff is inactive.'; END IF;

    IF v_staff.customer_id IS NOT NULL THEN
        SELECT * INTO v_customer FROM customers WHERE id = v_staff.customer_id FOR UPDATE;
        IF FOUND THEN
            v_customer_id := v_customer.id;
        END IF;
    END IF;

    IF v_customer_id IS NULL THEN
        v_customer_name := v_staff.name || ' (Line Sales - ' || UPPER(SUBSTRING(v_staff.id::TEXT FROM 1 FOR 4)) || ')';
        INSERT INTO customers (name, phone, is_active)
        VALUES (v_customer_name, NULLIF(trim(v_staff.phone), ''), TRUE)
        RETURNING * INTO v_customer;
        v_customer_id := v_customer.id;
        UPDATE line_staff SET customer_id = v_customer_id WHERE id = p_staff_id;
    END IF;

    -- 2. Deterministic Lock on Van Inventory rows
    PERFORM 1 FROM line_van_inventory lvi
    WHERE lvi.staff_id = p_staff_id 
      AND lvi.variant_id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x)
    ORDER BY lvi.variant_id FOR UPDATE;

    -- 3. Calculate Subtotal & Deduct Van Inventory
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID,
        sets_quantity INTEGER,
        loose_quantity INTEGER,
        selling_price DECIMAL
    )
    LOOP
        IF COALESCE(v_item.sets_quantity, 0) < 0 OR COALESCE(v_item.loose_quantity, 0) < 0 THEN
            RAISE EXCEPTION 'Quantities cannot be negative.';
        END IF;

        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;
        
        IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found: %', v_item.variant_id; END IF;

        v_pps := COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1);
        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_pps) + COALESCE(v_item.loose_quantity, 0);

        IF v_total_pieces <= 0 THEN RAISE EXCEPTION 'Sold pieces must be greater than 0 for variant %', v_variant.name; END IF;

        SELECT * INTO v_van_item FROM line_van_inventory 
        WHERE staff_id = p_staff_id AND variant_id = v_item.variant_id;

        IF NOT FOUND OR v_van_item.quantity < v_total_pieces THEN
            RAISE EXCEPTION 'Insufficient van stock for %. Van holds: % pcs, Sold: % pcs',
                v_variant.name, COALESCE(v_van_item.quantity, 0), v_total_pieces;
        END IF;

        UPDATE line_van_inventory
        SET quantity = quantity - v_total_pieces,
            sets_quantity = GREATEST(0, sets_quantity - COALESCE(v_item.sets_quantity, 0)),
            updated_at = NOW()
        WHERE staff_id = p_staff_id AND variant_id = v_item.variant_id;

        INSERT INTO line_stock_movements (staff_id, variant_id, type, sets_quantity, quantity, notes)
        VALUES (p_staff_id, v_item.variant_id, 'SALE_DEDUCT', COALESCE(v_item.sets_quantity, 0), v_total_pieces, 'Line Sale Dispatch');

        v_subtotal := v_subtotal + ROUND(v_total_pieces * COALESCE(v_item.selling_price, v_variant.selling_price), 2);
    END LOOP;

    -- 4. Calculate Final Total (GST Aware)
    v_taxable_amount := GREATEST(0.00, v_subtotal - COALESCE(p_discount_amount, 0));
    IF p_gst_applied THEN
        v_cgst := COALESCE(NULLIF(p_cgst_amount, 0), ROUND(v_taxable_amount * 0.025, 2));
        v_sgst := COALESCE(NULLIF(p_sgst_amount, 0), ROUND(v_taxable_amount * 0.025, 2));
        v_final_total := ROUND(v_taxable_amount + v_cgst + v_sgst + COALESCE(p_round_off, 0), 2);
    ELSE
        v_cgst := 0; v_sgst := 0;
        v_final_total := ROUND(v_taxable_amount + COALESCE(p_round_off, 0), 2);
    END IF;

    -- Validate Payments & Store Credit Bounds
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                IF v_payment.method = 'STORE_CREDIT' THEN
                    v_store_credit_paid := v_store_credit_paid + v_payment.amount;
                END IF;
                v_total_paid := v_total_paid + v_payment.amount;
            END IF;
        END LOOP;
    END IF;

    IF v_total_paid > v_final_total THEN
        RAISE EXCEPTION 'Total payment (₹%) cannot exceed invoice final total (₹%).', v_total_paid, v_final_total;
    END IF;

    IF v_store_credit_paid > 0 THEN
        IF v_customer.credit_balance < v_store_credit_paid THEN
            RAISE EXCEPTION 'Insufficient store credit balance (Available: ₹%, Requested: ₹%).',
                v_customer.credit_balance, v_store_credit_paid;
        END IF;

        UPDATE customers 
        SET credit_balance = credit_balance - v_store_credit_paid,
            updated_at = NOW()
        WHERE id = v_customer_id
        RETURNING credit_balance INTO v_customer.credit_balance;

        INSERT INTO customer_credit_ledger (
            customer_id, type, amount, balance_after, notes
        ) VALUES (
            v_customer_id, 'PAYMENT_APPLIED'::credit_movement_type, -v_store_credit_paid, 
            v_customer.credit_balance, 'Line Sale Redemption'
        );
    END IF;

    -- 5. Create Invoice
    v_invoice_number := 'INV-LS-' || to_char(NOW(), 'YYMMDD') || '-' || LPAD(FLOOR(random() * 1000)::text, 3, '0');

    INSERT INTO invoices (
        invoice_number, customer_id, line_staff_id, subtotal, discount_amount, round_off,
        gst_applied, cgst_amount, sgst_amount, final_total, notes
    ) VALUES (
        v_invoice_number, v_customer_id, p_staff_id, v_subtotal, p_discount_amount, p_round_off,
        p_gst_applied, v_cgst, v_sgst, v_final_total, p_notes
    ) RETURNING id INTO v_invoice_id;

    -- 6. Insert Items & Payments
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER, selling_price DECIMAL)
    LOOP
        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;

        v_pps := COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1);
        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_pps) + COALESCE(v_item.loose_quantity, 0);
        v_line_profit := (COALESCE(v_item.selling_price, v_variant.selling_price) - COALESCE(v_variant.cost_price, 0)) * v_total_pieces;

        INSERT INTO invoice_items (
            invoice_id, variant_id, quantity, sets_quantity, loose_quantity,
            selling_price_snapshot, cost_price_snapshot, profit_snapshot
        ) VALUES (
            v_invoice_id, v_item.variant_id, v_total_pieces,
            COALESCE(v_item.sets_quantity, 0), COALESCE(v_item.loose_quantity, 0),
            COALESCE(v_item.selling_price, v_variant.selling_price), COALESCE(v_variant.cost_price, 0), v_line_profit
        );
    END LOOP;

    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                INSERT INTO payments (invoice_id, amount, payment_method)
                VALUES (v_invoice_id, v_payment.amount, v_payment.method);
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number
    );
END;
$$;

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
    v_invoice_id UUID;
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
    v_type stock_movement_type;
    v_old_effective_total DECIMAL(10,2) := 0;
    v_new_effective_total DECIMAL(10,2) := 0;
    v_net_paid DECIMAL(10,2) := 0;
    v_incremental_excess DECIMAL(10,2) := 0;
    v_new_credit_balance DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized.'; END IF;
    IF p_sets_quantity < 0 OR p_loose_quantity < 0 THEN RAISE EXCEPTION 'Return quantities cannot be negative.'; END IF;

    SELECT invoice_id INTO v_invoice_id FROM invoice_items WHERE id = p_invoice_item_id;
    IF v_invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice line item not found.'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = v_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Associated invoice not found.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Cannot process return: The invoice has been completely voided.'; END IF;

    SELECT * INTO v_item FROM invoice_items WHERE id = p_invoice_item_id FOR UPDATE;
    SELECT * INTO v_variant FROM variants WHERE id = v_item.variant_id FOR UPDATE;
    SELECT * INTO v_product FROM products WHERE id = v_variant.product_id;

    -- FIX: Use variant pieces per set first
    v_total_pieces_to_return := (p_sets_quantity * GREATEST(COALESCE(v_variant.pieces_per_set, v_product.pieces_per_set, 1), 1)) + p_loose_quantity;
    IF v_total_pieces_to_return <= 0 THEN RAISE EXCEPTION 'Total return pieces must be greater than zero.'; END IF;

    SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(sets_quantity), 0), COALESCE(SUM(total_refund_amount), 0)
    INTO v_past_returned_total, v_past_returned_sets, v_item_past_refunds
    FROM returns WHERE invoice_item_id = p_invoice_item_id;

    v_remaining_returnable_pieces := v_item.quantity - v_past_returned_total;
    IF v_total_pieces_to_return > v_remaining_returnable_pieces THEN
        RAISE EXCEPTION 'Over-return blocked! Line qty: %, Already returned: %, Requested: %', v_item.quantity, v_past_returned_total, v_total_pieces_to_return;
    END IF;

    v_remaining_returnable_sets := COALESCE(v_item.sets_quantity, 0) - v_past_returned_sets;
    IF p_sets_quantity > v_remaining_returnable_sets THEN
        RAISE EXCEPTION 'Cannot return % packaged set(s). Only % packaged set(s) were originally purchased on this line item.', p_sets_quantity, v_remaining_returnable_sets;
    END IF;

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

    IF v_invoice.customer_id IS NOT NULL THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_net_paid 
        FROM payments WHERE invoice_id = v_invoice.id AND payment_method != 'STORE_CREDIT';
        
        v_old_effective_total := GREATEST(0.00, v_invoice.final_total - v_invoice_past_refunds);
        v_new_effective_total := GREATEST(0.00, v_old_effective_total - v_total_refund);
        v_incremental_excess := GREATEST(0.00, v_net_paid - v_new_effective_total) - GREATEST(0.00, v_net_paid - v_old_effective_total);

        IF v_incremental_excess > 0 THEN
            UPDATE customers SET credit_balance = credit_balance + v_incremental_excess, updated_at = NOW() WHERE id = v_invoice.customer_id RETURNING credit_balance INTO v_new_credit_balance;
            INSERT INTO customer_credit_ledger (customer_id, type, amount, balance_after, notes)
            VALUES (v_invoice.customer_id, 'RETURN_CREDIT'::credit_movement_type, v_incremental_excess, v_new_credit_balance, 'Excess from Return on Invoice ' || v_invoice.invoice_number);
        END IF;
    END IF;

    INSERT INTO returns (invoice_id, invoice_item_id, return_type, quantity, sets_quantity, loose_quantity, unit_refund_price, total_refund_amount, refund_method, notes)
    VALUES (v_invoice.id, p_invoice_item_id, p_return_type, v_total_pieces_to_return, p_sets_quantity, p_loose_quantity, ROUND(v_total_refund / v_total_pieces_to_return, 2), v_total_refund, p_refund_method, p_notes)
    RETURNING id INTO v_return_id;

    IF p_return_type = 'RESTOCK' THEN
        v_type := 'RETURN_RESTOCK'::stock_movement_type;
        UPDATE variants SET stock_quantity = stock_quantity + v_total_pieces_to_return, stock_sets = stock_sets + p_sets_quantity, updated_at = NOW() WHERE id = v_variant.id;
    ELSE
        v_type := 'RETURN_DAMAGE'::stock_movement_type;
    END IF;

    INSERT INTO stock_movements (variant_id, invoice_item_id, type, quantity_change, sets_change, loose_change, notes)
    VALUES (v_variant.id, p_invoice_item_id, v_type, v_total_pieces_to_return, p_sets_quantity, p_loose_quantity, 'Return: ' || p_return_type || COALESCE(' - ' || p_notes, ''));

    IF v_total_refund > 0 THEN
        INSERT INTO payments (invoice_id, amount, payment_method) VALUES (v_invoice.id, -v_total_refund, p_refund_method);
    END IF;

    RETURN jsonb_build_object('success', true, 'return_id', v_return_id, 'refund_amount', v_total_refund);
END;
$$;

CREATE OR REPLACE FUNCTION process_checkout(
    p_customer_id UUID DEFAULT NULL,
    p_subtotal DECIMAL DEFAULT 0,
    p_discount_amount DECIMAL DEFAULT 0,
    p_round_off DECIMAL DEFAULT 0,
    p_gst_applied BOOLEAN DEFAULT FALSE,
    p_cgst_amount DECIMAL DEFAULT 0,
    p_sgst_amount DECIMAL DEFAULT 0,
    p_final_total DECIMAL DEFAULT 0,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_payments JSONB DEFAULT '[]'::jsonb,
    p_created_at TIMESTAMPTZ DEFAULT NULL,
    p_cheque_details JSONB DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
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
    v_variant RECORD;
    v_payment RECORD;
    v_total_pieces INT;
    v_customer_credit DECIMAL(10,2) := 0;
    v_total_paid DECIMAL(10,2) := 0;
    v_store_credit_paid DECIMAL(10,2) := 0;
    v_invoice_created_at TIMESTAMPTZ := COALESCE(p_created_at, NOW());
    v_item_id UUID;
    v_line_profit DECIMAL(10,2) := 0;
    v_cheque_id UUID;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart is empty.'; END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, invoice_number INTO v_invoice_id, v_invoice_number FROM invoices WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number, 'already_processed', true);
        END IF;
    END IF;

    IF p_customer_id IS NOT NULL THEN PERFORM 1 FROM customers WHERE id = p_customer_id FOR UPDATE; END IF;
    PERFORM 1 FROM variants v WHERE v.id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x) ORDER BY v.id FOR UPDATE OF v;

    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                IF v_payment.method = 'STORE_CREDIT' THEN
                    SELECT credit_balance INTO v_customer_credit FROM customers WHERE id = p_customer_id FOR UPDATE;
                    IF v_customer_credit < v_payment.amount THEN RAISE EXCEPTION 'Insufficient store credit balance.'; END IF;
                    UPDATE customers SET credit_balance = credit_balance - v_payment.amount, updated_at = NOW() WHERE id = p_customer_id;
                    INSERT INTO customer_credit_ledger (customer_id, type, amount, balance_after, notes)
                    VALUES (p_customer_id, 'PAYMENT_APPLIED'::credit_movement_type, -v_payment.amount, v_customer_credit - v_payment.amount, 'Redeemed during checkout');
                END IF;
                v_total_paid := v_total_paid + v_payment.amount;
            END IF;
        END LOOP;
    END IF;

    v_invoice_number := 'INV-' || to_char(v_invoice_created_at, 'YYMM') || '-' || LPAD(FLOOR(random() * 10000)::text, 4, '0');

    INSERT INTO invoices (
        invoice_number, customer_id, subtotal, discount_amount, round_off, gst_applied, cgst_amount, sgst_amount, final_total, created_at, idempotency_key
    ) VALUES (
        v_invoice_number, p_customer_id, p_subtotal, p_discount_amount, p_round_off, p_gst_applied, p_cgst_amount, p_sgst_amount, p_final_total, v_invoice_created_at, p_idempotency_key
    ) RETURNING id INTO v_invoice_id;

    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER, selling_price DECIMAL)
    LOOP
        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant FROM variants v JOIN products p ON v.product_id = p.id WHERE v.id = v_item.variant_id;
        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * GREATEST(COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1), 1)) + COALESCE(v_item.loose_quantity, 0);
        v_line_profit := (COALESCE(v_item.selling_price, v_variant.selling_price) - COALESCE(v_variant.cost_price, 0)) * v_total_pieces;

        IF v_total_pieces > v_variant.stock_quantity THEN RAISE EXCEPTION 'Insufficient stock for variant %', v_variant.name; END IF;

        INSERT INTO invoice_items (invoice_id, variant_id, quantity, sets_quantity, loose_quantity, selling_price_snapshot, cost_price_snapshot, profit_snapshot, created_at)
        VALUES (v_invoice_id, v_item.variant_id, v_total_pieces, COALESCE(v_item.sets_quantity, 0), COALESCE(v_item.loose_quantity, 0), v_variant.selling_price, v_variant.cost_price, v_line_profit, v_invoice_created_at)
        RETURNING id INTO v_item_id;

        UPDATE variants SET stock_quantity = stock_quantity - v_total_pieces, stock_sets = GREATEST(0, stock_sets - COALESCE(v_item.sets_quantity, 0)), updated_at = NOW() WHERE id = v_item.variant_id;
        
        INSERT INTO stock_movements (variant_id, invoice_item_id, type, quantity_change, sets_change, loose_change, notes, created_at)
        VALUES (v_item.variant_id, v_item_id, 'SALE'::stock_movement_type, -v_total_pieces, -COALESCE(v_item.sets_quantity, 0), -COALESCE(v_item.loose_quantity, 0), 'Sale: ' || v_invoice_number, v_invoice_created_at);
    END LOOP;

    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                INSERT INTO payments (invoice_id, amount, payment_method, created_at) VALUES (v_invoice_id, v_payment.amount, v_payment.method, v_invoice_created_at);
            END IF;
        END LOOP;
    END IF;

    IF p_cheque_details IS NOT NULL AND p_cheque_details->>'cheque_number' IS NOT NULL THEN
        INSERT INTO customer_cheques (customer_id, invoice_id, cheque_number, bank_name, branch_name, amount, due_date, status, created_at)
        VALUES (p_customer_id, v_invoice_id, p_cheque_details->>'cheque_number', p_cheque_details->>'bank_name', p_cheque_details->>'branch_name', (p_cheque_details->>'amount')::DECIMAL, (p_cheque_details->>'due_date')::DATE, 'PENDING', v_invoice_created_at)
        RETURNING id INTO v_cheque_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number);
END;
$$;

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
    v_restored_sets INTEGER;
    v_returned_pieces INTEGER;
    v_pieces_per_set INTEGER;
    v_net_store_credit_paid DECIMAL(10,2) := 0;
    v_restored_balance DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized.'; END IF;
    IF p_invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice ID is required.'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Invoice is already voided.'; END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO v_returned_pieces FROM returns WHERE invoice_id = p_invoice_id;
    IF v_returned_pieces > 0 THEN RAISE EXCEPTION 'Cannot void an invoice that has active returns. Void the returns first.'; END IF;

    PERFORM 1 FROM variants v WHERE v.id IN (SELECT variant_id FROM invoice_items WHERE invoice_id = p_invoice_id) ORDER BY v.id FOR UPDATE OF v;
    IF v_invoice.customer_id IS NOT NULL THEN PERFORM 1 FROM customers WHERE id = v_invoice.customer_id FOR UPDATE; END IF;

    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant FROM variants v JOIN products p ON v.product_id = p.id WHERE v.id = v_item.variant_id;
        v_pieces_per_set := GREATEST(COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1), 1);
        v_restored_pieces := v_item.quantity;
        v_restored_sets := COALESCE(v_item.sets_quantity, 0);

        IF v_restored_pieces > 0 THEN
            IF v_invoice.line_staff_id IS NOT NULL THEN
                INSERT INTO line_van_inventory (staff_id, variant_id, quantity, sets_quantity, updated_at)
                VALUES (v_invoice.line_staff_id, v_item.variant_id, v_restored_pieces, v_restored_sets, NOW())
                ON CONFLICT (staff_id, variant_id) DO UPDATE SET 
                    quantity = line_van_inventory.quantity + EXCLUDED.quantity,
                    sets_quantity = line_van_inventory.sets_quantity + EXCLUDED.sets_quantity,
                    updated_at = NOW();

                INSERT INTO line_stock_movements (staff_id, variant_id, type, sets_quantity, quantity, notes)
                VALUES (v_invoice.line_staff_id, v_item.variant_id, 'MANUAL_RETURN', v_restored_sets, v_restored_pieces, 'Void Invoice ' || v_invoice.invoice_number);
            ELSE
                UPDATE variants SET stock_quantity = stock_quantity + v_restored_pieces, stock_sets = stock_sets + v_restored_sets, updated_at = NOW() WHERE id = v_item.variant_id;
                INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, sets_change, loose_change, notes)
                VALUES (v_item.id, v_item.variant_id, 'MANUAL_ADJUST'::stock_movement_type, v_restored_pieces, v_restored_sets, COALESCE(v_item.loose_quantity, 0), 'Void Restock: ' || v_invoice.invoice_number);
            END IF;
        END IF;
    END LOOP;

    IF v_invoice.customer_id IS NOT NULL THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_net_store_credit_paid FROM payments WHERE invoice_id = p_invoice_id AND payment_method = 'STORE_CREDIT';
        IF v_net_store_credit_paid > 0 THEN
            UPDATE customers SET credit_balance = credit_balance + v_net_store_credit_paid, updated_at = NOW() WHERE id = v_invoice.customer_id RETURNING credit_balance INTO v_restored_balance;
            INSERT INTO customer_credit_ledger (customer_id, type, amount, balance_after, notes)
            VALUES (v_invoice.customer_id, 'MANUAL_ADJUST'::credit_movement_type, v_net_store_credit_paid, v_restored_balance, 'Refund Store Credit from Voided Invoice ' || v_invoice.invoice_number);
        END IF;
    END IF;

    UPDATE invoices SET is_voided = TRUE, void_reason = p_reason, updated_at = NOW() WHERE id = p_invoice_id;
    RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$$;

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
    v_net_pieces_to_deduct INTEGER;
    v_sets_to_deduct INTEGER;
    v_pieces_per_set INTEGER;
    v_net_store_credit_paid DECIMAL(10,2) := 0;
    v_new_balance DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized.'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF NOT v_invoice.is_voided THEN RAISE EXCEPTION 'Invoice is not voided.'; END IF;

    PERFORM 1 FROM variants v WHERE v.id IN (SELECT variant_id FROM invoice_items WHERE invoice_id = p_invoice_id) ORDER BY v.id FOR UPDATE OF v;
    IF v_invoice.customer_id IS NOT NULL THEN PERFORM 1 FROM customers WHERE id = v_invoice.customer_id FOR UPDATE; END IF;

    -- Validate stock
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant FROM variants v JOIN products p ON v.product_id = p.id WHERE v.id = v_item.variant_id;
        v_pieces_per_set := GREATEST(COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1), 1);
        v_net_pieces_to_deduct := v_item.quantity;

        IF v_net_pieces_to_deduct > 0 THEN
            IF v_invoice.line_staff_id IS NOT NULL THEN
                SELECT * INTO v_van_item FROM line_van_inventory WHERE staff_id = v_invoice.line_staff_id AND variant_id = v_item.variant_id FOR UPDATE;
                IF NOT FOUND OR v_van_item.quantity < v_net_pieces_to_deduct THEN
                    RAISE EXCEPTION 'Insufficient van stock for variant % to undo void.', v_variant.name;
                END IF;
            ELSE
                IF v_variant.stock_quantity < v_net_pieces_to_deduct THEN
                    RAISE EXCEPTION 'Insufficient warehouse stock for variant % to undo void.', v_variant.name;
                END IF;
            END IF;
        END IF;
    END LOOP;

    -- Deduct stock
    FOR v_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        SELECT v.*, p.pieces_per_set AS product_pps INTO v_variant FROM variants v JOIN products p ON v.product_id = p.id WHERE v.id = v_item.variant_id;
        v_pieces_per_set := GREATEST(COALESCE(v_variant.pieces_per_set, v_variant.product_pps, 1), 1);
        v_net_pieces_to_deduct := v_item.quantity;
        
        v_sets_to_deduct := LEAST(COALESCE(v_item.sets_quantity, 0), FLOOR(v_net_pieces_to_deduct::numeric / v_pieces_per_set));

        IF v_net_pieces_to_deduct > 0 THEN
            IF v_invoice.line_staff_id IS NOT NULL THEN
                UPDATE line_van_inventory SET quantity = quantity - v_net_pieces_to_deduct, sets_quantity = GREATEST(0, sets_quantity - v_sets_to_deduct), updated_at = NOW() 
                WHERE staff_id = v_invoice.line_staff_id AND variant_id = v_item.variant_id;
                
                INSERT INTO line_stock_movements (staff_id, variant_id, type, sets_quantity, quantity, notes)
                VALUES (v_invoice.line_staff_id, v_item.variant_id, 'SALE_DEDUCT', v_sets_to_deduct, v_net_pieces_to_deduct, 'Undo Void ' || v_invoice.invoice_number);
            ELSE
                UPDATE variants SET stock_quantity = stock_quantity - v_net_pieces_to_deduct, stock_sets = GREATEST(0, stock_sets - v_sets_to_deduct), updated_at = NOW() WHERE id = v_item.variant_id;
                INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, sets_change, notes)
                VALUES (v_item.id, v_item.variant_id, 'SALE'::stock_movement_type, -v_net_pieces_to_deduct, -v_sets_to_deduct, 'Undo Void ' || v_invoice.invoice_number);
            END IF;
        END IF;
    END LOOP;

    IF v_invoice.customer_id IS NOT NULL THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_net_store_credit_paid FROM payments WHERE invoice_id = p_invoice_id AND payment_method = 'STORE_CREDIT';
        IF v_net_store_credit_paid > 0 THEN
            SELECT credit_balance INTO v_new_balance FROM customers WHERE id = v_invoice.customer_id FOR UPDATE;
            IF v_new_balance < v_net_store_credit_paid THEN RAISE EXCEPTION 'Insufficient store credit to undo void.'; END IF;
            UPDATE customers SET credit_balance = credit_balance - v_net_store_credit_paid, updated_at = NOW() WHERE id = v_invoice.customer_id RETURNING credit_balance INTO v_new_balance;
            INSERT INTO customer_credit_ledger (customer_id, type, amount, balance_after, notes)
            VALUES (v_invoice.customer_id, 'PAYMENT_APPLIED'::credit_movement_type, -v_net_store_credit_paid, v_new_balance, 'Re-apply Store Credit for Undo Void ' || v_invoice.invoice_number);
        END IF;
    END IF;

    UPDATE invoices SET is_voided = FALSE, void_reason = NULL, updated_at = NOW() WHERE id = p_invoice_id;
    RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$$;

CREATE OR REPLACE FUNCTION process_stock_arrival(
    p_movements JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_movement RECORD;
    v_total_added INTEGER;
    v_effective_pps INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_movements IS NULL OR jsonb_typeof(p_movements) <> 'array' OR jsonb_array_length(p_movements) = 0 THEN
        RAISE EXCEPTION 'Stock arrival movements cannot be empty.';
    END IF;

    FOR v_movement IN 
        WITH parsed AS (
            SELECT (x->>'variant_id')::UUID AS variant_id, 
                   COALESCE((x->>'sets_quantity')::INTEGER, 0) AS sets_quantity, 
                   COALESCE((x->>'loose_quantity')::INTEGER, 0) AS loose_quantity, 
                   x->>'notes' AS notes 
            FROM jsonb_array_elements(p_movements) AS x
        )
        SELECT p.variant_id, p.sets_quantity, p.loose_quantity, p.notes, 
               COALESCE(v.pieces_per_set, pr.pieces_per_set, 1) AS effective_pps
        FROM parsed p
        JOIN variants v ON p.variant_id = v.id
        JOIN products pr ON v.product_id = pr.id
        WHERE v.is_active = TRUE AND pr.is_active = TRUE
        ORDER BY p.variant_id
    LOOP
        IF v_movement.sets_quantity < 0 OR v_movement.loose_quantity < 0 THEN 
            RAISE EXCEPTION 'Quantities cannot be negative.'; 
        END IF;

        v_effective_pps := GREATEST(1, v_movement.effective_pps);
        v_total_added := (v_movement.sets_quantity * v_effective_pps) + v_movement.loose_quantity;
        
        IF v_total_added = 0 THEN
            RAISE EXCEPTION 'Total added quantity must be greater than zero.';
        END IF;

        UPDATE variants 
        SET stock_quantity = stock_quantity + v_total_added,
            stock_sets = stock_sets + v_movement.sets_quantity,
            updated_at = NOW()
        WHERE id = v_movement.variant_id;

        INSERT INTO stock_movements (
            variant_id, type, quantity_change, sets_change, loose_change, notes
        ) VALUES (
            v_movement.variant_id, 'ARRIVAL', v_total_added, 
            v_movement.sets_quantity, v_movement.loose_quantity, 
            v_movement.notes
        );
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$$;
CREATE OR REPLACE FUNCTION update_full_invoice(
    p_invoice_id UUID,
    p_customer_id UUID,
    p_created_at TIMESTAMPTZ,
    p_subtotal DECIMAL,
    p_discount_amount DECIMAL,
    p_round_off DECIMAL,
    p_gst_applied BOOLEAN,
    p_cgst_amount DECIMAL,
    p_sgst_amount DECIMAL,
    p_final_total DECIMAL,
    p_items JSONB,
    p_payments JSONB,
    p_cheque_details JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_old_item RECORD;
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
    v_old_store_credit DECIMAL(10,2) := 0;
    v_new_store_credit DECIMAL(10,2) := 0;
    v_customer_credit DECIMAL(10,2) := 0;
    v_new_credit_balance DECIMAL(10,2) := 0;
    v_item_id UUID;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    v_invoice_created_at TIMESTAMPTZ;
    v_existing_cheque_id UUID;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice ID is required.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart cannot be empty.'; END IF;
    IF p_subtotal < 0 OR p_discount_amount < 0 OR p_final_total < 0 THEN
        RAISE EXCEPTION 'Financial values cannot be negative.';
    END IF;

    -- Financial Bounds Checks
    IF p_discount_amount > p_subtotal THEN
        RAISE EXCEPTION 'Discount amount (₹%) cannot exceed subtotal (₹%).', p_discount_amount, p_subtotal;
    END IF;

    IF p_round_off < -50.00 OR p_round_off > 50.00 THEN
        RAISE EXCEPTION 'Round off (₹%) must be between -₹50.00 and +₹50.00.', p_round_off;
    END IF;

    -- 1. Lock invoice
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_invoice.is_hidden THEN RAISE EXCEPTION 'Cannot edit a permanently deleted invoice.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Cannot edit a voided invoice (Undo void first).'; END IF;

    -- 2. Foreign Key & Return Integrity Guard
    IF EXISTS (SELECT 1 FROM returns WHERE invoice_id = p_invoice_id) THEN
        RAISE EXCEPTION 'Cannot edit cart on an invoice that has returns processed. Please void or adjust returns first.';
    END IF;

    -- 3. Timestamp validations
    v_invoice_created_at := COALESCE(p_created_at, v_invoice.created_at);
    IF v_invoice_created_at > (NOW() + INTERVAL '1 day') THEN
        RAISE EXCEPTION 'Invoice date cannot be in the future.';
    END IF;

    -- 4. Prevent duplicate variants in new items
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in items. Please consolidate quantities.';
    END IF;

    -- 5. Calculate total paid and validate customer credit rules
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                IF v_payment.method = 'STORE_CREDIT' THEN
                    IF p_customer_id IS NULL THEN
                        RAISE EXCEPTION 'Customer is required when paying with store credit.';
                    END IF;
                    v_new_store_credit := v_new_store_credit + v_payment.amount;
                END IF;
                v_total_paid := v_total_paid + v_payment.amount;
            END IF;
        END LOOP;
    END IF;

    -- Overpayment Guard
    IF v_total_paid > p_final_total THEN
        RAISE EXCEPTION 'Total payment (₹%) cannot exceed invoice final total (₹%).', v_total_paid, p_final_total;
    END IF;

    -- Walk-in credit check (Policy 10)
    IF p_customer_id IS NULL AND v_total_paid < p_final_total THEN
        RAISE EXCEPTION 'Customer is required for credit/partial credit sales.';
    END IF;

    -- Verify active customer if provided
    IF p_customer_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND is_active = TRUE) THEN
            RAISE EXCEPTION 'Customer does not exist or is inactive.';
        END IF;
    END IF;

    -- 6. Lock all involved variants in deterministic order
    PERFORM 1 FROM variants v
    WHERE v.id IN (
        SELECT variant_id FROM invoice_items WHERE invoice_id = p_invoice_id
        UNION
        SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x
    )
    ORDER BY v.id FOR UPDATE OF v;

    -- 7. REVERT OLD STOCK: Add back old quantities
    FOR v_old_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
    LOOP
        UPDATE variants
        SET stock_quantity = stock_quantity + v_old_item.quantity,
            stock_sets = stock_sets + COALESCE(v_old_item.sets_quantity, 0),
            updated_at = NOW()
        WHERE id = v_old_item.variant_id;
    END LOOP;

    -- 7b. Decouple non-sale audit movements and delete previous sale movements cleanly
    UPDATE stock_movements
    SET invoice_item_id = NULL
    WHERE invoice_item_id IN (SELECT id FROM invoice_items WHERE invoice_id = p_invoice_id);

    DELETE FROM stock_movements 
    WHERE notes = 'Sale: ' || v_invoice.invoice_number
       OR notes = 'Invoice Edit: ' || v_invoice.invoice_number
       OR notes = 'Undo Void: ' || v_invoice.invoice_number;

    -- 8. Validate New Items Against Restored Stock
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER, selling_price DECIMAL
    )
    LOOP
        IF v_item.sets_quantity < 0 OR v_item.loose_quantity < 0 THEN
            RAISE EXCEPTION 'Quantities cannot be negative.';
        END IF;

        IF v_item.selling_price < 0 THEN
            RAISE EXCEPTION 'Selling price cannot be negative.';
        END IF;

        SELECT v.*, COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps 
        INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id 
        WHERE v.id = v_item.variant_id AND v.is_active = TRUE AND p.is_active = TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product variant is inactive or no longer exists.';
        END IF;

        IF v_item.selling_price <> v_variant.selling_price THEN
            RAISE EXCEPTION 'Price tampering detected for variant %: catalog price %, sent %',
                v_variant.name, v_variant.selling_price, v_item.selling_price;
        END IF;

        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_variant.effective_pps) + COALESCE(v_item.loose_quantity, 0);
        IF v_total_pieces <= 0 THEN
            RAISE EXCEPTION 'Total pieces for variant % must be greater than zero.', v_variant.name;
        END IF;

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

    IF p_gst_applied THEN
        v_expected_cgst := ROUND(GREATEST(0, v_calculated_subtotal - p_discount_amount) * 0.025, 2);
        v_expected_sgst := ROUND(GREATEST(0, v_calculated_subtotal - p_discount_amount) * 0.025, 2);
    END IF;

    v_expected_final_total := ROUND(v_calculated_subtotal - p_discount_amount + p_round_off + (v_expected_cgst + v_expected_sgst), 2);
    IF ABS(p_final_total - v_expected_final_total) > 0.05 THEN
        RAISE EXCEPTION 'Invoice total mismatch: calculated %, received %', v_expected_final_total, p_final_total;
    END IF;

    -- 9. Reconcile Store Credit
    SELECT COALESCE(SUM(amount), 0) INTO v_old_store_credit
    FROM payments WHERE invoice_id = p_invoice_id AND method = 'STORE_CREDIT';

    IF v_old_store_credit > 0 THEN
        UPDATE customers
        SET credit_balance = credit_balance + v_old_store_credit,
            updated_at = NOW()
        WHERE id = v_invoice.customer_id;

        INSERT INTO customer_credit_ledger (
            customer_id, type, amount, balance_after,
            reference_invoice_id, notes, created_at
        )
        SELECT 
            v_invoice.customer_id, 'MANUAL_ADJUST'::credit_movement_type,
            v_old_store_credit, credit_balance, p_invoice_id,
            'Refunded store credit from edited invoice #' || v_invoice.invoice_number,
            v_invoice_created_at
        FROM customers WHERE id = v_invoice.customer_id;
    END IF;

    -- 10. Update Invoice Header
    UPDATE invoices SET
        customer_id = p_customer_id,
        subtotal = v_calculated_subtotal,
        discount_amount = p_discount_amount,
        round_off = p_round_off,
        gst_applied = p_gst_applied,
        cgst_amount = v_expected_cgst,
        sgst_amount = v_expected_sgst,
        final_total = p_final_total,
        created_at = v_invoice_created_at,
        updated_at = NOW()
    WHERE id = p_invoice_id;

    -- 11. Delete Old Line Items and Insert New Line Items with Delta Movements
    DELETE FROM invoice_items WHERE invoice_id = p_invoice_id;

    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID, sets_quantity INTEGER, loose_quantity INTEGER, selling_price DECIMAL
    )
    LOOP
        SELECT v.*, COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps 
        INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id 
        WHERE v.id = v_item.variant_id;

        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_variant.effective_pps) + COALESCE(v_item.loose_quantity, 0);
        v_line_subtotal := v_total_pieces * v_variant.selling_price;
        v_line_cogs := v_total_pieces * v_variant.cost_price;
        v_line_profit := v_line_subtotal - v_line_cogs;

        INSERT INTO invoice_items (
            invoice_id, variant_id, quantity, sets_quantity, loose_quantity,
            selling_price_snapshot, cost_price_snapshot, profit_snapshot,
            created_at, updated_at
        ) VALUES (
            p_invoice_id, v_item.variant_id, v_total_pieces,
            COALESCE(v_item.sets_quantity, 0), COALESCE(v_item.loose_quantity, 0),
            v_variant.selling_price, v_variant.cost_price, v_line_profit,
            v_invoice_created_at, NOW()
        ) RETURNING id INTO v_item_id;

        UPDATE variants
        SET stock_quantity = stock_quantity - v_total_pieces,
            stock_sets = GREATEST(0, LEAST(stock_sets - COALESCE(v_item.sets_quantity, 0), FLOOR((stock_quantity - v_total_pieces) / v_variant.effective_pps))),
            updated_at = NOW()
        WHERE id = v_item.variant_id;

        INSERT INTO stock_movements (
            variant_id, invoice_item_id, type, quantity_change,
            sets_change, loose_change, notes, created_at
        ) VALUES (
            v_item.variant_id, v_item_id, 'SALE'::stock_movement_type,
            -v_total_pieces, -COALESCE(v_item.sets_quantity, 0), -COALESCE(v_item.loose_quantity, 0),
            'Invoice Edit: ' || v_invoice.invoice_number, v_invoice_created_at
        );
    END LOOP;

    -- 12. Recreate Payments (Preserve Cleared Cheque Payments If Existed)
    DELETE FROM payments 
    WHERE invoice_id = p_invoice_id 
      AND (notes IS NULL OR notes NOT ILIKE '%Cheque%Cleared%');

    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                IF v_payment.method = 'STORE_CREDIT' THEN
                    SELECT credit_balance INTO v_customer_credit
                    FROM customers WHERE id = p_customer_id FOR UPDATE;

                    IF v_customer_credit < v_payment.amount THEN
                        RAISE EXCEPTION 'Insufficient customer store credit (Available: ₹%, Requested: ₹%).',
                            v_customer_credit, v_payment.amount;
                    END IF;

                    UPDATE customers
                    SET credit_balance = credit_balance - v_payment.amount,
                        updated_at = NOW()
                    WHERE id = p_customer_id
                    RETURNING credit_balance INTO v_new_credit_balance;

                    INSERT INTO customer_credit_ledger (
                        customer_id, type, amount, balance_after,
                        reference_invoice_id, notes, created_at
                    ) VALUES (
                        p_customer_id, 'PAYMENT_APPLIED'::credit_movement_type,
                        -v_payment.amount, v_new_credit_balance, p_invoice_id,
                        'Used store credit for edited invoice #' || v_invoice.invoice_number,
                        v_invoice_created_at
                    );
                END IF;

                INSERT INTO payments (
                    invoice_id, customer_id, amount, method, notes, created_at
                ) VALUES (
                    p_invoice_id, p_customer_id, v_payment.amount, v_payment.method,
                    'Payment for edited invoice #' || v_invoice.invoice_number, v_invoice_created_at
                );
            END IF;
        END LOOP;
    END IF;

    -- Atomic Cheque Update/Create
    IF p_cheque_details IS NOT NULL AND jsonb_typeof(p_cheque_details) = 'object' THEN
        SELECT id INTO v_existing_cheque_id 
        FROM customer_cheques 
        WHERE invoice_id = p_invoice_id AND status = 'PENDING' FOR UPDATE;

        IF v_existing_cheque_id IS NOT NULL THEN
            UPDATE customer_cheques
            SET cheque_number = trim(p_cheque_details->>'cheque_number'),
                bank_name = trim(p_cheque_details->>'bank_name'),
                cheque_date = (p_cheque_details->>'cheque_date')::DATE,
                amount = p_final_total,
                customer_id = p_customer_id,
                updated_at = NOW()
            WHERE id = v_existing_cheque_id;
        ELSE
            INSERT INTO customer_cheques (
                customer_id,
                invoice_id,
                cheque_number,
                bank_name,
                cheque_date,
                amount,
                status,
                created_at
            ) VALUES (
                p_customer_id,
                p_invoice_id,
                trim(p_cheque_details->>'cheque_number'),
                trim(p_cheque_details->>'bank_name'),
                (p_cheque_details->>'cheque_date')::DATE,
                p_final_total,
                'PENDING',
                v_invoice_created_at
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'invoice_number', v_invoice.invoice_number,
        'total_amount', p_final_total,
        'paid_amount', v_total_paid,
        'due_amount', GREATEST(0.00, p_final_total - v_total_paid)
    );
END;
$$;
