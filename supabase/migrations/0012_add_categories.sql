-- Migration: 0012_add_categories.sql

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE products 
ADD COLUMN category_id UUID REFERENCES categories(id) ON DELETE RESTRICT;

-- Enable RLS
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Policies for Categories
CREATE POLICY "Enable read access for all authenticated users" ON categories
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable all access for ADMIN role" ON categories
    FOR ALL TO authenticated USING (public.get_my_role() = 'ADMIN');
