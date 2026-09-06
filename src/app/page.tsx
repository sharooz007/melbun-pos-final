'use client'

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { getDashboardMetricsAction } from '@/lib/actions/dashboard';
import { getStoreSettingsAction } from '@/lib/actions/settings';
import { getBusinessDayCutoff } from '@/lib/business-day';
import { getAllInvoicesAction, getInvoicesPagedAction } from '@/lib/actions/invoices';
import { getExpensesAction } from '@/lib/actions/expenses';
import { DashboardMetrics } from '@/types/dashboard';
import { 
  IndianRupee, TrendingUp, TrendingDown, Receipt, AlertCircle, 
  RefreshCw, ShoppingCart, DollarSign, Search, X, Edit3, User, Phone, ArrowRight
} from 'lucide-react';

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

  // Dashboard Global Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchRequestIdRef = useRef<number>(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
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
        getAllInvoicesAction(5),
        getExpensesAction(1, 5)
      ]);

      if (res.success) {
        setMetrics(res.data);
      } else {
        setError(res.error || 'Failed to load dashboard metrics');
      }

      setRecentInvoices(invRes || []);
      if (expRes.success && expRes.data) {
        setRecentExpenses(expRes.data.items || []);
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

  // Unmount cleanup for search timer
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  // Click outside & Escape key handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Global Search Handler (Debounced & Sequence-Checked)
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    setShowDropdown(true);
    const currentReqId = ++searchRequestIdRef.current;

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await getInvoicesPagedAction({
          query: query.trim(),
          page: 1,
          pageSize: 8
        });

        // Ensure this response matches the most recent search request
        if (currentReqId === searchRequestIdRef.current) {
          if (res.success && Array.isArray(res.data)) {
            setSearchResults(res.data);
          } else {
            setSearchResults([]);
          }
        }
      } catch (err) {
        if (currentReqId === searchRequestIdRef.current) {
          setSearchResults([]);
        }
      } finally {
        if (currentReqId === searchRequestIdRef.current) {
          setIsSearching(false);
        }
      }
    }, 250);
  };

  return (
    <div className="p-3.5 pb-36 sm:p-6 md:p-6 md:pb-8 w-full max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary tracking-tight">Dashboard Overview</h1>
          <p className="text-xs md:text-sm text-ink-muted font-medium mt-0.5">{displayDate}</p>
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

      {/* Global Invoice Search Bar */}
      <div ref={searchContainerRef} className="relative z-30">
        <div className="relative flex items-center">
          <Search className="w-5 h-5 text-ink-muted absolute left-3.5 pointer-events-none" />
          <input
            type="text"
            placeholder="Search any invoice by number (e.g. 0001), customer name, or phone number..."
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            onFocus={() => { if (searchQuery.trim()) setShowDropdown(true); }}
            className="w-full pl-11 pr-10 py-3 bg-surface border border-border rounded-xl text-sm text-ink-primary placeholder:text-ink-muted shadow-sm focus:outline-none focus:ring-2 focus:ring-accent transition"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchResults([]); setShowDropdown(false); }}
              className="absolute right-3.5 p-1 text-ink-muted hover:text-ink-primary rounded-full hover:bg-row-alt"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Live Search Autocomplete Dropdown */}
        {showDropdown && searchQuery.trim() && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-surface border border-border rounded-xl shadow-xl overflow-hidden divide-y divide-border z-40 max-h-96 overflow-y-auto">
            {isSearching ? (
              <div className="p-4 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-accent" />
                Searching invoices & customers...
              </div>
            ) : searchResults.length === 0 ? (
              <div className="p-4 text-center text-xs text-ink-muted">
                No invoices found matching &quot;{searchQuery}&quot;
              </div>
            ) : (
              searchResults.map(inv => (
                <div key={inv.id} className="p-3 hover:bg-row-alt flex items-center justify-between gap-3 transition">
                  <Link 
                    href={`/invoices/${inv.id}`}
                    onClick={() => setShowDropdown(false)}
                    className="flex-1 min-w-0 group"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold group-hover:text-accent transition ${inv.is_voided ? 'line-through text-red-500' : 'text-ink-primary'}`}>
                        {inv.customer_name || 'Walk-in'}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        inv.status === 'Paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        inv.status === 'Partial' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        inv.status === 'Credit' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                        inv.status === 'Refunded' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        'bg-red-50 text-red-700 border-red-200'
                      }`}>
                        {inv.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-ink-muted mt-0.5">
                      <span className="font-mono font-medium">{inv.invoice_number}</span>
                      {inv.customer_phone && (
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {inv.customer_phone}</span>
                      )}
                      <span>• {new Date(inv.created_at).toLocaleDateString('en-IN')}</span>
                    </div>
                  </Link>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono font-bold text-sm text-ink-primary mr-2">
                      {formatINR(inv.total_amount)}
                    </span>
                    <Link
                      href={`/invoices/${inv.id}`}
                      onClick={() => setShowDropdown(false)}
                      title="Open Invoice"
                      className="p-1.5 bg-surface border border-border text-ink-muted hover:text-ink-primary hover:border-accent rounded-lg hover:bg-row-alt transition flex items-center gap-1 text-xs font-semibold"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                    {!inv.is_voided && (Number(inv.total_refunds) || 0) === 0 && (
                      <Link
                        href={`/pos?editInvoiceId=${inv.id}`}
                        onClick={() => setShowDropdown(false)}
                        title="Edit in POS"
                        className="p-1.5 bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 rounded-lg transition"
                      >
                        <Edit3 className="w-4 h-4" />
                      </Link>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
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
                <p className="text-[12px] md:text-sm font-medium text-ink-muted">Net Sales</p>
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
                          <div className={`text-sm font-bold ${inv.is_voided ? 'line-through text-red-500' : 'text-ink-primary'}`}>
                            {inv.customer_name || 'Walk-in'}
                          </div>
                          <div className="text-xs text-ink-muted font-mono">{inv.invoice_number}</div>
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
                      <Link href={`/expenses/${exp.id}`} className="p-3.5 sm:p-4 flex justify-between items-center hover:bg-row-alt/60 transition-colors block">
                        <div>
                          <div className={`text-xs sm:text-sm font-bold ${exp.is_voided ? 'line-through text-ink-muted' : 'text-ink-primary'}`}>{exp.category}</div>
                          <div className="text-[11px] text-ink-muted mt-0.5">{exp.payment_method} • {new Date(exp.created_at).toLocaleDateString('en-IN')}</div>
                        </div>
                        <span className={`font-bold font-mono text-xs sm:text-sm ${exp.is_voided ? 'text-ink-muted line-through' : 'text-red-600'}`}>
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
