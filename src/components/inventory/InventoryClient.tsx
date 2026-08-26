'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
  X
} from 'lucide-react'
import { ReceiveStockModal } from './ReceiveStockModal'
import { AddProductModal } from './AddProductModal'
import { CategoriesModal } from './CategoriesModal'
import { processStockArrivalAction, createProductAction, deleteProductAction, updateProductAction } from '@/lib/actions/inventory'
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

  // Auto open receive stock modal if navigated with ?action=receive
  useEffect(() => {
    if (searchParams.get('action') === 'receive') {
      setReceiveModalOpen(true);
    }
  }, [searchParams]);

  // Master map of all products and their complete variants (unfiltered)
  const masterProductsMap = useMemo(() => {
    const productsMap = new Map<string, any>()
    variants.forEach(v => {
      const p = Array.isArray(v.product) ? v.product[0] : v.product
      if (!p) return

      if (!productsMap.has(p.id)) {
        productsMap.set(p.id, {
          id: p.id,
          name: p.name,
          category_id: p.category_id,
          category_name: p.category?.name || 'Uncategorized',
          pieces_per_set: p.pieces_per_set || 1,
          totalStock: 0,
          variants: []
        })
      }
      const prod = productsMap.get(p.id)
      prod.totalStock += Number(v.stock_quantity || 0)
      prod.variants.push({
        id: v.id,
        name: v.name,
        barcode: v.barcode,
        cost_price: v.cost_price,
        selling_price: v.selling_price,
        stock_quantity: v.stock_quantity,
        stock_sets: v.stock_sets
      })
    })
    return productsMap
  }, [variants])

  // Group products by product_id for display (with category + search filtering)
  const groupedProducts = useMemo(() => {
    const productsMap = new Map<string, any>()
    
    variants.forEach(v => {
      const p = Array.isArray(v.product) ? v.product[0] : v.product
      if (!p) return

      // 1. Filter by category
      if (selectedCategoryId !== 'all' && p.category_id !== selectedCategoryId) {
        return
      }

      // 2. Filter by search query (product name, variant name, barcode)
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.toLowerCase()
        const matchesProduct = p.name?.toLowerCase().includes(q)
        const matchesVariant = v.name?.toLowerCase().includes(q)
        const matchesBarcode = v.barcode?.toLowerCase().includes(q)
        if (!matchesProduct && !matchesVariant && !matchesBarcode) {
          return
        }
      }

      if (!productsMap.has(p.id)) {
        productsMap.set(p.id, {
          id: p.id,
          name: p.name,
          category_id: p.category_id,
          category_name: p.category?.name || 'Uncategorized',
          pieces_per_set: p.pieces_per_set || 1,
          totalStock: 0,
          variants: []
        })
      }

      const prod = productsMap.get(p.id)
      prod.totalStock += Number(v.stock_quantity || 0)
      prod.variants.push({
        id: v.id,
        name: v.name,
        barcode: v.barcode,
        cost_price: v.cost_price,
        selling_price: v.selling_price,
        stock_quantity: v.stock_quantity,
        stock_sets: v.stock_sets
      })
    })

    return Array.from(productsMap.values())
  }, [variants, selectedCategoryId, debouncedSearch])

  const totalPages = Math.max(1, Math.ceil(groupedProducts.length / PAGE_SIZE));
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return groupedProducts.slice(start, start + PAGE_SIZE);
  }, [groupedProducts, currentPage]);

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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-primary p-0.5 rounded-full"
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

        {/* Action Buttons Row */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-between sm:justify-end">
          <button 
            onClick={() => setCatModalOpen(true)}
            className="flex-1 sm:flex-none px-3.5 py-2.5 bg-surface border border-border hover:bg-row-alt text-ink-primary text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition min-h-[40px]"
          >
            <Layers className="w-4 h-4 text-ink-muted" />
            <span>Categories</span>
          </button>
          
          <button 
            onClick={() => setReceiveModalOpen(true)}
            className="flex-1 sm:flex-none px-3.5 py-2.5 bg-surface border border-border hover:bg-row-alt text-ink-primary text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition min-h-[40px]"
          >
            <ArrowDownToLine className="w-4 h-4 text-emerald-600" />
            <span>Receive Stock</span>
          </button>
          
          <button 
            onClick={() => {
              setEditingProduct(null)
              setAddModalOpen(true)
            }}
            className="w-full sm:w-auto px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-xs transition min-h-[40px]"
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
                      className="mt-1 text-ink-muted hover:text-ink-primary transition-transform p-1 rounded-lg hover:bg-row-alt"
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

                  {/* Right: Tactile 44px Touch Action Chips */}
                  <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                    <button 
                      onClick={() => handleEditClick(p)}
                      title="Edit Product"
                      aria-label="Edit Product"
                      className="p-2.5 sm:px-3 sm:py-2 text-xs text-ink-primary hover:text-accent bg-surface border border-border hover:bg-row-alt rounded-xl font-bold flex items-center gap-1.5 shadow-2xs transition min-h-[40px] min-w-[40px] justify-center"
                    >
                      <Pencil className="w-4 h-4 text-ink-muted hover:text-accent" />
                      <span className="hidden sm:inline">Edit</span>
                    </button>
                    
                    <button 
                      onClick={() => handleOpenDeleteModal(p.id, p.name)}
                      title="Delete Product"
                      aria-label="Delete Product"
                      className="p-2.5 sm:px-3 sm:py-2 text-xs text-red-600 bg-red-50/70 border border-red-200 hover:bg-red-100 rounded-xl font-bold flex items-center gap-1.5 shadow-2xs transition min-h-[40px] min-w-[40px] justify-center"
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
                              <div className="text-right">
                                <div className="font-mono font-bold text-sm text-ink-primary">
                                  {formatINR(v.selling_price)}
                                </div>
                                {isLoss && (
                                  <span className="text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-bold">
                                    Below Cost
                                  </span>
                                )}
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
                            <th className="py-2.5 px-3 text-center">Sets</th>
                            <th className="py-2.5 px-3 text-center">Loose</th>
                            <th className="py-2.5 px-3 text-center">Total Stock</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {p.variants.map((v: any) => {
                            const stockSets = Number(v.stock_sets || 0);
                            const loosePcs = Math.max(0, Number(v.stock_quantity || 0) - (stockSets * Number(p.pieces_per_set || 1)));
                            const isLoss = Number(v.cost_price) > 0 && Number(v.selling_price) < Number(v.cost_price);

                            return (
                              <tr key={v.id} className="hover:bg-row-alt/50">
                                <td className="py-2.5 px-3 font-bold text-ink-primary">{v.name}</td>
                                <td className="py-2.5 px-3 font-mono text-ink-muted text-[11px]">{v.barcode || '—'}</td>
                                <td className="py-2.5 px-3 text-right font-mono text-ink-muted">{formatINR(v.cost_price)}</td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-ink-primary">
                                  {formatINR(v.selling_price)}
                                  {isLoss && (
                                    <span className="ml-1.5 text-[9px] bg-amber-100 text-amber-900 px-1 py-0.5 rounded font-bold">
                                      Loss
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono">{stockSets}</td>
                                <td className="py-2.5 px-3 text-center font-mono">{loosePcs}</td>
                                <td className="py-2.5 px-3 text-center font-mono font-black text-ink-primary">{v.stock_quantity || 0} pcs</td>
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

          {groupedProducts.length === 0 && (
            <div className="p-10 text-center text-ink-muted text-sm space-y-2">
              <Package className="w-8 h-8 text-ink-muted mx-auto stroke-1" />
              <p className="font-semibold text-ink-primary">No matching products found</p>
              <p className="text-xs">Try adjusting your search query or category filter.</p>
            </div>
          )}
        </div>
        
        {/* Pagination Footer */}
        <div className="p-3.5 sm:p-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 bg-row-alt/40">
          <span className="text-xs text-ink-muted">
            Showing {groupedProducts.length > 0 ? (currentPage - 1) * PAGE_SIZE + 1 : 0}-
            {Math.min(currentPage * PAGE_SIZE, groupedProducts.length)} of {groupedProducts.length} products
          </span>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 border border-border bg-surface text-ink-primary rounded-xl text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-row-alt transition-colors flex items-center gap-1 min-h-[36px]"
            >
              <ChevronRight className="w-3.5 h-3.5 rotate-180" />
              Previous
            </button>
            <span className="text-xs font-bold text-ink-primary px-2 font-mono">
              {currentPage} / {totalPages}
            </span>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 border border-accent/20 text-accent hover:bg-accent/5 bg-surface rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1 min-h-[36px]"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

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

      {/* Styled Product Delete Confirmation Modal with z-[200] */}
      {deletingProduct && (
        <div 
          className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
          onClick={() => !isDeleting && setDeletingProduct(null)}
        >
          <div 
            className="bg-surface border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 cursor-default"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-600">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-ink-primary">Delete &quot;{deletingProduct.name}&quot;?</h3>
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
                className="px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl disabled:opacity-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl transition disabled:opacity-50 flex items-center gap-2 shadow-xs"
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
