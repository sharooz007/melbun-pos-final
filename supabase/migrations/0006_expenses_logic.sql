-- Phase 6: Expenses Engine (Hardened V2 - Auditor Approved)

-- 1. Add Expense RPC
CREATE OR REPLACE FUNCTION add_expense(
    p_category TEXT,
    p_amount DECIMAL(10,2),
    p_payment_method payment_method,
    p_notes TEXT DEFAULT NULL,
    p_created_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_expense_id UUID;
    v_clean_category TEXT;
    v_clean_notes TEXT;
    v_timestamp TIMESTAMPTZ;
BEGIN
    -- 1. Auth Check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    -- 2. Input Validations
    IF p_category IS NULL OR trim(p_category) = '' THEN
        RAISE EXCEPTION 'Expense category cannot be empty.';
    END IF;
    v_clean_category := trim(p_category);

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Expense amount must be greater than zero.';
    END IF;

    IF p_payment_method IS NULL THEN
        RAISE EXCEPTION 'Payment method is required.';
    END IF;

    IF p_payment_method NOT IN ('CASH', 'UPI', 'CARD') THEN
        RAISE EXCEPTION 'Invalid payment method for expense. Must be CASH, UPI, or CARD.';
    END IF;

    v_clean_notes := NULLIF(trim(p_notes), '');
    v_timestamp := COALESCE(p_created_at, NOW());

    -- 3. Insert Expense
    INSERT INTO expenses (
        category, 
        amount, 
        payment_method, 
        notes, 
        created_at
    ) VALUES (
        v_clean_category, 
        p_amount, 
        p_payment_method, 
        v_clean_notes, 
        v_timestamp
    )
    RETURNING id INTO v_expense_id;

    -- 4. Return Structured Result
    RETURN jsonb_build_object(
        'success', true, 
        'expense_id', v_expense_id,
        'category', v_clean_category,
        'amount', p_amount,
        'payment_method', p_payment_method,
        'created_at', v_timestamp
    );
END;
$$;

-- 2. Void Expense RPC
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
    v_user_role user_role_type;
    v_expense RECORD;
    v_void_note TEXT;
BEGIN
    -- 1. Auth & RBAC Check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User must be authenticated.';
    END IF;

    v_user_role := public.get_my_role();
    IF v_user_role IS DISTINCT FROM 'ADMIN' THEN
        RAISE EXCEPTION 'Forbidden: Only ADMIN users can void expenses.';
    END IF;

    IF p_expense_id IS NULL THEN
        RAISE EXCEPTION 'Expense ID is required.';
    END IF;

    -- 2. Fetch & Lock Expense
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

    -- 3. Append Void Reason to Notes for Audit Tracing
    v_void_note := COALESCE(v_expense.notes || ' | ', '') || 'VOIDED: ' || COALESCE(NULLIF(trim(p_reason), ''), 'No reason provided');

    -- 4. Soft Delete (Void)
    UPDATE expenses 
    SET is_voided = true, 
        notes = v_void_note,
        updated_at = NOW() 
    WHERE id = p_expense_id;

    -- 5. Return Structured Result
    RETURN jsonb_build_object(
        'success', true, 
        'expense_id', p_expense_id
    );
END;
$$;
