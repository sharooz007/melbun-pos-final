'use client'
import React, { useState, useMemo, useRef } from 'react';
import { Package, X, Trash2, Search, ArrowDownToLine, Plus, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface ReceiveStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { variant_id: string, sets_quantity: number, loose_quantity: number, notes: string }[]) => Promise<void>;
  variants: { id: string, name: string, barcode?: string, product: any }[];
}

export function ReceiveStockModal({ isOpen, onClose, onSubmit, variants }: ReceiveStockModalProps) {
  const [rows, setRows] = useState([{ variant_id: '', sets_quantity: 0, loose_quantity: 0, notes: '' }]);
  const [loading, setLoading] = useState(false);
  const [variantSearch, setVariantSearch] = useState('');
  const isSubmittingRef = useRef(false);

  const filteredVariants = useMemo(() => {
    const q = variantSearch.trim().toLowerCase();
    if (!q) return variants;
    return variants.filter(v => {
      const p = Array.isArray(v.product) ? v.product[0] : v.product;
      const pName = (p?.name || '').toLowerCase();
      const vName = (v.name || '').toLowerCase();
      const barcode = (v.barcode || '').toLowerCase();
      return pName.includes(q) || vName.includes(q) || barcode.includes(q);
    });
  }, [variants, variantSearch]);

  if (!isOpen) return null;

  const updateRow = (index: number, field: string, value: any) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    setRows(newRows);
  };

  const removeRow = (index: number) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const addRow = () => {
    setRows([...rows, { variant_id: '', sets_quantity: 0, loose_quantity: 0, notes: '' }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading) return;

    const invalidRowIdx = rows.findIndex(r => !r.variant_id || (r.sets_quantity <= 0 && r.loose_quantity <= 0));
    if (invalidRowIdx >= 0) {
      toast.error(`Row ${invalidRowIdx + 1}: Please select a variant and enter a positive quantity (sets or loose).`);
      return;
    }

    const validRows = rows.filter(r => r.variant_id && (r.sets_quantity > 0 || r.loose_quantity > 0));

    try {
      isSubmittingRef.current = true;
      setLoading(true);
      await onSubmit(validRows);
      setRows([{ variant_id: '', sets_quantity: 0, loose_quantity: 0, notes: '' }]);
      onClose();
    } catch {
      // Toast error handled in parent
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div 
        className="relative bg-surface w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[88vh] my-auto border border-border overflow-hidden animate-in zoom-in-95 duration-150 cursor-default"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-surface border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
              <ArrowDownToLine className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-ink-primary">Receive Inbound Stock</h2>
              <p className="text-xs text-ink-muted mt-0.5">Record new shipment arrivals with dual inventory breakdown</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            disabled={loading}
            className="p-2 text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-full transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Variant Search Quick Filter */}
        <div className="px-4 sm:px-6 py-2.5 bg-row-alt/60 border-b border-border flex items-center gap-2.5 shrink-0">
          <Search className="w-4 h-4 text-ink-muted shrink-0" />
          <input
            type="text"
            placeholder="Search variant dropdown by product, name, or barcode..."
            value={variantSearch}
            onChange={e => setVariantSearch(e.target.value)}
            className="w-full bg-transparent text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
          {variantSearch && (
            <button 
              onClick={() => setVariantSearch('')} 
              className="text-xs font-semibold text-ink-muted hover:text-ink-primary p-0.5"
            >
              Clear
            </button>
          )}
        </div>

        {/* Scrollable Form Body */}
        <form id="receiveForm" onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3.5">
            {rows.map((row, idx) => {
              const rowOptions = (row.variant_id && !filteredVariants.some(v => v.id === row.variant_id))
                ? [variants.find(v => v.id === row.variant_id)!, ...filteredVariants].filter(Boolean)
                : filteredVariants;

              return (
                <div key={idx} className="p-3.5 bg-row-alt/50 rounded-xl border border-border space-y-3">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-xs font-bold text-ink-primary">Shipment Item #{idx + 1}</span>
                    {rows.length > 1 && (
                      <button 
                        type="button" 
                        onClick={() => removeRow(idx)}
                        className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Variant Selection */}
                  <div>
                    <label className="block text-[11px] font-medium text-ink-muted mb-1">Select Variant *</label>
                    <select 
                      value={row.variant_id} 
                      onChange={e => updateRow(idx, 'variant_id', e.target.value)}
                      className="w-full bg-surface border border-border p-2.5 text-xs font-semibold rounded-xl text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none cursor-pointer"
                      required
                    >
                      <option value="">Select a variant...</option>
                      {rowOptions.map(v => {
                        const p = Array.isArray(v.product) ? v.product[0] : v.product;
                        return (
                          <option key={v.id} value={v.id}>
                            {p?.name} — {v.name} {v.barcode ? `(${v.barcode})` : ''} • ({p?.pieces_per_set} pcs/set)
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Dual Inventory Counts & Notes */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-ink-muted mb-1">Sets Qty</label>
                      <input 
                        type="number" 
                        min="0" 
                        value={row.sets_quantity || ''}
                        onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                        onFocus={e => e.target.select()}
                        onChange={e => updateRow(idx, 'sets_quantity', parseInt(e.target.value) || 0)}
                        className="w-full bg-surface border border-border p-2 text-xs font-mono font-bold text-right rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-ink-muted mb-1">Loose Pcs Qty</label>
                      <input 
                        type="number" 
                        min="0" 
                        value={row.loose_quantity || ''}
                        onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                        onFocus={e => e.target.select()}
                        onChange={e => updateRow(idx, 'loose_quantity', parseInt(e.target.value) || 0)}
                        className="w-full bg-surface border border-border p-2 text-xs font-mono font-bold text-right rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-ink-muted mb-1">PO / Inward Notes</label>
                      <input 
                        type="text" 
                        value={row.notes}
                        onChange={e => updateRow(idx, 'notes', e.target.value)}
                        className="w-full bg-surface border border-border p-2 text-xs font-medium rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                        placeholder="Supplier invoice / notes..."
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            <button 
              type="button" 
              onClick={addRow}
              className="px-3 py-2 text-xs font-bold text-accent hover:bg-accent/5 rounded-xl border border-accent/20 flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add another variant row</span>
            </button>
          </div>

          {/* Footer */}
          <div className="p-4 sm:p-5 bg-surface border-t border-border flex items-center justify-end gap-2.5 shrink-0">
            <button 
              type="button" 
              onClick={onClose} 
              disabled={loading}
              className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={loading}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{loading ? 'Receiving...' : 'Confirm Stock Arrival'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
