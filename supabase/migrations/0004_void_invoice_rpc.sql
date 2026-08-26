-- Phase 4: Invoice Voiding Engine (Hardened V3)

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
    v_user_role TEXT;
    v_invoice RECORD;
    v_variant RECORD;
BEGIN
    -- 1. Auth & RBAC Check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    v_user_role := public.get_my_role();
    
    -- Fixed: SQL Three-Valued Logic Defense (IS DISTINCT FROM safely handles NULLs)
    IF v_user_role IS DISTINCT FROM 'ADMIN' THEN
        RAISE EXCEPTION 'Forbidden: Only ADMIN users can void invoices.';
    END IF;

    IF p_invoice_id IS NULL THEN
        RAISE EXCEPTION 'Invoice ID is required.';
    END IF;

    -- 2. Fetch & Lock Invoice
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

    -- 4. Reverse Stock Movements with Deterministic Locking
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
        -- Log the void restock linked to the original invoice item
        INSERT INTO stock_movements (invoice_item_id, variant_id, type, quantity_change, notes)
        VALUES (
            v_variant.item_id, 
            v_variant.variant_id, 
            'VOID_RESTOCK'::stock_movement_type, 
            v_variant.quantity, 
            'Voided Invoice: ' || COALESCE(p_reason, 'No reason provided')
        );

        -- Restore aggregate stock
        UPDATE variants
        SET stock_quantity = stock_quantity + v_variant.quantity
        WHERE id = v_variant.variant_id;
    END LOOP;

    -- 5. Note: Payments are NOT deleted. They remain in the database for historical 
    -- audit tracing and to support potential "Undo Void" functionality.
    -- Financial reports will explicitly filter out `invoices.is_voided = true`.

    RETURN jsonb_build_object(
        'success', true, 
        'invoice_id', p_invoice_id,
        'invoice_number', v_invoice.invoice_number
    );
END;
$$;
