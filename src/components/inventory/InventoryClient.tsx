'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, ChevronDown, ChevronRight, Settings, AlertCircle } from 'lucide-react'
import { ReceiveStockModal } from './ReceiveStockModal'
import { AddProductModal } from './AddProductModal'
import { CategoriesModal } from './CategoriesModal'
import { processStockArrivalAction, createProductAction, deleteProductAction, updateProductAction } from '@/lib/actions/inventory'
import toast from 'react-hot-toast'

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
  const toggleProduct = (productId: string) => { setExpandedProducts(prev => { const n = new Set(prev); if(n.has(productId)) n.delete(productId); else n.add(productId); return n; }); };
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

  // Reset pagination on filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCategoryId, searchQuery]);

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
    // Look up the full master product to guarantee all sibling variants are preserved
    const fullProduct = masterProductsMap.get(p.id) || p
    setEditingProduct(fullProduct)
    setAddModalOpen(true)
  }

  return (
    <div className="space-y-6">
      {/* Top action bar matching design */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="flex flex-1 items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 max-w-[400px]">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input 
              type="text" 
              placeholder="Search product or variant barcode..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface border border-border pl-10 pr-4 py-2 text-[14px] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
            />
          </div>
          <select 
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
            className="bg-surface border border-border px-3 py-2 text-[13px] rounded-[8px] text-ink-primary font-medium focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
          >
            <option value="all">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button 
            onClick={() => setCatModalOpen(true)}
            className="btn btn-secondary text-[13px] flex items-center gap-1.5"
          >
            <Settings className="w-4 h-4" />
            Categories
          </button>
          <button 
            onClick={() => setReceiveModalOpen(true)}
            className="btn btn-secondary text-[13px]"
          >
            Receive Stock
          </button>
          <button 
            onClick={() => {
              setEditingProduct(null)
              setAddModalOpen(true)
            }}
            className="btn btn-primary text-[13px]"
          >
            + Add Product
          </button>
        </div>
      </div>

      {/* Product List Cards */}
      <div className="bg-surface border border-border rounded-[12px] overflow-hidden shadow-sm">
        <div className="divide-y divide-border">
          {paginatedProducts.map(p => (
            <div key={p.id} className="p-4 hover:bg-row-alt/50 transition-colors">
              <div className="flex justify-between items-start cursor-pointer" onClick={() => toggleProduct(p.id)}>
                <div className="flex items-start gap-3">
                  <button className="mt-0.5 text-ink-muted hover:text-ink-primary transition-colors">
                    {expandedProducts.has(p.id) ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                  </button>
                  <div>
                    <h3 className="font-bold text-[15px] text-ink-primary flex items-center gap-2">
                      {p.name}
                      <span className="text-[11px] font-normal text-ink-muted bg-surface border border-border px-2 py-0.5 rounded-[4px]">
                        {categories.find(c => c.id === p.category_id)?.name || 'Uncategorized'}
                      </span>
                    </h3>
                    <div className="text-[12px] text-ink-muted mt-0.5">
                      {p.pieces_per_set} pcs per set • {p.variants.length} variant{p.variants.length !== 1 ? 's' : ''} • Total Stock: {p.totalStock} pcs
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4 shrink-0" onClick={e => e.stopPropagation()}>
                  <button 
                    onClick={() => handleEditClick(p)}
                    className="text-[12px] text-ink-muted hover:text-accent font-medium px-2 py-1"
                  >
                    Edit
                  </button>
                  <span className="text-border">|</span>
                  <button 
                    onClick={() => handleOpenDeleteModal(p.id, p.name)}
                    className="text-[12px] text-ink-muted hover:text-red-600 font-medium px-2 py-1"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Nested Variant Breakdown (Accordion Content) */}
              {expandedProducts.has(p.id) && p.variants && p.variants.length > 0 && (
                <div className="mt-4 ml-8 bg-surface rounded-[8px] border border-border divide-y divide-border overflow-hidden">
                  {p.variants.map((v: any) => {
                    const stockSets = Number(v.stock_sets || 0);
                    const loosePcs = Math.max(0, Number(v.stock_quantity || 0) - (stockSets * Number(p.pieces_per_set || 1)));
                    return (
                      <div key={v.id} className="p-3 hover:bg-row-alt flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-[14px] text-ink-primary">{v.name}</div>
                          <div className="text-[12px] text-ink-muted font-mono mt-0.5">{v.barcode || 'No barcode'}</div>
                        </div>
                        <div className="flex gap-4 sm:gap-6">
                          <div className="flex flex-col sm:items-end">
                            <span className="text-[10px] uppercase font-bold text-ink-muted">Price</span>
                            <div className="font-medium text-[14px]">
                              {Number(v.cost_price) > 0 && Number(v.selling_price) < Number(v.cost_price) ? (
                                <span className="text-amber-700 font-bold flex flex-col sm:flex-row sm:items-center gap-1">
                                  <span>₹{v.selling_price}</span>
                                  <span className="text-[9px] bg-amber-100 text-amber-800 px-1 py-0.5 rounded font-bold">Loss</span>
                                </span>
                              ) : (
                                <span className="text-emerald-600 font-medium font-mono">₹{v.selling_price}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col sm:items-end">
                            <span className="text-[10px] uppercase font-bold text-ink-muted">Stock</span>
                            <div className="font-medium text-[14px] font-mono">{stockSets} <span className="text-ink-muted text-[11px] font-sans">sets</span></div>
                          </div>
                          <div className="flex flex-col sm:items-end">
                            <span className="text-[10px] uppercase font-bold text-ink-muted">Loose</span>
                            <div className="font-medium text-[14px] font-mono">{loosePcs} <span className="text-ink-muted text-[11px] font-sans">pcs</span></div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {groupedProducts.length === 0 && (
            <div className="p-8 text-center text-ink-muted text-[14px]">No products found.</div>
          )}
        </div>
        
        {/* Functional Client Pagination Footer */}
        <div className="p-4 border-t border-border flex items-center justify-between bg-row-alt/50">
          <span className="text-[13px] text-ink-muted">
            Showing {groupedProducts.length > 0 ? (currentPage - 1) * PAGE_SIZE + 1 : 0}-
            {Math.min(currentPage * PAGE_SIZE, groupedProducts.length)} of {groupedProducts.length}
          </span>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 border border-border bg-surface text-ink-muted rounded-[6px] text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-row-alt transition-colors flex items-center"
            >
              <ChevronRight className="w-4 h-4 inline-block rotate-180 mr-1" />
              Previous
            </button>
            <span className="text-xs font-semibold text-ink-primary px-2">
              Page {currentPage} of {totalPages}
            </span>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 border border-[#A83D24]/20 text-[#A83D24] hover:bg-[#A83D24]/5 bg-surface rounded-[6px] text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
            >
              Next
              <ChevronRight className="w-4 h-4 inline-block ml-1" />
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

      {/* Styled Product Delete Confirmation Modal */}
      {deletingProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
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

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingProduct(null)}
                className="px-4 py-2 text-xs font-bold text-ink-muted hover:text-ink-primary rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg transition disabled:opacity-50 flex items-center gap-2"
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
