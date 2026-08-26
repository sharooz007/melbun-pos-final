'use client'

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
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Dashboard Overview</h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time business performance for <span className="font-semibold text-gray-700">{displayDate}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm transition shadow-2xs disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            href="/pos"
            className="flex items-center gap-2 px-4 py-2 bg-[#8B0000] text-white rounded-lg hover:bg-[#660000] font-medium text-sm transition shadow-xs"
          >
            <ShoppingCart className="w-4 h-4" />
            New Sale
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-semibold flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading && !metrics ? (
        <div className="py-24 text-center text-gray-400 font-medium flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-[#8B0000]" />
          Loading analytics...
        </div>
      ) : metrics ? (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <p className="text-sm font-medium text-gray-500">Gross Sales</p>
                <div className="p-2 bg-gray-50 text-gray-600 rounded-lg">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mt-4">{formatINR(metrics.net_sales)}</h3>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <p className="text-sm font-medium text-gray-500">Collected Revenue</p>
                <div className="p-2 bg-gray-50 text-gray-600 rounded-lg">
                  <DollarSign className="w-5 h-5" />
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mt-4">{formatINR(metrics.collected_payments)}</h3>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <p className="text-sm font-medium text-gray-500">Total Expenses</p>
                <div className="p-2 bg-gray-50 text-gray-600 rounded-lg">
                  <TrendingDown className="w-5 h-5" />
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mt-4">{formatINR(metrics.total_expenses)}</h3>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <p className="text-sm font-medium text-gray-500">Total Invoices</p>
                <div className="p-2 bg-gray-50 text-gray-600 rounded-lg">
                  <Receipt className="w-5 h-5" />
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mt-4">{metrics.invoice_count}</h3>
            </div>
          </div>

          {/* Profit & Security Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
              <p className="text-sm font-medium text-gray-500">Gross Profit (Items - Discounts)</p>
              <h3 className="text-3xl font-bold text-[#8B0000] mt-4">
                {metrics.gross_profit !== null && metrics.gross_profit !== undefined ? formatINR(metrics.gross_profit) : '—'}
              </h3>
            </div>

            <div className="bg-[#8B0000] p-6 rounded-xl shadow-sm border border-[#A52A2A] flex flex-col justify-between text-white">
              <p className="text-sm font-medium text-red-100">Net Profit (Gross - Expenses)</p>
              <h3 className="text-3xl font-bold mt-4">
                {metrics.net_profit !== null && metrics.net_profit !== undefined ? formatINR(metrics.net_profit) : '—'}
              </h3>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Low Stock Alerts */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden lg:col-span-1">
              <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  Low Stock
                </h2>
              </div>
              
              {metrics.low_stock_items.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  All inventory levels look healthy!
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {metrics.low_stock_items.map((item) => (
                    <li key={item.variant_id} className="p-4 flex justify-between items-center hover:bg-gray-50 transition-colors">
                      <span className="font-medium text-gray-900">{item.name}</span>
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                        {item.stock_quantity} left
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent Invoices */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden lg:col-span-1">
              <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-blue-500" />
                  Recent Invoices
                </h2>
                <Link href="/invoices" className="text-xs font-bold text-blue-600 hover:underline">
                  View All &rarr;
                </Link>
              </div>
              
              {recentInvoices.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No recent invoices.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {recentInvoices.map((inv) => (
                    <li key={inv.id}>
                      <Link href="/invoices" className="p-4 flex justify-between items-center hover:bg-gray-50 transition-colors block">
                        <div>
                          <div className={`font-mono text-sm font-bold ${inv.is_voided ? 'line-through text-red-500' : 'text-gray-900'}`}>{inv.invoice_number}</div>
                          <div className="text-xs text-gray-500">{inv.customer_name || 'Walk-in'}</div>
                        </div>
                        <span className={`font-bold text-sm ${inv.is_voided ? 'text-red-500' : 'text-gray-900'}`}>
                          {formatINR(inv.total_amount)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent Expenses */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden lg:col-span-1">
              <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-red-500" />
                  Recent Expenses
                </h2>
                <Link href="/expenses" className="text-xs font-bold text-red-600 hover:underline">
                  View All &rarr;
                </Link>
              </div>
              
              {recentExpenses.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No recent expenses.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {recentExpenses.map((exp) => (
                    <li key={exp.id}>
                      <Link href="/expenses" className="p-4 flex justify-between items-center hover:bg-gray-50 transition-colors block">
                        <div>
                          <div className={`text-sm font-bold ${exp.is_voided ? 'line-through text-red-500' : 'text-gray-900'}`}>{exp.category}</div>
                          <div className="text-xs text-gray-500">{exp.payment_method}</div>
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
