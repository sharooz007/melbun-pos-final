-- Migration: 0090_fix_p0_03_invoice_edit_pack_conversion.sql
-- Resolves P0-03: update_full_invoice Drives Packaged Sets Negative on Loose-to-Set Conversion
-- 
-- 1. Un-nests packaged set availability checks for both warehouse and van inventory:
--    Regardless of whether delta_pieces > 0 or delta_pieces <= 0, if delta_sets > 0,
--    available shelf packaged sets are strictly verified before permitting the mutation.
-- 2. Clamps stock_sets and sets_quantity:
--    Guarantees stock_sets and van sets_quantity are non-negative and physically bounded:
--    stock_sets = GREATEST(0, LEAST(COALESCE(stock_sets, 0) - v_delta_sets, FLOOR((stock_quantity - v_delta_pieces)::numeric / v_variant.effective_pps)))
-- 3. Fixes line van inventory branch and audit logging:
--    Ensures loose-to-set conversions (delta_sets > 0) are treated as deductions (SALE_DEDUCT),
--    preventing negative MANUAL_RETURN records in line_stock_movements.
-- 4. Preserves exact 14-parameter signature and return type parity to prevent PostgREST PGRST203 errors.

-- ============================================================================
-- STEP 1: DROP HISTORICAL OVERLOAD SIGNATURES TO PREVENT PGRST203 AMBIGUITY
-- ============================================================================

-- Schema-qualified drops
DROP FUNCTION IF EXISTS public.update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, JSONB, TEXT);

-- Unqualified drops for robust search_path parity
DROP FUNCTION IF EXISTS update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB);
DROP FUNCTION IF EXISTS update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, JSONB);
DROP FUNCTION IF EXISTS update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, JSONB, TEXT);

-- ============================================================================
-- STEP 2: RECREATE AUTHORITATIVE 14-PARAMETER update_full_invoice RPC
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

        SELECT v.*, GREATEST(1, COALESCE(v.pieces_per_set, p.pieces_per_set, 1)) AS effective_pps 
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
        SELECT v.*, GREATEST(1, COALESCE(v.pieces_per_set, p.pieces_per_set, 1)) AS effective_pps 
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

        -- [P0-03 FIX]: Un-nested availability check for pieces and packaged sets
        IF v_invoice.line_staff_id IS NOT NULL THEN
            IF v_delta_pieces > 0 OR v_delta_sets > 0 THEN
                SELECT * INTO v_van_item 
                FROM line_van_inventory 
                WHERE staff_id = v_invoice.line_staff_id AND variant_id = v_variant_delta.variant_id;

                IF v_delta_pieces > 0 AND (NOT FOUND OR v_van_item.quantity < v_delta_pieces) THEN
                    RAISE EXCEPTION 'Insufficient van stock for variant %. Available: %, Additional Required: %',
                        v_variant.name, COALESCE(v_van_item.quantity, 0), v_delta_pieces;
                END IF;

                IF v_delta_sets > 0 AND (NOT FOUND OR COALESCE(v_van_item.sets_quantity, 0) < v_delta_sets) THEN
                    RAISE EXCEPTION 'Insufficient van packaged sets for variant %. Available: %, Additional Required: %',
                        v_variant.name, COALESCE(v_van_item.sets_quantity, 0), v_delta_sets;
                END IF;
            END IF;
        ELSE
            IF v_delta_pieces > 0 THEN
                IF v_variant.stock_quantity < v_delta_pieces THEN
                    RAISE EXCEPTION 'Insufficient warehouse stock for variant %. Available: %, Additional Required: %',
                        v_variant.name, v_variant.stock_quantity, v_delta_pieces;
                END IF;
            END IF;

            IF v_delta_sets > 0 THEN
                IF COALESCE(v_variant.stock_sets, 0) < v_delta_sets THEN
                    RAISE EXCEPTION 'Insufficient warehouse packaged sets for variant %. Available: %, Additional Required: %',
                        v_variant.name, COALESCE(v_variant.stock_sets, 0), v_delta_sets;
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
                -- Deduction or Conversion: delta_pieces > 0 OR delta_sets > 0
                IF v_delta_pieces > 0 OR v_delta_sets > 0 THEN
                    UPDATE line_van_inventory
                    SET quantity = quantity - v_delta_pieces,
                        sets_quantity = GREATEST(0, LEAST(COALESCE(sets_quantity, 0) - v_delta_sets, FLOOR((quantity - v_delta_pieces)::numeric / v_variant.effective_pps))),
                        updated_at = NOW()
                    WHERE staff_id = v_invoice.line_staff_id AND variant_id = v_variant_delta.variant_id;

                    INSERT INTO line_stock_movements (
                        staff_id, variant_id, movement_type, sets_quantity, quantity, notes
                    ) VALUES (
                        v_invoice.line_staff_id, v_variant_delta.variant_id, 'SALE_DEDUCT',
                        v_delta_sets, v_delta_pieces, 'Invoice Edit Adjustment: ' || v_invoice.invoice_number
                    );
                ELSE
                    -- Restoration: delta_pieces <= 0 AND delta_sets <= 0
                    INSERT INTO line_van_inventory (staff_id, variant_id, quantity, sets_quantity, updated_at)
                    VALUES (
                        v_invoice.line_staff_id, 
                        v_variant_delta.variant_id, 
                        -v_delta_pieces, 
                        GREATEST(0, LEAST(-v_delta_sets, FLOOR((-v_delta_pieces)::numeric / v_variant.effective_pps))), 
                        NOW()
                    )
                    ON CONFLICT (staff_id, variant_id) DO UPDATE SET 
                        quantity = line_van_inventory.quantity + EXCLUDED.quantity,
                        sets_quantity = GREATEST(0, LEAST(COALESCE(line_van_inventory.sets_quantity, 0) - v_delta_sets, FLOOR((line_van_inventory.quantity + EXCLUDED.quantity)::numeric / v_variant.effective_pps))),
                        updated_at = NOW();

                    INSERT INTO line_stock_movements (
                        staff_id, variant_id, movement_type, sets_quantity, quantity, notes
                    ) VALUES (
                        v_invoice.line_staff_id, v_variant_delta.variant_id, 'MANUAL_RETURN',
                        -v_delta_sets, -v_delta_pieces, 'Invoice Edit Adjustment: ' || v_invoice.invoice_number
                    );
                END IF;
            ELSE
                -- Warehouse Inventory Mutation: uniformly applied with non-negative physical clamping
                UPDATE variants
                SET stock_quantity = stock_quantity - v_delta_pieces,
                    stock_sets = GREATEST(0, LEAST(COALESCE(stock_sets, 0) - v_delta_sets, FLOOR((stock_quantity - v_delta_pieces)::numeric / v_variant.effective_pps))),
                    updated_at = NOW()
                WHERE id = v_variant_delta.variant_id;

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

-- Grant permissions matching existing migration standards
GRANT EXECUTE ON FUNCTION public.update_full_invoice(UUID, UUID, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, DECIMAL, JSONB, JSONB, JSONB, TEXT) TO authenticated, service_role;
