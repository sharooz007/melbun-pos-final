# Implementation Phases

To ensure a safe, bug-free, and structured build, the application will be developed in **6 strict phases**. Each phase builds upon the previous one, allowing for continuous testing of core features before complex logic (like voiding and reporting) is introduced.

## Phase 1: Foundation & Authentication
*Goal: Get the skeleton of the app running with a secure database connection.*
- Initialize Next.js 14 (App Router) and Tailwind CSS.
- Configure `@cloudflare/next-on-pages` for edge deployment compatibility.
- Set up Supabase Client and Authentication (Login/Logout).
- Execute the SQL Schema in Supabase to create all tables (`products`, `variants`, `invoices`, etc.).
- Build the global UI Shell (Deep red sidebar, beige main layout, responsive navigation).

## Phase 2: Inventory & Products
*Goal: Allow the store to populate its catalog and receive stock safely.*
- Build the **Products & Variants** management pages (Create, Read, Update).
- Implement the auto-generation of short, unique barcodes.
- Build the **Stock Arrival** bulk-entry grid.
- Implement the `stock_movements` ledger logic (ensuring every piece added is historically logged).
- Build the **Price & Stock** lookup modal with Camera Scanner integration.

## Phase 3: Core POS & Customers
*Goal: Enable the staff to ring up sales and manage customer tabs.*
- Build the **Customers** management page and basic ledger.
- Build the **POS (Checkout)** UI: Cart, search bar, variant selection.
- Implement billing logic: Global discounts, Manual Round-off, and the 5% GST toggle.
- Build the Checkout transaction: Inserting into `invoices`, `invoice_items` (snapshotting COGS/Profit), and `payments`.
- Implement stock deduction upon successful checkout.

## Phase 4: Voiding, Editing & Expenses
*Goal: Introduce the strict financial rules and error-correction mechanisms.*
- Build the **Invoice Detail View**.
- Implement **Voiding (Soft Delete)**: Logic to reverse stock deductions and delete payment records safely.
- Implement **Invoice Editability**: Allowing retro-active edits to past invoices.
- Build the **Expenses** module (Create, Read, Update, Void).

## Phase 5: Label Printing & Returns
*Goal: Add operational utilities for physical store management.*
- Build the **Labels** printing hub.
- Design the printable layouts (1-column thermal, 2-column, A4).
- Build the **Returns** module to handle "Restocked" vs "Damaged Scrap" logic safely.

## Phase 6: Reporting & PDF Invoices
*Goal: Add final analytics and shareable receipts.*
- Implement client-side PDF generation (using `jspdf` and `html2canvas`) for invoices.
- Build the **Dashboard** widgets (Today's Sales, Net Revenue, etc.).
- Build the **Reports** engine: Advanced date filtering, Gross Profit calculations, Stock Valuation, and Sales vs Collected charts.
- Final UI polish and role-based access control (hiding metrics from Staff).
