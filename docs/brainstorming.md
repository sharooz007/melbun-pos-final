# Brainstorming & Requirements

*This document will serve as a living record of our brainstorming sessions, feature requirements, and architectural decisions as we build the POS system.*

## 1. Project Overview
- **Project Name:** MelbunPOS (Placeholder)
- **Type:** POS App for a Wholesale Store
- **Primary Goal:** To provide a fast, mobile-friendly (or cross-platform) POS system capable of handling wholesale transactions, inventory, and customer management.

## 2. Store Type & Product Structure
- **Niche:** Apparel/Clothing Wholesale (based on "OversizedShirt" examples).
- **Product Hierarchy:** Products need variants (e.g., Color, Size).
- **Pricing:** Needs both **Cost Price** (for profit/stock valuation) and **Selling Price**.

## 3. Core Modules & Features (Based on UI)
- **Dashboard:** High-level metrics (Today's Sales, Expenses, Net Revenue) and recent activity.
- **GST / Tax Logic:** 
  - Standard invoices have zero GST calculation.
  - B2B GST Invoices: Optional toggle at checkout to add flat 5% GST (2.5% CGST / 2.5% SGST) *on top* of the existing price. The invoice PDF will render the HSN/SAC codes, company GSTIN, and customer GSTIN.
- **POS (Checkout):** 
  - Cart with variant selection.
  - Apply global discount to the entire bill (% or flat ₹).
  - **Manual Round-off:** An input field to manually round off the final bill amount after discounts are applied.
  - Split payments (e.g., partial Cash, partial UPI).
  - Handle "Credit" as a checkout payment type.
- **Inventory (Sets vs Pieces & Barcodes):** 
  - Products have a defined `pieces_per_set`. 
  - **Database Logic:** The database tracks the absolute lowest common denominator: **Pieces**.
  - **UI Logic:** The UI calculates and displays stock dynamically as `Sets & Pieces`.
  - **Barcodes:** The system automatically generates a unique, **short** alphanumeric barcode for every variant upon creation to ensure it fits perfectly on narrow thermal sticker rolls without becoming too wide.
- **Invoicing & Historical Profit (COGS):** Every invoice and invoice line-item will store a hard snapshot of the `cost_price` (COGS) and calculated `profit` at the exact moment of checkout. This ensures historical reports remain perfectly accurate even if the product's base cost price changes months later.
- **Price & Stock Lookup:** A dedicated tool (modal/page) for staff to quickly check price and available stock without starting a cart. Features both a text search and a **Camera Scanner** for reading barcodes directly from the device.
- **Customers:** Ledger system tracking "Outstanding" balances for B2B credit tabs (including their GSTIN numbers for B2B billing).
- **Expenses:** Categorized expense logging (Cash/UPI/Card) to calculate Net Revenue.
- **Returns:** 
  - Track payments received.
  - Differentiate between "Restocked Returns" (goes back to inventory) and "Damaged Scrap Loss" (written off).
- **Labels:** Built-in barcode sticker generation. Support for thermal rolls (1-column, 2-column) and A4 sheets. Customizable fields (Brand, Name, SubCode, Price).
- **Reports:** 
  - Advanced filtering (Custom date ranges).
  - Key metrics: Total Sales, Collected, Outstanding Dues, Gross Profit, and Stock at Cost.
  - Visual charts (Sales vs Collected) and tabular data exports.
- **Roles & Permissions:** System will support both `Admin` and `Staff` roles. Sensitive data (like Cost Price and Gross Profit) will be hidden from the Staff role (exact permissions to be finalized later).
- **Settings:** App configuration, tax rates, profile, etc.

## 4. Data Lifecycle & Strict Rules
- **Total Editability:** Every single entity (Invoices, Products, Expenses, Credit Payments) can be fully edited at any time. This includes retroactively changing the **Date and Time** of past invoices or expenses.
- **Product & Stock Ledger:** 
  - Products will maintain a strict history log (price changes, etc.).
  - **Stock Arrivals:** There will be a dedicated stock arrival ledger to log exactly *when* and *how much* stock arrived. The UI will feature a bulk-entry technique (like a fast grid) to rapidly input large stock arrivals.
- **Voiding (Soft Delete) & Undo Logic:** 
  - When an invoice or expense is "deleted", it is actually **Voided** (Soft Deleted). 
  - **Inventory & Money Reversal:** Voiding immediately reverses the stock (adds items back to inventory) and removes the payment from the collected totals. (Because payments are manual, the system just deletes the payment record; real-world bank reconciliation is handled by the user).
  - **UI State:** Voided invoices remain visible in Reports and Dashboards but are styled with **Red Strikethrough text**.
  - **Recovery:** Opening a voided invoice gives two options: `Undo Delete` (re-applies the stock deduction and payments) or `Permanently Delete` (hides it from the UI completely).
- **STRICT RULE:** Zero phantom stock and zero missing money. Database transactions must ensure that editing, voiding, or undoing an invoice flawlessly recalculates the exact pieces in inventory and the exact payments received.

## 5. Next Steps
- [ ] Design the Supabase Database Schema (SQL tables for Products, Variants, Customers, Invoices, Payments, Expenses, Returns).
- [ ] Initialize the Next.js App Router project and configure Tailwind CSS + Cloudflare Pages setup.
