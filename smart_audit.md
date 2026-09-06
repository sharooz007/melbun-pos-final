# 🛡️ MelbunPOS: Master Vulnerability & Edge-Case Catalog (`smart_audit.md`)

> **Audit Policy:** Continuous multi-agent adversarial workflow loop from the UI/Cashier perspective. Strict `/coder` Propose-Audit-Write protocol enforced for all code modifications.

---

## 📌 Architectural Store Policies & Invariant Preferences

1. **Split Payment Policy (`POS-02`)**:
   - Split Payment in POS is intended for immediate, balanced tender distribution across tender types (`Cash + UPI + Store Credit === total`).
   - If a customer pays partially across methods (e.g. ₹5k cash, ₹5k UPI on a ₹15k bill), the cashier bills the first portion with the remainder on credit tab, and subsequent settlements are recorded in the customer's profile dues ledger.
2. **Pack Size Mutability & Recalculation Policy (`INV-05`)**:
   - Pack size (`pieces_per_set`) updates are performed strictly before sales begin to fix initial stock entry typos.
   - When corrected, total inventory is recalculated as:
     $$\text{New Total Pieces} = (\text{stock\_sets} \times \text{new\_pieces\_per\_set}) + \text{loose\_pieces}$$
     where $\text{loose\_pieces} = \text{stock\_quantity} - (\text{stock\_sets} \times \text{old\_pieces\_per\_set})$.
   - The adjustment is permanently logged in the `stock_movements` ledger as `MANUAL_ADJUST` with notes: `"Pack size updated from X to Y pcs/set"`.
3. **Store Credit on Returns Policy (`RET-01`, `c3`)**:
   - The store never hands out physical cash for returns on linked customer accounts; customer returns always credit the customer's store credit wallet (`STORE_CREDIT`).
4. **Whole Integer Pricing Policy (`c4`)**:
   - Product pricing does not use decimal fractions (all selling prices are whole integer rupees).
5. **Customer Credit Limit Policy (`POS-12`)**:
   - Customer credit limits are informational only and not artificially capped or blocked by the system during checkout. Store owners extend credit at their discretion.
6. **POS Cash Tender & Change Policy (`POS-CRIT-02`)**:
   - Cashiers will not enter tendered cash amounts greater than the final invoice total into the POS tender box.
   - The POS strictly blocks overpayments exceeding the final total (`amountPaid <= finalTotal`). Cashiers calculate and dispense cash change manually outside the POS.
7. **POS Cart Zero-Quantity Retention Policy (`POS-MED-01`)**:
   - Decrementing or erasing cart quantity to 0 keeps the row active in the cart table so that cashiers editing quantities via keyboard/backspace do not suffer unexpected row deletions mid-typing. Cashiers review the cart line items prior to completing checkout.
8. **Walk-In Returns Payout Policy (`RET-CRIT-02`)**:
   - Walk-in sales (unregistered / unlinked customers) that undergo returns are permitted to be refunded via Cash or UPI tender directly since they have no persistent customer wallet account.
9. **Undo Void Exact Snapshot Deductions Policy (`INV-07`)**:
   - On `undo_void`, the system re-deducts the exact `sets_quantity` and `quantity` recorded in `invoice_items` during the original checkout. Total pieces (`stock_quantity`) is the primary ground truth.
10. **Walk-In Zero Credit Invariant (`POS-13`)**:
    - Walk-in customers never hold open credit tabs or dues; all walk-in transactions are fully paid at the time of checkout (via Cash or UPI).
11. **Simple Invoice Edit & Manual Reconciliation Policy (`INV-08`)**:
    - Retroactive invoice edits are intended for quick typo, timestamp, and price corrections.
    - If a bill total is adjusted upon editing (e.g. from ₹1000 to ₹800), the collected payment is adjusted to match the new invoice total directly. Any physical cash difference is settled manually in person with the customer outside the POS without complex refund/ledger blockers.
12. **Catalog Cost Price Valuation on Invoice Edit Policy (`INV-09`, `COGS-EDIT-01`)**:
    - When an invoice is retroactively edited and line items are updated, cost prices synchronize with the active catalog `cost_price` to maintain consistency across edited records.
13. **Flexible Device Timezone Buffer Policy (`POS-15`, `DATE-LIMIT-01`)**:
    - The POS invoice date selector relies on the backend PostgreSQL 24-hour future date buffer (`NOW() + INTERVAL '1 day'`) to accommodate multi-timezone device clock drifts rather than hard-clamping client-side calendar pickers to the second.
14. **Retroactive Cost & Profit Recalculation Policy (`INV-10`, `High 4`)**:
    - Retroactive overwrite of `cost_price_snapshot` and `profit_snapshot` on historical closed invoices when catalog cost prices are updated in Pricing Manager is an explicit business decision. The store chooses to synchronize historical profit reports with active catalog variant costs.
15. **Two-State Cheque Lifecycle Policy (`CHQ-01`, `High 9`)**:
    - Cheque tracking intentionally supports only `PENDING` and `CLEARED` states. Dedicated `BOUNCED` or `REJECTED` state machines are deliberately omitted; bounced cheques are handled operationally outside the POS.
16. **Cheque Number De-Duplication Policy (`CHQ-02`, `High 10`)**:
    - Duplicate cheque numbers are permitted across transactions without unique database constraints to support recurring cheque series and multi-deposit workflows.
17. **Authenticated Unified Access Policy (`SEC-01`, `High 15`)**:
    - Standardized `USING (true) WITH CHECK (true)` RLS access for all authenticated staff users is the intended security model for single-tenant internal store operations.
18. **Van Inventory Shrinkage & Road Damage Reconciliation Policy (`VAN-SHRINK-01`, `A-1`, `P2-01`)**:
    - Discarded as an automated POS system feature or bug per store management directive.
    - Operational Policy: In-transit van damage, leakage, or shrinkage is not written off en route.
    - Upon the delivery van returning to base, all physical products are restored/unloaded back onto the main warehouse inventory.
    - Any damaged goods are subsequently audited and manually adjusted in the warehouse ledger using the standard Inventory Adjustment (`MANUAL_ADJUST`) interface with explanatory manager notes.
19. **Discrete Invoice Payment Settlement Policy (`PAY-LUMP-01`, `P2-07`)**:
    - Multi-invoice lump-sum payment allocation across arbitrary customer debts is intentionally discarded as a feature and deemed unnecessary by the store.
    - Cashiers and line salesmen collect payments strictly on a transparent per-invoice basis using the dedicated "Pay Tab" / "Pay Invoice" flow.
    - Unallocated bulk remittances are intentionally disallowed in the POS UI to prevent ambiguous debt apportionment, partial interest disputes, and opaque credit reconciliation.

---

## 📊 Comprehensive Re-Audit Scorecard (Cycle 3)

| Severity | Total | Status | Primary Focus Area |
| :--- | :---: | :---: | :--- |
| 🔴 **Tier 1: Critical (P0)** | **6** | **ALL 6 RESOLVED ✅** | Barcode double-add guard, Cash change policy, Product edit sets preservation, Reports RPC schema sync, POS search bar hardware scanner DOM event capture (`POS-CRIT-03`), and Negative cash/UPI tender guard (`POS-CRIT-04`). |
| 🟠 **Tier 2: High (P1)** | **11** | **ALL 11 RESOLVED ✅** | Cart item title cleanup, PDF summary box page break clearance, Label query sanitization & auth, Category modal router.refresh, Customer blank name guard, unknown barcode toast, customer phone search dropdown, split credit reset, real-time expense KPI sync, Split modal background scanner lock (`POS-HIGH-05`), and Label Studio hardware scanner support (`LAB-HIGH-02`). |
| 🟡 **Tier 3: Medium (P2)** | **19** | **ALL 19 RESOLVED ✅** | Inactive customer return credit default, negative refund payment styling, PDF ASCII sanitization, stock arrivals keydown filters, customer profile deactivation action, store GSTIN 15-char regex, cart zero-quantity retention, POS form input lock, Split modal escape/backdrop dismissal, single status banner in POS, label queue immutable updates, Label Studio customHeader input, lookup scanner buffer 150ms stabilization, camera viewfinder 16:9 reticle alignment, inventory master catalog search debounce (`INV-MED-02`), stock ledger timezone boundary alignment (`LEDG-MED-01`), reports custom date error UI toast (`REP-MED-01`), and settings unsaved changes beforeunload guard (`SETT-MED-02`). |
| 🟢 **Tier 4: Low (P3)** | **10** | **ALL 10 RESOLVED ✅** | Dedicated Clear Cart button, returns single loose pieces clamp, Inspect modal snapshot columns, initial mount duplicate fetch guard, PDF filename special character sanitization, customer pay tab 0.01 step/min, thermal 1-column last-child page break, variant name ellipsis on 25mm labels, BarcodeSvg 4-module quiet zone, and focused lookup scanner enter trigger. |
| **Total Master Catalog** | **46** | **ALL 46 RESOLVED & VERIFIED ✅** | **Active Re-Audit Loop Catalog** |

---

## 🔴 Tier 1: Critical Risk (P0) — ALL 6 RESOLVED & VERIFIED ✅

### 1. `POS-CRIT-01`: Barcode Double-Add Prevention When Search Bar Is Focused
* **Files:** [`src/app/pos/page.tsx:167-175`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L167)
* **Status:** `RESOLVED ✅` (`handleGlobalKeyDown` returns early if `isInput` is true, ensuring `handleSearchKeyDown` alone processes scans when search input has focus).

### 2. `POS-CRIT-02`: Cash Tender Change Calculation Policy
* **File:** [`smart_audit.md`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/smart_audit.md)
* **Status:** `RESOLVED / INTENDED WORKFLOW ✅` (Enforces overpayment blocking; store cashiers calculate change manually outside POS per store policy).

### 3. `INV-CRIT-01`: Product Edit Packaged Sets Preservation
* **Files:** [`src/components/inventory/AddProductModal.tsx:96`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/inventory/AddProductModal.tsx#L96), [`supabase/migrations/0052_critical_fixes_cycle2.sql:120`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0052_critical_fixes_cycle2.sql#L120)
* **Status:** `RESOLVED ✅` (`update_product_with_variants` RPC updated to omit `stock_sets = COALESCE(v_variant.initial_sets, stock_sets)` for existing variants, preserving live packaged sets).

### 4. `REP-CRIT-01`: Database RPC Schema Synchronization for Reports
* **File:** [`supabase/migrations/0052_critical_fixes_cycle2.sql:180-450`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0052_critical_fixes_cycle2.sql#L180)
* **Status:** `RESOLVED ✅` (`get_comprehensive_reports` return payload aligned with `ReportsPage.tsx` interface, restoring all 8 KPI cards, payment breakdown, sales trends, and drilldown tables).

### 5. `POS-CRIT-03`: POS Search Bar Hardware Scanner Race Condition
* **File:** [`src/app/pos/page.tsx:145-165`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L145)
* **Status:** `RESOLVED ✅` (`handleSearchKeyDown` reads directly from `e.currentTarget.value` and checks existing `searchResults` cache, eliminating partial barcode search failures).

### 6. `POS-CRIT-04`: Negative Cash/UPI Tender Guard
* **File:** [`src/app/pos/page.tsx:485-500, 1075-1210`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L485)
* **Status:** `RESOLVED ✅` (`handleCheckout` strictly blocks negative tenders with error toast, and inputs enforce `min="0"` and keydown filters for `+`/`-`).

---

## 🟠 Tier 2: High Risk (P1) — ALL 11 RESOLVED & VERIFIED ✅

### 7. `POS-HIGH-01`: Cart Line Items Render Title Cleanly Without `"undefined - "`
* **File:** [`src/app/pos/page.tsx:236`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L236)
* **Status:** `RESOLVED ✅` (Constructs title using fallback `variant.product_name ? \`${variant.product_name} - ${variant.name}\` : (variant.name || 'Item')`).

### 8. `PDF-HIGH-01`: Dynamic Summary Box Height Pre-Check Before Page Break
* **File:** [`src/lib/pdf/generateInvoice.ts:364-390`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/pdf/generateInvoice.ts#L364)
* **Status:** `RESOLVED ✅` (Calculates dynamic `totalsBoxHeight` based on tax, discount, returns, and payment rows before checking `currentY + totalsBoxHeight > pageHeight - 20`, preventing footer collision).

### 9. `LAB-HIGH-01`: Label Search Product Query Sanitization & Auth
* **File:** [`src/lib/actions/labels.ts:16-45`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/labels.ts#L16)
* **Status:** `RESOLVED ✅` (Enforces user authentication and resolves parent product IDs before querying `variants`, fixing PostgREST nested `.or()` exception).

### 10. `CAT-HIGH-01`: Category Management Immediate Revalidation
* **File:** [`src/components/inventory/CategoriesModal.tsx:18, 38, 67, 86`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/inventory/CategoriesModal.tsx#L18)
* **Status:** `RESOLVED ✅` (Added `router.refresh()` upon category create, edit, and delete actions so modal and dropdown lists update immediately).

### 11. `CUST-HIGH-01`: Customer Edit Empty Name Guard
* **Files:** [`src/lib/actions/customers.ts:275`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/customers.ts#L275), [`src/app/customers/[id]/CustomerDetailClient.tsx:152`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/customers/%5Bid%5D/CustomerDetailClient.tsx#L152)
* **Status:** `RESOLVED ✅` (Enforced non-empty name validations on client modal and server action).

### 12. `POS-HIGH-02`: Global Barcode Gun Scans Error Notification
* **File:** [`src/app/pos/page.tsx:188`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L188)
* **Status:** `RESOLVED ✅` (Added error status toast when hardware barcode gun scans an item that does not exist in inventory).

### 13. `POS-HIGH-03`: Customer Phone Search Dropdown Visibility
* **File:** [`src/app/pos/page.tsx:760-802`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L760)
* **Status:** `RESOLVED ✅` (Suggestions dropdown anchored across both Name and Phone inputs).

### 14. `POS-HIGH-04`: Reset Stale Split Credit on Customer Edit
* **File:** [`src/app/pos/page.tsx:768`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L768)
* **Status:** `RESOLVED ✅` (Clears `splitCredit` and `splitSaved` when modifying customer name/phone).

### 15. `EXP-HIGH-01`: Real-Time Expense Summary KPI Metric Cards
* **File:** [`src/app/expenses/page.tsx:395-418`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/expenses/page.tsx#L395)
* **Status:** `RESOLVED ✅` (Connected top KPI cards directly to derived reactive state `totalExpenseSum`, `cashExpenseSum`, `upiExpenseSum`, and `voidedCount`).

### 16. `POS-HIGH-05`: Modal Lock for Global USB Barcode Scanner
* **File:** [`src/app/pos/page.tsx:170-185`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L170)
* **Status:** `RESOLVED ✅` (`handleGlobalKeyDown` ignores background scanner events when Split Payment modal is open via `isSplitModalOpenRef`).

### 17. `LAB-HIGH-02`: Label Studio Hardware USB Scanner Support & Enter Key Trigger
* **File:** [`src/app/labels/page.tsx:80-120, 275-285`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/labels/page.tsx#L80)
* **Status:** `RESOLVED ✅` (Added 150ms global keydown capture buffer and instant `Enter` key trigger on search input in Label Studio).

---

## 🟡 Tier 3: Medium Risk (P2) — ALL 19 RESOLVED & VERIFIED ✅

### 18. `RET-MED-01`: Inactive Customer Return Method Defaulting
* **File:** [`src/app/returns/page.tsx:152`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/returns/page.tsx#L152)
* **Status:** `RESOLVED ✅` (Defaults `refundMethod` to `'STORE_CREDIT'` only if customer account is present AND `is_active !== false`; defaults to `'CASH'` otherwise).

### 19. `INV-MED-01`: Negative Refund Payment Ledger Rows Styling
* **File:** [`src/app/invoices/InvoicesClient.tsx:580-595`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/InvoicesClient.tsx#L580)
* **Status:** `RESOLVED ✅` (Negative refund offset rows now styled in red with clear `"Refund Offset"` label).

### 20. `PDF-MED-01`: Customer Details & Store Settings ASCII Sanitization
* **File:** [`src/lib/pdf/generateInvoice.ts:125-215`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/pdf/generateInvoice.ts#L125)
* **Status:** `RESOLVED ✅` (Wrapped customer name, phone, gstin, and store settings branding in `cleanAscii()` to eliminate glyph corruption in Helvetica).

### 21. `ARR-MED-01` & `ARR-MED-02`: Numeric Input Guards on Stock Arrivals
* **File:** [`src/components/inventory/ReceiveStockModal.tsx:135-145`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/inventory/ReceiveStockModal.tsx#L135)
* **Status:** `RESOLVED ✅` (Added `onKeyDown` filter for `['e', 'E', '+', '-']` and `onFocus={e => e.target.select()}` to sets and loose inputs).

### 22. `CUST-MED-01`: Customer Profile Deactivation Action
* **File:** [`src/app/customers/[id]/CustomerDetailClient.tsx:215-240`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/customers/%5Bid%5D/CustomerDetailClient.tsx#L215)
* **Status:** `RESOLVED ✅` (Added "Deactivate Account" button with balance and debt zero-trust guards calling `deactivateCustomerAction`).

### 23. `SETT-MED-01`: Store Settings GSTIN Regex Validation
* **File:** [`src/lib/actions/settings.ts:14`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/settings.ts#L14)
* **Status:** `RESOLVED ✅` (Enforced standard 15-character uppercase alphanumeric regex validation `/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$|^$/`).

### 24. `POS-MED-01`: Cart Zero-Quantity Retention During Mid-Typing
* **File:** [`smart_audit.md`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/smart_audit.md)
* **Status:** `RESOLVED / INTENDED WORKFLOW ✅` (Preserved zero-quantity cart retention to protect cashiers while typing/backspacing).

### 25. `POS-MED-02`: POS Form Input Lock During Checkout
* **File:** [`src/app/pos/page.tsx:770-950`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L770)
* **Status:** `RESOLVED ✅` (Assigned `disabled={loading}` across customer inputs, discount presets, round-off, GST toggle, and tender buttons).

### 26. `POS-MED-03`: Split Modal Escape & Backdrop Dismissal
* **File:** [`src/app/pos/page.tsx:100-1125`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L100)
* **Status:** `RESOLVED ✅` (Added backdrop click handler and global `Escape` key event listener).

### 27. `POS-MED-04`: Single Clear Status Banner in POS
* **File:** [`src/app/pos/page.tsx:580`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L580)
* **Status:** `RESOLVED ✅` (Removed redundant left column status banner, displaying checkout feedback cleanly above summary panel).

### 28. `LAB-MED-01`: Label Queue Immutable Update
* **File:** [`src/app/labels/page.tsx:133`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/labels/page.tsx#L133)
* **Status:** `RESOLVED ✅` (Fixed shallow object mutation in `fillAllFromStock` by returning `{ ...updated[existingIdx], quantity: variant.stock_quantity }`).

### 29. `LAB-MED-02`: Label Studio Custom Header Store Name Input
* **File:** [`src/app/labels/page.tsx:445`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/labels/page.tsx#L445)
* **Status:** `RESOLVED ✅` (Added custom header text input in Layout Settings toolbar).

### 30. `LOOK-MED-01`: Hardware Scanner Buffer 150ms Stabilization
* **File:** [`src/app/lookup/page.tsx:30-100`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/lookup/page.tsx#L30)
* **Status:** `RESOLVED ✅` (Stabilized `executeSearch` with `loadingRef` and increased scanner keydown buffer threshold to 150ms).

### 31. `CAM-MED-01`: Camera Viewfinder 16:9 Reticle Alignment & Escape Key
* **File:** [`src/components/lookup/CameraScanner.tsx:100-165`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/lookup/CameraScanner.tsx#L100)
* **Status:** `RESOLVED ✅` (Adjusted reticle to `aspect-[16/9]` matching the 1D decoder window, added `Escape` key close handler).

### 32. `INV-MED-02`: Inventory Master Catalog Search Debounce
* **File:** [`src/components/inventory/InventoryClient.tsx:20-130`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/inventory/InventoryClient.tsx#L20)
* **Status:** `RESOLVED ✅` (Added 250ms debounced search query state to prevent UI re-filtering lag on large inventories).

### 33. `LEDG-MED-01`: Stock Ledger Timezone Safe Boundaries
* **File:** [`src/app/inventory/ledger/LedgerClient.tsx:75-85`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/inventory/ledger/LedgerClient.tsx#L75)
* **Status:** `RESOLVED ✅` (Passed timezone-aware ISO string boundary parameters `+05:30` to prevent client device clock drift).

### 34. `REP-MED-01`: Reports Custom Date Range Validation Toast
* **File:** [`src/app/reports/page.tsx:145-155, 515-520`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/reports/page.tsx#L145)
* **Status:** `RESOLVED ✅` (Replaced native browser `alert()` with styled inline UI alert banner).

### 35. `SETT-MED-02`: Store Settings Unsaved Changes Guard
* **File:** [`src/app/settings/page.tsx:65-115`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/settings/page.tsx#L65)
* **Status:** `RESOLVED ✅` (Added `isDirty` state tracking and `beforeunload` window listener to protect unsaved store configurations).

### 36. `RET-CRIT-02`: Walk-In Returns Cash/UPI Payout Policy
* **File:** [`smart_audit.md`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/smart_audit.md)
* **Status:** `RESOLVED / INTENDED WORKFLOW ✅` (Documented Store Policy 8 permitting cash/UPI payouts for unlinked walk-in returns).

---

## 🟢 Tier 4: Low Risk (P3) — ALL 10 RESOLVED & VERIFIED ✅

### 37. `POS-LOW-01`: Dedicated "Clear Cart" Button
* **File:** [`src/app/pos/page.tsx:580`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx#L580)
* **Status:** `RESOLVED ✅` (Added dedicated "Clear Cart" action with confirmation prompt next to cart header).

### 38. `RET-LOW-01`: Single Loose Items Return Clamp
* **File:** [`src/app/returns/page.tsx:568`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/returns/page.tsx#L568)
* **Status:** `RESOLVED ✅` (Clamped single loose piece input to `Math.min(remainingPieces, ...)`).

### 39. `INV-LOW-01`: Invoices Inspection Modal Historical Cost & Profit Columns
* **File:** [`src/app/invoices/InvoicesClient.tsx:550`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/InvoicesClient.tsx#L550)
* **Status:** `RESOLVED ✅` (Preserved full line item breakdown with sets, loose, total pieces, and price).

### 40. `INV-LOW-02`: Eliminate Redundant Invoices Fetch on Initial Mount
* **File:** [`src/app/invoices/InvoicesClient.tsx:70`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/InvoicesClient.tsx#L70)
* **Status:** `RESOLVED ✅` (Added `isFirstMount` guard to prevent duplicate client fetch when SSR data is present).

### 41. `PDF-LOW-01`: PDF Filename Special Characters Sanitization
* **File:** [`src/lib/pdf/generateInvoice.ts:516`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/pdf/generateInvoice.ts#L516)
* **Status:** `RESOLVED ✅` (Sanitized filename with `.replace(/[^a-zA-Z0-9_-]/g, '_')`).

### 42. `CUST-LOW-01`: Customer Pay Tab 0.01 Step & Min Attributes
* **File:** [`src/app/customers/[id]/CustomerDetailClient.tsx:556`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/customers/%5Bid%5D/CustomerDetailClient.tsx#L556)
* **Status:** `RESOLVED ✅` (Added `step="0.01"` and `min="0.01"` to amount input).

### 43. `LAB-LOW-01`: Thermal 1-Column Trailing Blank Label Fix
* **File:** [`src/app/labels/page.tsx:685`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/labels/page.tsx#L685)
* **Status:** `RESOLVED ✅` (Added `.print-container.thermal-1col .print-label-card:last-child { page-break-after: auto; }`).

### 44. `LAB-LOW-02`: 25mm Label Variant Text Truncation Ellipsis
* **File:** [`src/app/labels/page.tsx:765`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/labels/page.tsx#L765)
* **Status:** `RESOLVED ✅` (Added `max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to `.label-variant`).

### 45. `BAR-LOW-01`: Barcode Vector Quiet Zone Margin
* **File:** [`src/components/BarcodeSvg.tsx:59-75`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/BarcodeSvg.tsx#L59)
* **Status:** `RESOLVED ✅` (Added 4-module quiet zone padding to vector SVG bars for optical scanners).

### 46. `LOOK-LOW-01`: Lookup Focused Search Input Scanning Enter Trigger
* **File:** [`src/app/lookup/page.tsx:85`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/lookup/page.tsx#L85)
* **Status:** `RESOLVED ✅` (Handled rapid hardware barcode bursts with 150ms buffer and instant Enter submit).

---

## ⚡ Cycle 4: External Audit Category A Bug Fixes — ALL 18 RESOLVED & VERIFIED ✅

1. **`INV-BUG-01` (Variant Removal Stock Write-off Logging)**: Updated `update_product_with_variants` RPC (`supabase/migrations/0053_category_a_fixes.sql`) to insert `-v_var_rec.stock_quantity` into `stock_movements` upon variant removal during product edits.
2. **`REP-BUG-01` (Reports Error Isolation)**: Isolated error states in `src/app/reports/page.tsx`, displaying a retry banner instead of retaining stale financial data under modified date range labels.
3. **`REP-BUG-02` (Monthly Sales Cutoff Alignment)**: Updated `get_comprehensive_reports` RPC (`0053_category_a_fixes.sql`) to group monthly sales with business-day cutoff interval subtraction.
4. **`REP-BUG-03` (Custom Report Range Validation)**: Updated `src/lib/business-day.ts` to cleanly prompt for custom date input without silent fallback or corrupting custom pill selection.
5. **`POS-BUG-01` (Background Scanner Exact Match)**: Updated `src/app/pos/page.tsx` so hardware USB scanner buffers only auto-add upon an exact barcode or SKU match.
6. **`POS-BUG-02` (Tender Float Comparison)**: Updated `src/app/pos/page.tsx` tender auto-matching to use float comparison (`Math.abs < 0.01`), preserving manual partial tenders without string formatting bugs.
7. **`LEDG-BUG-01` (Stock Ledger Initial Stock Filter)**: Added `INITIAL_STOCK` filter option and badge styling to `src/app/inventory/ledger/LedgerClient.tsx`.
8. **`BAR-BUG-01` (Barcode Character Validation)**: Sanitized Code 128 character sets in `src/components/BarcodeSvg.tsx` to ensure 1:1 parity between rendered vector bars and human-readable text.
9. **`LAB-BUG-01` (Thermal 2-Column Trailing Feed)**: Added `:last-child` page-break override in `src/app/labels/page.tsx` to prevent blank feed ejection on odd-count print queues.
10. **`LEDG-BUG-02` (Ledger Invoice Link Regex)**: Tightened regex matching in `src/app/inventory/ledger/LedgerClient.tsx` to valid invoice formats (`MELBUN/\d{4}/...`).
11. **`DASH-BUG-01` (Dashboard Gross Profit Null Handling)**: Updated `src/app/page.tsx` to display `—` when gross profit is null rather than misleading `₹0.00`.
12. **`DASH-BUG-02` (Dashboard Refresh Symmetric Error State)**: Updated `src/app/page.tsx` to handle invoice and expense refetches symmetrically with error alerts.
13. **`EXP-BUG-01` (Expense KPI Full Summary)**: Connected KPI cards in `src/app/expenses/page.tsx` directly to the server-side full database summary aggregates (`metricsSummary`).
14. **`REP-BUG-04` (CSV Formula Injection Protection)**: Escaped formula injection characters (`=, +, -, @, \t, \r`) in `src/app/reports/page.tsx` CSV export.
15. **`REP-BUG-05` (Daily & Monthly Sales Extra Columns)**: Added `invoice_count` and `discount_amount` fields to `daily_sales` and `monthly_sales` in `0053_category_a_fixes.sql`.
16. **`REP-BUG-06` (Reports Invoices Schema Contract)**: Aligned `get_comprehensive_reports` RPC to supply `paid_amount`, `primary_method`, `status`, and `is_voided`.
17. **`REP-BUG-07` (Reports Tab Pagination Isolation)**: Isolated pagination resets in `src/app/reports/page.tsx` to prevent multi-tab state pollution.
18. **`SETT-BUG-01` (Settings Cutoff Description Formatter)**: Formatted business day cutoff description in `src/app/settings/page.tsx` deterministically from integer hour.

---

## 📱 Cycle 5: Mobile-First POS & Touch Ergonomics — ALL IMPLEMENTED & VERIFIED ✅

1. **`POS-MOB-01` (Continuous Mobile Camera Barcode Scanner)**: Added dedicated `Camera Scan` button and integrated `CameraScanner` modal on `/pos` with continuous scanning, 1200ms identical-code debounce, haptic feedback (`vibrate(100)`), on-screen item added badge, and "Done / View Cart" action.
2. **`POS-MOB-02` (Touch Steppers & Viewport Protection)**: Expanded `+` and `−` stepper button touch targets (44px min) in POS cart rows and adjusted input typography to prevent iOS Safari/Chrome viewport auto-zoom shifts.
3. **`POS-MOB-03` (Styled Clear Cart Confirmation Modal)**: Replaced native `window.confirm()` in POS with an accessible, high-contrast modal displaying cart item count and total monetary impact.
4. **`INV-MOB-01` (Styled Product Delete Confirmation Modal)**: Replaced native `window.confirm()` in `InventoryClient.tsx` with a styled dialog displaying product name, total variants, and active stock write-off warning.
5. **`INV-MOB-02` (Mobile Invoices Card Layout)**: Added responsive mobile cards for Invoices (`src/app/invoices/InvoicesClient.tsx`) with status badges, customer info, inspect modal trigger, and PDF generation.
6. **`EXP-MOB-01` (Mobile Expense Card Layout)**: Added responsive mobile cards for Expenses (`src/app/expenses/page.tsx`) with timestamps, category, payment method badge, and inline edit/void actions.
7. **`LEDG-MOB-01` (Mobile Stock Movements Card Layout)**: Added responsive mobile cards for Stock Ledger (`src/app/inventory/ledger/LedgerClient.tsx`) with quantity changes, movement type badge, and clickable invoice deep links.

---

## 🔒 Cycle 6: Database RPC Integrity & Multi-Agent Hardening — ALL RESOLVED & VERIFIED ✅

1. **`RPC-FIX-01` (Reports Aggregation & Timezone Arithmetic)**:
   - File: [`supabase/migrations/0055_final_rpc_integrity_fixes.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0055_final_rpc_integrity_fixes.sql)
   - Resolution: Resolved nested aggregate subquery errors in `get_comprehensive_reports` by restructuring `invoice_days`, `payment_days`, and `invoice_items_per_inv` into preliminary CTEs. Aligned business-day cutoff interval math (`(created_at AT TIME ZONE v_timezone) - (v_cutoff_hour || ' hours')::interval`) and added payment exclusion for voided/hidden invoices.
2. **`RPC-FIX-02` (Dashboard Metrics Schema Contract & Void Guard)**:
   - File: [`supabase/migrations/0055_final_rpc_integrity_fixes.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0055_final_rpc_integrity_fixes.sql)
   - Resolution: Synchronized `get_dashboard_metrics` return payload with `src/types/dashboard.ts` and `src/app/page.tsx` (`net_sales`, `gross_profit`, `total_expenses`, `net_profit`, `collected_payments`, `invoice_count`, `low_stock_items`). Added voided invoice payment exclusion and explicit `SET search_path = public, extensions`.
3. **`RPC-FIX-03` (Product Edit Initial Stock Enum Correction & Pack Size Delta)**:
   - File: [`supabase/migrations/0055_final_rpc_integrity_fixes.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0055_final_rpc_integrity_fixes.sql)
   - Resolution: Corrected movement type from invalid `'INITIAL_STOCK'` to `'ARRIVAL'::stock_movement_type` in `update_product_with_variants`. Restored pack size inventory delta calculation loop with `MANUAL_ADJUST` stock movement logging and added explicit `IF NOT FOUND THEN RAISE EXCEPTION 'Product not found';` row-lock guard.

---

---

## 🔒 Cycle 8: Invoice Hardening & Usability Polish — ALL RESOLVED & VERIFIED ✅

1. **`INV-HARD-01` (Multi-Row Variant Stock Pre-Aggregation on Undo Void)**:
   - File: [`supabase/migrations/0057_invoice_hardening.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0057_invoice_hardening.sql)
   - Resolution: Added variant pre-aggregation (`GROUP BY ii.variant_id, v.name, v.stock_quantity`) using `SUM(GREATEST(0, ii.quantity - COALESCE(r.ret_qty, 0)))` in `undo_void_invoice`, eliminating multi-row cumulative over-deductions.
2. **`INV-HARD-02` (Targeted SALE Timestamp Cascades)**:
   - File: [`supabase/migrations/0057_invoice_hardening.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0057_invoice_hardening.sql)
   - Resolution: Constrained `stock_movements` timestamp updates in `update_invoice_details` to `AND type = 'SALE'`, preserving historical return restock and scrap movement timestamps in the ledger.
3. **`INV-UX-01` (Modal Backdrop & Escape Key Ergonomics)**:
   - File: [`src/app/invoices/InvoicesClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/InvoicesClient.tsx)
   - Resolution: Added global `Escape` key listener and backdrop `onClick` dismissal handlers across all 5 modals (Void, Inspect, Undo Void, Delete, Edit) with active operation loading guards.
4. **`INV-UX-02` (Searchable Customer Selector in Edit Modal)**:
   - File: [`src/app/invoices/InvoicesClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/InvoicesClient.tsx)
   - Resolution: Replaced static `<select>` with a searchable customer combobox supporting real-time name and phone filtering, selection highlight badges, and 1-click "Reset to Walk-in".
5. **`INV-UX-03` (Dynamic Pagination Recalculation & Mobile Touch Targets)**:
   - File: [`src/app/invoices/InvoicesClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/InvoicesClient.tsx)
   - Resolution: Dynamically recalculated `totalPages` (`Math.max(1, Math.ceil(newTotal / 25))`) and clamped `currentPage` on optimistic delete. Expanded mobile action button touch targets to `px-3 py-2` with `min-h-[36px]`.

---

## ⚡ Cycle 9: Full POS Total Editability & Backdated Checkout Engine — ALL RESOLVED & VERIFIED ✅

1. **`POS-EDIT-01` (Full Invoice Edit in POS Engine & Stock Delta Synchronization)**:
   - Files: [`supabase/migrations/0058_full_invoice_edit_rpc.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0058_full_invoice_edit_rpc.sql), [`src/lib/actions/checkout.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/checkout.ts), [`src/app/pos/page.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx)
   - Resolution: Implemented `update_full_invoice` RPC in PostgreSQL with Return Integrity Guard, deadlock-free deterministic variant & customer locking (`ORDER BY id FOR UPDATE`), atomic inventory delta recalculation, store credit wallet re-balancing (`'MANUAL_ADJUST'::credit_movement_type`), and authoritative server-side tax/total verification.
2. **`POS-EDIT-02` (Seamless POS Edit State & High-Contrast Banner)**:
   - Files: [`src/app/pos/page.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx), [`src/app/invoices/InvoicesClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/InvoicesClient.tsx)
   - Resolution: Clicking "Edit" on `/invoices` immediately routes to `/pos?editInvoiceId=${inv.id}` with pre-populated cart items, quantities, prices, customer, discount, taxes, round-off, payment method, and timestamp. Displays prominent Amber Edit Banner with 1-click "Cancel & Return to Invoices".
3. **`POS-DATE-01` (Backdated Checkout from POS Sidebar)**:
   - Files: [`supabase/migrations/0058_full_invoice_edit_rpc.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0058_full_invoice_edit_rpc.sql), [`src/lib/actions/checkout.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/checkout.ts), [`src/app/pos/page.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx)
   - Resolution: Upgraded `process_checkout` with `p_created_at TIMESTAMPTZ DEFAULT NULL` and added "Invoice Date & Time" selector directly inside the POS checkout panel, enabling cashiers to bill backdated invoices on the fly.

---

## 🛡️ Cycle 10: Adversarial Audit & Zod Inheritance Hardening — ALL RESOLVED & VERIFIED ✅

1. **`ZOD-CRIT-01` (Zod Schema Inheritance Runtime Crash on Full Invoice Edit)**:
   - File: [`src/lib/actions/checkout.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/checkout.ts)
   - Resolution: Separated `baseCheckoutObjectSchema` from `.superRefine(refineCheckoutData)`, allowing `updateFullInvoiceSchema` to extend the base object cleanly with `invoice_id: z.string().uuid()` and attach the shared refinement function, eliminating runtime `TypeError: checkoutSchema.extend is not a function`.
2. **`INV-NULL-01` (Invoice Details Date Nullability)**:
   - File: [`src/lib/actions/invoices.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/invoices.ts)
   - Resolution: Added `.nullable()` to `updateInvoiceDetailsSchema.created_at`, permitting `{ created_at: null }` payloads without validation rejection.
3. **`DASH-SYNC-01` (Dashboard Cache Invalidation on Invoice Mutations)**:
   - File: [`src/lib/actions/checkout.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/checkout.ts)
   - Resolution: Added `revalidatePath('/dashboard')` to both `processCheckoutAction` and `updateFullInvoiceAction`.
4. **`UI-RET-LOCK-01` (Proactive Edit Lock for Invoices with Processed Returns)**:
   - Files: [`src/app/invoices/InvoicesClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/InvoicesClient.tsx), [`src/app/invoices/[id]/InvoiceDetailClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/%5Bid%5D/InvoiceDetailClient.tsx)
   - Resolution: Disabled Edit button when `total_refunds > 0` or returns exist with informative tooltip `"Editing locked: Returns exist for this invoice"`, providing upfront cashier visual feedback before navigation.
5. **`ROUTE-PARAM-01` (Navigation Query Parameter Normalization)**:
   - Files: [`src/app/invoices/InvoicesClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/InvoicesClient.tsx), [`src/app/invoices/[id]/InvoiceDetailClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/%5Bid%5D/InvoiceDetailClient.tsx)
   - Resolution: Standardized all POS edit navigation links to `/pos?editInvoiceId=${id}`.

---

## 🏆 Cycle 11: Core P0 Invariants & Store Policy Alignments — ALL RESOLVED & VERIFIED ✅

1. **`P0-RET-01` (Pack Size Divisor Regression in `process_return`)**:
   - File: [`supabase/migrations/0086_fix_p0_returns_pack_size_and_invoice_edit_stock_audit.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0086_fix_p0_returns_pack_size_and_invoice_edit_stock_audit.sql)
   - Resolution: Restored variant-level pack size priority `v_pps := GREATEST(COALESCE(v_variant.pieces_per_set, v_product.pieces_per_set, 1), 1);` and `v_total_pieces_to_return := (p_sets_quantity * v_pps) + p_loose_quantity;`. Populated `sets_change` and `loose_change` on `stock_movements`.
2. **`P0-INV-01` (Stock Movement Audit Deletion & FK Nullification in `update_full_invoice`)**:
   - File: [`supabase/migrations/0086_fix_p0_returns_pack_size_and_invoice_edit_stock_audit.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0086_fix_p0_returns_pack_size_and_invoice_edit_stock_audit.sql)
   - Resolution: Completely eliminated destructive `DELETE FROM stock_movements` and `invoice_item_id = NULL`. Implemented append-only compensating delta movements (`'MANUAL_ADJUST'`), in-place `invoice_items` reconciliation, and dedicated van stock isolation (`line_van_inventory` & `line_stock_movements`).
3. **`POL-HIGH-04` (Retroactive Cost & Profit Overwrite)**:
   - Status: `RESOLVED / INTENDED STORE POLICY ✅` (Confirmed as Policy 14: Historical invoices update profit snapshots when catalog cost is revised).
4. **`POL-HIGH-09` (Two-State Cheque Lifecycle)**:
   - Status: `RESOLVED / INTENDED STORE POLICY ✅` (Confirmed as Policy 15: Two-state `PENDING`/`CLEARED` flow is intentional).
5. **`POL-HIGH-10` (Cheque Number Duplication Allowance)**:
   - Status: `RESOLVED / INTENDED STORE POLICY ✅` (Confirmed as Policy 16: Duplicate cheque numbers permitted across transactions).
6. **`POL-HIGH-15` (Permissive Authenticated RLS Access)**:
   - Status: `RESOLVED / INTENDED STORE POLICY ✅` (Confirmed as Policy 17: Standard authenticated access across terminals is intentional).

---

## 💎 Cycle 12: All 11 P1 High Integrity & Edge Issues — ALL RESOLVED & VERIFIED ✅

1. **`HIGH-01` (PDF Returns Summary Deduction Reconciliation)**:
   - File: [`src/lib/pdf/generateInvoice.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/pdf/generateInvoice.ts)
   - Resolution: When `returnedAmount > 0`, explicitly rendered "Returns Deducted: -₹X" and "Net Payable: ₹Y" in the totals box and updated the invoice amount in words to match net payable, reconciling totals with refunds.
2. **`HIGH-02` (PDF Page Overflow Totals Cutoff Prevention)**:
   - File: [`src/lib/pdf/generateInvoice.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/pdf/generateInvoice.ts)
   - Resolution: Added dynamic height estimation (`totalsBoxHeight`, factoring in returns lines and GST breakdown) and evaluated `currentY + totalsBoxHeight > pageHeight - margin` before Section 6, triggering `doc.addPage()` to prevent totals being cutoff at page boundaries.
3. **`HIGH-03` (`undo_void_invoice` Packaged Sets Validation & Clamping)**:
   - File: [`supabase/migrations/0087_fix_p1_high_integrity_issues.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0087_fix_p1_high_integrity_issues.sql)
   - Resolution: Added deterministic pessimistic locks (`ORDER BY v.id FOR UPDATE` and `ORDER BY lvi.variant_id FOR UPDATE`), validated `stock_sets >= v_sets_to_deduct`, and clamped sets via `GREATEST(0, LEAST(stock_sets - v_sets_to_deduct, FLOOR((stock_quantity - v_net_pieces_to_deduct)::numeric / effective_pps)))`.
4. **`HIGH-05` (Stock Ledger Filter & Badge ENUM Alignment)**:
   - File: [`src/app/inventory/ledger/LedgerClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/inventory/ledger/LedgerClient.tsx)
   - Resolution: Removed non-existent `'INITIAL_STOCK'` option and registered valid database ENUMs `'LINE_DISPATCH'` and `'LINE_RESTOCK'` in both the dropdown filter and table badge renders.
5. **`HIGH-06` (Fleet Van Stock Integration in Asset Valuation & Reports)**:
   - File: [`supabase/migrations/0087_fix_p1_high_integrity_issues.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0087_fix_p1_high_integrity_issues.sql)
   - Resolution: Joined `line_van_inventory` across `v_stock_at_cost`, Tab 10 `stock_cost`, and Tab 12 `stock_by_category` in `get_comprehensive_reports`, correctly valuing total inventory across both warehouse and van fleet.
6. **`HIGH-07` (Expense Aggregation RPC Bypassing 1,000-Row Cap)**:
   - Files: [`supabase/migrations/0087_fix_p1_high_integrity_issues.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0087_fix_p1_high_integrity_issues.sql), [`src/lib/actions/expenses.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/expenses.ts)
   - Resolution: Created PostgreSQL RPC `get_expense_summary_metrics` that aggregates active sums (`FILTER (WHERE is_voided = FALSE)`), cash, upi, and voided counts directly in the database engine, bypassing PostgREST row limits.
7. **`HIGH-08` (Un-Phoned Walk-In Customer Collision Prevention)**:
   - File: [`supabase/migrations/0087_fix_p1_high_integrity_issues.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0087_fix_p1_high_integrity_issues.sql)
   - Resolution: In `get_or_create_customer`, bypassed `LOWER(name)` matching when phone is NULL/empty, generating discrete customer records for un-phoned walk-in customers to prevent cross-customer balance or dues merging.
8. **`HIGH-11` (Hardware USB Scanner Keystroke Leak Prevention)**:
   - File: [`src/app/pos/page.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx)
   - Resolution: Built a capture-phase 50ms keystroke buffer that detects barcode scanner bursts, strips the leaked first character via dynamic prototype property setter (`HTMLInputElement` vs `HTMLTextAreaElement`), and blurs focused inputs on Enter.
9. **`HIGH-12` (Unified Modal & Checkout Submission Locks on Scanner)**:
   - File: [`src/app/pos/page.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx)
   - Resolution: Synchronized `isAnyModalOpenRef` across all 6 modals (Split Payment, Clear Cart, Camera, Product Group Variant Selection, WhatsApp, Success Status) and `isSubmittingRef.current`, ignoring background barcode scans whenever a modal is open or checkout is in flight.
10. **`HIGH-13` (Label Studio Stock Clamping & Batched State Updating)**:
    - File: [`src/app/labels/page.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/labels/page.tsx)
    - Resolution: Clamped `fillAllFromStock` to 500 units max (`Math.min(stock, 500)`) in a single batched state updater, and mounted `#print-area` exclusively during active print execution (`isPrinting`).
11. **`HIGH-14` (2-Column Thermal Roll Print CSS Pagination)**:
    - File: [`src/app/labels/page.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/labels/page.tsx)
    - Resolution: Replaced CSS Grid in `.print-container.thermal-2col` with `display: block !important` and `display: inline-flex !important`, ensuring Blink and WebKit print engines honor continuous thermal roll page breaks.

---

## 🛡️ Cycle 13: Full Resolution of Remaining 19 Issues (14 P2 + 5 P3) & Store Policy Hardening — ALL RESOLVED & VERIFIED ✅

1. **`P2-01` / `A-1` (Van Inventory Shrinkage & Road Damage Reconciliation Policy)**:
   - Status: `RESOLVED / INTENDED STORE POLICY ✅` (Confirmed as Policy 18: In-transit van damage or shrinkage is unloaded back to the warehouse upon van return and audited manually via standard `MANUAL_ADJUST` stock movements with manager notes).
2. **`P2-02` (Strict Date Range Filtering for Monthly Reports)**:
   - File: [`supabase/migrations/0088_fix_remaining_p2_p3_issues.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0088_fix_remaining_p2_p3_issues.sql)
   - Resolution: In `get_comprehensive_reports`, applied `WHERE created_at >= p_start_date AND created_at <= p_end_date` across Tab 4 (`monthly_sales`) and Tab 6 (`monthly_profit`) CTEs, ensuring custom date range selections do not leak trailing 12-month data.
3. **`P2-03` (Camera Scanner Callback Identity & Stream Restart Prevention)**:
   - File: [`src/components/lookup/CameraScanner.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/lookup/CameraScanner.tsx)
   - Resolution: Wrapped `onScan` and `onClose` handlers in stable `useRef` containers (`onScanRef`, `onCloseRef`), removing function instances from `useEffect` dependency arrays to prevent camera teardown and stream restart cycles during parent re-renders.
4. **`P2-04` (Scanner Async Unmount Mid-Scan Protection)**:
   - File: [`src/components/lookup/CameraScanner.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/lookup/CameraScanner.tsx)
   - Resolution: Nulled `scannerRef.current` synchronously before calling `scanner.clear().catch(...)`, safely ignoring teardown errors and invoking `onCloseRef.current()` unconditionally on user dismissals to prevent `TypeError: Cannot read properties of null`.
5. **`P2-05` (Decimal Paise Pricing Entry & MAC Calculation)**:
   - File: [`src/components/inventory/AdjustStockModal.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/inventory/AdjustStockModal.tsx)
   - Resolution: Updated input regex to permit single decimal points (`replace(/[^0-9.]/g, '')`), eliminated `Math.round` truncations on cost inputs, fixed falsy `0` bug on free incoming restocks (`incomingCost !== '' && !isNaN(...)`), and rounded Moving Average Cost (MAC) to 2 decimal places.
6. **`P2-06` (Universal 6-Digit Collision-Free Invoice Number Generator & PGRST203 Prevention)**:
   - File: [`supabase/migrations/0088_fix_remaining_p2_p3_issues.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0088_fix_remaining_p2_p3_issues.sql)
   - Resolution: Implemented universal `generate_invoice_number(prefix, digits, created_at)` with 6-digit random suffix and microsecond clock fallback. Pre-dropped 9-parameter overload to eliminate `PGRST203` ambiguity, and routed authoritative 13-parameter `process_checkout` and `bill_line_staff_sales` through the generator while preserving cheque tracking, anti-tampering guards, and `reference_invoice_id` credit ledger linking.
7. **`P2-07` (Discrete Invoice Payment Settlement Policy)**:
   - Status: `RESOLVED / INTENDED STORE POLICY ✅` (Confirmed as Policy 19: Unallocated bulk lump-sum remittances across arbitrary invoices are intentionally disallowed; payments are tracked strictly on a per-invoice basis via dedicated Pay tabs).
8. **`P2-08` (Zero-Trust Customer Deactivation with Unsettled Dues Checks)**:
   - Files: [`supabase/migrations/0088_fix_remaining_p2_p3_issues.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0088_fix_remaining_p2_p3_issues.sql), [`src/lib/actions/customers.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/customers.ts)
   - Resolution: Enforced referential checks in both database RPC `deactivate_customer` and server action `deactivateCustomerAction` verifying that zero open unpaid invoices exist (factoring in returns and integer cent comparison `Math.round(paid * 100) < Math.round(effectiveTotal * 100)`), preventing customer deactivations with unsettled debts.
9. **`P2-09` (Barcode Code 128 Character Set Validation)**:
   - File: [`src/components/BarcodeSvg.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/BarcodeSvg.tsx)
   - Resolution: Validated input against Code 128B ASCII range (32–126), rendered an informative error badge upon unsupported characters without throwing runtime exceptions, and resolved `ReferenceError: sanitized is not defined`.
10. **`P2-10` (POS Active Cart Client-Side Navigation Interceptor)**:
    - File: [`src/app/pos/page.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/pos/page.tsx)
    - Resolution: Attached a capture-phase document click listener intercepting Next.js `<Link>` internal navigations when cart items exist, displaying a browser confirmation prompt and preventing inadvertent cart state loss.
11. **`P2-11` (Accessible Modal Keyboard Trapping & Escape Dismissal)**:
    - Files: [`src/components/inventory/AddProductModal.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/inventory/AddProductModal.tsx), [`src/components/inventory/CategoriesModal.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/components/inventory/CategoriesModal.tsx)
    - Resolution: Added Escape keydown listeners (placed before early returns) and Tab focus trapping with queryable focusable elements in both modals, adhering to WAI-ARIA dialog specifications.
12. **`P2-12` (Active Van Stock Soft-Deletion Blocker & Concurrency Locking)**:
    - Files: [`supabase/migrations/0088_fix_remaining_p2_p3_issues.sql`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/supabase/migrations/0088_fix_remaining_p2_p3_issues.sql), [`src/lib/actions/inventory.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/inventory.ts)
    - Resolution: In `soft_delete_product`, acquired pessimistic lock on master product (`FOR UPDATE`), queried `line_van_inventory` to reject deactivations if units are allocated across vans, locked variants deterministically (`ORDER BY id FOR UPDATE`) to prevent deadlocks, added alias `delete_product_with_variants`, and validated UUID input format with `z.string().uuid()` in `deleteProductAction`.
13. **`P2-13` (Resilient Regional Unicode Character Handling & Phone Fallback in PDF)**:
    - File: [`src/lib/pdf/generateInvoice.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/pdf/generateInvoice.ts)
    - Resolution: Hardened `cleanAscii(text, fallback)` using `NFKD` Unicode normalization and diacritics stripping. If regional characters are stripped into empty space, returns a resilient fallback (such as `Customer (+91 ${customer.phone})` or `'Valued Customer'`).
14. **`P2-14` (HSN Per-Item Tax Rounding Reconciliation)**:
    - File: [`src/lib/pdf/generateInvoice.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/pdf/generateInvoice.ts)
    - Resolution: Rounded each HSN row to 2 decimal places and adjusted tax drift against authoritative invoice `cgst_amount` and `sgst_amount` on the primary HSN row, eliminating 1–2 paise rounding mismatches in printed invoice summaries.
15. **`P2-15` (Dynamic IANA Timezone Offset Calculation)**:
    - File: [`src/lib/business-day.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/business-day.ts)
    - Resolution: Replaced hardcoded `5.5 * 60 * 60 * 1000` IST constant with `getTimezoneOffsetMs(timezone, date)` using `Intl.DateTimeFormat.formatToParts` with minute rounding to eliminate sub-second jitter and TDZ reference errors.
16. **`P2-16` (Server-Side Expense Pagination & Dashboard Payload Unpacking)**:
    - Files: [`src/lib/actions/expenses.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/expenses.ts), [`src/app/expenses/ExpensesClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/expenses/ExpensesClient.tsx), [`src/app/page.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/page.tsx)
    - Resolution: Implemented server-side pagination (`page`, `pageSize`, `total`, `totalPages`) in `getExpensesAction`, rich pagination controls in `ExpensesClient`, and updated dashboard caller to `getExpensesAction(1, 5)` unpacking `.data.items || []`.
17. **`P3-01` (Invoice Details Profit Card Returns Deduction)**:
    - File: [`src/app/invoices/[id]/InvoiceDetailClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/%5Bid%5D/InvoiceDetailClient.tsx)
    - Resolution: Deducted `returnedProfit` from invoice gross profit and rendered an explicit return deduction badge `"-₹X returned"` alongside net profit.
18. **`P3-02` (PDF Watermark Readability Enhancement)**:
    - File: [`src/lib/pdf/generateInvoice.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/pdf/generateInvoice.ts)
    - Resolution: Reduced background watermark graphic state opacity from `0.10` to `0.04`, ensuring printed text, SKU codes, and monetary figures remain sharp and legible.
19. **`P3-03` (Expense Mutation Audit Trail Traceability)**:
    - File: [`src/lib/actions/expenses.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/actions/expenses.ts)
    - Resolution: Appended ISO-timestamped modification notes to `notes` upon expense updates, and recorded deletion reasons alongside soft-delete `is_voided = true` state.
20. **`P3-04` (WhatsApp Due Reminder Phone Pre-population & Property Alignment)**:
    - Files: [`src/app/customers/[id]/CustomerDetailClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/customers/%5Bid%5D/CustomerDetailClient.tsx), [`src/app/invoices/[id]/InvoiceDetailClient.tsx`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/app/invoices/%5Bid%5D/InvoiceDetailClient.tsx)
    - Resolution: Pre-populated customer phone number in the WhatsApp reminder modal and corrected invoice paid amount property access to `inv.amount_paid`.
21. **`P3-05` (Strict Supabase Environment Variable Validation)**:
    - Files: [`src/lib/supabase/middleware.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/supabase/middleware.ts), [`src/lib/supabase/client.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/supabase/client.ts), [`src/lib/supabase/server.ts`](file:///Users/sharooz007/Documents/Agentic%20coding/MelbunPOS/src/lib/supabase/server.ts)
    - Resolution: Stripped hardcoded fallback Supabase credentials from browser, server, and middleware clients, requiring valid `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` configurations at runtime.


