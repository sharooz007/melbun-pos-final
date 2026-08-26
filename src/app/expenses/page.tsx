'use client'

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Calendar, 
  IndianRupee, 
  CreditCard, 
  Banknote, 
  Smartphone, 
  AlertTriangle, 
  CheckCircle2, 
  ShieldAlert, 
  RefreshCw, 
  X, 
  FileText,
  Clock
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

const formatINR = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2
  }).format(amount);
};

export default function ExpensesPage() {
  // State: Data List
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // State: Form Inputs
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ExpensePaymentMethod>('CASH');
  const [notes, setNotes] = useState('');
  const [backdateInput, setBackdateInput] = useState(''); // YYYY-MM-DDTHH:mm

  // State: Operations & Locks
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  
  const [selectedVoidItem, setSelectedVoidItem] = useState<ExpenseItem | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);

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

  // Hard Delete State
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

  // Synchronous submission lock to prevent double-click race conditions
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
      } else {
        setStatus({ type: 'error', msg: res.error || 'Failed to load expenses' });
      }
      if (metricsRes.success && metricsRes.data) {
        setMetricsSummary(metricsRes.data);
      }
    } catch (err: unknown) {
      setStatus({ 
        type: 'error', 
        msg: err instanceof Error ? err.message : 'Unexpected error loading expenses' 
      });
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  // Handle Add Expense
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || submitting) return;

    const trimmedCat = category.trim();
    const parsedAmount = parseFloat(amount);

    if (!trimmedCat || trimmedCat.length < 2) {
      setStatus({ type: 'error', msg: 'Category must be at least 2 characters.' });
      return;
    }

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setStatus({ type: 'error', msg: 'Please enter a valid positive expense amount.' });
      return;
    }

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);
      setStatus(null);

      const res = await addExpenseAction({
        category: trimmedCat,
        amount: parsedAmount,
        payment_method: method,
        notes: notes.trim() ? notes.trim() : null,
        created_at: backdateInput ? new Date(backdateInput).toISOString() : null
      });

      if (!res.success) {
        setStatus({ type: 'error', msg: res.error || 'Failed to record expense.' });
      } else {
        setStatus({ type: 'success', msg: `Expense of ${formatINR(parsedAmount)} recorded successfully!` });
        // Reset form
        setCategory('');
        setAmount('');
        setNotes('');
        setBackdateInput('');
        setMethod('CASH');
        // Refresh list
        await loadExpenses();
      }
    } catch (err: unknown) {
      setStatus({ 
        type: 'error', 
        msg: err instanceof Error ? err.message : 'An unexpected error occurred.' 
      });
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  // Open Void Modal
  const openVoidModal = (item: ExpenseItem) => {
    if (item.is_voided) return;
    setSelectedVoidItem(item);
    setVoidReason('');
    setVoidError(null);
  };

  const closeVoidModal = () => {
    if (voiding) return;
    setSelectedVoidItem(null);
    setVoidReason('');
    setVoidError(null);
  };

  // Handle Void Expense
  const handleConfirmVoid = async () => {
    if (isSubmittingRef.current || voiding || !selectedVoidItem) return;

    const trimmedReason = voidReason.trim();
    if (trimmedReason.length < 3) {
      setVoidError('Please provide a reason with at least 3 characters.');
      return;
    }

    try {
      isSubmittingRef.current = true;
      setVoiding(true);
      setVoidError(null);

      const res = await voidExpenseAction({
        expense_id: selectedVoidItem.id,
        reason: trimmedReason
      });

      if (!res.success) {
        setVoidError(res.error || 'Failed to void expense.');
      } else {
        setStatus({
          type: 'success',
          msg: `Expense "${selectedVoidItem.category}" (${formatINR(selectedVoidItem.amount)}) has been voided.`
        });

        // Optimistically update list to show red strikethrough immediately
        setExpenses((prev) =>
          prev.map((item) =>
            item.id === selectedVoidItem.id
              ? { ...item, is_voided: true, notes: `${item.notes || ''} | VOIDED: ${trimmedReason}` }
              : item
          )
        );

        setSelectedVoidItem(null);
        setVoidReason('');
        loadExpenses();
      }
    } catch (err: unknown) {
      setVoidError(err instanceof Error ? err.message : 'Unexpected error during void');
    } finally {
      isSubmittingRef.current = false;
      setVoiding(false);
    }
  };

  const openEditModal = (item: ExpenseItem) => {
    if (item.is_voided) {
      alert('Voided expenses cannot be edited.');
      return;
    }
    setSelectedEditItem(item);
    setEditCategory(item.category);
    setEditAmount(item.amount.toString());
    setEditMethod(item.payment_method);
    setEditNotes(item.notes || '');
    // Handle timezone parsing for datetime-local without UTC drift
    if (item.created_at) {
      const d = new Date(item.created_at);
      const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setEditDate(localIso);
    } else {
      setEditDate('');
    }
    setEditError('');
    setIsEditModalOpen(true);
  };

  const handleEditExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEditItem) return;
    setEditing(true);
    setEditError('');
    try {
      const res = await updateExpenseAction(selectedEditItem.id, {
        category: editCategory,
        amount: parseFloat(editAmount),
        payment_method: editMethod,
        notes: editNotes,
        created_at: editDate ? new Date(editDate).toISOString() : null
      });
      if (res.success) {
        setIsEditModalOpen(false);
        loadExpenses();
      } else {
        setEditError(res.error || 'Failed to update expense');
      }
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setEditing(false);
    }
  };

  const openDeleteModal = (item: ExpenseItem) => {
    setSelectedDeleteItem(item);
    setDeleteError('');
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!selectedDeleteItem) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await deleteExpenseAction(selectedDeleteItem.id);
      if (res.success) {
        setIsDeleteModalOpen(false);
        loadExpenses();
      } else {
        setDeleteError(res.error || 'Failed to delete expense');
      }
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  // Aggregates for Metric Cards (Prioritize server-side full database summary metricsSummary, Bug #115)
  const activeExpenses = expenses.filter((e) => !e.is_voided);
  const totalExpenseSum = metricsSummary ? metricsSummary.totalActiveSum : activeExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const cashExpenseSum = metricsSummary ? metricsSummary.cashSum : activeExpenses.filter((e) => e.payment_method === 'CASH').reduce((sum, e) => sum + Number(e.amount), 0);
  const upiExpenseSum = metricsSummary ? metricsSummary.upiSum : activeExpenses.filter((e) => e.payment_method === 'UPI').reduce((sum, e) => sum + Number(e.amount), 0);
  const voidedCount = metricsSummary ? metricsSummary.voidedCount : expenses.filter((e) => e.is_voided).length;

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-7xl w-full mx-auto">
      {/* Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <TrendingDown className="w-8 h-8 text-accent" />
            Expenses Management
          </h1>
          <p className="text-gray-500 mt-1">
            Track, backdate, and audit operational store expenditures.
          </p>
        </div>
        <button
          onClick={loadExpenses}
          disabled={loadingList}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl shadow-xs hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loadingList ? 'animate-spin' : ''}`} />
          Refresh
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

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-xs">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Active</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{formatINR(totalExpenseSum)}</p>
          <p className="text-xs text-gray-400 mt-1">{activeExpenses.length} records</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-xs">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
            <Banknote className="w-3.5 h-3.5 text-emerald-600" /> Cash
          </p>
          <p className="text-xl font-bold text-emerald-700 mt-2">{formatINR(cashExpenseSum)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-xs">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-blue-600" /> UPI
          </p>
          <p className="text-xl font-bold text-blue-700 mt-2">{formatINR(upiExpenseSum)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-xs">
          <p className="text-xs font-semibold text-red-500 uppercase tracking-wider">Voided Items</p>
          <p className="text-xl font-bold text-red-600 mt-2">{voidedCount}</p>
          <p className="text-xs text-red-400 mt-1">Soft-deleted</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Form: Add Expense */}
        <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
          <div className="flex items-center gap-2 pb-4 border-b border-gray-100">
            <PlusCircle className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-bold text-gray-900">Record New Expense</h2>
          </div>

          <form onSubmit={handleAddExpense} className="space-y-4">
            {/* Category Input & Quick Presets */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                Category <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Electricity Bill, Shop Rent"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
                className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-accent focus:outline-hidden"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {CATEGORY_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCategory(preset)}
                    className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                Amount (₹) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 font-semibold">
                  ₹
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  className="w-full text-sm pl-8 p-3 border border-gray-300 rounded-xl font-mono font-medium focus:ring-2 focus:ring-accent focus:outline-hidden"
                />
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                Payment Method <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['CASH', 'UPI'] as ExpensePaymentMethod[]).map((pm) => (
                  <button
                    key={pm}
                    type="button"
                    onClick={() => setMethod(pm)}
                    className={`py-2.5 px-3 text-xs font-bold rounded-xl border flex flex-col items-center gap-1 transition-colors ${
                      method === pm
                        ? 'bg-accent text-white border-accent shadow-xs'
                        : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {pm === 'CASH' && <Banknote className="w-4 h-4" />}
                    {pm === 'UPI' && <Smartphone className="w-4 h-4" />}
                    {pm}
                  </button>
                ))}
              </div>
            </div>

            {/* Backdating / Custom Date */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-gray-500" />
                  Date & Time (Optional Backdating)
                </label>
                {backdateInput && (
                  <button
                    type="button"
                    onClick={() => setBackdateInput('')}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Reset to Now
                  </button>
                )}
              </div>
              <input
                type="datetime-local"
                value={backdateInput}
                onChange={(e) => setBackdateInput(e.target.value)}
                className="w-full text-sm p-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-accent focus:outline-hidden"
              />
              <p className="text-xs text-gray-400">Leave blank to stamp with the current time.</p>
            </div>

            {/* Notes / Memo */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-gray-500" />
                Notes / Audit Remarks
              </label>
              <textarea
                placeholder="Optional explanation or receipt reference..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-accent focus:outline-hidden"
              />
            </div>

            {/* Submit Button with Synchronous Lock */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Recording Expense...
                </>
              ) : (
                'Add Expense'
              )}
            </button>
          </form>
        </div>

        {/* Ledger: Past Expenses Table */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-gray-50/50">
            <div>
              <h2 className="text-base font-bold text-gray-900">Expense Ledger & Audit History</h2>
              <span className="text-xs font-semibold text-gray-500">
                Showing {filteredExpenses.length} of {expenses.length} records
              </span>
            </div>

            {/* Live Search & Category Filter */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search notes, category..."
                value={expenseSearch}
                onChange={(e) => setExpenseSearch(e.target.value)}
                className="text-xs px-3 py-1.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent w-36 sm:w-44"
              />
              <select
                value={selectedExpenseCat}
                onChange={(e) => setSelectedExpenseCat(e.target.value)}
                className="text-xs px-2.5 py-1.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="ALL">All Categories</option>
                {CATEGORY_PRESETS.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Mobile Expense Cards View (< 640px) */}
          <div className="block sm:hidden p-4 space-y-3">
            {loadingList ? (
              <div className="py-8 text-center text-gray-400 text-xs">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-gray-300" />
                Loading expense records...
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-xs">
                No matching expense records found.
              </div>
            ) : (
              filteredExpenses.map((item) => (
                <div key={item.id} className="bg-surface p-4 rounded-xl border border-gray-200 shadow-xs space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className={`font-semibold text-sm ${item.is_voided ? 'line-through text-red-600' : 'text-gray-900'}`}>
                        {item.category}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-gray-400" />
                        {new Date(item.created_at).toLocaleString('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short'
                        })}
                      </div>
                    </div>
                    <span className={`font-mono font-bold text-sm ${item.is_voided ? 'line-through text-red-500' : 'text-gray-900'}`}>
                      {formatINR(Number(item.amount))}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        item.payment_method === 'CASH'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}>
                        {item.payment_method}
                      </span>
                      {item.is_voided ? (
                        <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                          VOIDED
                        </span>
                      ) : null}
                    </div>

                    {!item.is_voided && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => openVoidModal(item)}
                          className="px-2.5 py-1 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md"
                        >
                          Void
                        </button>
                      </div>
                    )}
                  </div>

                  {item.notes && (
                    <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded-lg">
                      {item.notes}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Desktop Expenses Table (>= 640px) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="py-3.5 px-5">Date & Time</th>
                  <th className="py-3.5 px-5">Category</th>
                  <th className="py-3.5 px-5">Method</th>
                  <th className="py-3.5 px-5">Notes</th>
                  <th className="py-3.5 px-5 text-right">Amount</th>
                  <th className="py-3.5 px-5 text-center">Status</th>
                  <th className="py-3.5 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {loadingList ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-400">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-300" />
                      Loading expense records...
                    </td>
                  </tr>
                ) : filteredExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-400">
                      No matching expense records found.
                    </td>
                  </tr>
                ) : (
                  filteredExpenses.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/60 transition-colors">
                      {/* Date */}
                      <td className="py-3.5 px-5 text-xs text-gray-500 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-gray-400" />
                          <span>{new Date(item.created_at).toLocaleString('en-IN', {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })}</span>
                        </div>
                      </td>

                      {/* Category (Red Strikethrough if voided) */}
                      <td className="py-3.5 px-5 font-semibold text-gray-900">
                        {item.is_voided ? (
                          <span className="line-through text-red-600 font-mono">
                            {item.category}
                          </span>
                        ) : (
                          <span>{item.category}</span>
                        )}
                      </td>

                      {/* Payment Method Badge */}
                      <td className="py-3.5 px-5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
                          item.payment_method === 'CASH'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : item.payment_method === 'UPI'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-purple-50 text-purple-700 border border-purple-200'
                        }`}>
                          {item.payment_method}
                        </span>
                      </td>

                      {/* Notes */}
                      <td className="py-3.5 px-5 text-xs text-gray-600 max-w-[200px] truncate" title={item.notes || ''}>
                        {item.notes || <span className="text-gray-300 italic">—</span>}
                      </td>

                      {/* Amount (Red Strikethrough if voided) */}
                      <td className="py-3.5 px-5 text-right font-medium">
                        {item.is_voided ? (
                          <span className="line-through text-red-500 font-mono">
                            {formatINR(Number(item.amount))}
                          </span>
                        ) : (
                          <span className="text-gray-900 font-mono font-bold">
                            {formatINR(Number(item.amount))}
                          </span>
                        )}
                      </td>

                      {/* Status Badge */}
                      <td className="py-3.5 px-5 text-center">
                        {item.is_voided ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
                            VOIDED
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            ACTIVE
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-5 text-right flex justify-end gap-2">
                        {!item.is_voided && (
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            className="px-3 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                          >
                            Edit
                          </button>
                        )}
                        {!item.is_voided && (
                          <button
                            type="button"
                            onClick={() => openVoidModal(item)}
                            className="px-3 py-1 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
                          >
                            Void
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openDeleteModal(item)}
                          className="px-3 py-1 text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-200 border border-gray-300 rounded-lg transition-colors"
                        >
                          Del
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Destructive Void Confirmation Modal */}
      {selectedVoidItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-5 animate-in fade-in zoom-in duration-150">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-red-100 text-red-600 rounded-xl">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Void Expense Confirmation</h3>
                  <p className="text-xs text-gray-500 font-mono">
                    {selectedVoidItem.category} ({formatINR(Number(selectedVoidItem.amount))})
                  </p>
                </div>
              </div>
              <button
                onClick={closeVoidModal}
                disabled={voiding}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-800 space-y-1">
              <p className="font-semibold">⚠️ Soft-Delete Audit Operation</p>
              <p>
                Voiding this expense record will cross it out in reports, exclude it from Net Profit calculations, and preserve it with your void reason for audit compliance.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700">
                Reason for Voiding <span className="text-red-500">*</span>
              </label>
              <textarea
                value={voidReason}
                onChange={(e) => {
                  setVoidReason(e.target.value);
                  if (voidError) setVoidError(null);
                }}
                placeholder="e.g. Duplicate entry, incorrect amount recorded by cashier, supplier refunded..."
                rows={3}
                className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:outline-hidden"
              />
              {voidError && (
                <p className="text-xs text-red-600 font-medium">{voidError}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeVoidModal}
                disabled={voiding}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmVoid}
                disabled={voiding}
                className="px-5 py-2 text-sm font-semibold text-white bg-accent hover:bg-accent-hover rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {voiding ? 'Voiding Record...' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Expense Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-5 animate-in fade-in zoom-in duration-150">
            <h2 className="text-lg font-bold text-gray-900">Edit Expense</h2>
            {editError && (
              <div className="p-3 bg-red-50 text-red-700 text-[13px] rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> {editError}
              </div>
            )}
            <form onSubmit={handleEditExpense} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Category</label>
                <input type="text" value={editCategory} onChange={e => setEditCategory(e.target.value)} required className="w-full text-sm p-3 border border-gray-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Amount</label>
                <input type="number" step="0.01" value={editAmount} onChange={e => setEditAmount(e.target.value)} required className="w-full text-sm p-3 border border-gray-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Method</label>
                <select value={editMethod} onChange={e => setEditMethod(e.target.value as ExpensePaymentMethod)} className="w-full text-sm p-3 border border-gray-300 rounded-xl">
                  <option value="CASH">CASH</option>
                  <option value="UPI">UPI</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Date</label>
                <input type="datetime-local" value={editDate} onChange={e => setEditDate(e.target.value)} className="w-full text-sm p-3 border border-gray-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Notes</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} className="w-full text-sm p-3 border border-gray-300 rounded-xl" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={editing} className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                  {editing ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permanent Delete Modal */}
      {isDeleteModalOpen && selectedDeleteItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-5 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-red-100 text-red-600 rounded-xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Permanent Delete</h3>
              </div>
            </div>
            
            <p className="text-sm text-gray-600">
              Are you sure you want to completely delete the expense <strong>{selectedDeleteItem.category}</strong> for <strong>{formatINR(Number(selectedDeleteItem.amount))}</strong>? This action cannot be undone and it will be wiped from the database.
            </p>

            {deleteError && (
              <p className="text-xs text-red-600 font-medium">{deleteError}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsDeleteModalOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button type="button" onClick={handleConfirmDelete} disabled={deleting} className="px-5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
                {deleting ? 'Deleting...' : 'Permanent Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
