'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Clock, 
  Search, 
  Filter, 
  ChevronLeft, 
  ChevronRight, 
  Calendar,
  RotateCcw,
  Loader2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getStockLedgerAction } from '@/lib/actions/inventory';

interface LedgerItem {
  id: string;
  type: string;
  quantity_change: number;
  notes: string | null;
  created_at: string;
  variant: {
    id: string;
    name: string;
    barcode: string;
    product: {
      id: string;
      name: string;
      pieces_per_set: number;
    };
  };
}

interface PaginationInfo {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export default function LedgerClient({ 
  initialData, 
  initialPagination 
}: { 
  initialData: LedgerItem[]; 
  initialPagination?: PaginationInfo;
}) {
  const [data, setData] = useState<LedgerItem[]>(initialData);
  const [pagination, setPagination] = useState<PaginationInfo>(
    initialPagination || {
      page: 1,
      pageSize: 25,
      totalCount: initialData.length,
      totalPages: Math.ceil(initialData.length / 25) || 1
    }
  );

  // Filter States
  const [search, setSearch] = useState('');
  const [movementType, setMovementType] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);

  const isFirstMount = useRef(true);

  const fetchLedger = useCallback(async (pageToLoad: number, currentSearch: string, currentType: string, start: string, end: string) => {
    setLoading(true);
    try {
      const res = await getStockLedgerAction({
        page: pageToLoad,
        pageSize: pagination.pageSize,
        search: currentSearch,
        type: currentType !== 'ALL' ? currentType : undefined,
        startDate: start ? `${start}T00:00:00+05:30` : undefined,
        endDate: end ? `${end}T23:59:59.999+05:30` : undefined
      });

      if (res.success && res.data) {
        setData(res.data);
        if (res.pagination) {
          setPagination(res.pagination);
        }
      } else {
        toast.error(res?.error || 'Failed to load ledger movements');
      }
    } catch (err: unknown) {
      console.error('Failed to load ledger movements:', err);
      toast.error(err instanceof Error ? err.message : 'Error fetching ledger data');
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize]);

  // Debounced search & filter effect
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    const timer = setTimeout(() => {
      fetchLedger(1, search, movementType, startDate, endDate);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, movementType, startDate, endDate, fetchLedger]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > pagination.totalPages || loading) return;
    fetchLedger(newPage, search, movementType, startDate, endDate);
  };

  const handleResetFilters = () => {
    setSearch('');
    setMovementType('ALL');
    setStartDate('');
    setEndDate('');
    fetchLedger(1, '', 'ALL', '', '');
  };

  const startRecord = pagination.totalCount === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const endRecord = Math.min(pagination.page * pagination.pageSize, pagination.totalCount);

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Link href="/inventory/products" className="flex items-center gap-2 text-[13px] text-gray-500 hover:text-gray-900 w-fit font-medium transition-colors mb-1.5">
            <ArrowLeft className="w-4 h-4" />
            Back to Inventory
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock className="w-6 h-6 text-accent" />
            Stock History Ledger
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Audit log of all stock movements across products, sales, returns, and write-offs.
          </p>
        </div>
      </div>

      {/* Control / Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col lg:flex-row gap-3 items-center justify-between">
        {/* Search */}
        <div className="relative w-full lg:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product, variant, barcode, notes..."
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-medium text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
          />
        </div>

        {/* Movement Type Filter */}
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-300 rounded-lg px-2.5 py-1.5">
            <Filter className="w-3.5 h-3.5 text-gray-500" />
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value)}
              className="bg-transparent text-xs font-semibold text-gray-800 outline-none cursor-pointer"
            >
              <option value="ALL">All Types</option>
              <option value="INITIAL_STOCK">INITIAL_STOCK (Opening)</option>
              <option value="ARRIVAL">ARRIVAL (Stock In)</option>
              <option value="SALE">SALE (Sold)</option>
              <option value="RETURN_RESTOCK">RETURN_RESTOCK</option>
              <option value="RETURN_DAMAGE">RETURN_DAMAGE</option>
              <option value="VOID_RESTOCK">VOID_RESTOCK</option>
              <option value="MANUAL_ADJUST">MANUAL_ADJUST (Corrections)</option>
            </select>
          </div>

          {/* Date Pickers */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 outline-none"
              title="Start Date"
            />
            <span className="text-gray-400 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 outline-none"
              title="End Date"
            />
          </div>

          {(search || movementType !== 'ALL' || startDate || endDate) && (
            <button
              onClick={handleResetFilters}
              className="px-2.5 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs font-semibold transition"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Ledger Table Container */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
        {/* Mobile Ledger Cards (< 640px) */}
        <div className="block sm:hidden p-4 space-y-3">
          {loading && data.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-xs font-medium">
              Loading stock movements...
            </div>
          ) : data.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-xs font-medium">
              No stock movements found matching your filters.
            </div>
          ) : (
            data.map((item) => (
              <div key={item.id} className="bg-gray-50/50 p-3.5 rounded-xl border border-gray-200/80 shadow-2xs space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-gray-900 text-sm">{item.variant?.product?.name || 'Unknown'}</div>
                    <div className="text-xs text-gray-500 font-medium">{item.variant?.name || 'Unknown Variant'}</div>
                  </div>
                  <span className={`font-mono font-bold text-sm shrink-0 ${
                    item.quantity_change > 0 ? 'text-green-600' :
                    item.quantity_change < 0 ? 'text-red-600' : 'text-gray-500'
                  }`}>
                    {item.quantity_change > 0 ? `+${item.quantity_change}` : item.quantity_change} pcs
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs pt-1.5 border-t border-gray-200/50">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase ${
                    item.type === 'INITIAL_STOCK' ? 'bg-indigo-100 text-indigo-800' :
                    item.type === 'ARRIVAL' ? 'bg-green-100 text-green-800' :
                    item.type === 'SALE' ? 'bg-blue-100 text-blue-800' :
                    item.type === 'RETURN_RESTOCK' ? 'bg-teal-100 text-teal-800' :
                    item.type === 'RETURN_DAMAGE' ? 'bg-red-100 text-red-800' :
                    item.type === 'VOID_RESTOCK' ? 'bg-purple-100 text-purple-800' :
                    item.type === 'MANUAL_ADJUST' ? 'bg-amber-100 text-amber-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {item.type}
                  </span>

                  <span className="font-mono text-[11px] text-gray-400">
                    {new Date(item.created_at).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true
                    })}
                  </span>
                </div>

                {item.notes && (
                  <div className="text-xs text-gray-600 bg-white p-2 rounded-lg border border-gray-100">
                    {(() => {
                      const match = item.notes.match(/\b(MELBUN\/\d{4}\/[A-Z0-9]{6}|INV-[^\s,]+)\b/i);
                      const invoiceNum = match ? match[0] : null;

                      if (invoiceNum) {
                        return (
                          <Link 
                            href={`/invoices?search=${encodeURIComponent(invoiceNum)}`} 
                            className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                          >
                            {item.notes}
                          </Link>
                        );
                      }
                      return item.notes;
                    })()}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Desktop Ledger Table (>= 640px) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                <th className="py-3 px-5">Timestamp</th>
                <th className="py-3 px-5">Product & Variant</th>
                <th className="py-3 px-5">Barcode</th>
                <th className="py-3 px-5">Type</th>
                <th className="py-3 px-5 text-right">Qty Change</th>
                <th className="py-3 px-5">Notes / Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs">
              {loading && data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400 font-medium">
                    Loading stock movements...
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400 font-medium">
                    No stock movements found matching your filters.
                  </td>
                </tr>
              ) : (
                data.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="py-3 px-5 font-mono text-gray-500">
                      {new Date(item.created_at).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </td>
                    <td className="py-3 px-5">
                      <div className="font-bold text-gray-900">{item.variant?.product?.name || 'Unknown'}</div>
                      <div className="text-[11px] text-gray-500 font-medium">{item.variant?.name || 'Unknown Variant'}</div>
                    </td>
                    <td className="py-3 px-5 font-mono text-gray-600">
                      {item.variant?.barcode || 'N/A'}
                    </td>
                    <td className="py-3 px-5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase ${
                        item.type === 'INITIAL_STOCK' ? 'bg-indigo-100 text-indigo-800' :
                        item.type === 'ARRIVAL' ? 'bg-green-100 text-green-800' :
                        item.type === 'SALE' ? 'bg-blue-100 text-blue-800' :
                        item.type === 'RETURN_RESTOCK' ? 'bg-teal-100 text-teal-800' :
                        item.type === 'RETURN_DAMAGE' ? 'bg-red-100 text-red-800' :
                        item.type === 'VOID_RESTOCK' ? 'bg-purple-100 text-purple-800' :
                        item.type === 'MANUAL_ADJUST' ? 'bg-amber-100 text-amber-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {item.type}
                      </span>
                    </td>
                    <td className={`py-3 px-5 text-right font-mono font-bold text-sm ${
                      item.quantity_change > 0 ? 'text-green-600' :
                      item.quantity_change < 0 ? 'text-red-600' : 'text-gray-500'
                    }`}>
                      {item.quantity_change > 0 ? `+${item.quantity_change}` : item.quantity_change}
                    </td>
                    <td className="py-3 px-5 text-gray-600 max-w-xs truncate" title={item.notes || ''}>
                      {item.notes ? (() => {
                        const match = item.notes.match(/\b(MELBUN\/\d{4}\/[A-Z0-9]{6}|INV-[^\s,]+)\b/i);
                        const invoiceNum = match ? match[0] : null;

                        if (invoiceNum) {
                          return (
                            <Link 
                              href={`/invoices?search=${encodeURIComponent(invoiceNum)}`} 
                              className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                            >
                              {item.notes}
                            </Link>
                          );
                        }
                        return item.notes;
                      })() : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Server-Side Pagination Footer */}
        <div className="p-3.5 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600">
          <div>
            Showing <strong className="font-semibold text-gray-900">{startRecord}-{endRecord}</strong> of <strong className="font-semibold text-gray-900">{pagination.totalCount}</strong> movements
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1 || loading}
              className="flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-300 rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <span className="px-3 py-1 font-mono font-medium text-gray-700">
              Page {pagination.page} of {Math.max(1, pagination.totalPages)}
            </span>
            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages || loading}
              className="flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-300 rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
