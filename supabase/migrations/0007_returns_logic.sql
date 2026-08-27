-- Phase 5: Returns Engine (Hardened Implementation)

-- 1. Returns Table Definition
CREATE TABLE returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    invoice_item_id UUID NOT NULL REFERENCES invoice_items(id) ON DELETE RESTRICT,
    variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
    customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_refund_price DECIMAL(10, 2) NOT NULL CHECK (unit_refund_price >= 0),
    total_refund_amount DECIMAL(10, 2) NOT NULL CHECK (total_refund_amount >= 0),
    refund_method payment_method NOT NULL,
    return_type TEXT NOT NULL CHECK (return_type IN ('RESTOCK', 'DAMAGED')),
    notes TEXT,
    processed_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes for fast reporting and aggregation
CREATE INDEX idx_returns_invoice_id ON returns(invoice_id);
CREATE INDEX idx_returns_invoice_item_id ON returns(invoice_item_id);
CREATE INDEX idx_returns_variant_id ON returns(variant_id);

-- 3. RLS Policies
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read for authenticated users" ON returns FOR SELECT TO authenticated USING (true);

-- 4. Process Return RPC (Atomic, Concurrency Safe)
CREATE OR REPLACE FUNCTION process_return(
    p_invoice_item_id UUID,
    p_quantity INTEGER,
    p_refund_method payment_method,
    p_return_type TEXT,
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_item RECORD;
    v_variant RECORD;
    v_past_returned_qty INTEGER := 0;
    v_remaining_returnable INTEGER;
    v_unit_price DECIMAL(10,2);
    v_total_refund DECIMAL(10,2);
    v_return_id UUID;
    v_movement_type stock_movement_type;
BEGIN
    -- Auth Verification
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Return quantity must be greater than zero.';
    END IF;

    IF p_return_type NOT IN ('RESTOCK', 'DAMAGED') THEN
        RAISE EXCEPTION 'Invalid return type. Must be RESTOCK or DAMAGED.';
    END IF;

    -- 1. Lock the line item to prevent concurrent return race conditions
    SELECT * INTO v_item FROM invoice_items WHERE id = p_invoice_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice line item not found.';
    END IF;

    -- 2. Lock the parent invoice to verify it is not voided
    SELECT * INTO v_invoice FROM invoices WHERE id = v_item.invoice_id FOR UPDATE;
    IF v_invoice.is_voided THEN
        RAISE EXCEPTION 'Cannot process return: The invoice has been completely voided.';
    END IF;

    -- 3. Lock the variant for stock modification
    SELECT * INTO v_variant FROM variants WHERE id = v_item.variant_id FOR UPDATE;

    -- 4. Mathematical Verification: Calculate ceiling
    SELECT COALESCE(SUM(quantity), 0) INTO v_past_returned_qty
    FROM returns
    WHERE invoice_item_id = p_invoice_item_id;

    v_remaining_returnable := v_item.quantity - v_past_returned_qty;

    IF p_quantity > v_remaining_returnable THEN
        RAISE EXCEPTION 'Over-return blocked! Original qty: %, Already returned: %, Requested: %', v_item.quantity, v_past_returned_qty, p_quantity;
    END IF;

    -- 5. Financial Ledger Integration
    -- The refund is based on the snapshot price they originally paid
    v_unit_price := v_item.selling_price_snapshot;
    v_total_refund := v_unit_price * p_quantity;

    INSERT INTO returns (
        invoice_id, invoice_item_id, variant_id, customer_id, 
        quantity, unit_refund_price, total_refund_amount, 
        refund_method, return_type, notes, processed_by
    ) VALUES (
        v_invoice.id, v_item.id, v_variant.id, v_invoice.customer_id,
        p_quantity, v_unit_price, v_total_refund,
        p_refund_method, p_return_type, p_notes, v_user_id
    ) RETURNING id INTO v_return_id;

    -- Record outbound refund payment (negative amount) so cash drawer drops and dashboard is accurate
    IF v_total_refund > 0 THEN
        INSERT INTO payments (invoice_id, customer_id, amount, method)
        VALUES (v_invoice.id, v_invoice.customer_id, -v_total_refund, p_refund_method);
    END IF;

    -- 6. Stock Ledger Integration
    IF p_return_type = 'RESTOCK' THEN
        -- Add physical inventory back
        UPDATE variants 
        SET stock_quantity = stock_quantity + p_quantity,
            updated_at = NOW()
        WHERE id = v_variant.id;
        
        v_movement_type := 'RETURN_RESTOCK';
        
        INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
        VALUES (v_variant.id, v_movement_type, p_quantity, 'Return ID: ' || v_return_id || ' Invoice: ' || v_invoice.id);
    ELSE
        -- Damaged scrap. Log movement but do NOT increment sellable variant stock
        v_movement_type := 'RETURN_DAMAGE';
        INSERT INTO stock_movements (variant_id, type, quantity_change, notes)
        VALUES (v_variant.id, v_movement_type, 0, 'Return ID: ' || v_return_id || ' Invoice: ' || v_invoice.id || ' (DAMAGED SCRAP)');
    END IF;

    RETURN jsonb_build_object(
        'success', true, 
        'return_id', v_return_id,
        'refund_amount', v_total_refund
    );
END;
$$;
