'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  lookupInvoiceAction, 
  processReturnAction, 
  getRecentReturnsAction 
} from '@/lib/actions/returns';
import { 
  InvoiceLookupData, 
  InvoiceItemWithReturns, 
  RefundPaymentMethod, 
  ReturnType, 
  RecentReturnAuditItem 
} from '@/types/returns';
import { 
  RotateCcw, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Package, 
  Receipt, 
  IndianRupee, 
  CreditCard, 
  RefreshCw, 
  X, 
  Clock, 
  User, 
  FileText, 
  ShieldAlert, 
  Ban, 
  Wallet, 
  Loader2, 
  Camera,
  ExternalLink,
  ArchiveRestore,
  Trash2
} from 'lucide-react';
import CameraScanner from '@/components/lookup/CameraScanner';

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

export default function ReturnsClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // State: Search & Active Invoice
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceLookupData | null>(null);

  // Camera Scanner State
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  // State: Return Modal Form
  const [selectedItem, setSelectedItem] = useState<InvoiceItemWithReturns | null>(null);
  const [refundMethod, setRefundMethod] = useState<RefundPaymentMethod>('CASH');
  const [returnType, setReturnType] = useState<ReturnType>('RESTOCK');
  const [notes, setNotes] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [returnSets, setReturnSets] = useState<number>(0);
  const [returnLoose, setReturnLoose] = useState<number>(0);

  // State: Global Status & Ledger
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [recentReturns, setRecentReturns] = useState<RecentReturnAuditItem[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  // Synchronous lock to prevent concurrent double-click race conditions
  const isProcessingRef = useRef(false);

  // Auto-lookup on mount with deep-link support
  useEffect(() => {
    const invNumber = searchParams.get('invoice_number') || searchParams.get('invoice_id');
    if (invNumber) {
      setInvoiceQuery(invNumber);
      (async () => {
        setSearching(true);
        setStatus(null);
        try {
          const res = await lookupInvoiceAction(invNumber);
          if (res.success && res.data) {
            setInvoice(res.data);
          } else {
            setStatus({ type: 'error', msg: res.error || 'Invoice not found.' });
          }
        } catch (err: any) {
          setStatus({ type: 'error', msg: err?.message || 'Failed to lookup invoice.' });
        } finally {
          setSearching(false);
        }
      })();
    }
  }, [searchParams]);

  // Load Recent Returns History
  const loadLedger = useCallback(async () => {
    setLoadingLedger(true);
    try {
      const res = await getRecentReturnsAction(25);
      if (res.success && res.data) {
        setRecentReturns(res.data);
      }
    } catch {
      // Non-blocking background fetch
    } finally {
      setLoadingLedger(false);
    }
  }, []);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  const closeReturnModal = useCallback(() => {
    if (submittingReturn) return;
    setSelectedItem(null);
    setReturnSets(0);
    setReturnLoose(0);
    setNotes('');
    setModalError(null);
  }, [submittingReturn]);

  // Global Escape key listener for Return Modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedItem && !submittingReturn) {
        closeReturnModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItem, submittingReturn, closeReturnModal]);

  // Handle Search Invoice
  const handleSearch = async (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    const cleanQuery = (customQuery !== undefined ? customQuery : invoiceQuery).trim();
    if (!cleanQuery) {
      setStatus({ type: 'error', msg: 'Please enter an invoice number to search.' });
      return;
    }

    setSearching(true);
    setStatus(null);
    try {
      const res = await lookupInvoiceAction(cleanQuery);
      if (res.success && res.data) {
        setInvoice(res.data);
      } else {
        setInvoice(null);
        setStatus({ type: 'error', msg: res.error || 'Invoice not found.' });
      }
    } catch (err: unknown) {
      setStatus({ 
        type: 'error', 
        msg: err instanceof Error ? err.message : 'Failed to search invoice.' 
      });
    } finally {
      setSearching(false);
    }
  };

  const isFullyReturned = useMemo(() => {
    if (!invoice || !invoice.invoice_items || invoice.invoice_items.length === 0) return false;
    return invoice.invoice_items.every((item) => {
      const totalReturned = (item.returns || []).reduce((sum: number, r) => sum + Number(r.quantity || 0), 0);
      return totalReturned >= Number(item.quantity || 0);
    });
  }, [invoice]);

  // Open Return Modal with calculated boundary limits
  const openReturnModal = (item: InvoiceItemWithReturns) => {
    if (invoice?.is_voided) return;

    const alreadyReturnedTotal = item.returns?.reduce((sum, r) => sum + r.quantity, 0) || 0;
    const remainingPieces = item.quantity - alreadyReturnedTotal;

    if (remainingPieces <= 0) {
      setStatus({ type: 'error', msg: 'All units for this line item have already been returned.' });
      return;
    }

    const piecesPerSet = item.variants?.products?.pieces_per_set || 1;
    const alreadyReturnedSets = item.returns?.reduce((sum, r) => sum + (r.sets_quantity || 0), 0) || 0;
    const itemSets = item.sets_quantity || 0;
    const maxAvailableSets = Math.max(0, itemSets - alreadyReturnedSets);
    const maxSets = Math.min(maxAvailableSets, Math.floor(remainingPieces / piecesPerSet));

    setSelectedItem(item);
    if (maxSets > 0) {
      setReturnSets(1);
      setReturnLoose(0);
    } else {
      setReturnSets(0);
      setReturnLoose(1);
    }
    const isCustomerActive = Boolean(invoice?.customer_id && invoice?.customers?.is_active !== false);
    setRefundMethod(isCustomerActive ? 'STORE_CREDIT' : 'CASH');
    setReturnType('RESTOCK');
    setNotes('');
    setModalError(null);
  };

  // Process Return Action
  const handleConfirmReturn = async () => {
    if (isProcessingRef.current || submittingReturn || !selectedItem || !invoice) return;

    const piecesPerSet = selectedItem.variants?.products?.pieces_per_set || 1;
    const alreadyReturnedTotal = selectedItem.returns?.reduce((sum, r) => sum + r.quantity, 0) || 0;
    const remainingPieces = selectedItem.quantity - alreadyReturnedTotal;

    const totalReturnPieces = (returnSets * piecesPerSet) + returnLoose;

    if (totalReturnPieces <= 0) {
      setModalError('Return quantity must be at least 1 piece.');
      return;
    }

    if (totalReturnPieces > remainingPieces) {
      setModalError(`Cannot return ${totalReturnPieces} pieces. Only ${remainingPieces} piece(s) remaining on this invoice.`);
      return;
    }

    const alreadyReturnedSets = selectedItem.returns?.reduce((sum, r) => sum + (r.sets_quantity || 0), 0) || 0;
    const maxAvailableSets = (selectedItem.sets_quantity || 0) - alreadyReturnedSets;
    if (returnSets > maxAvailableSets) {
      setModalError(`Cannot return ${returnSets} sets. Maximum returnable sets is ${maxAvailableSets}.`);
      return;
    }

    try {
      isProcessingRef.current = true;
      setSubmittingReturn(true);
      setModalError(null);

      const res = await processReturnAction({
        invoice_item_id: selectedItem.id,
        sets_quantity: returnSets,
        loose_quantity: returnLoose,
        refund_method: refundMethod,
        return_type: returnType,
        notes: notes.trim() ? notes.trim() : null
      });

      if (!res.success) {
        setModalError(res.error || 'Failed to process return.');
      } else {
        const cashRefund = res.data?.cash_refunded !== undefined ? res.data.cash_refunded : res.data?.refund_amount;
        const totalRefund = res.data?.refund_amount || 0;
        
        let message = `Successfully processed return of ${totalReturnPieces} pcs (${returnSets} sets, ${returnLoose} loose) for "${selectedItem.variants.name}".`;
        if (cashRefund && cashRefund > 0) {
          message += ` Refunded ${formatINR(cashRefund)} via ${refundMethod}.`;
        }
        if (totalRefund > (cashRefund || 0)) {
          message += ` (Remaining ${formatINR(totalRefund - (cashRefund || 0))} adjusted against unpaid credit balance).`;
        }

        setStatus({
          type: 'success',
          msg: message
        });

        closeReturnModal();

        // Refresh current invoice and returns ledger
        await handleSearch(undefined, invoice.invoice_number);
        await loadLedger();
      }
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Unexpected error processing return.');
    } finally {
      isProcessingRef.current = false;
      setSubmittingReturn(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-primary flex items-center gap-2.5">
            <RotateCcw className="w-6 h-6 text-accent" />
            Customer Returns
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            Lookup sales invoices, refund payments accurately, and manage restock or damaged scrap inventory.
          </p>
        </div>
        <button
          onClick={loadLedger}
          disabled={loadingLedger}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-surface border border-border text-ink-primary rounded-xl shadow-2xs hover:bg-row-alt transition text-xs font-bold disabled:opacity-50 min-h-[38px] cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingLedger ? 'animate-spin' : ''}`} />
          <span>Refresh History</span>
        </button>
      </div>

      {/* Global Status Banner */}
      {status && (
        <div
          className={`p-3.5 rounded-2xl flex items-center justify-between border shadow-2xs animate-in fade-in duration-150 ${
            status.type === 'error'
              ? 'bg-red-50 text-red-800 border-red-200'
              : 'bg-emerald-50 text-emerald-900 border-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2.5 text-xs font-semibold">
            {status.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            )}
            <span>{status.msg}</span>
          </div>
          <button onClick={() => setStatus(null)} className="text-ink-muted hover:text-ink-primary p-1 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search Input Section */}
      <div className="bg-surface p-4 sm:p-5 rounded-2xl border border-border shadow-xs">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={invoiceQuery}
              onChange={(e) => setInvoiceQuery(e.target.value)}
              placeholder="Search Invoice Number (e.g. MELBUN/2026/A1B2C3)..."
              className="w-full pl-10 pr-20 py-2.5 bg-surface text-xs sm:text-sm border border-border rounded-xl focus:ring-2 focus:ring-accent focus:outline-none font-mono text-ink-primary shadow-2xs"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {invoiceQuery && (
                <button
                  type="button"
                  onClick={() => setInvoiceQuery('')}
                  className="p-1 text-ink-muted hover:text-ink-primary rounded-md cursor-pointer"
                  title="Clear"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsCameraOpen(true)}
                className="p-1.5 text-accent hover:bg-accent/10 rounded-lg transition cursor-pointer"
                title="Scan Receipt Barcode"
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 transition flex items-center justify-center gap-2 min-h-[40px] cursor-pointer"
          >
            {searching ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Searching...</span>
              </>
            ) : (
              <span>Lookup Invoice</span>
            )}
          </button>
        </form>
      </div>

      {/* Invoice Details & Returnable Items Section */}
      {invoice && (
        <div className="bg-surface rounded-2xl border border-border shadow-xs overflow-hidden space-y-5 p-4 sm:p-6">
          {/* Invoice Summary Header Card */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-5 border-b border-border">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <Receipt className="w-5 h-5 text-accent shrink-0" />
                <Link 
                  href={`/invoices/${invoice.id}`}
                  className="text-base sm:text-lg font-bold text-ink-primary font-mono hover:text-accent flex items-center gap-1 group"
                >
                  <span>{invoice.invoice_number}</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition text-accent" />
                </Link>

                {invoice.is_voided ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-red-50 text-red-700 border border-red-200">
                    <Ban className="w-3 h-3" /> VOIDED
                  </span>
                ) : isFullyReturned ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                    FULLY RETURNED
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    ACTIVE SALE
                  </span>
                )}
              </div>

              <p className="text-xs text-ink-muted flex items-center gap-1.5 font-mono">
                <Clock className="w-3.5 h-3.5" />
                Billed on {new Date(invoice.created_at).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                })}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 bg-row-alt/60 px-3.5 py-2 rounded-xl border border-border text-xs w-full md:w-auto justify-between md:justify-end">
              <div className="flex items-center gap-1.5 text-ink-primary">
                <User className="w-3.5 h-3.5 text-ink-muted" />
                <span>
                  <strong className="font-bold">
                    {invoice.customers?.name || 'Walk-in Customer'}
                  </strong>
                  {invoice.customers?.phone && ` (${invoice.customers.phone})`}
                </span>
              </div>
              <div className="hidden sm:block border-l border-border h-4" />
              <div>
                <span className="text-[11px] text-ink-muted uppercase">Final Total: </span>
                <span className="font-bold font-mono text-ink-primary text-sm">
                  {formatINR(Number(invoice.final_total))}
                </span>
              </div>
            </div>
          </div>

          {/* Voided Warning Notice */}
          {invoice.is_voided && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex items-center gap-2.5 text-red-800 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>
                This invoice is marked as VOIDED. Returns cannot be processed on voided transactions.
              </span>
            </div>
          )}

          {/* Mobile Line Items View (< 640px) */}
          <div className="block sm:hidden space-y-3">
            {invoice.invoice_items.map((item) => {
              const alreadyReturned = item.returns?.reduce((sum, r) => sum + r.quantity, 0) || 0;
              const returnableQty = item.quantity - alreadyReturned;
              const isItemFullyReturned = returnableQty <= 0;

              return (
                <div key={item.id} className="p-3.5 bg-row-alt/30 border border-border rounded-xl space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <p className="font-bold text-xs text-ink-primary">{item.variants.name}</p>
                      <p className="text-[11px] font-mono text-ink-muted">{item.variants.barcode}</p>
                    </div>
                    <span className="font-bold font-mono text-xs text-ink-primary">
                      {formatINR(Number(item.selling_price_snapshot))}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 text-center text-[11px] bg-surface p-2 rounded-lg border border-border">
                    <div>
                      <span className="text-ink-muted block text-[10px]">Sold</span>
                      <span className="font-bold font-mono text-ink-primary">{item.quantity} pcs</span>
                    </div>
                    <div>
                      <span className="text-ink-muted block text-[10px]">Returned</span>
                      <span className={`font-bold font-mono ${alreadyReturned > 0 ? 'text-amber-700' : 'text-ink-muted'}`}>
                        {alreadyReturned} pcs
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-muted block text-[10px]">Returnable</span>
                      <span className={`font-bold font-mono ${isItemFullyReturned ? 'text-ink-muted' : 'text-emerald-700'}`}>
                        {returnableQty} pcs
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    {invoice.is_voided ? (
                      <span className="text-xs text-ink-muted italic">Invoice Voided</span>
                    ) : isItemFullyReturned ? (
                      <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-row-alt text-ink-muted border border-border">
                        Fully Returned
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openReturnModal(item)}
                        className="w-full py-2 text-xs font-bold text-white bg-accent hover:bg-accent-hover rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 min-h-[38px] cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Return Item</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Line Items Table (>= 640px) */}
          <div className="hidden sm:block overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-row-alt border-b border-border text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                  <th className="py-3 px-4">Item & Barcode</th>
                  <th className="py-3 px-4 text-right">Selling Price</th>
                  <th className="py-3 px-4 text-center">Sold Qty</th>
                  <th className="py-3 px-4 text-center">Returned Qty</th>
                  <th className="py-3 px-4 text-center">Returnable</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {invoice.invoice_items.map((item) => {
                  const alreadyReturned = item.returns?.reduce((sum, r) => sum + r.quantity, 0) || 0;
                  const returnableQty = item.quantity - alreadyReturned;
                  const isItemFullyReturned = returnableQty <= 0;

                  return (
                    <tr key={item.id} className="hover:bg-row-alt/50 transition-colors">
                      <td className="py-3.5 px-4">
                        <p className="font-bold text-ink-primary">{item.variants.name}</p>
                        <p className="text-[11px] font-mono text-ink-muted">{item.variants.barcode}</p>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-ink-primary">
                        {formatINR(Number(item.selling_price_snapshot))}
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold font-mono text-ink-primary">
                        {item.quantity} pcs
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {alreadyReturned > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold font-mono bg-amber-50 text-amber-800 border border-amber-200">
                            {alreadyReturned} pcs
                          </span>
                        ) : (
                          <span className="text-ink-muted text-xs font-mono">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold font-mono">
                        {isItemFullyReturned ? (
                          <span className="text-xs text-ink-muted">0 pcs</span>
                        ) : (
                          <span className="text-emerald-700">{returnableQty} pcs</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {invoice.is_voided ? (
                          <span className="text-xs text-ink-muted italic">Invoice Voided</span>
                        ) : isItemFullyReturned ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold bg-row-alt text-ink-muted border border-border">
                            Fully Returned
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openReturnModal(item)}
                            className="px-3.5 py-1.5 text-xs font-bold text-white bg-accent hover:bg-accent-hover rounded-xl shadow-xs transition cursor-pointer"
                          >
                            Return Item
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Returns Audit Ledger */}
      <div className="bg-surface rounded-2xl border border-border shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-border flex justify-between items-center bg-row-alt/30">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-ink-primary">Recent Returns Activity</h2>
            <p className="text-[11px] text-ink-muted">Last 25 return transactions processed</p>
          </div>
          <span className="text-xs font-mono text-ink-muted">{recentReturns.length} records</span>
        </div>

        {/* Mobile Ledger Stack (< 640px) */}
        <div className="block sm:hidden divide-y divide-border">
          {loadingLedger ? (
            <div className="p-8 flex justify-center items-center">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
            </div>
          ) : recentReturns.length === 0 ? (
            <div className="p-8 text-center text-xs text-ink-muted">No returns logged yet.</div>
          ) : (
            recentReturns.map((r) => {
              const invoiceId = r.invoices?.id || r.invoice_id;
              const invNum = r.invoices?.invoice_number || 'Invoice';
              const varName = r.variants?.name || 'Product';
              return (
                <div key={r.id} className="p-4 space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      {invoiceId ? (
                        <Link 
                          href={`/invoices/${invoiceId}`} 
                          className="font-bold text-xs font-mono text-ink-primary hover:text-accent flex items-center gap-1"
                        >
                          <span>{invNum}</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      ) : (
                        <span className="font-bold text-xs font-mono text-ink-primary">{invNum}</span>
                      )}
                      <p className="text-[11px] text-ink-muted">{varName}</p>
                    </div>
                    <span className="font-bold font-mono text-xs text-red-600">
                      -{formatINR(r.total_refund_amount)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[11px] text-ink-muted">
                    <span>{r.quantity} pcs ({r.return_type === 'RESTOCK' ? 'Restocked' : 'Damaged'})</span>
                    <span className="px-2 py-0.5 rounded-md bg-row-alt font-mono font-bold text-ink-primary border border-border text-[10px]">
                      {r.refund_method}
                    </span>
                  </div>

                  <div className="text-[10px] text-ink-muted font-mono pt-1 border-t border-border flex justify-between">
                    <span>{new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    <span>Customer: {r.customers?.name || 'Walk-in'}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Ledger Table (>= 640px) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-row-alt text-[11px] font-bold uppercase tracking-wider text-ink-muted border-b border-border">
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Product Variant</th>
                <th className="py-3 px-4 text-center">Returned Qty</th>
                <th className="py-3 px-4 text-right">Refund Amount</th>
                <th className="py-3 px-4 text-center">Method</th>
                <th className="py-3 px-4 text-center">Condition</th>
                <th className="py-3 px-4">Customer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs">
              {loadingLedger ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-ink-muted">
                    <Loader2 className="w-5 h-5 text-accent animate-spin mx-auto" />
                  </td>
                </tr>
              ) : recentReturns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-ink-muted">
                    No returns logged yet.
                  </td>
                </tr>
              ) : (
                recentReturns.map((r) => {
                  const invoiceId = r.invoices?.id || r.invoice_id;
                  const invNum = r.invoices?.invoice_number || 'Invoice';
                  const varName = r.variants?.name || 'Product';
                  return (
                    <tr key={r.id} className="hover:bg-row-alt/50 transition">
                      <td className="py-3 px-4 font-mono text-ink-muted">
                        {new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold">
                        {invoiceId ? (
                          <Link 
                            href={`/invoices/${invoiceId}`}
                            className="text-ink-primary hover:text-accent flex items-center gap-1 group"
                          >
                            <span>{invNum}</span>
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" />
                          </Link>
                        ) : (
                          <span>{invNum}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-medium text-ink-primary">{varName}</td>
                      <td className="py-3 px-4 text-center font-mono font-bold">{r.quantity} pcs</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-red-600">
                        -{formatINR(r.total_refund_amount)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-row-alt text-ink-primary border border-border">
                          {r.refund_method}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                          r.return_type === 'RESTOCK'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}>
                          {r.return_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-ink-muted">{r.customers?.name || 'Walk-in'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Return Action Confirmation Modal with z-[200] */}
      {selectedItem && invoice && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !submittingReturn) closeReturnModal(); }}
        >
          <div 
            className="bg-surface rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-border space-y-4 animate-in zoom-in-95 duration-150 cursor-default"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-start pb-2 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-red-50 text-accent rounded-xl border border-red-100">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink-primary">Process Item Return</h3>
                  <p className="text-xs text-ink-muted">
                    {selectedItem.variants.name} ({selectedItem.variants.barcode})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeReturnModal}
                disabled={submittingReturn}
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {/* Quantity Selector Section */}
            {(() => {
              const piecesPerSet = selectedItem.variants?.products?.pieces_per_set || 1;
              const alreadyReturnedTotal = selectedItem.returns?.reduce((sum, r) => sum + r.quantity, 0) || 0;
              const remainingPieces = selectedItem.quantity - alreadyReturnedTotal;

              const alreadyReturnedSets = selectedItem.returns?.reduce((sum, r) => sum + (r.sets_quantity || 0), 0) || 0;
              const maxAvailableSets = (selectedItem.sets_quantity || 0) - alreadyReturnedSets;
              const maxSets = Math.min(maxAvailableSets, Math.floor(remainingPieces / piecesPerSet));

              const totalSelectedPieces = (returnSets * piecesPerSet) + returnLoose;

              // Prorated refund computation
              const effectiveRatio = invoice.subtotal > 0 ? (Number(invoice.final_total) / Number(invoice.subtotal)) : 1;
              const effectiveUnitRefundPrice = Number(selectedItem.selling_price_snapshot) * effectiveRatio;
              const estimatedRefundAmount = totalSelectedPieces * effectiveUnitRefundPrice;

              return (
                <div className="space-y-4">
                  {/* Dual-Unit Selection */}
                  <div className="grid grid-cols-2 gap-3 bg-row-alt/40 p-3.5 rounded-xl border border-border">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs font-bold text-ink-primary">Packaged Sets</label>
                        <span className="text-[10px] text-ink-muted">Max {maxSets}</span>
                      </div>
                      <input
                        type="number"
                        min="0"
                        max={maxSets}
                        value={returnSets}
                        onChange={(e) => {
                          const val = Math.max(0, Math.min(maxSets, parseInt(e.target.value) || 0));
                          setReturnSets(val);
                          const remainingForLoose = remainingPieces - (val * piecesPerSet);
                          if (returnLoose > remainingForLoose) {
                            setReturnLoose(Math.max(0, remainingForLoose));
                          }
                        }}
                        className="w-full p-2 text-xs font-mono font-bold border border-border rounded-lg bg-surface text-ink-primary focus:ring-1 focus:ring-accent"
                      />
                      <span className="text-[10px] text-ink-muted mt-1 block">({piecesPerSet} pcs/set)</span>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs font-bold text-ink-primary">Loose Pieces</label>
                        <span className="text-[10px] text-ink-muted">
                          Max {remainingPieces - (returnSets * piecesPerSet)}
                        </span>
                      </div>
                      <input
                        type="number"
                        min="0"
                        max={remainingPieces - (returnSets * piecesPerSet)}
                        value={returnLoose}
                        onChange={(e) => {
                          const maxLoose = remainingPieces - (returnSets * piecesPerSet);
                          const val = Math.max(0, Math.min(maxLoose, parseInt(e.target.value) || 0));
                          setReturnLoose(val);
                        }}
                        className="w-full p-2 text-xs font-mono font-bold border border-border rounded-lg bg-surface text-ink-primary focus:ring-1 focus:ring-accent"
                      />
                      <span className="text-[10px] text-ink-muted mt-1 block">Individual pieces</span>
                    </div>
                  </div>

                  {/* Return Summary Pill */}
                  <div className="p-3 bg-emerald-50/60 border border-emerald-200/80 rounded-xl flex justify-between items-center">
                    <div>
                      <span className="text-[11px] font-bold text-emerald-900 block">Total Returning</span>
                      <span className="text-xs font-mono font-bold text-emerald-800">
                        {totalSelectedPieces} piece{totalSelectedPieces !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] font-bold text-emerald-900 block">Estimated Refund</span>
                      <span className="text-sm font-mono font-bold text-emerald-700">
                        {formatINR(estimatedRefundAmount)}
                      </span>
                    </div>
                  </div>

                  {/* Refund Method Selection */}
                  <div>
                    <label className="block text-xs font-bold text-ink-primary mb-1.5">Refund Payment Method</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        disabled={!invoice.customer_id || invoice.customers?.is_active === false}
                        onClick={() => setRefundMethod('STORE_CREDIT')}
                        className={`py-2 px-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          refundMethod === 'STORE_CREDIT'
                            ? 'bg-emerald-50 border-emerald-600 text-emerald-900 shadow-xs'
                            : 'border-border bg-surface hover:bg-row-alt text-ink-primary'
                        }`}
                      >
                        <Wallet className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Store Credit</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setRefundMethod('CASH')}
                        className={`py-2 px-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition cursor-pointer ${
                          refundMethod === 'CASH'
                            ? 'bg-accent border-accent text-white shadow-xs'
                            : 'border-border bg-surface hover:bg-row-alt text-ink-primary'
                        }`}
                      >
                        <IndianRupee className="w-3.5 h-3.5" />
                        <span>Cash</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setRefundMethod('UPI')}
                        className={`py-2 px-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition cursor-pointer ${
                          refundMethod === 'UPI'
                            ? 'bg-accent border-accent text-white shadow-xs'
                            : 'border-border bg-surface hover:bg-row-alt text-ink-primary'
                        }`}
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>UPI / Online</span>
                      </button>
                    </div>
                    {!invoice.customer_id && (
                      <p className="text-[10px] text-ink-muted mt-1">
                        * Store credit is only available for registered customer accounts.
                      </p>
                    )}
                  </div>

                  {/* Inventory Condition Selection */}
                  <div>
                    <label className="block text-xs font-bold text-ink-primary mb-1.5">Inventory Disposition</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setReturnType('RESTOCK')}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                          returnType === 'RESTOCK'
                            ? 'bg-emerald-50 border-emerald-600 text-emerald-900 shadow-xs'
                            : 'border-border bg-surface hover:bg-row-alt text-ink-primary'
                        }`}
                      >
                        <ArchiveRestore className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Restock to Inventory</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setReturnType('DAMAGED')}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                          returnType === 'DAMAGED'
                            ? 'bg-red-50 border-red-600 text-red-900 shadow-xs'
                            : 'border-border bg-surface hover:bg-row-alt text-ink-primary'
                        }`}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-600" />
                        <span>Mark as Damaged / Scrap</span>
                      </button>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-bold text-ink-primary mb-1">Reason / Notes</label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Size exchange, defective stitching, customer preference..."
                      className="w-full p-2.5 text-xs bg-surface border border-border rounded-xl focus:ring-1 focus:ring-accent focus:outline-none text-ink-primary"
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex justify-end gap-2.5 pt-2 border-t border-border">
                    <button
                      type="button"
                      onClick={closeReturnModal}
                      disabled={submittingReturn}
                      className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmReturn}
                      disabled={submittingReturn || totalSelectedPieces <= 0}
                      className="px-5 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 transition flex items-center gap-1.5 cursor-pointer"
                    >
                      {submittingReturn && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Confirm Return ({totalSelectedPieces} pcs)</span>
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Camera Barcode Scanner Modal */}
      {isCameraOpen && (
        <CameraScanner 
          onScan={(code) => {
            setIsCameraOpen(false);
            setInvoiceQuery(code);
            handleSearch(undefined, code);
          }}
          onClose={() => setIsCameraOpen(false)}
        />
      )}
    </div>
  );
}
