-- Migration: 0071_line_sales_engine.sql
-- Implements the Perpetual Line Sales (Van Sales) Engine:
-- 1. Extend stock_movement_type enum with LINE_DISPATCH and LINE_RESTOCK
-- 2. Create line_staff, line_van_inventory, line_stock_movements, line_dummy_invoices tables
-- 3. dispatch_stock_to_line_staff RPC (Transfers stock from main warehouse to van with deterministic locking)
-- 4. bill_line_staff_sales RPC (Generates Normal non-GST invoice, deducts van stock, handles store credit ledger & overpayment bounds)
-- 5. return_line_van_stock RPC (Restocks van stock to main warehouse with dual-inventory set clamping and Put Back All support)

-- 1. Extend stock_movement_type enum
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'LINE_DISPATCH';
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'LINE_RESTOCK';

-- 2. Line Staff Table
CREATE TABLE IF NOT EXISTS line_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT,
    route_name TEXT,
    customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_staff_active ON line_staff(is_active);

-- 3. Line Van Inventory Table
CREATE TABLE IF NOT EXISTS line_van_inventory (
    staff_id UUID NOT NULL REFERENCES line_staff(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    sets_quantity INTEGER NOT NULL DEFAULT 0 CHECK (sets_quantity >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (staff_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_line_van_inventory_staff ON line_van_inventory(staff_id);

-- 4. Line Stock Movements Audit Table
CREATE TABLE IF NOT EXISTS line_stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES line_staff(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('DISPATCH', 'SALE_DEDUCT', 'MANUAL_RETURN', 'PUT_BACK_ALL')),
    sets_quantity INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_stock_movements_staff ON line_stock_movements(staff_id, created_at DESC);

-- 5. Line Dummy Invoices (Road Proforma Bills) Table
CREATE TABLE IF NOT EXISTS line_dummy_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES line_staff(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    shop_name TEXT NOT NULL,
    shop_phone TEXT,
    items JSONB NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    gst_applied BOOLEAN NOT NULL DEFAULT FALSE,
    final_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_line_dummy_invoices_staff ON line_dummy_invoices(staff_id, created_at DESC);

-- Enable RLS & Grants
ALTER TABLE line_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_van_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_dummy_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users full access to line_staff" ON line_staff FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Authenticated users full access to line_van_inventory" ON line_van_inventory FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Authenticated users full access to line_stock_movements" ON line_stock_movements FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "Authenticated users full access to line_dummy_invoices" ON line_dummy_invoices FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

GRANT ALL ON line_staff TO authenticated, service_role;
GRANT ALL ON line_van_inventory TO authenticated, service_role;
GRANT ALL ON line_stock_movements TO authenticated, service_role;
GRANT ALL ON line_dummy_invoices TO authenticated, service_role;

-- 6. Dispatch Stock to Line Staff RPC
CREATE OR REPLACE FUNCTION dispatch_stock_to_line_staff(
    p_staff_id UUID,
    p_items JSONB,
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_staff RECORD;
    v_item RECORD;
    v_variant RECORD;
    v_pps INTEGER;
    v_total_pieces INTEGER;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    v_dispatched_count INTEGER := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_staff_id IS NULL THEN RAISE EXCEPTION 'Staff ID is required.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Dispatch items list cannot be empty.'; END IF;

    -- Duplicate variants guard
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in dispatch items. Please consolidate quantities.';
    END IF;

    -- 1. Lock Staff
    SELECT * INTO v_staff FROM line_staff WHERE id = p_staff_id AND is_active = TRUE FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active line staff member not found.'; END IF;

    -- 2. Lock involved variants in deterministic ascending UUID order
    PERFORM 1 FROM variants v
    WHERE v.id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x)
    ORDER BY v.id FOR UPDATE OF v;

    -- 3. Process each dispatch item
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID,
        sets_quantity INTEGER,
        loose_quantity INTEGER
    )
    LOOP
        IF COALESCE(v_item.sets_quantity, 0) < 0 OR COALESCE(v_item.loose_quantity, 0) < 0 THEN
            RAISE EXCEPTION 'Dispatch quantities cannot be negative.';
        END IF;

        SELECT v.*, COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps
        INTO v_variant
        FROM variants v
        JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;

        IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found: %', v_item.variant_id; END IF;

        v_pps := v_variant.effective_pps;
        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_pps) + COALESCE(v_item.loose_quantity, 0);

        IF v_total_pieces <= 0 THEN RAISE EXCEPTION 'Dispatch quantity must be greater than 0 for variant %', v_variant.name; END IF;

        -- Stock availability check
        IF v_variant.stock_quantity < v_total_pieces THEN
            RAISE EXCEPTION 'Insufficient main warehouse stock for %. Available: % pcs, Requested: % pcs',
                v_variant.name, v_variant.stock_quantity, v_total_pieces;
        END IF;

        IF COALESCE(v_item.sets_quantity, 0) > v_variant.stock_sets THEN
            RAISE EXCEPTION 'Insufficient packaged sets for %. Available: % sets, Requested: % sets',
                v_variant.name, v_variant.stock_sets, v_item.sets_quantity;
        END IF;

        -- Deduct from Main Warehouse
        UPDATE variants
        SET stock_quantity = stock_quantity - v_total_pieces,
            stock_sets = stock_sets - COALESCE(v_item.sets_quantity, 0),
            updated_at = NOW()
        WHERE id = v_item.variant_id;

        -- Log Main Stock Movement
        INSERT INTO stock_movements (
            variant_id,
            type,
            quantity_change,
            notes,
            created_at
        ) VALUES (
            v_item.variant_id,
            'LINE_DISPATCH'::stock_movement_type,
            -v_total_pieces,
            COALESCE(p_notes, 'Dispatched to Line Staff: ' || v_staff.name || ' (' || COALESCE(v_item.sets_quantity, 0) || ' sets, ' || COALESCE(v_item.loose_quantity, 0) || ' loose)'),
            NOW()
        );

        -- Upsert into Line Van Inventory
        INSERT INTO line_van_inventory (staff_id, variant_id, quantity, sets_quantity, updated_at)
        VALUES (p_staff_id, v_item.variant_id, v_total_pieces, COALESCE(v_item.sets_quantity, 0), NOW())
        ON CONFLICT (staff_id, variant_id) DO UPDATE
        SET quantity = line_van_inventory.quantity + EXCLUDED.quantity,
            sets_quantity = line_van_inventory.sets_quantity + EXCLUDED.sets_quantity,
            updated_at = NOW();

        -- Log Line Stock Movement
        INSERT INTO line_stock_movements (
            staff_id,
            variant_id,
            movement_type,
            sets_quantity,
            quantity,
            notes,
            created_at
        ) VALUES (
            p_staff_id,
            v_item.variant_id,
            'DISPATCH',
            COALESCE(v_item.sets_quantity, 0),
            v_total_pieces,
            COALESCE(p_notes, 'Stock Loaded into Van'),
            NOW()
        );

        v_dispatched_count := v_dispatched_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'staff_id', p_staff_id,
        'dispatched_items_count', v_dispatched_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION dispatch_stock_to_line_staff(UUID, JSONB, TEXT) TO authenticated, service_role;

-- 7. Bill Line Staff Sales RPC (Normal Non-GST Invoice billed to Linesman)
CREATE OR REPLACE FUNCTION bill_line_staff_sales(
    p_staff_id UUID,
    p_items JSONB,
    p_payments JSONB DEFAULT '[]'::jsonb,
    p_discount_amount DECIMAL DEFAULT 0.00,
    p_round_off DECIMAL DEFAULT 0.00,
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_staff RECORD;
    v_customer RECORD;
    v_customer_id UUID;
    v_van_item RECORD;
    v_item RECORD;
    v_variant RECORD;
    v_payment RECORD;
    v_pps INTEGER;
    v_total_pieces INTEGER;
    v_subtotal DECIMAL(10,2) := 0;
    v_final_total DECIMAL(10,2) := 0;
    v_total_paid DECIMAL(10,2) := 0;
    v_store_credit_paid DECIMAL(10,2) := 0;
    v_new_credit_bal DECIMAL(10,2) := 0;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_year TEXT := TO_CHAR(NOW(), 'YYYY');
    v_retries INTEGER := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_staff_id IS NULL THEN RAISE EXCEPTION 'Staff ID is required.'; END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Sold items list cannot be empty.'; END IF;

    IF COALESCE(p_discount_amount, 0) < 0 OR COALESCE(p_round_off, 0) < -50.00 OR COALESCE(p_round_off, 0) > 50.00 THEN
        RAISE EXCEPTION 'Invalid discount or round-off bounds.';
    END IF;

    -- Duplicate variants guard
    SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
    INTO v_item_count, v_distinct_item_count
    FROM jsonb_array_elements(p_items) AS x;

    IF v_item_count <> v_distinct_item_count THEN
        RAISE EXCEPTION 'Duplicate variants detected in sold items. Please consolidate quantities.';
    END IF;

    -- 1. Lock Staff
    SELECT * INTO v_staff FROM line_staff WHERE id = p_staff_id AND is_active = TRUE FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active line staff member not found.'; END IF;

    -- Resolve or create customer account for linesman
    IF v_staff.customer_id IS NOT NULL THEN
        SELECT * INTO v_customer FROM customers WHERE id = v_staff.customer_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Linked customer account not found.'; END IF;
        v_customer_id := v_customer.id;
    ELSE
        -- Query existing by phone or insert new
        IF v_staff.phone IS NOT NULL AND trim(v_staff.phone) <> '' THEN
            SELECT * INTO v_customer FROM customers WHERE phone = trim(v_staff.phone) FOR UPDATE;
        END IF;

        IF v_customer.id IS NOT NULL THEN
            v_customer_id := v_customer.id;
        ELSE
            INSERT INTO customers (name, phone, is_active)
            VALUES (v_staff.name || ' (Line Sales)', NULLIF(trim(v_staff.phone), ''), TRUE)
            RETURNING * INTO v_customer;
            v_customer_id := v_customer.id;
        END IF;

        UPDATE line_staff SET customer_id = v_customer_id WHERE id = p_staff_id;
    END IF;

    -- 2. Deterministic Lock on Van Inventory rows
    PERFORM 1 FROM line_van_inventory lvi
    WHERE lvi.staff_id = p_staff_id 
      AND lvi.variant_id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x)
    ORDER BY lvi.variant_id FOR UPDATE;

    -- 3. Calculate Subtotal & Deduct Sold Items from Line Van Inventory
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID,
        sets_quantity INTEGER,
        loose_quantity INTEGER,
        selling_price DECIMAL
    )
    LOOP
        IF COALESCE(v_item.sets_quantity, 0) < 0 OR COALESCE(v_item.loose_quantity, 0) < 0 THEN
            RAISE EXCEPTION 'Sold quantities cannot be negative.';
        END IF;

        SELECT v.*, COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps
        INTO v_variant
        FROM variants v
        JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;

        IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found: %', v_item.variant_id; END IF;

        v_pps := v_variant.effective_pps;
        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_pps) + COALESCE(v_item.loose_quantity, 0);

        IF v_total_pieces <= 0 THEN RAISE EXCEPTION 'Sold pieces must be greater than 0 for variant %', v_variant.name; END IF;

        -- Check Van Inventory
        SELECT * INTO v_van_item FROM line_van_inventory 
        WHERE staff_id = p_staff_id AND variant_id = v_item.variant_id;

        IF NOT FOUND OR v_van_item.quantity < v_total_pieces THEN
            RAISE EXCEPTION 'Insufficient van stock for %. Van holds: % pcs, Sold: % pcs',
                v_variant.name, COALESCE(v_van_item.quantity, 0), v_total_pieces;
        END IF;

        -- Deduct from Van
        UPDATE line_van_inventory
        SET quantity = quantity - v_total_pieces,
            sets_quantity = GREATEST(0, sets_quantity - COALESCE(v_item.sets_quantity, 0)),
            updated_at = NOW()
        WHERE staff_id = p_staff_id AND variant_id = v_item.variant_id;

        -- Log movement
        INSERT INTO line_stock_movements (
            staff_id,
            variant_id,
            movement_type,
            sets_quantity,
            quantity,
            notes,
            created_at
        ) VALUES (
            p_staff_id,
            v_item.variant_id,
            'SALE_DEDUCT',
            COALESCE(v_item.sets_quantity, 0),
            v_total_pieces,
            COALESCE(p_notes, 'Billed sold stock from van'),
            NOW()
        );

        v_subtotal := v_subtotal + ROUND(v_total_pieces * COALESCE(v_item.selling_price, v_variant.selling_price), 2);
    END LOOP;

    -- 4. Calculate Final Total (Normal Non-GST)
    IF p_discount_amount > v_subtotal THEN
        RAISE EXCEPTION 'Discount amount (₹%) cannot exceed subtotal (₹%).', p_discount_amount, v_subtotal;
    END IF;

    v_final_total := GREATEST(0.00, v_subtotal - COALESCE(p_discount_amount, 0) + COALESCE(p_round_off, 0));

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
            RAISE EXCEPTION 'Insufficient store credit balance (₹%). Requested: ₹%',
                v_customer.credit_balance, v_store_credit_paid;
        END IF;

        UPDATE customers
        SET credit_balance = credit_balance - v_store_credit_paid,
            updated_at = NOW()
        WHERE id = v_customer_id
        RETURNING credit_balance INTO v_new_credit_bal;
    END IF;

    -- Generate Collision-Resistant Invoice Number
    LOOP
        v_retries := v_retries + 1;
        v_invoice_number := 'MELBUN/' || v_year || '/' || UPPER(SUBSTRING(MD5(gen_random_uuid()::TEXT) FROM 1 FOR 6));
        PERFORM 1 FROM invoices WHERE invoice_number = v_invoice_number;
        IF NOT FOUND THEN EXIT; END IF;
        IF v_retries > 50 THEN RAISE EXCEPTION 'Failed to generate unique invoice number after 50 attempts.'; END IF;
    END LOOP;

    -- Create Normal Non-GST Invoice
    INSERT INTO invoices (
        invoice_number,
        customer_id,
        subtotal,
        discount_amount,
        round_off,
        gst_applied,
        cgst_amount,
        sgst_amount,
        final_total,
        is_voided,
        is_hidden,
        created_at,
        updated_at
    ) VALUES (
        v_invoice_number,
        v_customer_id,
        v_subtotal,
        COALESCE(p_discount_amount, 0),
        COALESCE(p_round_off, 0),
        FALSE,
        0.00,
        0.00,
        v_final_total,
        FALSE,
        FALSE,
        NOW(),
        NOW()
    ) RETURNING id INTO v_invoice_id;

    -- Insert Invoice Items
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        variant_id UUID,
        sets_quantity INTEGER,
        loose_quantity INTEGER,
        selling_price DECIMAL
    )
    LOOP
        SELECT v.*, COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps
        INTO v_variant
        FROM variants v
        JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id;

        v_pps := v_variant.effective_pps;
        v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_pps) + COALESCE(v_item.loose_quantity, 0);

        INSERT INTO invoice_items (
            invoice_id,
            variant_id,
            quantity,
            sets_quantity,
            loose_quantity,
            selling_price_snapshot,
            cost_price_snapshot,
            profit_snapshot,
            created_at
        ) VALUES (
            v_invoice_id,
            v_item.variant_id,
            v_total_pieces,
            COALESCE(v_item.sets_quantity, 0),
            COALESCE(v_item.loose_quantity, 0),
            COALESCE(v_item.selling_price, v_variant.selling_price),
            v_variant.cost_price,
            ROUND(v_total_pieces * (COALESCE(v_item.selling_price, v_variant.selling_price) - v_variant.cost_price), 2),
            NOW()
        );
    END LOOP;

    -- Insert Payments & Log Store Credit Ledger
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS x(amount DECIMAL, method payment_method)
        LOOP
            IF v_payment.amount > 0 THEN
                INSERT INTO payments (
                    invoice_id,
                    customer_id,
                    amount,
                    method,
                    notes,
                    created_at
                ) VALUES (
                    v_invoice_id,
                    v_customer_id,
                    v_payment.amount,
                    v_payment.method,
                    'Line Sales Settlement - ' || v_staff.name,
                    NOW()
                );

                IF v_payment.method = 'STORE_CREDIT' THEN
                    INSERT INTO customer_credit_ledger (
                        customer_id,
                        type,
                        amount,
                        balance_after,
                        reference_invoice_id,
                        notes,
                        created_at
                    ) VALUES (
                        v_customer_id,
                        'PAYMENT_APPLIED'::credit_movement_type,
                        -v_payment.amount,
                        v_new_credit_bal,
                        v_invoice_id,
                        'Store Credit Applied on Line Sales Invoice ' || v_invoice_number,
                        NOW()
                    );
                END IF;
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'final_total', v_final_total,
        'paid_amount', v_total_paid,
        'customer_id', v_customer_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION bill_line_staff_sales(UUID, JSONB, JSONB, DECIMAL, DECIMAL, TEXT) TO authenticated, service_role;

-- 8. Return Line Van Stock RPC (Restocks to Main Warehouse with Put Back All support & Dual-Inventory Clamping)
CREATE OR REPLACE FUNCTION return_line_van_stock(
    p_staff_id UUID,
    p_items JSONB DEFAULT NULL,
    p_put_back_all BOOLEAN DEFAULT FALSE,
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_staff RECORD;
    v_van_row RECORD;
    v_item RECORD;
    v_variant RECORD;
    v_pps INTEGER;
    v_total_pieces INTEGER;
    v_clamped_sets INTEGER;
    v_item_count INTEGER;
    v_distinct_item_count INTEGER;
    v_returned_items_count INTEGER := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_staff_id IS NULL THEN RAISE EXCEPTION 'Staff ID is required.'; END IF;

    -- 1. Lock Staff
    SELECT * INTO v_staff FROM line_staff WHERE id = p_staff_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line staff member not found.'; END IF;

    IF p_put_back_all THEN
        -- 2A. Put Back All Remaining Stock with deterministic locking
        PERFORM 1 FROM variants v
        WHERE v.id IN (SELECT variant_id FROM line_van_inventory WHERE staff_id = p_staff_id AND quantity > 0)
        ORDER BY v.id FOR UPDATE OF v;

        FOR v_van_row IN 
            SELECT lvi.*, v.name AS variant_name, v.stock_quantity, v.stock_sets,
                   COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps
            FROM line_van_inventory lvi
            JOIN variants v ON lvi.variant_id = v.id
            JOIN products p ON v.product_id = p.id
            WHERE lvi.staff_id = p_staff_id AND lvi.quantity > 0
            ORDER BY lvi.variant_id
            FOR UPDATE OF lvi
        LOOP
            v_pps := v_van_row.effective_pps;
            -- Strict Dual Inventory Clamping: sets must not exceed floor(total_pieces / pps)
            v_clamped_sets := LEAST(
                v_van_row.stock_sets + v_van_row.sets_quantity,
                FLOOR((v_van_row.stock_quantity + v_van_row.quantity) / v_pps)
            );

            UPDATE variants
            SET stock_quantity = stock_quantity + v_van_row.quantity,
                stock_sets = v_clamped_sets,
                updated_at = NOW()
            WHERE id = v_van_row.variant_id;

            -- Log Main Movement
            INSERT INTO stock_movements (
                variant_id,
                type,
                quantity_change,
                notes,
                created_at
            ) VALUES (
                v_van_row.variant_id,
                'LINE_RESTOCK'::stock_movement_type,
                v_van_row.quantity,
                COALESCE(p_notes, 'Line Stock Restocked to Warehouse (Put Back All): ' || v_staff.name),
                NOW()
            );

            -- Log Line Movement
            INSERT INTO line_stock_movements (
                staff_id,
                variant_id,
                movement_type,
                sets_quantity,
                quantity,
                notes,
                created_at
            ) VALUES (
                p_staff_id,
                v_van_row.variant_id,
                'PUT_BACK_ALL',
                v_van_row.sets_quantity,
                v_van_row.quantity,
                COALESCE(p_notes, 'Returned all remaining van stock to warehouse'),
                NOW()
            );

            -- Reset Van Row
            UPDATE line_van_inventory
            SET quantity = 0,
                sets_quantity = 0,
                updated_at = NOW()
            WHERE staff_id = p_staff_id AND variant_id = v_van_row.variant_id;

            v_returned_items_count := v_returned_items_count + 1;
        END LOOP;
    ELSE
        -- 2B. Selective Item Return
        IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
            RAISE EXCEPTION 'Return items list cannot be empty for selective return.';
        END IF;

        -- Duplicate variants guard
        SELECT COUNT(*), COUNT(DISTINCT (x->>'variant_id')::UUID)
        INTO v_item_count, v_distinct_item_count
        FROM jsonb_array_elements(p_items) AS x;

        IF v_item_count <> v_distinct_item_count THEN
            RAISE EXCEPTION 'Duplicate variants detected in return items. Please consolidate quantities.';
        END IF;

        -- Deterministic Lock on Variants and Van Rows
        PERFORM 1 FROM variants v
        WHERE v.id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x)
        ORDER BY v.id FOR UPDATE OF v;

        PERFORM 1 FROM line_van_inventory lvi
        WHERE lvi.staff_id = p_staff_id 
          AND lvi.variant_id IN (SELECT (x->>'variant_id')::UUID FROM jsonb_array_elements(p_items) x)
        ORDER BY lvi.variant_id FOR UPDATE;

        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
            variant_id UUID,
            sets_quantity INTEGER,
            loose_quantity INTEGER
        )
        LOOP
            IF COALESCE(v_item.sets_quantity, 0) < 0 OR COALESCE(v_item.loose_quantity, 0) < 0 THEN
                RAISE EXCEPTION 'Return quantities cannot be negative.';
            END IF;

            SELECT v.*, COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps
            INTO v_variant
            FROM variants v
            JOIN products p ON v.product_id = p.id
            WHERE v.id = v_item.variant_id;

            v_pps := v_variant.effective_pps;
            v_total_pieces := (COALESCE(v_item.sets_quantity, 0) * v_pps) + COALESCE(v_item.loose_quantity, 0);

            IF v_total_pieces <= 0 THEN RAISE EXCEPTION 'Return quantity must be greater than 0.'; END IF;

            -- Check Van Row
            SELECT * INTO v_van_row FROM line_van_inventory
            WHERE staff_id = p_staff_id AND variant_id = v_item.variant_id;

            IF NOT FOUND OR v_van_row.quantity < v_total_pieces THEN
                RAISE EXCEPTION 'Insufficient van stock for %. Van holds: % pcs, Returning: % pcs',
                    v_variant.name, COALESCE(v_van_row.quantity, 0), v_total_pieces;
            END IF;

            -- Deduct from Van
            UPDATE line_van_inventory
            SET quantity = quantity - v_total_pieces,
                sets_quantity = GREATEST(0, sets_quantity - COALESCE(v_item.sets_quantity, 0)),
                updated_at = NOW()
            WHERE staff_id = p_staff_id AND variant_id = v_item.variant_id;

            -- Clamped Restock to Main Warehouse
            v_clamped_sets := LEAST(
                v_variant.stock_sets + COALESCE(v_item.sets_quantity, 0),
                FLOOR((v_variant.stock_quantity + v_total_pieces) / v_pps)
            );

            UPDATE variants
            SET stock_quantity = stock_quantity + v_total_pieces,
                stock_sets = v_clamped_sets,
                updated_at = NOW()
            WHERE id = v_item.variant_id;

            -- Log Main Movement
            INSERT INTO stock_movements (
                variant_id,
                type,
                quantity_change,
                notes,
                created_at
            ) VALUES (
                v_item.variant_id,
                'LINE_RESTOCK'::stock_movement_type,
                v_total_pieces,
                COALESCE(p_notes, 'Line Stock Restocked to Warehouse: ' || v_staff.name),
                NOW()
            );

            -- Log Line Movement
            INSERT INTO line_stock_movements (
                staff_id,
                variant_id,
                movement_type,
                sets_quantity,
                quantity,
                notes,
                created_at
            ) VALUES (
                p_staff_id,
                v_item.variant_id,
                'MANUAL_RETURN',
                COALESCE(v_item.sets_quantity, 0),
                v_total_pieces,
                COALESCE(p_notes, 'Returned unsold stock to warehouse'),
                NOW()
            );

            v_returned_items_count := v_returned_items_count + 1;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'staff_id', p_staff_id,
        'returned_items_count', v_returned_items_count,
        'put_back_all', p_put_back_all
    );
END;
$$;

GRANT EXECUTE ON FUNCTION return_line_van_stock(UUID, JSONB, BOOLEAN, TEXT) TO authenticated, service_role;
