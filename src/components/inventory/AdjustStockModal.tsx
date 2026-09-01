'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  SlidersHorizontal, 
  PackagePlus, 
  Loader2, 
  AlertCircle, 
  TrendingUp, 
  Check, 
  Layers,
  ArrowRight,
  Info,
  PackageCheck,
  Save
} from 'lucide-react';
import { adjustProductStockAction, restockProductVariantsAction } from '@/lib/actions/inventory';
import toast from 'react-hot-toast';

interface VariantItem {
  id: string;
  name: string;
  barcode?: string;
  cost_price: number | string;
  selling_price: number | string;
  stock_quantity: number;
  stock_sets?: number;
  pieces_per_set?: number;
}

interface ProductData {
  id: string;
  name: string;
  pieces_per_set: number;
  variants: VariantItem[];
  category?: { name: string } | null;
}

interface AdjustStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: ProductData | null;
  onSuccess?: () => void;
}

export default function AdjustStockModal({
  isOpen,
  onClose,
  product,
  onSuccess
}: AdjustStockModalProps) {
  const [activeTab, setActiveTab] = useState<'adjust' | 'restock'>('adjust');
  const isSubmittingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TAB 1: Manual Adjust State
  // Map of variantId -> { sets: string, loose: string }
  const [adjustRows, setAdjustRows] = useState<Record<string, { sets: string; loose: string }>>({});
  const [adjustReason, setAdjustReason] = useState<string>('Physical stock count reconcile');
  const [customReason, setCustomReason] = useState<string>('');

  // TAB 2: Restock State
  // Map of variantId -> { addSets: string, addLoose: string, incomingCost: string, finalCost: string, finalSell: string, userCostOverridden: boolean }
  const [restockRows, setRestockRows] = useState<Record<string, {
    addSets: string;
    addLoose: string;
    incomingCost: string;
    finalCost: string;
    finalSell: string;
    userCostOverridden: boolean;
  }>>({});
  const [restockNotes, setRestockNotes] = useState<string>('');

  // Initialize form states when product opens
  useEffect(() => {
    if (!product || !isOpen) return;

    setError(null);

    // Init Adjust Rows with current on-hand quantities
    const initialAdjust: Record<string, { sets: string; loose: string }> = {};
    const initialRestock: Record<string, {
      addSets: string;
      addLoose: string;
      incomingCost: string;
      finalCost: string;
      finalSell: string;
      userCostOverridden: boolean;
    }> = {};

    product.variants.forEach((v) => {
      const vPps = Number(v.pieces_per_set || product.pieces_per_set || 1);
      const totalQty = Number(v.stock_quantity || 0);
      const setsQty = v.stock_sets !== undefined ? Number(v.stock_sets) : Math.floor(totalQty / vPps);
      const looseQty = Math.max(0, totalQty - (setsQty * vPps));
      const currCost = Math.round(Number(v.cost_price || 0));
      const currSell = Math.round(Number(v.selling_price || 0));

      initialAdjust[v.id] = {
        sets: String(setsQty),
        loose: String(looseQty)
      };

      initialRestock[v.id] = {
        addSets: '0',
        addLoose: '0',
        incomingCost: String(currCost),
        finalCost: String(currCost),
        finalSell: String(currSell),
        userCostOverridden: false
      };
    });

    setAdjustRows(initialAdjust);
    setRestockRows(initialRestock);
  }, [product, isOpen]);

  // Escape Key Dismissal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen || !product) return null;

  const piecesPerSet = Number(product.pieces_per_set || 1);

  // Handle manual adjust input change
  const handleAdjustChange = (variantId: string, field: 'sets' | 'loose', value: string) => {
    const cleanVal = value.replace(/[^0-9]/g, '');
    setAdjustRows(prev => ({
      ...prev,
      [variantId]: {
        ...prev[variantId],
        [field]: cleanVal
      }
    }));
  };

  // Submit Manual Adjust
  const handleManualAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading) return;

    const adjustments = product.variants.map((v) => {
      const row = adjustRows[v.id] || { sets: '0', loose: '0' };
      return {
        variant_id: v.id,
        sets_quantity: parseInt(row.sets || '0', 10) || 0,
        loose_quantity: parseInt(row.loose || '0', 10) || 0
      };
    });

    const finalReason = adjustReason === 'Other' ? (customReason.trim() || 'Manual adjustment') : adjustReason;

    try {
      isSubmittingRef.current = true;
      setLoading(true);
      setError(null);

      const res = await adjustProductStockAction({
        product_id: product.id,
        adjustments,
        reason: finalReason
      });

      if (!res.success) {
        setError(res.error || 'Failed to adjust stock');
      } else {
        toast.success('Stock adjusted successfully!');
        onSuccess?.();
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  // Calculate Moving Average Cost (MAC) with zero-division protection and integer rounding
  const calculateMAC = (currentPieces: number, currentCost: number, incomingPieces: number, incomingCost: number): number => {
    const q1 = Math.max(0, currentPieces);
    const c1 = currentCost;
    const q2 = Math.max(0, incomingPieces);
    const c2 = incomingCost;
    const totalPieces = q1 + q2;

    if (q1 <= 0 || totalPieces <= 0) {
      return Math.round(c2);
    }
    return Math.round(((q1 * c1) + (q2 * c2)) / totalPieces);
  };

  // Handle restock input change & update Moving Average Cost
  const handleRestockChange = (
    variantId: string, 
    field: 'addSets' | 'addLoose' | 'incomingCost' | 'finalCost' | 'finalSell', 
    value: string
  ) => {
    const cleanVal = field === 'incomingCost' || field === 'finalCost' || field === 'finalSell'
      ? value.replace(/[^0-9]/g, '')
      : value.replace(/[^0-9]/g, '');

    setRestockRows(prev => {
      const currentRow = prev[variantId] || {
        addSets: '0',
        addLoose: '0',
        incomingCost: '0',
        finalCost: '0',
        finalSell: '0',
        userCostOverridden: false
      };

      const updatedRow = {
        ...currentRow,
        [field]: cleanVal
      };

      // If user explicitly edited finalCost, mark overridden
      if (field === 'finalCost') {
        updatedRow.userCostOverridden = true;
      }

      // If user modified addSets, addLoose, or incomingCost (and hasn't manually overridden finalCost), recalculate MAC
      if (field === 'addSets' || field === 'addLoose' || field === 'incomingCost') {
        if (!updatedRow.userCostOverridden) {
          const variant = product.variants.find(v => v.id === variantId);
          const vPps = Number(variant?.pieces_per_set || product.pieces_per_set || 1);
          const currentPieces = Number(variant?.stock_quantity || 0);
          const currentCost = Math.round(Number(variant?.cost_price || 0));
          const addSets = parseInt(updatedRow.addSets || '0', 10) || 0;
          const addLoose = parseInt(updatedRow.addLoose || '0', 10) || 0;
          const incomingPieces = (addSets * vPps) + addLoose;
          const incomingCost = parseInt(updatedRow.incomingCost || '0', 10) || currentCost;

          const mac = calculateMAC(currentPieces, currentCost, incomingPieces, incomingCost);
          updatedRow.finalCost = String(mac);
        }
      }

      return {
        ...prev,
        [variantId]: updatedRow
      };
    });
  };

  // Submit Restock
  const handleRestockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading) return;

    let hasAnyStockAdded = false;
    const restocks = product.variants.map((v) => {
      const row = restockRows[v.id] || {
        addSets: '0',
        addLoose: '0',
        incomingCost: '0',
        finalCost: '0',
        finalSell: '0',
        userCostOverridden: false
      };

      const sets = parseInt(row.addSets || '0', 10) || 0;
      const loose = parseInt(row.addLoose || '0', 10) || 0;
      const cost = parseInt(row.finalCost || '0', 10) || Math.round(Number(v.cost_price || 0));
      const sell = parseInt(row.finalSell || '0', 10) || Math.round(Number(v.selling_price || 0));

      if (sets > 0 || loose > 0) {
        hasAnyStockAdded = true;
      }

      return {
        variant_id: v.id,
        sets_quantity: sets,
        loose_quantity: loose,
        cost_price: cost,
        selling_price: sell
      };
    });

    if (!hasAnyStockAdded) {
      setError('Please enter at least 1 set or loose piece to restock.');
      return;
    }

    try {
      isSubmittingRef.current = true;
      setLoading(true);
      setError(null);

      const res = await restockProductVariantsAction({
        product_id: product.id,
        restocks,
        notes: restockNotes.trim() || 'Inventory Restock'
      });

      if (!res.success) {
        setError(res.error || 'Failed to restock inventory');
      } else {
        toast.success('Inventory restocked and prices updated!');
        onSuccess?.();
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const ppsList = product.variants.map(v => Number(v.pieces_per_set || product.pieces_per_set || 1));
  const isMixedPps = new Set(ppsList).size > 1;

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150 cursor-pointer"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
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
              <h2 className="text-base sm:text-lg font-bold text-ink-primary truncate">
                {product.name}
              </h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-accent/10 text-accent border border-accent/20">
                {isMixedPps ? 'Mixed Pack Sizes' : `${product.variants[0]?.pieces_per_set || product.pieces_per_set || 1} pcs / set`}
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              Dual-inventory adjustment &amp; moving average cost restock
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1.5 text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-full transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-2 pt-3 pb-1 border-b border-border">
          <button
            type="button"
            onClick={() => { setActiveTab('adjust'); setError(null); }}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'adjust'
                ? 'bg-accent text-white shadow-xs'
                : 'bg-surface text-ink-muted hover:text-ink-primary hover:bg-row-alt border border-border'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>Manual Adjust</span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('restock'); setError(null); }}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'restock'
                ? 'bg-accent text-white shadow-xs'
                : 'bg-surface text-ink-muted hover:text-ink-primary hover:bg-row-alt border border-border'
            }`}
          >
            <PackagePlus className="w-4 h-4" />
            <span>Restock (Moving Avg Cost)</span>
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="my-3 p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* TAB 1: MANUAL ADJUST */}
        {activeTab === 'adjust' && (
          <form onSubmit={handleManualAdjustSubmit} className="flex-1 overflow-y-auto space-y-4 py-3">
            <div className="space-y-3">
              {product.variants.map((v) => {
                const row = adjustRows[v.id] || { sets: '0', loose: '0' };
                const vPps = Number(v.pieces_per_set || product.pieces_per_set || 1);
                const currentTotal = Number(v.stock_quantity || 0);
                const currentSets = v.stock_sets !== undefined ? Number(v.stock_sets) : Math.floor(currentTotal / vPps);
                const currentLoose = Math.max(0, currentTotal - (currentSets * vPps));

                const newSets = parseInt(row.sets || '0', 10) || 0;
                const newLoose = parseInt(row.loose || '0', 10) || 0;
                const newTotal = (newSets * vPps) + newLoose;
                const delta = newTotal - currentTotal;

                return (
                  <div key={v.id} className="p-3.5 bg-row-alt rounded-2xl border border-border space-y-3">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <h4 className="font-bold text-xs sm:text-sm text-ink-primary">{v.name}</h4>
                        <p className="text-[11px] text-ink-muted font-mono mt-0.5">
                          Current on-hand: <span className="font-bold text-ink-primary">{currentSets} sets + {currentLoose} pcs</span> ({currentTotal} total pcs)
                        </p>
                      </div>

                      {/* Live Delta Badge */}
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border font-mono ${
                        delta > 0 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                          : delta < 0 
                          ? 'bg-red-50 text-red-700 border-red-200' 
                          : 'bg-surface text-ink-muted border-border'
                      }`}>
                        {delta > 0 ? `+${delta} pcs` : delta < 0 ? `${delta} pcs` : '0 change'}
                      </span>
                    </div>

                    {/* New Count Inputs Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 items-center">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                          Sets ({vPps} pcs/set)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={row.sets}
                          onChange={(e) => handleAdjustChange(v.id, 'sets', e.target.value)}
                          className="w-full p-2 bg-surface border border-border rounded-xl font-mono text-sm font-bold text-ink-primary focus:ring-2 focus:ring-accent outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                          Loose Pieces
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={row.loose}
                          onChange={(e) => handleAdjustChange(v.id, 'loose', e.target.value)}
                          className="w-full p-2 bg-surface border border-border rounded-xl font-mono text-sm font-bold text-ink-primary focus:ring-2 focus:ring-accent outline-none"
                        />
                      </div>

                      <div className="col-span-2 sm:col-span-1 bg-surface p-2 rounded-xl border border-border">
                        <span className="text-[10px] uppercase font-bold text-ink-muted block">
                          New Total
                        </span>
                        <div className="font-mono font-bold text-sm text-ink-primary mt-0.5">
                          {newTotal} pcs
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Adjustment Reason Picker */}
            <div className="bg-row-alt p-3.5 rounded-2xl border border-border space-y-2.5">
              <label className="block text-xs font-bold text-ink-primary">
                Adjustment Reason <span className="text-red-500">*</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  'Physical stock count reconcile',
                  'Damaged / Lost during handling',
                  'Stock correction / Data entry fix',
                  'Other'
                ].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAdjustReason(r)}
                    className={`p-2 rounded-xl text-left text-xs font-semibold border transition cursor-pointer ${
                      adjustReason === r
                        ? 'bg-accent/10 text-accent border-accent font-bold'
                        : 'bg-surface text-ink-primary border-border hover:bg-row-alt'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {adjustReason === 'Other' && (
                <input
                  type="text"
                  placeholder="Specify reason for adjustment..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="w-full p-2 bg-surface border border-border rounded-xl text-xs text-ink-primary focus:ring-2 focus:ring-accent outline-none mt-2"
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-3 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 bg-surface hover:bg-row-alt border border-border text-ink-primary rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Confirm Stock Adjustment</span>
              </button>
            </div>
          </form>
        )}

        {/* TAB 2: RESTOCK (MOVING AVERAGE COST) */}
        {activeTab === 'restock' && (
          <form onSubmit={handleRestockSubmit} className="flex-1 overflow-y-auto space-y-4 py-3">
            <div className="space-y-3">
              {product.variants.map((v) => {
                const row = restockRows[v.id] || {
                  addSets: '0',
                  addLoose: '0',
                  incomingCost: '0',
                  finalCost: '0',
                  finalSell: '0',
                  userCostOverridden: false
                };

                const vPps = Number(v.pieces_per_set || product.pieces_per_set || 1);
                const currentTotal = Number(v.stock_quantity || 0);
                const currentCost = Math.round(Number(v.cost_price || 0));
                const currentSell = Math.round(Number(v.selling_price || 0));

                const addSets = parseInt(row.addSets || '0', 10) || 0;
                const addLoose = parseInt(row.addLoose || '0', 10) || 0;
                const incomingPieces = (addSets * vPps) + addLoose;
                const incomingCost = parseInt(row.incomingCost || '0', 10) || currentCost;

                const computedMAC = calculateMAC(currentTotal, currentCost, incomingPieces, incomingCost);

                return (
                  <div key={v.id} className="p-3.5 bg-row-alt rounded-2xl border border-border space-y-3">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <h4 className="font-bold text-xs sm:text-sm text-ink-primary">{v.name}</h4>
                        <p className="text-[11px] text-ink-muted font-mono mt-0.5">
                          On-hand: <span className="font-bold text-ink-primary">{currentTotal} pcs</span> (Current Cost: ₹{currentCost})
                        </p>
                      </div>

                      {incomingPieces > 0 && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">
                          +{incomingPieces} pcs incoming
                        </span>
                      )}
                    </div>

                    {/* Restock Quantity Inputs */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                          + Add Sets ({vPps} pcs/set)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={row.addSets}
                          onChange={(e) => handleRestockChange(v.id, 'addSets', e.target.value)}
                          className="w-full p-2 bg-surface border border-border rounded-xl font-mono text-sm font-bold text-ink-primary focus:ring-2 focus:ring-accent outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                          + Add Loose Pcs
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={row.addLoose}
                          onChange={(e) => handleRestockChange(v.id, 'addLoose', e.target.value)}
                          className="w-full p-2 bg-surface border border-border rounded-xl font-mono text-sm font-bold text-ink-primary focus:ring-2 focus:ring-accent outline-none"
                        />
                      </div>
                    </div>

                    {/* Price & Moving Average Cost Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                          Shipment Cost (₹/pc)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={row.incomingCost}
                          onChange={(e) => handleRestockChange(v.id, 'incomingCost', e.target.value)}
                          className="w-full p-2 bg-surface border border-border rounded-xl font-mono text-sm font-bold text-ink-primary focus:ring-2 focus:ring-accent outline-none"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                            Final Cost (₹/pc)
                          </label>
                          <span className="text-[9px] font-bold px-1 rounded bg-accent/10 text-accent" title="Auto-computed Moving Average Cost">
                            MAC: ₹{computedMAC}
                          </span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          value={row.finalCost}
                          onChange={(e) => handleRestockChange(v.id, 'finalCost', e.target.value)}
                          className="w-full p-2 bg-surface border border-accent/40 rounded-xl font-mono text-sm font-bold text-accent focus:ring-2 focus:ring-accent outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                          Selling Price (₹/pc)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={row.finalSell}
                          onChange={(e) => handleRestockChange(v.id, 'finalSell', e.target.value)}
                          className="w-full p-2 bg-surface border border-border rounded-xl font-mono text-sm font-bold text-ink-primary focus:ring-2 focus:ring-accent outline-none"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Restock Reference Note */}
            <div className="space-y-1 pt-2 border-t border-border">
              <label className="block text-xs font-bold text-ink-primary">
                Restock Reference / Invoice Note (Optional)
              </label>
              <input
                type="text"
                value={restockNotes}
                onChange={(e) => setRestockNotes(e.target.value)}
                placeholder="e.g. Invoice #204 from Surat Mills, Batch Aug-27..."
                className="w-full p-2.5 bg-surface border border-border rounded-xl text-xs text-ink-primary focus:ring-2 focus:ring-accent outline-none"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
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
                disabled={loading}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition cursor-pointer min-h-[40px]"
              >
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Restock</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
