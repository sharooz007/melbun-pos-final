# Features & Modules Blueprint

This document defines the 9 core modules of the application and their functional requirements based on the brainstorming phase.

## 1. Dashboard
- **Widgets:** Today's Sales, Today's Expenses, Net Revenue.
- **Lists:** Recent Invoices (showing Status/Profit), Recent Expenses.
- **Action:** Quick "New Sale" button.

## 2. POS (Checkout)
- **Search:** Search by barcode, product name, or variant code.
- **Cart:** Add variants, update quantities.
- **Billing Logic:**
  - Apply % or flat ₹ discount to the entire bill.
  - Manual Round-off input to tweak the final total.
  - GST Toggle: If enabled, adds 2.5% CGST and 2.5% SGST on top of the discounted price.
- **Checkout:** Select Customer. Process payment via Split (Cash/UPI/Card) or mark entire bill as CREDIT.

## 3. Inventory
- **Display:** Shows stock in Sets & Pieces (calculates based on `pieces_per_set`).
- **Management:** Full editability for product names, pieces per set, variants, cost prices, and selling prices.
- **Stock Arrival:** Bulk-entry grid interface to quickly log incoming stock. Logs to the `stock_movements` ledger.

## 4. Customers
- **List:** Search by name or phone.
- **Ledger:** Shows "Outstanding" balance.
- **Action:** Ability to click into a customer to view their history and accept partial payments against their outstanding tab.

## 5. Expenses
- **Logging:** Record daily expenses with Category, Amount, Payment Method, and Date.
- **Lifecycle:** Supports Full Editing, Soft Deletion (Voiding), and Permanent Deletion.

## 6. Returns
- **Tracking:** View returns against specific invoices.
- **Types:** 
  - Restocked: Adds pieces back to inventory.
  - Damaged/Scrap: Logs the loss without adding to inventory.

## 7. Labels
- **Print Queue:** Select variants and quantities to print.
- **Layouts:** Thermal Roll (1-column, 2-column) and A4 sheets.
- **Customization:** Adjust margins, gaps, barcode height. Fields to toggle include Brand Name, Product Name, SubCode, and Selling Price.
- **Automation:** Uses auto-generated short alphanumeric barcodes.

## 8. Reports
- **Filtering:** Custom date range selection.
- **Metrics:** Total Sales, Collected Money, Outstanding Dues, Invoice Count, Expenses, Net Revenue, Gross Profit (based on historical COGS snapshot), and Stock at Cost.
- **Visuals:** Sales vs Collected trend chart.
- **Export:** CSV export capabilities.

## 9. Price & Stock
- **Modal/Page:** Quick lookup tool for staff.
- **Scanner:** Built-in Camera Scanner to read barcode stickers.
- **Function:** Instantly displays selling price and available stock without initiating a checkout flow.

## 10. Settings & Security
- **Roles:** `Admin` (full access) and `Staff` (restricted access, hidden Cost/Profit metrics).
- **Configuration:** Store details, default tax rates, etc.
