'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Receipt, 
  IndianRupee, 
  CreditCard, 
  Calendar, 
  Clock, 
  FileText, 
  AlertTriangle, 
  ShieldAlert, 
  Ban, 
  Pencil, 
  Trash2, 
  Loader2, 
  CheckCircle2, 
  X,
  TrendingDown
} from 'lucide-react';
import { 
  getExpenseDetailsAction, 
  updateExpenseAction, 
  voidExpenseAction, 
  deleteExpenseAction 
} from '@/lib/actions/expenses';
import { ExpenseItem, ExpensePaymentMethod } from '@/types/expenses';

const CATEGORY_PRESETS = [
  'Rent',
  'Electricity & Utilities',
  'Packaging Materials',
  'Staff Tea & Refreshments',
  'Logistics & Transport',
  'Salaries & Advances',
  'Store Maintenance',
  'Miscellaneous'
];

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

export default function ExpenseDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const isSubmittingRef = useRef(false);

  const [expense, setExpense] = useState<ExpenseItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editCategory, setEditCategory] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editMethod, setEditMethod] = useState<ExpensePaymentMethod>('CASH');
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editError, setEditError] = useState('');
  const [editing, setEditing] = useState(false);

  // Void Modal State
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

  // Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const loadExpense = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getExpenseDetailsAction(id);
      if (res.success) {
        setExpense(res.data);
      } else {
        setError(res.error || 'Expense not found');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load expense details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadExpense();
  }, [loadExpense]);

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/expenses');
    }
  };

  const openEditModal = () => {
    if (!expense || expense.is_voided) return;
    setEditCategory(expense.category);
    setEditAmount(expense.amount.toString());
    setEditMethod(expense.payment_method);
    setEditNotes(expense.notes || '');
    
    // Format timestamp for datetime-local
    const dt = new Date(expense.created_at);
    const localIso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setEditDate(localIso);
    
    setEditError('');
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expense) return;
    if (isSubmittingRef.current || editing) return;

    const numAmount = parseFloat(editAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setEditError('Please enter a valid expense amount.');
      return;
    }
    if (!editCategory.trim()) {
      setEditError('Category cannot be empty.');
      return;
    }

    isSubmittingRef.current = true;
    setEditing(true);
    setEditError('');

    try {
      const res = await updateExpenseAction(expense.id, {
        category: editCategory.trim(),
        amount: numAmount,
        payment_method: editMethod,
        notes: editNotes.trim() || null,
        created_at: editDate ? new Date(editDate).toISOString() : null
      });

      if (res.success) {
        setIsEditModalOpen(false);
        await loadExpense();
      } else {
        setEditError(res.error || 'Failed to update expense');
      }
    } finally {
      isSubmittingRef.current = false;
      setEditing(false);
    }
  };

  const handleVoidExpense = async () => {
    if (!expense) return;
    if (!voidReason.trim() || voidReason.trim().length < 3) {
      setVoidError('Please provide a reason with at least 3 characters.');
      return;
    }
    if (isSubmittingRef.current || voiding) return;

    isSubmittingRef.current = true;
    setVoiding(true);
    setVoidError(null);

    try {
      const res = await voidExpenseAction({
        expense_id: expense.id,
        reason: voidReason.trim()
      });

      if (res.success) {
        setIsVoidModalOpen(false);
        setVoidReason('');
        await loadExpense();
      } else {
        setVoidError(res.error || 'Failed to void expense');
      }
    } finally {
      isSubmittingRef.current = false;
      setVoiding(false);
    }
  };

  const handleDeleteExpense = async () => {
    if (!expense) return;
    if (isSubmittingRef.current || deleting) return;

    isSubmittingRef.current = true;
    setDeleting(true);
    setDeleteError('');

    try {
      const res = await deleteExpenseAction(expense.id);
      if (res.success) {
        setIsDeleteModalOpen(false);
        router.push('/expenses');
      } else {
        setDeleteError(res.error || 'Failed to delete expense');
      }
    } finally {
      isSubmittingRef.current = false;
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 bg-canvas">
        <Loader2 className="w-8 h-8 animate-spin text-accent mb-3" />
        <p className="text-sm font-medium text-ink-muted">Loading expense details...</p>
      </div>
    );
  }

  if (error || !expense) {
    return (
      <div className="p-4 sm:p-6 md:p-8 max-w-3xl mx-auto space-y-4">
        <button 
          onClick={handleBack} 
          type="button"
          className="inline-flex items-center gap-2 text-xs font-bold text-ink-muted hover:text-ink-primary transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Go Back
        </button>
        <div className="p-6 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-800">
          <ShieldAlert className="w-6 h-6 shrink-0 text-red-600" />
          <div>
            <h3 className="font-bold text-sm">Error Loading Expense</h3>
            <p className="text-xs text-red-700 mt-0.5">{error || 'Expense record not found.'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3.5 sm:p-6 md:p-8 max-w-4xl w-full mx-auto space-y-6 bg-canvas min-h-screen text-ink-primary font-sans">
      {/* Top Header & Back Navigation */}
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
              <h1 className="text-xl sm:text-2xl font-bold text-ink-primary">
                {expense.category}
              </h1>
              <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${
                expense.is_voided 
                  ? 'bg-red-50 text-red-700 border-red-200 line-through' 
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {expense.is_voided ? 'VOIDED' : 'ACTIVE'}
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5 font-mono">
              Recorded on {new Date(expense.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {!expense.is_voided && (
            <button
              onClick={openEditModal}
              className="px-4 py-2 bg-surface hover:bg-row-alt text-ink-primary border border-border rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-2xs min-h-[38px]"
            >
              <Pencil className="w-3.5 h-3.5 text-accent" />
              <span>Edit Details</span>
            </button>
          )}

          {!expense.is_voided && (
            <button
              onClick={() => {
                setVoidReason('');
                setVoidError(null);
                setIsVoidModalOpen(true);
              }}
              className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition min-h-[38px]"
            >
              <Ban className="w-3.5 h-3.5 text-red-600" />
              <span>Void Expense</span>
            </button>
          )}

          <button
            onClick={() => {
              setDeleteError('');
              setIsDeleteModalOpen(true);
            }}
            className="p-2.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded-xl border border-border transition min-h-[38px] min-w-[38px] flex items-center justify-center"
            title="Permanently Delete Expense"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Expense Bento Card */}
      <div className="bg-surface border border-border rounded-2xl p-5 sm:p-7 shadow-xs space-y-6">
        {/* Amount & Method Hero */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-border">
          <div>
            <span className="text-xs font-bold text-ink-muted uppercase tracking-wider block mb-1">Expense Amount</span>
            <div className={`text-3xl sm:text-4xl font-extrabold font-mono ${expense.is_voided ? 'text-ink-muted line-through' : 'text-red-600'}`}>
              {formatINR(expense.amount)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold px-3 py-1.5 rounded-xl border border-border bg-row-alt flex items-center gap-2 text-ink-primary">
              {expense.payment_method === 'CASH' ? <IndianRupee className="w-4 h-4 text-emerald-600" /> : <CreditCard className="w-4 h-4 text-blue-600" />}
              <span>Paid via {expense.payment_method}</span>
            </span>
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-row-alt/50 p-4 rounded-xl border border-border space-y-1">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Expense Category</span>
            <p className="text-sm font-bold text-ink-primary">{expense.category}</p>
          </div>

          <div className="bg-row-alt/50 p-4 rounded-xl border border-border space-y-1">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Payment Channel</span>
            <p className="text-sm font-mono font-bold text-ink-primary">{expense.payment_method}</p>
          </div>

          <div className="bg-row-alt/50 p-4 rounded-xl border border-border space-y-1">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Transaction Timestamp</span>
            <p className="text-xs font-mono text-ink-primary">
              {new Date(expense.created_at).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'medium' })}
            </p>
          </div>

          <div className="bg-row-alt/50 p-4 rounded-xl border border-border space-y-1">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Record ID</span>
            <p className="text-xs font-mono text-ink-muted truncate">{expense.id}</p>
          </div>
        </div>

        {/* Notes Block */}
        <div className="pt-2">
          <span className="text-xs font-bold text-ink-primary block mb-1.5">Remarks / Notes</span>
          <div className="p-3.5 bg-row-alt/60 border border-border rounded-xl text-xs text-ink-primary leading-relaxed min-h-[50px]">
            {expense.notes || <span className="text-ink-muted italic">No remarks provided.</span>}
          </div>
        </div>

        {/* Financial Impact Breakdown Banner */}
        <div className="p-4 bg-emerald-50/60 border border-emerald-200/80 rounded-xl flex items-start gap-3">
          <TrendingDown className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-bold text-emerald-900">Financial Impact</p>
            <p className="text-emerald-800 leading-relaxed">
              {expense.is_voided 
                ? 'This expense is marked as VOIDED and has zero financial impact on your Net Profit, Cash In Drawer, and Reports.'
                : `This expense actively deducts ${formatINR(expense.amount)} from your Gross Profit in Profit & Loss Reports and is counted toward daily ${expense.payment_method} outflows.`
              }
            </p>
          </div>
        </div>
      </div>

      {/* EDIT MODAL with z-[200] */}
      {isEditModalOpen && (
        <div 
          className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !editing) setIsEditModalOpen(false); }}
        >
          <div 
            className="bg-surface rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <h2 className="text-base font-bold text-ink-primary">Edit Expense Details</h2>
              <button 
                onClick={() => setIsEditModalOpen(false)} 
                disabled={editing}
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Category <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  value={editCategory} 
                  onChange={e => setEditCategory(e.target.value)} 
                  required
                  placeholder="e.g. Electricity, Packaging..."
                  className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Amount (₹) <span className="text-red-500">*</span></label>
                <input 
                  type="number" 
                  step="0.01"
                  min="0.01"
                  value={editAmount} 
                  onChange={e => setEditAmount(e.target.value)} 
                  required
                  placeholder="0.00"
                  className="w-full p-2.5 border border-border rounded-xl text-xs font-mono font-bold text-accent bg-surface focus:ring-2 focus:ring-accent focus:outline-none" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Payment Method</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditMethod('CASH')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                      editMethod === 'CASH'
                        ? 'bg-accent border-accent text-white shadow-xs'
                        : 'border-border bg-surface hover:bg-row-alt text-ink-primary'
                    }`}
                  >
                    <IndianRupee className="w-3.5 h-3.5" />
                    <span>CASH</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditMethod('UPI')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                      editMethod === 'UPI'
                        ? 'bg-accent border-accent text-white shadow-xs'
                        : 'border-border bg-surface hover:bg-row-alt text-ink-primary'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>UPI / Online</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Expense Date & Time</label>
                <input 
                  type="datetime-local" 
                  value={editDate} 
                  onChange={e => setEditDate(e.target.value)} 
                  className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Notes / Description</label>
                <textarea 
                  rows={2} 
                  value={editNotes} 
                  onChange={e => setEditNotes(e.target.value)} 
                  placeholder="Optional remarks..."
                  className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
                <button 
                  type="button" 
                  onClick={() => setIsEditModalOpen(false)} 
                  disabled={editing}
                  className="px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={editing} 
                  className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition"
                >
                  {editing && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VOID MODAL with z-[200] */}
      {isVoidModalOpen && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !voiding) setIsVoidModalOpen(false); }}
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
                <h2 className="text-base font-bold text-ink-primary">Void Expense</h2>
                <p className="text-xs text-ink-muted font-mono">{expense.category} • {formatINR(expense.amount)}</p>
              </div>
            </div>

            {voidError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{voidError}</span>
              </div>
            )}

            <p className="text-xs text-ink-muted leading-relaxed">
              Voiding this expense will permanently remove its financial deduction from Reports and Cash In Drawer. This action cannot be un-done.
            </p>

            <div>
              <label className="block text-xs font-bold text-ink-primary mb-1">Reason for Voiding <span className="text-red-500">*</span></label>
              <textarea 
                value={voidReason} 
                onChange={e => setVoidReason(e.target.value)} 
                placeholder="e.g. Duplicate entry / Incorrect category / Cancelled purchase..." 
                className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none min-h-[80px]" 
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-border">
              <button 
                type="button"
                onClick={() => setIsVoidModalOpen(false)} 
                disabled={voiding}
                className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={handleVoidExpense} 
                disabled={voiding} 
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition"
              >
                {voiding && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 
                <span>Confirm Void</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE MODAL with z-[200] */}
      {isDeleteModalOpen && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setIsDeleteModalOpen(false); }}
        >
          <div 
            className="bg-surface w-full max-w-sm rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-600">
              <Trash2 className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-ink-primary">Permanently Delete?</h3>
            </div>

            {deleteError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200">
                {deleteError}
              </div>
            )}

            <p className="text-xs text-ink-muted leading-relaxed">
              Are you sure you want to permanently remove this expense record (<strong className="text-ink-primary">{formatINR(expense.amount)}</strong>)? It will be hidden from all ledgers.
            </p>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={deleting}
                className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteExpense}
                disabled={deleting}
                className="px-5 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-xs transition flex items-center gap-1.5"
              >
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Yes, Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
