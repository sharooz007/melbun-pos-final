'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Receipt, 
  RotateCcw, 
  Edit3, 
  Trash2, 
  ShieldAlert, 
  FileText, 
  Ban, 
  Loader2, 
  TrendingUp,
  Wallet
} from 'lucide-react';
import { 
  getFullInvoiceAction, 
  voidInvoiceAction, 
  undoVoidInvoiceAction, 
  permanentlyDeleteInvoiceAction 
} from '@/lib/actions/invoices';
import { getStoreSettingsAction } from '@/lib/actions/settings';

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

export default function InvoiceDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState<boolean>(false);

  // Void modal
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidLoading, setVoidLoading] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  // Undo Void modal
  const [isUndoModalOpen, setIsUndoModalOpen] = useState(false);
  const [undoLoading, setUndoLoading] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  // Delete modal
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isSubmittingRef = useRef(false);

  const loadInvoice = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getFullInvoiceAction(id);
      if (res.success && res.data) {
        setInvoice(res.data);
      } else {
        setError(res.error || 'Invoice not found.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load invoice.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadInvoice();
  }, [loadInvoice]);

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/invoices');
    }
  };

  // Profit & Due Calculation
  const profitMetrics = useMemo(() => {
    if (!invoice) return { rawProfit: 0, netProfit: 0, marginPercent: 0, totalRefunds: 0, effectiveTotal: 0, totalPaid: 0, dueAmount: 0 };
    
    const rawProfit = (invoice.invoice_items || []).reduce((acc: number, item: any) => {
      const pSnap = item.profit_snapshot !== undefined && item.profit_snapshot !== null
        ? Number(item.profit_snapshot)
        : Number(item.quantity) * (Number(item.selling_price_snapshot) - Number(item.cost_price_snapshot || 0));
      return acc + pSnap;
    }, 0);
    const netProfit = rawProfit - Number(invoice.discount_amount || 0);
    const finalTotal = Number(invoice.final_total || 0);
    const marginPercent = finalTotal > 0 ? (netProfit / finalTotal) * 100 : 0;

    const totalRefunds = (invoice.returns || []).reduce((acc: number, r: any) => acc + Number(r.total_refund_amount || 0), 0);
    const effectiveTotal = Math.max(0, finalTotal - totalRefunds);
    const totalPaid = (invoice.payments || []).reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);
    const dueAmount = invoice.is_voided ? 0 : Math.max(0, effectiveTotal - totalPaid);

    return { rawProfit, netProfit, marginPercent, totalRefunds, effectiveTotal, totalPaid, dueAmount };
  }, [invoice]);

  const handlePrintPdf = async () => {
    if (!invoice || printing) return;
    setPrinting(true);
    try {
      const { generateInvoicePDF } = await import('@/lib/pdf/generateInvoice');
      const storeRes = await getStoreSettingsAction();
      const store = storeRes?.success && storeRes.data ? storeRes.data : null;
      const storeConfig = store ? {
        storeName: store.store_name || undefined,
        tagline: store.tagline || undefined,
        addressLine1: store.address || undefined,
        phone: store.phone || undefined,
        email: store.email || undefined,
        gstin: store.gstin || undefined
      } : undefined;

      generateInvoicePDF(invoice, { storeConfig });
    } catch (err: any) {
      alert(err?.message || 'Error generating PDF receipt');
    } finally {
      setPrinting(false);
    }
  };

  const handleConfirmVoid = async () => {
    if (isSubmittingRef.current || voidLoading || !invoice) return;
    const cleanReason = voidReason.trim();
    if (cleanReason.length < 3) {
      setVoidError('Please enter a valid void reason (min 3 characters).');
      return;
    }

    try {
      isSubmittingRef.current = true;
      setVoidLoading(true);
      setVoidError(null);
      const res = await voidInvoiceAction({ invoice_id: invoice.id, reason: cleanReason });
      if (res.success) {
        setIsVoidModalOpen(false);
        await loadInvoice();
      } else {
        setVoidError(res.error || 'Failed to void invoice.');
      }
    } catch (e: any) {
      setVoidError(e?.message || 'Failed to void invoice.');
    } finally {
      isSubmittingRef.current = false;
      setVoidLoading(false);
    }
  };

  const handleConfirmUndoVoid = async () => {
    if (isSubmittingRef.current || undoLoading || !invoice) return;
    try {
      isSubmittingRef.current = true;
      setUndoLoading(true);
      setUndoError(null);
      const res = await undoVoidInvoiceAction({ invoice_id: invoice.id });
      if (res.success) {
        setIsUndoModalOpen(false);
        await loadInvoice();
      } else {
        setUndoError(res.error || 'Failed to un-void invoice.');
      }
    } catch (e: any) {
      setUndoError(e?.message || 'Failed to un-void invoice.');
    } finally {
      isSubmittingRef.current = false;
      setUndoLoading(false);
    }
  };

  const handleConfirmPermanentDelete = async () => {
    if (isSubmittingRef.current || deleteLoading || !invoice) return;
    try {
      isSubmittingRef.current = true;
      setDeleteLoading(true);
      setDeleteError(null);
      const res = await permanentlyDeleteInvoiceAction({ invoice_id: invoice.id });
      if (res.success) {
        setIsDeleteModalOpen(false);
        router.push('/invoices');
      } else {
        setDeleteError(res.error || 'Failed to delete invoice.');
      }
    } catch (e: any) {
      setDeleteError(e?.message || 'Failed to delete invoice.');
    } finally {
      isSubmittingRef.current = false;
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-canvas">
        <Loader2 className="w-8 h-8 animate-spin text-accent mb-3" />
        <p className="text-sm font-medium text-ink-muted">Loading invoice details...</p>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="p-4 pb-28 md:p-8 max-w-4xl mx-auto space-y-4">
        <button 
          onClick={handleBack} 
          type="button"
          className="inline-flex items-center gap-2 text-sm font-bold text-ink-primary hover:text-accent cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Go Back
        </button>
        <div className="p-6 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-800">
          <ShieldAlert className="w-6 h-6 shrink-0 text-red-600" />
          <div>
            <h3 className="font-bold text-sm">Error Loading Invoice</h3>
            <p className="text-xs text-red-700 mt-0.5">{error || 'Invoice not found.'}</p>
          </div>
        </div>
      </div>
    );
  }

  // Determine accurate status badge
  let statusText = 'PAID';
  let statusBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (invoice.is_voided) {
    statusText = 'VOIDED';
    statusBadgeClass = 'bg-red-100 text-red-800 border-red-200 line-through';
  } else if (profitMetrics.totalRefunds > 0 && profitMetrics.effectiveTotal === 0) {
    statusText = 'REFUNDED';
    statusBadgeClass = 'bg-purple-100 text-purple-800 border-purple-200';
  } else if (profitMetrics.dueAmount > 0 && profitMetrics.totalPaid > 0) {
    statusText = `PARTIAL (DUE ${formatINR(profitMetrics.dueAmount)})`;
    statusBadgeClass = 'bg-amber-100 text-amber-800 border-amber-200';
  } else if (profitMetrics.dueAmount > 0 && profitMetrics.totalPaid === 0) {
    statusText = `CREDIT DUE (${formatINR(profitMetrics.dueAmount)})`;
    statusBadgeClass = 'bg-orange-100 text-orange-800 border-orange-200';
  }

  return (
    <div className="p-3 pb-28 sm:p-6 md:p-8 max-w-5xl w-full mx-auto space-y-5 bg-canvas min-h-screen font-sans text-ink-primary">
      {/* Top Header & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            aria-label="Go Back"
            className="p-2.5 bg-surface border border-border rounded-xl hover:bg-row-alt transition text-ink-primary shadow-xs min-h-[42px] min-w-[42px] flex items-center justify-center cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold font-mono text-ink-primary">
                {invoice.invoice_number}
              </h1>
              <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${statusBadgeClass}`}>
                {statusText}
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              Created on {new Date(invoice.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {!invoice.is_voided && (
            <>
              <Link
                href={`/pos?edit_invoice_id=${invoice.id}`}
                className="px-3.5 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs transition"
              >
                <Edit3 className="w-4 h-4" />
                <span>Edit Invoice</span>
              </Link>
              <Link
                href={`/returns?invoice_number=${encodeURIComponent(invoice.invoice_number)}`}
                className="px-3.5 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs transition"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Return Items</span>
              </Link>
            </>
          )}
          <button
            onClick={handlePrintPdf}
            disabled={printing}
            className="px-3.5 py-2 bg-surface border border-border hover:bg-row-alt text-ink-primary text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs transition disabled:opacity-50"
          >
            <FileText className="w-4 h-4 text-ink-muted" />
            <span>{printing ? 'Generating...' : 'PDF Receipt'}</span>
          </button>
          {!invoice.is_voided ? (
            <button
              onClick={() => { setVoidReason(''); setVoidError(null); setIsVoidModalOpen(true); }}
              className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition"
            >
              <Ban className="w-4 h-4" />
              <span>Void</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => { setUndoError(null); setIsUndoModalOpen(true); }}
                className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-xl flex items-center gap-1.5 transition"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Undo Void</span>
              </button>
              <button
                onClick={() => { setDeleteError(null); setIsDeleteModalOpen(true); }}
                className="px-3 py-2 bg-red-800 hover:bg-red-900 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Financial & Profit Bento Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {/* Customer Card */}
        <div className="bg-surface p-4 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Customer</span>
          <div className="mt-2">
            <div className="font-bold text-sm md:text-base text-ink-primary truncate">
              {invoice.customers?.name || 'Walk-in Customer'}
            </div>
            {invoice.customers?.phone ? (
              <div className="text-xs text-ink-muted font-mono mt-0.5">{invoice.customers.phone}</div>
            ) : (
              <div className="text-xs text-slate-400 mt-0.5">No phone recorded</div>
            )}
          </div>
        </div>

        {/* Subtotal & Discount */}
        <div className="bg-surface p-4 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Subtotal & Discount</span>
          <div className="mt-2 space-y-0.5">
            <div className="text-xs text-ink-muted flex justify-between">
              <span>Subtotal:</span>
              <span className="font-mono font-bold text-ink-primary">{formatINR(invoice.subtotal)}</span>
            </div>
            <div className="text-xs text-amber-700 flex justify-between">
              <span>Discount:</span>
              <span className="font-mono font-bold">-{formatINR(invoice.discount_amount)}</span>
            </div>
          </div>
        </div>

        {/* Final Total */}
        <div className="bg-surface p-4 rounded-2xl border border-border shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Final Total</span>
          <div className="mt-2">
            <div className="text-xl md:text-2xl font-black font-mono text-emerald-700">
              {formatINR(invoice.final_total)}
            </div>
            <div className="text-xs text-ink-muted mt-0.5">
              {invoice.gst_applied ? 'GST Inclusive' : 'Standard Rate'}
            </div>
          </div>
        </div>

        {/* Profit & Margin Card */}
        <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Invoice Profit</span>
            <TrendingUp className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="mt-2">
            <div className="text-xl md:text-2xl font-black font-mono text-emerald-900">
              {formatINR(profitMetrics.netProfit)}
            </div>
            <div className="text-xs font-bold text-emerald-700 mt-0.5 flex items-center gap-1">
              <span>Margin:</span>
              <span className="font-mono font-black">{profitMetrics.marginPercent.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Purchased Items Section (Zero Horizontal Scroll on Mobile) */}
      <div className="bg-surface rounded-2xl border border-border shadow-xs overflow-hidden">
        <div className="p-4 border-b border-border bg-row-alt flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink-primary flex items-center gap-2">
            <Receipt className="w-4 h-4 text-accent" />
            Purchased Items ({(invoice.invoice_items || []).length})
          </h2>
        </div>

        {/* Mobile View: Stacked Card List (0px horizontal overflow) */}
        <div className="block md:hidden divide-y divide-border">
          {(invoice.invoice_items || []).map((item: any) => {
            const pName = item.variants?.products?.name || 'Product';
            const vName = item.variants?.name || 'Variant';
            const piecesPerSet = item.variants?.products?.pieces_per_set || 1;
            const setsQty = item.sets_quantity || 0;
            const looseQty = item.loose_quantity !== undefined && item.loose_quantity !== null
              ? Number(item.loose_quantity)
              : (Number(item.quantity) - (setsQty * piecesPerSet));
            const itemTotal = Number(item.quantity * item.selling_price_snapshot);
            const itemProfit = item.profit_snapshot !== undefined && item.profit_snapshot !== null
              ? Number(item.profit_snapshot)
              : Number(item.quantity) * (Number(item.selling_price_snapshot) - Number(item.cost_price_snapshot || 0));

            return (
              <div key={item.id} className="p-4 space-y-2.5">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <h3 className="font-bold text-sm text-ink-primary">{pName}</h3>
                    <span className="inline-block mt-0.5 px-2 py-0.5 bg-row-alt border border-border rounded text-[11px] font-medium text-ink-primary">
                      {vName}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-black text-base text-ink-primary">
                      {formatINR(itemTotal)}
                    </div>
                    <div className="text-[11px] font-mono text-emerald-700 font-semibold">
                      Profit: {formatINR(itemProfit)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border text-xs text-ink-muted bg-row-alt p-2.5 rounded-xl">
                  <div>
                    <span className="text-ink-muted block text-[10px] uppercase font-bold">Breakdown</span>
                    <span className="font-medium text-ink-primary">
                      {setsQty > 0 ? `${setsQty} sets (${piecesPerSet} pcs/set)` : ''}
                      {setsQty > 0 && looseQty > 0 ? ' + ' : ''}
                      {looseQty > 0 ? `${looseQty} loose` : ''}
                      {setsQty === 0 && looseQty === 0 ? `${item.quantity} pcs` : ` = ${item.quantity} pcs`}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-ink-muted block text-[10px] uppercase font-bold">Unit Price</span>
                    <span className="font-mono font-bold text-ink-primary">{formatINR(item.selling_price_snapshot)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop View: Full Grid Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-row-alt border-b border-border text-ink-muted font-semibold">
              <tr>
                <th className="py-3 px-4">Item / Variant</th>
                <th className="py-3 px-4 text-center">Sets</th>
                <th className="py-3 px-4 text-center">Loose</th>
                <th className="py-3 px-4 text-center">Total Pcs</th>
                <th className="py-3 px-4 text-right">Unit Price</th>
                <th className="py-3 px-4 text-right">Profit</th>
                <th className="py-3 px-4 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(invoice.invoice_items || []).map((item: any) => {
                const pName = item.variants?.products?.name || 'Product';
                const vName = item.variants?.name || 'Variant';
                const setsQty = item.sets_quantity || 0;
                const piecesPerSet = item.variants?.products?.pieces_per_set || 1;
                const looseQty = item.loose_quantity !== undefined && item.loose_quantity !== null
                  ? Number(item.loose_quantity)
                  : (Number(item.quantity) - (setsQty * piecesPerSet));
                const itemTotal = Number(item.quantity * item.selling_price_snapshot);
                const itemProfit = item.profit_snapshot !== undefined && item.profit_snapshot !== null
                  ? Number(item.profit_snapshot)
                  : Number(item.quantity) * (Number(item.selling_price_snapshot) - Number(item.cost_price_snapshot || 0));

                return (
                  <tr key={item.id} className="hover:bg-row-alt/60">
                    <td className="py-3 px-4 font-medium text-ink-primary">
                      {pName} <span className="text-ink-muted font-normal">({vName})</span>
                    </td>
                    <td className="py-3 px-4 text-center font-mono">{setsQty}</td>
                    <td className="py-3 px-4 text-center font-mono">{looseQty}</td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-ink-primary">{item.quantity}</td>
                    <td className="py-3 px-4 text-right font-mono text-ink-primary">{formatINR(item.selling_price_snapshot)}</td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700">{formatINR(itemProfit)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-ink-primary">{formatINR(itemTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payments & Returns Two-Column Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Payments List */}
        <div className="bg-surface rounded-2xl border border-border shadow-xs p-4 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink-primary flex items-center gap-1.5">
            <Wallet className="w-4 h-4 text-emerald-600" /> Payments Received
          </h2>
          {(!invoice.payments || invoice.payments.length === 0) ? (
            <p className="text-xs text-ink-muted py-3">No payments recorded.</p>
          ) : (
            <div className="space-y-2">
              {invoice.payments.map((p: any) => {
                const isRefund = Number(p.amount) < 0;
                return (
                  <div key={p.id} className="flex justify-between items-center p-3 bg-row-alt rounded-xl text-xs font-mono">
                    <div>
                      <span className={`font-bold block ${isRefund ? 'text-red-700' : 'text-ink-primary'}`}>
                        {isRefund ? 'Refund Offset' : `${p.method} Payment`}
                      </span>
                      <span className="text-ink-muted text-[11px]">
                        {new Date(p.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                    <span className={`text-sm font-black ${isRefund ? 'text-red-700' : 'text-emerald-700'}`}>
                      {isRefund ? '-' : ''}{formatINR(Math.abs(Number(p.amount)))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Returns Recorded */}
        <div className="bg-surface rounded-2xl border border-border shadow-xs p-4 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink-primary flex items-center gap-1.5">
            <RotateCcw className="w-4 h-4 text-orange-600" /> Returns &amp; Refunds
          </h2>
          {(!invoice.returns || invoice.returns.length === 0) ? (
            <p className="text-xs text-ink-muted py-3">No returns recorded for this invoice.</p>
          ) : (
            <div className="space-y-2">
              {invoice.returns.map((r: any) => (
                <div key={r.id} className="flex justify-between items-center p-3 bg-red-50/70 border border-red-100 rounded-xl text-xs font-mono">
                  <div>
                    <span className="font-bold text-red-900 block">
                      Returned: {r.quantity} pcs ({r.return_type || 'RESTOCK'})
                    </span>
                    <span className="text-red-600 text-[11px]">
                      Method: {r.refund_method} • {new Date(r.created_at).toLocaleDateString('en-IN')}
                    </span>
                  </div>
                  <span className="text-sm font-black text-red-700">
                    -{formatINR(r.total_refund_amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals with z-[200] */}
      {/* Void Modal */}
      {isVoidModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto cursor-pointer" onClick={() => !voidLoading && setIsVoidModalOpen(false)}>
          <div className="bg-surface rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 cursor-default border border-border" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-ink-primary">Void Invoice #{invoice.invoice_number}</h3>
            <p className="text-xs text-amber-800 bg-amber-50 p-3 rounded-xl border border-amber-200">
              ⚠️ Voiding this invoice will restore line item quantities to inventory stock and void all associated payment records.
            </p>
            <textarea
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              placeholder="Reason for voiding (min 3 characters)..."
              rows={3}
              className="w-full text-sm p-3 border border-border rounded-xl focus:ring-2 focus:ring-red-500 focus:outline-none"
            />
            {voidError && <p className="text-xs text-red-600 font-bold">{voidError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setIsVoidModalOpen(false)} disabled={voidLoading} className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl">Cancel</button>
              <button onClick={handleConfirmVoid} disabled={voidLoading} className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50">
                {voidLoading ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo Void Modal */}
      {isUndoModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto cursor-pointer" onClick={() => !undoLoading && setIsUndoModalOpen(false)}>
          <div className="bg-surface rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 cursor-default border border-border" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-ink-primary">Undo Void #{invoice.invoice_number}</h3>
            <p className="text-xs text-amber-900 bg-amber-50 p-3 rounded-xl border border-amber-200">
              Restoring this invoice will re-deduct item quantities from live stock and re-activate the invoice in reports.
            </p>
            {undoError && <p className="text-xs text-red-600 font-bold">{undoError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setIsUndoModalOpen(false)} disabled={undoLoading} className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl">Cancel</button>
              <button onClick={handleConfirmUndoVoid} disabled={undoLoading} className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl disabled:opacity-50">
                {undoLoading ? 'Restoring...' : 'Confirm Undo Void'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto cursor-pointer" onClick={() => !deleteLoading && setIsDeleteModalOpen(false)}>
          <div className="bg-surface rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 cursor-default border border-border" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-ink-primary">Permanently Delete Invoice</h3>
            <p className="text-xs text-red-800 bg-red-50 p-3 rounded-xl border border-red-200">
              This voided invoice will be permanently hidden from all records. This action cannot be undone.
            </p>
            {deleteError && <p className="text-xs text-red-600 font-bold">{deleteError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setIsDeleteModalOpen(false)} disabled={deleteLoading} className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl">Cancel</button>
              <button onClick={handleConfirmPermanentDelete} disabled={deleteLoading} className="px-4 py-2 text-xs font-bold text-white bg-red-800 hover:bg-red-900 rounded-xl disabled:opacity-50">
                {deleteLoading ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
