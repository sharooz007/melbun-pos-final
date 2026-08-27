'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Package, 
  Plus, 
  Minus, 
  ShoppingCart, 
  Barcode, 
  Layers, 
  Check,
  AlertCircle
} from 'lucide-react';
import { formatINR, formatDualQuantity } from '@/lib/formatters';

export interface GroupedProductVariant {
  variant_id: string;
  name: string;
  variant_name: string;
  barcode: string;
  price: number;
  selling_price: number;
  stock_quantity: number;
  stock_sets: number;
  pieces_per_set: number;
}

export interface GroupedProductResult {
  product_id: string;
  product_name: string;
  pieces_per_set: number;
  min_price: number;
  max_price: number;
  total_stock_quantity: number;
  total_stock_sets: number;
  variants: GroupedProductVariant[];
}

interface ProductVariantSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  productGroup: GroupedProductResult | null;
  onAddItems: (
    product: GroupedProductResult,
    items: Array<{ variant: GroupedProductVariant; sets: number; loose: number }>
  ) => void;
}

export default function ProductVariantSelectModal({
  isOpen,
  onClose,
  productGroup,
  onAddItems
}: ProductVariantSelectModalProps) {
  // Map of variant_id -> { sets: number, loose: number }
  const [quantities, setQuantities] = useState<Record<string, { sets: number; loose: number }>>({});

  // Reset quantities when opening with a new product
  useEffect(() => {
    if (!productGroup || !isOpen) {
      setQuantities({});
      return;
    }

    const initial: Record<string, { sets: number; loose: number }> = {};
    productGroup.variants.forEach((v) => {
      initial[v.variant_id] = { sets: 0, loose: 0 };
    });
    setQuantities(initial);
  }, [productGroup, isOpen]);

  // Escape key dismissal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const piecesPerSet = Math.max(1, Number(productGroup?.pieces_per_set || 1));

  // Compute total selected items & price summary
  const summary = useMemo(() => {
    let totalSets = 0;
    let totalLoose = 0;
    let totalPieces = 0;
    let totalPrice = 0;
    const itemsToAdd: Array<{ variant: GroupedProductVariant; sets: number; loose: number }> = [];

    if (productGroup) {
      productGroup.variants.forEach((v) => {
        const q = quantities[v.variant_id] || { sets: 0, loose: 0 };
        const itemPieces = (q.sets * piecesPerSet) + q.loose;
        if (itemPieces > 0) {
          totalSets += q.sets;
          totalLoose += q.loose;
          totalPieces += itemPieces;
          totalPrice += (itemPieces * Number(v.selling_price || v.price || 0));
          itemsToAdd.push({ variant: v, sets: q.sets, loose: q.loose });
        }
      });
    }

    return { totalSets, totalLoose, totalPieces, totalPrice, itemsToAdd };
  }, [productGroup, quantities, piecesPerSet]);

  if (!isOpen || !productGroup) return null;

  const handleUpdateQty = (variantId: string, field: 'sets' | 'loose', delta: number) => {
    setQuantities((prev) => {
      const current = prev[variantId] || { sets: 0, loose: 0 };
      const nextVal = Math.max(0, current[field] + delta);
      return {
        ...prev,
        [variantId]: {
          ...current,
          [field]: nextVal
        }
      };
    });
  };

  const handleDirectQtyChange = (variantId: string, field: 'sets' | 'loose', valStr: string) => {
    const parsed = Math.max(0, parseInt(valStr.replace(/[^0-9]/g, '') || '0', 10));
    setQuantities((prev) => {
      const current = prev[variantId] || { sets: 0, loose: 0 };
      return {
        ...prev,
        [variantId]: {
          ...current,
          [field]: parsed
        }
      };
    });
  };

  const handleAddQuickSets = (variantId: string, setsToAdd: number) => {
    setQuantities((prev) => {
      const current = prev[variantId] || { sets: 0, loose: 0 };
      return {
        ...prev,
        [variantId]: {
          ...current,
          sets: current.sets + setsToAdd
        }
      };
    });
  };

  const handleConfirmAdd = () => {
    if (summary.itemsToAdd.length === 0) return;
    onAddItems(productGroup, summary.itemsToAdd);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150 cursor-pointer"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="bg-surface rounded-2xl sm:rounded-3xl max-w-2xl w-full p-4 sm:p-6 shadow-2xl border border-border flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150 cursor-default text-ink-primary font-sans"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-border">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-xl font-bold text-ink-primary truncate">
                {productGroup.product_name}
              </h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-accent/10 text-accent border border-accent/20">
                {piecesPerSet} pcs / set
              </span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-row-alt text-ink-muted border border-border">
                {productGroup.variants.length} variant{productGroup.variants.length !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              Select quantities across variants to add directly into cart
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-full transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Variant Cards List */}
        <div className="flex-1 overflow-y-auto space-y-3 py-3 pr-0.5">
          {productGroup.variants.map((v) => {
            const q = quantities[v.variant_id] || { sets: 0, loose: 0 };
            const varTotalPieces = (q.sets * piecesPerSet) + q.loose;
            const varPrice = Number(v.selling_price || v.price || 0);
            const varLineTotal = varTotalPieces * varPrice;
            const isOutOfStock = Number(v.stock_quantity || 0) <= 0;

            return (
              <div 
                key={v.variant_id} 
                className={`p-3.5 rounded-2xl border transition-colors space-y-3 ${
                  varTotalPieces > 0
                    ? 'bg-accent/5 border-accent/40 shadow-2xs'
                    : 'bg-row-alt border-border'
                }`}
              >
                {/* Variant Top Row: Name, Barcode, Price & Stock */}
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-ink-primary">
                        {v.variant_name}
                      </span>
                      {isOutOfStock && (
                        <span className="text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/40 px-1.5 py-0.5 rounded">
                          Out of Stock
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-muted font-mono flex items-center gap-1.5 mt-0.5">
                      <Barcode className="w-3 h-3 text-ink-muted" />
                      <span>{v.barcode || 'No barcode'}</span>
                      <span>•</span>
                      <span>Stock: {formatDualQuantity(v.stock_quantity, piecesPerSet)}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-bold font-mono text-sm text-accent">
                      {formatINR(varPrice)}
                    </div>
                    {varTotalPieces > 0 && (
                      <div className="text-[11px] font-mono font-bold text-ink-primary mt-0.5">
                        = {formatINR(varLineTotal)} ({varTotalPieces} pcs)
                      </div>
                    )}
                  </div>
                </div>

                {/* Quantity Controls Matrix */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-border/60">
                  
                  {/* Left: Sets Stepper & Quick Increment Chips */}
                  <div className="space-y-1.5 flex-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block">
                      Sets ({piecesPerSet} pcs/set)
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center bg-surface border border-border rounded-xl shadow-2xs">
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(v.variant_id, 'sets', -1)}
                          disabled={q.sets <= 0}
                          className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-l-xl transition disabled:opacity-30 cursor-pointer active:scale-95"
                          aria-label="Decrease sets"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={q.sets}
                          onChange={(e) => handleDirectQtyChange(v.variant_id, 'sets', e.target.value)}
                          className="w-12 sm:w-14 text-center font-mono font-bold text-sm bg-transparent outline-none text-ink-primary"
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(v.variant_id, 'sets', 1)}
                          className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-r-xl transition cursor-pointer active:scale-95"
                          aria-label="Increase sets"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Quick +1, +2, +5 Chips */}
                      <div className="flex items-center gap-1">
                        {[1, 2, 5].map((addNum) => (
                          <button
                            key={addNum}
                            type="button"
                            onClick={() => handleAddQuickSets(v.variant_id, addNum)}
                            className="px-2 py-1.5 bg-surface hover:bg-row-alt border border-border rounded-lg text-xs font-bold text-ink-primary transition shadow-2xs cursor-pointer active:scale-95"
                          >
                            +{addNum}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right: Loose Pieces Stepper (Only if pieces_per_set > 1) */}
                  {piecesPerSet > 1 && (
                    <div className="space-y-1.5 shrink-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block">
                        Loose Pcs
                      </span>
                      <div className="flex items-center bg-surface border border-border rounded-xl shadow-2xs">
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(v.variant_id, 'loose', -1)}
                          disabled={q.loose <= 0}
                          className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-l-xl transition disabled:opacity-30 cursor-pointer active:scale-95"
                          aria-label="Decrease loose pieces"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={q.loose}
                          onChange={(e) => handleDirectQtyChange(v.variant_id, 'loose', e.target.value)}
                          className="w-12 sm:w-14 text-center font-mono font-bold text-sm bg-transparent outline-none text-ink-primary"
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(v.variant_id, 'loose', 1)}
                          className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-r-xl transition cursor-pointer active:scale-95"
                          aria-label="Increase loose pieces"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Sticky Footer */}
        <div className="pt-3 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-xs text-ink-muted font-medium">
              Selected: <strong className="text-ink-primary font-mono">{summary.totalSets} sets</strong>
              {summary.totalLoose > 0 && <span className="font-mono"> + {summary.totalLoose} pcs</span>}
              {' '}(<strong className="text-ink-primary font-mono">{summary.totalPieces} pcs total</strong>)
            </div>
            <div className="text-base sm:text-lg font-extrabold text-accent font-mono">
              Total: {formatINR(summary.totalPrice)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition cursor-pointer flex-1 sm:flex-none"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmAdd}
              disabled={summary.totalPieces === 0}
              className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-xs transition disabled:opacity-40 cursor-pointer min-h-[42px] flex-1 sm:flex-none"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Add to Cart ({summary.totalPieces})</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
