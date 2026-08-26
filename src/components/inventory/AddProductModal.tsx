'use client'
import React, { useState } from 'react';
import { PackagePlus, X, Plus, Trash2, Loader2 } from 'lucide-react';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  categories: any[];
  initialData?: any;
}

export function AddProductModal({ isOpen, onClose, onSubmit, categories = [], initialData }: AddProductModalProps) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [piecesPerSet, setPiecesPerSet] = useState<number | ''>(1);
  const [variants, setVariants] = useState<any[]>([{ name: '', barcode: '', cost_price: 0, selling_price: 0, initial_sets: '', initial_loose: '' }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setName(initialData.name || '');
        setCategoryId(initialData.category_id || (categories.length > 0 ? categories[0].id : ''));
        setPiecesPerSet(initialData.pieces_per_set || 1);
        setVariants(initialData.variants?.length ? initialData.variants.map((v: any) => ({ ...v, initial_sets: '', initial_loose: '' })) : [{ name: '', barcode: '', cost_price: 0, selling_price: 0, initial_sets: '', initial_loose: '' }]);
      } else {
        setName('');
        setCategoryId(categories.length > 0 ? categories[0].id : '');
        setPiecesPerSet(1);
        setVariants([{ name: '', barcode: '', cost_price: 0, selling_price: 0, initial_sets: '', initial_loose: '' }]);
      }
      setError('');
    }
  }, [isOpen, initialData?.id]);

  if (!isOpen) return null;

  const updateVariant = (index: number, field: string, value: any) => {
    const newVars = [...variants];
    newVars[index][field] = value;
    setVariants(newVars);
  };

  const addVariant = () => {
    setVariants([...variants, { name: '', barcode: '', cost_price: 0, selling_price: 0, initial_sets: '', initial_loose: '' }]);
  };

  const removeVariant = (index: number) => {
    if (variants.length <= 1) return;
    const target = variants[index];
    // Check if variant has existing physical stock in edit mode
    const hasExistingStock = target.id && (Number(target.stock_quantity || 0) > 0 || Number(target.stock_sets || 0) > 0);
    if (hasExistingStock) {
      const confirmed = window.confirm(
        `Warning: Variant "${target.name || 'Unnamed'}" currently has ${target.stock_quantity || 0} pieces in inventory. Removing it will delete the variant and permanently write off all remaining stock to zero upon saving. Are you sure you want to proceed?`
      );
      if (!confirmed) return;
    }
    setVariants(variants.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    // Check for loss sales (Selling Price < Cost Price)
    const lossVariants = variants.filter(v => {
      const cost = Number(v.cost_price) || 0;
      const sell = Number(v.selling_price) || 0;
      return cost > 0 && sell < cost;
    });

    if (lossVariants.length > 0) {
      const names = lossVariants.map(v => `"${v.name || 'Unnamed'}" (Cost: ₹${v.cost_price}, Sell: ₹${v.selling_price})`).join(', ');
      const confirmed = window.confirm(
        `Warning: The following variant(s) have Selling Price lower than Cost Price (Selling at a loss):\n${names}\n\nDo you wish to proceed and save anyway?`
      );
      if (!confirmed) return;
    }

    setLoading(true);

    try {
      // Ensure empty string fallbacks are converted to 0 or valid numbers for the backend
      const payload = {
        name,
        category_id: categoryId,
        pieces_per_set: piecesPerSet === '' ? 1 : Number(piecesPerSet),
        variants: variants.map(v => ({
          ...v,
          cost_price: v.cost_price === '' ? 0 : Number(v.cost_price),
          selling_price: v.selling_price === '' ? 0 : Number(v.selling_price),
          initial_sets: v.id ? undefined : (v.initial_sets === '' ? 0 : Number(v.initial_sets)),
          initial_loose: v.id ? undefined : (v.initial_loose === '' ? 0 : Number(v.initial_loose))
        }))
      };
      
      await onSubmit(payload);
    } catch (err: any) {
      setError(err.message || 'Failed to save product');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-primary/20 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-[#EFECE6] w-full max-w-[800px] rounded-[16px] shadow-2xl flex flex-col max-h-[90vh]">
        
        <div className="flex items-center justify-between p-6 bg-white border-b border-border rounded-t-[16px]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#A83D24]/10 rounded-[10px] flex items-center justify-center text-[#A83D24]">
              <PackagePlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[18px] font-bold text-ink-primary">{initialData ? 'Edit Product' : 'Add New Product'}</h2>
              <p className="text-[13px] text-ink-muted mt-0.5">{initialData ? 'Update product and its variants' : 'Create a new master product and its variants'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-ink-muted hover:bg-row-alt rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="productForm" onSubmit={handleSubmit} className="space-y-6">
            
            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-[13px] font-medium rounded-[8px] border border-red-200">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-6 bg-white p-5 rounded-[12px] border border-border">
              <div>
                <label className="block text-[13px] font-bold text-ink-primary mb-1.5">Product Name *</label>
                <input 
                  type="text" value={name} onChange={e => setName(e.target.value)} required
                  placeholder="e.g. Oversized T-Shirt"
                  className="input-control w-full"
                />
              </div>
              <div>
                <label className="block text-[13px] font-bold text-ink-primary mb-1.5">Category *</label>
                {categories.length === 0 ? (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-[8px] text-[12px] text-amber-800">
                    No categories found. Please create a category first via &quot;Manage Categories&quot;.
                  </div>
                ) : (
                  <select 
                    value={categoryId} onChange={e => setCategoryId(e.target.value)} required
                    className="input-control w-full appearance-none bg-white"
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-[13px] font-bold text-ink-primary mb-1.5">Pieces per Set *</label>
                <input 
                  type="number" min="1" 
                  value={piecesPerSet} 
                  onFocus={e => e.target.select()}
                  onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                  onChange={e => setPiecesPerSet(e.target.value === '' ? '' : parseInt(e.target.value))} 
                  required
                  className="input-control w-full font-mono"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[14px] font-bold text-ink-primary">Variants (Colors/Sizes)</h3>
              </div>
              
              <div className="space-y-3">
                {variants.map((v, idx) => (
                  <div key={idx} className="p-4 bg-row-alt rounded-[12px] border border-border flex gap-3 items-end">
                    <div className="flex-1">
                      <label className="block text-[12px] font-medium text-ink-muted mb-1">Variant Name</label>
                      <input 
                        type="text" value={v.name} onChange={e => updateVariant(idx, 'name', e.target.value)} required
                        placeholder="e.g. Red / M"
                        className="w-full p-2 bg-surface border border-border rounded-[8px] text-[13px] focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
                      />
                    </div>
                    <div className="w-28">
                      <label className="block text-[12px] font-medium text-ink-muted mb-1">Cost Price</label>
                      <input 
                        type="number" min="0" step="0.01" value={v.cost_price} 
                        onFocus={e => e.target.select()}
                        onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                        onChange={e => updateVariant(idx, 'cost_price', e.target.value === '' ? '' : parseFloat(e.target.value))} required
                        className="w-full p-2 bg-surface border border-border rounded-[8px] text-[13px] text-right font-mono focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
                      />
                    </div>
                    <div className="w-28">
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-[12px] font-medium text-ink-muted">Sell Price</label>
                        {Number(v.cost_price) > 0 && Number(v.selling_price) < Number(v.cost_price) && (
                          <span className="text-[10px] text-amber-700 font-bold bg-amber-100 px-1 rounded" title="Selling below cost">Loss</span>
                        )}
                      </div>
                      <input 
                        type="number" min="0" step="0.01" value={v.selling_price} 
                        onFocus={e => e.target.select()}
                        onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                        onChange={e => updateVariant(idx, 'selling_price', e.target.value === '' ? '' : parseFloat(e.target.value))} required
                        className={`w-full p-2 bg-surface border rounded-[8px] text-[13px] text-right font-mono focus:outline-none focus:ring-1 ${
                          Number(v.cost_price) > 0 && Number(v.selling_price) < Number(v.cost_price)
                            ? 'border-amber-500 text-amber-900 focus:ring-amber-500'
                            : 'border-border focus:ring-[#A83D24]'
                        }`}
                      />
                    </div>
                    <div className="w-24">
                      <label className="block text-[12px] font-medium text-ink-muted mb-1">Barcode</label>
                      <input 
                        type="text" value={v.barcode} onChange={e => updateVariant(idx, 'barcode', e.target.value)}
                        placeholder="Auto"
                        className="w-full p-2 bg-surface border border-border rounded-[8px] text-[13px] focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
                      />
                    </div>
                    {/* Only show initial stock fields if this variant is newly being added (no ID) */}
                    {!v.id && (
                      <>
                        <div className="w-20">
                          <label className="block text-[12px] font-medium text-ink-muted mb-1">Sets (Stock)</label>
                          <input 
                            type="number" min="0" value={v.initial_sets} 
                            onFocus={e => e.target.select()}
                            onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                            onChange={e => updateVariant(idx, 'initial_sets', e.target.value === '' ? '' : parseInt(e.target.value))}
                            className="w-full p-2 bg-surface border border-border rounded-[8px] text-[13px] text-right font-mono focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
                          />
                        </div>
                        <div className="w-20">
                          <label className="block text-[12px] font-medium text-ink-muted mb-1">Loose (Stock)</label>
                          <input 
                            type="number" min="0" value={v.initial_loose} 
                            onFocus={e => e.target.select()}
                            onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                            onChange={e => updateVariant(idx, 'initial_loose', e.target.value === '' ? '' : parseInt(e.target.value))}
                            className="w-full p-2 bg-surface border border-border rounded-[8px] text-[13px] text-right font-mono focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
                          />
                        </div>
                      </>
                    )}
                    {variants.length > 1 && (
                      <button type="button" onClick={() => removeVariant(idx)} className="p-2 text-ink-muted hover:text-[#A83D24] bg-surface border border-border rounded-[8px]">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              
              <button 
                type="button" onClick={addVariant}
                className="mt-4 flex items-center gap-2 text-[13px] font-bold text-[#A83D24] hover:text-[#8a311d] transition-colors"
              >
                <Plus className="w-4 h-4" /> Add another variant
              </button>
            </div>
            
          </form>
        </div>

        <div className="p-6 bg-white border-t border-border rounded-b-[16px] flex justify-end gap-3">
          <button 
            type="button" onClick={onClose} disabled={loading}
            className="px-5 py-2.5 text-[14px] font-bold text-ink-primary hover:bg-row-alt rounded-[8px] transition-colors"
          >
            Cancel
          </button>
          <button 
            type="submit" form="productForm" disabled={loading || categories.length === 0}
            className="px-5 py-2.5 bg-[#A83D24] hover:bg-[#8a311d] text-white text-[14px] font-bold rounded-[8px] transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {initialData ? 'Save Changes' : 'Create Product'}
          </button>
        </div>

      </div>
    </div>
  );
}
