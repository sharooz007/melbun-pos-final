-- Migration: 0068_performance_indexes.sql
-- Optimizes query performance across high-volume transaction tables:
-- invoices, expenses, payments, and stock_movements without duplicate index overhead.

-- 1. Invoices Query Optimization (Optimizes date filtering, live sales reporting, and customer history)
CREATE INDEX IF NOT EXISTS idx_invoices_customer_created 
ON invoices (customer_id, created_at DESC) 
WHERE is_hidden = FALSE;

CREATE INDEX IF NOT EXISTS idx_invoices_created_active 
ON invoices (created_at DESC) 
WHERE is_hidden = FALSE AND is_voided = FALSE;

-- 2. Expenses Query Optimization (Optimizes live financial reporting and net profit aggregations)
CREATE INDEX IF NOT EXISTS idx_expenses_created_active 
ON expenses (created_at DESC) 
WHERE is_hidden = FALSE AND is_voided = FALSE;

-- 3. Stock Movements Optimization (Optimizes variant inventory ledger and audit history)
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_date 
ON stock_movements (variant_id, created_at DESC);

-- 4. Customer Payments History Optimization
CREATE INDEX IF NOT EXISTS idx_payments_customer_created 
ON payments (customer_id, created_at DESC);
