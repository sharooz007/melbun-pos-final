'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { 
  addExpenseAction, 
  voidExpenseAction, 
  getExpensesAction,
  updateExpenseAction,
  deleteExpenseAction,
  getExpensesSummaryMetricsAction,
  getExpenseCategoriesAction,
  createExpenseCategoryAction,
  updateExpenseCategoryAction,
  deleteExpenseCategoryAction
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
  Calendar,
  Tags,
  FolderPlus,
  Check
} from 'lucide-react';

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

  // State: Data List & Categories
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // P2-16: Server-side pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Add Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ExpensePaymentMethod>('CASH');
  const [notes, setNotes] = useState('');
  const [backdateInput, setBackdateInput] = useState('');
  const [addError, setAddError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Quick Inline Category creation state inside Add / Edit modals
  const [isAddingNewCatInline, setIsAddingNewCatInline] = useState(false);
  const [inlineNewCatName, setInlineNewCatName] = useState('');
  const [inlineCatLoading, setInlineCatLoading] = useState(false);

  // Categories Manager Modal State
  const [isCategoriesModalOpen, setIsCategoriesModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [savingCatEdit, setSavingCatEdit] = useState(false);

  // Edit Expense Modal State
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
      if (selectedExpenseCat !== 'ALL' && item.category.toLowerCase() !== selectedExpenseCat.toLowerCase()) {
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

  // Load Expenses & Categories
  const loadExpenses = useCallback(async (targetPage = page, targetPageSize = pageSize) => {
    setLoadingList(true);
    try {
      const [res, metricsRes, catRes] = await Promise.all([
        getExpensesAction(targetPage, targetPageSize),
        getExpensesSummaryMetricsAction(),
        getExpenseCategoriesAction()
      ]);
      if (res.success && res.data) {
        setExpenses(res.data.items || []);
        setTotalCount(res.data.total || 0);
        setTotalPages(res.data.totalPages || 1);
      }
      if (metricsRes.success) {
        setMetricsSummary(metricsRes.data);
      }
      if (catRes.success) {
        setCategories(catRes.data);
      }
    } finally {
      setLoadingList(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const loadCategoriesOnly = async () => {
    const res = await getExpenseCategoriesAction();
    if (res.success) {
      setCategories(res.data);
    }
  };

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

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    if (isSubmittingRef.current || creatingCategory) return;

    isSubmittingRef.current = true;
    setCreatingCategory(true);
    setCategoryError('');

    try {
      const res = await createExpenseCategoryAction(newCategoryName.trim());
      if (res.success) {
        setNewCategoryName('');
        await loadCategoriesOnly();
      } else {
        setCategoryError(res.error || 'Failed to create category');
      }
    } finally {
      isSubmittingRef.current = false;
      setCreatingCategory(false);
    }
  };

  const handleCreateCategoryInline = async (target: 'add' | 'edit') => {
    if (!inlineNewCatName.trim() || inlineCatLoading) return;

    setInlineCatLoading(true);
    try {
      const res = await createExpenseCategoryAction(inlineNewCatName.trim());
      if (res.success) {
        const createdName = res.data.name;
        if (target === 'add') setCategory(createdName);
        if (target === 'edit') setEditCategory(createdName);
        setInlineNewCatName('');
        setIsAddingNewCatInline(false);
        await loadCategoriesOnly();
      } else {
        if (target === 'add') setAddError(res.error || 'Failed to create category');
        if (target === 'edit') setEditError(res.error || 'Failed to create category');
      }
    } finally {
      setInlineCatLoading(false);
    }
  };

  const handleUpdateCategory = async (catId: string) => {
    if (!editingCatName.trim()) return;
    if (isSubmittingRef.current || savingCatEdit) return;

    isSubmittingRef.current = true;
    setSavingCatEdit(true);
    setCategoryError('');

    try {
      const res = await updateExpenseCategoryAction(catId, editingCatName.trim());
      if (res.success) {
        setEditingCatId(null);
        setEditingCatName('');
        await loadCategoriesOnly();
      } else {
        setCategoryError(res.error || 'Failed to update category');
      }
    } finally {
      isSubmittingRef.current = false;
      setSavingCatEdit(false);
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      const res = await deleteExpenseCategoryAction(catId);
      if (res.success) {
        await loadCategoriesOnly();
      } else {
        setCategoryError(res.error || 'Failed to delete category');
      }
    } catch (err: any) {
      setCategoryError(err?.message || 'Error deleting category');
    } finally {
      isSubmittingRef.current = false;
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

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <button
            onClick={() => { loadExpenses(); }}
            disabled={loadingList}
            className="p-2.5 bg-surface hover:bg-row-alt text-ink-muted hover:text-ink-primary border border-border rounded-xl transition shadow-2xs min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
            title="Refresh Ledger"
          >
            <RefreshCw className={`w-4 h-4 ${loadingList ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => {
              setCategoryError('');
              setIsCategoriesModalOpen(true);
            }}
            className="px-3.5 py-2.5 bg-surface hover:bg-row-alt text-ink-primary border border-border rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-2xs min-h-[40px] cursor-pointer"
          >
            <Tags className="w-4 h-4 text-accent" />
            <span>Categories</span>
          </button>

          <button
            onClick={() => {
              setAddError('');
              setIsAddingNewCatInline(false);
              setIsAddModalOpen(true);
            }}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-xs min-h-[40px] cursor-pointer"
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
      <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar items-center">
        <button
          onClick={() => setSelectedExpenseCat('ALL')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap min-h-[34px] cursor-pointer ${
            selectedExpenseCat === 'ALL'
              ? 'bg-accent text-white shadow-xs'
              : 'bg-surface text-ink-muted hover:text-ink-primary border border-border hover:bg-row-alt'
          }`}
        >
          All Categories ({expenses.length})
        </button>
        {categories.map((cat) => {
          const count = expenses.filter(e => e.category.toLowerCase() === cat.name.toLowerCase()).length;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedExpenseCat(cat.name)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap min-h-[34px] cursor-pointer ${
                selectedExpenseCat.toLowerCase() === cat.name.toLowerCase()
                  ? 'bg-accent text-white shadow-xs'
                  : 'bg-surface text-ink-muted hover:text-ink-primary border border-border hover:bg-row-alt'
              }`}
            >
              {cat.name} {count > 0 ? `(${count})` : ''}
            </button>
          );
        })}
        <button
          onClick={() => {
            setCategoryError('');
            setIsCategoriesModalOpen(true);
          }}
          className="px-3 py-1.5 rounded-xl text-xs font-bold text-accent border border-dashed border-accent/40 hover:border-accent bg-accent/5 hover:bg-accent/10 transition whitespace-nowrap min-h-[34px] flex items-center gap-1 cursor-pointer"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          <span>+ Add Category</span>
        </button>
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
                          className="p-1.5 text-ink-muted hover:text-accent hover:bg-row-alt rounded-lg transition cursor-pointer"
                          title="Edit Expense"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {!item.is_voided && (
                        <button
                          onClick={(e) => openVoidModal(e, item)}
                          className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                          title="Void Expense"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        onClick={(e) => openDeleteModal(e, item)}
                        className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
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

        {/* P2-16: Server-Side Pagination Bar */}
        <div className="p-3.5 border-t border-border bg-row-alt/40 text-xs text-ink-muted flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-2">
            <span>Showing {totalCount === 0 ? 0 : (page - 1) * pageSize + 1} - {Math.min(page * pageSize, totalCount)} of {totalCount} records</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="bg-surface border border-border rounded px-2 py-1 text-ink-primary font-mono text-xs focus:ring-1 focus:ring-accent outline-none"
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(prev => Math.max(1, prev - 1))}
              disabled={page <= 1 || loadingList}
              className="px-2.5 py-1 bg-surface border border-border rounded-lg text-ink-primary font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-hover transition text-xs"
            >
              Previous
            </button>
            <span className="font-mono font-bold text-ink-primary">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages || loadingList}
              className="px-2.5 py-1 bg-surface border border-border rounded-lg text-ink-primary font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-hover transition text-xs"
            >
              Next
            </button>
          </div>
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
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full cursor-pointer"
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
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-bold text-ink-primary">
                    Category <span className="text-red-500">*</span>
                  </label>
                  {!isAddingNewCatInline ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingNewCatInline(true);
                        setInlineNewCatName('');
                      }}
                      className="text-[11px] font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <PlusCircle className="w-3 h-3" /> + Create New Category
                    </button>
                  ) : null}
                </div>

                {isAddingNewCatInline ? (
                  <div className="flex gap-2 mb-2 p-2 bg-row-alt/60 rounded-xl border border-border">
                    <input 
                      type="text"
                      value={inlineNewCatName}
                      onChange={e => setInlineNewCatName(e.target.value)}
                      placeholder="Enter new category name..."
                      className="flex-1 p-2 border border-border rounded-lg text-xs bg-surface text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleCreateCategoryInline('add')}
                      disabled={inlineCatLoading || !inlineNewCatName.trim()}
                      className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg shadow-2xs disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                    >
                      {inlineCatLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      <span>Add</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingNewCatInline(false)}
                      className="p-1.5 text-ink-muted hover:text-ink-primary rounded-lg cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <input 
                    type="text" 
                    value={category} 
                    onChange={e => setCategory(e.target.value)} 
                    required
                    placeholder="Type or select a category below..."
                    className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                  />
                )}

                {/* Preset & User Category Chips */}
                <div className="flex flex-wrap gap-1.5 mt-2 max-h-28 overflow-y-auto p-1">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setCategory(cat.name);
                        setIsAddingNewCatInline(false);
                      }}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                        category.toLowerCase() === cat.name.toLowerCase()
                          ? 'bg-accent border-accent text-white font-bold shadow-2xs'
                          : 'bg-row-alt border-border text-ink-muted hover:text-ink-primary hover:border-gray-400'
                      }`}
                    >
                      {cat.name}
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
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
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
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
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
                  className="px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={submitting} 
                  className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition cursor-pointer"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 
                  <span>Record Expense</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MANAGE CATEGORIES MODAL with z-[200] */}
      {isCategoriesModalOpen && (
        <div 
          className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !creatingCategory && !savingCatEdit) setIsCategoriesModalOpen(false); }}
        >
          <div 
            className="bg-surface rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <h2 className="text-base font-bold text-ink-primary flex items-center gap-2">
                <Tags className="w-5 h-5 text-accent" />
                Manage Expense Categories
              </h2>
              <button 
                onClick={() => setIsCategoriesModalOpen(false)} 
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {categoryError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{categoryError}</span>
              </div>
            )}

            {/* Add Category Form */}
            <form onSubmit={handleCreateCategory} className="flex gap-2">
              <input 
                type="text" 
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                placeholder="New category name (e.g. Courier, Legal...)"
                required
                className="flex-1 p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={creatingCategory || !newCategoryName.trim()}
                className="px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 flex items-center gap-1.5 transition cursor-pointer"
              >
                {creatingCategory ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
                <span>Create</span>
              </button>
            </form>

            {/* Categories List */}
            <div className="space-y-1.5 max-h-64 overflow-y-auto divide-y divide-border border border-border rounded-xl p-2 bg-row-alt/30">
              {categories.map((cat) => (
                <div key={cat.id} className="pt-1.5 pb-1.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2">
                  {editingCatId === cat.id ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <input 
                        type="text" 
                        value={editingCatName}
                        onChange={e => setEditingCatName(e.target.value)}
                        className="flex-1 p-1.5 border border-border rounded-lg text-xs bg-surface text-ink-primary"
                        autoFocus
                      />
                      <button
                        onClick={() => handleUpdateCategory(cat.id)}
                        disabled={savingCatEdit}
                        className="p-1.5 bg-accent text-white rounded-lg text-xs font-bold cursor-pointer"
                        title="Save Name"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingCatId(null)}
                        className="p-1.5 text-ink-muted hover:text-ink-primary rounded-lg cursor-pointer"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-xs font-bold text-ink-primary truncate">{cat.name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingCatId(cat.id);
                            setEditingCatName(cat.name);
                          }}
                          className="p-1 text-ink-muted hover:text-accent hover:bg-row-alt rounded-md transition cursor-pointer"
                          title="Rename Category"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(cat.id)}
                          className="p-1 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded-md transition cursor-pointer"
                          title="Delete Category"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-border">
              <button 
                type="button" 
                onClick={() => setIsCategoriesModalOpen(false)}
                className="px-4 py-2 text-xs font-bold bg-row-alt hover:bg-row-alt/80 text-ink-primary rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
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
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full cursor-pointer"
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
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-bold text-ink-primary">
                    Category <span className="text-red-500">*</span>
                  </label>
                  {!isAddingNewCatInline && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingNewCatInline(true);
                        setInlineNewCatName('');
                      }}
                      className="text-[11px] font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <PlusCircle className="w-3 h-3" /> + Create New Category
                    </button>
                  )}
                </div>

                {isAddingNewCatInline ? (
                  <div className="flex gap-2 mb-2 p-2 bg-row-alt/60 rounded-xl border border-border">
                    <input 
                      type="text"
                      value={inlineNewCatName}
                      onChange={e => setInlineNewCatName(e.target.value)}
                      placeholder="Enter new category name..."
                      className="flex-1 p-2 border border-border rounded-lg text-xs bg-surface text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleCreateCategoryInline('edit')}
                      disabled={inlineCatLoading || !inlineNewCatName.trim()}
                      className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg shadow-2xs disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                    >
                      {inlineCatLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      <span>Add</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingNewCatInline(false)}
                      className="p-1.5 text-ink-muted hover:text-ink-primary rounded-lg cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <input 
                    type="text" 
                    value={editCategory} 
                    onChange={e => setEditCategory(e.target.value)} 
                    required
                    className="w-full p-2.5 border border-border rounded-xl text-xs bg-surface text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none" 
                  />
                )}

                {/* Preset & User Category Chips */}
                <div className="flex flex-wrap gap-1.5 mt-2 max-h-24 overflow-y-auto p-1">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setEditCategory(cat.name);
                        setIsAddingNewCatInline(false);
                      }}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                        editCategory.toLowerCase() === cat.name.toLowerCase()
                          ? 'bg-accent border-accent text-white font-bold shadow-2xs'
                          : 'bg-row-alt border-border text-ink-muted hover:text-ink-primary hover:border-gray-400'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
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
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
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
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
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
                  className="px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={editing} 
                  className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition cursor-pointer"
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
                className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={handleVoidExpense} 
                disabled={voiding} 
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition cursor-pointer"
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
                className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteExpense}
                disabled={deleting}
                className="px-5 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
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
