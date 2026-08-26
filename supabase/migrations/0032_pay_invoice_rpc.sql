-- Migration: 0032_pay_invoice_rpc.sql

CREATE OR REPLACE FUNCTION pay_invoice(
    p_invoice_id UUID,
    p_customer_id UUID,
    p_amount DECIMAL(10,2),
    p_method payment_method
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invoice RECORD;
    v_total_paid DECIMAL(10,2);
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF p_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than 0'; END IF;

    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF v_invoice.is_voided THEN RAISE EXCEPTION 'Cannot pay a voided invoice'; END IF;

    -- Verify customer matches
    IF v_invoice.customer_id != p_customer_id THEN
        RAISE EXCEPTION 'Invoice does not belong to this customer';
    END IF;

    -- Check current total paid to prevent overpaying
    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid FROM payments WHERE invoice_id = p_invoice_id;

    IF v_total_paid + p_amount > v_invoice.final_total THEN
        RAISE EXCEPTION 'Payment amount exceeds the due amount';
    END IF;

    INSERT INTO payments (invoice_id, customer_id, amount, method)
    VALUES (p_invoice_id, p_customer_id, p_amount, p_method);

    RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id, 'amount_paid', p_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION pay_invoice(UUID, UUID, DECIMAL, payment_method) TO authenticated, service_role;
