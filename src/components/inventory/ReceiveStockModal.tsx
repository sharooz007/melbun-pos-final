'use client'
import React, { useState, useMemo, useRef } from 'react';
import { Package, X, Trash, Search } from 'lucide-react';
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
    } catch (err) {
      // Error is handled by toast in parent
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1A17]/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-surface rounded-[16px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] w-full max-w-4xl overflow-hidden transform animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-ink-muted" />
            <h2 className="text-xl font-bold text-ink-primary">Receive Stock (Dual Inventory)</h2>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink-primary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Variant Search Quick Filter */}
        <div className="px-6 pt-4 pb-2 bg-row-alt/50 border-b border-border flex items-center gap-3">
          <Search className="w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Quick filter variants dropdown by product, variant name, or barcode..."
            value={variantSearch}
            onChange={e => setVariantSearch(e.target.value)}
            className="w-full bg-transparent text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
          {variantSearch && (
            <button onClick={() => setVariantSearch('')} className="text-xs text-ink-muted hover:text-ink-primary">
              Clear
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
            {rows.map((row, idx) => {
              // Ensure the selected variant of this row is never dropped by the search filter
              const rowOptions = (row.variant_id && !filteredVariants.some(v => v.id === row.variant_id))
                ? [variants.find(v => v.id === row.variant_id)!, ...filteredVariants].filter(Boolean)
                : filteredVariants;

              return (
                <div key={idx} className="flex gap-4 items-end bg-row-alt p-4 rounded-[12px] border border-border relative group">
                  <div className="flex-1">
                    <label className="block text-[13px] font-medium text-ink-muted mb-1.5">Variant</label>
                    <select 
                      value={row.variant_id} 
                      onChange={e => updateRow(idx, 'variant_id', e.target.value)}
                      className="input-control"
                      required
                    >
                      <option value="">Select a variant...</option>
                      {rowOptions.map(v => {
                         const p = Array.isArray(v.product) ? v.product[0] : v.product;
                         return (
                           <option key={v.id} value={v.id}>
                             {p?.name} - {v.name} {v.barcode ? `(${v.barcode})` : ''} • {p?.pieces_per_set} pcs/set
                           </option>
                         );
                      })}
                    </select>
                  </div>
                <div className="w-24">
                  <label className="block text-[13px] font-medium text-ink-muted mb-1.5">Sets</label>
                  <input 
                    type="number" min="0" value={row.sets_quantity || ''}
                    onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                    onFocus={e => e.target.select()}
                    onChange={e => updateRow(idx, 'sets_quantity', parseInt(e.target.value) || 0)}
                    className="input-control text-right font-mono"
                    placeholder="0"
                  />
                </div>
                <div className="w-24">
                  <label className="block text-[13px] font-medium text-ink-muted mb-1.5">Loose</label>
                  <input 
                    type="number" min="0" value={row.loose_quantity || ''}
                    onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                    onFocus={e => e.target.select()}
                    onChange={e => updateRow(idx, 'loose_quantity', parseInt(e.target.value) || 0)}
                    className="input-control text-right font-mono"
                    placeholder="0"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[13px] font-medium text-ink-muted mb-1.5">PO / Notes</label>
                  <input 
                    type="text" value={row.notes}
                    onChange={e => updateRow(idx, 'notes', e.target.value)}
                    className="input-control"
                    placeholder="PO Number or notes..."
                  />
                </div>
                {rows.length > 1 && (
                  <button 
                    type="button" 
                    onClick={() => removeRow(idx)}
                    className="pb-2 text-ink-muted hover:text-[#A83D24] transition-colors"
                  >
                    <Trash className="w-5 h-5" />
                  </button>
                )}
                </div>
              );
            })}

            <button 
              type="button" 
              onClick={addRow}
              className="text-xs font-bold text-[#A83D24] hover:underline flex items-center gap-1"
            >
              + Add another variant row
            </button>
          </div>

          <div className="p-6 border-t border-border flex justify-end gap-3 bg-surface">
            <button 
              type="button" 
              onClick={onClose}
              disabled={loading}
              className="btn btn-secondary text-[13px] px-4 py-2"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={loading}
              className="btn btn-primary text-[13px] px-5 py-2 flex items-center gap-2"
            >
              {loading ? 'Receiving...' : 'Confirm Receipt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
