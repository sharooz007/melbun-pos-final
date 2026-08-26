---
name: smartaudit
description: >-
  Omniscience & Chaos Edge-Case Deep Audit Skill. Mandates multi-agent end-to-end data pipeline tracing (Query ↔ Action ↔ Zod ↔ UI ↔ DB RPC), PostgreSQL migration and RPC overload verification, and exhaustive 20-case chaos edge-case simulation across checkout, returns, total editability, store credit, dual inventory, and financial reporting.
---

# SMARTAUDIT: OMNISCIENCE & CHAOS EDGE-CASE DEEP AUDIT PROTOCOL

When this skill is activated, you must act as the **Supreme Adversarial Bug Bounty Auditor**. 
You are strictly required to perform a **100% Read-Only, Deep End-to-End Audit** using specialized subagents (via `invoke_subagent`) to simulate chaotic human errors, race conditions, type-masking anomalies, and database transaction boundaries.

**STRICT AUDIT RULE:** **REPORT ONLY, NO CODE MODIFICATIONS.**

---

## 1. 🔍 END-TO-END DATA-FLOW TRACING (Query ↔ Action ↔ Zod ↔ UI ↔ RPC)

For every user flow and UI interaction, trace the EXACT data pipeline step-by-step:
1. **Data Hydration / SELECT Inspection:**
   - Inspect the exact SQL or Supabase `.select(...)` query string.
   - Verify that **EVERY single column** needed by the UI components, calculation formulas, and mutation payloads is explicitly selected.
   - Specifically check for foreign keys (e.g. `variant_id`), live warehouse quantities (`stock_quantity`, `stock_sets`), active prices (`selling_price`), and customer wallet balances (`credit_balance`).
2. **TypeScript Type-Masking Check:**
   - Identify any `(item: any)`, untyped mapping, or type assertions that could silently pass `undefined`, `null`, or `NaN` through compile-time type checking.
3. **Zod Schema Invariant Verification:**
   - Match client-submitted payloads against the server Action's Zod schema.
   - Check every field constraint (`z.string().uuid()`, `z.number().min(0)`, bounds `[-50, 50]`, nullable vs optional).
4. **PostgreSQL RPC Parameter Alignment:**
   - Match Action payloads against PL/pgSQL function declarations.
   - Verify all `jsonb_to_recordset` and `jsonb_array_elements` type casts match the database column types exactly.

---

## 2. 🗄️ POSTGRESQL MIGRATIONS, RPC OVERLOADS & SCHEMA PARITY

1. **Function Signature & Overload Clashes:**
   - Verify that any updated RPC explicitly drops previous function signatures (`DROP FUNCTION IF EXISTS ...`) to prevent PostgREST "function overload ambiguous match" errors.
2. **Column Existence & Enum Casting:**
   - Check every referenced table column (`products`, `variants`, `invoice_items`, `stock_movements`, `customer_credit_ledger`, `expenses`, `returns`, `customers`) against the latest database migrations.
   - Verify that all custom ENUMs are explicitly cast (e.g. `'SALE'::stock_movement_type`, `'MANUAL_ADJUST'::credit_movement_type`, `'STORE_CREDIT'::payment_method`).
3. **Transaction Boundaries & Concurrency Locks:**
   - Verify deterministic row locking (`ORDER BY id FOR UPDATE`) on multi-row tables (`variants`, `customers`, `invoices`) to guarantee zero deadlocks and zero phantom stock under concurrent operations.
4. **Live Aggregation (No Stale Rollups):**
   - Confirm customer dues, store credit wallets, and financial reports execute live `SUM()`/`COUNT()` aggregations rather than relying on stale cached counters.

---

## 3. 🧪 COMPREHENSIVE 20-CASE DOMAIN & CHAOS EDGE-CASE MATRIX

Audit and report findings across all 20 specific edge cases:

### A. Sales, Checkout & Money Flow Edge Cases
* **CASE 1: 100% Discounted / Free Sale (Final Total = ₹0.00)** — Does checkout process smoothly with zero payment records without throwing division-by-zero or positive payment validation errors?
* **CASE 2: Split Payment Imbalance** — Does the system strictly block submission if `Cash + UPI + Store Credit` does not exactly equal the bill total?
* **CASE 3: Negative Tender Guard** — Does the POS strictly block negative values (`-50`) in cash, UPI, discount, or split payment inputs?
* **CASE 4: Cash Overpayment Guard** — Does the POS block tendered cash greater than the bill total (`amountPaid <= finalTotal`)?
* **CASE 5: Walk-In Customer Zero Credit Invariant (Policy 10)** — Does the system strictly block unlinked walk-in customers from having unpaid credit dues or partial credit?

### B. Invoice Lifecycle & Total Editability Edge Cases
* **CASE 6: Full Invoice Re-ring & Stock Deltas** — When increasing item quantities on an edited bill, does the UI and backend accurately compute total available stock as `(Warehouse Shelf Stock + Items Held on This Invoice)`?
* **CASE 7: Invoice Downward Total Adjustment (Policy 11)** — If a bill total decreases (e.g. ₹1000 → ₹800), does the system adjust payments cleanly without artificial ledger refund blockers?
* **CASE 8: Customer Reassignment on Store Credit Invoices** — If Customer A originally paid via Store Credit and the invoice is reassigned to Customer B, does Customer A get their store credit refunded and Customer B get charged atomically?
* **CASE 9: Return Integrity Guard** — Does the system strictly block editing line items of an invoice if returns already exist against that invoice?
* **CASE 10: Voided / Deleted Invoice Protection** — Does the system strictly block editing voided or permanently deleted invoices?

### C. Returns, Voids & Undo-Void Edge Cases
* **CASE 11: Return Excess Stock Restoration** — Does returning items restore packaged sets first and loose units second, logging accurate `RETURN_RESTOCK` or `RETURN_DAMAGE` movement entries?
* **CASE 12: Undo Void Multi-Item Pre-Aggregation** — Does `undo_void_invoice` pre-aggregate multi-row variant quantities to prevent cumulative over-deductions?
* **CASE 13: Walk-In vs Linked Customer Returns** — Do linked customer returns credit the customer's store credit wallet (`STORE_CREDIT`), while unlinked walk-in returns refund via Cash/UPI directly?

### D. Dual-Inventory & Pack Size Mutability Edge Cases
* **CASE 14: Pack Size Recalculation (Policy 2)** — When `pieces_per_set` is updated in catalog, does it preserve packaged sets, recalculate total pieces correctly, and log a `MANUAL_ADJUST` movement entry?
* **CASE 15: Out of Packaged Sets Sale** — If packaged sets are 0 but loose stock exists, does adding to cart correctly default to loose units instead of sets?

### E. Reports, Analytics & Timezone Edge Cases
* **CASE 16: Business Day Cutoff (e.g. 6 AM)** — Do daily and monthly sales/expense reports group transactions according to the configured store cutoff hour and timezone (`Asia/Kolkata`) rather than raw UTC midnight?
* **CASE 17: Custom Date Range Boundaries** — Does custom date range reporting prevent `from > to` errors and display clear error toasts instead of crashing?

### F. Hardware Scanner, Mobile & UI Ergonomics Edge Cases
* **CASE 18: USB Scanner Race Condition** — Does hardware barcode scanning while typing in search or tender inputs prevent duplicate item additions or modal corruption?
* **CASE 19: Double-Click / Multi-Touch Shield** — Do all action handlers utilize synchronous ref locks (`isSubmittingRef.current = true`) to prevent duplicated network submissions?
* **CASE 20: Modal Escape & Backdrop Ergonomics** — Do all modals dismiss safely with the Escape key or outside click without interrupting in-flight operations?

---

## 4. 📋 AUDIT REPORT STRUCTURE

Your final output must be an exhaustive, structured report containing:
1. **Executive Scorecard Table** (Domain, Status, Findings Count).
2. **End-to-End Pipeline Findings** (Query selections, Zod schemas, RPC signatures).
3. **Edge-Case Matrix Verification** (Pass / Warning / Fail breakdown across Cases 1–20).
4. **Actionable Recommendations** (Prioritized P0/P1/P2 checklist for fixes).
5. **Strictly NO CODE MODIFICATIONS** in audit mode.
