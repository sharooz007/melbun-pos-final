'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { 
  Search, 
  ChevronDown, 
  ChevronRight, 
  AlertCircle, 
  Plus, 
  ArrowDownToLine, 
  Layers, 
  Pencil, 
  Trash2, 
  Package,
  Barcode,
  X,
  Clock,
  ExternalLink,
  Loader2,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  Ban,
  SlidersHorizontal,
  History
} from 'lucide-react'
import { ReceiveStockModal } from './ReceiveStockModal'
import { AddProductModal } from './AddProductModal'
import { CategoriesModal } from './CategoriesModal'
import { 
  processStockArrivalAction, 
  createProductAction, 
  deleteProductAction, 
  updateProductAction,
  getProductStockHistoryAction
} from '@/lib/actions/inventory'
import toast from 'react-hot-toast'

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

export function InventoryClient({ variants, categories }: { variants: any[], categories: any[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isReceiveModalOpen, setReceiveModalOpen] = useState(false)
  const [isAddModalOpen, setAddModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [isCatModalOpen, setCatModalOpen] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  
  // Product Stock History Modal State
  const [historyProduct, setHistoryProduct] = useState<any>(null);
  const [historyMovements, setHistoryMovements] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyVariantFilter, setHistoryVariantFilter] = useState<string>('all');

  const toggleProduct = (productId: string) => { 
    setExpandedProducts(prev => { 
      const n = new Set(prev); 
      if(n.has(productId)) n.delete(productId); 
      else n.add(productId); 
      return n; 
    }); 
  };

  const [currentPage, setCurrentPage] = useState<number>(1)
  const PAGE_SIZE = 15;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [selectedCategoryId, debouncedSearch])

  // Auto-open receive stock modal if URL param matches
  useEffect(() => {
    if (searchParams.get('action') === 'receive') {
      setReceiveModalOpen(true);
    }
  }, [searchParams]);

  // Transform flat active variants into grouped product hierarchy
  const { productsList, masterProductsMap } = useMemo(() => {
    const map = new Map<string, any>();
    
    variants.forEach(v => {
      const p = v.product;
      if (!p) return;
      
      if (!map.has(p.id)) {
        map.set(p.id, {
          id: p.id,
          name: p.name,
          category_id: p.category_id,
          pieces_per_set: p.pieces_per_set || 1,
          variants: [],
          totalStock: 0,
          created_at: v.created_at
        });
      }
      
      const prod = map.get(p.id);
      prod.variants.push(v);
      prod.totalStock += (Number(v.stock_quantity) || 0);
      if (new Date(v.created_at) > new Date(prod.created_at)) {
        prod.created_at = v.created_at;
      }
    });

    const list = Array.from(map.values()).sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return { productsList: list, masterProductsMap: map };
  }, [variants]);

  // Filter products by category and live debounced search query
  const filteredProducts = useMemo(() => {
    return productsList.filter(p => {
      const matchesCat = selectedCategoryId === 'all' || p.category_id === selectedCategoryId;
      if (!matchesCat) return false;

      if (!debouncedSearch.trim()) return true;
      const q = debouncedSearch.toLowerCase().trim();
      
      const nameMatch = p.name.toLowerCase().includes(q);
      const variantMatch = p.variants.some((v: any) => 
        v.name.toLowerCase().includes(q) || (v.barcode && v.barcode.toLowerCase().includes(q))
      );
      
      return nameMatch || variantMatch;
    });
  }, [productsList, selectedCategoryId, debouncedSearch]);

  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE) || 1;
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, currentPage]);

  const handleReceiveSubmit = async (data: any[]) => {
    const toastId = toast.loading('Receiving stock...');
    try {
      const res = await processStockArrivalAction(data)
      if (!res?.success) throw new Error(res?.error || 'Failed to receive stock')
      toast.success('Stock updated successfully', { id: toastId })
      router.refresh()
    } catch (err: any) {
      toast.error(err.message, { id: toastId })
      throw err;
    }
  }

  const handleAddSubmit = async (data: any) => {
    if (editingProduct) {
      const res = await updateProductAction(editingProduct.id, data)
      if (!res?.success) throw new Error(res?.error || 'Failed to update')
    } else {
      const res = await createProductAction(data)
      if (!res?.success) throw new Error(res?.error || 'Failed to create')
    }
    setAddModalOpen(false)
    setEditingProduct(null)
    router.refresh()
  }

  const [deletingProduct, setDeletingProduct] = useState<{ id: string; name: string; totalStock: number; totalVariants: number } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const isDeleteSubmittingRef = useRef(false);

  const handleOpenDeleteModal = (id: string, name: string) => {
    const fullProduct = masterProductsMap.get(id);
    const totalStock = fullProduct?.variants?.reduce((sum: number, v: any) => sum + (Number(v.stock_quantity) || 0), 0) || 0;
    const totalVariants = fullProduct?.variants?.length || 1;
    setDeletingProduct({ id, name, totalStock, totalVariants });
  };

  const handleConfirmDelete = async () => {
    if (!deletingProduct || isDeleteSubmittingRef.current || isDeleting) return;
    try {
      isDeleteSubmittingRef.current = true;
      setIsDeleting(true);
      const res = await deleteProductAction(deletingProduct.id);
      if (!res?.success) throw new Error(res?.error || 'Failed to delete product');
      toast.success('Product deleted successfully');
      setDeletingProduct(null);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete product');
    } finally {
      setIsDeleting(false);
      isDeleteSubmittingRef.current = false;
    }
  };

  const handleEditClick = (p: any) => {
    const fullProduct = masterProductsMap.get(p.id) || p
    setEditingProduct(fullProduct)
    setAddModalOpen(true)
  }

  const openHistoryModal = async (product: any, initialVariantId?: string) => {
    const fullProduct = masterProductsMap.get(product.id) || product;
    setHistoryProduct(fullProduct);
    setHistoryVariantFilter(initialVariantId || 'all');
    setHistoryLoading(true);
    setHistoryMovements([]);
    try {
      const res = await getProductStockHistoryAction(fullProduct.id);
      if (res.success && res.data) {
        setHistoryMovements(res.data);
      } else {
        toast.error(res.error || 'Failed to load stock movements');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error loading stock history');
    } finally {
      setHistoryLoading(false);
    }
  };

  // Filter movements by selected variant tab in modal
  const filteredHistoryMovements = useMemo(() => {
    if (historyVariantFilter === 'all') return historyMovements;
    return historyMovements.filter(m => m.variant?.id === historyVariantFilter);
  }, [historyMovements, historyVariantFilter]);

  return (
    <div className="space-y-5">
      {/* Top Search & Filter Bar */}
      <div className="flex flex-col md:flex-row gap-3 justify-between items-stretch md:items-center">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input 
              type="text" 
              placeholder="Search product, variant, barcode..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface border border-border pl-10 pr-9 py-2.5 text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-ink-primary shadow-2xs"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-primary p-0.5 rounded-full cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category Filter */}
          <div className="sm:w-48">
            <select 
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              aria-label="Filter by category"
              className="w-full bg-surface border border-border px-3.5 py-2.5 text-xs font-semibold rounded-xl text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent shadow-2xs cursor-pointer"
            >
              <option value="all">All Categories</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Buttons Row with Stock Ledger Shortcut */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-between sm:justify-end">
          <button 
            onClick={() => setCatModalOpen(true)}
            className="flex-1 sm:flex-none px-3.5 py-2.5 bg-surface border border-border hover:bg-row-alt text-ink-primary text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition min-h-[40px] cursor-pointer"
          >
            <Layers className="w-4 h-4 text-ink-muted" />
            <span>Categories</span>
          </button>

          <Link
            href="/inventory/ledger"
            className="flex-1 sm:flex-none px-3.5 py-2.5 bg-surface border border-border hover:bg-row-alt text-ink-primary text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition min-h-[40px] cursor-pointer"
          >
            <Clock className="w-4 h-4 text-accent" />
            <span>Stock Ledger</span>
          </Link>
          
          <button 
            onClick={() => setReceiveModalOpen(true)}
            className="flex-1 sm:flex-none px-3.5 py-2.5 bg-surface border border-border hover:bg-row-alt text-ink-primary text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition min-h-[40px] cursor-pointer"
          >
            <ArrowDownToLine className="w-4 h-4 text-emerald-600" />
            <span>Receive Stock</span>
          </button>
          
          <button 
            onClick={() => {
              setEditingProduct(null)
              setAddModalOpen(true)
            }}
            className="w-full sm:w-auto px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-xs transition min-h-[40px] cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Product List Cards */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xs">
        <div className="divide-y divide-border">
          {paginatedProducts.map(p => {
            const isExpanded = expandedProducts.has(p.id);
            const totalStock = Number(p.totalStock || 0);
            const categoryName = categories.find(c => c.id === p.category_id)?.name || 'Uncategorized';

            return (
              <div key={p.id} className="p-3.5 sm:p-4 hover:bg-row-alt/40 transition-colors">
                <div className="flex justify-between items-start gap-3">
                  {/* Left: Expandable Header Info */}
                  <div 
                    className="flex items-start gap-3 flex-1 cursor-pointer min-w-0" 
                    onClick={() => toggleProduct(p.id)}
                  >
                    <button 
                      aria-label="Toggle variants"
                      className="mt-1 text-ink-muted hover:text-ink-primary transition-transform p-1 rounded-lg hover:bg-row-alt cursor-pointer"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-accent" />
                      ) : (
                        <ChevronRight className="w-5 h-5" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-sm sm:text-base text-ink-primary truncate">
                          {p.name}
                        </h3>
                        <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                          {categoryName}
                        </span>
                      </div>

                      {/* Subtitle Tokens */}
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap text-xs text-ink-muted mt-1.5">
                        <span className="inline-flex items-center gap-1 font-medium bg-row-alt px-2 py-0.5 rounded-md border border-border text-[11px]">
                          <Package className="w-3.5 h-3.5 text-ink-muted" />
                          {p.pieces_per_set} pcs / set
                        </span>
                        
                        <span className="font-medium text-[11px]">
                          {p.variants.length} variant{p.variants.length !== 1 ? 's' : ''}
                        </span>

                        {/* Color-Coded Stock Status Pill */}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                          totalStock === 0
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : totalStock <= 10
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          {totalStock === 0 
                            ? 'Out of Stock' 
                            : totalStock <= 10 
                            ? `Low: ${totalStock} pcs` 
                            : `${totalStock} pcs in stock`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Tactile Action Chips (History, Edit, Delete) */}
                  <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                    <button 
                      onClick={() => openHistoryModal(p)}
                      title="View Stock Movement History"
                      aria-label="View Stock Movement History"
                      className="p-2 sm:px-3 sm:py-2 text-xs text-ink-primary hover:text-accent bg-surface border border-border hover:bg-row-alt rounded-xl font-bold flex items-center gap-1.5 shadow-2xs transition min-h-[38px] min-w-[38px] justify-center cursor-pointer"
                    >
                      <Clock className="w-4 h-4 text-accent" />
                      <span className="hidden sm:inline">History</span>
                    </button>

                    <button 
                      onClick={() => handleEditClick(p)}
                      title="Edit Product"
                      aria-label="Edit Product"
                      className="p-2 sm:px-3 sm:py-2 text-xs text-ink-primary hover:text-accent bg-surface border border-border hover:bg-row-alt rounded-xl font-bold flex items-center gap-1.5 shadow-2xs transition min-h-[38px] min-w-[38px] justify-center cursor-pointer"
                    >
                      <Pencil className="w-4 h-4 text-ink-muted hover:text-accent" />
                      <span className="hidden sm:inline">Edit</span>
                    </button>
                    
                    <button 
                      onClick={() => handleOpenDeleteModal(p.id, p.name)}
                      title="Delete Product"
                      aria-label="Delete Product"
                      className="p-2 sm:px-3 sm:py-2 text-xs text-red-600 bg-red-50/70 border border-red-200 hover:bg-red-100 rounded-xl font-bold flex items-center gap-1.5 shadow-2xs transition min-h-[38px] min-w-[38px] justify-center cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                  </div>
                </div>

                {/* Responsive Nested Variant Breakdown */}
                {isExpanded && p.variants && p.variants.length > 0 && (
                  <div className="mt-3.5 pt-3 border-t border-border">
                    {/* Mobile Card Layout (0px horizontal overflow) */}
                    <div className="block sm:hidden space-y-2">
                      {p.variants.map((v: any) => {
                        const stockSets = Number(v.stock_sets || 0);
                        const loosePcs = Math.max(0, Number(v.stock_quantity || 0) - (stockSets * Number(p.pieces_per_set || 1)));
                        const isLoss = Number(v.cost_price) > 0 && Number(v.selling_price) < Number(v.cost_price);

                        return (
                          <div key={v.id} className="p-3 bg-row-alt rounded-xl border border-border space-y-2">
                            <div className="flex justify-between items-start gap-2">
                              <div>
                                <span className="font-bold text-xs text-ink-primary">{v.name}</span>
                                <div className="text-[11px] font-mono text-ink-muted flex items-center gap-1 mt-0.5">
                                  <Barcode className="w-3 h-3" />
                                  {v.barcode || 'No barcode'}
                                </div>
                              </div>
                              <div className="text-right flex items-center gap-2">
                                <div>
                                  <div className="font-mono font-bold text-sm text-ink-primary">
                                    {formatINR(v.selling_price)}
                                  </div>
                                  {isLoss && (
                                    <span className="text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-bold">
                                      Below Cost
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openHistoryModal(p, v.id)}
                                  title="View Variant History"
                                  className="p-1.5 text-accent hover:bg-accent/10 rounded-lg transition cursor-pointer"
                                >
                                  <Clock className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/60 text-center text-xs">
                              <div className="bg-surface p-1.5 rounded-lg border border-border">
                                <span className="text-[10px] uppercase font-bold text-ink-muted block">Sets</span>
                                <span className="font-mono font-bold text-ink-primary">{stockSets}</span>
                              </div>
                              <div className="bg-surface p-1.5 rounded-lg border border-border">
                                <span className="text-[10px] uppercase font-bold text-ink-muted block">Loose</span>
                                <span className="font-mono font-bold text-ink-primary">{loosePcs}</span>
                              </div>
                              <div className="bg-surface p-1.5 rounded-lg border border-border">
                                <span className="text-[10px] uppercase font-bold text-ink-muted block">Total Pcs</span>
                                <span className="font-mono font-bold text-accent">{v.stock_quantity || 0}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop Tabular Breakdown */}
                    <div className="hidden sm:block rounded-xl border border-border overflow-hidden bg-surface">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-row-alt border-b border-border text-ink-muted font-semibold">
                          <tr>
                            <th className="py-2.5 px-3">Variant</th>
                            <th className="py-2.5 px-3">Barcode</th>
                            <th className="py-2.5 px-3 text-right">Cost Price</th>
                            <th className="py-2.5 px-3 text-right">Selling Price</th>
                            <th className="py-2.5 px-3 text-center">Packaged Sets</th>
                            <th className="py-2.5 px-3 text-center">Loose Pcs</th>
                            <th className="py-2.5 px-3 text-center font-bold text-ink-primary">Total Stock</th>
                            <th className="py-2.5 px-3 text-right">History</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {p.variants.map((v: any) => {
                            const stockSets = Number(v.stock_sets || 0);
                            const loosePcs = Math.max(0, Number(v.stock_quantity || 0) - (stockSets * Number(p.pieces_per_set || 1)));
                            const isLoss = Number(v.cost_price) > 0 && Number(v.selling_price) < Number(v.cost_price);

                            return (
                              <tr key={v.id} className="hover:bg-row-alt/50 transition-colors">
                                <td className="py-2.5 px-3 font-semibold text-ink-primary">{v.name}</td>
                                <td className="py-2.5 px-3 font-mono text-ink-muted">{v.barcode || '—'}</td>
                                <td className="py-2.5 px-3 text-right font-mono text-ink-muted">{formatINR(v.cost_price)}</td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-ink-primary">
                                  {formatINR(v.selling_price)}
                                  {isLoss && <span className="text-[10px] text-amber-700 block font-normal">Below Cost</span>}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono font-medium text-ink-primary">
                                  {stockSets} sets
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono font-medium text-ink-primary">
                                  {loosePcs} pcs
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono font-bold text-accent">
                                  {v.stock_quantity || 0} pcs
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => openHistoryModal(p, v.id)}
                                    title="View Variant Stock History"
                                    className="p-1 text-ink-muted hover:text-accent hover:bg-row-alt rounded-lg transition cursor-pointer"
                                  >
                                    <Clock className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredProducts.length === 0 && (
            <div className="text-center py-12 px-4 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-row-alt border border-border flex items-center justify-center mx-auto text-ink-muted">
                <AlertCircle className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-ink-primary">No products found</p>
              <p className="text-xs text-ink-muted max-w-sm mx-auto">
                Try adjusting your search terms or category filter, or click &quot;+ Add Product&quot; to create one.
              </p>
            </div>
          )}
        </div>

        {/* Pagination Bar */}
        {filteredProducts.length > PAGE_SIZE && (
          <div className="p-3.5 sm:p-4 bg-row-alt/30 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <span className="text-ink-muted font-medium">
              Showing {(currentPage - 1) * PAGE_SIZE + 1} to {Math.min(currentPage * PAGE_SIZE, filteredProducts.length)} of {filteredProducts.length} products
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border border-border bg-surface text-ink-primary font-bold disabled:opacity-40 hover:bg-row-alt transition cursor-pointer"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 font-mono font-bold text-ink-primary">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 rounded-lg border border-border bg-surface text-ink-primary font-bold disabled:opacity-40 hover:bg-row-alt transition cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* PRODUCT STOCK MOVEMENT HISTORY MODAL with z-[200] */}
      {historyProduct && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget) setHistoryProduct(null); }}
        >
          <div 
            className="bg-surface w-full max-w-2xl rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4 max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-start pb-3 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-accent/10 text-accent rounded-xl">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-ink-primary flex items-center gap-2">
                    <span>{historyProduct.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-row-alt border border-border font-normal text-ink-muted">
                      {historyProduct.pieces_per_set} pcs/set
                    </span>
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Total Live Stock: <strong className="font-mono text-ink-primary">{historyProduct.totalStock} pcs</strong> across {historyProduct.variants.length} variant(s)
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setHistoryProduct(null)} 
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Variant Filter Tabs */}
            {historyProduct.variants.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 hide-scrollbar">
                <button
                  type="button"
                  onClick={() => setHistoryVariantFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                    historyVariantFilter === 'all'
                      ? 'bg-accent text-white shadow-2xs'
                      : 'bg-row-alt border border-border text-ink-muted hover:text-ink-primary'
                  }`}
                >
                  All Variants ({historyMovements.length})
                </button>
                {historyProduct.variants.map((v: any) => {
                  const count = historyMovements.filter(m => m.variant?.id === v.id).length;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setHistoryVariantFilter(v.id)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                        historyVariantFilter === v.id
                          ? 'bg-accent text-white shadow-2xs'
                          : 'bg-row-alt border border-border text-ink-muted hover:text-ink-primary'
                      }`}
                    >
                      {v.name} ({count})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Movement Timeline List */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-[220px]">
              {historyLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-6 h-6 text-accent animate-spin" />
                  <span className="text-xs text-ink-muted">Loading stock timeline...</span>
                </div>
              ) : filteredHistoryMovements.length === 0 ? (
                <div className="py-12 text-center text-xs text-ink-muted space-y-1">
                  <History className="w-8 h-8 mx-auto text-ink-muted/50 mb-2" />
                  <p className="font-bold text-ink-primary">No stock movements recorded yet</p>
                  <p>Stock adjustments, sales, and arrivals will appear here chronologically.</p>
                </div>
              ) : (
                filteredHistoryMovements.map((m: any) => {
                  const isPositive = Number(m.quantity_change) > 0;
                  const absQty = Math.abs(Number(m.quantity_change));
                  const piecesPerSet = Number(historyProduct.pieces_per_set) || 1;
                  const sets = piecesPerSet > 1 ? Math.floor(absQty / piecesPerSet) : 0;
                  const loose = piecesPerSet > 1 ? absQty % piecesPerSet : 0;

                  // Dynamic Badge Styling
                  let badgeStyle = 'bg-gray-100 text-gray-800 border-gray-200';
                  let icon = <SlidersHorizontal className="w-3.5 h-3.5" />;
                  if (m.type === 'ARRIVAL') {
                    badgeStyle = 'bg-emerald-50 text-emerald-800 border-emerald-200';
                    icon = <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />;
                  } else if (m.type === 'SALE') {
                    badgeStyle = 'bg-blue-50 text-blue-800 border-blue-200';
                    icon = <TrendingDown className="w-3.5 h-3.5 text-blue-600" />;
                  } else if (m.type === 'RETURN_RESTOCK') {
                    badgeStyle = 'bg-teal-50 text-teal-800 border-teal-200';
                    icon = <RotateCcw className="w-3.5 h-3.5 text-teal-600" />;
                  } else if (m.type === 'RETURN_DAMAGE') {
                    badgeStyle = 'bg-red-50 text-red-800 border-red-200';
                    icon = <Ban className="w-3.5 h-3.5 text-red-600" />;
                  } else if (m.type === 'VOID_RESTOCK') {
                    badgeStyle = 'bg-purple-50 text-purple-800 border-purple-200';
                    icon = <RotateCcw className="w-3.5 h-3.5 text-purple-600" />;
                  } else if (m.type === 'INITIAL_STOCK') {
                    badgeStyle = 'bg-indigo-50 text-indigo-800 border-indigo-200';
                    icon = <Package className="w-3.5 h-3.5 text-indigo-600" />;
                  } else if (m.type === 'MANUAL_ADJUST') {
                    badgeStyle = 'bg-amber-50 text-amber-800 border-amber-200';
                    icon = <SlidersHorizontal className="w-3.5 h-3.5 text-amber-600" />;
                  }

                  return (
                    <div key={m.id} className="p-3 bg-row-alt/50 rounded-xl border border-border space-y-1.5">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${badgeStyle}`}>
                            {icon}
                            <span>{m.type}</span>
                          </span>
                          <span className="text-xs font-bold text-ink-primary font-mono">
                            {m.variant?.name}
                          </span>
                        </div>
                        <div className="text-right font-mono">
                          <span className={`text-sm font-bold ${isPositive ? 'text-emerald-700' : 'text-red-600'}`}>
                            {isPositive ? `+${m.quantity_change}` : m.quantity_change} pcs
                          </span>
                          {piecesPerSet > 1 && (
                            <span className="text-[10px] text-ink-muted block">
                              ({sets} sets, {loose} loose)
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex justify-between items-center text-[11px] text-ink-muted pt-1 border-t border-border/50">
                        <span className="font-mono">
                          {new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                        <span className="truncate max-w-xs text-ink-primary font-medium">
                          {m.notes || '—'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer with Direct Link to Full Search */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-3 border-t border-border text-xs">
              <Link
                href={`/inventory/ledger?search=${encodeURIComponent(historyProduct.name)}`}
                className="text-accent font-bold hover:underline flex items-center gap-1"
                onClick={() => setHistoryProduct(null)}
              >
                <span>Open in Full Stock Ledger Search</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>

              <button
                type="button"
                onClick={() => setHistoryProduct(null)}
                className="w-full sm:w-auto px-4 py-2 bg-row-alt hover:bg-surface border border-border text-ink-primary font-bold rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Other Existing Modals */}
      <ReceiveStockModal 
        isOpen={isReceiveModalOpen} 
        onClose={() => setReceiveModalOpen(false)} 
        onSubmit={handleReceiveSubmit}
        variants={variants}
      />

      <AddProductModal 
        isOpen={isAddModalOpen} 
        onClose={() => {
          setAddModalOpen(false)
          setEditingProduct(null)
        }} 
        onSubmit={handleAddSubmit}
        categories={categories}
        initialData={editingProduct}
      />

      <CategoriesModal 
        isOpen={isCatModalOpen} 
        onClose={() => setCatModalOpen(false)} 
        categories={categories}
      />

      {/* Delete Confirmation Modal */}
      {deletingProduct && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !isDeleting) setDeletingProduct(null); }}
        >
          <div 
            className="bg-surface w-full max-w-md rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-600">
              <div className="p-2.5 bg-red-100 rounded-xl">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-ink-primary">Delete Product?</h3>
                <p className="text-xs text-ink-muted font-bold">{deletingProduct.name}</p>
              </div>
            </div>

            <p className="text-xs text-ink-muted leading-relaxed">
              Are you sure you want to permanently delete this product and all its <strong className="text-ink-primary">{deletingProduct.totalVariants} variant(s)</strong>?
            </p>

            {deletingProduct.totalStock > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  ⚠️ Active Stock Write-Off Notice
                </div>
                <p>
                  This product currently has <strong>{deletingProduct.totalStock} units</strong> of live stock. Deleting it will permanently write off all stock to zero in the ledger.
                </p>
              </div>
            )}

            <div className="flex gap-2.5 justify-end pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingProduct(null)}
                className="px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl disabled:opacity-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl transition disabled:opacity-50 flex items-center gap-2 shadow-xs cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Yes, Delete Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
