# Database Schema (Supabase / PostgreSQL)

This document outlines the core tables and relationships required to support the strict accounting, voiding, and variant logic.

## 1. Products & Variants

### `products`
The parent container for a clothing item.
- `id` (UUID, Primary Key)
- `name` (String, e.g., "Oversized Shirt")
- `brand` (String, e.g., "MELBUN")
- `pieces_per_set` (Integer, default 1) - Used for UI math only.
- `created_at` (Timestamp)
- `updated_at` (Timestamp)

### `variants`
The specific sellable item.
- `id` (UUID, Primary Key)
- `product_id` (UUID, Foreign Key -> products)
- `barcode` (String, Unique) - Auto-generated short alphanumeric (e.g., `mb01`).
- `name` (String, e.g., "BLUE - XL")
- `cost_price` (Decimal) - Cost per piece.
- `selling_price` (Decimal) - Selling price per piece.
- `stock_quantity` (Integer) - Total stock in **pieces**.
- `created_at` (Timestamp)
- `updated_at` (Timestamp)

## 2. Inventory Ledger

### `stock_movements`
The audit trail for every single piece of inventory added or removed.
- `id` (UUID, Primary Key)
- `variant_id` (UUID, Foreign Key -> variants)
- `type` (Enum: `ARRIVAL`, `SALE`, `RETURN_RESTOCK`, `RETURN_DAMAGE`, `VOID_RESTOCK`, `MANUAL_ADJUST`)
- `quantity_change` (Integer) - Positive or negative pieces.
- `notes` (String, optional)
- `created_at` (Timestamp)

## 3. Customers

### `customers`
- `id` (UUID, Primary Key)
- `name` (String)
- `phone` (String, Unique)
- `gstin` (String, nullable) - For B2B GST billing.
- `created_at` (Timestamp)

## 4. Sales & Invoicing (With Voiding Logic)

### `invoices`
- `id` (UUID, Primary Key)
- `invoice_number` (String, Unique) - e.g., `MELBUN/26-27/0001`
- `customer_id` (UUID, nullable, Foreign Key -> customers)
- `subtotal` (Decimal)
- `discount_amount` (Decimal) - Global cart discount.
- `round_off` (Decimal) - Manual adjustment.
- `gst_applied` (Boolean, default false) - If true, 5% GST is calculated on the discounted subtotal.
- `cgst_amount` (Decimal)
- `sgst_amount` (Decimal)
- `final_total` (Decimal)
- `is_voided` (Boolean, default false) - True if soft-deleted (red strikethrough in UI).
- `created_at` (Timestamp, Editable) - Timestamp of the sale.
- `updated_at` (Timestamp)

### `invoice_items`
Snapshots the prices at the moment of sale.
- `id` (UUID, Primary Key)
- `invoice_id` (UUID, Foreign Key -> invoices)
- `variant_id` (UUID, Foreign Key -> variants)
- `quantity` (Integer) - In pieces.
- `cost_price_snapshot` (Decimal) - COGS locked at checkout.
- `selling_price_snapshot` (Decimal) - Price locked at checkout.
- `profit_snapshot` (Decimal) - Calculated locked profit.

## 5. Money & Payments

### `payments`
Tracks money collected. If an invoice is put on "CREDIT", no payment record is created (or it's created for 0). When the customer pays their tab later, a new payment is created.
- `id` (UUID, Primary Key)
- `invoice_id` (UUID, nullable, Foreign Key -> invoices)
- `customer_id` (UUID, Foreign Key -> customers)
- `amount` (Decimal)
- `method` (Enum: `CASH`, `UPI`, `CARD`)
- `created_at` (Timestamp, Editable)

### `expenses`
- `id` (UUID, Primary Key)
- `category` (String)
- `amount` (Decimal)
- `payment_method` (Enum: `CASH`, `UPI`, `CARD`)
- `notes` (String, nullable)
- `is_voided` (Boolean, default false)
- `created_at` (Timestamp, Editable)
- `updated_at` (Timestamp)
