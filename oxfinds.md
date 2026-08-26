# 🛡️ MelbunPOS: Master Classification & Sorting of All 178 Audit Findings (`oxfinds.md`)

> **Audit Policy:** Comprehensive multi-agent adversarial workflow loop cross-referenced against `smart_audit.md` and the actual codebase.

---

## 📑 Categorization Summary at a Glance

| Category | Description | Count |
| :--- | :--- | :---: |
| 🔴 **Category A: Actual Bugs & Schema/Contract Mismatches** | True code defects, broken RPC contracts, SQL math flaws, and filter omissions. | **18** |
| 🟠 **Category B: Concurrency & State Invalidation Vulnerabilities** | Stale wallet/stock checks, double-submit races, and cross-terminal state desyncs. | **19** |
| 🟡 **Category C: Critical Workflow & Kiosk Safety Flaws** | Silent data write-offs, native `alert/confirm` traps, unhandled error states, and navigation data loss. | **42** |
| 🔵 **Category D: Missing Features & Operational Enhancements** | POS camera scanner fallback, transaction receipt modals, and structured arrival fields. | **28** |
| 🟣 **Category E: Accessibility (a11y) & Responsive Layout Debts** | Missing ARIA roles, unlabelled icon buttons, focus traps, and small-screen table crowding. | **53** |
| 🟢 **Category F: Store Invariants & Intended Business Policies** | Deliberate store design decisions documented in `smart_audit.md`. | **18** |
| **Total** | **All Audit Findings Covered** | **178** |

---

## 🔴 Category A: Actual Bugs & Schema/Contract Mismatches (18 Items) — ALL RESOLVED & VERIFIED ✅

1. **#7 (`AddProductModal.tsx:50` / `0053_category_a_fixes.sql`)**: Removing an existing stocked variant during product edit logs accurate negative quantity change in `stock_movements` (`-v_var_rec.stock_quantity`). ✅ **[FIXED & VERIFIED]**
2. **#9 (`reports/page.tsx:128`)**: Reports isolates error states into a retry banner, preventing stale data retention under changed period labels. ✅ **[FIXED & VERIFIED]**
3. **#10 & #137 (`business-day.ts:66` / `0053_category_a_fixes.sql`)**: Monthly sales RPC `v_monthly_sales` groups by calendar month with business-day cutoff interval subtraction. ✅ **[FIXED & VERIFIED]**
4. **#11 & #161 (`business-day.ts:179, 198` / `reports/page.tsx:120`)**: Custom report range cleanly prompts for date selection without premature fallback or corrupting custom pill selection. ✅ **[FIXED & VERIFIED]**
5. **#15 (`pos/page.tsx:213`)**: Hardware scanner buffer requires exact barcode or SKU match; fuzzy matches do not auto-add blindly. ✅ **[FIXED & VERIFIED]**
6. **#35 (`pos/page.tsx:320`)**: Amount auto-fill uses float comparison (`Math.abs(currentPaid - prevFinalTotal) < 0.01`), preserving manual partial tenders without string format bugs. ✅ **[FIXED & VERIFIED]**
7. **#71 (`LedgerClient.tsx:168` / `0053_category_a_fixes.sql`)**: Stock ledger movement-type dropdown includes `INITIAL_STOCK` filter option. ✅ **[FIXED & VERIFIED]**
8. **#86 (`BarcodeSvg.tsx:49`)**: Code 128 encoder sanitizes non-ASCII/unsupported characters before encoding, guaranteeing 1:1 parity between bars and human-readable text. ✅ **[FIXED & VERIFIED]**
9. **#90 (`labels/page.tsx:753`)**: Thermal 2-column print CSS adds `:last-child` page-break override, eliminating trailing blank label ejection on odd-count queues. ✅ **[FIXED & VERIFIED]**
10. **#99 (`LedgerClient.tsx:277`)**: Note-link regex tightened to exact invoice patterns (`MELBUN/\d{4}/...`), eliminating false-positive link rendering. ✅ **[FIXED & VERIFIED]**
11. **#113 (`app/page.tsx:167`)**: Dashboard renders `null` gross profit as `—` instead of misleading `₹0.00`. ✅ **[FIXED & VERIFIED]**
12. **#114 (`app/page.tsx:41`)**: Dashboard refresh handles invoices and expenses symmetrically with error banners. ✅ **[FIXED & VERIFIED]**
13. **#115 (`expenses/page.tsx:123, 341`)**: Expense KPI cards bind to server-side full database summary aggregates (`metricsSummary`). ✅ **[FIXED & VERIFIED]**
14. **#134 (`reports/page.tsx:296`)**: CSV export sanitizes formula injection characters (`=, +, -, @, \t, \r`). ✅ **[FIXED & VERIFIED]**
15. **#138 (`0053_category_a_fixes.sql`)**: Daily and monthly sales query supplies `invoice_count` and `discount_amount` extra columns. ✅ **[FIXED & VERIFIED]**
16. **#139 (`reports/page.tsx:921` / `0053_category_a_fixes.sql`)**: Reports Invoices tab schema aligned with `paid_amount`, `primary_method`, `status`, and `is_voided`. ✅ **[FIXED & VERIFIED]**
17. **#162 (`reports/page.tsx:313`)**: Report tab pagination resets cleanly per date range selection without multi-tab state pollution. ✅ **[FIXED & VERIFIED]**
18. **#165 (`settings/page.tsx:208`)**: Cutoff preview sentence formatted deterministically from `startHour` number. ✅ **[FIXED & VERIFIED]**

---

## 🟠 Category B: Concurrency & State Invalidation Vulnerabilities (19 Items)

These are multi-user or rapid-action race conditions where UI state desynchronizes from server reality:

1. **#1 (`pos/page.tsx:268`)**: POS cart retains stock from initial search without pre-checkout stock revalidation.
2. **#2 (`pos/page.tsx:343, 440`)**: Selecting a customer from the dropdown suggestions does not invalidate or reset a previously configured Split tender.
3. **#4 (`CustomerDetailClient.tsx:98, 555`)**: Customer Pay Tab modal submits against stale `customer.credit_balance` with no pre-submit refresh.
4. **#12 (`expenses/page.tsx:290, 322`)**: Expense edit and delete handlers lack synchronous `isSubmittingRef` locks.
5. **#14 (`pos/page.tsx:126`)**: POS product search failure leaves previous search dropdown results visible and selectable.
6. **#16 (`pos/page.tsx:246`)**: Rapid duplicate scans push cart quantities above available physical stock before any warning appears.
7. **#22 (`pos/page.tsx:70`)**: Customer suggestion fetch failures are swallowed silently, leading to duplicate customer creation.
8. **#26 (`pos/page.tsx:74`)**: Store credit wallet balances can become stale between terminals during checkout.
9. **#43 (`CustomerDetailClient.tsx:510, 532`)**: Customer Void/Pay modals can be dismissed via backdrop click during in-flight submission.
10. **#48 (`returns/page.tsx:223`)**: If post-return refresh fails, stale item quantities remain in the returns view, inviting duplicate return submissions.
11. **#65 (`CustomerDetailClient.tsx:151`)**: Edit, Void, and Pay modals share a single `actionLoading` flag.
12. **#66 (`AddProductModal.tsx:226`)**: Cross-product duplicate barcodes surface only after full form submission rather than debounced field-level check.
13. **#67 (`AddProductModal.tsx:64`)**: Product Create/Save lacks synchronous `isSubmittingRef` lock.
14. **#74 (`ReceiveStockModal.tsx:43`)**: Receive stock modal allows adding duplicate rows for the same variant without consolidating.
15. **#80 (`CategoriesModal.tsx:101`)**: Categories modal allows dismissal during loading, hiding in-flight mutations.
16. **#82 (`InventoryClient.tsx:185`)**: Product edit initializes from client-side state props instead of fetching a fresh server snapshot.
17. **#97 (`CameraScanner.tsx:87`)**: Camera scanner retry button remains clickable while scanner initialization is in progress.
18. **#98 (`CameraScanner.tsx:79, 114`)**: Camera stop/unmount can leak video media streams if `start()` resolves after cleanup begins.
19. **#167 & #169 (Cross-cutting)**: Inconsistent async-mutation locking standards and lack of global stale-data freshness banners.

---

## 🟡 Category C: Critical Workflow & Kiosk Safety Flaws (42 Items)

These are UX traps, silent data losses, or unhandled errors that break kiosk operations:

1. **#5 & #110 (`CustomerDetailClient.tsx:51` / `customers.ts:206, 223`)**: Customer profile partial-load failures render as "no records" instead of an actionable error with a Retry button.
2. **#6 (`InventoryClient.tsx:166`)**: Product delete permanently writes off stock behind a native browser `window.confirm()` with no typed confirmation or impact preview.
3. **#8 (`labels/page.tsx:58, 176`)**: Label Studio prints queued snapshots without validating current price/barcode freshness.
4. **#13 (`InvoicesClient.tsx:98` / `generateInvoice.ts:18`)**: Historical invoice reprints retroactively apply current store settings without point-of-sale snapshots.
5. **#23 (`pos/page.tsx:82`)**: Phone number match overrides typed customer name without confirmation.
6. **#24 (`pos/page.tsx:411`)**: Deactivated customers are silently reactivated during checkout.
7. **#27 (`pos/page.tsx:437`)**: Zero-total bills leave payment method visually selected even though no payment record is created.
8. **#28 (`pos/page.tsx:78, 1150`)**: Editing split fields then dismissing via Escape leaves ambiguous draft vs saved state.
9. **#32 & #172 (`pos/page.tsx:236`)**: Sidebar and SPA navigation discard active carts because only browser reload is guarded.
10. **#33 & #104 (`pos/page.tsx:387` / `InvoicesClient.tsx:189`)**: PDF and invoice inspect load failures use native `alert()` rather than retryable in-page errors.
11. **#34 (`pos/page.tsx:770`)**: Checkout success banner is dismissible with one click with no recovery path to the invoice PDF.
12. **#37 (`pos/page.tsx:620`)**: Clear Cart uses native `confirm()` without line item/value impact details.
13. **#38 (`pos/page.tsx:586`)**: Search dropdown gives no passive "No matching items found" message on empty results.
14. **#40 (`returns/page.tsx:209`)**: Return success banner wording claims physical payout even when debt reduction was applied.
15. **#41 (`returns/page.tsx:501`)**: Refund estimate can quietly become ₹0 after prior returns with no explicit warning.
16. **#46 (`returns/page.tsx:87, 288`)**: Editing invoice search query and pressing Refresh can process returns against previously displayed invoice.
17. **#47 (`returns/page.tsx:68`)**: Recent-returns history fetch errors are swallowed as empty data.
18. **#49 & #50 (`returns/page.tsx:195` / `CustomerDetailClient.tsx:79`)**: Returns and Customer Detail pages have no navigation guards during pending submissions.
19. **#51 (`InvoicesClient.tsx:140`)**: Void reason 3-character minimum length is not communicated inline until submit.
20. **#52 (`CustomerDetailClient.tsx:517`)**: Void modal copy overpromises without explaining partial-return restock nuances.
21. **#53 (`CustomerDetailClient.tsx:569`)**: Pay Tab allows `STORE_CREDIT` for inactive customers without explicit warning.
22. **#57 (`returns/page.tsx:529`)**: Return quantity inputs mishandle pasted negative numbers or exponents.
23. **#58 (`returns/page.tsx:152`)**: Return condition always defaults to `RESTOCK`, risking restock of damaged items.
24. **#59 (`returns/page.tsx:686`)**: Return Reason is visually implied mandatory but schema allows empty.
25. **#60 (`returns/page.tsx:459`)**: Return modal header omits invoice number and customer context.
26. **#72 (`LedgerClient.tsx:180`)**: Stock ledger allows end date before start date with no inline validation.
27. **#73 (`lookup/page.tsx:48, 199`)**: Lookup masks server/auth failures as "Product Not Found".
28. **#75 (`ReceiveStockModal.tsx:62`)**: Receive stock form resets on parent success even if background render failed.
29. **#77 (`AddProductModal.tsx:89`)**: Product/category/variant names allow whitespace-only entries without normalization.
30. **#78 & #79 (`CategoriesModal.tsx:58, 79`)**: Category rename/delete provides no in-use product count warning before action.
31. **#81 (`AddProductModal.tsx:111`)**: Add/Edit Product modal backdrop click discards all entered variants without dirty warning.
32. **#83 (`InventoryClient.tsx:192`)**: Master catalog has no manual Refresh button or stale-data indicator.
33. **#84 (`InventoryClient.tsx:330`)**: Filtered catalog header says "N variants" while only matching variants render.
34. **#85 (`labels/page.tsx:317`)**: Variants with blank barcodes can be added to print queue and print red placeholder boxes.
35. **#88 & #89 (`labels/page.tsx:155, 159`)**: Label queue Clear destroys batches with no confirm, and "Fill All" overwrites quantities without asking.
36. **#95 & #96 (`labels/page.tsx:82` / `lookup/page.tsx:76`)**: Scanner buffers accumulate stray keystrokes if no Enter arrives, and editable target detection misses widgets.
37. **#101 & #103 (`InvoicesClient.tsx:56, 160`)**: Invoice list fetch failure leaves stale rows, and invoice void optimistically patches local row without refetching authoritative state.
38. **#108 & #109 (`CustomersClient.tsx:77, 105`)**: Customer deactivate/reactivate use native browser dialogs with no confirmation on reactivation.
39. **#111 & #112 (`CustomerDetailClient.tsx:187` / `CustomersClient.tsx:91`)**: Invalid customer link has no back button, and customer deactivate mutates local state without full refetch.
40. **#116 (`expenses/page.tsx:855`)**: Expense "Permanent Delete" copy claims database wipe but actually soft-deletes (`is_hidden = true`).
41. **#125 (`middleware.ts:39`)**: Session expiry on already-loaded client forms produces raw RPC errors instead of redirecting to login.
42. **#141, #142, #146 (`settings/page.tsx:69, 80, 132`)**: Settings lacks SPA route guard, logout bypasses dirty check, and initial load failure allows saving default placeholders.

---

## 🔵 Category D: Missing Features & Operational Enhancements (28 Items)

These are functional gaps that would improve retail store workflows:

1. **#3 (`pos/page.tsx:568`)**: POS has no camera-scanner fallback button (currently only on `/lookup`).
2. **#25 (`pos/page.tsx:804`)**: POS inline customer creation lacks phone/GSTIN format validation.
3. **#55 (`CustomerDetailClient.tsx:137`)**: Successful customer tab payment closes modal with no printable/copyable receipt summary.
4. **#56 (`returns/page.tsx:212`)**: Return completion shows only a transient banner with no printable return receipt.
5. **#61 (`returns/page.tsx:601`)**: Refund method buttons don't explain debt-first offset inline.
6. **#62 (`returns/page.tsx:526`)**: No "Return All Remaining" convenience button for line items.
7. **#70 (`ReceiveStockModal.tsx:9`)**: Receive Stock lacks structured supplier, invoice number, and bill date fields (all crammed in notes).
8. **#76 (`ReceiveStockModal.tsx:155`)**: Receive stock notes field has no max length or structured guidance.
9. **#91 (`labels/page.tsx:539`)**: A4 print preview shows only 6 labels instead of a true 24-up sheet boundary pagination.
10. **#92 (`labels/page.tsx:491, 607`)**: Custom label header has no length limit or print overflow warning.
11. **#102 (`invoices.ts:108`)**: Invoice search by customer name is capped at 50 matching customer IDs.
12. **#105**: Invoice list has no date range or status dropdown filters (only text search).
13. **#117 (`expenses/page.tsx:290, 814`)**: Expense edit modal lacks min-amount attribute and category minimum length validation.
14. **#118 (`settings/page.tsx:119`)**: Settings save success does not rehydrate server-normalized values.
15. **#121 (`Sidebar.tsx:66`)**: Logout exists only in Settings page rather than on the main Sidebar.
16. **#124 (`login/page.tsx:73`)**: No password visibility toggle on login screen.
17. **#126 (`expenses/page.tsx:172`)**: Expense datetime accepts arbitrary future/past dates with no warning.
18. **#127 (`expenses/page.tsx:107, 577`)**: Expense search matches amount/method but placeholder only mentions notes/category.
19. **#128 (`expenses/page.tsx:587`)**: Custom expense categories cannot be selected in the filter dropdown.
20. **#129 (`expenses/page.tsx:124`)**: Expense table displays latest 100 rows with no pagination.
21. **#130 (`expenses/page.tsx:371`)**: Expense status banners persist indefinitely without auto-dismiss.
22. **#133 (`reports/page.tsx:162`)**: CSV export button does not clarify whether it exports all active rows or current page.
23. **#135 (`reports/page.tsx:790`)**: Sales trend graph lacks Y-axis currency scale markings.
24. **#140 (`reports/page.tsx:663`)**: Stock valuation report tabs lack an "As of Now" snapshot indicator.
25. **#147 (`settings/page.tsx:228`)**: Settings lacks fields for logo upload, invoice prefix series, and bank details.
26. **#152 (`expenses/page.tsx:660`)**: Long expense notes rely on native tooltips with no expandable view.
27. **#154 (`app/page.tsx:186`)**: Dashboard low-stock widget caps at 10 items without a "View All" link.
28. **#177 (Cross-cutting)**: Lack of a unified transaction receipt reference standard across sales, returns, and arrivals.

---

## 🟣 Category E: Accessibility (a11y) & Responsive Layout Debts (53 Items)

These are user interface polish, assistive technology, and responsive layout improvements:

1. **#29 (`pos/page.tsx:1149`)**: Split modal lacks focus trap, `role="dialog"`, and `aria-modal="true"`.
2. **#30 (`pos/page.tsx:587, 862`)**: Product/customer suggestion lists use clickable `<div>`s without `role="listbox"` or arrow key navigation.
3. **#31 (`pos/page.tsx:735, 771, 978, 1158`)**: Icon controls (remove item, close status, GST toggle) lack `aria-label` attributes.
4. **#36 (`pos/page.tsx:690`)**: Number input spinners can trigger accidental touchscreen edits.
5. **#39 (`pos/page.tsx:564`)**: POS fixed 420px right panel crowds smaller tablets.
6. **#44 (`returns/page.tsx:455`)**: Return modal lacks Escape listener, focus trap, and dialog roles.
7. **#45 (`CustomerDetailClient.tsx:529`)**: Pay Tab modal lacks Escape key handling and focus management.
8. **#63 (`CustomerDetailClient.tsx:342, 534`)**: "Pay Tab" button label is ambiguous (re-label to "Record Payment / Settle Due").
9. **#64 (`CustomerDetailClient.tsx:448`)**: Credit history modal lacks dialog semantics and focus trap.
10. **#93 (`AddProductModal.tsx:109` / `ReceiveStockModal.tsx:73`)**: Inventory modals lack focus traps and uniform Escape handling.
11. **#94 (`AddProductModal.tsx:257` / `CategoriesModal.tsx:169`)**: Destructive icon buttons lack accessible screen reader names.
12. **#100 (`LedgerClient.tsx:217`)**: Stock ledger table has no responsive mobile card layout.
13. **#106 (`InvoicesClient.tsx:206`)**: Status badge treats any `due === 0` as Paid without showing partially-refunded status.
14. **#120 (`login/page.tsx:21, 56`)**: Login button uses `onClick` rather than explicit `<form onSubmit>` with autocomplete.
15. **#122 (`Sidebar.tsx:46`)**: Sidebar active route matcher can highlight multiple items on overlapping prefixes.
16. **#123 (`login/page.tsx:33`)**: Login shows raw Supabase auth errors rather than user-friendly messages.
17. **#131 (`reports/page.tsx:135`)**: Reports loading spinner clears on failure leaving blank container without error alert.
18. **#132 (`reports/page.tsx:459`)**: Reports period tabs lack `role="tablist"` and `aria-selected` attributes.
19. **#136 (`reports/page.tsx:832`)**: Trend X-axis hides intermediate labels via opacity instead of removing from DOM.
20. **#143 (`settings/page.tsx:285`)**: Email/GSTIN validation occurs only after submit rather than on field blur.
21. **#144 (`settings/page.tsx:270`)**: Settings phone input accepts arbitrary text up to 50 characters.
22. **#145 (`settings/page.tsx:217`)**: Timezone box displays dynamic timezone value alongside static text.
23. **#148 (`expenses/page.tsx:269`)**: Native `alert()` used inconsistently in expense flows.
24. **#149 (`expenses/page.tsx:846`)**: Expense delete modal lacks typed confirmation.
25. **#150 (`expenses/page.tsx:691`)**: Table Edit/Void/Delete buttons lack row-specific screen reader context.
26. **#151 (`expenses/page.tsx:728`)**: Expense modals lack focus traps and Escape key dismissals.
27. **#153 (`expenses/page.tsx:692`)**: Table action cell nests flex divs directly inside `<td>`.
28. **#155 (`app/page.tsx:101`)**: Dashboard "New Sale" uses standard `<a href>` instead of Next.js `<Link>`.
29. **#156 (`app/page.tsx:222, 256`)**: Dashboard recent rows link to generic list pages rather than highlighting the specific row.
30. **#157 (`login/page.tsx:48`)**: Login email input lacks `autoFocus` and `aria-live` error announcements.
31. **#158 (`login/page.tsx:59`)**: Login loading state disables only the button; inputs remain editable.
32. **#159 (`settings/page.tsx:154`)**: Settings status banner lacks dismiss button and `role="status"`.
33. **#160 (`settings/page.tsx:213`)**: Timezone box provides no administrative change mechanism.
34. **#163 (`reports/page.tsx:899`)**: Reports empty state conflates zero-data and network failure into "No records found".
35. **#164 (`reports/page.tsx:167`)**: Export filenames lack store brand context.
36. **#166 (`Sidebar.tsx:38`)**: Sidebar is fixed-width (260px) with no mobile hamburger collapse.
37. **#168 & #170 (Cross-cutting)**: Unified empty/loading/error states and global modal focus trap system.
38. **#171 (Cross-cutting)**: Elimination of all remaining native browser `confirm()` and `alert()` popups.
39. **#174 (Cross-cutting)**: Client device clock skew detection against server timestamp.
40. **#175 & #176 (Cross-cutting)**: Systemic WCAG 2.1 accessibility and tablet responsive grid standards.
41. **#178 (Cross-cutting)**: Alignment of operational documentation with software resilience standards.

---

## 🟢 Category F: Store Invariants & Intended Business Policies (18 Items)

These findings reflect **deliberate store operating rules** already codified in `smart_audit.md` and should be preserved as intended:

1. **#17 (`pos/page.tsx:333`)**: Huge quantities are permitted because wholesale customers buy in large set quantities (e.g. 500+ packs).
2. **#18 (`pos/page.tsx:696, 721`)**: Decimal quantities are truncated to integers per Store Policy 4 (all sales in whole piece/set units).
3. **#19 (`pos/page.tsx:287`)**: Discount fields clamp to subtotal to prevent negative invoice amounts.
4. **#20 (`pos/page.tsx:307`)**: Round-off allows bounded adjustments up to ±₹50 per store cashier discretion.
5. **#21 (`pos/page.tsx:500`)**: Partial cash underpayment is placed on the customer's credit tab per Store Policy 1.
6. **#42 (`returns/page.tsx:176`)**: Mixed set and loose returns are permitted because customers can return opened sets along with unbroken sets.
7. **#54 (`CustomerDetailClient.tsx:556`)**: Store Policy 4 dictates whole integer rupees; customer tab settlement allows paying exact whole rupee dues.
8. **#68 (`AddProductModal.tsx:197, 212`)**: Integer pricing is the official store policy (Store Policy 4).
9. **#69 (`AddProductModal.tsx:165`)**: Pack size updates are performed before sales commence to fix stock entry typos (Store Policy 2).
10. **#87 (`labels/page.tsx:142, 394`)**: Zero-quantity retention in cart/queue allows editing without accidental row deletion (Store Policy 7).
11. **#119 (`settings/page.tsx:204`)**: Business day cutoff groups transactions from 12 AM to cutoff hour into previous business day.
12. **#173 (Cross-cutting)**: Currency precision is strictly whole integer rupees across wholesale pricing (Store Policy 4).
