-- Migration: 0017_purge_all_admin_checks.sql

-- 1. Strip admin check from void_invoice
CREATE OR REPLACE FUNCTION void_invoice(p_invoice_id UUID, p_reason TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_variant RECORD;
    v_past_returned_sets INTEGER;
    v_past_returned_loose INTEGER;
    v_net_void_restock_sets INTEGER;
    v_net_void_restock_loose INTEGER;
    v_net_void_restock_total INTEGER;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Invoice is already voided.'; END IF;

    UPDATE invoices SET is_voided = true, updated_at = NOW() WHERE id = p_invoice_id;

    FOR v_variant IN 
        WITH invoice_items_to_void AS (
            SELECT id AS item_id, variant_id, quantity, sets_quantity, loose_quantity FROM invoice_items WHERE invoice_id = p_invoice_id
        )
        SELECT v.id AS variant_id, i.quantity, i.sets_quantity, i.loose_quantity, i.item_id, pr.pieces_per_set
        FROM variants v 
        JOIN products pr ON v.product_id = pr.id
        JOIN invoice_items_to_void i ON v.id = i.variant_id 
        ORDER BY v.id, i.item_id FOR UPDATE OF v
    LOOP
        -- Calculate ALL pieces already returned
        SELECT 
            COALESCE(SUM(sets_quantity), 0),
            COALESCE(SUM(loose_quantity), 0)
        INTO v_past_returned_sets, v_past_returned_loose
        FROM returns
        WHERE invoice_item_id = v_variant.item_id AND return_type = 'RESTOCK';

        v_net_void_restock_sets := v_variant.sets_quantity - v_past_returned_sets;
        v_net_void_restock_loose := v_variant.loose_quantity - v_past_returned_loose;
        v_net_void_restock_total := v_variant.quantity - ((v_past_returned_sets * v_variant.pieces_per_set) + v_past_returned_loose);

        IF v_net_void_restock_total > 0 THEN
            INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
            VALUES (v_variant.item_id, v_variant.variant_id, 'VOID_RESTOCK'::stock_movement_type, v_net_void_restock_total, 'Voided Invoice: ' || COALESCE(p_reason, 'No reason'));

            UPDATE variants 
            SET stock_quantity = stock_quantity + v_net_void_restock_total,
                stock_sets = stock_sets + v_net_void_restock_sets,
                updated_at = NOW()
            WHERE id = v_variant.variant_id;
        END IF;
    END LOOP;
    
    RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice.invoice_number);
END;
$$;

-- 2. Strip admin check from void_expense
CREATE OR REPLACE FUNCTION void_expense(
    p_expense_id UUID,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_expense RECORD;
    v_void_note TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    IF p_expense_id IS NULL THEN
        RAISE EXCEPTION 'Expense ID is required.';
    END IF;

    -- Fetch & Lock Expense
    SELECT * INTO v_expense 
    FROM expenses 
    WHERE id = p_expense_id 
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Expense not found.';
    END IF;

    IF v_expense.is_voided THEN
        RAISE EXCEPTION 'Expense is already voided.';
    END IF;

    -- Append Void Reason to Notes for Audit Tracing
    v_void_note := COALESCE(v_expense.notes || ' | ', '') || 'VOIDED: ' || COALESCE(NULLIF(trim(p_reason), ''), 'No reason provided');

    -- Soft Delete (Void)
    UPDATE expenses 
    SET is_voided = true, 
        notes = v_void_note,
        updated_at = NOW() 
    WHERE id = p_expense_id;

    -- Record Money Movement for Voided Expense
    INSERT INTO money_movements (type, amount, method, reference_id, reference_type, notes)
    VALUES (
        'IN', 
        v_expense.amount, 
        v_expense.payment_method, 
        p_expense_id, 
        'EXPENSE_VOID',
        'Voided Expense'
    );

    RETURN jsonb_build_object('success', true);
END;
$$;
