-- Migration: 0040_enable_secure_rls.sql
-- Enables Row Level Security on all core tables and configures policies for authenticated users.

-- 1. Enable RLS on all tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_movements ENABLE ROW LEVEL SECURITY;

-- 2. Drop any legacy/stale policies
DROP POLICY IF EXISTS "Authenticated users full access to products" ON products;
DROP POLICY IF EXISTS "Authenticated users full access to variants" ON variants;
DROP POLICY IF EXISTS "Authenticated users full access to categories" ON categories;
DROP POLICY IF EXISTS "Authenticated users full access to stock_movements" ON stock_movements;
DROP POLICY IF EXISTS "Authenticated users full access to customers" ON customers;
DROP POLICY IF EXISTS "Authenticated users full access to invoices" ON invoices;
DROP POLICY IF EXISTS "Authenticated users full access to invoice_items" ON invoice_items;
DROP POLICY IF EXISTS "Authenticated users full access to payments" ON payments;
DROP POLICY IF EXISTS "Authenticated users full access to returns" ON returns;
DROP POLICY IF EXISTS "Enable read for authenticated users" ON returns;
DROP POLICY IF EXISTS "Authenticated users full access to expenses" ON expenses;
DROP POLICY IF EXISTS "Authenticated users full access to money_movements" ON money_movements;

-- 3. Create comprehensive authenticated access policies
CREATE POLICY "Authenticated users full access to products" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access to variants" ON variants FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access to categories" ON categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access to stock_movements" ON stock_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access to customers" ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access to invoices" ON invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access to invoice_items" ON invoice_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access to payments" ON payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access to returns" ON returns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access to expenses" ON expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users full access to money_movements" ON money_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
