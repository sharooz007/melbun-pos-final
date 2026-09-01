-- Migration: 0075_harden_cheque_clearance_and_atomic_checkout.sql
-- 1. Hardens clear_customer_cheque RPC with automatic excess wallet deposit on partial returns/dues.
-- 2. Integrates optional p_cheque_details into process_checkout and update_full_invoice for 100% ACID atomic cheque transactions.

-- Step 1: Update clear_customer_cheque RPC
CREATE OR REPLACE FUNCTION clear_customer_cheque(
    p_cheque_id UUID,
    p_clearance_method TEXT DEFAULT 'BANK',
    p_clearance_date TIMESTAMPTZ DEFAULT NULL,
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
    v_applied_to_invoice DECIMAL(10,2) := 0;
    v_excess_to_credit DECIMAL(10,2) := 0;
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

    -- 3. If tied to an invoice, apply up to net remaining due and credit any excess to customer wallet
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

        v_applied_to_invoice := LEAST(v_cheque.amount, v_net_due);
        v_excess_to_credit := v_cheque.amount - v_applied_to_invoice;

        -- Insert invoice payment for settled portion
        IF v_applied_to_invoice > 0 THEN
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
                v_applied_to_invoice,
                p_clearance_method,
                'Cheque #' || v_cheque.cheque_number || ' (' || v_cheque.bank_name || ') Cleared via ' || p_clearance_method,
                v_clear_date
            );
            UPDATE invoices SET updated_at = NOW() WHERE id = v_cheque.invoice_id;
        END IF;

        -- Deposit excess into customer wallet if invoice was partially paid/refunded
        IF v_excess_to_credit > 0 THEN
            UPDATE customers
            SET credit_balance = credit_balance + v_excess_to_credit,
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
                v_excess_to_credit,
                v_new_credit_balance,
                v_cheque.invoice_id,
                'Cheque #' || v_cheque.cheque_number || ' excess amount deposited to wallet after invoice settlement',
                v_clear_date
            );
        END IF;
    ELSE
        -- 4. Unlinked Cheque (Deposit directly to Customer Credit Wallet)
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
        'applied_to_invoice', v_applied_to_invoice,
        'excess_to_credit', v_excess_to_credit,
        'customer_credit_balance', v_new_credit_balance
    );
END;
$$;

-- Drop old process_checkout signature to prevent overload collision
DROP FUNCTION IF EXISTS process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ);

-- Step 2: Update process_checkout RPC to support atomic cheque recording
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
    p_cheque_details JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_total_paid DECIMAL(10,2) := 0;
    v_item RECORD;
    v_payment RECORD;
    v_variant RECORD;
    v_total_pieces INTEGER;
    v_line_subtotal DECIMAL(10,2);
    v_line_cogs DECIMAL(10,2);
    v_line_profit DECIMAL(10,2);
    v_customer_credit DECIMAL(10,2);
    v_new_credit_balance DECIMAL(10,2);
    v_calculated_subtotal DECIMAL(10,2) := 0;
    v_expected_cgst DECIMAL(10,2) := 0;
    v_expected_sgst DECIMAL(10,2) := 0;
    v_expected_final_total DECIMAL(10,2) := 0;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    v_invoice_created_at TIMESTAMPTZ;
    v_item_id UUID;
    done BOOLEAN := FALSE;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
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

    -- Future Date Buffer Guard
    v_invoice_created_at := COALESCE(p_created_at, NOW());
    IF v_invoice_created_at > (NOW() + INTERVAL '1 day') THEN
        RAISE EXCEPTION 'Invoice date cannot be in the future.';
    END IF;

    -- Prevent duplicate variants in single checkout
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in checkout items. Please consolidate cart quantities.';
    END IF;

    -- Validate payment array
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

    -- Overpayment Guard
    IF v_total_paid > p_final_total THEN
        RAISE EXCEPTION 'Total payment (₹%) cannot exceed invoice final total (₹%).', v_total_paid, p_final_total;
    END IF;

    -- Walk-in Zero Credit Invariant
    IF p_customer_id IS NULL AND v_total_paid < p_final_total THEN
        RAISE EXCEPTION 'Customer is required for credit/partial credit sales.';
    END IF;

    -- Verify active customer
    IF p_customer_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND is_active = TRUE) THEN
            RAISE EXCEPTION 'Customer does not exist or is inactive.';
        END IF;
    END IF;

    -- Lock variants in deterministic ascending UUID order (Deadlock Prevention)
    PERFORM 1 FROM variants v
    WHERE v.id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x)
    ORDER BY v.id FOR UPDATE OF v;

    -- Validate Stock, Anti-Tampering, & Calculate Subtotal
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

    -- Collision-resistant Invoice Number Generation
    WHILE NOT done LOOP
        v_invoice_number := 'MELBUN/' || to_char(v_invoice_created_at, 'YYYY') || '/' || upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6));
        IF NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = v_invoice_number) THEN 
            done := TRUE; 
        END IF;
    END LOOP;

    INSERT INTO invoices (
        invoice_number, customer_id, subtotal, discount_amount, round_off,
        gst_applied, cgst_amount, sgst_amount, final_total, created_at, updated_at
    ) VALUES (
        v_invoice_number, p_customer_id, v_calculated_subtotal, p_discount_amount, p_round_off,
        p_gst_applied, v_expected_cgst, v_expected_sgst, p_final_total, v_invoice_created_at, v_invoice_created_at
    ) RETURNING id INTO v_invoice_id;

    -- Deduct Stock and Insert Line Items
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
            v_invoice_id, v_item.variant_id, v_total_pieces,
            COALESCE(v_item.sets_quantity, 0), COALESCE(v_item.loose_quantity, 0),
            v_variant.selling_price, v_variant.cost_price, v_line_profit,
            v_invoice_created_at, v_invoice_created_at
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
            'Sale: ' || v_invoice_number, v_invoice_created_at
        );
    END LOOP;

    -- Process Payments
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                IF v_payment.method = 'STORE_CREDIT' THEN
                    SELECT credit_balance INTO v_customer_credit
                    FROM customers WHERE id = p_customer_id FOR UPDATE;

                    IF v_customer_credit < v_payment.amount THEN
                        RAISE EXCEPTION 'Insufficient store credit balance (Available: ₹%, Requested: ₹%).',
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
                        p_customer_id, 'ORDER_REDEMPTION'::credit_movement_type,
                        -v_payment.amount, v_new_credit_balance, v_invoice_id,
                        'Used store credit for invoice #' || v_invoice_number,
                        v_invoice_created_at
                    );
                END IF;

                INSERT INTO payments (
                    invoice_id, customer_id, amount, method, notes, created_at
                ) VALUES (
                    v_invoice_id, p_customer_id, v_payment.amount, v_payment.method,
                    'Payment for invoice #' || v_invoice_number, v_invoice_created_at
                );
            END IF;
        END LOOP;
    END IF;

    -- Atomic Cheque Creation
    IF p_cheque_details IS NOT NULL AND jsonb_typeof(p_cheque_details) = 'object' THEN
        IF p_customer_id IS NULL THEN
            RAISE EXCEPTION 'Customer is required for Cheque payment.';
        END IF;

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
            v_invoice_id,
            trim(p_cheque_details->>'cheque_number'),
            trim(p_cheque_details->>'bank_name'),
            (p_cheque_details->>'cheque_date')::DATE,
            p_final_total,
            'PENDING',
            v_invoice_created_at
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'total_amount', p_final_total,
        'paid_amount', v_total_paid,
        'due_amount', GREATEST(0.00, p_final_total - v_total_paid)
    );
END;
$$;

-- Drop old update_full_invoice signature to prevent overload collision
DROP FUNCTION IF EXISTS update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB);

-- Step 3: Update update_full_invoice RPC to support atomic cheque recording and preserve cleared cheques
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
                        p_customer_id, 'ORDER_REDEMPTION'::credit_movement_type,
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

GRANT EXECUTE ON FUNCTION clear_customer_cheque(UUID, TEXT, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION process_checkout(UUID, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, TIMESTAMPTZ, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, JSONB) TO authenticated, service_role;
