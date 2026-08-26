-- Migration: 0008_harden_void_rpc.sql (Auditor Hardened V4)
-- Fixes phantom stock on voiding by accounting for all past returns (RESTOCK + DAMAGED).

CREATE OR REPLACE FUNCTION void_invoice(
    p_invoice_id UUID,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_role TEXT; -- Changed from user_role_type to avoid type casting issues with public.get_my_role()
    v_invoice RECORD;
    v_variant RECORD;
    v_past_returned_qty INTEGER;
    v_net_void_restock_qty INTEGER;
BEGIN
    -- 1. Auth & RBAC Check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    v_user_role := public.get_my_role();
    IF v_user_role IS DISTINCT FROM 'ADMIN' THEN
        RAISE EXCEPTION 'Forbidden: Only ADMIN users can void invoices.';
    END IF;

    IF p_invoice_id IS NULL THEN
        RAISE EXCEPTION 'Invoice ID is required.';
    END IF;

    -- 2. Lock & Validate Invoice
    SELECT * INTO v_invoice 
    FROM invoices 
    WHERE id = p_invoice_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found.';
    END IF;

    IF v_invoice.is_voided THEN
        RAISE EXCEPTION 'Invoice is already voided.';
    END IF;

    -- 3. Mark Invoice as Voided
    UPDATE invoices 
    SET is_voided = true, 
        updated_at = NOW() 
    WHERE id = p_invoice_id;

    -- 4. Reverse Stock with Zero-Phantom-Stock Protection
    FOR v_variant IN 
        WITH invoice_items_to_void AS (
            SELECT id AS item_id, variant_id, quantity 
            FROM invoice_items 
            WHERE invoice_id = p_invoice_id
        )
        SELECT 
            v.id AS variant_id, 
            v.stock_quantity, 
            i.quantity, 
            i.item_id
        FROM variants v
        JOIN invoice_items_to_void i ON v.id = i.variant_id
        ORDER BY v.id, i.item_id
        FOR UPDATE OF v
    LOOP
        -- Calculate ALL pieces already handled by returns engine (RESTOCK + DAMAGED)
        SELECT COALESCE(SUM(quantity), 0) INTO v_past_returned_qty
        FROM returns
        WHERE invoice_item_id = v_variant.item_id;

        -- Only restock items that were NOT previously returned/scrapped
        v_net_void_restock_qty := v_variant.quantity - v_past_returned_qty;

        IF v_net_void_restock_qty > 0 THEN
            INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
            VALUES (
                v_variant.item_id, 
                v_variant.variant_id, 
                'VOID_RESTOCK'::stock_movement_type, 
                v_net_void_restock_qty, 
                'Voided Invoice: ' || COALESCE(p_reason, 'No reason provided')
            );

            UPDATE variants 
            SET stock_quantity = stock_quantity + v_net_void_restock_qty,
                updated_at = NOW()
            WHERE id = v_variant.variant_id;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true, 
        'invoice_id', p_invoice_id, 
        'invoice_number', v_invoice.invoice_number
    );
END;
$$;
