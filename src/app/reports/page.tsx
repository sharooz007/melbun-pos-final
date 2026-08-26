'use client'

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  BarChart3, 
  Download, 
  TrendingUp, 
  TrendingDown, 
  IndianRupee, 
  Package, 
  Wallet, 
  FileText, 
  Receipt, 
  ShoppingBag,
  ChevronLeft, 
  ChevronRight,
  Loader2,
  Calendar,
  Layers,
  AlertCircle,
  ExternalLink,
  Users,
  Clock,
  ArrowRight,
  Percent,
  Tag
} from 'lucide-react';
import { getReportsAction } from '@/lib/actions/reports';
import { getStoreSettingsAction } from '@/lib/actions/settings';
import { getReportDateRange, ReportPeriodPreset } from '@/lib/business-day';
import { formatINR, formatDualQuantity } from '@/lib/formatters';

type TabKey = 
  | 'invoices' 
  | 'expenses' 
  | 'daily_sales' 
  | 'monthly_sales' 
  | 'credits' 
  | 'monthly_profit' 
  | 'profit_by_product' 
  | 'by_product' 
  | 'by_category' 
  | 'stock_cost' 
  | 'stock_moves' 
  | 'stock_by_category';

const TAB_LABELS: { key: TabKey; label: string }[] = [
  { key: 'invoices', label: 'Invoices' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'daily_sales', label: 'Daily Sales' },
  { key: 'monthly_sales', label: 'Monthly Sales' },
  { key: 'credits', label: 'Customer Credits' },
  { key: 'monthly_profit', label: 'Monthly Profit' },
  { key: 'profit_by_product', label: 'Profit by Product' },
  { key: 'by_product', label: 'By Product' },
  { key: 'by_category', label: 'By Category' },
  { key: 'stock_cost', label: 'Stock Valuation' },
  { key: 'stock_moves', label: 'Stock Movements' },
  { key: 'stock_by_category', label: 'Stock by Category' },
];

export default function ReportsPage() {
  const router = useRouter();

  // Store Settings (Business Day Start Cutoff)
  const [startHour, setStartHour] = useState<number>(6);
  const [timezone, setTimezone] = useState<string>('Asia/Kolkata');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Filter States
  const [preset, setPreset] = useState<ReportPeriodPreset>('this_month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [periodLabel, setPeriodLabel] = useState<string>('');

  // Report Data
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [trendView, setTrendView] = useState<'day' | 'month'>('day');

  // Bottom Tabs & Pagination
  const [activeTab, setActiveTab] = useState<TabKey>('invoices');
  const [tabPages, setTabPages] = useState<Record<TabKey, number>>({
    invoices: 1,
    expenses: 1,
    daily_sales: 1,
    monthly_sales: 1,
    credits: 1,
    monthly_profit: 1,
    profit_by_product: 1,
    by_product: 1,
    by_category: 1,
    stock_cost: 1,
    stock_moves: 1,
    stock_by_category: 1
  });
  const PAGE_SIZE = 15;

  const [dateError, setDateError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // 1. Fetch Store Settings
  useEffect(() => {
    (async () => {
      try {
        const res = await getStoreSettingsAction();
        if (res.success && res.data) {
          setStartHour(res.data.business_day_start_hour ?? 6);
          setTimezone(res.data.timezone || 'Asia/Kolkata');
        }
      } catch {
        // Fallback default 6 AM
      } finally {
        setSettingsLoaded(true);
      }
    })();
  }, []);

  // 2. Fetch Reports
  const fetchReports = useCallback(async () => {
    if (!settingsLoaded) return;

    if (preset === 'custom' && (!customFrom || !customTo)) {
      return;
    }

    setLoading(true);
    setFetchError(null);

    const range = getReportDateRange(preset, startHour, customFrom || undefined, customTo || undefined, timezone);

    if (preset !== 'custom') {
      setCustomFrom(range.fromDateStr);
      setCustomTo(range.toDateStr);
    }

    try {
      const res = await getReportsAction(range.startIso, range.endIso);
      if (res.success && res.data) {
        setReportData(res.data);
        setPeriodLabel(range.displayLabel);
      } else {
        setFetchError(res.error || 'Failed to generate financial reports.');
      }
    } catch (err: any) {
      setFetchError(err?.message || 'Unexpected error fetching reports.');
    } finally {
      setLoading(false);
    }
  }, [settingsLoaded, preset, startHour, customFrom, customTo, timezone]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Reset pagination on filter change
  useEffect(() => {
    setTabPages({
      invoices: 1,
      expenses: 1,
      daily_sales: 1,
      monthly_sales: 1,
      credits: 1,
      monthly_profit: 1,
      profit_by_product: 1,
      by_product: 1,
      by_category: 1,
      stock_cost: 1,
      stock_moves: 1,
      stock_by_category: 1
    });
  }, [preset, customFrom, customTo]);

  // Handle Custom Date Apply
  const handleCustomDateApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFrom || !customTo) {
      setDateError('Please specify both From and To dates.');
      return;
    }
    if (new Date(customFrom) > new Date(customTo)) {
      setDateError('From date cannot be later than To date.');
      return;
    }
    setDateError(null);
    fetchReports();
  };

  // Switch Tab
  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
  };

  // CSV Export Utility with Safe Formula Injection Sanitization and RPC Aliasing
  const handleExportCSV = () => {
    if (!reportData) return;

    let headers: string[] = [];
    let rows: any[][] = [];
    let filename = `melbun_report_${activeTab}_${preset}.csv`;

    switch (activeTab) {
      case 'invoices':
        headers = ['Invoice Number', 'Customer', 'Date', 'Subtotal (₹)', 'Discount (₹)', 'Total (₹)', 'Paid (₹)', 'Method', 'Status'];
        rows = (reportData.invoices || reportData.invoices_list || []).map((inv: any) => [
          inv.invoice_number,
          inv.customer_name,
          new Date(inv.created_at).toLocaleString('en-IN'),
          inv.subtotal,
          inv.discount_amount,
          inv.final_total,
          inv.paid_amount,
          inv.primary_method,
          inv.status
        ]);
        break;
      case 'expenses':
        headers = ['Date', 'Category', 'Amount (₹)', 'Payment Method', 'Notes'];
        rows = (reportData.expenses_list || reportData.expenses || []).map((e: any) => [
          new Date(e.created_at).toLocaleDateString('en-IN'),
          e.category,
          e.amount,
          e.payment_method,
          e.notes || ''
        ]);
        break;
      case 'daily_sales':
        headers = ['Date', 'Invoice Count', 'Gross Sales (₹)', 'Discount (₹)', 'Net Sales (₹)', 'Collected (₹)'];
        rows = (reportData.daily_sales || []).map((d: any) => [
          d.date,
          d.invoice_count,
          d.gross_sales,
          d.discount,
          d.net_sales,
          d.collected
        ]);
        break;
      case 'monthly_sales':
        headers = ['Month', 'Invoice Count', 'Gross Sales (₹)', 'Discount (₹)', 'Net Sales (₹)', 'Collected (₹)'];
        rows = (reportData.monthly_sales || []).map((m: any) => [
          m.month,
          m.invoice_count,
          m.gross_sales,
          m.discount,
          m.net_sales,
          m.collected
        ]);
        break;
      case 'credits':
        headers = ['Customer Name', 'Phone', 'Total Spend (₹)', 'Total Paid (₹)', 'Pending Dues (₹)'];
        rows = (reportData.credits || reportData.customer_credits || []).map((c: any) => [
          c.customer_name,
          c.phone || '',
          c.total_spend,
          c.total_paid,
          c.pending_dues
        ]);
        break;
      case 'monthly_profit':
        headers = ['Month', 'Net Sales (₹)', 'Cost of Goods Sold (₹)', 'Gross Profit (₹)', 'Expenses (₹)', 'Net Profit (₹)'];
        rows = (reportData.monthly_profit || []).map((mp: any) => [
          mp.month,
          mp.sales,
          mp.cogs,
          mp.gross_profit,
          mp.expenses,
          mp.net_profit
        ]);
        break;
      case 'profit_by_product':
        headers = ['Product Name', 'Variant', 'Quantity Sold (Pcs)', 'Revenue (₹)', 'COGS (₹)', 'Gross Profit (₹)', 'Margin (%)'];
        rows = (reportData.profit_by_product || []).map((p: any) => [
          p.product_name,
          p.variant_name || '',
          p.quantity_sold || p.qty,
          p.revenue || p.rev,
          p.cogs,
          p.profit ?? p.gross_profit,
          p.margin_percent !== undefined ? `${p.margin_percent}%` : (p.revenue > 0 ? `${(((p.profit || 0) / p.revenue) * 100).toFixed(1)}%` : '0%')
        ]);
        break;
      case 'by_product':
        headers = ['Product Name', 'Quantity Sold (Pcs)', 'Revenue (₹)'];
        rows = (reportData.by_product || reportData.sales_by_product || []).map((p: any) => [
          p.product_name,
          p.quantity_sold || p.tot_qty,
          p.total_sales || p.revenue
        ]);
        break;
      case 'by_category':
        headers = ['Category Name', 'Quantity Sold (Pcs)', 'Total Sales (₹)', 'Total Profit (₹)'];
        rows = (reportData.by_category || reportData.sales_by_category || []).map((c: any) => [
          c.category_name,
          c.quantity_sold || c.items_sold || c.tot_qty,
          c.total_sales || c.revenue,
          c.total_profit || c.tot_prof || 0
        ]);
        break;
      case 'stock_cost':
        headers = ['Variant Name', 'Product', 'Barcode', 'Stock (Pcs)', 'Cost Price (₹)', 'Total Valuation (₹)'];
        rows = (reportData.stock_cost || reportData.stock_valuation || []).map((s: any) => [
          s.variant_name,
          s.product_name,
          s.barcode || '',
          s.stock_quantity,
          s.cost_price,
          s.total_cost || s.valuation
        ]);
        break;
      case 'stock_moves':
        headers = ['Date & Time', 'Product & Variant', 'Type', 'Quantity Change (Pcs)', 'Notes'];
        rows = (reportData.stock_moves || reportData.recent_stock_moves || []).map((sm: any) => [
          new Date(sm.created_at).toLocaleString('en-IN'),
          `${sm.product_name ? sm.product_name + ' - ' : ''}${sm.variant_name || ''}`,
          sm.type,
          sm.quantity_change,
          sm.notes || ''
        ]);
        break;
      case 'stock_by_category':
        headers = ['Category', 'Total Stock (Pcs)', 'Valuation at Cost (₹)'];
        rows = (reportData.stock_by_category || []).map((sbc: any) => [
          sbc.category_name,
          sbc.total_pieces || sbc.total_stock,
          sbc.total_valuation || sbc.valuation
        ]);
        break;
    }

    // Formula Injection Prevention: prepends ' to any cell starting with =, +, -, @
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(val => {
        const strVal = String(val ?? '');
        const sanitized = /^[=+\-@\t\r]/.test(strVal) ? `'${strVal}` : strVal;
        return `"${sanitized.replace(/"/g, '""')}"`;
      }).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Paginated Rows for Active Tab with Complete Dual-Key RPC Aliasing
  const { currentTabRows, totalTabPages, paginatedTabRows } = useMemo(() => {
    let list: any[] = [];
    if (reportData) {
      switch (activeTab) {
        case 'invoices': 
          list = reportData.invoices || reportData.invoices_list || []; 
          break;
        case 'expenses': 
          list = reportData.expenses_list || reportData.expenses || []; 
          break;
        case 'daily_sales': 
          list = reportData.daily_sales || []; 
          break;
        case 'monthly_sales': 
          list = reportData.monthly_sales || []; 
          break;
        case 'credits': 
          list = reportData.credits || reportData.customer_credits || []; 
          break;
        case 'monthly_profit': 
          list = reportData.monthly_profit || []; 
          break;
        case 'profit_by_product': 
          list = reportData.profit_by_product || []; 
          break;
        case 'by_product': 
          list = reportData.by_product || reportData.sales_by_product || []; 
          break;
        case 'by_category': 
          list = reportData.by_category || reportData.sales_by_category || []; 
          break;
        case 'stock_cost': 
          list = reportData.stock_cost || reportData.stock_valuation || []; 
          break;
        case 'stock_moves': 
          list = reportData.stock_moves || reportData.recent_stock_moves || []; 
          break;
        case 'stock_by_category': 
          list = reportData.stock_by_category || []; 
          break;
      }
    }

    const page = tabPages[activeTab] || 1;
    const totalPages = Math.ceil(list.length / PAGE_SIZE) || 1;
    const start = (page - 1) * PAGE_SIZE;
    const paginated = list.slice(start, start + PAGE_SIZE);

    return {
      currentTabRows: list,
      totalTabPages: totalPages,
      paginatedTabRows: paginated
    };
  }, [reportData, activeTab, tabPages]);

  // SVG Trend Chart Data
  const trendPoints = useMemo(() => {
    const rawData = trendView === 'day' 
      ? (reportData?.daily_sales || []) 
      : (reportData?.monthly_sales || []);

    if (!rawData || rawData.length === 0) {
      return { salesPath: '', collectedPath: '', points: [], maxVal: 1 };
    }

    const maxSales = Math.max(...rawData.map((d: any) => Number(d.net_sales || 0)), 0);
    const maxCollected = Math.max(...rawData.map((d: any) => Number(d.collected || 0)), 0);
    const maxVal = Math.max(maxSales, maxCollected, 100);

    const width = 800;
    const height = 180;
    const padding = 20;

    const points = rawData.map((d: any, i: number) => {
      const x = rawData.length === 1 
        ? width / 2 
        : padding + (i / (rawData.length - 1)) * (width - padding * 2);
      
      const salesY = height - padding - ((Number(d.net_sales || 0) / maxVal) * (height - padding * 2));
      const collectedY = height - padding - ((Number(d.collected || 0) / maxVal) * (height - padding * 2));
      
      const label = trendView === 'day' 
        ? d.date.split('-').slice(1).join('/')
        : d.month;

      return {
        x,
        salesY,
        collectedY,
        sales: d.net_sales,
        collected: d.collected,
        label: label
      };
    });

    const salesPath = points.reduce((acc: string, pt: any, i: number) => {
      return i === 0 ? `M ${pt.x} ${pt.salesY}` : `${acc} L ${pt.x} ${pt.salesY}`;
    }, '');

    const collectedPath = points.reduce((acc: string, pt: any, i: number) => {
      return i === 0 ? `M ${pt.x} ${pt.collectedY}` : `${acc} L ${pt.x} ${pt.collectedY}`;
    }, '');

    return {
      salesPath,
      collectedPath,
      points,
      maxVal
    };
  }, [reportData, trendView]);

  return (
    <div className="p-3.5 pb-36 sm:p-6 md:p-8 md:pb-8 space-y-6 max-w-[1400px] w-full mx-auto bg-canvas min-h-screen text-ink-primary font-sans">
      {/* Top Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-primary flex items-center gap-2.5">
            <BarChart3 className="w-6 h-6 text-accent" />
            Financial & Sales Reports
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            Real-time audit metrics, sales summaries, and profit analytics.
          </p>
        </div>
      </header>

      {/* 1. PERIOD FILTER CARD */}
      <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-border shadow-xs space-y-3.5">
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted block">
              Active Period
            </span>
            <div className="text-sm sm:text-base font-bold text-ink-primary">
              {periodLabel || 'Loading reporting period...'}
            </div>
          </div>
        </div>

        {/* Preset Pills */}
        <div className="bg-row-alt p-1 rounded-xl flex flex-wrap items-center gap-1">
          {(['today', 'yesterday', 'this_week', 'this_month', 'this_year', 'custom'] as ReportPeriodPreset[]).map((p) => {
            const isActive = preset === p;
            const labels: Record<ReportPeriodPreset, string> = {
              today: 'Today',
              yesterday: 'Yesterday',
              this_week: 'This Week',
              this_month: 'This Month',
              this_year: 'This Year',
              custom: 'Custom Range'
            };
            return (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  isActive
                    ? 'bg-accent text-white shadow-2xs'
                    : 'text-ink-muted hover:text-ink-primary hover:bg-surface'
                }`}
              >
                {labels[p]}
              </button>
            );
          })}
        </div>

        {/* Custom Date Pickers */}
        {preset === 'custom' && (
          <form onSubmit={handleCustomDateApply} className="pt-2 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-bold text-ink-primary mb-1">From Date</label>
              <input
                type="date"
                required
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-xl text-xs font-medium text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-bold text-ink-primary mb-1">To Date</label>
              <input
                type="date"
                required
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-xl text-xs font-medium text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none"
              />
            </div>
            <div className="pt-5">
              <button
                type="submit"
                className="px-5 py-2 bg-accent hover:bg-accent-hover text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer min-h-[38px]"
              >
                Apply Range
              </button>
            </div>
            {dateError && (
              <div className="w-full p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{dateError}</span>
              </div>
            )}
          </form>
        )}
      </div>

      {fetchError && (
        <div className="p-4 sm:p-5 bg-red-50 border border-red-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-red-900">Failed to load reports</h3>
              <p className="text-xs text-red-700 mt-0.5">{fetchError}</p>
            </div>
          </div>
          <button
            onClick={() => fetchReports()}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer"
          >
            Retry Report
          </button>
        </div>
      )}

      {loading && !reportData ? (
        <div className="py-20 flex flex-col items-center justify-center text-ink-muted gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <span className="text-xs font-semibold">Generating financial reports...</span>
        </div>
      ) : (
        <>
          {/* 2. 8 KPI BENTO CARDS (4 Columns) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* 1. Total Sales */}
            <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-ink-muted">Total Sales</span>
                  <div className="text-lg sm:text-2xl font-extrabold text-ink-primary mt-1 font-mono">
                    {formatINR(reportData?.total_sales)}
                  </div>
                  <span className="text-[11px] text-ink-muted mt-0.5 block">
                    {reportData?.invoice_count || 0} invoices
                  </span>
                </div>
                <div className="p-2 bg-red-50 text-accent rounded-xl border border-red-100">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* 2. Collected */}
            <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-ink-muted">Collected</span>
                  <div className="text-lg sm:text-2xl font-extrabold text-emerald-700 mt-1 font-mono">
                    {formatINR(reportData?.collected)}
                  </div>
                  <span className="text-[11px] text-ink-muted mt-0.5 block">
                    In selected period
                  </span>
                </div>
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100">
                  <Wallet className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* 3. Outstanding Dues */}
            <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-ink-muted">Outstanding Dues</span>
                  <div className="text-lg sm:text-2xl font-extrabold text-amber-800 mt-1 font-mono">
                    {formatINR(reportData?.outstanding_dues)}
                  </div>
                  <span className="text-[11px] text-ink-muted mt-0.5 block">
                    Open customer tabs
                  </span>
                </div>
                <div className="p-2 bg-amber-50 text-amber-700 rounded-xl border border-amber-100">
                  <FileText className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* 4. Invoice Count */}
            <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-ink-muted">Invoices Billed</span>
                  <div className="text-lg sm:text-2xl font-extrabold text-ink-primary mt-1 font-mono">
                    {reportData?.invoice_count || 0}
                  </div>
                  <span className="text-[11px] text-ink-muted mt-0.5 block font-mono">
                    Avg {formatINR(reportData?.avg_invoice_value)}
                  </span>
                </div>
                <div className="p-2 bg-row-alt text-ink-primary rounded-xl border border-border">
                  <Receipt className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* 5. Expenses */}
            <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-ink-muted">Store Expenses</span>
                  <div className="text-lg sm:text-2xl font-extrabold text-red-600 mt-1 font-mono">
                    {formatINR(reportData?.expenses)}
                  </div>
                  <span className="text-[11px] text-ink-muted mt-0.5 block">
                    Period deductions
                  </span>
                </div>
                <div className="p-2 bg-red-50 text-red-700 rounded-xl border border-red-100">
                  <TrendingDown className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* 6. Net Profit */}
            <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-ink-muted">Net Profit</span>
                  <div className="text-lg sm:text-2xl font-extrabold text-emerald-800 mt-1 font-mono">
                    {formatINR(reportData?.net_profit)}
                  </div>
                  <span className="text-[11px] text-ink-muted mt-0.5 block">
                    Gross profit – expenses
                  </span>
                </div>
                <div className="p-2 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-100">
                  <IndianRupee className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* 7. Gross Profit */}
            <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-ink-muted">Gross Profit</span>
                  <div className="text-lg sm:text-2xl font-extrabold text-ink-primary mt-1 font-mono">
                    {formatINR(reportData?.gross_profit)}
                  </div>
                  <span className="text-[11px] text-ink-muted mt-0.5 block">
                    COGS at time of sale
                  </span>
                </div>
                <div className="p-2 bg-row-alt text-ink-primary rounded-xl border border-border">
                  <ShoppingBag className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* 8. Stock at Cost */}
            <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-ink-muted">Stock at Cost</span>
                  <div className="text-lg sm:text-2xl font-extrabold text-ink-primary mt-1 font-mono">
                    {formatINR(reportData?.stock_at_cost)}
                  </div>
                  <span className="text-[11px] text-ink-muted mt-0.5 block">
                    Live inventory valuation
                  </span>
                </div>
                <div className="p-2 bg-row-alt text-ink-primary rounded-xl border border-border">
                  <Package className="w-4 h-4" />
                </div>
              </div>
            </div>
          </div>

          {/* 3. PAYMENT BREAKDOWN SECTION */}
          <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-border shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-ink-primary">Payment Collection Breakdown</h2>
                <p className="text-xs text-ink-muted">By channel for this period</p>
              </div>
              <div className="text-xs sm:text-sm font-bold text-ink-primary font-mono">
                Total: {formatINR(reportData?.payment_breakdown?.total_collected)}
              </div>
            </div>

            <div className="space-y-3 pt-1">
              {/* Cash Bar */}
              <div>
                <div className="flex justify-between text-xs font-semibold text-ink-primary mb-1">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span> Cash
                  </span>
                  <span className="font-mono">
                    {formatINR(reportData?.payment_breakdown?.cash_amount)} · {reportData?.payment_breakdown?.cash_percent || 0}%
                  </span>
                </div>
                <div className="w-full bg-row-alt rounded-full h-2.5 overflow-hidden border border-border/50">
                  <div 
                    className="bg-emerald-600 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, Math.max(0, reportData?.payment_breakdown?.cash_percent || 0))}%` }}
                  />
                </div>
              </div>

              {/* UPI Bar */}
              <div>
                <div className="flex justify-between text-xs font-semibold text-ink-primary mb-1">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-accent"></span> UPI / Online
                  </span>
                  <span className="font-mono">
                    {formatINR(reportData?.payment_breakdown?.upi_amount)} · {reportData?.payment_breakdown?.upi_percent || 0}%
                  </span>
                </div>
                <div className="w-full bg-row-alt rounded-full h-2.5 overflow-hidden border border-border/50">
                  <div 
                    className="bg-accent h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, Math.max(0, reportData?.payment_breakdown?.upi_percent || 0))}%` }}
                  />
                </div>
              </div>

              {/* Store Credit Bar */}
              <div>
                <div className="flex justify-between text-xs font-semibold text-ink-primary mb-1">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-600"></span> Store Credit
                  </span>
                  <span className="font-mono">
                    {formatINR(reportData?.payment_breakdown?.store_credit_amount || 0)} · {reportData?.payment_breakdown?.store_credit_percent || 0}%
                  </span>
                </div>
                <div className="w-full bg-row-alt rounded-full h-2.5 overflow-hidden border border-border/50">
                  <div 
                    className="bg-purple-600 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, Math.max(0, reportData?.payment_breakdown?.store_credit_percent || 0))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 4. SALES TREND SVG GRAPH */}
          <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-border shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-ink-primary">Sales & Collection Trend</h2>
                <p className="text-xs text-ink-muted">Invoiced sales vs actual collected amounts</p>
              </div>
              <div className="bg-row-alt p-1 rounded-xl flex items-center gap-1 w-fit">
                <button
                  onClick={() => setTrendView('day')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    trendView === 'day' ? 'bg-accent text-white shadow-2xs' : 'text-ink-muted hover:text-ink-primary'
                  }`}
                >
                  Day-wise
                </button>
                <button
                  onClick={() => setTrendView('month')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    trendView === 'month' ? 'bg-accent text-white shadow-2xs' : 'text-ink-muted hover:text-ink-primary'
                  }`}
                >
                  Month-wise
                </button>
              </div>
            </div>

            {/* SVG Graph */}
            <div className="relative w-full h-56 bg-row-alt/40 rounded-xl p-4 flex flex-col justify-between border border-border">
              {trendPoints.points.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-ink-muted font-medium">
                  No sales recorded in this period.
                </div>
              ) : (
                <div className="w-full h-full relative">
                  <svg className="w-full h-40 overflow-visible" viewBox="0 0 800 180" preserveAspectRatio="none">
                    {/* Grid lines */}
                    <line x1="0" y1="20" x2="800" y2="20" stroke="currentColor" className="text-border" strokeDasharray="4 4" />
                    <line x1="0" y1="90" x2="800" y2="90" stroke="currentColor" className="text-border" strokeDasharray="4 4" />
                    <line x1="0" y1="160" x2="800" y2="160" stroke="currentColor" className="text-border" strokeDasharray="4 4" />

                    {/* Sales Area & Line (Accent) */}
                    <path
                      d={trendPoints.salesPath}
                      fill="none"
                      stroke="#2563EB"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />

                    {/* Collected Area & Line (Emerald) */}
                    <path
                      d={trendPoints.collectedPath}
                      fill="none"
                      stroke="#059669"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />

                    {/* Data Points */}
                    {trendPoints.points.map((pt: any, i: number) => (
                      <g key={i}>
                        <circle cx={pt.x} cy={pt.salesY} r="4" fill="#2563EB" className="hover:r-6 cursor-pointer transition-all">
                          <title>{`${pt.label} - Sales: ₹${Number(pt.sales || 0).toFixed(2)}`}</title>
                        </circle>
                        <circle cx={pt.x} cy={pt.collectedY} r="4" fill="#059669" className="hover:r-6 cursor-pointer transition-all">
                          <title>{`${pt.label} - Collected: ₹${Number(pt.collected || 0).toFixed(2)}`}</title>
                        </circle>
                      </g>
                    ))}
                  </svg>

                  {/* Horizontal X Axis Labels */}
                  <div className="flex justify-between items-center text-[10px] text-ink-muted font-medium pt-2 overflow-hidden">
                    {(() => {
                      const totalPts = trendPoints.points.length;
                      const stride = totalPts > 12 ? Math.ceil(totalPts / 8) : 1;
                      return trendPoints.points.map((pt: any, i: number) => {
                        const isVisible = i === 0 || i === totalPts - 1 || i % stride === 0;
                        return (
                          <span 
                            key={i} 
                            className={`text-center truncate ${isVisible ? 'opacity-100' : 'opacity-0 select-none'}`}
                            style={{ flex: 1 }}
                          >
                            {isVisible ? pt.label : ''}
                          </span>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-6 text-xs font-bold text-ink-primary pt-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
                <span>Collected (₹)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-accent"></span>
                <span>Total Invoiced Sales (₹)</span>
              </div>
            </div>
          </div>

          {/* 5. 12 DRILLDOWN DATA TABS & EXPORT */}
          <div className="bg-surface rounded-2xl border border-border shadow-xs overflow-hidden space-y-4 p-4 sm:p-6">
            {/* Tabs Header & CSV Download */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-border pb-4">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 hide-scrollbar">
                {TAB_LABELS.map((t) => {
                  const isActive = activeTab === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => handleTabChange(t.key)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                        isActive
                          ? 'bg-accent text-white shadow-2xs'
                          : 'bg-row-alt border border-border text-ink-muted hover:text-ink-primary hover:bg-surface'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={handleExportCSV}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-row-alt hover:bg-surface border border-border text-ink-primary font-bold text-xs rounded-xl transition self-start lg:self-auto min-h-[38px] cursor-pointer shadow-2xs"
                title="Download active table as CSV"
              >
                <Download className="w-4 h-4 text-accent" />
                <span>Export CSV</span>
              </button>
            </div>

            {/* Drilldown Body: 12 Bespoke Mobile Cards (< 640px) & Desktop Table (>= 640px) */}
            <div className="min-h-[250px]">
              {paginatedTabRows.length === 0 ? (
                <div className="py-16 text-center text-xs text-ink-muted font-medium">
                  No records found in this category for the selected period.
                </div>
              ) : (
                <>
                  {/* MOBILE BESPOKE CARDS VIEW (< 640px) - ZERO DATA LOSS */}
                  <div className="block sm:hidden space-y-2.5">
                    {/* 1. Invoices Mobile */}
                    {activeTab === 'invoices' && paginatedTabRows.map((inv: any) => (
                      <div 
                        key={inv.id}
                        onClick={() => router.push(`/invoices/${inv.id}`)}
                        className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-2 cursor-pointer active:scale-[0.99] transition"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <span className={`font-bold font-mono text-xs ${inv.is_voided ? 'line-through text-red-500' : 'text-ink-primary'}`}>
                              {inv.invoice_number}
                            </span>
                            <p className="text-xs text-ink-primary font-semibold">{inv.customer_name}</p>
                          </div>
                          <span className={`font-bold font-mono text-sm ${inv.is_voided ? 'line-through text-red-500' : 'text-ink-primary'}`}>
                            {formatINR(inv.final_total)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-ink-muted">
                          <span>{new Date(inv.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                            inv.status === 'Paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            inv.status === 'Partial' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                            inv.status === 'Void' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-red-50 text-red-700 border-red-200'
                          }`}>
                            {inv.status}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-ink-muted pt-1.5 border-t border-border/50">
                          <span>Paid: <strong className="font-mono text-ink-primary">{formatINR(inv.paid_amount)}</strong></span>
                          <span className="font-mono font-bold text-[10px] uppercase bg-surface px-2 py-0.5 rounded border border-border">
                            {inv.primary_method}
                          </span>
                        </div>
                      </div>
                    ))}

                    {/* 2. Expenses Mobile */}
                    {activeTab === 'expenses' && paginatedTabRows.map((e: any) => (
                      <div 
                        key={e.id}
                        onClick={() => router.push(`/expenses/${e.id}`)}
                        className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-1.5 cursor-pointer active:scale-[0.99] transition"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <span className="font-bold text-xs text-ink-primary">{e.category}</span>
                          <span className="font-bold font-mono text-sm text-red-600">-{formatINR(e.amount)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-ink-muted">
                          <span>{new Date(e.created_at).toLocaleDateString('en-IN')}</span>
                          <span className="px-2 py-0.5 rounded-md bg-surface border border-border font-mono font-bold text-[10px]">
                            {e.payment_method}
                          </span>
                        </div>
                        {e.notes && <p className="text-[11px] text-ink-muted pt-1 border-t border-border/50 truncate">{e.notes}</p>}
                      </div>
                    ))}

                    {/* 3. Daily Sales Mobile */}
                    {activeTab === 'daily_sales' && paginatedTabRows.map((d: any, idx: number) => (
                      <div key={idx} className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-2">
                        <div className="flex justify-between items-start">
                          <span className="font-bold font-mono text-xs text-ink-primary">{d.date}</span>
                          <span className="font-bold font-mono text-sm text-emerald-700">{formatINR(d.collected)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs bg-surface p-2 rounded-lg border border-border">
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">Invoices</span>
                            <span className="font-bold font-mono text-ink-primary">{d.invoice_count}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">Gross Sales</span>
                            <span className="font-bold font-mono text-ink-muted">{formatINR(d.gross_sales)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">Discount</span>
                            <span className="font-bold font-mono text-red-600">{formatINR(d.discount)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">Net Sales</span>
                            <span className="font-bold font-mono text-accent">{formatINR(d.net_sales)}</span>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* 4. Monthly Sales Mobile */}
                    {activeTab === 'monthly_sales' && paginatedTabRows.map((m: any, idx: number) => (
                      <div key={idx} className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-2">
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-xs text-ink-primary">{m.month}</span>
                          <span className="font-bold font-mono text-sm text-emerald-700">{formatINR(m.collected)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs bg-surface p-2 rounded-lg border border-border">
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">Invoices</span>
                            <span className="font-bold font-mono text-ink-primary">{m.invoice_count}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">Gross Sales</span>
                            <span className="font-bold font-mono text-ink-muted">{formatINR(m.gross_sales)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">Discount</span>
                            <span className="font-bold font-mono text-red-600">{formatINR(m.discount)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">Net Sales</span>
                            <span className="font-bold font-mono text-accent">{formatINR(m.net_sales)}</span>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* 5. Customer Credits Mobile */}
                    {activeTab === 'credits' && paginatedTabRows.map((c: any) => (
                      <div 
                        key={c.customer_id}
                        onClick={() => router.push(`/customers/${c.customer_id}`)}
                        className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-1.5 cursor-pointer active:scale-[0.99] transition"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-bold text-xs text-ink-primary flex items-center gap-1">
                              {c.customer_name}
                              <ExternalLink className="w-3 h-3 text-ink-muted" />
                            </span>
                            <p className="text-[11px] font-mono text-ink-muted">{c.phone || 'No phone'}</p>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] uppercase text-amber-800 font-bold block">Dues</span>
                            <span className="font-bold font-mono text-sm text-amber-800">{formatINR(c.pending_dues)}</span>
                          </div>
                        </div>
                        <div className="flex justify-between text-[11px] text-ink-muted pt-1.5 border-t border-border/60">
                          <span>Spend: <strong className="font-mono text-ink-primary">{formatINR(c.total_spend)}</strong></span>
                          <span>Paid: <strong className="font-mono text-ink-primary">{formatINR(c.total_paid)}</strong></span>
                        </div>
                      </div>
                    ))}

                    {/* 6. Monthly Profit Mobile */}
                    {activeTab === 'monthly_profit' && paginatedTabRows.map((mp: any, idx: number) => (
                      <div key={idx} className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-2">
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-xs text-ink-primary">{mp.month}</span>
                          <div className="text-right">
                            <span className="text-[10px] uppercase font-bold text-ink-muted block">Net Profit</span>
                            <span className={`font-bold font-mono text-sm ${Number(mp.net_profit) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                              {formatINR(mp.net_profit)}
                            </span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs bg-surface p-2 rounded-lg border border-border">
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">Net Sales</span>
                            <span className="font-bold font-mono text-ink-primary">{formatINR(mp.sales)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">COGS</span>
                            <span className="font-bold font-mono text-ink-muted">{formatINR(mp.cogs)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">Gross Profit</span>
                            <span className="font-bold font-mono text-emerald-800">{formatINR(mp.gross_profit)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-ink-muted block uppercase font-bold">Expenses</span>
                            <span className="font-bold font-mono text-red-600">-{formatINR(mp.expenses)}</span>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* 7. Profit by Product Mobile (Full Details: Qty, Rev, COGS, Profit, Margin) */}
                    {activeTab === 'profit_by_product' && paginatedTabRows.map((p: any, idx: number) => {
                      const grossProfit = p.profit ?? p.gross_profit ?? 0;
                      const revenue = p.revenue || p.rev || 0;
                      const margin = p.margin_percent !== undefined ? p.margin_percent : (revenue > 0 ? ((grossProfit / revenue) * 100).toFixed(1) : 0);

                      return (
                        <div key={idx} className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-2">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <span className="font-bold text-xs text-ink-primary">{p.product_name}</span>
                              {p.variant_name && <p className="text-[11px] font-mono text-ink-muted">{p.variant_name}</p>}
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] uppercase font-bold text-ink-muted block">Gross Profit</span>
                              <span className="font-bold font-mono text-sm text-emerald-700">
                                {formatINR(grossProfit)}
                              </span>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs bg-surface p-2 rounded-lg border border-border">
                            <div>
                              <span className="text-[10px] text-ink-muted block uppercase font-bold">Qty Sold</span>
                              <span className="font-bold font-mono text-ink-primary">
                                {formatDualQuantity(p.quantity_sold || p.qty, p.pieces_per_set)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-ink-muted block uppercase font-bold">Revenue</span>
                              <span className="font-bold font-mono text-accent">{formatINR(revenue)}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-ink-muted block uppercase font-bold">COGS</span>
                              <span className="font-bold font-mono text-ink-muted">{formatINR(p.cogs)}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-ink-muted block uppercase font-bold">Margin</span>
                              <span className="font-bold font-mono text-purple-700">{margin}%</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* 8. By Product Volume Mobile */}
                    {activeTab === 'by_product' && paginatedTabRows.map((p: any, idx: number) => (
                      <div key={idx} className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-1.5">
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-xs text-ink-primary">{p.product_name}</span>
                          <span className="font-bold font-mono text-sm text-accent">{formatINR(p.total_sales || p.revenue)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-ink-muted pt-1 border-t border-border/50">
                          <span className="inline-flex items-center gap-1 font-mono font-bold text-ink-primary">
                            <Package className="w-3 h-3 text-ink-muted" />
                            {formatDualQuantity(p.quantity_sold || p.tot_qty, p.pieces_per_set)} sold
                          </span>
                        </div>
                      </div>
                    ))}

                    {/* 9. By Category Mobile */}
                    {activeTab === 'by_category' && paginatedTabRows.map((c: any, idx: number) => (
                      <div key={idx} className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-1.5">
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-xs text-ink-primary">{c.category_name}</span>
                          <span className="font-bold font-mono text-sm text-accent">{formatINR(c.total_sales || c.revenue)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-ink-muted pt-1 border-t border-border/50">
                          <span>Items Sold: <strong className="font-mono text-ink-primary">{c.quantity_sold || c.items_sold || c.tot_qty} pcs</strong></span>
                          {c.total_profit !== undefined && (
                            <span>Profit: <strong className="font-mono text-emerald-700">{formatINR(c.total_profit || c.tot_prof)}</strong></span>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* 10. Stock Valuation Mobile */}
                    {activeTab === 'stock_cost' && paginatedTabRows.map((s: any, idx: number) => (
                      <div key={idx} className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-1.5">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-bold text-xs text-ink-primary">{s.variant_name}</span>
                            <p className="text-[11px] text-ink-muted">{s.product_name}</p>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] uppercase font-bold text-ink-muted block">Valuation</span>
                            <span className="font-bold font-mono text-sm text-accent">{formatINR(s.total_cost || s.valuation)}</span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-ink-muted pt-1.5 border-t border-border/50">
                          <span>Stock: <strong className="font-mono text-ink-primary">{formatDualQuantity(s.stock_quantity, s.pieces_per_set)}</strong></span>
                          <span>Cost: <strong className="font-mono text-ink-muted">{formatINR(s.cost_price)}/pc</strong></span>
                        </div>
                      </div>
                    ))}

                    {/* 11. Stock Moves Mobile */}
                    {activeTab === 'stock_moves' && paginatedTabRows.map((sm: any, idx: number) => {
                      const isPositive = Number(sm.quantity_change) > 0;
                      return (
                        <div key={idx} className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-1.5">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <span className="font-bold text-xs text-ink-primary">
                                {sm.product_name ? `${sm.product_name} - ` : ''}{sm.variant_name}
                              </span>
                              <p className="text-[10px] font-mono text-ink-muted mt-0.5">
                                {new Date(sm.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className={`font-bold font-mono text-sm ${isPositive ? 'text-emerald-700' : 'text-red-600'}`}>
                                {formatDualQuantity(sm.quantity_change, sm.pieces_per_set, { showSign: true })}
                              </span>
                              <span className="block text-[10px] font-bold bg-surface px-1.5 py-0.5 rounded border border-border mt-0.5">
                                {sm.type}
                              </span>
                            </div>
                          </div>
                          {sm.notes && <p className="text-[11px] text-ink-muted pt-1 border-t border-border/50 truncate">{sm.notes}</p>}
                        </div>
                      );
                    })}

                    {/* 12. Stock by Category Mobile */}
                    {activeTab === 'stock_by_category' && paginatedTabRows.map((sbc: any, idx: number) => (
                      <div key={idx} className="p-3.5 bg-row-alt/40 border border-border rounded-xl space-y-1.5">
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-xs text-ink-primary">{sbc.category_name}</span>
                          <span className="font-bold font-mono text-sm text-accent">
                            {formatINR(sbc.total_valuation || sbc.valuation)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-ink-muted pt-1 border-t border-border/50">
                          <span>Total Stock: <strong className="font-mono text-ink-primary">{sbc.total_pieces || sbc.total_stock || 0} pcs</strong></span>
                          {sbc.variant_count !== undefined && (
                            <span>Variants: <strong className="font-mono">{sbc.variant_count}</strong></span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* DESKTOP TABLE VIEW (>= 640px) */}
                  <div className="hidden sm:block overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-left border-collapse text-xs">
                      {/* TAB 1: INVOICES */}
                      {activeTab === 'invoices' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Invoice #</th>
                              <th className="py-3 px-4">Customer</th>
                              <th className="py-3 px-4">Date & Time</th>
                              <th className="py-3 px-4 text-right">Total</th>
                              <th className="py-3 px-4 text-right">Paid</th>
                              <th className="py-3 px-4 text-center">Method</th>
                              <th className="py-3 px-4 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((inv: any) => (
                              <tr 
                                key={inv.id} 
                                onClick={() => router.push(`/invoices/${inv.id}`)}
                                className="hover:bg-row-alt/60 transition cursor-pointer"
                              >
                                <td className={`py-3 px-4 font-mono font-bold ${inv.is_voided ? 'line-through text-red-500' : 'text-ink-primary'}`}>
                                  {inv.invoice_number}
                                </td>
                                <td className="py-3 px-4 font-semibold text-ink-primary">{inv.customer_name}</td>
                                <td className="py-3 px-4 text-ink-muted font-mono">
                                  {new Date(inv.created_at).toLocaleString('en-IN', {
                                    day: '2-digit', month: 'short', year: 'numeric',
                                    hour: '2-digit', minute: '2-digit', hour12: true
                                  })}
                                </td>
                                <td className={`py-3 px-4 text-right font-mono font-bold ${inv.is_voided ? 'line-through text-red-500' : 'text-ink-primary'}`}>
                                  {formatINR(inv.final_total)}
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-ink-muted">{formatINR(inv.paid_amount)}</td>
                                <td className="py-3 px-4 text-center font-mono font-bold text-[11px] text-ink-muted">{inv.primary_method}</td>
                                <td className="py-3 px-4 text-center">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                    inv.status === 'Paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                    inv.status === 'Partial' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                                    inv.status === 'Void' ? 'bg-red-50 text-red-700 border-red-200' :
                                    'bg-red-50 text-red-700 border-red-200'
                                  }`}>
                                    {inv.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}

                      {/* TAB 2: EXPENSES */}
                      {activeTab === 'expenses' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Date</th>
                              <th className="py-3 px-4">Category</th>
                              <th className="py-3 px-4 text-right">Amount</th>
                              <th className="py-3 px-4 text-center">Payment Method</th>
                              <th className="py-3 px-4">Notes</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((e: any) => (
                              <tr 
                                key={e.id} 
                                onClick={() => router.push(`/expenses/${e.id}`)}
                                className="hover:bg-row-alt/60 transition cursor-pointer"
                              >
                                <td className="py-3 px-4 font-mono text-ink-muted">{new Date(e.created_at).toLocaleDateString('en-IN')}</td>
                                <td className="py-3 px-4 font-bold text-ink-primary">
                                  {e.category}
                                </td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-red-600">-{formatINR(e.amount)}</td>
                                <td className="py-3 px-4 text-center font-mono text-ink-muted">{e.payment_method}</td>
                                <td className="py-3 px-4 text-ink-muted truncate max-w-xs">{e.notes || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}

                      {/* TAB 3: DAILY SALES */}
                      {activeTab === 'daily_sales' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Business Date</th>
                              <th className="py-3 px-4 text-center">Invoices</th>
                              <th className="py-3 px-4 text-right">Gross Sales</th>
                              <th className="py-3 px-4 text-right">Discount</th>
                              <th className="py-3 px-4 text-right">Net Sales</th>
                              <th className="py-3 px-4 text-right">Collected</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((d: any, idx: number) => (
                              <tr key={idx} className="hover:bg-row-alt/50 transition">
                                <td className="py-3 px-4 font-mono font-bold text-ink-primary">{d.date}</td>
                                <td className="py-3 px-4 text-center font-mono">{d.invoice_count}</td>
                                <td className="py-3 px-4 text-right font-mono text-ink-muted">{formatINR(d.gross_sales)}</td>
                                <td className="py-3 px-4 text-right font-mono text-red-600">{formatINR(d.discount)}</td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-ink-primary">{formatINR(d.net_sales)}</td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">{formatINR(d.collected)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}

                      {/* TAB 4: MONTHLY SALES */}
                      {activeTab === 'monthly_sales' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Month</th>
                              <th className="py-3 px-4 text-center">Invoices</th>
                              <th className="py-3 px-4 text-right">Gross Sales</th>
                              <th className="py-3 px-4 text-right">Discount</th>
                              <th className="py-3 px-4 text-right">Net Sales</th>
                              <th className="py-3 px-4 text-right">Collected</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((m: any, idx: number) => (
                              <tr key={idx} className="hover:bg-row-alt/50 transition">
                                <td className="py-3 px-4 font-mono font-bold text-ink-primary">{m.month}</td>
                                <td className="py-3 px-4 text-center font-mono">{m.invoice_count}</td>
                                <td className="py-3 px-4 text-right font-mono text-ink-muted">{formatINR(m.gross_sales)}</td>
                                <td className="py-3 px-4 text-right font-mono text-red-600">{formatINR(m.discount)}</td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-ink-primary">{formatINR(m.net_sales)}</td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">{formatINR(m.collected)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}

                      {/* TAB 5: CREDITS */}
                      {activeTab === 'credits' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Customer Name</th>
                              <th className="py-3 px-4">Phone</th>
                              <th className="py-3 px-4 text-right">Total Spend</th>
                              <th className="py-3 px-4 text-right">Total Paid</th>
                              <th className="py-3 px-4 text-right">Pending Dues</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((c: any) => (
                              <tr 
                                key={c.customer_id} 
                                onClick={() => router.push(`/customers/${c.customer_id}`)}
                                className="hover:bg-row-alt/50 transition cursor-pointer"
                              >
                                <td className="py-3 px-4 font-bold text-ink-primary flex items-center gap-1">
                                  <span>{c.customer_name}</span>
                                  <ExternalLink className="w-3 h-3 text-ink-muted" />
                                </td>
                                <td className="py-3 px-4 font-mono text-ink-muted">{c.phone || '—'}</td>
                                <td className="py-3 px-4 text-right font-mono text-ink-muted">{formatINR(c.total_spend)}</td>
                                <td className="py-3 px-4 text-right font-mono text-ink-muted">{formatINR(c.total_paid)}</td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-amber-800">{formatINR(c.pending_dues)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}

                      {/* TAB 6: MONTHLY PROFIT */}
                      {activeTab === 'monthly_profit' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Month</th>
                              <th className="py-3 px-4 text-right">Net Sales</th>
                              <th className="py-3 px-4 text-right">COGS</th>
                              <th className="py-3 px-4 text-right">Gross Profit</th>
                              <th className="py-3 px-4 text-right">Expenses</th>
                              <th className="py-3 px-4 text-right">Net Profit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((mp: any, idx: number) => (
                              <tr key={idx} className="hover:bg-row-alt/50 transition">
                                <td className="py-3 px-4 font-mono font-bold text-ink-primary">{mp.month}</td>
                                <td className="py-3 px-4 text-right font-mono">{formatINR(mp.sales)}</td>
                                <td className="py-3 px-4 text-right font-mono text-ink-muted">{formatINR(mp.cogs)}</td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-ink-primary">{formatINR(mp.gross_profit)}</td>
                                <td className="py-3 px-4 text-right font-mono text-red-600">-{formatINR(mp.expenses)}</td>
                                <td className={`py-3 px-4 text-right font-mono font-bold ${Number(mp.net_profit) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                  {formatINR(mp.net_profit)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}

                      {/* TAB 7: PROFIT BY PRODUCT */}
                      {activeTab === 'profit_by_product' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Product Name</th>
                              <th className="py-3 px-4">Variant</th>
                              <th className="py-3 px-4 text-center">Qty Sold</th>
                              <th className="py-3 px-4 text-right">Revenue</th>
                              <th className="py-3 px-4 text-right">COGS</th>
                              <th className="py-3 px-4 text-right">Gross Profit</th>
                              <th className="py-3 px-4 text-right">Margin</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((p: any, idx: number) => {
                              const grossProfit = p.profit ?? p.gross_profit ?? 0;
                              const revenue = p.revenue || p.rev || 0;
                              const margin = p.margin_percent !== undefined ? p.margin_percent : (revenue > 0 ? ((grossProfit / revenue) * 100).toFixed(1) : 0);

                              return (
                                <tr key={idx} className="hover:bg-row-alt/50 transition">
                                  <td className="py-3 px-4 font-bold text-ink-primary">{p.product_name}</td>
                                  <td className="py-3 px-4 text-ink-muted font-mono">{p.variant_name || '—'}</td>
                                  <td className="py-3 px-4 text-center font-mono font-bold">
                                    {formatDualQuantity(p.quantity_sold || p.qty, p.pieces_per_set)}
                                  </td>
                                  <td className="py-3 px-4 text-right font-mono">{formatINR(revenue)}</td>
                                  <td className="py-3 px-4 text-right font-mono text-ink-muted">{formatINR(p.cogs)}</td>
                                  <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">{formatINR(grossProfit)}</td>
                                  <td className="py-3 px-4 text-right font-mono font-bold text-purple-700">
                                    {margin}%
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </>
                      )}

                      {/* TAB 8: BY PRODUCT */}
                      {activeTab === 'by_product' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Product Name</th>
                              <th className="py-3 px-4 text-center">Qty Sold</th>
                              <th className="py-3 px-4 text-right">Revenue</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((p: any, idx: number) => (
                              <tr key={idx} className="hover:bg-row-alt/50 transition">
                                <td className="py-3 px-4 font-bold text-ink-primary">{p.product_name}</td>
                                <td className="py-3 px-4 text-center font-mono font-bold">
                                  {formatDualQuantity(p.quantity_sold || p.tot_qty, p.pieces_per_set)}
                                </td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-accent">{formatINR(p.total_sales || p.revenue)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}

                      {/* TAB 9: BY CATEGORY */}
                      {activeTab === 'by_category' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Category</th>
                              <th className="py-3 px-4 text-center">Items Sold</th>
                              <th className="py-3 px-4 text-right">Revenue</th>
                              <th className="py-3 px-4 text-right">Profit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((c: any, idx: number) => (
                              <tr key={idx} className="hover:bg-row-alt/50 transition">
                                <td className="py-3 px-4 font-bold text-ink-primary">{c.category_name}</td>
                                <td className="py-3 px-4 text-center font-mono">{c.quantity_sold || c.items_sold || c.tot_qty} pcs</td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-accent">{formatINR(c.total_sales || c.revenue)}</td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">{formatINR(c.total_profit || c.tot_prof || 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}

                      {/* TAB 10: STOCK VALUATION */}
                      {activeTab === 'stock_cost' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Variant</th>
                              <th className="py-3 px-4">Product</th>
                              <th className="py-3 px-4">Barcode</th>
                              <th className="py-3 px-4 text-center">Stock</th>
                              <th className="py-3 px-4 text-right">Cost Price</th>
                              <th className="py-3 px-4 text-right">Valuation</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((s: any, idx: number) => (
                              <tr key={idx} className="hover:bg-row-alt/50 transition">
                                <td className="py-3 px-4 font-bold text-ink-primary">{s.variant_name}</td>
                                <td className="py-3 px-4 text-ink-muted">{s.product_name}</td>
                                <td className="py-3 px-4 font-mono text-ink-muted">{s.barcode || '—'}</td>
                                <td className="py-3 px-4 text-center font-mono font-bold text-ink-primary">
                                  {formatDualQuantity(s.stock_quantity, s.pieces_per_set)}
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-ink-muted">{formatINR(s.cost_price)}</td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-accent">{formatINR(s.total_cost || s.valuation)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}

                      {/* TAB 11: STOCK MOVES */}
                      {activeTab === 'stock_moves' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Date & Time</th>
                              <th className="py-3 px-4">Product & Variant</th>
                              <th className="py-3 px-4 text-center">Type</th>
                              <th className="py-3 px-4 text-right">Qty Change</th>
                              <th className="py-3 px-4">Notes</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((sm: any, idx: number) => {
                              const isPositive = Number(sm.quantity_change) > 0;
                              return (
                                <tr key={idx} className="hover:bg-row-alt/50 transition">
                                  <td className="py-3 px-4 font-mono text-ink-muted">
                                    {new Date(sm.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                                  </td>
                                  <td className="py-3 px-4 font-bold text-ink-primary">
                                    {sm.product_name ? `${sm.product_name} - ` : ''}{sm.variant_name}
                                  </td>
                                  <td className="py-3 px-4 text-center">
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-row-alt border border-border">
                                      {sm.type}
                                    </span>
                                  </td>
                                  <td className={`py-3 px-4 text-right font-mono font-bold ${isPositive ? 'text-emerald-700' : 'text-red-600'}`}>
                                    {formatDualQuantity(sm.quantity_change, sm.pieces_per_set, { showSign: true })}
                                  </td>
                                  <td className="py-3 px-4 text-ink-muted truncate max-w-xs">{sm.notes || '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </>
                      )}

                      {/* TAB 12: STOCK BY CATEGORY */}
                      {activeTab === 'stock_by_category' && (
                        <>
                          <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                            <tr>
                              <th className="py-3 px-4">Category</th>
                              <th className="py-3 px-4 text-center">Total Stock</th>
                              <th className="py-3 px-4 text-right">Valuation at Cost</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {paginatedTabRows.map((sbc: any, idx: number) => (
                              <tr key={idx} className="hover:bg-row-alt/50 transition">
                                <td className="py-3 px-4 font-bold text-ink-primary">{sbc.category_name}</td>
                                <td className="py-3 px-4 text-center font-mono font-bold">{sbc.total_pieces || sbc.total_stock || 0} pcs</td>
                                <td className="py-3 px-4 text-right font-mono font-bold text-accent">{formatINR(sbc.total_valuation || sbc.valuation)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Pagination Controls */}
            {totalTabPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-border text-xs">
                <span className="text-ink-muted">
                  Showing {(tabPages[activeTab] - 1) * PAGE_SIZE + 1} to {Math.min(tabPages[activeTab] * PAGE_SIZE, currentTabRows.length)} of {currentTabRows.length} records
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setTabPages(prev => ({ ...prev, [activeTab]: Math.max(1, (prev[activeTab] || 1) - 1) }))}
                    disabled={tabPages[activeTab] <= 1}
                    className="px-3 py-1.5 bg-surface hover:bg-row-alt border border-border rounded-xl font-bold disabled:opacity-40 transition cursor-pointer"
                  >
                    Previous
                  </button>
                  <span className="px-3 py-1.5 font-mono font-bold text-ink-primary">
                    Page {tabPages[activeTab]} of {totalTabPages}
                  </span>
                  <button
                    onClick={() => setTabPages(prev => ({ ...prev, [activeTab]: Math.min(totalTabPages, (prev[activeTab] || 1) + 1) }))}
                    disabled={tabPages[activeTab] >= totalTabPages}
                    className="px-3 py-1.5 bg-surface hover:bg-row-alt border border-border rounded-xl font-bold disabled:opacity-40 transition cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
