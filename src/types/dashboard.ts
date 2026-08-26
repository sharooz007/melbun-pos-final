export interface LowStockItem {
  variant_id: string;
  name: string;
  stock_quantity: number;
}

export interface DashboardMetrics {
  net_sales: number;
  gross_profit: number | null; // Null if user is STAFF
  total_expenses: number;
  net_profit: number | null; // Null if user is STAFF
  collected_payments: number;
  invoice_count: number;
  low_stock_items: LowStockItem[];
}

export type DashboardActionResult =
  | { success: true; data: DashboardMetrics }
  | { success: false; error: string };
