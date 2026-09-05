export type RefundPaymentMethod = 'CASH' | 'UPI' | 'STORE_CREDIT';
export type ReturnType = 'RESTOCK' | 'DAMAGED';

export interface ReturnRecord {
  id: string;
  invoice_id: string;
  invoice_item_id: string;
  variant_id: string;
  customer_id: string | null;
  quantity: number;
  sets_quantity?: number;
  loose_quantity?: number;
  unit_refund_price: number;
  total_refund_amount: number;
  refund_method: RefundPaymentMethod;
  return_type: ReturnType;
  notes: string | null;
  processed_by: string;
  created_at: string;
}

export interface VariantDetail {
  id: string;
  name: string;
  barcode: string;
  pieces_per_set?: number;
  products?: {
    id: string;
    name: string;
    pieces_per_set: number;
  } | null;
}

export interface InvoiceItemWithReturns {
  id: string;
  variant_id: string;
  quantity: number;
  sets_quantity?: number;
  loose_quantity?: number;
  selling_price_snapshot: number;
  cost_price_snapshot: number;
  profit_snapshot: number;
  variants: VariantDetail;
  returns: Array<{
    id: string;
    quantity: number;
    sets_quantity?: number;
    loose_quantity?: number;
    unit_refund_price: number;
    total_refund_amount: number;
    refund_method: RefundPaymentMethod;
    return_type: ReturnType;
    notes: string | null;
    created_at: string;
  }>;
}

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  is_active?: boolean;
}

export interface InvoiceLookupData {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  subtotal: number;
  discount_amount: number;
  round_off: number;
  gst_applied: boolean;
  cgst_amount: number;
  sgst_amount: number;
  final_total: number;
  total_paid?: number;
  due_amount?: number;
  payments?: Array<{ amount: number; method: string }>;
  is_voided: boolean;
  created_at: string;
  customers: CustomerSummary | null;
  invoice_items: InvoiceItemWithReturns[];
}

export interface ReturnActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ProcessReturnResult {
  success: boolean;
  return_id: string;
  refund_amount: number;
  unit_refund_price?: number;
  pieces_returned?: number;
  sets_returned?: number;
  cash_refunded?: number;
}

export interface RecentReturnAuditItem {
  id: string;
  invoice_id?: string;
  quantity: number;
  sets_quantity?: number;
  loose_quantity?: number;
  unit_refund_price: number;
  total_refund_amount: number;
  refund_method: RefundPaymentMethod;
  return_type: ReturnType;
  notes: string | null;
  created_at: string;
  invoices: {
    id?: string;
    invoice_number: string;
  };
  variants: {
    name: string;
    barcode: string;
    pieces_per_set?: number;
    products?: {
      name: string;
      pieces_per_set: number;
    } | null;
  };
  customers: {
    name: string;
  } | null;
}
