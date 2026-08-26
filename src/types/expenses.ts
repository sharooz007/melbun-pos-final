export type ExpensePaymentMethod = 'CASH' | 'UPI';

export interface ExpenseItem {
  id: string;
  category: string;
  amount: number;
  payment_method: ExpensePaymentMethod;
  notes: string | null;
  is_voided: boolean;
  created_at: string;
  updated_at: string;
}

export type ExpenseActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };
