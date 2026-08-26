'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Loader2, AlertTriangle, Pencil, Wallet, X, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  getCustomerDetailsAction, 
  getCustomerInvoicesAction, 
  payInvoiceAction, 
  getCustomerPaymentsAction, 
  getCustomerReturnsAction, 
  getCustomerCreditLedgerAction,
  updateCustomerAction,
  reactivateCustomerAction,
  deactivateCustomerAction
} from '@/lib/actions/customers';
import { voidInvoiceAction } from '@/lib/actions/invoices';
import { CreditLedgerEntry } from '@/types/customers';

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

export default function CustomerDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const isSubmittingRef = useRef(false);
  const [customer, setCustomer] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [creditLedger, setCreditLedger] = useState<CreditLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments' | 'returns' | 'credit'>('invoices');

  // Modals state
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'UPI' | 'STORE_CREDIT'>('CASH');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editGstin, setEditGstin] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editError, setEditError] = useState('');

  // Credit History Modal State
  const [isCreditHistoryModalOpen, setIsCreditHistoryModalOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [custRes, invRes, payRes, retRes, credRes] = await Promise.all([
        getCustomerDetailsAction(id),
        getCustomerInvoicesAction(id),
        getCustomerPaymentsAction(id),
        getCustomerReturnsAction(id),
        getCustomerCreditLedgerAction(id)
      ]);
      if (custRes.success) setCustomer(custRes.data);
      if (invRes.success) setInvoices(invRes.data || []);
      setPayments(Array.isArray(payRes) ? payRes : []);
      setReturns(Array.isArray(retRes) ? retRes : []);
      if (credRes.success) setCreditLedger(credRes.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const handleVoidClick = (inv: any) => {
    setSelectedInvoice(inv);
    setVoidReason('');
    setActionError('');
    setIsVoidModalOpen(true);
  };

  const submitVoid = async () => {
    if (!voidReason.trim()) return setActionError('Reason is required');
    if (isSubmittingRef.current || actionLoading) return;
    isSubmittingRef.current = true;
    setActionLoading(true);
    try {
      const res = await voidInvoiceAction({ invoice_id: selectedInvoice.id, reason: voidReason });
      if (res.success) {
        setIsVoidModalOpen(false);
        load();
      } else {
        setActionError(res.error || 'Failed to void invoice');
      }
    } finally {
      isSubmittingRef.current = false;
      setActionLoading(false);
    }
  };

  const handlePayClick = (inv: any) => {
    setSelectedInvoice(inv);
    const avail = Number(customer?.credit_balance || 0);
    const due = Number(inv.due_amount || 0);
    const defaultMethod = avail > 0 ? 'STORE_CREDIT' : 'CASH';
    setPayMethod(defaultMethod);
    const defaultAmt = defaultMethod === 'STORE_CREDIT' ? Math.min(due, avail) : due;
    setPayAmount(defaultAmt.toFixed(2));
    setActionError('');
    setIsPayModalOpen(true);
  };

  const handleSwitchPayMethod = (method: 'CASH' | 'UPI' | 'STORE_CREDIT') => {
    setPayMethod(method);
    if (!selectedInvoice) return;
    const due = Number(selectedInvoice.due_amount || 0);
    if (method === 'STORE_CREDIT') {
      const avail = Number(customer?.credit_balance || 0);
      setPayAmount(Math.min(due, avail).toFixed(2));
    } else {
      setPayAmount(due.toFixed(2));
    }
  };

  const submitPay = async () => {
    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) return setActionError('Invalid payment amount');
    if (amt > selectedInvoice.due_amount) return setActionError('Amount exceeds invoice due amount');
    
    if (payMethod === 'STORE_CREDIT') {
      const avail = Number(customer?.credit_balance || 0);
      if (amt > avail) {
        return setActionError(`Insufficient store credit wallet balance (Available: ₹${avail.toFixed(2)})`);
      }
    }

    if (isSubmittingRef.current || actionLoading) return;
    isSubmittingRef.current = true;
    setActionLoading(true);
    try {
      const res = await payInvoiceAction(selectedInvoice.id, customer.id, amt, payMethod);
      if (res.success) {
        setIsPayModalOpen(false);
        load();
      } else {
        setActionError(res.error || 'Payment failed');
      }
    } finally {
      isSubmittingRef.current = false;
      setActionLoading(false);
    }
  };

  const handleEditCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError('');
    if (!editName.trim()) {
      setEditError('Customer name is required');
      return;
    }
    if (isSubmittingRef.current || actionLoading) return;
    isSubmittingRef.current = true;
    setActionLoading(true);
    try {
      const res = await updateCustomerAction(id, editName.trim(), editPhone.trim(), editGstin.trim(), editAddress.trim());
      if (res.success) {
        setIsEditModalOpen(false);
        load();
      } else {
        setEditError(res.error || 'Failed to update customer');
      }
    } finally {
      isSubmittingRef.current = false;
      setActionLoading(false);
    }
  };

  const openEditModal = () => {
    setEditName(customer?.name || '');
    setEditPhone(customer?.phone || '');
    setEditGstin(customer?.gstin || '');
    setEditAddress(customer?.address || '');
    setEditError('');
    setIsEditModalOpen(true);
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-ink-muted">Customer not found</p>
        <Link href="/customers" className="text-accent font-bold text-sm">
          ← Back to Customers
        </Link>
      </div>
    );
  }

  const creditBalance = Number(customer.credit_balance || 0);

  return (
    <div className="p-3.5 pb-36 sm:p-6 sm:pb-36 md:p-8 md:pb-8 max-w-6xl w-full mx-auto space-y-6">
      <Link 
        href="/customers" 
        className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink-primary font-bold text-xs transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Customers Directory
      </Link>

      {/* Customer Header Info & Bento Cards */}
      <div className="bg-surface border border-border rounded-2xl p-4 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-ink-primary truncate">
                {customer.name}
              </h1>
              <button 
                onClick={openEditModal} 
                className="p-1.5 text-ink-muted hover:text-accent hover:bg-row-alt rounded-lg transition"
                title="Edit Customer Details"
              >
                <Pencil className="w-4 h-4" />
              </button>
              {customer.is_active === false && (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-100 text-red-800 border border-red-200 uppercase">
                  Inactive Account
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-ink-muted mt-1.5 flex-wrap">
              <span className="font-mono">{customer.phone || 'No phone number'}</span>
              <span>•</span>
              {customer.is_active !== false ? (
                <button
                  onClick={async () => {
                    const dues = Number(customer.pending_dues || 0);
                    const cred = Number(customer.credit_balance || 0);
                    if (dues > 0) {
                      alert(`Cannot deactivate customer with an outstanding balance of ₹${dues.toFixed(2)}. Settle dues first.`);
                      return;
                    }
                    if (cred > 0) {
                      alert(`Cannot deactivate customer with active store credit wallet of ₹${cred.toFixed(2)}. Utilize wallet first.`);
                      return;
                    }
                    if (!confirm(`Are you sure you want to deactivate customer "${customer.name}"?`)) return;
                    const res = await deactivateCustomerAction(customer.id);
                    if (res.success) {
                      setCustomer((prev: any) => ({ ...prev, is_active: false }));
                    } else {
                      alert('Failed to deactivate: ' + res.error);
                    }
                  }}
                  className="text-xs font-semibold text-red-600 hover:underline"
                >
                  Deactivate
                </button>
              ) : (
                <button
                  onClick={async () => {
                    const res = await reactivateCustomerAction(customer.id);
                    if (res.success) {
                      setCustomer((prev: any) => ({ ...prev, is_active: true }));
                    } else {
                      alert('Failed to reactivate: ' + res.error);
                    }
                  }}
                  className="text-xs font-bold text-emerald-700 hover:underline"
                >
                  Reactivate
                </button>
              )}
            </div>
          </div>

          <div className="text-left sm:text-right text-xs text-ink-muted space-y-1">
            {customer.gstin && <div className="font-mono font-bold text-accent">GSTIN: {customer.gstin}</div>}
            {customer.address && <div className="max-w-xs">{customer.address}</div>}
          </div>
        </div>

        {/* Financial Metrics Bento Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5 pt-2 border-t border-border">
          <div className="bg-row-alt/60 p-3 sm:p-4 rounded-xl border border-border">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block mb-1">Total Spend</span>
            <div className="text-base sm:text-xl font-extrabold text-ink-primary font-mono">{formatINR(customer.total_spend)}</div>
          </div>

          <div className="bg-row-alt/60 p-3 sm:p-4 rounded-xl border border-border">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block mb-1">Total Paid</span>
            <div className="text-base sm:text-xl font-extrabold text-emerald-700 font-mono">{formatINR(customer.total_paid)}</div>
          </div>

          <div className="bg-row-alt/60 p-3 sm:p-4 rounded-xl border border-border">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block mb-1">Pending Dues</span>
            <div className={`text-base sm:text-xl font-extrabold font-mono ${Number(customer.pending_dues || 0) > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
              {formatINR(Math.max(0, Number(customer.pending_dues || 0)))}
            </div>
          </div>

          <div className="bg-emerald-50/80 p-3 sm:p-4 rounded-xl border border-emerald-200/80 flex flex-col justify-between">
            <div>
              <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-emerald-700" />
                Store Credit
              </span>
              <div className="text-base sm:text-xl font-extrabold text-emerald-700 font-mono">
                {formatINR(creditBalance)}
              </div>
            </div>
            <button
              onClick={() => setIsCreditHistoryModalOpen(true)}
              className="text-[11px] font-bold text-emerald-800 hover:text-emerald-950 underline mt-1.5 text-left"
            >
              View History ({creditLedger.length})
            </button>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
          <button 
            onClick={() => setActiveTab('invoices')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap min-h-[38px] ${
              activeTab === 'invoices' 
                ? 'bg-accent text-white shadow-xs' 
                : 'bg-surface text-ink-muted hover:text-ink-primary border border-border hover:bg-row-alt'
            }`}
          >
            Invoices ({invoices.length})
          </button>
          <button 
            onClick={() => setActiveTab('payments')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap min-h-[38px] ${
              activeTab === 'payments' 
                ? 'bg-accent text-white shadow-xs' 
                : 'bg-surface text-ink-muted hover:text-ink-primary border border-border hover:bg-row-alt'
            }`}
          >
            Payments ({payments.length})
          </button>
          <button 
            onClick={() => setActiveTab('returns')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap min-h-[38px] ${
              activeTab === 'returns' 
                ? 'bg-accent text-white shadow-xs' 
                : 'bg-surface text-ink-muted hover:text-ink-primary border border-border hover:bg-row-alt'
            }`}
          >
            Returns ({returns.length})
          </button>
          <button 
            onClick={() => setActiveTab('credit')} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap min-h-[38px] ${
              activeTab === 'credit' 
                ? 'bg-emerald-700 text-white shadow-xs' 
                : 'bg-surface text-emerald-700 border border-emerald-200 hover:bg-emerald-50'
            }`}
          >
            Credit Ledger ({creditLedger.length})
          </button>
        </div>

        {/* Tab Content Directory */}
        <div className="bg-surface rounded-2xl overflow-hidden shadow-xs border border-border">
          {/* TAB 1: INVOICES */}
          {activeTab === 'invoices' && (
            <div className="divide-y divide-border">
              {invoices.length === 0 ? (
                <div className="p-8 text-center text-ink-muted text-xs">No invoices found for this customer.</div>
              ) : (
                invoices.map((inv) => {
                  const due = Number(inv.due_amount || 0);
                  return (
                    <div 
                      key={inv.id} 
                      onClick={() => router.push(`/invoices/${inv.id}`)}
                      className="p-3.5 sm:p-4 hover:bg-row-alt/40 transition cursor-pointer flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-xs sm:text-sm text-accent hover:underline">
                            {inv.invoice_number}
                          </span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                            inv.status === 'Paid' 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                              : inv.status === 'Void' 
                              ? 'bg-red-50 text-red-600 border-red-200' 
                              : inv.status === 'Refunded'
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {inv.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-ink-muted mt-1">
                          {new Date(inv.created_at).toLocaleString()}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-border" onClick={e => e.stopPropagation()}>
                        <div className="text-left sm:text-right">
                          <div className="font-bold font-mono text-xs sm:text-sm text-ink-primary">
                            {formatINR(inv.effective_final_total ?? inv.final_total)}
                          </div>
                          {inv.status !== 'Void' && due > 0 && (
                            <div className="text-[11px] font-bold font-mono text-amber-600">
                              Due: {formatINR(due)}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {inv.status !== 'Void' && inv.status !== 'Refunded' && (inv.total_refunds || 0) === 0 && (
                            <button 
                              onClick={() => handleVoidClick(inv)} 
                              className="px-3 py-1.5 border border-border text-ink-muted hover:text-red-600 hover:bg-red-50 rounded-xl text-xs font-bold transition min-h-[34px]"
                            >
                              Void
                            </button>
                          )}
                          {inv.status !== 'Paid' && inv.status !== 'Void' && inv.status !== 'Refunded' && due > 0 && (
                            <button 
                              onClick={() => handlePayClick(inv)} 
                              className="px-3.5 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-xs font-bold transition shadow-2xs min-h-[34px]"
                            >
                              Pay Tab
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: PAYMENTS */}
          {activeTab === 'payments' && (
            <div className="divide-y divide-border">
              {payments.length === 0 ? (
                <div className="p-8 text-center text-ink-muted text-xs">No payments recorded.</div>
              ) : (
                payments.map((pay: any) => (
                  <div key={pay.id} className={`p-3.5 sm:p-4 flex justify-between items-center ${pay.invoices?.is_voided ? 'opacity-50 bg-row-alt/30' : 'hover:bg-row-alt/40'}`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`font-mono font-bold text-xs ${pay.invoices?.is_voided ? 'line-through text-ink-muted' : 'text-emerald-700'}`}>
                          {pay.amount < 0 ? 'REFUND' : 'PAYMENT'} ({pay.method})
                        </span>
                        {pay.invoices?.is_voided && (
                          <span className="text-[10px] font-bold bg-red-100 text-red-800 px-1.5 py-0.5 rounded">
                            Voided
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-muted mt-1">{new Date(pay.created_at).toLocaleString()}</div>
                    </div>

                    <div className="text-right">
                      <div className={`font-bold text-xs sm:text-sm font-mono ${pay.invoices?.is_voided ? 'text-ink-muted line-through' : pay.amount < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                        {pay.amount < 0 ? '-' : '+'}{formatINR(Math.abs(Number(pay.amount)))}
                      </div>
                      {pay.invoices?.invoice_number && (
                        <div className="text-[11px] font-mono text-ink-muted">{pay.invoices.invoice_number}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: RETURNS */}
          {activeTab === 'returns' && (
            <div className="divide-y divide-border">
              {returns.length === 0 ? (
                <div className="p-8 text-center text-ink-muted text-xs">No returns recorded.</div>
              ) : (
                returns.map((ret: any) => {
                  const productName = ret.variants?.products?.name || 'Unknown Item';
                  const variantName = ret.variants?.name || 'Standard';
                  return (
                    <div key={ret.id} className="p-3.5 sm:p-4 flex justify-between items-center hover:bg-row-alt/40">
                      <div>
                        <div className="font-bold text-xs sm:text-sm text-ink-primary">{productName} — {variantName}</div>
                        <div className="text-[11px] text-ink-muted mt-0.5">{new Date(ret.created_at).toLocaleString()}</div>
                        {ret.invoices?.invoice_number && (
                          <div className="text-[11px] font-mono text-accent mt-0.5">{ret.invoices.invoice_number}</div>
                        )}
                      </div>

                      <div className="text-right">
                        <div className="font-bold text-xs sm:text-sm text-red-600 font-mono">
                          Refund: {formatINR(ret.total_refund_amount)}
                        </div>
                        <div className="text-[11px] text-ink-muted">Qty: {ret.quantity} pcs</div>
                        <div className="text-[11px] font-bold text-amber-700">{ret.return_type} via {ret.refund_method}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 4: CREDIT LEDGER */}
          {activeTab === 'credit' && (
            <div className="divide-y divide-border">
              {creditLedger.length === 0 ? (
                <div className="p-8 text-center text-ink-muted text-xs">No store credit transactions.</div>
              ) : (
                creditLedger.map((entry) => (
                  <div key={entry.id} className="p-3.5 sm:p-4 flex justify-between items-start gap-3 hover:bg-row-alt/40">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                          entry.type === 'RETURN_CREDIT' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                          entry.type === 'PAYMENT_APPLIED' ? 'bg-blue-50 text-blue-800 border-blue-200' : 'bg-gray-50 text-gray-800 border-gray-200'
                        }`}>
                          {entry.type}
                        </span>
                        {entry.invoices?.invoice_number && (
                          <span className="font-mono text-[11px] font-bold text-ink-muted">{entry.invoices.invoice_number}</span>
                        )}
                      </div>
                      <p className="text-xs text-ink-primary font-medium">{entry.notes || 'Credit ledger movement'}</p>
                      <p className="text-[11px] text-ink-muted mt-0.5">{new Date(entry.created_at).toLocaleString()}</p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className={`font-bold font-mono text-xs sm:text-sm ${entry.amount > 0 ? 'text-emerald-700' : 'text-blue-700'}`}>
                        {entry.amount > 0 ? '+' : ''}{formatINR(entry.amount)}
                      </div>
                      <div className="text-[11px] text-ink-muted font-mono">Balance: {formatINR(entry.balance_after)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Credit History Modal with z-[200] */}
      {isCreditHistoryModalOpen && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget) setIsCreditHistoryModalOpen(false); }}
        >
          <div 
            className="bg-surface rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col border border-border animate-in zoom-in-95 duration-150 cursor-default"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-emerald-700" />
                <h2 className="text-base sm:text-lg font-bold text-ink-primary">Store Credit Wallet History</h2>
              </div>
              <button 
                onClick={() => setIsCreditHistoryModalOpen(false)} 
                className="p-1.5 text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl flex justify-between items-center">
              <div>
                <p className="text-xs font-bold text-emerald-900">Current Available Balance</p>
                <p className="text-xl sm:text-2xl font-extrabold text-emerald-700 font-mono">{formatINR(creditBalance)}</p>
              </div>
              <span className="text-xs font-bold bg-emerald-200/80 text-emerald-900 px-3 py-1 rounded-full">
                Active Wallet
              </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-border">
              {creditLedger.length === 0 ? (
                <p className="text-xs text-ink-muted text-center py-8">No credit movements recorded for this customer.</p>
              ) : (
                creditLedger.map((entry) => (
                  <div key={entry.id} className="py-3 flex justify-between items-start gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          entry.type === 'RETURN_CREDIT' ? 'bg-emerald-100 text-emerald-800' :
                          entry.type === 'PAYMENT_APPLIED' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {entry.type}
                        </span>
                        {entry.invoices?.invoice_number && (
                          <span className="font-mono text-xs font-bold text-ink-muted">{entry.invoices.invoice_number}</span>
                        )}
                      </div>
                      <p className="text-xs text-ink-primary font-medium">{entry.notes || 'Store credit transaction'}</p>
                      <p className="text-[11px] text-ink-muted">{new Date(entry.created_at).toLocaleString()}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-mono font-bold text-xs sm:text-sm ${entry.amount > 0 ? 'text-emerald-700' : 'text-blue-700'}`}>
                        {entry.amount > 0 ? '+' : ''}{formatINR(entry.amount)}
                      </p>
                      <p className="text-[11px] font-mono text-ink-muted">Balance: {formatINR(entry.balance_after)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* VOID MODAL with z-[200] */}
      {isVoidModalOpen && selectedInvoice && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !actionLoading) setIsVoidModalOpen(false); }}
        >
          <div 
            className="bg-surface w-full max-w-md rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center text-red-600">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-ink-primary">Void Invoice</h2>
                <p className="text-xs text-ink-muted font-mono">{selectedInvoice.invoice_number}</p>
              </div>
            </div>

            {actionError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <p className="text-xs text-ink-muted leading-relaxed">
              Voiding this invoice will automatically restock inventory items, restore any customer store credit used, and cancel outstanding dues.
            </p>

            <div>
              <label className="block text-xs font-bold text-ink-primary mb-1">Reason for Voiding *</label>
              <textarea 
                value={voidReason} 
                onChange={e => setVoidReason(e.target.value)} 
                placeholder="e.g. Customer cancelled order / Billing mistake..." 
                className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none min-h-[80px]" 
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-border">
              <button 
                type="button"
                onClick={() => setIsVoidModalOpen(false)} 
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={submitVoid} 
                disabled={actionLoading} 
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 
                <span>Confirm Void</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAY TAB MODAL with z-[200] */}
      {isPayModalOpen && selectedInvoice && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !actionLoading) setIsPayModalOpen(false); }}
        >
          <div 
            className="bg-surface w-full max-w-md rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <h2 className="text-base font-bold text-ink-primary">Settle Invoice Due</h2>
              <button 
                onClick={() => setIsPayModalOpen(false)} 
                disabled={actionLoading}
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}
            
            <div className="flex justify-between items-center p-3.5 bg-row-alt/60 border border-border rounded-xl">
              <div>
                <span className="text-xs font-semibold text-ink-muted block">Invoice Number</span>
                <span className="font-mono font-bold text-xs text-accent">{selectedInvoice.invoice_number}</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-ink-muted block">Total Due</span>
                <span className="text-base font-bold text-amber-600 font-mono">{formatINR(selectedInvoice.due_amount)}</span>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-bold text-ink-primary">Amount to Pay (₹)</label>
                {payMethod === 'STORE_CREDIT' && creditBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => setPayAmount(Math.min(Number(selectedInvoice.due_amount || 0), creditBalance).toFixed(2))}
                    className="text-[11px] font-bold text-emerald-700 hover:underline"
                  >
                    Max Credit ({formatINR(Math.min(Number(selectedInvoice.due_amount || 0), creditBalance))})
                  </button>
                )}
              </div>
              <input 
                type="number" 
                step="0.01"
                min="0.01"
                value={payAmount} 
                onFocus={e => e.target.select()}
                onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                onChange={e => setPayAmount(e.target.value)} 
                max={selectedInvoice.due_amount} 
                className="w-full p-2.5 border border-border rounded-xl font-mono text-base font-bold text-accent bg-surface focus:ring-2 focus:ring-accent focus:outline-none" 
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-ink-primary">Payment Method</label>
              <div className="grid grid-cols-3 gap-2">
                {creditBalance > 0 && (
                  <button 
                    type="button"
                    onClick={() => handleSwitchPayMethod('STORE_CREDIT')} 
                    className={`p-2.5 border rounded-xl font-bold text-xs flex flex-col items-center gap-1 transition ${
                      payMethod === 'STORE_CREDIT' 
                        ? 'bg-emerald-700 border-emerald-700 text-white shadow-xs' 
                        : 'border-border bg-surface hover:bg-row-alt text-ink-primary'
                    }`}
                  >
                    <Wallet className="w-4 h-4" />
                    <span>Credit</span>
                  </button>
                )}
                <button 
                  type="button"
                  onClick={() => handleSwitchPayMethod('CASH')} 
                  className={`p-2.5 border rounded-xl font-bold text-xs flex flex-col items-center gap-1 transition ${
                    payMethod === 'CASH' 
                      ? 'bg-accent border-accent text-white shadow-xs' 
                      : 'border-border bg-surface hover:bg-row-alt text-ink-primary'
                  }`}
                >
                  <span>CASH</span>
                </button>
                <button 
                  type="button"
                  onClick={() => handleSwitchPayMethod('UPI')} 
                  className={`p-2.5 border rounded-xl font-bold text-xs flex flex-col items-center gap-1 transition ${
                    payMethod === 'UPI' 
                      ? 'bg-accent border-accent text-white shadow-xs' 
                      : 'border-border bg-surface hover:bg-row-alt text-ink-primary'
                  }`}
                >
                  <span>UPI</span>
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
              <button 
                type="button"
                onClick={() => setIsPayModalOpen(false)} 
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={submitPay} 
                disabled={actionLoading} 
                className="px-5 py-2 bg-accent hover:bg-accent-hover text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 
                <span>Confirm Payment</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT CUSTOMER MODAL with z-[200] */}
      {isEditModalOpen && (
        <div 
          className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !actionLoading) setIsEditModalOpen(false); }}
        >
          <div 
            className="bg-surface rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <h2 className="text-base font-bold text-ink-primary">Edit Customer Details</h2>
              <button 
                onClick={() => setIsEditModalOpen(false)} 
                disabled={actionLoading}
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleEditCustomer} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Name <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  value={editName} 
                  onChange={e => setEditName(e.target.value)} 
                  required
                  className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Phone</label>
                <input 
                  type="tel" 
                  value={editPhone} 
                  onChange={e => setEditPhone(e.target.value)} 
                  className="w-full p-2.5 border border-border rounded-xl text-xs font-mono bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">GSTIN (Optional)</label>
                <input 
                  type="text" 
                  value={editGstin} 
                  onChange={e => setEditGstin(e.target.value.toUpperCase())} 
                  placeholder="e.g. 29AAAAA0000A1Z5" 
                  className="w-full p-2.5 border border-border rounded-xl text-xs font-mono bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Address (Optional)</label>
                <textarea 
                  rows={2} 
                  value={editAddress} 
                  onChange={e => setEditAddress(e.target.value)} 
                  placeholder="Billing / Delivery Address..." 
                  className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
                <button 
                  type="button" 
                  onClick={() => setIsEditModalOpen(false)} 
                  disabled={actionLoading}
                  className="px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={actionLoading} 
                  className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition"
                >
                  {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
