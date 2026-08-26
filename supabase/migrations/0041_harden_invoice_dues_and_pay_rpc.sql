-- Migration: 0041_harden_invoice_dues_and_pay_rpc.sql
-- Fixes Phantom Dues and Overpayment on Invoices with Returns.

CREATE OR REPLACE FUNCTION pay_invoice(
    p_invoice_id UUID,
    p_customer_id UUID,
    p_amount DECIMAL(10,2),
    p_method payment_method
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_total_paid DECIMAL(10,2) := 0;
    v_total_refunds DECIMAL(10,2) := 0;
    v_effective_total DECIMAL(10,2) := 0;
    v_net_due DECIMAL(10,2) := 0;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized: User must be authenticated.'; END IF;
    IF p_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero.'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Cannot record payment for a voided invoice.'; END IF;

    -- Verify customer ownership
    IF v_invoice.customer_id IS DISTINCT FROM p_customer_id THEN
        RAISE EXCEPTION 'Invoice does not belong to this customer.';
    END IF;

    -- Calculate total refunds on this invoice
    SELECT COALESCE(SUM(total_refund_amount), 0)
    INTO v_total_refunds
    FROM returns
    WHERE invoice_id = p_invoice_id;

    -- Calculate total net payments (including previous payments and any cash refunds)
    SELECT COALESCE(SUM(amount), 0)
    INTO v_total_paid
    FROM payments
    WHERE invoice_id = p_invoice_id;

    -- Effective invoice bill total after returns
    v_effective_total := GREATEST(0.00, v_invoice.final_total - v_total_refunds);
    v_net_due := GREATEST(0.00, v_effective_total - v_total_paid);

    IF p_amount > v_net_due THEN
        RAISE EXCEPTION 'Payment amount (%) exceeds remaining net due on invoice (%).', p_amount, v_net_due;
    END IF;

    INSERT INTO payments (invoice_id, customer_id, amount, method)
    VALUES (p_invoice_id, p_customer_id, p_amount, p_method);

    RETURN jsonb_build_object(
        'success', true, 
        'invoice_id', p_invoice_id, 
        'amount_paid', p_amount,
        'remaining_due', GREATEST(0.00, v_net_due - p_amount)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION pay_invoice(UUID, UUID, DECIMAL, payment_method) TO authenticated, service_role;
