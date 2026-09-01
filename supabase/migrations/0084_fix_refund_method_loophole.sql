-- Migration 0084: Fix Linked Customer Cash Refund Loophole (Issue #4)
-- Enforces that registered customers must receive refunds as STORE_CREDIT to prevent cash leakage.

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

    v_total_pieces_to_return := (p_sets_quantity * COALESCE(v_product.pieces_per_set, 1)) + p_loose_quantity;
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

    -- Insert Return Record with all required NOT NULL columns (variant_id, processed_by, customer_id)
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

    -- Stock Mutation
    IF p_return_type = 'RESTOCK' THEN
        UPDATE variants 
        SET stock_quantity = stock_quantity + v_total_pieces_to_return,
            stock_sets = stock_sets + p_sets_quantity,
            updated_at = NOW()
        WHERE id = v_variant.id;
        
        v_movement_type := 'RETURN_RESTOCK'::stock_movement_type;
        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
        VALUES (
            v_item.id, v_variant.id, v_movement_type, v_total_pieces_to_return, 
            'Customer Return: ' || v_invoice.invoice_number || COALESCE(' (' || p_notes || ')', '')
        );
    ELSE
        v_movement_type := 'RETURN_DAMAGE'::stock_movement_type;
        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
        VALUES (
            v_item.id, v_variant.id, v_movement_type, 0, 
            'Customer Return (Damaged/Scrapped): ' || v_invoice.invoice_number || COALESCE(' (' || p_notes || ')', '')
        );
    END IF;

    -- Excess Payout / Store Credit Routing
    IF v_incremental_excess > 0 THEN
        -- LINKED CUSTOMER CASH REFUND LOOPHOLE FIX:
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

GRANT EXECUTE ON FUNCTION process_return(UUID, INTEGER, INTEGER, payment_method, TEXT, TEXT) TO authenticated, service_role;
