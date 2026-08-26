'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Loader2, AlertTriangle, CheckCircle2, ShieldAlert, Pencil, Wallet, History, X } from 'lucide-react';
import Link from 'next/link';
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

export default function CustomerDetailClient({ id }: { id: string }) {
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
    setLoading(false);
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
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setActionLoading(true);
    try {
      const res = await voidInvoiceAction({ invoice_id: selectedInvoice.id, reason: voidReason });
      if (res.success) {
        setIsVoidModalOpen(false);
        load(); // Refresh data
      } else {
        setActionError(res.error || 'Failed to void');
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
    if (isNaN(amt) || amt <= 0) return setActionError('Invalid amount');
    if (amt > selectedInvoice.due_amount) return setActionError('Amount exceeds due amount');
    
    if (payMethod === 'STORE_CREDIT') {
      const avail = Number(customer?.credit_balance || 0);
      if (amt > avail) {
        return setActionError(`Insufficient store credit (Available: ₹${avail.toFixed(2)})`);
      }
    }

    if (isSubmittingRef.current) return;
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

  const handleEditCustomer = async () => {
    setEditError('');
    if (!editName.trim()) {
      setEditError('Customer name is required');
      return;
    }
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setActionLoading(true);
    try {
      const res = await updateCustomerAction(id, editName, editPhone, editGstin, editAddress);
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
    return <div className="p-8 flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>;
  }

  if (!customer) {
    return <div className="p-8">Customer not found</div>;
  }

  const creditBalance = Number(customer.credit_balance || 0);

  return (
    <div className="p-8 max-w-5xl w-full mx-auto">
      <Link href="/customers" className="flex items-center gap-2 text-ink-muted hover:text-ink-primary font-medium text-[14px] mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Customers
      </Link>

      {/* Header Info */}
      <div className="bg-white border border-border rounded-[16px] p-6 mb-8 shadow-xs">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight text-ink-primary mb-1 flex items-center gap-3">
              {customer.name}
              <button onClick={openEditModal} className="p-1.5 text-gray-400 hover:text-accent hover:bg-accent/10 rounded-md transition-colors" title="Edit Customer">
                <Pencil className="w-4 h-4" />
              </button>
              {customer.is_active === false && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200 uppercase">
                  Inactive Account
                </span>
              )}
            </h1>
            <div className="flex items-center gap-3">
              <p className="text-[14px] text-ink-muted">{customer.phone || 'No phone number'}</p>
              {customer.is_active !== false ? (
                <button
                  onClick={async () => {
                    const dues = Number(customer.pending_dues || 0);
                    const cred = Number(customer.credit_balance || 0);
                    if (dues > 0) {
                      alert(`Cannot deactivate customer with an outstanding debt balance of ₹${dues.toFixed(2)}. Please settle dues first.`);
                      return;
                    }
                    if (cred > 0) {
                      alert(`Cannot deactivate customer with an active store credit wallet balance of ₹${cred.toFixed(2)}. Please exhaust wallet first.`);
                      return;
                    }
                    if (!confirm('Are you sure you want to deactivate this customer?')) return;
                    const res = await deactivateCustomerAction(customer.id);
                    if (res.success) {
                      setCustomer((prev: any) => ({ ...prev, is_active: false }));
                    } else {
                      alert('Failed to deactivate: ' + res.error);
                    }
                  }}
                  className="text-xs font-medium text-red-600 hover:text-red-700 underline"
                >
                  Deactivate Account
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
                  className="text-xs font-bold text-emerald-700 hover:text-emerald-800 underline"
                >
                  Reactivate Account
                </button>
              )}
            </div>
          </div>
          <div className="text-right">
            {customer.address && <div className="text-[13px] text-ink-muted uppercase">{customer.address}</div>}
            {customer.gstin && <div className="text-[13px] font-bold text-accent">GSTIN: {customer.gstin}</div>}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8">
          <div className="bg-gray-50/80 p-4 rounded-xl border border-gray-100">
            <div className="text-[12px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Total Spend</div>
            <div className="text-[20px] font-extrabold text-ink-primary font-mono">₹{Number(customer.total_spend || 0).toFixed(2)}</div>
          </div>
          <div className="bg-gray-50/80 p-4 rounded-xl border border-gray-100">
            <div className="text-[12px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Total Paid</div>
            <div className="text-[20px] font-extrabold text-green-700 font-mono">₹{Number(customer.total_paid || 0).toFixed(2)}</div>
          </div>
          <div className="bg-gray-50/80 p-4 rounded-xl border border-gray-100">
            <div className="text-[12px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Pending Dues</div>
            <div className={`text-[20px] font-extrabold font-mono ${Number(customer.pending_dues) > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
              ₹{Math.max(0, Number(customer.pending_dues || 0)).toFixed(2)}
            </div>
          </div>
          <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200/80 flex flex-col justify-between">
            <div>
              <div className="text-[12px] font-bold text-emerald-800 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-emerald-700" />
                Store Credit
              </div>
              <div className="text-[20px] font-extrabold text-emerald-700 font-mono">
                ₹{creditBalance.toFixed(2)}
              </div>
            </div>
            <button
              onClick={() => setIsCreditHistoryModalOpen(true)}
              className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 underline mt-2 text-left"
            >
              View History ({creditLedger.length})
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex gap-2 mb-4">
          <button onClick={() => setActiveTab('invoices')} className={`px-4 py-2 rounded-full border text-[13px] font-bold transition-colors ${activeTab === 'invoices' ? 'bg-accent text-white border-accent' : 'bg-white text-accent border-accent hover:bg-orange-50'}`}>Invoices ({invoices.length})</button>
          <button onClick={() => setActiveTab('payments')} className={`px-4 py-2 rounded-full border text-[13px] font-bold transition-colors ${activeTab === 'payments' ? 'bg-accent text-white border-accent' : 'bg-white text-accent border-accent hover:bg-orange-50'}`}>Payments ({payments.length})</button>
          <button onClick={() => setActiveTab('returns')} className={`px-4 py-2 rounded-full border text-[13px] font-bold transition-colors ${activeTab === 'returns' ? 'bg-accent text-white border-accent' : 'bg-white text-accent border-accent hover:bg-orange-50'}`}>Returns ({returns.length})</button>
          <button onClick={() => setActiveTab('credit')} className={`px-4 py-2 rounded-full border text-[13px] font-bold transition-colors ${activeTab === 'credit' ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-emerald-700 border-emerald-700 hover:bg-emerald-50'}`}>Credit Ledger ({creditLedger.length})</button>
        </div>

        <div className="flex-1 bg-white rounded-[16px] overflow-hidden flex flex-col shadow-xs border border-border">
          {activeTab === 'invoices' && (
            <div className="flex-1 overflow-y-auto">
              {invoices.length === 0 ? <div className="p-8 text-center text-ink-muted text-[14px]">No invoices found.</div> : (
                <div className="divide-y divide-border">
                  {invoices.map((inv) => (
                    <div key={inv.id} className="flex justify-between items-center p-5">
                      <div>
                        <div className="font-mono font-bold text-[14px] text-accent mb-1">{inv.invoice_number}</div>
                        <div className="text-[12px] text-ink-muted">{new Date(inv.created_at).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className="font-bold text-[14px]">₹{Number(inv.effective_final_total ?? inv.final_total).toFixed(2)}</div>
                          {inv.status !== 'Void' && inv.due_amount > 0 && <div className="text-[12px] font-bold text-amber-600">Due ₹{Number(inv.due_amount).toFixed(2)}</div>}
                        </div>
                        <div className="w-16 flex justify-center">
                          <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full ${
                            inv.status === 'Paid' 
                              ? 'bg-green-50 text-green-700' 
                              : inv.status === 'Void' 
                              ? 'bg-red-50 text-red-600' 
                              : inv.status === 'Refunded'
                              ? 'bg-purple-50 text-purple-700'
                              : inv.status === 'Partial'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-orange-50 text-orange-700'
                          }`}>
                            {inv.status}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          {inv.status !== 'Void' && inv.status !== 'Refunded' && (inv.total_refunds || 0) === 0 && (
                            <button onClick={() => handleVoidClick(inv)} className="px-4 py-1.5 border border-border text-ink-primary hover:bg-gray-50 rounded-full text-[12px] font-bold transition-colors">Void</button>
                          )}
                          {inv.status !== 'Paid' && inv.status !== 'Void' && inv.status !== 'Refunded' && inv.due_amount > 0 && (
                            <button onClick={() => handlePayClick(inv)} className="px-4 py-1.5 border border-accent text-accent hover:bg-orange-50 rounded-full text-[12px] font-bold transition-colors">Pay Tab</button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {activeTab === 'payments' && (
            <div className="flex-1 overflow-y-auto">
              {payments.length === 0 ? <div className="p-8 text-center text-ink-muted text-[14px]">No payments found.</div> : (
                <div className="divide-y divide-border">
                  {payments.map((pay: any) => (
                    <div key={pay.id} className={`flex justify-between items-center p-5 ${pay.invoices?.is_voided ? 'opacity-60 bg-gray-50/50' : ''}`}>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`font-mono font-bold text-[14px] ${pay.invoices?.is_voided ? 'text-gray-500 line-through' : 'text-green-700'}`}>
                            {pay.amount < 0 ? 'REFUND' : 'PAYMENT'} ({pay.method})
                          </span>
                          {pay.invoices?.is_voided && (
                            <span className="text-[10px] font-bold bg-red-100 text-red-800 px-1.5 py-0.5 rounded">
                              Voided Invoice
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] text-ink-muted">{new Date(pay.created_at).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className={`font-bold text-[14px] font-mono ${pay.invoices?.is_voided ? 'text-gray-400 line-through' : pay.amount < 0 ? 'text-red-600' : 'text-green-700'}`}>
                            {pay.amount < 0 ? '-' : '+'}₹{Math.abs(Number(pay.amount)).toFixed(2)}
                          </div>
                          {pay.invoices?.invoice_number && <div className="text-[12px] font-mono text-ink-muted">{pay.invoices.invoice_number}</div>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {activeTab === 'returns' && (
            <div className="flex-1 overflow-y-auto">
              {returns.length === 0 ? <div className="p-8 text-center text-ink-muted text-[14px]">No returns found.</div> : (
                <div className="divide-y divide-border">
                  {returns.map((ret: any) => {
                    const productName = ret.variants?.products?.name || 'Unknown';
                    const variantName = ret.variants?.name || 'Unknown';
                    return (
                      <div key={ret.id} className="flex justify-between items-center p-5">
                        <div>
                          <div className="font-bold text-[14px] mb-1">{productName} - {variantName}</div>
                          <div className="text-[12px] text-ink-muted">{new Date(ret.created_at).toLocaleString()}</div>
                          {ret.invoices?.invoice_number && <div className="text-[12px] font-mono text-ink-muted mt-1">{ret.invoices.invoice_number}</div>}
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-[14px] text-red-600 font-mono">Refund: ₹{Number(ret.total_refund_amount).toFixed(2)}</div>
                          <div className="text-[12px] text-ink-muted">Qty: {ret.quantity} pcs</div>
                          <div className="text-[12px] font-bold text-orange-600">{ret.return_type} via {ret.refund_method}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {activeTab === 'credit' && (
            <div className="flex-1 overflow-y-auto">
              {creditLedger.length === 0 ? <div className="p-8 text-center text-ink-muted text-[14px]">No store credit movements recorded.</div> : (
                <div className="divide-y divide-border">
                  {creditLedger.map((entry) => (
                    <div key={entry.id} className="flex justify-between items-center p-5">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                            entry.type === 'RETURN_CREDIT' ? 'bg-emerald-100 text-emerald-800' :
                            entry.type === 'PAYMENT_APPLIED' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {entry.type}
                          </span>
                          {entry.invoices?.invoice_number && (
                            <span className="font-mono text-xs font-bold text-ink-muted">{entry.invoices.invoice_number}</span>
                          )}
                        </div>
                        <p className="text-xs text-ink-primary font-medium">{entry.notes || 'Credit ledger movement'}</p>
                        <p className="text-[11px] text-ink-muted mt-0.5">{new Date(entry.created_at).toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold font-mono text-[14px] ${entry.amount > 0 ? 'text-emerald-700' : 'text-blue-700'}`}>
                          {entry.amount > 0 ? '+' : ''}₹{Number(entry.amount).toFixed(2)}
                        </div>
                        <div className="text-[11px] text-ink-muted font-mono">Balance: ₹{Number(entry.balance_after).toFixed(2)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Credit History Modal */}
      {isCreditHistoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-[20px] max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-emerald-700" />
                <h2 className="text-lg font-bold text-gray-900">Customer Credit History</h2>
              </div>
              <button onClick={() => setIsCreditHistoryModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-emerald-50 rounded-xl flex justify-between items-center">
              <div>
                <p className="text-xs font-semibold text-emerald-800">Current Available Balance</p>
                <p className="text-2xl font-extrabold text-emerald-700 font-mono">₹{creditBalance.toFixed(2)}</p>
              </div>
              <span className="text-xs font-bold bg-emerald-200/80 text-emerald-900 px-3 py-1 rounded-full">
                Active Store Credit
              </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {creditLedger.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No credit movements recorded for this customer.</p>
              ) : (
                creditLedger.map((entry) => (
                  <div key={entry.id} className="py-3 flex justify-between items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          entry.type === 'RETURN_CREDIT' ? 'bg-emerald-100 text-emerald-800' :
                          entry.type === 'PAYMENT_APPLIED' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {entry.type}
                        </span>
                        {entry.invoices?.invoice_number && (
                          <span className="font-mono text-xs font-bold text-gray-500">{entry.invoices.invoice_number}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-800 font-medium">{entry.notes || 'Store credit transaction'}</p>
                      <p className="text-[11px] text-gray-400">{new Date(entry.created_at).toLocaleString()}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-mono font-bold text-sm ${entry.amount > 0 ? 'text-emerald-700' : 'text-blue-700'}`}>
                        {entry.amount > 0 ? '+' : ''}₹{Number(entry.amount).toFixed(2)}
                      </p>
                      <p className="text-[11px] font-mono text-gray-400">Balance: ₹{Number(entry.balance_after).toFixed(2)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* VOID MODAL */}
      {isVoidModalOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink-primary/20 backdrop-blur-sm" onClick={() => setIsVoidModalOpen(false)}></div>
          <div className="relative bg-white w-full max-w-[400px] rounded-[16px] shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-red-600"><AlertTriangle className="w-5 h-5" /></div>
              <h2 className="text-[18px] font-bold">Void Invoice</h2>
            </div>
            {actionError && <div className="mb-4 p-3 bg-red-50 text-red-700 text-[13px] rounded-[8px]">{actionError}</div>}
            <p className="text-[13px] text-ink-muted mb-4">Voiding <span className="font-bold">{selectedInvoice.invoice_number}</span> will restock items, restore any spent store credit, and cancel dues.</p>
            <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Reason for voiding..." className="w-full p-3 border border-border rounded-[8px] text-[13px] mb-4 min-h-[80px]" />
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsVoidModalOpen(false)} className="px-4 py-2 font-bold text-[13px]">Cancel</button>
              <button onClick={submitVoid} disabled={actionLoading} className="px-4 py-2 bg-red-600 text-white font-bold text-[13px] rounded-[8px] flex items-center gap-2">
                {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />} Void Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAY TAB MODAL */}
      {isPayModalOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink-primary/20 backdrop-blur-sm" onClick={() => setIsPayModalOpen(false)}></div>
          <div className="relative bg-white w-full max-w-[400px] rounded-[16px] shadow-2xl p-6">
            <h2 className="text-[18px] font-bold mb-4">Pay Pending Due</h2>
            {actionError && <div className="mb-4 p-3 bg-red-50 text-red-700 text-[13px] rounded-[8px]">{actionError}</div>}
            
            <div className="mb-4 flex justify-between items-center p-3 bg-gray-50 rounded-[8px]">
              <span className="text-[13px] font-medium text-ink-muted">Due Amount</span>
              <span className="text-[16px] font-bold text-amber-600 font-mono">₹{selectedInvoice.due_amount.toFixed(2)}</span>
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-1">
                <label className="block text-[12px] font-medium text-ink-muted">Amount to Pay</label>
                {payMethod === 'STORE_CREDIT' && creditBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => setPayAmount(Math.min(Number(selectedInvoice.due_amount || 0), creditBalance).toFixed(2))}
                    className="text-[11px] font-bold text-emerald-700 hover:underline"
                  >
                    Use Max Credit (₹{Math.min(Number(selectedInvoice.due_amount || 0), creditBalance).toFixed(2)})
                  </button>
                )}
              </div>
              <input 
                type="number" 
                step="0.01"
                min="0.01"
                value={payAmount} 
                onChange={e => setPayAmount(e.target.value)} 
                max={selectedInvoice.due_amount} 
                className="w-full p-3 border border-border rounded-[8px] font-mono text-[16px] font-bold text-accent" 
              />
            </div>

            <div className="mb-6 space-y-2">
              <label className="block text-[12px] font-medium text-ink-muted">Payment Method</label>
              <div className="grid grid-cols-3 gap-2">
                {creditBalance > 0 && (
                  <button 
                    onClick={() => handleSwitchPayMethod('STORE_CREDIT')} 
                    className={`p-2.5 border rounded-[8px] font-bold text-[12px] flex flex-col items-center gap-1 ${payMethod === 'STORE_CREDIT' ? 'bg-emerald-700 border-emerald-700 text-white' : 'hover:bg-gray-50'}`}
                  >
                    <Wallet className="w-4 h-4" />
                    <span>Credit (₹{creditBalance.toFixed(0)})</span>
                  </button>
                )}
                <button 
                  onClick={() => handleSwitchPayMethod('CASH')} 
                  className={`p-2.5 border rounded-[8px] font-bold text-[12px] flex flex-col items-center gap-1 ${payMethod === 'CASH' ? 'bg-accent border-accent text-white' : 'hover:bg-gray-50'}`}
                >
                  <span>CASH</span>
                </button>
                <button 
                  onClick={() => handleSwitchPayMethod('UPI')} 
                  className={`p-2.5 border rounded-[8px] font-bold text-[12px] flex flex-col items-center gap-1 ${payMethod === 'UPI' ? 'bg-accent border-accent text-white' : 'hover:bg-gray-50'}`}
                >
                  <span>UPI</span>
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setIsPayModalOpen(false)} className="px-4 py-2 font-bold text-[13px]">Cancel</button>
              <button onClick={submitPay} disabled={actionLoading} className="px-4 py-2 bg-accent text-white font-bold text-[13px] rounded-[8px] flex items-center gap-2">
                {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />} Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-[16px] w-[400px] p-6 shadow-xl border border-border">
            <h2 className="text-[18px] font-bold mb-4">Edit Customer</h2>
            {editError && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 text-[13px] rounded-[8px] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> {editError}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-bold text-ink-muted mb-1">Name</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-full p-3 border border-border rounded-[8px] text-[13px]" />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-ink-muted mb-1">Phone</label>
                <input type="text" value={editPhone} onChange={e => setEditPhone(e.target.value)} className="w-full p-3 border border-border rounded-[8px] text-[13px]" />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-ink-muted mb-1">GSTIN (Optional)</label>
                <input type="text" value={editGstin} onChange={e => setEditGstin(e.target.value)} placeholder="e.g. 29AAAAA0000A1Z5" className="w-full p-3 border border-border rounded-[8px] text-[13px]" />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-ink-muted mb-1">Address (Optional)</label>
                <textarea rows={2} value={editAddress} onChange={e => setEditAddress(e.target.value)} placeholder="Billing / Delivery Address..." className="w-full p-3 border border-border rounded-[8px] text-[13px]" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-ink-muted hover:bg-surface text-[13px] font-medium rounded-[8px]">Cancel</button>
              <button onClick={handleEditCustomer} disabled={actionLoading} className="px-4 py-2 bg-accent text-white font-bold text-[13px] rounded-[8px] flex items-center gap-2">
                {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
