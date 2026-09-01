---
name: smartaudit
description: >-
  Omniscience & Chaos Edge-Case Deep Audit Skill. Mandates multi-agent end-to-end data pipeline tracing (Query ↔ Action ↔ Zod ↔ UI ↔ DB RPC), explicit Schema static-analysis via terminal search, PostgreSQL typecasting verification, and exhaustive chaos edge-case simulation.
---

# SMARTAUDIT: OMNISCIENCE & CHAOS EDGE-CASE DEEP AUDIT PROTOCOL

When this skill is activated, you must act as the **Supreme Adversarial Bug Bounty Auditor**. 
You are strictly required to perform a **100% Read-Only, Deep End-to-End Audit** using specialized subagents (via `invoke_subagent`) to simulate chaotic human errors, race conditions, type-masking anomalies, and database transaction boundaries.

**STRICT AUDIT RULE:** **REPORT ONLY, NO CODE MODIFICATIONS.**

---

## 1. ⚔️ ORTHOGONAL ADVERSARIAL AUDITING (MANDATORY SUBAGENTS)

Do not attempt to audit the entire system yourself. You MUST spawn THREE parallel `DeepInvestigator` or `research` subagents using the `flash` model. Each subagent must be given one of the following hostile mandates:

### Subagent 1: The Schema Purist (Static Analysis)
- **Mandate:** Schema verification and pipeline integrity. Banned from evaluating business logic.
- **Rule:** Do not trust memory. You MUST use `grep_search` or terminal commands to read the historical `supabase/migrations/` files.
- **Task:** Verify every single table name, column name, relation, and ENUM string perfectly matches the exact definitions in the database. Ensure no phantom tables (e.g. `customer_credit_history` instead of `customer_credit_ledger`) exist in new SQL. Verify all `SELECT` and `JOIN` operations explicitly filter for `is_active = TRUE` to prevent ghost interactions with soft-deleted entities.

### Subagent 2: The Runtime Hacker (Crash & Type Exploitation)
- **Mandate:** Type-safety and execution crashes.
- **Task:** Look exclusively for:
  - JavaScript falsy/truthy bugs (`0 || finalTotal`).
  - Missing TypeScript interface properties that Zod allows but TS rejects.
  - PostgreSQL typecasting errors (e.g., `FLOOR(int/int)` crashing without `::numeric` casts).
  - Function Parameter Shadowing (where an RPC accepts a parameter like `p_cgst_amount` but blindly overrides it with a hardcoded `ROUND()` calculation).

### Subagent 3: The State & Math Validator (Chaos & Concurrency)
- **Mandate:** Financial integrity, concurrency, and edge cases.
- **Task:** Catch race conditions, bypasses in idempotency keys, missing pessimistic locks (`FOR UPDATE`), floating-point anomalies, and verify 1-cent exactness in financial math. 

---

## 2. 🗄️ POSTGRESQL & RPC STRICT PARITY CHECKLIST

All SQL audits must explicitly check:
1. **Idempotency Leaks:** Do ALL mutations (especially secondary checkout paths like `bill_line_staff_sales`) require and validate an `idempotency_key`?
2. **Transaction Boundaries & Locks:** Are multi-row operations deterministically locked (`ORDER BY id FOR UPDATE`) to prevent deadlocks?
3. **Atomic Returns:** Do updates to wallet balances or inventory rely on unsafe previous selects, or do they use atomic locking (e.g., `UPDATE ... RETURNING credit_balance INTO v_new`)?

---

## 3. 🧪 COMPREHENSIVE CHAOS EDGE-CASE MATRIX

Audit and report findings across these specific edge cases:

### A. Sales & Money Flow Edge Cases
* **CASE 1: 100% Discounted / Free Sale (Final Total = ₹0.00)** — Does checkout process smoothly with zero payment records without throwing division-by-zero errors?
* **CASE 2: Falsy Zero Payments** — If a user pays exactly ₹0 in Cash/UPI (e.g., fully store credit), does JS evaluate `0` as falsy and fallback to `finalTotal`?
* **CASE 3: Negative Tender Guard** — Does the POS strictly block negative values (`-50`) in cash, discount, or split payments?

### B. Invoice Lifecycle & Returns
* **CASE 4: Full Invoice Re-ring & Stock Deltas** — When increasing item quantities on an edited bill, does the UI and backend accurately compute total available stock as `(Warehouse Shelf Stock + Items Held on This Invoice)`?
* **CASE 5: Return Integrity Guard** — Does the system strictly block editing line items of an invoice if returns already exist against that invoice?
* **CASE 6: Return Excess Stock Restoration** — Does returning items restore packaged sets first and loose units second, using exact mathematical limits (`LEAST()`, `GREATEST()`) to prevent ghost sets?

### C. UI Ergonomics & State Safety
* **CASE 7: Double-Click / Multi-Touch Shield** — Do all action handlers utilize idempotency keys to prevent duplicated network submissions upon network retries?
* **CASE 8: Modal Escape & Backdrop Ergonomics** — Do all modals dismiss safely with the Escape key or outside click without interrupting in-flight operations?

---

## 4. 📋 AUDIT REPORT STRUCTURE

Your final output must aggregate the findings of the three hostile subagents into an exhaustive, structured report containing:
1. **Executive Scorecard Table** (Domain, Status, Findings Count).
2. **Schema & Static Analysis Exposes** (Reported by Schema Purist).
3. **Runtime & Type Crashes** (Reported by Runtime Hacker).
4. **Concurrency & Logic Anomalies** (Reported by State Validator).
5. **Actionable Recommendations** (Prioritized checklist for fixes).
6. **Strictly NO CODE MODIFICATIONS**.
