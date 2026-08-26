-- Migration: 0037_harden_credit_returns.sql
-- Fixes Cash Drawer Leak for Credit Returns by capping cash refunds to actual net paid amount.

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
    
    v_net_paid DECIMAL(10,2) := 0;
    v_cash_refund DECIMAL(10,2) := 0;
BEGIN
    -- 1. Authentication Check
    IF v_user_id IS NULL THEN 
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; 
    END IF;

    -- 2. Input Boundary Defense
    IF p_sets_quantity < 0 OR p_loose_quantity < 0 THEN 
        RAISE EXCEPTION 'Return quantities cannot be negative.'; 
    END IF;

    IF p_return_type NOT IN ('RESTOCK', 'DAMAGED') THEN 
        RAISE EXCEPTION 'Invalid return type. Must be RESTOCK or DAMAGED.'; 
    END IF;

    -- 3. Lock Records in Order
    SELECT * INTO v_item FROM invoice_items WHERE id = p_invoice_item_id FOR UPDATE;
    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Invoice line item not found.'; 
    END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = v_item.invoice_id FOR UPDATE;
    IF NOT FOUND THEN 
        RAISE EXCEPTION 'Associated invoice not found.'; 
    END IF;

    IF v_invoice.is_voided THEN 
        RAISE EXCEPTION 'Cannot process return: The invoice has been completely voided.'; 
    END IF;

    SELECT * INTO v_variant FROM variants WHERE id = v_item.variant_id FOR UPDATE;
    SELECT * INTO v_product FROM products WHERE id = v_variant.product_id;

    -- 4. Dual Inventory Quantity Calculations & Ceiling Checks
    v_total_pieces_to_return := (p_sets_quantity * COALESCE(v_product.pieces_per_set, 1)) + p_loose_quantity;
    IF v_total_pieces_to_return <= 0 THEN 
        RAISE EXCEPTION 'Total return pieces must be greater than zero.'; 
    END IF;

    -- Authoritative past return pieces and sets check
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

    -- Prevent phantom set creation: cannot return more sets than originally purchased and remaining
    v_remaining_returnable_sets := v_item.sets_quantity - v_past_returned_sets;
    IF p_sets_quantity > v_remaining_returnable_sets THEN
        RAISE EXCEPTION 'Cannot return % packaged set(s). Only % packaged set(s) were originally purchased on this line item.',
            p_sets_quantity, v_remaining_returnable_sets;
    END IF;

    -- 5. Hardened Financial Ledger Integration & Proration Math
    IF v_invoice.subtotal > 0 AND v_invoice.final_total > 0 THEN
        v_invoice_effective_ratio := v_invoice.final_total / v_invoice.subtotal;
    ELSE
        v_invoice_effective_ratio := 0.0;
    END IF;

    -- Raw prorated total for this return chunk
    v_total_refund := ROUND(v_item.selling_price_snapshot * v_total_pieces_to_return * v_invoice_effective_ratio, 2);

    -- Cap by item-level prorated maximum
    v_item_max_refundable := ROUND(v_item.selling_price_snapshot * v_item.quantity * v_invoice_effective_ratio, 2);
    IF (v_item_past_refunds + v_total_refund) > v_item_max_refundable THEN
        v_total_refund := GREATEST(0.00, v_item_max_refundable - v_item_past_refunds);
    END IF;

    -- Cap by invoice-level remaining final_total
    SELECT COALESCE(SUM(total_refund_amount), 0)
    INTO v_invoice_past_refunds
    FROM returns
    WHERE invoice_id = v_invoice.id;

    v_invoice_remaining_refundable := GREATEST(0.00, v_invoice.final_total - v_invoice_past_refunds);
    IF v_total_refund > v_invoice_remaining_refundable THEN
        v_total_refund := v_invoice_remaining_refundable;
    END IF;

    -- Derive effective per-piece refund price
    IF v_total_pieces_to_return > 0 THEN
        v_prorated_unit_price := ROUND(v_total_refund / v_total_pieces_to_return, 2);
    ELSE
        v_prorated_unit_price := 0.00;
    END IF;

    -- 6. Insert Return Record
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

    -- 7. Record Negative Payment Outflow (Credit Guarded)
    -- Exploit Fix: Do not refund CASH to a customer who never paid it.
    SELECT COALESCE(SUM(amount), 0) INTO v_net_paid FROM payments WHERE invoice_id = v_invoice.id;
    
    v_cash_refund := LEAST(v_total_refund, v_net_paid);

    IF v_cash_refund > 0 THEN
        INSERT INTO payments (invoice_id, customer_id, amount, method)
        VALUES (v_invoice.id, v_invoice.customer_id, -v_cash_refund, p_refund_method);
    END IF;

    -- 8. Stock Ledger & Dual Inventory Mutation
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
        'unit_refund_price', v_prorated_unit_price,
        'pieces_returned', v_total_pieces_to_return,
        'sets_returned', p_sets_quantity,
        'cash_refunded', v_cash_refund
    );
END;
$$;
GRANT EXECUTE ON FUNCTION process_return(UUID, INTEGER, INTEGER, payment_method, TEXT, TEXT) TO authenticated, service_role;
