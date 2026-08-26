-- Migration 0059: Expense Categories Persistent Management

CREATE TABLE IF NOT EXISTS expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive unique constraint for active categories
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_unique_name 
    ON expense_categories (LOWER(TRIM(name))) 
    WHERE is_active = TRUE;

-- Idempotent Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_update_expense_categories_updated_at ON expense_categories;
CREATE TRIGGER trigger_update_expense_categories_updated_at 
    BEFORE UPDATE ON expense_categories 
    FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

-- Seed default presets
INSERT INTO expense_categories (name)
VALUES 
    ('Rent'),
    ('Electricity & Utilities'),
    ('Packaging Materials'),
    ('Staff Tea & Refreshments'),
    ('Logistics & Transport'),
    ('Salaries & Advances'),
    ('Store Maintenance'),
    ('Miscellaneous')
ON CONFLICT DO NOTHING;

-- Migrate existing non-empty categories from expenses
INSERT INTO expense_categories (name)
SELECT DISTINCT TRIM(category)
FROM expenses
WHERE category IS NOT NULL AND TRIM(category) <> ''
ON CONFLICT DO NOTHING;

-- RLS Configuration
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users full access to expense_categories" 
    ON expense_categories FOR ALL 
    TO authenticated 
    USING (true) 
    WITH CHECK (true);

GRANT ALL ON expense_categories TO authenticated, service_role;
