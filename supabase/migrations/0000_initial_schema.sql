-- Proposed Database Schema for MelbunPOS (Phase 1) - v3 Fixed (APPROVED BY AUDITOR)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS moddatetime;

-- 1. Customers
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    gstin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Products
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    pieces_per_set INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trigger_update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

-- 3. Variants
CREATE TABLE variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    barcode TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    cost_price DECIMAL(10, 2) NOT NULL,
    selling_price DECIMAL(10, 2) NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_variants_product_id ON variants(product_id);
CREATE TRIGGER trigger_update_variants_updated_at BEFORE UPDATE ON variants FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

-- 5. Invoices (Created before Invoice Items)
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number TEXT UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
    subtotal DECIMAL(10, 2) NOT NULL,
    discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    round_off DECIMAL(10, 2) NOT NULL DEFAULT 0,
    gst_applied BOOLEAN NOT NULL DEFAULT FALSE,
    cgst_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    sgst_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    final_total DECIMAL(10, 2) NOT NULL,
    is_voided BOOLEAN NOT NULL DEFAULT FALSE,
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_invoices_customer_id ON invoices(customer_id);
CREATE TRIGGER trigger_update_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

-- 6. Invoice Items
CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL,
    cost_price_snapshot DECIMAL(10, 2) NOT NULL,
    selling_price_snapshot DECIMAL(10, 2) NOT NULL,
    profit_snapshot DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_variant_id ON invoice_items(variant_id);

-- 4. Stock Movements (Ledger) - Placed after invoice_items for reference
CREATE TYPE stock_movement_type AS ENUM ('ARRIVAL', 'SALE', 'RETURN_RESTOCK', 'RETURN_DAMAGE', 'VOID_RESTOCK', 'MANUAL_ADJUST');

CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
    invoice_item_id UUID REFERENCES invoice_items(id) ON DELETE RESTRICT,
    type stock_movement_type NOT NULL,
    quantity_change INTEGER NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_stock_movements_variant_id ON stock_movements(variant_id);
CREATE INDEX idx_stock_movements_invoice_item_id ON stock_movements(invoice_item_id);

-- 7. Payments
CREATE TYPE payment_method AS ENUM ('CASH', 'UPI', 'CARD', 'CREDIT', 'SPLIT');

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,
    customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
    amount DECIMAL(10, 2) NOT NULL,
    method payment_method NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX idx_payments_customer_id ON payments(customer_id);

-- 8. Expenses
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category TEXT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    payment_method payment_method NOT NULL,
    notes TEXT,
    is_voided BOOLEAN NOT NULL DEFAULT FALSE,
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trigger_update_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);
