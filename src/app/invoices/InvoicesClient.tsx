'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { 
  voidInvoiceAction, 
  undoVoidInvoiceAction,
  permanentlyDeleteInvoiceAction,
  updateInvoiceDetailsAction,
  getInvoicesPagedAction, 
  getFullInvoiceAction 
} from '@/lib/actions/invoices';
import { getCustomersListAction } from '@/lib/actions/customers';
import { 
  AlertTriangle, 
  X, 
  CheckCircle2, 
  ShieldAlert, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  Eye, 
  Receipt, 
  RotateCcw,
  Trash2,
  Edit3,
  Calendar,
  User,
  HelpCircle,
  Ban,
  FileText
} from 'lucide-react';

export interface InvoiceItem {
  id: string;
  invoice_number: string;
  customer_name?: string;
  customer_phone?: string;
  total_amount: number;
  effective_total?: number;
  total_refunds?: number;
  paid_amount?: number;
  due_amount?: number;
  status?: 'Paid' | 'Partial' | 'Credit' | 'Void' | 'Refunded';
  created_at: string;
  is_voided: boolean;
}

export default function InvoicesClient({ 
  initialInvoices,
  initialTotal,
  initialTotalPages 
}: { 
  initialInvoices: InvoiceItem[];
  initialTotal: number;
  initialTotalPages: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const [invoices, setInvoices] = useState<InvoiceItem[]>(initialInvoices);
  const [totalCount, setTotalCount] = useState<number>(initialTotal);
  const [totalPages, setTotalPages] = useState<number>(initialTotalPages);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearch);
  const [isFetching, setIsFetching] = useState<boolean>(false);

  // Void modal state
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceItem | null>(null);
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  // Undo Void modal state
  const [undoInvoice, setUndoInvoice] = useState<InvoiceItem | null>(null);
  const [undoLoading, setUndoLoading] = useState<boolean>(false);

  // Permanent Delete modal state
  const [deleteInvoice, setDeleteInvoice] = useState<InvoiceItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);

  // Detailed invoice inspection modal state
  const [inspectInvoice, setInspectInvoice] = useState<any | null>(null);
  const [inspectLoading, setInspectLoading] = useState<boolean>(false);

  // Synchronous lock to eliminate double-click race conditions
  const isSubmittingRef = useRef(false);

  const fetchInvoices = useCallback(async (page: number, query: string) => {
    setIsFetching(true);
    try {
      const res = await getInvoicesPagedAction({ page, pageSize: 25, query: (query || '').trim() });
      if (res.success && res.data) {
        setInvoices(res.data);
        setTotalCount(res.total);
        setTotalPages(res.totalPages);
        setCurrentPage(res.page);
      }
    } finally {
      setIsFetching(false);
    }
  }, []);

  const isFirstMount = useRef(true);

  // Debounced search query trigger
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (!searchQuery) return;
    }
    const timer = setTimeout(() => {
      fetchInvoices(1, searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchInvoices]);

  // Auto-inspect deep link effect
  useEffect(() => {
    const invId = searchParams.get('invoice_id');
    const invNumber = searchParams.get('invoice_number');
    if (invId) {
      router.replace(`/invoices/${invId}`);
    } else if (invNumber) {
      setSearchQuery(invNumber);
    }
  }, [searchParams, router]);

  // Global Escape keydown listener to close open modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!loading && !undoLoading && !deleteLoading && !inspectLoading) {
          if (selectedInvoice) closeVoidModal();
          if (undoInvoice) closeUndoModal();
          if (deleteInvoice) closeDeleteModal();
          if (inspectInvoice) setInspectInvoice(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loading, undoLoading, deleteLoading, inspectLoading, selectedInvoice, undoInvoice, deleteInvoice, inspectInvoice]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || isFetching) return;
    fetchInvoices(newPage, searchQuery);
  };

  const handlePrintPdf = async (inv: { id: string; invoice_number: string }) => {
    if (printingId) return;
    try {
      setPrintingId(inv.id);
      const { getFullInvoiceAction } = await import('@/lib/actions/invoices');
      const { generateInvoicePDF } = await import('@/lib/pdf/generateInvoice');
      const { getStoreSettingsAction } = await import('@/lib/actions/settings');

      const [invRes, storeRes] = await Promise.all([
        getFullInvoiceAction(inv.id),
        getStoreSettingsAction()
      ]);

      if (invRes.success && invRes.data) {
        const store = storeRes?.success && storeRes.data ? storeRes.data : null;
        const storeConfig = store ? {
          storeName: store.store_name || undefined,
          tagline: store.tagline || undefined,
          addressLine1: store.address || undefined,
          phone: store.phone || undefined,
          email: store.email || undefined,
          gstin: store.gstin || undefined
        } : undefined;

        generateInvoicePDF(invRes.data, { storeConfig });
      } else {
        alert(invRes?.error || 'Failed to load invoice details for printing.');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error generating PDF');
    } finally {
      setPrintingId(null);
    }
  };

  const openVoidModal = (invoice: InvoiceItem) => {
    if (invoice.is_voided) return;
    setSelectedInvoice(invoice);
    setReason('');
    setValidationError(null);
    setStatus(null);
  };

  const closeVoidModal = () => {
    if (loading) return;
    setSelectedInvoice(null);
    setReason('');
    setValidationError(null);
  };

  const handleConfirmVoid = async () => {
    if (isSubmittingRef.current || loading || !selectedInvoice) return;

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      setValidationError('Please enter a valid void reason (min 3 characters).');
      return;
    }

    try {
      isSubmittingRef.current = true;
      setLoading(true);
      setValidationError(null);
      setStatus(null);

      const res = await voidInvoiceAction({
        invoice_id: selectedInvoice.id,
        reason: trimmedReason
      });

      if (!res.success) {
        setStatus({ type: 'error', msg: res.error || 'Failed to void invoice.' });
      } else {
        setStatus({
          type: 'success',
          msg: `Invoice #${selectedInvoice.invoice_number} voided and stock restored successfully!`
        });

        // Optimistically update list to show red strikethrough and void badge
        setInvoices((prev) =>
          prev.map((inv) =>
            inv.id === selectedInvoice.id ? { ...inv, is_voided: true, status: 'Void', due_amount: 0 } : inv
          )
        );

        setSelectedInvoice(null);
        setReason('');
      }
    } catch (e: any) {
      setStatus({
        type: 'error',
        msg: e instanceof Error ? e.message : 'An unexpected error occurred'
      });
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  // Undo Void Handlers
  const openUndoModal = (inv: InvoiceItem) => {
    if (!inv.is_voided) return;
    setUndoInvoice(inv);
    setStatus(null);
  };

  const closeUndoModal = () => {
    if (undoLoading) return;
    setUndoInvoice(null);
  };

  const handleConfirmUndoVoid = async () => {
    if (isSubmittingRef.current || undoLoading || !undoInvoice) return;

    try {
      isSubmittingRef.current = true;
      setUndoLoading(true);
      setStatus(null);

      const res = await undoVoidInvoiceAction({ invoice_id: undoInvoice.id });

      if (!res.success) {
        setStatus({ type: 'error', msg: res.error || 'Failed to un-void invoice.' });
      } else {
        setStatus({
          type: 'success',
          msg: `Invoice #${undoInvoice.invoice_number} successfully un-voided and inventory re-deducted!`
        });

        // Refetch current page to accurately reflect updated balances & statuses
        await fetchInvoices(currentPage, searchQuery);
        setUndoInvoice(null);
      }
    } catch (e: any) {
      setStatus({
        type: 'error',
        msg: e instanceof Error ? e.message : 'An unexpected error occurred'
      });
    } finally {
      isSubmittingRef.current = false;
      setUndoLoading(false);
    }
  };

  // Permanent Delete Handlers
  const openDeleteModal = (inv: InvoiceItem) => {
    if (!inv.is_voided) return;
    setDeleteInvoice(inv);
    setStatus(null);
  };

  const closeDeleteModal = () => {
    if (deleteLoading) return;
    setDeleteInvoice(null);
  };

  const handleConfirmPermanentDelete = async () => {
    if (isSubmittingRef.current || deleteLoading || !deleteInvoice) return;

    try {
      isSubmittingRef.current = true;
      setDeleteLoading(true);
      setStatus(null);

      const res = await permanentlyDeleteInvoiceAction({ invoice_id: deleteInvoice.id });

      if (!res.success) {
        setStatus({ type: 'error', msg: res.error || 'Failed to delete invoice.' });
      } else {
        setStatus({
          type: 'success',
          msg: `Invoice #${deleteInvoice.invoice_number} permanently hidden from invoice records.`
        });

        // Optimistically remove from list and update totals/pagination
        const newTotal = Math.max(0, totalCount - 1);
        const newTotalPages = Math.max(1, Math.ceil(newTotal / 25));
        setTotalCount(newTotal);
        setTotalPages(newTotalPages);
        setInvoices((prev) => prev.filter((inv) => inv.id !== deleteInvoice.id));
        setDeleteInvoice(null);

        if (currentPage > newTotalPages) {
          fetchInvoices(newTotalPages, searchQuery);
        }
      }
    } catch (e: any) {
      setStatus({
        type: 'error',
        msg: e instanceof Error ? e.message : 'An unexpected error occurred'
      });
    } finally {
      isSubmittingRef.current = false;
      setDeleteLoading(false);
    }
  };

  // Edit Invoice Handler: Loads invoice into full POS screen for Total Editability (Full CRUD)
  const openEditModal = (inv: InvoiceItem) => {
    router.push(`/pos?editInvoiceId=${inv.id}`);
  };

  const handleInspectInvoice = (inv: InvoiceItem) => {
    router.push(`/invoices/${inv.id}`);
  };

  const renderStatusBadge = (inv: InvoiceItem) => {
    if (inv.is_voided || inv.status === 'Void') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
          VOIDED
        </span>
      );
    }
    if (inv.status === 'Refunded') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">
          REFUNDED
        </span>
      );
    }
    if (inv.status === 'Credit' || (inv.due_amount && inv.due_amount > 0 && (!inv.paid_amount || inv.paid_amount === 0))) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
          CREDIT (₹{Number(inv.due_amount || inv.total_amount).toFixed(2)})
        </span>
      );
    }
    if (inv.status === 'Partial' || (inv.due_amount && inv.due_amount > 0)) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-900 border border-blue-200">
          PARTIAL (Due: ₹{Number(inv.due_amount).toFixed(2)})
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
        PAID
      </span>
    );
  };

  return (
    <div className="p-4 pb-28 sm:p-8 space-y-6">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Invoices</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Search, inspect, print receipts, and manage customer invoices.</p>
        </div>

        {/* Live Search Input */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input 
            type="text"
            placeholder="Search invoice #, customer name, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
          />
          {isFetching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          )}
        </div>
      </header>

      {status && (
        <div
          className={`p-4 rounded-xl flex items-center gap-3 border ${
            status.type === 'error'
              ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-green-50 text-green-700 border-green-200'
          }`}
        >
          {status.type === 'error' ? (
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          )}
          <span className="font-medium text-sm">{status.msg}</span>
        </div>
      )}

      {/* Mobile Invoices Card View (< 640px) */}
      <div className="block sm:hidden space-y-3">
        {invoices.length === 0 ? (
          <div className="p-4 md:p-8 text-center text-gray-400 bg-white rounded-xl border border-gray-200 text-xs">
            {isFetching ? 'Loading invoices...' : 'No invoices found.'}
          </div>
        ) : (
          invoices.map((inv) => (
            <div key={inv.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className={`font-mono font-bold text-sm ${inv.is_voided ? 'line-through text-red-600' : 'text-gray-900'}`}>
                    {inv.invoice_number}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {new Date(inv.created_at).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </div>
                </div>
                <div>{renderStatusBadge(inv)}</div>
              </div>

              <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-2">
                <span className="text-gray-700 font-medium">{inv.customer_name || 'Walk-in Customer'}</span>
                <span className={`font-mono font-bold text-sm ${inv.is_voided ? 'line-through text-red-500' : 'text-gray-900'}`}>
                  ₹{inv.total_amount.toFixed(2)}
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 flex-wrap">
                <button
                  onClick={() => handleInspectInvoice(inv)}
                  disabled={inspectLoading}
                  className="px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center gap-1 min-h-[36px]"
                >
                  <Eye className="w-4 h-4" />
                  Inspect
                </button>
                <button
                  onClick={() => handlePrintPdf(inv)}
                  disabled={printingId === inv.id}
                  className="px-3 py-2 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg transition-colors disabled:opacity-50 min-h-[36px]"
                >
                  {printingId === inv.id ? 'PDF...' : 'PDF'}
                </button>
                {inv.is_voided ? (
                  <>
                    <button
                      onClick={() => openUndoModal(inv)}
                      disabled={undoLoading}
                      className="px-3 py-2 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors flex items-center gap-1 min-h-[36px]"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Undo Void
                    </button>
                    <button
                      onClick={() => openDeleteModal(inv)}
                      disabled={deleteLoading}
                      className="px-3 py-2 text-xs font-semibold text-red-800 bg-red-100 hover:bg-red-200 border border-red-300 rounded-lg transition-colors flex items-center gap-1 min-h-[36px]"
                      title="Permanently Delete (Hide)"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => openEditModal(inv)}
                      className="px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors flex items-center gap-1 min-h-[36px]"
                    >
                      <Edit3 className="w-4 h-4" />
                      Edit
                    </button>
                    {inv.status !== 'Refunded' && (inv.total_refunds || 0) === 0 && (
                      <button
                        onClick={() => openVoidModal(inv)}
                        className="px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors min-h-[36px]"
                      >
                        Void
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop Invoices List Table (>= 640px) */}
      <div className="hidden sm:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <th className="py-4 px-6">Invoice #</th>
              <th className="py-4 px-6">Date</th>
              <th className="py-4 px-6">Customer</th>
              <th className="py-4 px-6 text-right">Total Amount</th>
              <th className="py-4 px-6 text-center">Status</th>
              <th className="py-4 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 text-sm">
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400">
                  {isFetching ? 'Loading invoices...' : 'No invoices found.'}
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="py-4 px-6 font-semibold">
                    {inv.is_voided ? (
                      <span className="line-through text-red-600 font-mono">
                        {inv.invoice_number}
                      </span>
                    ) : (
                      <span className="text-gray-900 font-mono">{inv.invoice_number}</span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-gray-600">
                    {new Date(inv.created_at).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </td>
                  <td className="py-4 px-6">
                    <div className="font-medium text-gray-900">{inv.customer_name || 'Walk-in Customer'}</div>
                    {inv.customer_phone && (
                      <div className="text-xs text-gray-400 font-mono">{inv.customer_phone}</div>
                    )}
                  </td>
                  <td className="py-4 px-6 text-right font-medium text-gray-900">
                    {inv.is_voided ? (
                      <span className="line-through text-red-500 font-mono">
                        ₹{inv.total_amount.toFixed(2)}
                      </span>
                    ) : (
                      <span className="font-mono">₹{inv.total_amount.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-center">
                    {renderStatusBadge(inv)}
                  </td>
                  <td className="py-4 px-6 text-right">
                    <div className="flex justify-end gap-1.5 flex-wrap">
                      <button
                        onClick={() => handleInspectInvoice(inv)}
                        disabled={inspectLoading}
                        className="px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Inspect
                      </button>
                      <button
                        onClick={() => handlePrintPdf(inv)}
                        disabled={printingId === inv.id}
                        className="px-2.5 py-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {printingId === inv.id ? 'Generating...' : 'Print PDF'}
                      </button>
                      {inv.is_voided ? (
                        <>
                          <button
                            onClick={() => openUndoModal(inv)}
                            disabled={undoLoading}
                            className="px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Undo Void
                          </button>
                          <button
                            onClick={() => openDeleteModal(inv)}
                            disabled={deleteLoading}
                            className="px-2.5 py-1.5 text-xs font-semibold text-red-800 bg-red-100 hover:bg-red-200 border border-red-300 rounded-lg transition-colors flex items-center gap-1"
                            title="Permanently Delete (Hide)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => openEditModal(inv)}
                            className="px-2.5 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          {inv.status !== 'Refunded' && (inv.total_refunds || 0) === 0 && (
                            <button
                              onClick={() => openVoidModal(inv)}
                              className="px-2.5 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
                            >
                              Void
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Server-Side Pagination Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600">
          <div>
            Showing <span className="font-bold text-gray-900">{totalCount > 0 ? (currentPage - 1) * 25 + 1 : 0}</span> to{' '}
            <span className="font-bold text-gray-900">{Math.min(currentPage * 25, totalCount)}</span> of{' '}
            <span className="font-bold text-gray-900">{totalCount}</span> invoices
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1 || isFetching}
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </button>
            <span className="px-2 font-semibold text-gray-800">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages || isFetching}
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Destructive Action Confirmation Modal */}
      {selectedInvoice && (
        <div 
          onClick={(e) => { if (e.target === e.currentTarget && !loading) closeVoidModal(); }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto cursor-pointer"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-5 animate-in fade-in zoom-in duration-150 cursor-default">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-red-100 text-red-600 rounded-xl">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Void Invoice Confirmation</h3>
                  <p className="text-xs text-gray-500 font-mono">
                    #{selectedInvoice.invoice_number}
                  </p>
                </div>
              </div>
              <button
                onClick={closeVoidModal}
                disabled={loading}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-800 space-y-1">
              <p className="font-semibold">⚠️ Irreversible Operation</p>
              <p>
                Voiding this invoice will immediately restore all line item quantities to inventory
                stock and mark the transaction as voided in financial reporting.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                Reason for Voiding <span className="text-red-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="e.g. Customer returned items immediately, Cashier entry error..."
                rows={3}
                className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
              {validationError && (
                <p className="text-xs text-red-600 font-medium">{validationError}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeVoidModal}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmVoid}
                disabled={loading}
                className="px-5 py-2 text-sm font-semibold text-white bg-accent hover:bg-accent-hover rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Voiding & Restocking...' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Details Inspection Modal */}
      {inspectInvoice && (
        <div 
          onClick={(e) => { if (e.target === e.currentTarget && !inspectLoading) setInspectInvoice(null); }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto cursor-pointer"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] sm:max-h-[90vh] my-auto flex flex-col overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-200 cursor-default">
            <div className="flex items-center justify-between border-b border-gray-100 p-4 sm:p-6 pb-4 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-accent" />
                  Invoice Details: <span className="font-mono">{inspectInvoice.invoice_number}</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Created on {new Date(inspectInvoice.created_at).toLocaleString('en-IN')}
                </p>
              </div>
              <button
                onClick={() => setInspectInvoice(null)}
                className="text-gray-400 hover:text-gray-600 rounded-lg p-1 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
              {/* Customer & Financial Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 p-4 bg-gray-50 rounded-xl text-xs">
                <div>
                  <span className="text-gray-500 block">Customer</span>
                  <span className="font-bold text-gray-900">{inspectInvoice.customers?.name || 'Walk-in Customer'}</span>
                  {inspectInvoice.customers?.phone && (
                    <span className="text-gray-500 block font-mono">{inspectInvoice.customers.phone}</span>
                  )}
                </div>
                <div>
                  <span className="text-gray-500 block">Subtotal</span>
                  <span className="font-bold text-gray-900 font-mono">₹{Number(inspectInvoice.subtotal || 0).toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-gray-500 block">Discount</span>
                  <span className="font-bold text-amber-700 font-mono">₹{Number(inspectInvoice.discount_amount || 0).toFixed(2)}</span>
                </div>
                {inspectInvoice.gst_applied && (
                  <div>
                    <span className="text-gray-500 block">GST (CGST+SGST)</span>
                    <span className="font-bold text-blue-700 font-mono">
                      ₹{(Number(inspectInvoice.cgst_amount || 0) + Number(inspectInvoice.sgst_amount || 0)).toFixed(2)}
                    </span>
                  </div>
                )}
                {Number(inspectInvoice.round_off || 0) !== 0 && (
                  <div>
                    <span className="text-gray-500 block">Round Off</span>
                    <span className="font-bold text-gray-700 font-mono">₹{Number(inspectInvoice.round_off || 0).toFixed(2)}</span>
                  </div>
                )}
                <div>
                  <span className="text-gray-500 block">Final Total</span>
                  <span className="font-bold text-emerald-700 font-mono text-sm">₹{Number(inspectInvoice.final_total || 0).toFixed(2)}</span>
                </div>
              </div>

              {/* Line Items Table */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Purchased Items</h4>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Item / Variant</th>
                        <th className="py-2.5 px-3 text-center">Sets</th>
                        <th className="py-2.5 px-3 text-center">Loose</th>
                        <th className="py-2.5 px-3 text-center">Total Pcs</th>
                        <th className="py-2.5 px-3 text-right">Unit Price</th>
                        <th className="py-2.5 px-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(inspectInvoice.invoice_items || []).map((item: any) => {
                        const pName = item.variants?.products?.name || 'Product';
                        const vName = item.variants?.name || 'Variant';
                        const piecesPerSet = item.variants?.products?.pieces_per_set || 1;
                        const setsQty = item.sets_quantity || 0;
                        const looseQty = item.loose_quantity || (item.quantity - (setsQty * piecesPerSet));
                        const itemTotal = Number(item.quantity * item.selling_price_snapshot);

                        return (
                          <tr key={item.id} className="hover:bg-gray-50/50">
                            <td className="py-2.5 px-3 font-medium text-gray-900">
                              {pName} <span className="text-gray-500">({vName})</span>
                            </td>
                            <td className="py-2.5 px-3 text-center font-mono">{setsQty}</td>
                            <td className="py-2.5 px-3 text-center font-mono">{looseQty}</td>
                            <td className="py-2.5 px-3 text-center font-mono font-semibold">{item.quantity}</td>
                            <td className="py-2.5 px-3 text-right font-mono">₹{Number(item.selling_price_snapshot).toFixed(2)}</td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-gray-900">₹{itemTotal.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payments List */}
              {inspectInvoice.payments && inspectInvoice.payments.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Payments Received</h4>
                  <div className="space-y-1.5">
                    {inspectInvoice.payments.map((p: any) => {
                      const isRefund = Number(p.amount) < 0;
                      return (
                        <div key={p.id} className="flex justify-between items-center p-2.5 bg-gray-50 rounded-lg text-xs font-mono">
                          <span className={`font-semibold ${isRefund ? 'text-red-700' : 'text-gray-700'}`}>
                            {isRefund ? 'Refund Offset' : `${p.method} Payment`}
                          </span>
                          <span className="text-gray-500">{new Date(p.created_at).toLocaleDateString('en-IN')}</span>
                          <span className={`font-bold ${isRefund ? 'text-red-700' : 'text-emerald-700'}`}>
                            {isRefund ? '-' : ''}₹{Math.abs(Number(p.amount)).toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Returns History if any */}
              {inspectInvoice.returns && inspectInvoice.returns.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-red-600 mb-2">Returns / Refunds Recorded</h4>
                  <div className="space-y-1.5">
                    {inspectInvoice.returns.map((r: any) => (
                      <div key={r.id} className="flex justify-between items-center p-2.5 bg-red-50 rounded-lg text-xs font-mono text-red-800">
                        <span>Return: {r.quantity} pcs ({r.refund_method})</span>
                        <span className="text-xs text-red-600">{new Date(r.created_at).toLocaleDateString('en-IN')}</span>
                        <span className="font-bold">-₹{Number(r.total_refund_amount).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions Footer */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 shrink-0 rounded-b-2xl">
              <div className="flex flex-wrap items-center gap-2">
                {!inspectInvoice.is_voided && (
                  <>
                    <Link
                      href={`/pos?edit_invoice_id=${inspectInvoice.id}`}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs transition"
                    >
                      <Edit3 className="w-4 h-4" />
                      <span>Edit Invoice</span>
                    </Link>
                    <Link
                      href={`/returns?invoice_number=${encodeURIComponent(inspectInvoice.invoice_number)}`}
                      className="px-3.5 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs transition"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Return Items</span>
                    </Link>
                  </>
                )}
                <button
                  onClick={() => handlePrintPdf(inspectInvoice)}
                  disabled={printingId === inspectInvoice.id}
                  className="px-3.5 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs transition disabled:opacity-50"
                >
                  <FileText className="w-4 h-4 text-gray-600" />
                  <span>{printingId === inspectInvoice.id ? 'Generating...' : 'PDF Receipt'}</span>
                </button>
                {!inspectInvoice.is_voided ? (
                  <button
                    onClick={() => {
                      const invItem: InvoiceItem = {
                        id: inspectInvoice.id,
                        invoice_number: inspectInvoice.invoice_number,
                        customer_name: inspectInvoice.customers?.name,
                        customer_phone: inspectInvoice.customers?.phone,
                        total_amount: Number(inspectInvoice.final_total || inspectInvoice.total_amount || 0),
                        is_voided: Boolean(inspectInvoice.is_voided),
                        created_at: inspectInvoice.created_at,
                        due_amount: Number(inspectInvoice.due_amount || 0),
                        paid_amount: Number(inspectInvoice.paid_amount || 0),
                        status: inspectInvoice.status || 'Paid'
                      };
                      setInspectInvoice(null);
                      openVoidModal(invItem);
                    }}
                    className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition"
                  >
                    <Ban className="w-4 h-4" />
                    <span>Void</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const invItem: InvoiceItem = {
                        id: inspectInvoice.id,
                        invoice_number: inspectInvoice.invoice_number,
                        customer_name: inspectInvoice.customers?.name,
                        customer_phone: inspectInvoice.customers?.phone,
                        total_amount: Number(inspectInvoice.final_total || inspectInvoice.total_amount || 0),
                        is_voided: Boolean(inspectInvoice.is_voided),
                        created_at: inspectInvoice.created_at,
                        due_amount: Number(inspectInvoice.due_amount || 0),
                        paid_amount: Number(inspectInvoice.paid_amount || 0),
                        status: inspectInvoice.status || 'Void'
                      };
                      setInspectInvoice(null);
                      openUndoModal(invItem);
                    }}
                    className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-xl flex items-center gap-1.5 transition"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Undo Void</span>
                  </button>
                )}
              </div>
              <button
                onClick={() => setInspectInvoice(null)}
                className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-bold rounded-xl transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo Void Confirmation Modal */}
      {undoInvoice && (
        <div 
          onClick={(e) => { if (e.target === e.currentTarget && !undoLoading) closeUndoModal(); }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-150 cursor-pointer"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-5 animate-in zoom-in duration-150 cursor-default">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 text-amber-800 rounded-xl">
                  <RotateCcw className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Undo Void Confirmation</h3>
                  <p className="text-xs text-gray-500 font-mono">
                    #{undoInvoice.invoice_number}
                  </p>
                </div>
              </div>
              <button
                onClick={closeUndoModal}
                disabled={undoLoading}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 space-y-1.5">
              <p className="font-semibold flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-amber-700" />
                Inventory & Payment Restoration
              </p>
              <p>
                Restoring this invoice will re-deduct the sold item quantities from live stock and re-activate the invoice in reports and customer account records.
              </p>
            </div>

            <div className="p-3 bg-gray-50 rounded-xl text-xs space-y-1">
              <div className="flex justify-between text-gray-600">
                <span>Customer:</span>
                <span className="font-semibold text-gray-900">{undoInvoice.customer_name || 'Walk-in Customer'}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Invoice Total:</span>
                <span className="font-semibold text-gray-900 font-mono">₹{undoInvoice.total_amount.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeUndoModal}
                disabled={undoLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmUndoVoid}
                disabled={undoLoading}
                className="px-5 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                {undoLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Restoring Stock...
                  </>
                ) : (
                  'Confirm Undo Void'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanently Delete Confirmation Modal */}
      {deleteInvoice && (
        <div 
          onClick={(e) => { if (e.target === e.currentTarget && !deleteLoading) closeDeleteModal(); }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-150 cursor-pointer"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-5 animate-in zoom-in duration-150 cursor-default">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-red-100 text-red-700 rounded-xl">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Permanent Delete</h3>
                  <p className="text-xs text-gray-500 font-mono">
                    #{deleteInvoice.invoice_number}
                  </p>
                </div>
              </div>
              <button
                onClick={closeDeleteModal}
                disabled={deleteLoading}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-xs text-red-800 space-y-1.5">
              <p className="font-semibold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-red-600" />
                Hide from Records
              </p>
              <p>
                This voided invoice will be permanently hidden from the invoices directory and customer transaction tabs. This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleteLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPermanentDelete}
                disabled={deleteLoading}
                className="px-5 py-2 text-sm font-semibold text-white bg-red-800 hover:bg-red-900 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                {deleteLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Permanently Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
