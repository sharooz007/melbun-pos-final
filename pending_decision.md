# Pending Decisions

## Issue #7: Dashboard & Reports Metric Adjustments for Product Returns & Refunds
- **Severity**: High (P1)
- **Status**: On Hold / Pending User Decision
- **Description**: Sales, Gross Profit, and Collections metrics in Dashboard RPC (`get_dashboard_metrics` in `supabase/migrations/0038_fix_dashboard_metrics.sql`) and Reports Action (`src/lib/actions/reports.ts`) currently do not deduct refunded amounts or product returns from gross sales totals.
- **User Instruction**: Leave this item for now. User will provide specific business guidance on how returns, refunds, and cost-of-goods adjustments should be calculated across historical versus period-based dashboard and report figures.

## Issue #1: Customer Credit & Returns Refund Logic
- **Severity**: Critical (P0)
- **Status**: Pending Architectural Strategy
- **Description**: When a customer returns goods on an invoice that was partially paid or bought on credit:
  - If the customer has outstanding credit dues on that invoice, the return amount will deduct directly from their credit balance.
  - If the customer paid in cash/UPI or the return exceeds their debt, the remaining amount can either be refunded as Cash/UPI or added to customer store credit.
- **User Instruction**: User to confirm if store credit wallet balance is preferred over direct Cash/UPI payout.

## Issue #2: Tightening Direct Table RLS Policies
- **Severity**: Critical (P0)
- **Status**: Documented for Post-Launch Security Hardening
- **Description**: Tables currently allow authenticated users full access policies (`FOR ALL TO authenticated USING (true)`). In the future, direct mutations can be restricted to `service_role` and `SECURITY DEFINER` RPCs to prevent unauthorized direct SQL execution.

