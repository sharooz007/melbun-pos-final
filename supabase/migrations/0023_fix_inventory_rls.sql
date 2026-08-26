-- Migration: 0023_fix_inventory_rls.sql
-- Force disable RLS on all inventory tables to fix "Missing Products" bug.
-- The user explicitly requested no admin/role restrictions.

ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE variants DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoices DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;
