-- Migration: 0086_fix_p0_returns_pack_size_and_invoice_edit_stock_audit.sql
-- Resolves:
-- 1. P0 Bug: Fix pack size divisor regression in process_return RPC (prioritize variant pieces_per_set over product)
-- 2. P0 Bug: Populate sets_change and loose_change on stock_movements in process_return
-- 3. P0 Bug: Eliminate destructive stock movement deletion & FK nullification in update_full_invoice RPC
-- 4. P0 Bug: Implement append-only compensating delta audit movements ('MANUAL_ADJUST' / 'Invoice Edit Adjustment: ...')
-- 5. P0 Bug: Preserve invoice_items in-place during invoice edit to maintain foreign key integrity
-- 6. P0 Bug: Route van sales edits to line_van_inventory and line_stock_movements when line_staff_id IS NOT NULL

-- ============================================================================
-- STEP 1: DROP ALL HISTORICAL OVERLOAD SIGNATURES
-- ============================================================================

-- Drop all historical overloads of process_return
DROP FUNCTION IF EXISTS public.process_return(UUID, INTEGER, payment_method, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.process_return(UUID, INTEGER, INTEGER, payment_method, TEXT, TEXT);
DROP FUNCTION IF EXISTS process_return(UUID, INTEGER, payment_method, TEXT, TEXT);
DROP FUNCTION IF EXISTS process_return(UUID, INTEGER, INTEGER, payment_method, TEXT, TEXT);

-- Drop all historical overloads of update_full_invoice
DROP FUNCTION IF EXISTS public.update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, JSONB, TEXT);
DROP FUNCTION IF EXISTS update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB);
DROP FUNCTION IF EXISTS update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, JSONB);
DROP FUNCTION IF EXISTS update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, JSONB, TEXT);

-- ============================================================================
-- STEP 2: RECREATE process_return WITH PACK SIZE & DUAL LEDGER FIX
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_return(
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
    v_pps INTEGER;
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

    -- 1. Standardize lock order: Lock invoices FIRST, then invoice_items (Prevents Deadlock with update_full_invoice)
    SELECT invoice_id INTO v_invoice_id FROM invoice_items WHERE id = p_invoice_item_id;
    IF v_invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice line item not found.'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = v_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Associated invoice not found.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Cannot process return: The invoice has been completely voided.'; END IF;

    SELECT * INTO v_item FROM invoice_items WHERE id = p_invoice_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice line item not found.'; END IF;

    SELECT * INTO v_variant FROM variants WHERE id = v_item.variant_id FOR UPDATE;
    SELECT * INTO v_product FROM products WHERE id = v_variant.product_id;

    -- FIX (P0 Issue 1): Prioritize variant pieces_per_set over product pieces_per_set with safe lower bound of 1
    v_pps := GREATEST(COALESCE(v_variant.pieces_per_set, v_product.pieces_per_set, 1), 1);
    v_total_pieces_to_return := (p_sets_quantity * v_pps) + p_loose_quantity;
    IF v_total_pieces_to_return <= 0 THEN 
        RAISE EXCEPTION 'Total return pieces must be greater than zero.'; 
    END IF;

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

    v_remaining_returnable_sets := COALESCE(v_item.sets_quantity, 0) - v_past_returned_sets;
    IF p_sets_quantity > v_remaining_returnable_sets THEN
        RAISE EXCEPTION 'Cannot return % packaged set(s). Only % packaged set(s) were originally purchased on this line item.',
            p_sets_quantity, v_remaining_returnable_sets;
    END IF;

    -- Proration calculation without rounding drift
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

    -- Insert Return Record with all required columns
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

    -- Incremental Excess Payment Calculation
    v_old_effective_total := GREATEST(0.00, v_invoice.final_total - v_invoice_past_refunds);
    v_new_effective_total := GREATEST(0.00, v_invoice.final_total - (v_invoice_past_refunds + v_total_refund));
    
    SELECT COALESCE(SUM(amount), 0.00) INTO v_net_paid 
    FROM payments WHERE invoice_id = v_invoice.id;

    v_incremental_excess := GREATEST(0.00, LEAST(v_net_paid, v_old_effective_total) - v_new_effective_total);

    -- Stock Mutation & Dual Inventory Ledger Tracking (FIX: sets_change & loose_change populated)
    IF p_return_type = 'RESTOCK' THEN
        UPDATE variants 
        SET stock_quantity = stock_quantity + v_total_pieces_to_return,
            stock_sets = stock_sets + p_sets_quantity,
            updated_at = NOW()
        WHERE id = v_variant.id;
        
        v_movement_type := 'RETURN_RESTOCK'::stock_movement_type;
        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, sets_change, loose_change, notes)
        VALUES (
            v_item.id, v_variant.id, v_movement_type, v_total_pieces_to_return, p_sets_quantity, p_loose_quantity,
            'Customer Return: ' || v_invoice.invoice_number || COALESCE(' (' || p_notes || ')', '')
        );
    ELSE
        v_movement_type := 'RETURN_DAMAGE'::stock_movement_type;
        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, sets_change, loose_change, notes)
        VALUES (
            v_item.id, v_variant.id, v_movement_type, 0, 0, 0,
            'Customer Return (Damaged/Scrapped): ' || v_invoice.invoice_number || COALESCE(' (' || p_notes || ')', '')
        );
    END IF;

    -- Excess Payout / Store Credit Routing
    IF v_incremental_excess > 0 THEN
        -- LINKED CUSTOMER CASH REFUND LOOPHOLE PROTECTION:
        IF v_invoice.customer_id IS NOT NULL AND p_refund_method != 'STORE_CREDIT' THEN
            RAISE EXCEPTION 'Refunds for registered customers must be issued as STORE_CREDIT.';
        END IF;

        IF p_refund_method = 'STORE_CREDIT' THEN
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
                'RETURN_CREDIT'::credit_movement_type,
                v_incremental_excess,
                v_new_credit_balance,
                v_invoice.id,
                'Store credit from return on Invoice ' || v_invoice.invoice_number
            );

            INSERT INTO payments (invoice_id, customer_id, amount, method)
            VALUES (v_invoice.id, v_invoice.customer_id, -v_incremental_excess, 'STORE_CREDIT'::payment_method);
        ELSE
            INSERT INTO payments (invoice_id, customer_id, amount, method)
            VALUES (v_invoice.id, v_invoice.customer_id, -v_incremental_excess, p_refund_method);
        END IF;
    END IF;

    -- Return standardized JSON matching ReturnsClient.tsx and ProcessReturnResult contract
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

GRANT EXECUTE ON FUNCTION public.process_return(UUID, INTEGER, INTEGER, payment_method, TEXT, TEXT) TO authenticated, service_role;

-- ============================================================================
-- STEP 3: RECREATE update_full_invoice WITH APPEND-ONLY COMPENSATING MOVEMENTS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_full_invoice(
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
    p_cheque_details JSONB DEFAULT NULL,
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
    v_payment RECORD;
    v_variant RECORD;
    v_van_item RECORD;
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
    v_current_item_id UUID;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    v_invoice_created_at TIMESTAMPTZ;
    v_existing_cheque_id UUID;
    
    v_variant_delta RECORD;
    v_new_pieces INTEGER;
    v_delta_pieces INTEGER;
    v_delta_sets INTEGER;
    v_delta_loose INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_invoice_id IS NULL THEN RAISE EXCEPTION 'Invoice ID is required.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart cannot be empty.'; END IF;
    IF p_subtotal < 0 OR p_discount_amount < 0 OR p_final_total < 0 THEN
        RAISE EXCEPTION 'Financial values cannot be negative.';
    END IF;

    -- 1. Financial Bounds Checks
    IF p_discount_amount > p_subtotal THEN
        RAISE EXCEPTION 'Discount amount (₹%) cannot exceed subtotal (₹%).', p_discount_amount, p_subtotal;
    END IF;

    IF p_round_off < -50.00 OR p_round_off > 50.00 THEN
        RAISE EXCEPTION 'Round off (₹%) must be between -₹50.00 and +₹50.00.', p_round_off;
    END IF;

    -- 2. Lock invoice
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_invoice.is_hidden THEN RAISE EXCEPTION 'Cannot edit a permanently deleted invoice.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Cannot edit a voided invoice (Undo void first).'; END IF;

    -- 3. Foreign Key & Return Integrity Guard
    IF EXISTS (SELECT 1 FROM returns WHERE invoice_id = p_invoice_id) THEN
        RAISE EXCEPTION 'Cannot edit cart on an invoice that has returns processed. Please void or adjust returns first.';
    END IF;

    -- 4. Timestamp validations
    v_invoice_created_at := COALESCE(p_created_at, v_invoice.created_at);
    IF v_invoice_created_at > (NOW() + INTERVAL '1 day') THEN
        RAISE EXCEPTION 'Invoice date cannot be in the future.';
    END IF;

    -- 5. Prevent duplicate variants in new items
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in items. Please consolidate quantities.';
    END IF;

    -- 6. Calculate total paid and validate customer credit rules
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

    -- Walk-in credit check
    IF p_customer_id IS NULL AND v_total_paid < p_final_total THEN
        RAISE EXCEPTION 'Customer is required for credit/partial credit sales.';
    END IF;

    -- Verify active customer if provided
    IF p_customer_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND is_active = TRUE) THEN
            RAISE EXCEPTION 'Customer does not exist or is inactive.';
        END IF;
    END IF;

    -- 7. Deterministic Locking of Variants / Line Van Inventory
    IF v_invoice.line_staff_id IS NOT NULL THEN
        PERFORM 1 FROM line_van_inventory lvi
        WHERE lvi.staff_id = v_invoice.line_staff_id
          AND lvi.variant_id IN (
              SELECT variant_id FROM invoice_items WHERE invoice_id = p_invoice_id
              UNION
              SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x
          )
        ORDER BY lvi.variant_id FOR UPDATE;
    ELSE
        PERFORM 1 FROM variants v
        WHERE v.id IN (
            SELECT variant_id FROM invoice_items WHERE invoice_id = p_invoice_id
            UNION
            SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x
        )
        ORDER BY v.id FOR UPDATE OF v;
    END IF;

    -- 8. Validate Stock, Anti-Tampering, & Calculate Subtotal
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

    -- 9. APPEND-ONLY COMPENSATING MOVEMENTS & IN-PLACE INVOICE ITEM RECONCILIATION
    -- (Destructive DELETE FROM stock_movements & UPDATE stock_movements SET invoice_item_id = NULL ELIMINATED)
    FOR v_variant_delta IN
        WITH old_items AS (
            SELECT 
                ii.variant_id,
                ii.id AS item_id,
                ii.quantity AS pieces,
                COALESCE(ii.sets_quantity, 0) AS sets,
                COALESCE(ii.loose_quantity, 0) AS loose
            FROM invoice_items ii
            WHERE ii.invoice_id = p_invoice_id
        ),
        new_items_raw AS (
            SELECT 
                (x->>'variant_id')::UUID AS variant_id,
                COALESCE((x->>'sets_quantity')::INT, 0) AS sets,
                COALESCE((x->>'loose_quantity')::INT, 0) AS loose,
                (x->>'selling_price')::DECIMAL AS selling_price
            FROM jsonb_array_elements(p_items) AS x
        ),
        all_variants AS (
            SELECT variant_id FROM old_items
            UNION
            SELECT variant_id FROM new_items_raw
        )
        SELECT 
            av.variant_id,
            oi.item_id AS old_item_id,
            COALESCE(oi.pieces, 0) AS old_pieces,
            COALESCE(oi.sets, 0) AS old_sets,
            COALESCE(oi.loose, 0) AS old_loose,
            COALESCE(ni.sets, 0) AS new_sets,
            COALESCE(ni.loose, 0) AS new_loose,
            ni.selling_price AS new_selling_price,
            (ni.variant_id IS NOT NULL) AS in_new
        FROM all_variants av
        LEFT JOIN old_items oi ON av.variant_id = oi.variant_id
        LEFT JOIN new_items_raw ni ON av.variant_id = ni.variant_id
        ORDER BY av.variant_id
    LOOP
        SELECT v.*, COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps 
        INTO v_variant 
        FROM variants v JOIN products p ON v.product_id = p.id 
        WHERE v.id = v_variant_delta.variant_id;

        IF v_variant_delta.in_new THEN
            v_new_pieces := (v_variant_delta.new_sets * v_variant.effective_pps) + v_variant_delta.new_loose;
        ELSE
            v_new_pieces := 0;
        END IF;

        v_delta_pieces := v_new_pieces - v_variant_delta.old_pieces;
        v_delta_sets := v_variant_delta.new_sets - v_variant_delta.old_sets;
        v_delta_loose := v_variant_delta.new_loose - v_variant_delta.old_loose;

        -- Check availability if additional stock is demanded from inventory
        IF v_delta_pieces > 0 THEN
            IF v_invoice.line_staff_id IS NOT NULL THEN
                SELECT * INTO v_van_item 
                FROM line_van_inventory 
                WHERE staff_id = v_invoice.line_staff_id AND variant_id = v_variant_delta.variant_id;

                IF NOT FOUND OR v_van_item.quantity < v_delta_pieces THEN
                    RAISE EXCEPTION 'Insufficient van stock for variant %. Available: %, Additional Required: %',
                        v_variant.name, COALESCE(v_van_item.quantity, 0), v_delta_pieces;
                END IF;

                IF v_delta_sets > 0 AND v_van_item.sets_quantity < v_delta_sets THEN
                    RAISE EXCEPTION 'Insufficient van packaged sets for variant %. Available: %, Additional Required: %',
                        v_variant.name, v_van_item.sets_quantity, v_delta_sets;
                END IF;
            ELSE
                IF v_variant.stock_quantity < v_delta_pieces THEN
                    RAISE EXCEPTION 'Insufficient warehouse stock for variant %. Available: %, Additional Required: %',
                        v_variant.name, v_variant.stock_quantity, v_delta_pieces;
                END IF;

                IF v_delta_sets > 0 AND v_variant.stock_sets < v_delta_sets THEN
                    RAISE EXCEPTION 'Insufficient warehouse packaged sets for variant %. Available: %, Additional Required: %',
                        v_variant.name, v_variant.stock_sets, v_delta_sets;
                END IF;
            END IF;
        END IF;

        -- In-place update or reconcile invoice_items (Preserves existing item ID & prevents FK nullification)
        IF v_variant_delta.in_new THEN
            v_line_subtotal := v_new_pieces * v_variant.selling_price;
            v_line_cogs := v_new_pieces * v_variant.cost_price;
            v_line_profit := v_line_subtotal - v_line_cogs;

            IF v_variant_delta.old_item_id IS NOT NULL THEN
                UPDATE invoice_items SET
                    quantity = v_new_pieces,
                    sets_quantity = v_variant_delta.new_sets,
                    loose_quantity = v_variant_delta.new_loose,
                    selling_price_snapshot = v_variant.selling_price,
                    cost_price_snapshot = v_variant.cost_price,
                    profit_snapshot = v_line_profit
                WHERE id = v_variant_delta.old_item_id;
                v_current_item_id := v_variant_delta.old_item_id;
            ELSE
                INSERT INTO invoice_items (
                    invoice_id, variant_id, quantity, sets_quantity, loose_quantity,
                    selling_price_snapshot, cost_price_snapshot, profit_snapshot,
                    created_at
                ) VALUES (
                    p_invoice_id, v_variant_delta.variant_id, v_new_pieces,
                    v_variant_delta.new_sets, v_variant_delta.new_loose,
                    v_variant.selling_price, v_variant.cost_price, v_line_profit,
                    v_invoice_created_at
                ) RETURNING id INTO v_current_item_id;
            END IF;
        ELSE
            DELETE FROM invoice_items WHERE id = v_variant_delta.old_item_id;
            v_current_item_id := NULL;
        END IF;

        -- Apply inventory mutation and record append-only compensating movement if delta != 0
        IF v_delta_pieces <> 0 OR v_delta_sets <> 0 OR v_delta_loose <> 0 THEN
            IF v_invoice.line_staff_id IS NOT NULL THEN
                IF v_delta_pieces > 0 THEN
                    UPDATE line_van_inventory
                    SET quantity = quantity - v_delta_pieces,
                        sets_quantity = GREATEST(0, sets_quantity - v_delta_sets),
                        updated_at = NOW()
                    WHERE staff_id = v_invoice.line_staff_id AND variant_id = v_variant_delta.variant_id;

                    INSERT INTO line_stock_movements (
                        staff_id, variant_id, movement_type, sets_quantity, quantity, notes
                    ) VALUES (
                        v_invoice.line_staff_id, v_variant_delta.variant_id, 'SALE_DEDUCT',
                        v_delta_sets, v_delta_pieces, 'Invoice Edit Adjustment: ' || v_invoice.invoice_number
                    );
                ELSE
                    INSERT INTO line_van_inventory (staff_id, variant_id, quantity, sets_quantity, updated_at)
                    VALUES (v_invoice.line_staff_id, v_variant_delta.variant_id, -v_delta_pieces, -v_delta_sets, NOW())
                    ON CONFLICT (staff_id, variant_id) DO UPDATE SET 
                        quantity = line_van_inventory.quantity + EXCLUDED.quantity,
                        sets_quantity = line_van_inventory.sets_quantity + EXCLUDED.sets_quantity,
                        updated_at = NOW();

                    INSERT INTO line_stock_movements (
                        staff_id, variant_id, movement_type, sets_quantity, quantity, notes
                    ) VALUES (
                        v_invoice.line_staff_id, v_variant_delta.variant_id, 'MANUAL_RETURN',
                        -v_delta_sets, -v_delta_pieces, 'Invoice Edit Adjustment: ' || v_invoice.invoice_number
                    );
                END IF;
            ELSE
                IF v_delta_pieces > 0 THEN
                    UPDATE variants
                    SET stock_quantity = stock_quantity - v_delta_pieces,
                        stock_sets = GREATEST(0, LEAST(stock_sets - v_delta_sets, FLOOR((stock_quantity - v_delta_pieces)::numeric / v_variant.effective_pps))),
                        updated_at = NOW()
                    WHERE id = v_variant_delta.variant_id;
                ELSE
                    UPDATE variants
                    SET stock_quantity = stock_quantity - v_delta_pieces,
                        stock_sets = stock_sets - v_delta_sets,
                        updated_at = NOW()
                    WHERE id = v_variant_delta.variant_id;
                END IF;

                INSERT INTO stock_movements (
                    variant_id, invoice_item_id, type, quantity_change,
                    sets_change, loose_change, notes, created_at
                ) VALUES (
                    v_variant_delta.variant_id, v_current_item_id, 'MANUAL_ADJUST'::stock_movement_type,
                    -v_delta_pieces, -v_delta_sets, -v_delta_loose,
                    'Invoice Edit Adjustment: ' || v_invoice.invoice_number, NOW()
                );
            END IF;
        END IF;
    END LOOP;

    -- 10. Reconcile Store Credit
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

    -- 11. Update Invoice Header
    UPDATE invoices SET
        customer_id = p_customer_id,
        subtotal = v_calculated_subtotal,
        discount_amount = p_discount_amount,
        round_off = p_round_off,
        gst_applied = p_gst_applied,
        cgst_amount = v_expected_cgst,
        sgst_amount = v_expected_sgst,
        final_total = p_final_total,
        notes = COALESCE(NULLIF(trim(p_notes), ''), v_invoice.notes),
        created_at = v_invoice_created_at,
        updated_at = NOW()
    WHERE id = p_invoice_id;

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

    -- 13. Atomic Cheque Update/Create
    IF p_cheque_details IS NOT NULL AND jsonb_typeof(p_cheque_details) = 'object' AND p_cheque_details->>'cheque_number' IS NOT NULL THEN
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

GRANT EXECUTE ON FUNCTION public.update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, JSONB, TEXT) TO authenticated, service_role;
