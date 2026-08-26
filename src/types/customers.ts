export interface CustomerRecord {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  credit_balance?: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface CreditLedgerEntry {
  id: string;
  customer_id: string;
  type: 'RETURN_CREDIT' | 'PAYMENT_APPLIED' | 'MANUAL_ADJUST';
  amount: number;
  balance_after: number;
  reference_invoice_id: string | null;
  notes: string | null;
  created_at: string;
  invoices?: { invoice_number: string } | null;
}

export type CustomerPaymentMethod = 'CASH' | 'UPI' | 'STORE_CREDIT';
