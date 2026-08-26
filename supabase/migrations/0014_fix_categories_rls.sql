-- Migration: 0014_fix_categories_rls.sql

-- Drop the restrictive policies on categories
DROP POLICY IF EXISTS "Enable read access for all authenticated users" ON categories;
DROP POLICY IF EXISTS "Enable all access for ADMIN role" ON categories;

-- Disable RLS on categories to match the rest of the inventory tables (products, variants)
ALTER TABLE categories DISABLE ROW LEVEL SECURITY;
