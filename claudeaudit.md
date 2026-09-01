# MelbunPOS — Complete Workflow Audit (Read-Only)

No file was modified. No command was run against the database. Everything below is derived from reading the source and the 81 migrations, driven from the UI perspective as a cashier, a store owner, and a linesman would actually use it.

Method: I read the core money paths myself and dispatched 8 parallel adversarial subagents across POS checkout, returns/voids/undo-void, inventory/dual-stock, customers/credit/cheques, line-van sales, reports/dashboard/expenses, invoices/PDF, auth/RLS/settings, and labels/barcode/scanners, plus one mechanical contract-drift sweep. The shell tool was unresponsive in this environment, so nothing was executed — all behavioural claims come from reading code, and I flag the handful of items that need a live query to settle.

---

## First, about `smart_audit.md`

It says **46/46 findings plus Cycles 4–10 "ALL RESOLVED & VERIFIED ✅"**. That document is not a reliable picture of the current system, for three reasons:

1. **It stops at migration 0058.** Migrations **0059–0080** — expense categories, WhatsApp templates, HSN codes, cheques, **line/van sales**, variant-level pack sizes, bank payment breakdown, variant templates — are **entirely unaudited**. That is where several of the worst defects live.
2. **Several "resolved" items have since regressed.** Fixes present in an earlier migration were dropped by a later one that redefined the same function (documented in §3 below).
3. **Some items were marked resolved against the wrong layer.** The Zod bounds in `checkout.ts` are cited as the fix for multiple findings — but that entire file is dead code (§1.2).

---

## Executive scorecard

| Domain | Verdict | P0 | P1 | P2/P3 |
|---|---|---:|---:|---:|
| POS checkout (cart → tender → commit) | **FAIL** | 4 | 8 | 15 |
| Returns / voids / undo-void | **FAIL** | 3 | 3 | 10 |
| Inventory / dual-stock / pack size | **FAIL** | 3 | 6 | 12 |
| Customers / store credit / cheques | **FAIL** | 2 | 6 | 8 |
| Line / van sales | **FAIL** | 3 | 8 | 8 |
| Reports / dashboard / expenses | **FAIL** | 3 | 15 | 12 |
| Invoices UI + **PDF (customer-facing)** | **FAIL** | 5 | 7 | 10 |
| Auth / RLS / roles / settings | **FAIL** | 4 | 5 | 6 |
| Labels / barcode / scanners | **FAIL** | 0 | 9 | 14 |

Nothing here is cosmetic-only. The three categories that would hurt first, in order: **money silently changing or vanishing**, **the tax invoice being wrong**, and **anyone with a login being able to do anything**.

---

## 1. Hard failures — these break outright, today

### 1.1 `ORDER_REDEMPTION` is not a valid enum value → **every store-credit checkout aborts**

Verified directly. The enum is defined once and never extended:

- `0047_customer_credit_wallet_and_system_hardening.sql:13` — `CREATE TYPE credit_movement_type AS ENUM ('RETURN_CREDIT', 'PAYMENT_APPLIED', 'MANUAL_ADJUST')`
- Repo-wide grep for `ALTER TYPE credit_movement_type` → **zero results**

But the live checkout casts to a value that isn't in it:

- `0075_harden_cheque_clearance_and_atomic_checkout.sql:405` — `'ORDER_REDEMPTION'::credit_movement_type` inside `process_checkout`
- `0075:778` — same value inside `update_full_invoice`

`0075` is the final definition of both functions (it explicitly drops the prior signatures at `:156` and `:461`). The immediately preceding versions used a **valid** value — `0067:238`, `0067:513` and `0069:258` all use `'PAYMENT_APPLIED'`. So `0075` replaced a working value with a non-existent one.

**Reproduction from the UI:** select a customer with wallet credit → Payment method → **Store Credit** → Complete Checkout. Also: **Split** with any Store Credit amount > 0. Also: editing any invoice that re-applies store credit.

**What happens:** plpgsql only plans that statement on first execution, so the function creates fine and fails at runtime with `invalid input value for enum credit_movement_type: "ORDER_REDEMPTION"`. The whole transaction rolls back. The cashier sees an unmapped raw Postgres error (`formatHumanReadableError` in `pos/page.tsx:911-935` has no branch for it). **The store-credit tender is completely unusable**, and store credit is precisely how returns are refunded (Policy 3), so the wallet fills up and can never be spent.

*Needs a live check to be 100% certain the deployed function matches the migration fold — but the migration is unambiguous.*

### 1.2 The entire Zod validation layer is dead code

`src/app/pos/page.tsx` calls Supabase RPCs **directly from the browser**:

- `pos/page.tsx:1003` → `supabase.rpc('get_or_create_customer', …)`
- `pos/page.tsx:1183` → `supabase.rpc('update_full_invoice', …)`
- `pos/page.tsx:1237` → `supabase.rpc('process_checkout', …)`

`processCheckoutAction` (`checkout.ts:144`) and `updateFullInvoiceAction` (`checkout.ts:196`) have **no callers anywhere in `src/`**. Consequently these are all unenforced: `variant_id` UUID format, integer-ness of quantities, `payments[].amount` positivity, cheque-number/bank-name length caps, the `cheque_date` `YYYY-MM-DD` regex, and the `created_at` ISO-with-offset check. `createCustomerChequeAction` (`cheques.ts:56`) is also dead — it is the best-validated action in the codebase and nothing calls it.

Side effect: `revalidatePath` never runs for a checkout, so `/invoices`, `/inventory/products` and `/inventory/ledger` are not revalidated after a sale. The POS papers over it with `router.refresh()`, which only refreshes the current route.

### 1.3 Mixed pack sizes make an invoice permanently un-editable

`variants.pieces_per_set` was added in `0070:168`; `products.pieces_per_set` still exists. The two disagree in practice because `AddProductModal.tsx:138` synthesises the product-level value from **variant #1** (`const defaultPps = variants[0].pieces_per_set`) and writes it via `0073:38`. Create a product with variants of 12 and 10 pcs/set and `products.pieces_per_set` becomes 12.

Then the edit loader reads the **product** value: `pos/page.tsx:363` — `it.pieces_per_set || variant.products?.pieces_per_set || 1`, where `it.pieces_per_set` is a column that does not exist on `invoice_items` and `variants.pieces_per_set` is not in the `getFullInvoiceAction` select (`invoices.ts:343`). Meanwhile the server recomputes with `COALESCE(v.pieces_per_set, p.pieces_per_set, 1)` (`0075:645`).

**Result:** the client's subtotal and the server's differ by `sets × Δpps × price`, blowing past the ±₹0.05 tolerance at `0075:672` → hard `Invoice total mismatch` error. Any invoice containing a mixed-pack variant cannot be edited at all. And on invoices where it *doesn't* trip the tolerance, a no-op "Save" silently changes the billed quantity and the stock deduction.

---

## 2. Money and stock integrity

### 2.1 Returns restock the wrong quantity — silent, permanent inventory loss

Verified directly. Checkout deducts using **variant-level** pack size; the live `process_return` uses **product-level**:

- `0075:296` / `:346` — `COALESCE(v.pieces_per_set, p.pieces_per_set, 1) AS effective_pps`
- `0064_fix_process_return_deadlock.sql:63` — `v_total_pieces_to_return := (p_sets_quantity * COALESCE(v_product.pieces_per_set, 1)) + p_loose_quantity`

Product pps 10, variant pps 12: sell 1 set → **12 pieces** leave. Return that 1 set → **10 pieces** come back, while `stock_sets` is incremented by the full 1 (`0064:143`). Two pieces evaporate per set, every time, and `stock_sets` drifts out of ratio with `stock_quantity`.

The returns UI agrees with the server here (`ReturnsClient.tsx:196`, `:221`, `:775` all read product-level), so the client-side `maxSets` cap is also computed on the wrong divisor — meaning the UI will **permit returning more sets than were actually sold in pieces**.

### 2.2 Void has no returns guard, and the invoice detail page exposes it

`void_invoice` (`0065`, the live definition) validates only `IF v_invoice.is_voided` (`0065:32`). There is **no returns check in SQL at all**. The block is client-side only, and the two screens disagree:

- `InvoicesClient.tsx:671`, `:801` — Void is hidden when `(inv.total_refunds || 0) > 0`. Blocked.
- `InvoiceDetailClient.tsx:448-452` — `{!invoice.is_voided ? (<button onClick={…}>Void</button>)}`. **Unconditional.** Only *Edit* is gated on returns on this screen.

**Reproduction, no race needed:** invoice with a ₹300 cash refund already paid out → open `/invoices/<id>` → **Void** → Confirm. Succeeds.

**Consequence:** `is_voided = TRUE` makes every clause in `0077` drop the invoice **and** drop all its `payments` rows via `AND i.is_voided = FALSE` — including the `-300` refund row. Customer keeps ₹300 cash, goods are back on the shelf, the sale vanishes from revenue, and the payout vanishes from collections. The drawer is ₹300 short with no trace in any report. The only surviving evidence is the `returns` row, which still shows on the Returns page ledger (`returns.ts:172-205` doesn't filter voided/hidden) — so the two screens can never tie out.

There is also a TOCTOU path from the list page: `total_refunds` is baked in at fetch time, so a 10-minute-old list will fire Void on an invoice refunded since.

### 2.3 Void → Undo Void destroys packaged sets

Asymmetric clamp. Void caps the set restore; undo-void does not cap the set deduct:

- `0065:62-66` — `v_restored_sets := LEAST(COALESCE(v_item.sets_quantity,0), FLOOR(v_restored_pieces / GREATEST(pps,1)))`
- `0066_fix_undo_void_sets.sql:114` — `v_sets_to_deduct := GREATEST(0, COALESCE(v_item.sets_quantity,0) - v_returned_sets)` — **no `LEAST`/`FLOOR`**

The superseded `0057:116` *did* have the cap. `0066` removed it.

**Walkthrough:** sell 1 set of a 12/set item (`sets_quantity=1`) → return 6 **loose** pieces → Void restores +6 pieces and `LEAST(1, FLOOR(6/12)) = 0` sets → Undo Void deducts −6 pieces and `1 − 0 = 1` set. One packaged set destroyed per cycle, pieces stay balanced. `GREATEST(0, …)` then hides the corruption by clamping at zero, after which POS refuses set sales for stock the store physically holds.

### 2.4 Refund method ignores what the customer actually paid with

`process_return` never inspects the composition of `payments` — it sums a single `v_net_paid` and routes the whole excess to the one `p_refund_method` chosen in the modal (`0064:186-190`). The CASH and UPI buttons are **never disabled** for a linked customer.

Sell ₹1,000, paid ₹600 store credit + ₹400 cash → full return → excess ₹1,000 → cashier taps **Cash** → `INSERT INTO payments (…, -1000, 'CASH')`. **₹600 of non-cash wallet value converted into physical cash out of the drawer.** Tap Store Credit instead and the ₹400 of real cash becomes wallet credit. No split-refund UI, no server proportioning, no confirmation, no separate audit flag.

Also: `0047:191` gated the payout branch with `ELSIF p_refund_method IN ('CASH','UPI')`. The live `0064:190` uses a bare `ELSE`, so **any** payment method reaching the RPC writes a negative payment row.

### 2.5 Collected cash disappears when an invoice edit lowers the total

`pos/page.tsx:757-771` auto-retracks "Amount paid" to the new total whenever the previous entry matched the old one. `0075:751-754` then deletes the old payment rows and re-inserts only what was sent.

Cash sale ₹1,000, fully paid → edit, delete a line → total ₹600 → Save. `payments` becomes `[{600, CASH}]`. The **₹400 physically in the drawer is erased from the books** with no refund row, no `money_movements` entry, no ledger trace. Every trimmed bill produces a cash-count variance.

### 2.6 A lost response duplicates a real sale

`pos/page.tsx:1237-1292`: the cart is cleared **only** in the success branch (`resetFormState()` at `:1288`). There is no idempotency key and no client transaction id, and the invoice number is freshly randomised per call (`0075:325-331`), so a retry cannot collide.

Press Complete Checkout → connection drops during the round trip (a mobile POS or a van, routinely) → the transaction commits server-side but the client shows an error → cashier presses again. **Two invoices, double stock deduction, double payment rows.** Or, if they don't retry, a completed sale they believe failed. This is the highest-probability real-world money bug in the file.

The same shape exists in line sales (`0078` has no idempotency key either) and is worse there, because vans run on patchy mobile data.

### 2.7 Cheques

Four separate problems, one of which mints money:

**No BOUNCED state.** `0070:25` — `status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CLEARED'))`. Repo-wide search for `BOUNCED`/`bounce` → zero hits. `CLEARED` is terminal and irreversible (`0075:38`). When a cheque bounces, staff have two options and both are wrong: leave it PENDING forever (a receivable that will never arrive, permanently inflating the reported float), or clear it anyway (`0075:70-88` writes a `BANK`/`CASH` payment row, marking the invoice settled and recording cash that was never received).

**Duplicate cheque numbers mint store credit.** `customer_cheques` has no unique constraint on `cheque_number` (`0070:17-35`; indexes are on `customer_id`, `invoice_id`, `status` only). Record `#100123` twice for ₹50,000, clear both: the first applies to the invoice; the second finds `v_net_due = 0`, so `v_excess_to_credit := 50000` (`0075:66-67`) and is **deposited straight into the wallet as spendable credit** (`0075:91-114`), silently, appearing as an indistinguishable grey `MANUAL_ADJUST`. This is a **regression** — `0070:107-110` hard-refused the excess with an exception; `0075` replaced the refusal with a silent deposit.

**Cheque sales are counted twice as receivable.** POS records no payment row for a cheque (`pos/page.tsx:1051`), so dues = full invoice, while `0077:91-96` separately sums pending cheques as a float. Same rupee, two buckets. The customer is also flagged as owing money the moment they hand over the cheque, and the profile lights up the **WhatsApp Due Reminder** for them (`CustomerDetailClient.tsx:529-545`) — dunning a customer who paid three days ago.

**Cleared cheques escape the overpayment guard on edit.** `0075:751-753` deliberately preserves cleared-cheque payment rows (`notes NOT ILIKE '%Cheque%Cleared%'`) but `v_total_paid` is summed only from `p_payments` (`:555-566`), so the guard at `:569` never sees them. Cheque sale ₹1,000 → clear it → edit → set CASH ₹1,000 → `SUM(payments) = 2,000` on a ₹1,000 invoice. Dues go negative. Compounded by `pos/page.tsx:389-397`, which classifies payments by `method` only (`notes` is not selected), so it re-submits the cleared cheque's amount as a fresh payment.

Also: switching a cheque invoice's payment method to CASH on edit leaves an **orphan PENDING cheque** (`0075:800-825` only updates or inserts, never cancels), which later clears into free wallet credit. And an invoice paid by pending cheque loads into edit mode as `CREDIT` (`pos/page.tsx:419-421`).

### 2.8 The wallet is a stored counter with no reconciliation and no CHECK

`customers.credit_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00` (`0047:8`) — **no `CHECK (>= 0)`**. `getCustomerDetailsAction` (`customers.ts:130-140`) reads the counter, not a `SUM()` of the ledger, and the UI renders each row's stored `balance_after` snapshot rather than a running total. There is no screen, no total, and no constraint that would ever reveal counter/ledger drift. Correctness depends entirely on every writer remembering the lock-and-recheck pattern — which the audited paths do (`0047:276-288`, `0075:387-397`), but nothing enforces.

Related: void after a **store-credit return** leaves the credit intact. `0065:82-86` acts only `IF v_net_store_credit_paid > 0`, but a store-credit return writes a **negative** row, so for an invoice where ₹500 of credit was *issued* the sum is −500, the guard is false, and nothing is reversed. Combined with §2.2 (Void is reachable on refunded invoices from the detail page), the customer keeps ₹500 of spendable credit and the sale disappears.

### 2.9 100% discount = free goods, no authorisation

`pos/page.tsx:733` clamps percent to exactly 100; `finalTotal` floors at 0 (`:754`); `finalTotal === 0` → `payments = []` (`:1037`); the server only blocks discount **greater** than subtotal (`0075:209`), and the walk-in guard passes because `0 < 0` is false. Goods walk out, stock is deducted, invoice records ₹0 with no payment rows. **No manager approval, no reason note, no audit flag, no cap.** The Invoice Profit card even shows `Margin: 0.0%` on a strongly negative profit (`InvoiceDetailClient.tsx:135`).

Note the ±50% discount bound described in `smart_audit.md` is **not implemented anywhere** — client, Zod, or SQL.

### 2.10 Quantity input parsers disagree with each other

`ProductVariantSelectModal.tsx:129-131` — `parseInt(valStr.replace(/[^0-9]/g,'') || '0', 10)`. Typing `1.5` yields **15**. `1e5` yields 15. `1,000` yields 1000. The cart's own inputs use `parseInt(e.target.value) || 0` (`pos/page.tsx:1558`, `:1588`), where `1.5` correctly yields 1. Two parsers for one concept; the modal's silently 10×'s the order.

The same modal computes money with the **wrong pack size**: the product group's `pieces_per_set` is copied from whichever variant the RPC returned first (`pos/page.tsx:255`, never reconciled at `:262-270`), then used for all variants' totals (`ProductVariantSelectModal.tsx:95-101`, `:239-241`). If the first variant is pack-1, the Loose stepper is hidden entirely for a pack-12 variant (`:290`) — those loose pieces cannot be sold at all. The amount quoted to the customer differs from what is billed.

### 2.11 The stock ledger is not append-only

`0075:606-612` — `UPDATE stock_movements SET invoice_item_id = NULL WHERE invoice_item_id IN (…)` (orphans RETURN/adjust rows), then `DELETE FROM stock_movements WHERE notes = 'Sale: '||invoice_number OR …`. Audit rows are matched by **free-text note** and hard-deleted. Every invoice edit erases prior movement history instead of writing a compensating entry, and the replacement rows carry the (possibly backdated) invoice timestamp while the balance moves *now*. The ledger no longer replays to the current stock in time order.

`update_variant_cost_and_recalculate_profits` (`0070:206-209`) is worse: `UPDATE invoice_items SET cost_price_snapshot = …, profit_snapshot = …  WHERE variant_id = …` with **no date bound and no `is_voided`/`is_hidden` filter**. Changing one variant's cost silently restates the profit on every invoice ever issued for it. Since reports derive `gross_profit` from `SUM(profit_snapshot)`, **every historical profit figure changes retroactively** and closed periods can no longer be reproduced. It is wired to a bulk "apply to all" flow (`inventory/pricing/page.tsx:215`, `:268`).

There is **no reconciliation screen anywhere**. `get_stock_ledger_paged` (`0079:204-296`) returns raw movements with no running balance and no comparison against `variants.stock_quantity`; the per-product history modal is capped at 100 rows (`inventory.ts:216-260`). So every drift source above is permanently invisible.

---

## 3. Silently reverted fixes

Guards that existed in an earlier migration and were dropped by the later definition of the same function:

| Function | Guard lost | Was at | Now at |
|---|---|---|---|
| `update_full_invoice` | Deterministic pre-lock of both customer rows for the store-credit swap | `0069:207-211` | absent in `0075` — mutates `credit_balance` at `:687-691` with no prior lock, reintroducing the deadlock class `0065`/`0069` were written to fix. The orphaned `v_new_store_credit` variable (declared `:502`, set `:610`, never read) is the fingerprint |
| `update_full_invoice` | Unconditional `DELETE FROM payments` | `0069:319` | `0075:751-753` narrows it, creating the overpayment hole in §2.7 |
| `undo_void_invoice` | `LEAST(sets, FLOOR(pieces/pps))` set clamp | `0057:116` | `0066:114` — §2.3 |
| `void_invoice` / `process_return` | `p_refund_method IN ('CASH','UPI')` whitelist | `0047:191` | `0064:190` bare `ELSE` |
| `create_product_with_variants` | Explicit barcode-collision check + DB-level uppercasing | `0002:97-101` | `0073:63` — duplicates now surface as a raw `duplicate key value violates unique constraint "idx_variants_barcode_active"` in the red banner, and mixed-case barcodes are stored on any path that skips the Zod transform |
| `process_checkout` | Per-line `ROUND(…, 2)` on line subtotal | `0067:194`, `0069:285` | absent in `0075:730` — rows created before and after are rounded differently |
| `process_checkout` / `update_full_invoice` | Valid `'PAYMENT_APPLIED'` enum value | `0067:238`, `0069:258` | `0075:405`, `:778` — §1.1 |

---

## 4. The customer-facing tax invoice is wrong

This is the document you hand to customers and file for GST. `src/lib/pdf/generateInvoice.ts`.

**Balance due ignores returns.** `:441-445` — `balanceDue = max(0, final_total − Σpayments)`. `invoice.returns` is fetched (`invoices.ts:365`) and **never referenced** by the generator. Every screen in the app uses `effective_total = final_total − totalRefunds`. But refunds write a **negative payment row**, so the refund hits twice in the wrong direction: `Received` drops by R, `Balance` does not. A ₹10,000 invoice, paid in full, fully returned and refunded prints **`Received: Rs. 0.00 / Balance: Rs. 10,000.00`** in red, while the invoices list shows the same invoice as `REFUNDED, due ₹0`. The customer is billed for money already handed back.

**HSN is always the hardcoded `6109`.** `categories.hsn_code` exists (`0062:5`) but is **not in the `getFullInvoiceAction` select** (`invoices.ts:343`), so `item.variants?.products?.categories?.hsn_code` is `undefined` on every invoice and both the line column (`:350`) and the entire HSN-wise tax summary (`:457`) fall through to the literal `'6109'`. Per-category HSN configuration is a no-op on the document. Note the select *does* fetch `categories(id, name)` — and `name` is never used. The one field the PDF needs is the one not selected.

**Place of Supply is always `32-Kerala`.** `:236-237` chains `invoice.place_of_supply || customer?.state || store.state || '32-Kerala'`. `invoices.place_of_supply` does not exist as a column. `customers.state` does not exist. `store_settings` has no `state`, and no call site passes one. An interstate sale prints intra-state CGST/SGST with a Kerala place of supply — wrong tax head, wrong GSTR-1.

**Two contradictory tax figures on one page.** The tax-summary table recomputes `itemSubtotal × 0.025` per line **pre-discount** (`:456-470`), while the "Tax (5.0%)" row prints the stored `cgst_amount + sgst_amount`, which the DB computes on `GREATEST(0, subtotal − discount) × 0.025` (`0075:325-326`). Any discount guarantees they disagree, and the table's "Taxable Amt" column is not the GST taxable value.

**No return disclosure.** A partially returned invoice prints the original quantities and the original amount owed. There is no credit-note document type in the system at all.

**Voided marking is page 1 only.** The red banner and the 45° diagonal are drawn once (`:113-137`), as is the watermark (`:96-111`). Pages 2+ of a voided multi-page invoice look like a valid bill. The totals box also has no page-break guard (`:437`, `:551`) and can be drawn off-page or on top of a continued tax table.

**Non-Latin names are blanked.** `cleanAscii` (`:51-54`) maps every non-`\x20-\x7E` char to a space. A Malayalam/Hindi customer name becomes `''`, which is falsy, so `:232` falls through and the BILL TO reads **"Walk-in Customer / Cash Sale"** on a named customer's tax invoice. A non-Latin product name collapses to `'Item'`.

**Amount in words is truncated to two lines** (`:633-634`, `splitWords.slice(0,2)`), so the statutory words can be cut mid-sentence and no longer match the numeric total. (`numberToWords.ts` itself is correct across zero, negative, paise, exactly 1 lakh, exactly 1 crore, and >99 crore.)

**Road Proforma.** `line_dummy_invoices` has no `round_off` column, so `Number(undefined) !== 0` evaluates `NaN !== 0` → **true**, and every gate pass prints a spurious `Round Off : Rs. 0.00` (`:605`). It has no `payments`, so every proforma prints `Received Rs. 0.00 / Balance Rs. <full total>` in red **and** `Tender Mode: CASH SALE` on the same page. `line_staff` is injected by both call sites and never rendered — the transit document does not name the linesman it authorises. And it prints the store GSTIN with no "not a tax invoice" declaration.

**Store details are re-read live at print time** (`InvoiceDetailClient.tsx:226-230`), so reprinting a six-month-old invoice stamps it with today's store name, address and GSTIN. A reprint is not the document that was issued.

---

## 5. Access control

Blunt version: **there is no authorization model, only authentication.**

`0001` built a real role system (`user_roles`, `get_my_role()`, ADMIN/STAFF). `0015`, `0016` and `0017` systematically deleted every consumer of it — `0017_purge_all_admin_checks.sql:3` and `:62` are literally titled "Strip admin check from void_invoice / void_expense". Grep for `get_my_role` across `src/**` → **zero hits**. Every RPC written since gates on `IF auth.uid() IS NULL` and nothing else.

`0031` disabled RLS on the core tables; `0040` re-enabled it — but every policy it creates is `FOR ALL TO authenticated USING (true) WITH CHECK (true)` (`0040:33-43`). Same pattern on every other table (`0043:31-34`, `0047:34-35`, `0059:46-51`, `0070:39-43`, `0071:78-89`), plus `GRANT ALL ON <table> TO authenticated`. **RLS is on and restricts nothing.**

So any user who can log in can, from the devtools console against the anon key:

```
.from('payments').insert({ invoice_id, amount: 99999, method: 'CASH' })
.from('variants').update({ selling_price: 1 })
.from('stock_movements').delete()
.from('store_settings').update({ timezone: 'Mars/Phobos' })
.from('customers').update({ credit_balance: 500000 })
.from('line_van_inventory').update({ quantity: 0 })
```

Every invariant enforced in a SECURITY DEFINER RPC — stock non-negativity, dual-inventory clamping, overpayment bounds, wallet solvency, void idempotency — is bypassable in one line. `money_movements` and `customer_credit_ledger` are directly forgeable. And with no `created_by`/`user_id` on `invoices`, `stock_movements`, `payments` or `line_stock_movements`, **none of it is attributable to a person.**

Through the UI alone, with no console: any user can read full cost/profit on `/reports` (0016 removed the masking), permanently delete invoices (`InvoicesClient.tsx:462`), rewrite any cost (`/inventory/pricing`), and change the store's GSTIN. The sidebar hides nothing — which is at least honest.

The only table with a real policy is `user_roles` (`0001:28-39`, own-row-or-ADMIN), which is dead code. `docs/FEATURES_AND_MODULES.md:57` still documents "Admin (full access) and Staff (restricted access, hidden Cost/Profit metrics)", which is false — anyone reading the schema or the docs will believe roles are enforced.

Also worth noting: all three Supabase client factories hardcode the project URL and anon JWT as `||` fallbacks (`client.ts:3-4`, `server.ts:4-5`, `lib/supabase/middleware.ts:4-5`). The anon key is public by design so this isn't a secret leak, but a missing env var fails silently into a specific project instead of erroring, and rotation requires a code change. `login/page.tsx:20-21` uses `!` assertions with no fallback, so login can target a different project than the rest of the app.

Session expiry mid-checkout: the cart is component state with no persistence (grep for `localStorage`/`sessionStorage` in `src/**` returns only theme keys). An expired session makes the checkout action POST get a 307 to `/login`, and **the entire cart is destroyed** with no warning and no draft recovery. Logout exists only inside Settings (`settings/page.tsx:377-385`), is local-scope, and cannot revoke another device.

---

## 6. Reporting does not reconcile

### 6.1 `net_sales` is not net of anything

`0077:724` — `'net_sales', v_gross_sales`. Same in the daily and monthly payloads (`:287`, `:329`). The UI prints "Gross Sales" and "Net Sales" as two columns side by side (`reports/page.tsx:237`, `:246`) from one identical number. The dashboard card labelled **"Gross Sales"** is bound to `metrics.net_sales`. Three names, one figure.

### 6.2 Returns never reverse profit or COGS

`v_gross_profit := v_raw_profit − v_total_discount` (`0077:106`), where raw profit is `SUM(profit_snapshot)` over unfiltered `invoice_items`. Sell ₹50k and return all of it the same day: Total Sales still ₹50k, Gross Profit unchanged, Net Profit unchanged, and only a separate "Total Returns" card hints at it. Worse — a RESTOCK return puts the goods back into `variants.stock_quantity`, so their cost re-appears in Stock at Cost (`0077:142-147`) **while their margin remains in profit.** The margin is counted twice.

Meanwhile `customer_metrics.pending_dues` (`0048:100-103`) *does* net returns. So the customer's own profile and the reports screen will never agree, which is exactly the kind of thing that turns into a dispute.

### 6.3 Store credit is counted as collected twice

`0077:110-121` sums **all** payment methods into `v_total_collected`, with STORE_CREDIT broken out at `:114`. That rupee was already counted as Collected when the wallet was funded (as CASH/UPI on the earlier invoice). Redeeming it counts it again. The dashboard's headline `collected_payments` is inflated by the entire store-credit redemption volume. `customer_metrics.total_paid` has the same property, so the profile's green "Total Paid" card includes wallet spend as money received.

### 6.4 Voiding retro-erases collected cash

`0077:123-125` — `LEFT JOIN invoices … AND (p.invoice_id IS NULL OR (i.is_voided = FALSE …))`. Void a fully-paid cash invoice from yesterday and yesterday's Collected figure **changes today**, even though the cash may never have left the drawer. Combined with §2.2, that's the mechanism by which a paid refund vanishes.

### 6.5 Undated figures presented under a period label

Three headline KPIs have **no date filter at all** and render live values inside the selected-period card grid: `outstanding_dues` (`0077:136-140`), `stock_at_cost` (`:142-147`), `pending_cheques_total` (`:91-96`, also placed inside the "Payment Collection Breakdown for this period" panel). Run a report for 1990-01-01 → 1990-01-02 and you see today's inventory valuation and today's customer dues under a 1990 label.

### 6.6 Monthly tabs ignore the selected range entirely

`monthly_sales` (`0077:303-350`) and `monthly_profit` (`:376-428`) have **no `p_start_date`/`p_end_date` predicate** and end with `LIMIT 12`. Select **Today**, open **Monthly Sales**, and 12 months of history appear under a one-day label. The Month-wise trend chart is fed from the same data, and the CSV exports 12 months in a file named `…_today.csv`.

### 6.7 Expenses KPIs are lifetime and silently row-capped

`getExpensesSummaryMetricsAction` (`expenses.ts:262-300`) does `.select('amount, payment_method, is_voided')` with **no date filter and no `.range()`**, then reduces in JS. PostgREST caps rows at 1000 by default, so **past ~1000 expenses the totals silently stop growing.** The cards sit above a filter bar they ignore, and the list itself loads only the newest 100 rows (`ExpensesClient.tsx:145`) with no pagination — so the card can say "412 active records" while the list can never show more than 100.

Separately: `updateExpenseAction` (`expenses.ts:177-215`) is a **raw table UPDATE, not an RPC** — no audit row, no reason, and it can change both `amount` and `created_at`, silently restating a closed period. `deleteExpenseAction` (`:217-259`) sets `is_voided` **and** `is_hidden` with no reason and no confirmation, making the row invisible everywhere with no recovery path — sitting in the same row menu as the properly-audited Void.

### 6.8 Timezone handling

`business-day.ts:48-49` — `const istOffsetMs = 5.5 * 60 * 60 * 1000`, hardcoded, and reused in every preset branch. The `timezone` parameter is used only for `Intl` day-attribution, never for the boundary arithmetic. Set the store to any non-IST zone and every report window is silently shifted by the offset delta, while the SQL grouping (`AT TIME ZONE v_timezone`) is correct — so the chart and the KPI cards disagree at the boundaries.

Worse: `timezone` is validated as `z.string().trim().min(1)` (`settings.ts:17`) with **no IANA check**, and `business-day.ts:20-31` passes it into `new Intl.DateTimeFormat({ timeZone })` with **no try/catch**. A value like `"Mars/Phobos"` throws `RangeError` on the dashboard and `time zone not recognized` in SQL. **The dashboard and reports are bricked**, and it is unrecoverable from the UI because the Settings page renders timezone as **read-only text with no input control** (`settings/page.tsx:524-526`) — and appends a hardcoded "(IST · UTC+05:30)" to whatever the value is.

### 6.9 No cash reconciliation exists

Walking the owner's day-end arithmetic `opening + cash sales + cash collections − cash refunds − cash expenses`:

- **opening float** — no such concept in the schema
- **cash sales + collections** — `payment_breakdown.cash_amount` (`0077:112`), but the panel's Total includes store credit (§6.3)
- **cash refunds** — not exposed; `total_returns` is method-agnostic
- **cash expenses** — not exposed per period; the CASH/UPI split exists only on the expenses page and only lifetime
- **voids** — retro-erase collected cash (§6.4)
- **pending cheques** — lifetime figure inside a period panel

**There is no cash-in-hand number on any screen, and no screen from which an owner could detect that reports and the underlying ledgers disagree.** `money_movements` exists (`0034`) and is written by `void_expense` (`0017:109`) but is read by **nothing** — the one artifact that could serve as an independent ledger is unused.

### 6.10 Reports UI races and stale state

`fetchReports` (`reports/page.tsx:122-155`) has **no request sequencing, no AbortController, no generation counter** — and the correct pattern exists elsewhere in the same codebase (`app/page.tsx:127-153` uses `searchRequestIdRef`). Click **This Year** then immediately **Today**: if the heavier Year query resolves second, its data and its label land while the Today pill stays highlighted. On error, `reportData` and `periodLabel` are **not cleared** (`:144-149`), so all nine KPI cards keep showing the previous period under a newly-highlighted pill.

Silent truncation with no indicator: `stock_moves` LIMIT 500, `by_product` LIMIT 50, monthly LIMIT 12. `formatINR` renders `null`/`undefined`/`NaN` as a confident **₹0.00** across every KPI (`formatters.ts:9-18`), so a contract drift or a pre-fetch state shows zeros as fact.

The CSV formula-injection guard is correct for security but **prefixes `'` to negative numbers** (`:340-343`), so `stock_moves.quantity_change` and negative net-profit months import into Excel as text and drop out of `SUM()`.

### 6.11 Line sales are classified by string matching

`0077:218-226` — `EXISTS (… line_staff WHERE customer_id = inv.customer_id) OR EXISTS (… payments WHERE notes ILIKE '%line%' OR notes ILIKE '%van%')`. The note text originates in the browser (`pos/page.tsx:1147`). Any in-store invoice with "online" in a payment note is badged a line sale, a genuinely unpaid line sale has no payment rows so that branch can't fire, and linking a customer to `line_staff` retroactively re-badges their entire in-store history. The line-vs-store revenue split is not trustworthy.

---

## 7. Line / van sales — unaudited, and the least safe module

Not covered by `smart_audit.md` at all. Migrations `0071`, `0078`, `0080`.

**Unpaid, credit, cheque and zero-paid line sales are all silently booked as FULL CASH.** `pos/page.tsx:1137-1140` — `(payments.length > 0 ? … : [{ amount: finalTotal, method: 'CASH' }])`. The CREDIT and CHEQUE branches deliberately leave `payments` empty (`:1040-1052`, `:1105-1112`), and CASH only populates `if (amountPaid > 0)`. So a credit sale to a shop, an unpaid settlement, or a cheque is recorded as cash fully collected. The day-book is overstated by the invoice total, the receivable against the salesman is erased, and `chequeDetails` is computed and then never passed, so no cheque record is created at all.

**No end-of-day reconciliation exists.** Dispatch 100 pcs, bill 60, return 30 — nothing anywhere states that 10 pcs and the cash are unaccounted for. The detail page has three tabs (Van Inventory / Road Proforma / Dispatch Audit) and four KPI cards that are all piece counts, **no money**. `line_stock_movements.movement_type` is constrained to `DISPATCH | SALE_DEDUCT | MANUAL_RETURN | PUT_BACK_ALL` (`0071:45`) — there is **no shrinkage/loss/write-off type**, so missing stock has no legitimate path and the only way to clear a van is to "Return" goods that may not physically exist, crediting the warehouse with phantom inventory.

**Line staff have no identity.** Staff is read from the URL query string (`pos/page.tsx:76`) and passed as `p_staff_id`. `line_staff` has no `auth.users` reference (`0071:14-24`), and neither `line_stock_movements` nor `line_dummy_invoices` records the acting user. Open `/pos?mode=line_sale&line_staff_id=<any-other-uuid>` and post a sale under someone else. No line-sales action is attributable to a human.

**Void/edit/return of a line invoice restocks the WAREHOUSE, inventing stock.** Line sales debit only `line_van_inventory` (`0078:127-139`), never `variants`. But `void_invoice` restores `variants.stock_quantity` for every `invoice_items` row (`0065:36-50`), and there is **no `is_line_sale` column** for it to branch on. Nothing in the invoices UI distinguishes a line sale, so the standard flow runs. Voiding one line invoice permanently inflates warehouse stock by the sold quantity while the van stays short — the exact double-sell the dispatch model otherwise prevents, arriving through the back door.

**The shop that bought the goods is collected and thrown away.** The customer field is pre-filled with the linesman's own account (`pos/page.tsx:164-167`); at checkout `get_or_create_customer` runs on whatever was typed, and the line branch then **never sends it** (`:1141-1149`) — the RPC hard-binds the invoice to `v_staff.customer_id` (`0078:63-85`). Every van invoice is anonymous at the shop level, junk customer rows accumulate for each typed shop name, and per-shop dues are impossible. A "credit sale on the van" is in reality credit extended to the salesman. The invoice back-date and GST flag are silently dropped in the same branch.

**The GST checkbox is live but structurally ignored.** No `isLineMode` guard (`pos/page.tsx:1916-1922`), while the RPC hard-codes `gst_applied FALSE` and recomputes the total without tax (`0078:159-215`). Ticking it produces a hard `Total payment cannot exceed invoice final total` failure at the counter.

**No price anti-tampering.** `selling_price` is `z.coerce.number().min(0).optional()` and the RPC uses it as-is for subtotal, snapshot and profit (`0078:150`, `:240-250`) with **no comparison to the catalog price** — unlike `process_checkout`, which has an explicit anti-tampering block. The server action is directly callable.

**Rounding mismatch causes hard failures.** The client sums `billSubtotal` unrounded (`line-sales/[id]/page.tsx:518-522`) while the server rounds **per line** (`0078:151`), and `0078:170` has **no tolerance** — a sub-paisa divergence raises an exception. Line sales can fail on rounding alone.

**~400 lines of dead code.** `isBillModalOpen`/`isDummyModalOpen`, their openers (`:470`, `:581`) and full render blocks (`:1630+`, `:1767+`) exist, but **no `onClick` anywhere calls the openers** — the header uses deep-links to `/pos` instead. Two competing implementations of "bill a line sale", and the unreachable one behaves *differently* (it correctly sends `payments: []` for CREDIT, i.e. it does not have the P0 above). The next maintainer will patch the wrong one.

Plus: stranded stock (van catalog filters `is_active` but the van inventory listing doesn't, so deactivating a product makes its van stock unsellable and invisible to POS but still counted in the KPIs), non-sequential invoice numbering with a non-atomic check-then-insert (`0078:180-190`), proforma numbers generated client-side from `Math.random()` with no uniqueness constraint, no `inputMode="numeric"` anywhere in a module built for one-handed phone use, and no camera scanner so a phone-only salesman cannot scan at all.

---

## 8. Inventory and dual-stock

Beyond §1.3 and §2.1:

**`stock_sets` is clamped on checkout while the ledger records only pieces.** `0075:366-369` — `stock_sets = GREATEST(0, LEAST(stock_sets - sets_sold, FLOOR((stock_quantity - pieces) / effective_pps)))`. The `LEAST(… FLOOR(…))` term can lower `stock_sets` by more than the sets actually sold, and the SALE ledger row records only the piece delta. Every read path then derives loose as `Math.max(0, stock_quantity − stock_sets × pps)` (`InventoryClient.tsx:450`, `:528`), which hides the inconsistency. The owner sees "1 set + 12 loose" for a 12-pcs/set product — a breakdown that cannot be reproduced from the ledger.

**Receive Stock shows one number and writes another.** The row preview uses **product-level** pps (`ReceiveStockModal.tsx:441` desktop, `:555` mobile) while the header badge (`:157`) and the server (`0076:34-44`) use **variant-level**. Product pps 1, variant "Box of 12": enter 2 sets → preview says "+2 pcs" → **+24 pcs** are received. Two contradictory numbers on the same screen, and the one the clerk reads is the wrong one. "Current Stock" in the same modal is derived from pieces (`:93-99`) and never reads the authoritative `stock_sets`, so it disagrees with the inventory list for the same variant.

**Moving Average Cost is computed in the browser and stored verbatim.** `AdjustStockModal.tsx:196-202` computes the MAC from a possibly-stale on-hand figure; `:276-277` sends it through **`parseInt`** (truncating ₹150.75 → ₹150 on a `DECIMAL(10,2)` column); `restock_product_variants` (`0079:154-167`) **never recomputes** — it rounds and stores whatever arrived. It has `stock_quantity` and `cost_price` in hand and could compute it exactly. A `userCostOverridden` flag lets the user type any Final Cost. This is the least-defended money write in the codebase, and via §2.11 that cost basis is then stamped retroactively onto historical invoice items.

**Price-only restock changes cost with no ledger row at all** (`0079:173-180`), and the whole product's variant list is submitted every time, including zero-quantity rows.

**Product-level pack size is a side effect, not a decision.** There is no product-level pack-size input in the modal; `AddProductModal.tsx:138` synthesises it from variant #1 and `0073:157-162` hard-writes it. Reordering variants rewrites the sets↔pieces conversion for every NULL-pps variant.

**Clearing a barcode field silently issues a new one.** `0073:165` — `COALESCE(NULLIF(trim(barcode),''), generate_unique_barcode())`, then unconditional update. Select an existing variant's barcode, delete it, Save → every printed label and shelf tag for that variant is invalidated with no warning and no ledger row.

**Delete + re-add severs history.** Removing a variant soft-deletes it and writes off stock (`0073:239-263`); re-adding the same name inserts a **new row with a new UUID** — there is no reactivation path. Sales for "Red / M" split across two variant ids with no link, and because the uniqueness index is partial (`0026:14-16`), the new row can legally take the old barcode.

**`soft_delete_product` has no referential checks.** `0048:3-53` validates only that the row exists, then forces `stock_quantity = 0`. A product in someone's open cart, on a pending cheque, or dispatched to a van is written off with no guard. `deleteProductAction` (`inventory.ts:107-113`) doesn't even `z.string().uuid()` the id.

**Ledger filter drift.** The dropdown offers `INITIAL_STOCK` (`LedgerClient.tsx:171`) which is **not in the enum** — it silently returns zero rows and the footer reads "0 of 0", so a user looking for opening stock concludes there is none (it is actually written as `ARRIVAL`). Meanwhile `LINE_DISPATCH` and `LINE_RESTOCK` are real, written by `0071`, and **absent from the dropdown** — they fall through to the grey default badge and cannot be isolated. Ledger timestamps render in the browser's zone with no `timeZone: 'Asia/Kolkata'`, so rows appear outside the IST-pinned range that returned them.

**Low-stock is a hardcoded global on aggregated pieces.** `InventoryClient.tsx:337` — `totalStock <= 10`, summed across all variants. A 12/set product down to its last set never warns; a 100/set product at 10 pcs shows "Low" with **zero sellable sets**; one out-of-stock variant is masked by four healthy ones.

**Zero selling price is fully accepted.** Zod is `.min(0)` and the RPC rejects only negatives; the below-cost `window.confirm` only fires when `cost > 0 && sell < cost`, so cost 0 / sell 0 passes with no prompt at all.

`AddProductModal` is the one inventory modal without a synchronous `isSubmittingRef` guard — it checks only `if (loading) return` (`:114`), and product creation is not idempotent.

---

## 9. Customers

**Phone is not normalised before the uniqueness check.** `customers.ts:78` strips to `[0-9+]`; `get_or_create_customer` (`0044:17`) does only `NULLIF(trim(…))`. So `9876543210`, `+919876543210` and `98765 43210` are three distinct customers for one human — three wallets, three dues ledgers. Dues collected on one never clear the invoice on another, and reports triple-count the receivable.

**Name-only lookup is non-deterministic.** `0044:85-90` — `SELECT * INTO v_customer … WHERE LOWER(name)=LOWER(…) AND phone IS NULL LIMIT 1` with **no `ORDER BY`**. Two phone-less customers named "Ramesh" → a ₹20,000 credit sale attaches to whichever row Postgres happens to return. And this is the default path for walk-ins.

**Deactivation's dues guard is client-side only.** `deactivate_customer` (`0048:113-145` / `0051`) guards `credit_balance` but the dues check lives only in the browser (`CustomerDetailClient.tsx:384-390`) reading possibly-stale state. Since reports compute outstanding dues as `SUM(pending_dues) WHERE is_active = TRUE` (`0077:133-137`), **a deactivated debtor's dues vanish from the reports total** while still showing on their profile. Receivables understated, no error anywhere. And deactivation isn't durable: typing that customer's phone into POS flips `is_active = TRUE` with no confirmation and no audit row (`0044:44-51`).

**No lump-sum payment or allocation.** Payment is strictly one invoice at a time (`pay_invoice` takes a single `p_invoice_id`). A customer handing over ₹10,000 against four open invoices requires four modal passes and a mental split, with nothing recording that they were one tender.

**Cheque and Bank cannot be collected against a due.** The Pay modal offers CASH / UPI / STORE_CREDIT only (`CustomerDetailClient.tsx:87`), though the enum has CHEQUE and BANK. A wholesale customer settling a ₹2,00,000 credit invoice by cheque cannot be recorded truthfully — staff either mis-state the method on a GST invoice or leave the due open with no cheque record.

**Four divergent outstanding-dues formulas.** (1) profile card: unclamped net per-customer (`0048:100-103`) clamped only at render; (2) invoices tab: per-invoice clamped, summed (`customers.ts:186-190`); (3) customers list: same as (1); (4) reports: `SUM` filtered to active with `pending_dues > 0`. (1) and (2) disagree whenever one invoice is overpaid — the negative due cancels real dues in the header card while the tab still shows them. And (1)'s `Math.max(0, …)` hides genuine customer advances behind a reassuring ₹0.00.

**Credit ledger types collapse.** The enum has three values, but a void reversal, an invoice-edit reversal, a cheque deposit and an operator adjustment **all** write `MANUAL_ADJUST` (§2.7), rendered as the same grey chip. In a dispute the operator cannot distinguish "we banked your cheque" from "someone hand-adjusted your wallet".

**Pending cheques can be silently forgotten.** No aging, no overdue highlighting, no sort by cheque date, and **no store-wide pending-cheque screen** — `getCustomerChequesAction` is customer-scoped and reports expose a single rupee figure with no drill-down. Record a cheque, never reopen that profile, and nothing ever surfaces it. In India cheques age out of bankability in three months.

**WhatsApp modal retains the previous recipient's number.** `WhatsAppPromptModal.tsx:25` initialises from `defaultPhone` with **no reset `useEffect`**, and the component early-returns *after* the hooks while being rendered persistently, so it never unmounts. Open customer A (no phone) → type A's number → Send. Go to customer B (no phone) → click Reminder → **A's number is still there** → Send. Customer B's name, invoice number and exact outstanding balance are transmitted to customer A. One click deep, in the default flow.

Per-invoice reminders also always state **"Amount Paid: ₹0.00"** and "1 item(s)": `CustomerDetailClient.tsx:181` reads `inv.paid_amount` but the action returns `amount_paid` (`customers.ts:198`), and `:192` reads `inv.invoice_items?.length` from a query that never selects `invoice_items`. A customer who has paid ₹40,000 of ₹50,000 receives a message reading `Total ₹50,000 / Paid ₹0.00 / Due ₹10,000` — internally inconsistent, and it reads as though the store lost their payment.

`cleanWhatsAppPhone` (`whatsapp.ts:69-71`) accepts any 10–15 digit string, so an 11-digit typo like `98765432101` is returned verbatim and becomes a valid `wa.me` handle for someone else's number — carrying the customer's name and balance. The modal's decorative `+91` prefix span isn't part of the value, so an operator who types `+919876543210` sees `+91+919876543210`. And `{customer_phone}` is a documented template placeholder that `formatWhatsAppMessage` never substitutes — the literal string is delivered.

---

## 10. Scanners, labels and human error

**Global scanner is only fenced off for one modal.** `pos/page.tsx:586` bails on `isSplitModalOpenRef` and on focused inputs (`:589-591`). It stays live while the **Clear Cart** confirmation, the **variant select** modal, the **success/receipt** modal and the **camera overlay** are open. Reproduction: add 3 items → click Clear Cart → scan → click Cancel → the cart now contains an item that was never on the counter. With the variant modal open, a scan adds a *different* variant underneath while the operator is choosing a size, then the modal adds a second line.

It also doesn't consult `isSubmittingRef`, so **a scan during an in-flight checkout** lands after the payload snapshot — item on screen, not on the invoice, stock and printed bill disagree.

**Because the listener defers to focused inputs, barcode digits land in money and identity fields.** Click into Amount Paid, type `500`, then scan out of habit → `5008901234567890`. Click into Customer Phone and scan → the barcode becomes the customer identity, and the autocomplete effect **auto-resolves and auto-fills on an exact phone match** (`pos/page.tsx:466-474`), so a numeric barcode equal to a stored phone silently attaches the sale to the wrong customer — who carries a `credit_balance`. Scan into the Labels store-name field and every label in the batch prints the barcode as the store name.

**Lookup can show a stale result for a newer scan.** `executeSearch` (`lookup/page.tsx:31-57`) sets `activeQueryRef` before the await and never re-checks it after; the success branch writes unconditionally. Scan A then B within ~100ms (normal counter scanning) and if A resolves second you quote A's price with B's barcode on screen.

**Camera scanner.** The init effect depends on unstable inline callbacks (`CameraScanner.tsx:112`), so in continuous POS mode **every successful scan tears down and re-creates the scanner** and re-acquires the camera. Shutdown relies solely on `scanner.clear()` with every rejection swallowed — there is no `stop()` and no `getTracks().forEach(t => t.stop())` fallback, so if `clear()` fails the camera stays on (needs a live check of the library version to confirm severity). The duplicate cooldown is 1200ms for the same code with `fps: 15` and no `pause()`, so holding one item in frame for three seconds adds it **2–3 times**. Decode errors have an empty handler, and there is no permission-denied or no-camera branch — poor light is indistinguishable from a broken camera. `navigator.vibrate` is checked but unsupported on iOS, so the haptic confirmation the flow relies on never fires on iPhone.

**Label Studio.** "Add All In-Stock" (`labels/page.tsx:162-177`) assigns `quantity: variant.stock_quantity` with **no clamp**, while the typed input is correctly clamped to 500 (`:147`). And `<div id="print-area">` renders **every** flattened label into the live DOM at all times (only `display:none`). A bulk SKU with 100,000 pieces → ~100,000 label cards and ~5M DOM nodes → tab lock; if it survives, one click feeds the whole roll.

Labels print a **per-piece** `selling_price` under the header **"MRP:"** and **never print pack size at all** — `pieces_per_set` is fetched (`labels.ts:81`) and no template renders it, and `labels.ts:83` reads the product-level value anyway. A tag on a set of 12 reads `MRP: ₹40` while the POS rings it at ₹480. That is the physical mis-count and counter dispute, originating from paper. (Printing a selling price labelled "MRP" is also a distinct exposure under Legal Metrology.)

Print CSS: `page-break-after: always` on every card with `@page { size: auto }` emits **one full A4 sheet per label** on any printer not pre-configured for 50×25mm. The page root's `p-3.5 … mx-auto max-w-[1600px]` padding is never reset for print, so content is inset ~6mm and centred — bars clipped at the label edge on a 50mm roll, discovered after the roll is consumed. `page-break-after` on `:nth-child(2n)` **grid items** is ignored by Blink, so 2-col rolls break through the middle of a label row. Cards have `max-height: 32mm` with no `overflow: hidden`, so all five fields plus a 48px barcode bleed into the neighbour. `.label-price` has no nowrap, so `₹1,00,000.00` wraps and clips. And the on-screen "Live Interactive Print Preview" is a completely different renderer (`w-[220px]` ≈ 58mm, `line-clamp-1`, px type) from the print subtree (mm widths, pt type, `text-overflow: ellipsis`) — different truncation model, different width, and it shows only 6 of N.

The store name on labels is a **hardcoded `'MELBUN'`** (`labels/page.tsx:57`, fallback again at `:588`) with no store-settings read anywhere in the file — renaming the store has no effect on labels, and the value resets on every reload.

**Barcode encoding is correct, but sanitisation diverges the label from the database.** I verified the Code 128B implementation: the pattern table boundaries, the mod-103 weighted checksum, and bar/space alternation are all correct, and the bars and the human-readable caption both derive from the same `sanitized` variable — **there is no path where the bars encode something other than the printed text.** The problem is `BarcodeSvg.tsx:44-56`, which silently drops every character outside ASCII 32–126 and trims. If `variants.barcode` contains a stray `₹`, en-dash or zero-width space, the label agrees with itself but **not with the DB row** — scanning it at the POS fails the exact-match requirement, and if that character was the only difference between two SKUs, the label now matches the *other* one. An all-invalid barcode prints a physical label with a price and product name and **no barcode**, in red ink, with nothing blocking the print.

Module width: the SVG is `width: '100%'` (`:98-101`), so inside a 48mm card a 13-char symbol is scaled to an X-dimension of roughly 0.23mm — at the practical floor for thermal Code 128, and below 0.19mm past ~18 characters. Quiet zone is 4 modules (`:68`) against a spec minimum of 10.

**Navigation guards don't work where it matters.** Two `beforeunload` handlers exist (POS `:627-636`, Settings `:189-198`), and `beforeunload` **does not fire for Next.js client navigation or the Back button**. Every sidebar entry is a `<Link>`. Build a 12-line cart, click "Price & Stock" in the sidebar → the cart is destroyed silently. Same for unsaved Settings. Label Studio has no guard at all — one sidebar click discards a 40-SKU batch.

**Destructive-action confirmation is inconsistent across three standards.** Styled modal: POS clear cart, void invoice, expense void/delete. Native `confirm()`: deactivate customer (×2), delete category, remove variant with stock, below-cost save, sign out. **Nothing at all**: Labels Clear Queue, Labels row delete, POS cart line remove, settings template remove, line-sales dispatch row remove, expense category delete. Note that Chrome/Safari permanently suppress `confirm()` after repeated use, and a suppressed `confirm()` returns `false` — so **customer deactivation and category deletion silently stop working** with no error, which a cashier deactivating several customers in a row will hit.

The Clear Cart modal's backdrop is styled `cursor-pointer` across the whole overlay and has **no Escape handler**, so a stray tap cancels the confirmation with no feedback about whether the cart was cleared.

**Accessibility that affects operation.** Grep for `aria-modal|role="dialog"` in `pos/page.tsx` → **zero**. No modal moves focus in, traps Tab, or restores focus on close. After closing the variant picker, Tab resumes at the top of the document, so the operator must re-tab through the sidebar to reach the cart — in practice they reach for the mouse, and per above a scan during that fumble lands somewhere unintended. `body { touch-action: pan-x pan-y }` (`globals.css:42`) disables pinch-zoom app-wide, so nobody can zoom to verify a 10px barcode caption or a 7pt label field. Label Studio is hardcoded light (`bg-white`, `text-gray-900`) with no theme tokens, so it is a white slab in dark mode, and `--border-default: #1E293B` on `#131B2E` is ~1.35:1 — borders are effectively invisible in dark mode across the app. Disabled states are opacity-only with no `cursor-not-allowed`, reaching ~2:1.

The label print-queue ± and trash buttons are **28×28px, 4px apart** — the controls that decide how many labels print — and the 16px mobile `!important` rule overflows the 44×28px quantity box so the operator cannot read the number they are about to print.

---

## 11. Backdating and timestamps

The POS "Invoice Date & Time" input has **no `min` and no `max`** (`pos/page.tsx:1812-1817`). The only server check is the future buffer `NOW() + INTERVAL '1 day'` (`0075:218-221`). There is no closed-period lock, no store-opening floor, and no "before this product existed" check.

Set `2019-04-01T02:30` and: revenue lands in an already-reported period; the invoice number embeds the backdated year (`MELBUN/2019/…`, `0075:325-331`) breaking numbering monotonicity; `stock_movements` rows are written with the backdated timestamp while `variants.stock_quantity` moves now, so the ledger no longer replays in time order; and 02:30 belongs to the **previous** business day under a 6 AM cutoff, which the UI never says — it just echoes the locale string.

`created_at` is also never validated as ISO-with-offset, because that Zod rule lives in the dead `checkout.ts`. `pos/page.tsx:1125-1127` does `new Date(invoiceDateStr).toISOString()` on raw input; an unparseable value throws `RangeError`, surfaced as a generic message.

---

## 12. The 20-case chaos matrix from `smartaudit`

| # | Case | Result |
|---:|---|---|
| 1 | 100% discount / ₹0 sale | **FAIL on control** — processes cleanly, no approval, no audit flag (§2.9) |
| 2 | Split payment imbalance | **PASS** — exact equality client-side, 0.01 tolerance at commit, server re-checks. Caveat: `!==` float compare at `pos:823` vs tolerance at `:1059` — two policies, one invariant |
| 3 | Negative tender | **PASS** — blocked at input, handler and RPC on all fields |
| 4 | Cash overpayment | **PASS** on CASH/UPI/split. **FAIL** via preserved cleared cheques on edit (§2.7) |
| 5 | Walk-in zero credit (Policy 10) | **PASS** in-store, all five paths + server. **FAIL** in line sales (§7) |
| 6 | Re-ring stock deltas | **PASS** on the maths (revert-then-validate, exact SQL at `0075:594-654`). **FAIL** on the ledger (§2.11) and on mixed packs (§1.3) |
| 7 | Downward total adjustment | **FAIL** — collected cash erased with no trace (§2.5) |
| 8 | Customer reassignment on store-credit invoice | **PASS** on netting (old customer refunded, new debited, both with ledger rows). **FAIL** on locking — the deterministic dual-customer lock was dropped (§3) |
| 9 | Edit blocked when returns exist | **PASS** — UI on both screens + `0075:532-535` |
| 10 | Voided / deleted invoice edit blocked | **PASS** — UI + RPC, independently |
| 11 | Return restock order & movement types | **FAIL** — wrong pack size (§2.1); returning a set as loose dissolves packaging; `RETURN_DAMAGE` logs `quantity_change = 0` so scrap volume is unauditable |
| 12 | Undo-void multi-row aggregation | **PASS** — per-variant pre-aggregation with a real negative-stock guard (`0066:44-66`). **FAIL** on sets (§2.3) |
| 13 | Walk-in vs linked returns | **FAIL** — method is not tied to how the customer paid, cash override always enabled (§2.4) |
| 14 | Pack size recalculation | **WARNING** — UI locks it for existing variants, but the RPC clamps loose to 0 on degenerate state, discarding real stock and writing **no** ledger row; reachable via delete-and-re-add |
| 15 | Out of sets, loose exists | **PASS** — `handleAddToCart` defaults to loose when `stock_sets = 0`; server clamps |
| 16 | Business-day cutoff | **PARTIAL** — correct for the three probe transactions and applied to invoices/payments/expenses, but **not to `returns`**, and the client hardcodes IST (§6.8) |
| 17 | Custom range boundaries | **PARTIAL** — `from > to` rejected server-side with a styled banner, but keystroke-triggered fetches fire first, and three KPIs ignore the range entirely (§6.5) |
| 18 | USB scanner race | **FAIL** — four unguarded modal/submit states plus money and identity fields (§10) |
| 19 | Double-click shield | **PASS, and genuinely so** — synchronous `isSubmittingRef` set before the first `await` in POS checkout, returns, void/undo/delete on both invoice screens, cheque clearance, pay-invoice, receive/adjust stock, and all line-sales submits. **Gaps**: `AddProductModal`, expense category delete, staff status toggle. All defeated by the absence of server-side idempotency (§2.6) |
| 20 | Modal Escape / backdrop | **PARTIAL** — POS split, success, variant, adjust, returns and invoices-list have Escape; the **invoice detail** modals and the **Clear Cart** modal do not. No `role="dialog"`, no focus trap, no focus restoration anywhere |

---

## 13. What is genuinely solid

Worth stating, because it is real engineering and should not be broken while fixing the above:

- **Concurrency and deadlock avoidance.** Every mutating RPC locks in a consistent order (invoices → invoice_items → variants ascending by id → customers), uses `SELECT … FOR UPDATE`, and re-reads after the lock. Two tills selling the last unit serialise; the loser gets "Insufficient stock". Stock cannot go negative through any audited path. `0064` and `0065` were written specifically to fix lock inversions and they do.
- **Atomicity.** Checkout, edit, return, void, undo-void, dispatch and line-bill are each single plpgsql functions — invoice + items + stock + movements + payments + credit ledger + cheque either all land or none do.
- **Server-side recomputation of the subtotal and tax**, with a price-tampering check against the catalog and a total-mismatch abort. The client cannot dictate the subtotal.
- **Over-return is properly blocked** — three layers, with the authoritative check recomputed from the DB inside the row-locked transaction (`0064`).
- **Return refund proration is mathematically sound** — a discount/GST-adjusted ratio with per-line and per-invoice caps recomputed live, so cumulative refunds can never exceed the invoice total, and a 100%-discount invoice refunds ₹0.
- **No cash payout on an unpaid credit invoice** — `GREATEST(0, LEAST(v_net_paid, old_eff) − new_eff)` is correct across every case I traced.
- **Store credit is re-checked under a row lock at commit**, so a stale UI balance can only cause a rejection, never an over-draw.
- **Void → undo-void → void cannot double-credit the wallet**; every wallet movement writes a ledger row in the same transaction.
- **Pending cheques are correctly excluded from collected revenue** in both report engines.
- **Discount is subtracted exactly once** in gross profit — `profit_snapshot` is pre-discount and the invoice-level discount is deducted once.
- **Cost snapshots protect history** from ordinary repricing (only the edit path and the bulk cost tool restate it).
- **Delete is a soft hide with a void precondition**, so there are no orphaned rows anywhere.
- **Code 128 encoding is correct**, and bars always match the printed caption.
- **Cart-row numeric inputs are NaN-safe**; no NaN reaches the subtotal from the cart.
- **`numberToIndianWords` is correct** across zero, negative, paise, 1 lakh, 1 crore and beyond.
- **iOS zoom-on-focus is properly prevented**; A4 label geometry actually fits the sheet; no dead sidebar links; no service-role key in client code; no page renders business data without a session.

---

## 14. Suggested fix order

**Stop-the-bleeding (do first, small diffs):**
1. `ORDER_REDEMPTION` → `PAYMENT_APPLIED` in `0075` (§1.1). Store credit is currently unusable.
2. Add the returns guard to `void_invoice` and gate the detail-page Void button (§2.2).
3. Restore variant-level pack size in `process_return` (§2.1).
4. Restore the `LEAST(…FLOOR…)` set clamp in `undo_void_invoice` (§2.3).
5. Remove the forced-CASH fallback in the line-sale branch (§7).
6. Reset `phoneNumber` in `WhatsAppPromptModal` on open (§9) — a one-line PII fix.
7. Clamp `fillAllFromStock` and stop rendering the print DOM unconditionally (§10).

**Then the tax invoice** — it is the artifact a customer or an auditor holds: net returns from the balance due, select `categories.hsn_code`, fix place of supply, reconcile the two tax figures, mark voided pages, disclose returns (§4).

**Then reporting truth** — make `net_sales` net, reverse profit/COGS on returns, exclude store credit from Collected, range-scope the monthly tabs, add request sequencing, and provide one cash-in-hand figure that ties to the drawer (§6).

**Then the structural items**, which are larger: a real role model and non-`true` RLS policies (§5), a single source of truth for pack size (§1.3, §8), server-side idempotency keys on checkout and line-bill (§2.6), routing POS through the server actions so the Zod layer stops being decoration (§1.2), and an end-of-day reconciliation surface for both the till and the van (§6.9, §7).

---

## 15. What I could not verify

Stated plainly rather than assumed:

1. **Whether the deployed database matches the migration fold.** "Live = highest-numbered definition" is derived from file ordering. Whether the invalid `ORDER_REDEMPTION` function is actually deployed is settleable only against `pg_proc`.
2. **`0065:59` field resolution.** `SELECT v.*, p.pieces_per_set INTO v_variant` produces a record with two fields named `pieces_per_set` after `0070` added the variant column. Which one `v_variant.pieces_per_set` binds is Critical-vs-Low for void restocking, and it needs one live `SELECT` to settle. `0075` avoids the ambiguity by aliasing (`AS effective_pps`) — that is the pattern `0065` should use.
3. **Whether `html5-qrcode`'s `clear()` stops the MediaStream** in this version. Either way the code has no `stop()` and no track-stop fallback.
4. **Rendered PDF metrics.** The overflow/truncation/page-break claims are derived from the coordinate maths and fixed box heights in the source, not from a rendered document.
5. **Whether `is_hidden = TRUE, is_voided = FALSE` is reachable** — the migration guards suggest not, which would make the `customer_metrics` missing-`is_hidden` filter harmless. Only a data query settles it.
6. **Real production magnitudes** for the `DECIMAL(10,2)` overflow risk. Quantity has no upper bound at any layer (Zod `.int().min(0)` with no `.max()`, client clamps only at ≥0, SQL checks only `< 0`), so a fat-fingered `999999` in the sets field overflows `v_line_subtotal` and returns a raw `numeric field overflow` mid-loop. The fix is a `.max()` on quantity, not a wider column.
7. Supabase Auth server-side rate limiting isn't represented in `config.toml` in a way I could confirm; there is none at the application layer.
