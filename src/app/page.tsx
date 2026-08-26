'use client'

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getDashboardMetricsAction } from '@/lib/actions/dashboard';
import { getStoreSettingsAction } from '@/lib/actions/settings';
import { getBusinessDayCutoff } from '@/lib/business-day';
import { DashboardMetrics } from '@/types/dashboard';
import { IndianRupee, TrendingUp, TrendingDown, Receipt, AlertCircle, RefreshCw, Lock, ShoppingCart, DollarSign } from 'lucide-react';

const formatINR = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2
  }).format(amount);
};

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [recentInvoices, setRecentInvoices] = useState<any[]>([]);
  const [recentExpenses, setRecentExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayDate, setDisplayDate] = useState<string>('');

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Get store business day cutoff settings
      const settingsRes = await getStoreSettingsAction();
      const cutoffHour = settingsRes.success && settingsRes.data ? (settingsRes.data.business_day_start_hour ?? 6) : 6;
      const timezone = settingsRes.success && settingsRes.data ? (settingsRes.data.timezone || 'Asia/Kolkata') : 'Asia/Kolkata';

      const cutoff = getBusinessDayCutoff(new Date(), cutoffHour, timezone);
      const [bY, bM, bD] = cutoff.businessDateString.split('-').map(Number);
      const bDateObj = new Date(Date.UTC(bY, bM - 1, bD));
      setDisplayDate(bDateObj.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }));

      const [res, invRes, expRes] = await Promise.all([
        getDashboardMetricsAction({
          start_date: cutoff.start.toISOString(),
          end_date: cutoff.end.toISOString()
        }),
        import('@/lib/actions/invoices').then(m => m.getAllInvoicesAction(5)),
        import('@/lib/actions/expenses').then(m => m.getExpensesAction(5))
      ]);

      if (res.success) {
        setMetrics(res.data);
      } else {
        setError(res.error || 'Failed to load dashboard metrics');
      }

      setRecentInvoices(invRes || []);
      if (expRes.success && expRes.data) {
        setRecentExpenses(expRes.data);
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return (
    <div className="p-3 pb-28 md:p-6 w-full max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary tracking-tight">Dashboard Overview</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-ink-primary rounded-lg hover:bg-row-alt font-medium text-[13px] transition shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            href="/pos"
            className="flex items-center gap-2 px-3 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover font-medium text-[13px] transition shadow-sm"
          >
            <ShoppingCart className="w-4 h-4" />
            New Sale
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 font-medium">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-ink-muted font-medium animate-pulse">
          Loading analytics...
        </div>
      ) : metrics ? (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <div className="bg-surface p-4 md:p-6 rounded-[12px] shadow-sm border border-border flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <p className="text-[12px] md:text-sm font-medium text-ink-muted">Gross Sales</p>
                <div className="text-ink-muted hidden sm:block">
                  <TrendingUp className="w-4 h-4 md:w-5 md:h-5" />
                </div>
              </div>
              <h3 className="text-lg md:text-2xl font-black font-mono text-ink-primary mt-2 md:mt-4">{formatINR(metrics.net_sales)}</h3>
            </div>

            <div className="bg-surface p-4 md:p-6 rounded-[12px] shadow-sm border border-border flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <p className="text-[12px] md:text-sm font-medium text-ink-muted">Collected</p>
                <div className="text-ink-muted hidden sm:block">
                  <DollarSign className="w-4 h-4 md:w-5 md:h-5" />
                </div>
              </div>
              <h3 className="text-lg md:text-2xl font-black font-mono text-ink-primary mt-2 md:mt-4">{formatINR(metrics.collected_payments)}</h3>
            </div>

            <div className="bg-surface p-4 md:p-6 rounded-[12px] shadow-sm border border-border flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <p className="text-[12px] md:text-sm font-medium text-ink-muted">Expenses</p>
                <div className="text-ink-muted hidden sm:block">
                  <TrendingDown className="w-4 h-4 md:w-5 md:h-5" />
                </div>
              </div>
              <h3 className="text-lg md:text-2xl font-black font-mono text-ink-primary mt-2 md:mt-4">{formatINR(metrics.total_expenses)}</h3>
            </div>

            <div className="bg-surface p-4 md:p-6 rounded-[12px] shadow-sm border border-border flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <p className="text-[12px] md:text-sm font-medium text-ink-muted">Invoices</p>
                <div className="text-ink-muted hidden sm:block">
                  <Receipt className="w-4 h-4 md:w-5 md:h-5" />
                </div>
              </div>
              <h3 className="text-lg md:text-2xl font-black font-mono text-ink-primary mt-2 md:mt-4">{metrics.invoice_count}</h3>
            </div>
          </div>

          {/* Recent Invoices & Expenses */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Recent Invoices */}
            <div className="bg-surface rounded-[12px] shadow-sm border border-border overflow-hidden lg:col-span-1">
              <div className="p-4 md:p-6 border-b border-border bg-row-alt flex justify-between items-center">
                <h2 className="text-lg font-bold text-ink-primary flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-blue-500" />
                  Recent Invoices
                </h2>
                <Link href="/invoices" className="text-xs font-bold text-blue-600 hover:underline">
                  View All &rarr;
                </Link>
              </div>
              
              {recentInvoices.length === 0 ? (
                <div className="p-4 md:p-8 text-center text-ink-muted">
                  No recent invoices.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {recentInvoices.map((inv) => (
                    <li key={inv.id}>
                      <Link href={`/invoices/${inv.id}`} className="p-4 flex justify-between items-center hover:bg-row-alt transition-colors block">
                        <div>
                          <div className={`font-mono text-sm font-bold ${inv.is_voided ? 'line-through text-red-500' : 'text-ink-primary'}`}>{inv.invoice_number}</div>
                          <div className="text-xs text-ink-muted">{inv.customer_name || 'Walk-in'}</div>
                        </div>
                        <span className={`font-bold text-sm ${inv.is_voided ? 'text-red-500' : 'text-ink-primary'}`}>
                          {formatINR(inv.total_amount)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent Expenses */}
            <div className="bg-surface rounded-[12px] shadow-sm border border-border overflow-hidden lg:col-span-1">
              <div className="p-4 md:p-6 border-b border-border bg-row-alt flex justify-between items-center">
                <h2 className="text-lg font-bold text-ink-primary flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-red-500" />
                  Recent Expenses
                </h2>
                <Link href="/expenses" className="text-xs font-bold text-red-600 hover:underline">
                  View All &rarr;
                </Link>
              </div>
              
              {recentExpenses.length === 0 ? (
                <div className="p-4 md:p-8 text-center text-ink-muted">
                  No recent expenses.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {recentExpenses.map((exp) => (
                    <li key={exp.id}>
                      <Link href="/expenses" className="p-4 flex justify-between items-center hover:bg-row-alt transition-colors block">
                        <div>
                          <div className={`text-sm font-bold ${exp.is_voided ? 'line-through text-red-500' : 'text-ink-primary'}`}>{exp.category}</div>
                          <div className="text-xs text-ink-muted">{exp.payment_method}</div>
                        </div>
                        <span className={`font-bold text-sm ${exp.is_voided ? 'text-red-500' : 'text-red-600'}`}>
                          {formatINR(exp.amount)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
