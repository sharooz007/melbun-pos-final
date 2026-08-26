'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { 
  addExpenseAction, 
  voidExpenseAction, 
  getExpensesAction,
  updateExpenseAction,
  deleteExpenseAction,
  getExpensesSummaryMetricsAction
} from '@/lib/actions/expenses';
import { ExpenseItem, ExpensePaymentMethod } from '@/types/expenses';
import { 
  TrendingDown, 
  PlusCircle, 
  Search, 
  IndianRupee, 
  CreditCard, 
  AlertTriangle, 
  CheckCircle2, 
  ShieldAlert, 
  RefreshCw, 
  X, 
  FileText,
  Clock,
  Pencil,
  Ban,
  Trash2,
  Loader2,
  Calendar
} from 'lucide-react';

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

export default function ExpensesClient() {
  const router = useRouter();

  // State: Data List
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Add Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ExpensePaymentMethod>('CASH');
  const [notes, setNotes] = useState('');
  const [backdateInput, setBackdateInput] = useState('');
  const [addError, setAddError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedEditItem, setSelectedEditItem] = useState<ExpenseItem | null>(null);
  const [editCategory, setEditCategory] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editMethod, setEditMethod] = useState<ExpensePaymentMethod>('CASH');
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editError, setEditError] = useState('');
  const [editing, setEditing] = useState(false);

  // Void Modal State
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [selectedVoidItem, setSelectedVoidItem] = useState<ExpenseItem | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

  // Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedDeleteItem, setSelectedDeleteItem] = useState<ExpenseItem | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Search & Filter State
  const [expenseSearch, setExpenseSearch] = useState('');
  const [selectedExpenseCat, setSelectedExpenseCat] = useState('ALL');
  const [metricsSummary, setMetricsSummary] = useState({
    totalActiveSum: 0,
    cashSum: 0,
    upiSum: 0,
    voidedCount: 0,
    totalCount: 0
  });

  const isSubmittingRef = useRef(false);

  // Filtered expenses list
  const filteredExpenses = useMemo(() => {
    return expenses.filter(item => {
      if (selectedExpenseCat !== 'ALL' && item.category !== selectedExpenseCat) {
        return false;
      }
      if (expenseSearch.trim()) {
        const q = expenseSearch.trim().toLowerCase();
        const matchCat = item.category.toLowerCase().includes(q);
        const matchNotes = item.notes?.toLowerCase().includes(q);
        const matchAmount = item.amount.toString().includes(q);
        const matchMethod = item.payment_method.toLowerCase().includes(q);
        if (!matchCat && !matchNotes && !matchAmount && !matchMethod) return false;
      }
      return true;
    });
  }, [expenses, selectedExpenseCat, expenseSearch]);

  // Load Expenses
  const loadExpenses = useCallback(async () => {
    setLoadingList(true);
    try {
      const [res, metricsRes] = await Promise.all([
        getExpensesAction(100),
        getExpensesSummaryMetricsAction()
      ]);
      if (res.success) {
        setExpenses(res.data);
      }
      if (metricsRes.success) {
        setMetricsSummary(metricsRes.data);
      }
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || submitting) return;

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setAddError('Please enter a valid expense amount.');
      return;
    }
    if (!category.trim()) {
      setAddError('Category cannot be empty.');
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);
    setAddError('');

    try {
      const res = await addExpenseAction({
        category: category.trim(),
        amount: numAmount,
        payment_method: method,
        notes: notes.trim() || null,
        created_at: backdateInput ? new Date(backdateInput).toISOString() : null
      });

      if (res.success) {
        setIsAddModalOpen(false);
        setCategory('');
        setAmount('');
        setNotes('');
        setBackdateInput('');
        setMethod('CASH');
        await loadExpenses();
      } else {
        setAddError(res.error || 'Failed to add expense');
      }
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const openEditModal = (e: React.MouseEvent, item: ExpenseItem) => {
    e.stopPropagation();
    if (item.is_voided) return;
    setSelectedEditItem(item);
    setEditCategory(item.category);
    setEditAmount(item.amount.toString());
    setEditMethod(item.payment_method);
    setEditNotes(item.notes || '');

    const dt = new Date(item.created_at);
    const localIso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setEditDate(localIso);

    setEditError('');
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEditItem) return;
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
      const res = await updateExpenseAction(selectedEditItem.id, {
        category: editCategory.trim(),
        amount: numAmount,
        payment_method: editMethod,
        notes: editNotes.trim() || null,
        created_at: editDate ? new Date(editDate).toISOString() : null
      });

      if (res.success) {
        setIsEditModalOpen(false);
        await loadExpenses();
      } else {
        setEditError(res.error || 'Failed to update expense');
      }
    } finally {
      isSubmittingRef.current = false;
      setEditing(false);
    }
  };

  const openVoidModal = (e: React.MouseEvent, item: ExpenseItem) => {
    e.stopPropagation();
    setSelectedVoidItem(item);
    setVoidReason('');
    setVoidError(null);
    setIsVoidModalOpen(true);
  };

  const handleVoidExpense = async () => {
    if (!selectedVoidItem) return;
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
        expense_id: selectedVoidItem.id,
        reason: voidReason.trim()
      });

      if (res.success) {
        setIsVoidModalOpen(false);
        setVoidReason('');
        await loadExpenses();
      } else {
        setVoidError(res.error || 'Failed to void expense');
      }
    } finally {
      isSubmittingRef.current = false;
      setVoiding(false);
    }
  };

  const openDeleteModal = (e: React.MouseEvent, item: ExpenseItem) => {
    e.stopPropagation();
    setSelectedDeleteItem(item);
    setDeleteError('');
    setIsDeleteModalOpen(true);
  };

  const handleDeleteExpense = async () => {
    if (!selectedDeleteItem) return;
    if (isSubmittingRef.current || deleting) return;

    isSubmittingRef.current = true;
    setDeleting(true);
    setDeleteError('');

    try {
      const res = await deleteExpenseAction(selectedDeleteItem.id);
      if (res.success) {
        setIsDeleteModalOpen(false);
        await loadExpenses();
      } else {
        setDeleteError(res.error || 'Failed to delete expense');
      }
    } finally {
      isSubmittingRef.current = false;
      setDeleting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-5">
      {/* Top Search & Action Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input 
            type="text"
            value={expenseSearch}
            onChange={(e) => setExpenseSearch(e.target.value)}
            placeholder="Search category, notes, amount, method..."
            className="w-full pl-10 pr-9 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent text-ink-primary shadow-2xs"
          />
          {expenseSearch && (
            <button 
              onClick={() => setExpenseSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-primary p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadExpenses}
            disabled={loadingList}
            className="p-2.5 bg-surface hover:bg-row-alt text-ink-muted hover:text-ink-primary border border-border rounded-xl transition shadow-2xs min-h-[40px] min-w-[40px] flex items-center justify-center"
            title="Refresh Ledger"
          >
            <RefreshCw className={`w-4 h-4 ${loadingList ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => {
              setAddError('');
              setIsAddModalOpen(true);
            }}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-xs min-h-[40px]"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Record Expense</span>
          </button>
        </div>
      </div>

      {/* Financial Metrics Bento Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
        <div className="bg-surface p-3.5 sm:p-4 rounded-xl border border-border shadow-2xs">
          <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block mb-1">Total Active</span>
          <div className="text-base sm:text-xl font-extrabold text-red-600 font-mono">
            {formatINR(metricsSummary.totalActiveSum)}
          </div>
          <span className="text-[11px] text-ink-muted mt-0.5 block">{metricsSummary.totalCount} active records</span>
        </div>

        <div className="bg-surface p-3.5 sm:p-4 rounded-xl border border-border shadow-2xs">
          <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block mb-1">Cash Outflow</span>
          <div className="text-base sm:text-xl font-extrabold text-emerald-700 font-mono">
            {formatINR(metricsSummary.cashSum)}
          </div>
          <span className="text-[11px] text-ink-muted mt-0.5 block">Cash drawer deduction</span>
        </div>

        <div className="bg-surface p-3.5 sm:p-4 rounded-xl border border-border shadow-2xs">
          <span className="text-[11px] font-bold text-blue-800 uppercase tracking-wider block mb-1">UPI Outflow</span>
          <div className="text-base sm:text-xl font-extrabold text-blue-700 font-mono">
            {formatINR(metricsSummary.upiSum)}
          </div>
          <span className="text-[11px] text-ink-muted mt-0.5 block">Bank / QR transfers</span>
        </div>

        <div className="bg-surface p-3.5 sm:p-4 rounded-xl border border-border shadow-2xs">
          <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block mb-1">Voided Records</span>
          <div className="text-base sm:text-xl font-extrabold text-ink-muted font-mono">
            {metricsSummary.voidedCount}
          </div>
          <span className="text-[11px] text-ink-muted mt-0.5 block">Zero financial impact</span>
        </div>
      </div>

      {/* Category Pills Filter Bar */}
      <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
        <button
          onClick={() => setSelectedExpenseCat('ALL')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap min-h-[34px] ${
            selectedExpenseCat === 'ALL'
              ? 'bg-accent text-white shadow-xs'
              : 'bg-surface text-ink-muted hover:text-ink-primary border border-border hover:bg-row-alt'
          }`}
        >
          All Categories ({expenses.length})
        </button>
        {CATEGORY_PRESETS.map((cat) => {
          const count = expenses.filter(e => e.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setSelectedExpenseCat(cat)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap min-h-[34px] ${
                selectedExpenseCat === cat
                  ? 'bg-accent text-white shadow-xs'
                  : 'bg-surface text-ink-muted hover:text-ink-primary border border-border hover:bg-row-alt'
              }`}
            >
              {cat} {count > 0 ? `(${count})` : ''}
            </button>
          );
        })}
      </div>

      {/* Expenses Ledger Directory Cards */}
      <div className="flex-1 bg-surface rounded-2xl overflow-hidden flex flex-col shadow-xs border border-border">
        <div className="flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="p-8 flex justify-center items-center">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
            </div>
          ) : filteredExpenses.length === 0 ? (
            <div className="p-12 text-center text-ink-muted text-sm space-y-2">
              <TrendingDown className="w-8 h-8 text-ink-muted mx-auto stroke-1" />
              <p className="font-semibold text-ink-primary">No expenses found</p>
              <p className="text-xs">Try adjusting your filters or record a new store expense.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredExpenses.map((item) => (
                <div
                  key={item.id}
                  onClick={() => router.push(`/expenses/${item.id}`)}
                  className={`p-4 hover:bg-row-alt/40 transition-colors cursor-pointer flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 ${
                    item.is_voided ? 'opacity-60 bg-row-alt/30' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-bold text-sm sm:text-base ${item.is_voided ? 'line-through text-ink-muted' : 'text-ink-primary'}`}>
                        {item.category}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-row-alt text-ink-muted border border-border">
                        {item.payment_method}
                      </span>
                      {item.is_voided && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-100 text-red-800 border border-red-200 uppercase">
                          Voided
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-ink-muted mt-1 flex-wrap">
                      <span className="font-mono">
                        {new Date(item.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                      {item.notes && (
                        <>
                          <span>•</span>
                          <span className="truncate max-w-xs sm:max-w-md">{item.notes}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-border" onClick={e => e.stopPropagation()}>
                    <div className="text-left sm:text-right">
                      <div className={`font-bold font-mono text-sm sm:text-base ${item.is_voided ? 'text-ink-muted line-through' : 'text-red-600'}`}>
                        {formatINR(item.amount)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {!item.is_voided && (
                        <button
                          onClick={(e) => openEditModal(e, item)}
                          className="p-1.5 text-ink-muted hover:text-accent hover:bg-row-alt rounded-lg transition"
                          title="Edit Expense"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {!item.is_voided && (
                        <button
                          onClick={(e) => openVoidModal(e, item)}
                          className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Void Expense"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        onClick={(e) => openDeleteModal(e, item)}
                        className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Delete Record"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-3.5 border-t border-border bg-row-alt/40 text-xs text-ink-muted flex justify-between items-center">
          <span>Showing {filteredExpenses.length} of {expenses.length} records</span>
        </div>
      </div>

      {/* RECORD EXPENSE MODAL with z-[200] */}
      {isAddModalOpen && (
        <div 
          className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !submitting) setIsAddModalOpen(false); }}
        >
          <div 
            className="bg-surface rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <h2 className="text-base font-bold text-ink-primary flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-accent" />
                Record Store Expense
              </h2>
              <button 
                onClick={() => setIsAddModalOpen(false)} 
                disabled={submitting}
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {addError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{addError}</span>
              </div>
            )}

            <form onSubmit={handleAddExpense} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">
                  Category <span className="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  value={category} 
                  onChange={e => setCategory(e.target.value)} 
                  required
                  placeholder="e.g. Electricity, Packaging, Staff Tea..."
                  className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                />

                {/* Preset Category Chips */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {CATEGORY_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCategory(preset)}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border transition ${
                        category === preset
                          ? 'bg-accent/15 border-accent text-accent font-bold'
                          : 'bg-row-alt border-border text-ink-muted hover:text-ink-primary'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">
                  Amount (₹) <span className="text-red-500">*</span>
                </label>
                <input 
                  type="number" 
                  step="0.01"
                  min="0.01"
                  value={amount} 
                  onChange={e => setAmount(e.target.value)} 
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
                    onClick={() => setMethod('CASH')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                      method === 'CASH'
                        ? 'bg-accent border-accent text-white shadow-xs'
                        : 'border-border bg-surface hover:bg-row-alt text-ink-primary'
                    }`}
                  >
                    <IndianRupee className="w-3.5 h-3.5" />
                    <span>CASH</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod('UPI')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                      method === 'UPI'
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
                <label className="block text-xs font-bold text-ink-primary mb-1">Backdate Entry (Optional)</label>
                <input 
                  type="datetime-local" 
                  value={backdateInput} 
                  onChange={e => setBackdateInput(e.target.value)} 
                  className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Notes / Description</label>
                <textarea 
                  rows={2} 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)} 
                  placeholder="Optional remarks..."
                  className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
                <button 
                  type="button" 
                  onClick={() => setIsAddModalOpen(false)} 
                  disabled={submitting}
                  className="px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={submitting} 
                  className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 
                  <span>Record Expense</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL with z-[200] */}
      {isEditModalOpen && selectedEditItem && (
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
      {isVoidModalOpen && selectedVoidItem && (
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
                <p className="text-xs text-ink-muted font-mono">{selectedVoidItem.category} • {formatINR(selectedVoidItem.amount)}</p>
              </div>
            </div>

            {voidError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{voidError}</span>
              </div>
            )}

            <p className="text-xs text-ink-muted leading-relaxed">
              Voiding this expense will permanently remove its financial deduction from Reports and Cash In Drawer.
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
      {isDeleteModalOpen && selectedDeleteItem && (
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
              Are you sure you want to permanently remove this expense record (<strong className="text-ink-primary">{formatINR(selectedDeleteItem.amount)}</strong>)? It will be hidden from all ledgers.
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
