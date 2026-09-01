'use client'

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { 
  Package, 
  X, 
  Trash2, 
  Search, 
  ArrowDownToLine, 
  Plus, 
  Loader2,
  PackagePlus,
  Layers,
  CheckCircle2,
  TrendingUp,
  Tag,
  Sparkles,
  ChevronRight,
  ArrowRight,
  SlidersHorizontal,
  Minus,
  Building
} from 'lucide-react';
import toast from 'react-hot-toast';

interface VariantRowState {
  variant_id: string;
  variant_name: string;
  barcode?: string;
  pieces_per_set: number;
  current_stock: number;
  current_sets: number;
  sets_quantity: number;
  loose_quantity: number;
  notes: string;
}

interface ReceiveStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { variant_id: string; sets_quantity: number; loose_quantity: number; notes: string }[]) => Promise<void>;
  products: any[];
  variants: any[];
  categories?: any[];
  onOpenQuickAdd?: () => void;
}

export function ReceiveStockModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  products = [], 
  variants = [], 
  categories = [],
  onOpenQuickAdd 
}: ReceiveStockModalProps) {
  const [mode, setMode] = useState<'by_product' | 'custom'>('by_product');
  
  // Product Search State
  const [productSearch, setProductSearch] = useState('');
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // Batch Variant Rows for Selected Product
  const [batchRows, setBatchRows] = useState<VariantRowState[]>([]);

  // Common Inbound Notes (Applied to all non-zero entries)
  const [commonNotes, setCommonNotes] = useState('');

  // Custom Multi-Product Mode Rows
  const [customRows, setCustomRows] = useState<{ variant_id: string; sets_quantity: number; loose_quantity: number; notes: string }[]>([
    { variant_id: '', sets_quantity: 0, loose_quantity: 0, notes: '' }
  ]);

  const [loading, setLoading] = useState(false);
  const isSubmittingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevIsOpenRef = useRef(false);

  // Select Product and populate all its variants
  const handleSelectProduct = useCallback((prod: any) => {
    setSelectedProduct(prod);
    setProductSearch('');
    setIsSearchDropdownOpen(false);

    if (prod && prod.variants) {
      const masterPps = Number(prod.pieces_per_set) || 1;
      const initialRows: VariantRowState[] = prod.variants.map((v: any) => {
        const vPps = Number(v.pieces_per_set) || masterPps;
        const totalPcs = Number(v.stock_quantity) || 0;
        const totalSets = vPps > 1 ? Math.floor(totalPcs / vPps) : 0;
        return {
          variant_id: v.id,
          variant_name: v.name,
          barcode: v.barcode,
          pieces_per_set: vPps,
          current_stock: totalPcs,
          current_sets: totalSets,
          sets_quantity: 0,
          loose_quantity: 0,
          notes: ''
        };
      });
      setBatchRows(initialRows);
    } else {
      setBatchRows([]);
    }
  }, []);

  // Reset state on open
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setProductSearch('');
      setIsSearchDropdownOpen(false);
      setCommonNotes('');
      setCustomRows([{ variant_id: '', sets_quantity: 0, loose_quantity: 0, notes: '' }]);
      
      // Auto-select first product if available, or leave open for search
      if (products.length > 0) {
        handleSelectProduct(products[0]);
      } else {
        setSelectedProduct(null);
        setBatchRows([]);
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, products, handleSelectProduct]);

  // Filtered Products for Live Search Dropdown
  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 10);

    return products.filter((p: any) => {
      const pName = (p.name || '').toLowerCase();
      const cat = (categories.find(c => c.id === p.category_id)?.name || '').toLowerCase();
      const hasMatchingBarcode = p.variants?.some((v: any) => (v.barcode || '').toLowerCase().includes(q));
      const hasMatchingVariant = p.variants?.some((v: any) => (v.name || '').toLowerCase().includes(q));
      return pName.includes(q) || cat.includes(q) || hasMatchingBarcode || hasMatchingVariant;
    }).slice(0, 15);
  }, [products, productSearch, categories]);

  // Update Batch Row Quantities
  const updateBatchRow = (index: number, field: 'sets_quantity' | 'loose_quantity' | 'notes', value: any) => {
    setBatchRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  // Summary Metrics of Items Being Received
  const totalPiecesToAdd = useMemo(() => {
    if (!selectedProduct) return 0;
    const masterPps = Number(selectedProduct.pieces_per_set) || 1;
    return batchRows.reduce((sum, r) => {
      const pps = Number(r.pieces_per_set) || masterPps;
      const sets = Math.max(0, Number(r.sets_quantity) || 0);
      const loose = Math.max(0, Number(r.loose_quantity) || 0);
      return sum + (sets * pps) + loose;
    }, 0);
  }, [batchRows, selectedProduct]);

  const activeVariantsCount = useMemo(() => {
    return batchRows.filter(r => (Number(r.sets_quantity) || 0) > 0 || (Number(r.loose_quantity) || 0) > 0).length;
  }, [batchRows]);

  if (!isOpen) return null;

  // Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading) return;

    if (mode === 'by_product') {
      const validRows = batchRows
        .filter(r => (Number(r.sets_quantity) || 0) > 0 || (Number(r.loose_quantity) || 0) > 0)
        .map(r => ({
          variant_id: r.variant_id,
          sets_quantity: Math.max(0, Number(r.sets_quantity) || 0),
          loose_quantity: Math.max(0, Number(r.loose_quantity) || 0),
          notes: (r.notes.trim() || commonNotes.trim()) || 'Inbound Shipment Arrival'
        }));

      if (validRows.length === 0) {
        toast.error('Please enter a positive stock quantity (Sets or Loose Pcs) for at least one variant.');
        return;
      }

      try {
        isSubmittingRef.current = true;
        setLoading(true);
        await onSubmit(validRows);
        onClose();
      } catch {
        // Handled in parent
      } finally {
        isSubmittingRef.current = false;
        setLoading(false);
      }
    } else {
      // Custom Mode
      const validRows = customRows
        .filter(r => r.variant_id && ((Number(r.sets_quantity) || 0) > 0 || (Number(r.loose_quantity) || 0) > 0))
        .map(r => ({
          variant_id: r.variant_id,
          sets_quantity: Math.max(0, Number(r.sets_quantity) || 0),
          loose_quantity: Math.max(0, Number(r.loose_quantity) || 0),
          notes: r.notes.trim() || 'Inbound Shipment Arrival'
        }));

      if (validRows.length === 0) {
        toast.error('Please select at least one variant and enter stock quantities.');
        return;
      }

      try {
        isSubmittingRef.current = true;
        setLoading(true);
        await onSubmit(validRows);
        onClose();
      } catch {
        // Handled in parent
      } finally {
        isSubmittingRef.current = false;
        setLoading(false);
      }
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div 
        className="relative bg-surface w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] my-auto border border-border overflow-hidden animate-in zoom-in-95 duration-150 cursor-default"
        onClick={e => e.stopPropagation()}
      >
        {/* Header with Quick Add Action */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-surface border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-50 text-emerald-700 rounded-xl flex items-center justify-center border border-emerald-100 shadow-2xs">
              <ArrowDownToLine className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-ink-primary flex items-center gap-2">
                <span>Receive Inbound Stock</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Stock Arrival
                </span>
              </h2>
              <p className="text-xs text-ink-muted mt-0.5">
                Select a product to immediately receive stock for all its variants in one click.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenQuickAdd && (
              <button
                type="button"
                onClick={onOpenQuickAdd}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent text-accent hover:text-white font-bold text-xs rounded-xl border border-accent/20 transition cursor-pointer shadow-2xs"
                title="Create a new product and add its initial opening stock"
              >
                <PackagePlus className="w-4 h-4" />
                <span>+ Quick Add Product</span>
              </button>
            )}
            <button 
              onClick={onClose} 
              disabled={loading}
              className="p-2 text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-full transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Live Product Search & Mode Switcher Bar */}
        <div className="p-3 sm:p-4 bg-row-alt/80 border-b border-border space-y-2.5 shrink-0">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Live Search Combobox */}
            <div className="relative flex-1">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search product by name, category, or barcode..."
                  value={productSearch}
                  onFocus={() => setIsSearchDropdownOpen(true)}
                  onChange={e => {
                    setProductSearch(e.target.value);
                    setIsSearchDropdownOpen(true);
                  }}
                  className="w-full pl-10 pr-8 py-2 bg-surface border border-border rounded-xl text-xs sm:text-sm font-semibold text-ink-primary placeholder:text-ink-muted focus:ring-2 focus:ring-accent focus:outline-none shadow-2xs"
                />
                {productSearch && (
                  <button
                    type="button"
                    onClick={() => { setProductSearch(''); setIsSearchDropdownOpen(false); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-primary p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Floating Dropdown Results */}
              {isSearchDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-surface border border-border rounded-xl shadow-xl max-h-64 overflow-y-auto z-50 divide-y divide-border animate-in fade-in zoom-in-95 duration-100">
                  {filteredProducts.length === 0 ? (
                    <div className="p-4 text-center text-xs text-ink-muted space-y-2">
                      <p>No products matching &quot;{productSearch}&quot;</p>
                      {onOpenQuickAdd && (
                        <button
                          type="button"
                          onClick={onOpenQuickAdd}
                          className="px-3 py-1.5 bg-accent text-white font-bold text-xs rounded-lg shadow-xs inline-flex items-center gap-1.5"
                        >
                          <PackagePlus className="w-3.5 h-3.5" />
                          <span>Create New Product &quot;{productSearch}&quot;</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredProducts.map((p: any) => {
                      const categoryName = categories.find(c => c.id === p.category_id)?.name || 'Uncategorized';
                      const isSelected = selectedProduct?.id === p.id;
                      return (
                        <div
                          key={p.id}
                          onClick={() => handleSelectProduct(p)}
                          className={`p-3 flex items-center justify-between hover:bg-row-alt cursor-pointer transition ${
                            isSelected ? 'bg-accent/10 border-l-4 border-accent' : ''
                          }`}
                        >
                          <div>
                            <span className="font-bold text-xs sm:text-sm text-ink-primary block">{p.name}</span>
                            <span className="text-[11px] text-ink-muted">
                              {categoryName} • {p.pieces_per_set} pcs/set • {p.variants?.length || 0} variant(s)
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-mono font-bold text-ink-primary block">
                              {p.totalStock ?? p.variants?.reduce((s: number, v: any) => s + (Number(v.stock_quantity) || 0), 0)} pcs in stock
                            </span>
                            <span className="text-[10px] text-accent font-semibold flex items-center justify-end gap-0.5">
                              Select <ChevronRight className="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Quick Add Button on Mobile */}
            {onOpenQuickAdd && (
              <button
                type="button"
                onClick={onOpenQuickAdd}
                className="flex sm:hidden items-center justify-center gap-1.5 px-3 py-2 bg-accent/10 text-accent font-bold text-xs rounded-xl border border-accent/20"
              >
                <PackagePlus className="w-4 h-4" />
                <span>+ Quick Add Product</span>
              </button>
            )}
          </div>

          {/* Active Product Banner (When Product Selected) */}
          {selectedProduct && (
            <div className="p-3 bg-surface rounded-xl border border-border shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-accent/10 text-accent rounded-lg">
                  <Package className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-ink-primary">{selectedProduct.name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-row-alt border border-border rounded-md text-ink-muted">
                      {selectedProduct.pieces_per_set} pcs/set
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-muted">
                    Displaying all <strong className="text-ink-primary font-bold">{batchRows.length} variants</strong>. Enter quantities below to receive.
                  </p>
                </div>
              </div>

              {/* Total Pieces Badge */}
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-ink-muted block">Receiving</span>
                  <span className="text-xs font-mono font-extrabold text-emerald-700">
                    +{totalPiecesToAdd} pcs ({activeVariantsCount} variants)
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Form Body: All Variants List */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            
            {/* Common Shipment Notes */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-row-alt/40 border border-border rounded-xl">
              <label className="text-xs font-bold text-ink-primary whitespace-nowrap">
                Common PO / Inward Reference Notes:
              </label>
              <input
                type="text"
                value={commonNotes}
                onChange={e => setCommonNotes(e.target.value)}
                placeholder="e.g. Supplier Invoice #9821 / Shipped via DTDC..."
                className="w-full sm:max-w-md px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>

            {/* Desktop Table View (>= 640px) */}
            <div className="hidden sm:block overflow-x-auto rounded-xl border border-border shadow-2xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-row-alt text-ink-muted font-bold uppercase tracking-wider border-b border-border text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Variant</th>
                    <th className="py-3 px-4 text-center">Current Stock</th>
                    <th className="py-3 px-4 text-center w-32">Sets to Add</th>
                    <th className="py-3 px-4 text-center w-32">Loose Pcs to Add</th>
                    <th className="py-3 px-4 text-right">Total Added</th>
                    <th className="py-3 px-4 text-right">New Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {batchRows.map((row, idx) => {
                    const pps = Number(selectedProduct?.pieces_per_set) || 1;
                    const sets = Math.max(0, Number(row.sets_quantity) || 0);
                    const loose = Math.max(0, Number(row.loose_quantity) || 0);
                    const addedPcs = (sets * pps) + loose;
                    const newTotalPcs = row.current_stock + addedPcs;
                    const newSets = pps > 1 ? Math.floor(newTotalPcs / pps) : 0;
                    const newLoose = pps > 1 ? newTotalPcs % pps : 0;
                    const isRowActive = addedPcs > 0;

                    return (
                      <tr 
                        key={row.variant_id}
                        className={`transition ${isRowActive ? 'bg-emerald-50/40' : 'hover:bg-row-alt/40'}`}
                      >
                        <td className="py-3 px-4">
                          <span className="font-bold text-ink-primary block">{row.variant_name}</span>
                          {row.barcode && (
                            <span className="text-[11px] font-mono text-ink-muted">{row.barcode}</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-center font-mono">
                          <span className="font-semibold text-ink-muted">
                            {pps > 1 ? `${row.current_sets}s + ${row.current_stock % pps}l` : ''} ({row.current_stock} pcs)
                          </span>
                        </td>

                        {/* Sets Stepper */}
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateBatchRow(idx, 'sets_quantity', Math.max(0, sets - 1))}
                              className="w-7 h-7 bg-surface hover:bg-row-alt border border-border rounded-lg flex items-center justify-center text-ink-muted hover:text-ink-primary active:scale-95 transition"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number"
                              min="0"
                              value={row.sets_quantity || ''}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                              onChange={e => updateBatchRow(idx, 'sets_quantity', parseInt(e.target.value, 10) || 0)}
                              className="w-12 text-center py-1 bg-surface border border-border rounded-lg font-mono font-bold text-xs focus:ring-1 focus:ring-accent focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => updateBatchRow(idx, 'sets_quantity', sets + 1)}
                              className="w-7 h-7 bg-surface hover:bg-row-alt border border-border rounded-lg flex items-center justify-center text-ink-muted hover:text-ink-primary active:scale-95 transition"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>

                        {/* Loose Stepper */}
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateBatchRow(idx, 'loose_quantity', Math.max(0, loose - 1))}
                              className="w-7 h-7 bg-surface hover:bg-row-alt border border-border rounded-lg flex items-center justify-center text-ink-muted hover:text-ink-primary active:scale-95 transition"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number"
                              min="0"
                              value={row.loose_quantity || ''}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                              onChange={e => updateBatchRow(idx, 'loose_quantity', parseInt(e.target.value, 10) || 0)}
                              className="w-12 text-center py-1 bg-surface border border-border rounded-lg font-mono font-bold text-xs focus:ring-1 focus:ring-accent focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => updateBatchRow(idx, 'loose_quantity', loose + 1)}
                              className="w-7 h-7 bg-surface hover:bg-row-alt border border-border rounded-lg flex items-center justify-center text-ink-muted hover:text-ink-primary active:scale-95 transition"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right font-mono font-bold">
                          {addedPcs > 0 ? (
                            <span className="text-emerald-700">+{addedPcs} pcs</span>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right font-mono font-bold text-ink-primary">
                          {isRowActive ? (
                            <span className="text-ink-primary">
                              {pps > 1 ? `${newSets}s + ${newLoose}l = ` : ''}{newTotalPcs} pcs
                            </span>
                          ) : (
                            <span className="text-ink-muted">{row.current_stock} pcs</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Card View (< 640px) */}
            <div className="block sm:hidden space-y-3">
              {batchRows.map((row, idx) => {
                const pps = Number(selectedProduct?.pieces_per_set) || 1;
                const sets = Math.max(0, Number(row.sets_quantity) || 0);
                const loose = Math.max(0, Number(row.loose_quantity) || 0);
                const addedPcs = (sets * pps) + loose;
                const newTotalPcs = row.current_stock + addedPcs;

                return (
                  <div 
                    key={row.variant_id}
                    className={`p-3.5 rounded-xl border space-y-2.5 transition ${
                      addedPcs > 0 ? 'bg-emerald-50/40 border-emerald-200' : 'bg-surface border-border'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-bold text-xs text-ink-primary block">{row.variant_name}</span>
                        <span className="text-[11px] font-mono text-ink-muted">
                          Stock: {row.current_stock} pcs ({row.current_sets} sets)
                        </span>
                      </div>
                      <div className="text-right">
                        {addedPcs > 0 ? (
                          <span className="font-mono font-extrabold text-xs text-emerald-700 block">
                            +{addedPcs} pcs
                          </span>
                        ) : (
                          <span className="text-[10px] text-ink-muted font-mono">0 pcs</span>
                        )}
                        <span className="text-[10px] font-mono text-ink-primary">
                          New: {newTotalPcs} pcs
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/60">
                      {/* Sets */}
                      <div className="bg-row-alt p-2 rounded-lg border border-border/80 flex flex-col items-center">
                        <span className="text-[10px] uppercase font-bold text-ink-muted mb-1">Sets to Add</span>
                        <div className="flex items-center justify-between w-full">
                          <button
                            type="button"
                            onClick={() => updateBatchRow(idx, 'sets_quantity', Math.max(0, sets - 1))}
                            className="w-7 h-7 bg-surface rounded-md border border-border flex items-center justify-center text-ink-primary active:scale-95"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={row.sets_quantity || ''}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onChange={e => updateBatchRow(idx, 'sets_quantity', parseInt(e.target.value, 10) || 0)}
                            className="w-12 text-center py-0.5 bg-transparent font-mono font-bold text-xs focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => updateBatchRow(idx, 'sets_quantity', sets + 1)}
                            className="w-7 h-7 bg-surface rounded-md border border-border flex items-center justify-center text-ink-primary active:scale-95"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Loose */}
                      <div className="bg-row-alt p-2 rounded-lg border border-border/80 flex flex-col items-center">
                        <span className="text-[10px] uppercase font-bold text-ink-muted mb-1">Loose Pcs</span>
                        <div className="flex items-center justify-between w-full">
                          <button
                            type="button"
                            onClick={() => updateBatchRow(idx, 'loose_quantity', Math.max(0, loose - 1))}
                            className="w-7 h-7 bg-surface rounded-md border border-border flex items-center justify-center text-ink-primary active:scale-95"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={row.loose_quantity || ''}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onChange={e => updateBatchRow(idx, 'loose_quantity', parseInt(e.target.value, 10) || 0)}
                            className="w-12 text-center py-0.5 bg-transparent font-mono font-bold text-xs focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => updateBatchRow(idx, 'loose_quantity', loose + 1)}
                            className="w-7 h-7 bg-surface rounded-md border border-border flex items-center justify-center text-ink-primary active:scale-95"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>

          {/* Footer */}
          <div className="p-4 sm:p-5 bg-surface border-t border-border flex items-center justify-between gap-3 shrink-0">
            <div className="text-xs text-ink-muted hidden sm:block">
              {totalPiecesToAdd > 0 ? (
                <span>
                  Adding <strong className="font-mono text-emerald-700">+{totalPiecesToAdd} pieces</strong> across <strong className="text-ink-primary">{activeVariantsCount}</strong> variant(s)
                </span>
              ) : (
                <span>Enter sets or loose quantities to receive stock</span>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button 
                type="button" 
                onClick={onClose} 
                disabled={loading}
                className="px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={loading || totalPiecesToAdd === 0}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold rounded-xl transition flex items-center gap-2 shadow-sm disabled:opacity-40 cursor-pointer min-h-[40px]"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {loading ? 'Recording Inward...' : totalPiecesToAdd > 0 ? `Confirm Arrival (+${totalPiecesToAdd} pcs)` : 'Confirm Stock Arrival'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
