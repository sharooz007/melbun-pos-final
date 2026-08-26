'use client'

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Banknote, 
  Smartphone, 
  CreditCard, 
  Trash2, 
  RefreshCw, 
  X, 
  Clock, 
  User, 
  FileText,
  ShieldCheck,
  Ban,
  Wallet
} from 'lucide-react';

const formatINR = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2
  }).format(amount);
};

export default function ReturnsPage() {
  // State: Search & Active Invoice
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceLookupData | null>(null);

  // State: Return Modal Form
  const [selectedItem, setSelectedItem] = useState<InvoiceItemWithReturns | null>(null);
  const [refundMethod, setRefundMethod] = useState<RefundPaymentMethod>('CASH');
  const [returnType, setReturnType] = useState<ReturnType>('RESTOCK');
  const [notes, setNotes] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [submittingReturn, setSubmittingReturn] = useState(false);

  // State: Global Status & Ledger
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [recentReturns, setRecentReturns] = useState<RecentReturnAuditItem[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  // Synchronous lock to prevent concurrent double-click race conditions
  const isProcessingRef = useRef(false);

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

  // Handle Search Invoice
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanQuery = invoiceQuery.trim();
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

  const [returnSets, setReturnSets] = useState<number>(0);
  const [returnLoose, setReturnLoose] = useState<number>(0);

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

  const closeReturnModal = () => {
    if (submittingReturn) return;
    setSelectedItem(null);
    setReturnSets(0);
    setReturnLoose(0);
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
        await handleSearch();
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
    <div className="p-4 pb-28 md:p-8 space-y-8 max-w-7xl w-full mx-auto">
      {/* Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <RotateCcw className="w-8 h-8 text-accent" />
            Process Customer Returns
          </h1>
          <p className="text-gray-500 mt-1">
            Lookup original sales invoices, refund payments accurately, and manage restock/scrap inventory.
          </p>
        </div>
        <button
          onClick={loadLedger}
          disabled={loadingLedger}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl shadow-xs hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loadingLedger ? 'animate-spin' : ''}`} />
          Refresh History
        </button>
      </header>

      {/* Global Status Banner */}
      {status && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between border ${
            status.type === 'error'
              ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-green-50 text-green-700 border-green-200'
          }`}
        >
          <div className="flex items-center gap-3">
            {status.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            )}
            <span className="font-medium text-sm">{status.msg}</span>
          </div>
          <button onClick={() => setStatus(null)} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search Input Section */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-5 h-5 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={invoiceQuery}
              onChange={(e) => setInvoiceQuery(e.target.value)}
              placeholder="Enter Invoice Number (e.g. MELBUN/26-27/0001 or INV-1001)..."
              className="w-full pl-11 pr-4 py-3 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-accent focus:outline-hidden font-mono"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-6 py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl shadow-xs disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {searching ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Searching...
              </>
            ) : (
              'Lookup Invoice'
            )}
          </button>
        </form>
      </div>

      {/* Invoice Details Section */}
      {invoice && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden space-y-6 p-6">
          {/* Invoice Summary Card */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-gray-100">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Receipt className="w-6 h-6 text-accent" />
                <h2 className="text-xl font-bold text-gray-900 font-mono">
                  {invoice.invoice_number}
                </h2>
                {invoice.is_voided ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">
                    <Ban className="w-3.5 h-3.5" /> VOIDED INVOICE
                  </span>
                ) : isFullyReturned ? (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                    FULLY RETURNED
                  </span>
                ) : (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                    VALID SALE
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" />
                Billed on {new Date(invoice.created_at).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                })}
              </p>
            </div>

            <div className="flex items-center gap-6 bg-gray-50 px-4 py-2.5 rounded-xl border border-gray-200 text-sm">
              <div className="flex items-center gap-2 text-gray-700">
                <User className="w-4 h-4 text-gray-400" />
                <span>
                  <strong className="font-semibold text-gray-900">
                    {invoice.customers?.name || 'Walk-in Customer'}
                  </strong>
                  {invoice.customers?.phone && ` (${invoice.customers.phone})`}
                </span>
              </div>
              <div className="border-l border-gray-300 h-6" />
              <div>
                <span className="text-xs text-gray-500 uppercase">Final Total: </span>
                <span className="font-bold font-mono text-gray-900">
                  {formatINR(Number(invoice.final_total))}
                </span>
              </div>
            </div>
          </div>

          {/* Voided Warning Notice */}
          {invoice.is_voided && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-800 text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-600" />
              <span>
                <strong>Warning:</strong> This invoice was marked as VOIDED. Returns cannot be processed on voided transactions.
              </span>
            </div>
          )}

          {/* Line Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="py-3 px-4">Item & Barcode</th>
                  <th className="py-3 px-4 text-right">Selling Price</th>
                  <th className="py-3 px-4 text-center">Sold Qty</th>
                  <th className="py-3 px-4 text-center">Returned Qty</th>
                  <th className="py-3 px-4 text-center">Returnable</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {invoice.invoice_items.map((item) => {
                  const alreadyReturned = item.returns?.reduce((sum, r) => sum + r.quantity, 0) || 0;
                  const returnableQty = item.quantity - alreadyReturned;
                  const isFullyReturned = returnableQty <= 0;

                  return (
                    <tr key={item.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-gray-900">{item.variants.name}</p>
                        <p className="text-xs font-mono text-gray-400">{item.variants.barcode}</p>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-medium text-gray-900">
                        {formatINR(Number(item.selling_price_snapshot))}
                      </td>
                      <td className="py-3.5 px-4 text-center font-semibold text-gray-700">
                        {item.quantity} pcs
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {alreadyReturned > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            {alreadyReturned} pcs
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold font-mono">
                        {isFullyReturned ? (
                          <span className="text-xs text-gray-400">0 pcs</span>
                        ) : (
                          <span className="text-emerald-700">{returnableQty} pcs</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {invoice.is_voided ? (
                          <span className="text-xs text-gray-400 italic">Invoice Voided</span>
                        ) : isFullyReturned ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-500">
                            Fully Returned
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openReturnModal(item)}
                            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent-hover rounded-lg shadow-xs transition-colors"
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

      {/* Return Action Confirmation Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-5 animate-in fade-in zoom-in duration-150">
            {/* Modal Header */}
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-red-100 text-accent rounded-xl">
                  <RotateCcw className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Process Item Return</h3>
                  <p className="text-xs text-gray-500 font-medium">
                    {selectedItem.variants.name} ({selectedItem.variants.barcode})
                  </p>
                </div>
              </div>
              <button
                onClick={closeReturnModal}
                disabled={submittingReturn}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Message */}
            {modalError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {/* Return Details Form */}
            <div className="space-y-4 text-sm">
              {/* Quantity Selector with Max Limit */}
              {(() => {
                const piecesPerSet = selectedItem.variants?.products?.pieces_per_set || 1;
                const alreadyReturnedTotal = selectedItem.returns?.reduce((sum, r) => sum + r.quantity, 0) || 0;
                const remainingPieces = selectedItem.quantity - alreadyReturnedTotal;
                
                const alreadyReturnedSets = selectedItem.returns?.reduce((sum, r) => sum + (r.sets_quantity || 0), 0) || 0;
                const maxAvailableSets = Math.max(0, (selectedItem.sets_quantity || 0) - alreadyReturnedSets);
                const maxReturnableSets = Math.min(maxAvailableSets, Math.floor(remainingPieces / piecesPerSet));
                
                const totalPiecesToReturn = (returnSets * piecesPerSet) + returnLoose;
                const effectiveRatio = (invoice && invoice.subtotal > 0 && invoice.final_total > 0)
                  ? Number(invoice.final_total) / Number(invoice.subtotal)
                  : 0;
                const priorItemRefunds = selectedItem.returns?.reduce((sum, r) => sum + (Number(r.total_refund_amount) || 0), 0) || 0;
                const itemMaxRefundable = Number((selectedItem.selling_price_snapshot * selectedItem.quantity * effectiveRatio).toFixed(2));
                const remainingLineRefundable = Math.max(0, Number((itemMaxRefundable - priorItemRefunds).toFixed(2)));

                const rawRefund = Number((selectedItem.selling_price_snapshot * totalPiecesToReturn * effectiveRatio).toFixed(2));
                const estimatedRefund = totalPiecesToReturn >= remainingPieces 
                  ? remainingLineRefundable 
                  : Math.min(remainingLineRefundable, rawRefund);

                return (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                        Quantity to Return <span className="text-red-500">*</span>
                      </label>
                      <span className="text-xs text-gray-500">
                        Available: <strong className="text-gray-900">{remainingPieces} pcs</strong>
                        {piecesPerSet > 1 && ` (${maxReturnableSets} sets max)`}
                      </span>
                    </div>

                    {piecesPerSet > 1 ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-gray-500 mb-1">Sets ({piecesPerSet} pcs/set)</label>
                          <input
                            type="number"
                            min={0}
                            max={maxReturnableSets}
                            disabled={maxReturnableSets === 0}
                            value={returnSets}
                            onChange={(e) => {
                              const newSets = Math.min(maxReturnableSets, Math.max(0, parseInt(e.target.value || '0', 10)));
                              setReturnSets(newSets);
                              const maxAllowedLoose = Math.max(0, remainingPieces - (newSets * piecesPerSet));
                              if (returnLoose > maxAllowedLoose) {
                                setReturnLoose(maxAllowedLoose);
                              }
                            }}
                            className="w-full text-sm p-2.5 border border-gray-300 rounded-xl font-mono font-medium focus:ring-2 focus:ring-accent focus:outline-hidden disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-gray-500 mb-1">Loose Pieces</label>
                          <input
                            type="number"
                            min={0}
                            max={remainingPieces - (returnSets * piecesPerSet)}
                            value={returnLoose}
                            onChange={(e) => {
                              const maxAllowedLoose = Math.max(0, remainingPieces - (returnSets * piecesPerSet));
                              setReturnLoose(Math.min(maxAllowedLoose, Math.max(0, parseInt(e.target.value || '0', 10))));
                            }}
                            className="w-full text-sm p-2.5 border border-gray-300 rounded-xl font-mono font-medium focus:ring-2 focus:ring-accent focus:outline-hidden"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min={1}
                          max={remainingPieces}
                          value={returnLoose}
                          onChange={(e) => setReturnLoose(Math.min(remainingPieces, Math.max(0, parseInt(e.target.value || '0', 10))))}
                          className="w-full text-sm p-2.5 border border-gray-300 rounded-xl font-mono font-medium focus:ring-2 focus:ring-accent focus:outline-hidden"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setReturnSets(0);
                            setReturnLoose(remainingPieces);
                          }}
                          className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl whitespace-nowrap transition-colors"
                        >
                          Return All ({remainingPieces})
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Unpaid Debt Warning Callout (RET-04) */}
              {invoice && Number(invoice.due_amount || 0) > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                  <span className="text-amber-600 font-bold text-sm">ℹ️</span>
                  <div>
                    <span className="font-bold">Invoice has unpaid balance of ₹{Number(invoice.due_amount).toFixed(2)}.</span>
                    <p className="mt-0.5 text-amber-800">
                      Processing this return will adjust the customer&apos;s open credit debt downward before issuing store credit or cash payout.
                    </p>
                  </div>
                </div>
              )}

              {/* Refund Method Selector */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                    Refund Payout Method <span className="text-red-500">*</span>
                  </label>
                  {!invoice?.customer_id ? (
                    <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      Store credit requires customer account
                    </span>
                  ) : invoice?.customers?.is_active === false ? (
                    <span className="text-[11px] font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                      Customer is inactive (reactivate in profile)
                    </span>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['STORE_CREDIT', 'CASH', 'UPI'] as RefundPaymentMethod[]).map((method) => {
                    const isCreditDisabled = method === 'STORE_CREDIT' && (!invoice?.customer_id || invoice?.customers?.is_active === false);
                    return (
                      <button
                        key={method}
                        type="button"
                        disabled={isCreditDisabled}
                        onClick={() => setRefundMethod(method)}
                        className={`py-2.5 px-3 text-xs font-bold rounded-xl border flex flex-col items-center gap-1 transition-colors ${
                          isCreditDisabled
                            ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed opacity-60'
                            : refundMethod === method
                            ? method === 'STORE_CREDIT'
                              ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                              : 'bg-accent text-white border-accent shadow-xs'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {method === 'STORE_CREDIT' && <Wallet className="w-4 h-4" />}
                        {method === 'CASH' && <Banknote className="w-4 h-4" />}
                        {method === 'UPI' && <Smartphone className="w-4 h-4" />}
                        {method === 'STORE_CREDIT' ? 'Store Credit' : method}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Return Condition / Stock Action */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                  Item Condition & Inventory Action <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setReturnType('RESTOCK')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-colors ${
                      returnType === 'RESTOCK'
                        ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <Package className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-gray-900">Restock to Inventory</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">Item is undamaged; increase sellable stock quantity.</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setReturnType('DAMAGED')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-colors ${
                      returnType === 'DAMAGED'
                        ? 'border-red-600 bg-red-50/50 ring-1 ring-red-600'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <Trash2 className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-gray-900">Damaged / Scrap</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">Defective unit; log scrap movement without restock.</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Notes / Reason */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-gray-500" />
                  Return Reason / Audit Note
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Size exchange requested, stitching defect reported by buyer..."
                  rows={2}
                  maxLength={500}
                  className="w-full text-sm p-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-accent focus:outline-hidden"
                />
              </div>

              {/* Financial Refund Summary Callout */}
              {(() => {
                const piecesPerSet = selectedItem.variants?.products?.pieces_per_set || 1;
                const alreadyReturnedTotal = selectedItem.returns?.reduce((sum, r) => sum + r.quantity, 0) || 0;
                const remainingPieces = selectedItem.quantity - alreadyReturnedTotal;
                const totalPiecesToReturn = (returnSets * piecesPerSet) + returnLoose;
                const effectiveRatio = (invoice && invoice.subtotal > 0 && invoice.final_total > 0)
                  ? Number(invoice.final_total) / Number(invoice.subtotal)
                  : 0;
                const priorItemRefunds = selectedItem.returns?.reduce((sum, r) => sum + (Number(r.total_refund_amount) || 0), 0) || 0;
                const itemMaxRefundable = Number((selectedItem.selling_price_snapshot * selectedItem.quantity * effectiveRatio).toFixed(2));
                const remainingLineRefundable = Math.max(0, Number((itemMaxRefundable - priorItemRefunds).toFixed(2)));

                const rawRefund = Number((selectedItem.selling_price_snapshot * totalPiecesToReturn * effectiveRatio).toFixed(2));
                const estimatedRefund = totalPiecesToReturn >= remainingPieces 
                  ? remainingLineRefundable 
                  : Math.min(remainingLineRefundable, rawRefund);

                return (
                  <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 flex justify-between items-center">
                    <div className="text-xs text-gray-600">
                      <span>Prorated Item Unit: </span>
                      <span className="font-mono font-semibold">{formatINR(selectedItem.selling_price_snapshot * effectiveRatio)}</span>
                      <span> × {totalPiecesToReturn} pcs</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-gray-500 block">Prorated Refund Amount</span>
                      <span className="text-lg font-bold font-mono text-accent">
                        {formatINR(estimatedRefund)}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeReturnModal}
                disabled={submittingReturn}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReturn}
                disabled={submittingReturn}
                className="px-5 py-2 text-sm font-semibold text-white bg-accent hover:bg-accent-hover rounded-lg shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {submittingReturn ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Processing Refund...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    Confirm Return
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Return Audit Ledger */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-accent" />
            <h2 className="text-base font-bold text-gray-900">Recent Returns & Refund Ledger</h2>
          </div>
          <span className="text-xs font-semibold text-gray-500">
            Audit history ({recentReturns.length} records)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="py-3.5 px-5">Date & Time</th>
                <th className="py-3.5 px-5">Invoice #</th>
                <th className="py-3.5 px-5">Item Name</th>
                <th className="py-3.5 px-5 text-center">Type</th>
                <th className="py-3.5 px-5 text-center">Method</th>
                <th className="py-3.5 px-5 text-right">Refund Amount</th>
                <th className="py-3.5 px-5">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {loadingLedger ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-300" />
                    Loading return records...
                  </td>
                </tr>
              ) : recentReturns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    No return records found in system.
                  </td>
                </tr>
              ) : (
                recentReturns.map((ret) => (
                  <tr key={ret.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="py-3.5 px-5 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(ret.created_at).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      })}
                    </td>
                    <td className="py-3.5 px-5 font-mono text-xs font-semibold text-gray-900">
                      {ret.invoices?.invoice_number || '—'}
                    </td>
                    <td className="py-3.5 px-5 text-gray-900 font-medium">
                      {ret.variants?.name} ({ret.quantity} pcs)
                    </td>
                    <td className="py-3.5 px-5 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
                        ret.return_type === 'RESTOCK'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}>
                        {ret.return_type}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700">
                        {ret.refund_method}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono font-bold text-accent">
                      {formatINR(Number(ret.total_refund_amount))}
                    </td>
                    <td className="py-3.5 px-5 text-xs text-gray-500 max-w-[200px] truncate" title={ret.notes || ''}>
                      {ret.notes || <span className="text-gray-300 italic">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
