'use client'

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
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
  AlertCircle
} from 'lucide-react';
import { getReportsAction } from '@/lib/actions/reports';
import { getStoreSettingsAction } from '@/lib/actions/settings';
import { getReportDateRange, ReportPeriodPreset } from '@/lib/business-day';

const formatINR = (amount: number | string | null | undefined) => {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || 0));
  const safeNum = isNaN(num) ? 0 : num;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(safeNum);
};

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
  { key: 'daily_sales', label: 'Daily sales' },
  { key: 'monthly_sales', label: 'Monthly sales' },
  { key: 'credits', label: 'Credits' },
  { key: 'monthly_profit', label: 'Monthly profit' },
  { key: 'profit_by_product', label: 'Profit by product' },
  { key: 'by_product', label: 'By product' },
  { key: 'by_category', label: 'By category' },
  { key: 'stock_cost', label: 'Stock cost' },
  { key: 'stock_moves', label: 'Stock moves' },
  { key: 'stock_by_category', label: 'Stock by category' },
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
    stock_by_category: 1,
  });

  const [fetchError, setFetchError] = useState<string | null>(null);
  const PAGE_SIZE = 10;

  // 1. Load Store Settings for Business Day Cutoff
  useEffect(() => {
    async function loadSettings() {
      const res = await getStoreSettingsAction();
      if (res.success && res.data) {
        setStartHour(res.data.business_day_start_hour ?? 6);
        setTimezone(res.data.timezone || 'Asia/Kolkata');
      }
      setSettingsLoaded(true);
    }
    loadSettings();
  }, []);

  // 2. Fetch Reports (Bugs #9, #11, #161)
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
      console.error('Failed to fetch reports:', err);
      setFetchError(err.message || 'An unexpected network error occurred.');
    } finally {
      setLoading(false);
    }
  }, [preset, startHour, customFrom, customTo, timezone, settingsLoaded]);

  useEffect(() => {
    if (settingsLoaded) {
      fetchReports();
    }
  }, [fetchReports, settingsLoaded]);

  const [dateError, setDateError] = useState<string | null>(null);

  const handleCustomDateApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (customFrom && customTo) {
      if (customFrom > customTo) {
        setDateError('Start date cannot be after end date.');
        return;
      }
      setDateError(null);
      setPreset('custom');
      fetchReports();
    }
  };

  // CSV Export Engine for active tab
  const handleExportCSV = () => {
    if (!reportData) return;

    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    let filename = `reports_${activeTab}_${customFrom}_to_${customTo}.csv`;

    switch (activeTab) {
      case 'invoices':
        headers = ['Invoice #', 'Date & Time', 'Customer', 'Total (₹)', 'Paid (₹)', 'Payment Method', 'Status'];
        rows = (reportData.invoices || []).map((i: any) => [
          i.invoice_number,
          new Date(i.created_at).toLocaleString('en-IN'),
          i.customer_name,
          i.final_total,
          i.paid_amount,
          i.primary_method,
          i.status
        ]);
        break;
      case 'expenses':
        headers = ['Date', 'Category', 'Amount (₹)', 'Payment Method', 'Notes'];
        rows = (reportData.expenses_list || []).map((e: any) => [
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
        rows = (reportData.credits || []).map((c: any) => [
          c.customer_name,
          c.phone || '',
          c.total_spend,
          c.total_paid,
          c.pending_dues
        ]);
        break;
      case 'monthly_profit':
        headers = ['Month', 'Sales (₹)', 'COGS (₹)', 'Gross Profit (₹)', 'Expenses (₹)', 'Net Profit (₹)'];
        rows = (reportData.monthly_profit || []).map((p: any) => [
          p.month,
          p.sales,
          p.cogs,
          p.gross_profit,
          p.expenses,
          p.net_profit
        ]);
        break;
      case 'profit_by_product':
        headers = ['Product', 'Variant', 'Qty Sold', 'Revenue (₹)', 'COGS (₹)', 'Profit (₹)', 'Margin %'];
        rows = (reportData.profit_by_product || []).map((p: any) => [
          p.product_name,
          p.variant_name,
          p.quantity_sold,
          p.revenue,
          p.cogs,
          p.profit,
          `${p.margin_percent}%`
        ]);
        break;
      case 'by_product':
        headers = ['Product Name', 'Quantity Sold', 'Total Sales (₹)'];
        rows = (reportData.by_product || []).map((p: any) => [
          p.product_name,
          p.quantity_sold,
          p.total_sales
        ]);
        break;
      case 'by_category':
        headers = ['Category Name', 'Quantity Sold', 'Total Sales (₹)', 'Total Profit (₹)'];
        rows = (reportData.by_category || []).map((c: any) => [
          c.category_name,
          c.quantity_sold,
          c.total_sales,
          c.total_profit
        ]);
        break;
      case 'stock_cost':
        headers = ['Product', 'Variant', 'Barcode', 'Stock Qty', 'Unit Cost (₹)', 'Total Valuation (₹)'];
        rows = (reportData.stock_cost || []).map((s: any) => [
          s.product_name,
          s.variant_name,
          s.barcode,
          s.stock_quantity,
          s.cost_price,
          s.total_cost
        ]);
        break;
      case 'stock_moves':
        headers = ['Date', 'Product', 'Variant', 'Type', 'Qty Change', 'Notes'];
        rows = (reportData.stock_moves || []).map((m: any) => [
          new Date(m.created_at).toLocaleString('en-IN'),
          m.product_name,
          m.variant_name,
          m.type,
          m.quantity_change,
          m.notes || ''
        ]);
        break;
      case 'stock_by_category':
        headers = ['Category', 'Total Pieces', 'Valuation (₹)'];
        rows = (reportData.stock_by_category || []).map((sc: any) => [
          sc.category_name,
          sc.total_pieces,
          sc.total_valuation
        ]);
        break;
    }

    const csvString = [
      headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(','), 
      ...rows.map(r => r.map(cell => {
        let str = String(cell ?? '');
        if (['=', '+', '-', '@', '\t', '\r'].some(char => str.startsWith(char))) {
          str = `'` + str;
        }
        return `"${str.replace(/"/g, '""')}"`;
      }).join(','))
    ].join('\r\n');

    // Prepend UTF-8 BOM (\uFEFF) for 100% Excel & Unicode character compatibility
    const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Reset pagination on filter preset or custom date change
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

  // Active Tab Dataset & Pagination Slice
  const activeTabItems: any[] = useMemo(() => {
    if (!reportData) return [];
    switch (activeTab) {
      case 'invoices': return reportData.invoices || [];
      case 'expenses': return reportData.expenses_list || [];
      case 'daily_sales': return reportData.daily_sales || [];
      case 'monthly_sales': return reportData.monthly_sales || [];
      case 'credits': return reportData.credits || [];
      case 'monthly_profit': return reportData.monthly_profit || [];
      case 'profit_by_product': return reportData.profit_by_product || [];
      case 'by_product': return reportData.by_product || [];
      case 'by_category': return reportData.by_category || [];
      case 'stock_cost': return reportData.stock_cost || [];
      case 'stock_moves': return reportData.stock_moves || [];
      case 'stock_by_category': return reportData.stock_by_category || [];
      default: return [];
    }
  }, [reportData, activeTab]);

  const totalTabPages = Math.max(1, Math.ceil(activeTabItems.length / PAGE_SIZE));
  const currentTabPage = Math.min(Math.max(1, tabPages[activeTab] || 1), totalTabPages);
  const paginatedTabRows = useMemo(() => {
    const start = (currentTabPage - 1) * PAGE_SIZE;
    return activeTabItems.slice(start, start + PAGE_SIZE);
  }, [activeTabItems, currentTabPage]);

  const handleTabChange = (key: TabKey) => {
    setActiveTab(key);
  };

  const handleTabPageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalTabPages) return;
    setTabPages(prev => ({ ...prev, [activeTab]: newPage }));
  };

  // SVG Trend Path Calculation
  const trendPoints = useMemo(() => {
    let series: any[] = [];
    if (trendView === 'month' && reportData?.monthly_sales && reportData.monthly_sales.length > 0) {
      series = reportData.monthly_sales.slice().reverse().map((m: any) => ({
        label: m.month,
        sales: Number(m.gross_sales || 0),
        collected: Number(m.collected || 0)
      }));
    } else {
      series = reportData?.sales_trend || [];
    }

    if (series.length === 0) {
      return { 
        salesPath: '', 
        collectedPath: '', 
        maxVal: 0, 
        points: [] as Array<{ label: string; salesY: number; collectedY: number; x: number }> 
      };
    }

    const maxVal = Math.max(1, ...series.map((s: any) => Math.max(s.sales || 0, s.collected || 0)));
    const width = 800;
    const height = 180;
    const paddingX = 40;
    const paddingY = 20;

    const stepX = series.length > 1 ? (width - paddingX * 2) / (series.length - 1) : 0;

    const salesCoords = series.map((s, idx) => {
      const x = series.length === 1 ? width / 2 : paddingX + idx * stepX;
      const y = height - paddingY - ((s.sales || 0) / maxVal) * (height - paddingY * 2);
      return { x, y, ...s };
    });

    const collectedCoords = series.map((s, idx) => {
      const x = series.length === 1 ? width / 2 : paddingX + idx * stepX;
      const y = height - paddingY - ((s.collected || 0) / maxVal) * (height - paddingY * 2);
      return { x, y, ...s };
    });

    const createSmoothPath = (pts: { x: number; y: number }[]) => {
      if (pts.length === 0) return '';
      if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
      let path = `M ${pts[0].x},${pts[0].y}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const cx = (p0.x + p1.x) / 2;
        path += ` C ${cx},${p0.y} ${cx},${p1.y} ${p1.x},${p1.y}`;
      }
      return path;
    };

    return {
      salesPath: createSmoothPath(salesCoords),
      collectedPath: createSmoothPath(collectedCoords),
      maxVal,
      points: series.map((s, i) => ({
        label: s.label,
        sales: s.sales,
        collected: s.collected,
        salesY: salesCoords[i].y,
        collectedY: collectedCoords[i].y,
        x: salesCoords[i].x
      }))
    };
  }, [reportData, trendView]);

  return (
    <div className="p-4 pb-28 md:p-8 space-y-6 max-w-[1400px] w-full mx-auto bg-[#F4F1EA] min-h-screen text-gray-900 font-sans">
      {/* Title */}
      <header>
        <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
      </header>

      {/* ========================================================================= */}
      {/* 1. PERIOD FILTER CARD                                                     */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-2xl p-6 border border-[#E5E0D8] shadow-sm space-y-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
            Period
          </div>
          <div className="text-base font-bold text-gray-900">
            {periodLabel || 'Loading period...'}
          </div>
        </div>

        {/* Preset Pills */}
        <div className="bg-[#EFECE6] p-1.5 rounded-2xl flex flex-wrap items-center gap-1.5">
          {(['today', 'yesterday', 'this_week', 'this_month', 'this_year', 'custom'] as ReportPeriodPreset[]).map((p) => {
            const isActive = preset === p;
            const labels: Record<ReportPeriodPreset, string> = {
              today: 'Today',
              yesterday: 'Yesterday',
              this_week: 'This week',
              this_month: 'This month',
              this_year: 'This year',
              custom: 'Custom'
            };
            return (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`px-5 py-2 rounded-xl text-xs font-bold transition ${
                  isActive
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-white/60'
                }`}
              >
                {labels[p]}
              </button>
            );
          })}
        </div>

        {/* Custom Date Pickers */}
        {preset === 'custom' && (
          <form onSubmit={handleCustomDateApply} className="pt-2 flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-bold text-gray-700 mb-1">From</label>
              <input
                type="date"
                required
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-bold text-gray-700 mb-1">To</label>
              <input
                type="date"
                required
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
              />
            </div>
            <div className="pt-5">
              <button
                type="submit"
                className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold text-xs rounded-xl shadow-sm transition"
              >
                Apply Range
              </button>
            </div>
            {dateError && (
              <div className="w-full p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{dateError}</span>
              </div>
            )}
          </form>
        )}
      </div>

      {fetchError && (
        <div className="p-6 bg-red-50 border border-red-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-red-900">Failed to load reports</h3>
              <p className="text-xs text-red-700 mt-0.5">{fetchError}</p>
            </div>
          </div>
          <button
            onClick={() => fetchReports()}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition shadow-xs"
          >
            Retry Report
          </button>
        </div>
      )}

      {loading && !reportData ? (
        <div className="py-20 flex flex-col items-center justify-center text-gray-400 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <span className="text-sm font-medium">Generating financial reports...</span>
        </div>
      ) : (
        <>
          {/* ========================================================================= */}
          {/* 2. 8 KPI METRIC CARDS (2 Rows x 4 Columns)                                */}
          {/* ========================================================================= */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Total Sales */}
            <div className="bg-white p-5 rounded-2xl border border-[#E5E0D8] shadow-sm flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Total Sales</span>
                  <div className="text-2xl font-black text-gray-900 mt-1 font-mono">
                    {formatINR(reportData?.total_sales)}
                  </div>
                  <span className="text-xs text-gray-500 mt-1 block">
                    {reportData?.invoice_count || 0} invoices
                  </span>
                </div>
                <div className="p-2.5 bg-red-50 text-accent rounded-xl">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* 2. Collected */}
            <div className="bg-white p-5 rounded-2xl border border-[#E5E0D8] shadow-sm flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Collected</span>
                  <div className="text-2xl font-black text-gray-900 mt-1 font-mono">
                    {formatINR(reportData?.collected)}
                  </div>
                  <span className="text-xs text-gray-500 mt-1 block">
                    Payments in period
                  </span>
                </div>
                <div className="p-2.5 bg-teal-50 text-teal-700 rounded-xl">
                  <Wallet className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* 3. Outstanding Dues */}
            <div className="bg-white p-5 rounded-2xl border border-[#E5E0D8] shadow-sm flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Outstanding Dues</span>
                  <div className="text-2xl font-black text-gray-900 mt-1 font-mono">
                    {formatINR(reportData?.outstanding_dues)}
                  </div>
                  <span className="text-xs text-gray-500 mt-1 block">
                    Open balances (all time)
                  </span>
                </div>
                <div className="p-2.5 bg-amber-50 text-amber-700 rounded-xl">
                  <FileText className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* 4. Invoice Count */}
            <div className="bg-white p-5 rounded-2xl border border-[#E5E0D8] shadow-sm flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Invoice Count</span>
                  <div className="text-2xl font-black text-gray-900 mt-1 font-mono">
                    {reportData?.invoice_count || 0}
                  </div>
                  <span className="text-xs text-gray-500 mt-1 block font-mono">
                    Avg {formatINR(reportData?.avg_invoice_value)}
                  </span>
                </div>
                <div className="p-2.5 bg-gray-100 text-gray-700 rounded-xl">
                  <Receipt className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* 5. Expenses */}
            <div className="bg-white p-5 rounded-2xl border border-[#E5E0D8] shadow-sm flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Expenses</span>
                  <div className="text-2xl font-black text-gray-900 mt-1 font-mono">
                    {formatINR(reportData?.expenses)}
                  </div>
                  <span className="text-xs text-gray-500 mt-1 block">
                    In selected period
                  </span>
                </div>
                <div className="p-2.5 bg-red-50 text-red-700 rounded-xl">
                  <TrendingDown className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* 6. Net Profit */}
            <div className="bg-white p-5 rounded-2xl border border-[#E5E0D8] shadow-sm flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Net Profit</span>
                  <div className="text-2xl font-black text-gray-900 mt-1 font-mono">
                    {formatINR(reportData?.net_profit)}
                  </div>
                  <span className="text-xs text-gray-500 mt-1 block">
                    Gross profit – expenses
                  </span>
                </div>
                <div className="p-2.5 bg-orange-50 text-orange-700 rounded-xl">
                  <IndianRupee className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* 7. Gross Profit */}
            <div className="bg-white p-5 rounded-2xl border border-[#E5E0D8] shadow-sm flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Gross Profit</span>
                  <div className="text-2xl font-black text-gray-900 mt-1 font-mono">
                    {formatINR(reportData?.gross_profit)}
                  </div>
                  <span className="text-xs text-gray-500 mt-1 block">
                    Based on cost at sale
                  </span>
                </div>
                <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-xl">
                  <ShoppingBag className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* 8. Stock at Cost */}
            <div className="bg-white p-5 rounded-2xl border border-[#E5E0D8] shadow-sm flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Stock at Cost</span>
                  <div className="text-2xl font-black text-gray-900 mt-1 font-mono">
                    {formatINR(reportData?.stock_at_cost)}
                  </div>
                  <span className="text-xs text-gray-500 mt-1 block">
                    Current cost × stock (not historical)
                  </span>
                </div>
                <div className="p-2.5 bg-gray-100 text-gray-700 rounded-xl">
                  <Package className="w-5 h-5" />
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 3. PAYMENT BREAKDOWN SECTION                                              */}
          {/* ========================================================================= */}
          <div className="bg-white rounded-2xl p-6 border border-[#E5E0D8] shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-gray-900">Payment breakdown</h2>
                <p className="text-xs text-gray-500">By payment method in this period</p>
              </div>
              <div className="text-sm font-bold text-gray-900 font-mono">
                Collected: {formatINR(reportData?.payment_breakdown?.total_collected)}
              </div>
            </div>

            <div className="space-y-4 pt-1">
              {/* Cash Bar */}
              <div>
                <div className="flex justify-between text-xs font-semibold text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-gray-400"></span> Cash
                  </span>
                  <span className="font-mono">
                    {formatINR(reportData?.payment_breakdown?.cash_amount)} · {reportData?.payment_breakdown?.cash_percent || 0}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="bg-gray-400 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, Math.max(0, reportData?.payment_breakdown?.cash_percent || 0))}%` }}
                  />
                </div>
              </div>

              {/* UPI Bar */}
              <div>
                <div className="flex justify-between text-xs font-semibold text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-accent"></span> UPI
                  </span>
                  <span className="font-mono">
                    {formatINR(reportData?.payment_breakdown?.upi_amount)} · {reportData?.payment_breakdown?.upi_percent || 0}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="bg-accent h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, Math.max(0, reportData?.payment_breakdown?.upi_percent || 0))}%` }}
                  />
                </div>
              </div>

              {/* Store Credit Bar */}
              <div>
                <div className="flex justify-between text-xs font-semibold text-gray-700 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-600"></span> Store Credit
                  </span>
                  <span className="font-mono">
                    {formatINR(reportData?.payment_breakdown?.store_credit_amount || 0)} · {reportData?.payment_breakdown?.store_credit_percent || 0}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="bg-emerald-600 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, Math.max(0, reportData?.payment_breakdown?.store_credit_percent || 0))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 4. SALES TREND SVG GRAPH                                                  */}
          {/* ========================================================================= */}
          <div className="bg-white rounded-2xl p-6 border border-[#E5E0D8] shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-gray-900">Sales trend</h2>
                <p className="text-xs text-gray-500">Invoice totals and amount collected over the selected period</p>
              </div>
              <div className="bg-[#EFECE6] p-1 rounded-xl flex items-center gap-1 w-fit">
                <button
                  onClick={() => setTrendView('day')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    trendView === 'day' ? 'bg-accent text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Day wise
                </button>
                <button
                  onClick={() => setTrendView('month')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    trendView === 'month' ? 'bg-accent text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Month wise
                </button>
              </div>
            </div>

            {/* SVG Visual Graph */}
            <div className="relative w-full h-56 bg-gray-50/50 rounded-xl p-4 flex flex-col justify-between">
              {trendPoints.points.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-gray-400 font-medium">
                  No sales or collections recorded in this period.
                </div>
              ) : (
                <div className="w-full h-full relative">
                  <svg className="w-full h-40 overflow-visible" viewBox="0 0 800 180" preserveAspectRatio="none">
                    {/* Grid lines */}
                    <line x1="0" y1="20" x2="800" y2="20" stroke="#E5E0D8" strokeDasharray="4 4" />
                    <line x1="0" y1="90" x2="800" y2="90" stroke="#E5E0D8" strokeDasharray="4 4" />
                    <line x1="0" y1="160" x2="800" y2="160" stroke="#E5E0D8" strokeDasharray="4 4" />

                    {/* Sales Area & Line (Rust) */}
                    <path
                      d={trendPoints.salesPath}
                      fill="none"
                      stroke="#C85A3A"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />

                    {/* Collected Area & Line (Green) */}
                    <path
                      d={trendPoints.collectedPath}
                      fill="none"
                      stroke="#10B981"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />

                    {/* Data Points with SVG tooltips */}
                    {trendPoints.points.map((pt: any, i: number) => (
                      <g key={i}>
                        <circle cx={pt.x} cy={pt.salesY} r="4" fill="#C85A3A" className="hover:r-6 cursor-pointer transition-all">
                          <title>{`${pt.label} - Sales: ₹${Number(pt.sales || 0).toFixed(2)}`}</title>
                        </circle>
                        <circle cx={pt.x} cy={pt.collectedY} r="4" fill="#10B981" className="hover:r-6 cursor-pointer transition-all">
                          <title>{`${pt.label} - Collected: ₹${Number(pt.collected || 0).toFixed(2)}`}</title>
                        </circle>
                      </g>
                    ))}
                  </svg>

                  {/* Horizontal X Axis Labels with Stride Downsampling */}
                  <div className="flex justify-between items-center text-[10px] text-gray-400 font-medium pt-2 overflow-hidden">
                    {(() => {
                      const totalPts = trendPoints.points.length;
                      const stride = totalPts > 12 ? Math.ceil(totalPts / 8) : 1;
                      return trendPoints.points.map((pt, i) => {
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
            <div className="flex items-center justify-center gap-6 text-xs font-semibold text-gray-700 pt-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]"></span>
                <span>Collected</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#C85A3A]"></span>
                <span>Sales</span>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 5. 12 DRILLDOWN DATA TABS & EXPORT                                        */}
          {/* ========================================================================= */}
          <div className="bg-white rounded-2xl border border-[#E5E0D8] shadow-sm overflow-hidden space-y-4 p-6">
            {/* Tabs Header & CSV Download */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 pb-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {TAB_LABELS.map((t) => {
                  const isActive = activeTab === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => handleTabChange(t.key)}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                        isActive
                          ? 'bg-accent text-white shadow-sm'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={handleExportCSV}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-xl transition self-start lg:self-auto"
                title="Download active table as CSV"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>

            {/* Tab Table Body */}
            <div className="overflow-x-auto min-h-[300px]">
              {paginatedTabRows.length === 0 ? (
                <div className="py-20 text-center text-xs text-gray-400 font-medium">
                  No records found in this category for the selected period.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  {/* TAB: INVOICES */}
                  {activeTab === 'invoices' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
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
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((inv: any) => (
                          <tr 
                            key={inv.id} 
                            onClick={() => router.push(`/invoices/${inv.id}`)}
                            className="hover:bg-gray-50/70 transition cursor-pointer"
                          >
                            <td className={`py-3 px-4 font-mono font-bold ${inv.is_voided ? 'line-through text-red-500' : 'text-gray-900'}`}>
                              {inv.invoice_number}
                            </td>
                            <td className="py-3 px-4 font-semibold text-gray-800">{inv.customer_name}</td>
                            <td className="py-3 px-4 text-gray-500 font-mono">
                              {new Date(inv.created_at).toLocaleString('en-IN', {
                                day: '2-digit', month: 'short', year: 'numeric',
                                hour: '2-digit', minute: '2-digit', hour12: true
                              })}
                            </td>
                            <td className={`py-3 px-4 text-right font-mono font-bold ${inv.is_voided ? 'line-through text-red-500' : 'text-gray-900'}`}>
                              {formatINR(inv.final_total)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-gray-700">{formatINR(inv.paid_amount)}</td>
                            <td className="py-3 px-4 text-center font-mono font-bold text-[11px] text-gray-600">{inv.primary_method}</td>
                            <td className="py-3 px-4 text-center">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                inv.status === 'Paid' ? 'bg-green-100 text-green-800' :
                                inv.status === 'Partial' ? 'bg-amber-100 text-amber-800' :
                                inv.status === 'Void' ? 'bg-red-100 text-red-800' :
                                'bg-red-50 text-red-700'
                              }`}>
                                {inv.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}

                  {/* TAB: EXPENSES */}
                  {activeTab === 'expenses' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-4">Date</th>
                          <th className="py-3 px-4">Category</th>
                          <th className="py-3 px-4 text-right">Amount</th>
                          <th className="py-3 px-4 text-center">Payment Method</th>
                          <th className="py-3 px-4">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((e: any) => (
                          <tr 
                            key={e.id} 
                            onClick={() => router.push(`/expenses/${e.id}`)}
                            className="hover:bg-row-alt/60 transition cursor-pointer"
                          >
                            <td className="py-3 px-4 font-mono text-gray-500">{new Date(e.created_at).toLocaleDateString('en-IN')}</td>
                            <td className="py-3 px-4 font-bold text-gray-900 flex items-center gap-1.5">
                              <span>{e.category}</span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-red-600">{formatINR(e.amount)}</td>
                            <td className="py-3 px-4 text-center font-mono text-gray-600">{e.payment_method}</td>
                            <td className="py-3 px-4 text-gray-500 truncate max-w-xs">{e.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}

                  {/* TAB: DAILY SALES */}
                  {activeTab === 'daily_sales' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-4">Business Date</th>
                          <th className="py-3 px-4 text-center">Invoices</th>
                          <th className="py-3 px-4 text-right">Gross Sales</th>
                          <th className="py-3 px-4 text-right">Discount</th>
                          <th className="py-3 px-4 text-right">Net Sales</th>
                          <th className="py-3 px-4 text-right">Collected</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((d: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50/70 transition">
                            <td className="py-3 px-4 font-mono font-bold text-gray-900">{d.date}</td>
                            <td className="py-3 px-4 text-center font-mono">{d.invoice_count}</td>
                            <td className="py-3 px-4 text-right font-mono text-gray-700">{formatINR(d.gross_sales)}</td>
                            <td className="py-3 px-4 text-right font-mono text-red-600">{formatINR(d.discount)}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-gray-900">{formatINR(d.net_sales)}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">{formatINR(d.collected)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}

                  {/* TAB: MONTHLY SALES */}
                  {activeTab === 'monthly_sales' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-4">Month</th>
                          <th className="py-3 px-4 text-center">Invoices</th>
                          <th className="py-3 px-4 text-right">Gross Sales</th>
                          <th className="py-3 px-4 text-right">Discount</th>
                          <th className="py-3 px-4 text-right">Net Sales</th>
                          <th className="py-3 px-4 text-right">Collected</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((m: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50/70 transition">
                            <td className="py-3 px-4 font-mono font-bold text-gray-900">{m.month}</td>
                            <td className="py-3 px-4 text-center font-mono">{m.invoice_count}</td>
                            <td className="py-3 px-4 text-right font-mono text-gray-700">{formatINR(m.gross_sales)}</td>
                            <td className="py-3 px-4 text-right font-mono text-red-600">{formatINR(m.discount)}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-gray-900">{formatINR(m.net_sales)}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">{formatINR(m.collected)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}

                  {/* TAB: CREDITS */}
                  {activeTab === 'credits' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-4">Customer Name</th>
                          <th className="py-3 px-4">Phone</th>
                          <th className="py-3 px-4 text-right">Total Spend</th>
                          <th className="py-3 px-4 text-right">Total Paid</th>
                          <th className="py-3 px-4 text-right">Pending Dues</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((c: any) => (
                          <tr key={c.customer_id} className="hover:bg-gray-50/70 transition">
                            <td className="py-3 px-4 font-bold text-gray-900">{c.customer_name}</td>
                            <td className="py-3 px-4 font-mono text-gray-500">{c.phone || '-'}</td>
                            <td className="py-3 px-4 text-right font-mono text-gray-700">{formatINR(c.total_spend)}</td>
                            <td className="py-3 px-4 text-right font-mono text-emerald-600">{formatINR(c.total_paid)}</td>
                            <td className={`py-3 px-4 text-right font-mono font-bold ${c.pending_dues > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                              {formatINR(c.pending_dues)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}

                  {/* TAB: MONTHLY PROFIT */}
                  {activeTab === 'monthly_profit' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-4">Month</th>
                          <th className="py-3 px-4 text-right">Revenue</th>
                          <th className="py-3 px-4 text-right">COGS</th>
                          <th className="py-3 px-4 text-right">Gross Profit</th>
                          <th className="py-3 px-4 text-right">Expenses</th>
                          <th className="py-3 px-4 text-right">Net Profit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((p: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50/70 transition">
                            <td className="py-3 px-4 font-mono font-bold text-gray-900">{p.month}</td>
                            <td className="py-3 px-4 text-right font-mono text-gray-700">{formatINR(p.sales)}</td>
                            <td className="py-3 px-4 text-right font-mono text-gray-500">{formatINR(p.cogs)}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">{formatINR(p.gross_profit)}</td>
                            <td className="py-3 px-4 text-right font-mono text-red-600">{formatINR(p.expenses)}</td>
                            <td className="py-3 px-4 text-right font-mono font-black text-gray-900">{formatINR(p.net_profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}

                  {/* TAB: PROFIT BY PRODUCT */}
                  {activeTab === 'profit_by_product' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-4">Product / Variant</th>
                          <th className="py-3 px-4 text-center">Qty Sold</th>
                          <th className="py-3 px-4 text-right">Revenue</th>
                          <th className="py-3 px-4 text-right">COGS</th>
                          <th className="py-3 px-4 text-right">Profit</th>
                          <th className="py-3 px-4 text-right">Margin %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((p: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50/70 transition">
                            <td className="py-3 px-4 font-semibold text-gray-900">
                              {p.product_name} <span className="text-gray-400 font-normal">/</span> {p.variant_name}
                            </td>
                            <td className="py-3 px-4 text-center font-mono">{p.quantity_sold}</td>
                            <td className="py-3 px-4 text-right font-mono text-gray-700">{formatINR(p.revenue)}</td>
                            <td className="py-3 px-4 text-right font-mono text-gray-500">{formatINR(p.cogs)}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">{formatINR(p.profit)}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-gray-900">{p.margin_percent}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}

                  {/* TAB: BY PRODUCT */}
                  {activeTab === 'by_product' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-4">Product Name</th>
                          <th className="py-3 px-4 text-center">Units Sold</th>
                          <th className="py-3 px-4 text-right">Total Sales</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((p: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50/70 transition">
                            <td className="py-3 px-4 font-bold text-gray-900">{p.product_name}</td>
                            <td className="py-3 px-4 text-center font-mono font-bold">{p.quantity_sold}</td>
                            <td className="py-3 px-4 text-right font-mono font-black text-gray-900">{formatINR(p.total_sales)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}

                  {/* TAB: BY CATEGORY */}
                  {activeTab === 'by_category' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-4">Category Name</th>
                          <th className="py-3 px-4 text-center">Units Sold</th>
                          <th className="py-3 px-4 text-right">Total Sales</th>
                          <th className="py-3 px-4 text-right">Total Profit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((c: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50/70 transition">
                            <td className="py-3 px-4 font-bold text-gray-900">{c.category_name}</td>
                            <td className="py-3 px-4 text-center font-mono font-bold">{c.quantity_sold}</td>
                            <td className="py-3 px-4 text-right font-mono font-black text-gray-900">{formatINR(c.total_sales)}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">{formatINR(c.total_profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}

                  {/* TAB: STOCK COST */}
                  {activeTab === 'stock_cost' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-4">Product / Variant</th>
                          <th className="py-3 px-4">Barcode</th>
                          <th className="py-3 px-4 text-center">Stock Qty</th>
                          <th className="py-3 px-4 text-right">Unit Cost</th>
                          <th className="py-3 px-4 text-right">Total Cost Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((s: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50/70 transition">
                            <td className="py-3 px-4 font-semibold text-gray-900">
                              {s.product_name} <span className="text-gray-400 font-normal">/</span> {s.variant_name}
                            </td>
                            <td className="py-3 px-4 font-mono text-gray-500">{s.barcode || '-'}</td>
                            <td className="py-3 px-4 text-center font-mono font-bold">{s.stock_quantity}</td>
                            <td className="py-3 px-4 text-right font-mono text-gray-600">{formatINR(s.cost_price)}</td>
                            <td className="py-3 px-4 text-right font-mono font-black text-gray-900">{formatINR(s.total_cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}

                  {/* TAB: STOCK MOVES */}
                  {activeTab === 'stock_moves' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-4">Date & Time</th>
                          <th className="py-3 px-4">Product / Variant</th>
                          <th className="py-3 px-4 text-center">Type</th>
                          <th className="py-3 px-4 text-right">Qty Change</th>
                          <th className="py-3 px-4">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((m: any) => (
                          <tr key={m.id} className="hover:bg-gray-50/70 transition">
                            <td className="py-3 px-4 font-mono text-gray-500">{new Date(m.created_at).toLocaleString('en-IN')}</td>
                            <td className="py-3 px-4 font-semibold text-gray-900">
                              {m.product_name} <span className="text-gray-400 font-normal">/</span> {m.variant_name}
                            </td>
                            <td className="py-3 px-4 text-center font-mono font-bold text-[11px] text-gray-700">{m.type}</td>
                            <td className={`py-3 px-4 text-right font-mono font-bold ${m.quantity_change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change}
                            </td>
                            <td className="py-3 px-4 text-gray-500 truncate max-w-xs">{m.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}

                  {/* TAB: STOCK BY CATEGORY */}
                  {activeTab === 'stock_by_category' && (
                    <>
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-4">Category Name</th>
                          <th className="py-3 px-4 text-center">Total Stock Pieces</th>
                          <th className="py-3 px-4 text-right">Stock Valuation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedTabRows.map((sc: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50/70 transition">
                            <td className="py-3 px-4 font-bold text-gray-900">{sc.category_name}</td>
                            <td className="py-3 px-4 text-center font-mono font-bold">{sc.total_pieces}</td>
                            <td className="py-3 px-4 text-right font-mono font-black text-gray-900">{formatINR(sc.total_valuation)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}
                </table>
              )}
            </div>

            {/* Tab Pagination Controls */}
            {activeTabItems.length > 0 && (
              <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600">
                <div>
                  Showing <strong className="font-semibold text-gray-900">{Math.min(activeTabItems.length, (currentTabPage - 1) * PAGE_SIZE + 1)}-{Math.min(activeTabItems.length, currentTabPage * PAGE_SIZE)}</strong> of <strong className="font-semibold text-gray-900">{activeTabItems.length}</strong>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTabPageChange(currentTabPage - 1)}
                    disabled={currentTabPage <= 1}
                    className="flex items-center gap-1 px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-bold hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </button>
                  <span className="font-mono px-2 font-bold text-gray-700">
                    {currentTabPage} / {totalTabPages}
                  </span>
                  <button
                    onClick={() => handleTabPageChange(currentTabPage + 1)}
                    disabled={currentTabPage >= totalTabPages}
                    className="flex items-center gap-1 px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-bold hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
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
