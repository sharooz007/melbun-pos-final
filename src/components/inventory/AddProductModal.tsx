'use client'
import React, { useState, useEffect, useRef } from 'react';
import { PackagePlus, X, Plus, Trash2, Loader2, AlertTriangle, Sparkles } from 'lucide-react';
import { getStoreSettingsAction } from '@/lib/actions/settings';

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
  const [variants, setVariants] = useState<any[]>([{ name: '', barcode: '', cost_price: 0, selling_price: 0, pieces_per_set: 1, initial_sets: '', initial_loose: '' }]);
  const [presetTemplates, setPresetTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const prevIsOpenRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // P2-11: Escape key dismissal & focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading && !isSubmittingRef.current) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  useEffect(() => {
    if (isOpen) {
      getStoreSettingsAction().then(res => {
        if (res.success && res.data?.variant_templates && Array.isArray(res.data.variant_templates)) {
          setPresetTemplates(res.data.variant_templates);
        }
      }).catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      if (initialData) {
        setName(initialData.name || '');
        setCategoryId(initialData.category_id || (categories.length > 0 ? categories[0].id : ''));
        setVariants(
          initialData.variants?.length 
            ? initialData.variants.map((v: any) => ({ 
                ...v, 
                pieces_per_set: v.pieces_per_set || initialData.pieces_per_set || 1,
                initial_sets: '', 
                initial_loose: '' 
              })) 
            : [{ name: '', barcode: '', cost_price: 0, selling_price: 0, pieces_per_set: initialData.pieces_per_set || 1, initial_sets: '', initial_loose: '' }]
        );
      } else {
        setName('');
        setCategoryId(categories.length > 0 ? categories[0].id : '');
        setVariants([{ name: '', barcode: '', cost_price: 0, selling_price: 0, pieces_per_set: 1, initial_sets: '', initial_loose: '' }]);
      }
      setError('');
      isSubmittingRef.current = false;
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, initialData, categories]);

  if (!isOpen) return null;

  const applyPresetTemplate = (template: any) => {
    const baseCost = variants.length > 0 && variants[0].cost_price !== '' ? variants[0].cost_price : 0;
    const baseSell = variants.length > 0 && variants[0].selling_price !== '' ? variants[0].selling_price : 0;

    const newVariants = template.variants.map((item: any) => {
      const varName = typeof item === 'string' ? item : item.name;
      const varPps = typeof item === 'object' && item.pieces_per_set ? Math.max(1, Number(item.pieces_per_set)) : 1;
      return {
        name: varName,
        barcode: '',
        cost_price: baseCost,
        selling_price: baseSell,
        pieces_per_set: varPps,
        initial_sets: '',
        initial_loose: ''
      };
    });

    setVariants(newVariants);
  };

  const updateVariant = (index: number, field: string, value: any) => {
    const newVars = [...variants];
    newVars[index] = { ...newVars[index], [field]: value };
    setVariants(newVars);
  };

  const addVariant = () => {
    const prevVariant = variants.length > 0 ? variants[variants.length - 1] : null;
    setVariants([
      ...variants,
      {
        name: '',
        barcode: '',
        cost_price: prevVariant ? prevVariant.cost_price : 0,
        selling_price: prevVariant ? prevVariant.selling_price : 0,
        pieces_per_set: prevVariant?.pieces_per_set || 1,
        initial_sets: prevVariant ? prevVariant.initial_sets : '',
        initial_loose: prevVariant ? prevVariant.initial_loose : ''
      }
    ]);
  };

  const removeVariant = (index: number) => {
    if (variants.length <= 1) return;
    const target = variants[index];
    const hasExistingStock = target.id && (Number(target.stock_quantity || 0) > 0 || Number(target.stock_sets || 0) > 0);
    if (hasExistingStock) {
      const confirmed = window.confirm(
        `Warning: Variant "${target.name || 'Unnamed'}" currently has ${target.stock_quantity || 0} pieces in inventory. Removing it will write off remaining stock to zero upon saving. Proceed?`
      );
      if (!confirmed) return;
    }
    setVariants(variants.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || isSubmittingRef.current) return;
    setError('');

    const lossVariants = variants.filter(v => {
      const cost = Number(v.cost_price) || 0;
      const sell = Number(v.selling_price) || 0;
      return cost > 0 && sell < cost;
    });

    if (lossVariants.length > 0) {
      const names = lossVariants.map(v => `"${v.name || 'Unnamed'}" (Cost: ₹${v.cost_price}, Sell: ₹${v.selling_price})`).join(', ');
      const confirmed = window.confirm(
        `Warning: The following variant(s) have Selling Price lower than Cost Price:\n${names}\n\nDo you wish to proceed?`
      );
      if (!confirmed) return;
    }

    isSubmittingRef.current = true;
    setLoading(true);

    try {
      const defaultPps = variants.length > 0 && variants[0].pieces_per_set ? Math.max(1, Number(variants[0].pieces_per_set)) : 1;
      const payload = {
        name: name.trim(),
        category_id: categoryId || null,
        pieces_per_set: defaultPps,
        variants: variants.map(v => ({
          ...v,
          name: v.name.trim(),
          cost_price: v.cost_price === '' ? 0 : Number(v.cost_price),
          selling_price: v.selling_price === '' ? 0 : Number(v.selling_price),
          pieces_per_set: v.pieces_per_set === '' ? defaultPps : Math.max(1, Number(v.pieces_per_set)),
          initial_sets: v.id ? undefined : (v.initial_sets === '' ? 0 : Number(v.initial_sets)),
          initial_loose: v.id ? undefined : (v.initial_loose === '' ? 0 : Number(v.initial_loose))
        }))
      };
      
      await onSubmit(payload);
    } catch (err: any) {
      setError(err.message || 'Failed to save product');
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div 
        ref={modalRef}
        className="relative bg-surface w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[88vh] my-auto border border-border overflow-hidden animate-in zoom-in-95 duration-150 cursor-default"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-surface border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center text-accent">
              <PackagePlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-ink-primary">
                {initialData ? `Edit "${initialData.name}"` : 'Add New Product'}
              </h2>
              <p className="text-xs text-ink-muted mt-0.5">
                {initialData ? 'Update prices, pack sizes, and variant options' : 'Create master product with multi-variant options'}
              </p>
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

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          <form id="productForm" onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            {/* Master Details Bento Card */}
            <div className="p-4 bg-row-alt/60 rounded-xl border border-border space-y-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted block">
                Product Details
              </span>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Product Name */}
                <div>
                  <label className="block text-xs font-bold text-ink-primary mb-1">
                    Product Name <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="text" 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    required
                    placeholder="e.g. Cotton Shirt"
                    className="w-full bg-surface border border-border p-2.5 text-xs font-medium rounded-xl text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-xs font-bold text-ink-primary mb-1">
                    Category <span className="text-red-500">*</span>
                  </label>
                  <select 
                    value={categoryId} 
                    onChange={e => setCategoryId(e.target.value)} 
                    required
                    className="w-full bg-surface border border-border p-2.5 text-xs font-medium rounded-xl text-ink-primary focus:ring-2 focus:ring-accent focus:outline-none cursor-pointer"
                  >
                    {categories.length === 0 && <option value="">No Categories</option>}
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Variants Section */}
            <div className="space-y-3">
              {/* Quick Presets Bar */}
              {presetTemplates.length > 0 && !initialData && (
                <div className="p-3 bg-row-alt/80 rounded-xl border border-border space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-ink-primary">
                    <Sparkles className="w-3.5 h-3.5 text-accent" />
                    <span>Quick Load Variant Presets:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {presetTemplates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => applyPresetTemplate(t)}
                        className="px-2.5 py-1 bg-surface hover:bg-accent/10 hover:border-accent border border-border rounded-lg text-xs font-semibold text-ink-primary transition cursor-pointer flex items-center gap-1 shadow-2xs"
                      >
                        <span className="text-accent font-bold">+</span>
                        <span>{t.name}</span>
                        <span className="text-[10px] text-ink-muted">
                          ({t.variants.map((v: any) => typeof v === 'string' ? v : (v.pieces_per_set > 1 ? `${v.name}:${v.pieces_per_set}` : v.name)).join(', ')})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted block">
                  Product Variants ({variants.length})
                </span>
                <button 
                  type="button" 
                  onClick={addVariant}
                  className="px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent text-xs font-bold rounded-lg flex items-center gap-1 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Variant</span>
                </button>
              </div>

              {/* Mobile View: Stacked Cards (0px Horizontal Overflow) */}
              <div className="block sm:hidden space-y-3">
                {variants.map((v, idx) => {
                  const isLoss = Number(v.cost_price) > 0 && Number(v.selling_price) < Number(v.cost_price);
                  return (
                    <div key={idx} className="p-3.5 bg-surface border border-border rounded-xl space-y-3 shadow-2xs">
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-xs font-bold text-ink-primary">Variant #{idx + 1}</span>
                        {variants.length > 1 && (
                          <button 
                            type="button" 
                            onClick={() => removeVariant(idx)} 
                            className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div>
                          <label className="block text-[11px] font-medium text-ink-muted mb-0.5">Variant Name</label>
                          <input 
                            type="text" 
                            value={v.name} 
                            onChange={e => updateVariant(idx, 'name', e.target.value)} 
                            required
                            placeholder="e.g. Red / XL"
                            className="w-full bg-row-alt border border-border p-2 text-xs font-semibold rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[11px] font-medium text-ink-muted mb-0.5" title="Pieces per Pack / Set">
                              Pcs/Set {v.id && <span className="text-[9px] font-bold text-amber-700">(Locked)</span>}
                            </label>
                            <input 
                              type="number" 
                              min="1" 
                              disabled={!!v.id}
                              title={v.id ? "Pack size cannot be modified once created because this variant is in use." : "Pieces per set"}
                              value={v.pieces_per_set} 
                              onFocus={e => e.target.select()}
                              onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                              onChange={e => updateVariant(idx, 'pieces_per_set', e.target.value === '' ? '' : parseInt(e.target.value))} 
                              required
                              placeholder="1"
                              className={`w-full border p-2 text-xs font-mono font-bold text-center rounded-lg focus:outline-none ${
                                v.id 
                                  ? 'bg-gray-100/90 text-gray-500 border-gray-200 cursor-not-allowed' 
                                  : 'bg-row-alt border-border text-ink-primary focus:ring-1 focus:ring-accent'
                              }`}
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-ink-muted mb-0.5">Cost Price</label>
                            <input 
                              type="number" 
                              min="0" 
                              step="0.01" 
                              value={v.cost_price} 
                              onFocus={e => e.target.select()}
                              onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                              onChange={e => updateVariant(idx, 'cost_price', e.target.value === '' ? '' : parseFloat(e.target.value))} 
                              required
                              className="w-full bg-row-alt border border-border p-2 text-xs font-mono font-bold text-right rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                            />
                          </div>

                          <div>
                            <div className="flex justify-between items-center mb-0.5">
                              <label className="block text-[11px] font-medium text-ink-muted">Sell Price</label>
                              {isLoss && <span className="text-[9px] bg-amber-100 text-amber-900 px-1 rounded font-bold">Loss</span>}
                            </div>
                            <input 
                              type="number" 
                              min="0" 
                              step="0.01" 
                              value={v.selling_price} 
                              onFocus={e => e.target.select()}
                              onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                              onChange={e => updateVariant(idx, 'selling_price', e.target.value === '' ? '' : parseFloat(e.target.value))} 
                              required
                              className={`w-full bg-row-alt border p-2 text-xs font-mono font-bold text-right rounded-lg text-ink-primary focus:ring-1 focus:outline-none ${
                                isLoss ? 'border-amber-500 text-amber-900' : 'border-border focus:ring-accent'
                              }`}
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-ink-muted mb-0.5">Barcode</label>
                          <input 
                            type="text" 
                            value={v.barcode} 
                            onChange={e => updateVariant(idx, 'barcode', e.target.value)}
                            placeholder="Auto-generated if empty"
                            className="w-full bg-row-alt border border-border p-2 text-xs font-mono rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                          />
                        </div>

                        {!v.id && (
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <div>
                              <label className="block text-[11px] font-medium text-ink-muted mb-0.5">Initial Sets</label>
                              <input 
                                type="number" 
                                min="0" 
                                value={v.initial_sets} 
                                onFocus={e => e.target.select()}
                                onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                                onChange={e => updateVariant(idx, 'initial_sets', e.target.value === '' ? '' : parseInt(e.target.value))}
                                placeholder="0"
                                className="w-full bg-row-alt border border-border p-2 text-xs font-mono text-right rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-ink-muted mb-0.5">Initial Loose</label>
                              <input 
                                type="number" 
                                min="0" 
                                value={v.initial_loose} 
                                onFocus={e => e.target.select()}
                                onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                                onChange={e => updateVariant(idx, 'initial_loose', e.target.value === '' ? '' : parseInt(e.target.value))}
                                placeholder="0"
                                className="w-full bg-row-alt border border-border p-2 text-xs font-mono text-right rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop View: Grid Rows */}
              <div className="hidden sm:block space-y-2">
                {variants.map((v, idx) => {
                  const isLoss = Number(v.cost_price) > 0 && Number(v.selling_price) < Number(v.cost_price);
                  return (
                    <div key={idx} className="p-3 bg-surface border border-border rounded-xl flex items-center gap-2.5 shadow-2xs">
                      <div className="flex-1 min-w-[120px]">
                        <input 
                          type="text" 
                          value={v.name} 
                          onChange={e => updateVariant(idx, 'name', e.target.value)} 
                          required
                          placeholder="Variant Name (e.g. Red / M)"
                          className="w-full bg-row-alt border border-border p-2 text-xs font-semibold rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                        />
                      </div>

                      <div className="w-20" title={v.id ? "Pack size cannot be modified once created because this variant is in use." : "Pack Size (Pieces per Set for this Variant)"}>
                        <input 
                          type="number" 
                          min="1" 
                          disabled={!!v.id}
                          value={v.pieces_per_set} 
                          onFocus={e => e.target.select()}
                          onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                          onChange={e => updateVariant(idx, 'pieces_per_set', e.target.value === '' ? '' : parseInt(e.target.value))} 
                          required
                          placeholder="Pcs/Set"
                          className={`w-full border p-2 text-xs font-mono font-bold text-center rounded-lg focus:outline-none ${
                            v.id 
                              ? 'bg-gray-100/90 text-gray-500 border-gray-200 cursor-not-allowed' 
                              : 'bg-row-alt border-border text-ink-primary focus:ring-1 focus:ring-accent'
                          }`}
                        />
                      </div>

                      <div className="w-24">
                        <input 
                          type="number" 
                          min="0" 
                          step="0.01" 
                          value={v.cost_price} 
                          onFocus={e => e.target.select()}
                          onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                          onChange={e => updateVariant(idx, 'cost_price', e.target.value === '' ? '' : parseFloat(e.target.value))} 
                          required
                          placeholder="Cost"
                          className="w-full bg-row-alt border border-border p-2 text-xs font-mono font-bold text-right rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                        />
                      </div>

                      <div className="w-24 relative">
                        <input 
                          type="number" 
                          min="0" 
                          step="0.01" 
                          value={v.selling_price} 
                          onFocus={e => e.target.select()}
                          onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                          onChange={e => updateVariant(idx, 'selling_price', e.target.value === '' ? '' : parseFloat(e.target.value))} 
                          required
                          placeholder="Sell"
                          className={`w-full bg-row-alt border p-2 text-xs font-mono font-bold text-right rounded-lg text-ink-primary focus:ring-1 focus:outline-none ${
                            isLoss ? 'border-amber-500 text-amber-900' : 'border-border focus:ring-accent'
                          }`}
                        />
                        {isLoss && (
                          <span className="absolute -top-2 right-1 text-[8px] bg-amber-100 text-amber-900 px-1 rounded font-bold border border-amber-300">
                            Loss
                          </span>
                        )}
                      </div>

                      <div className="w-28">
                        <input 
                          type="text" 
                          value={v.barcode} 
                          onChange={e => updateVariant(idx, 'barcode', e.target.value)}
                          placeholder="Barcode (Auto)"
                          className="w-full bg-row-alt border border-border p-2 text-xs font-mono rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                        />
                      </div>

                      {!v.id && (
                        <>
                          <div className="w-16">
                            <input 
                              type="number" 
                              min="0" 
                              value={v.initial_sets} 
                              onFocus={e => e.target.select()}
                              onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                              onChange={e => updateVariant(idx, 'initial_sets', e.target.value === '' ? '' : parseInt(e.target.value))}
                              placeholder="Sets"
                              className="w-full bg-row-alt border border-border p-2 text-xs font-mono text-right rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                            />
                          </div>
                          <div className="w-16">
                            <input 
                              type="number" 
                              min="0" 
                              value={v.initial_loose} 
                              onFocus={e => e.target.select()}
                              onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                              onChange={e => updateVariant(idx, 'initial_loose', e.target.value === '' ? '' : parseInt(e.target.value))}
                              placeholder="Loose"
                              className="w-full bg-row-alt border border-border p-2 text-xs font-mono text-right rounded-lg text-ink-primary focus:ring-1 focus:ring-accent focus:outline-none"
                            />
                          </div>
                        </>
                      )}

                      {variants.length > 1 && (
                        <button 
                          type="button" 
                          onClick={() => removeVariant(idx)} 
                          className="p-2 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </form>
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
            form="productForm" 
            disabled={loading || categories.length === 0}
            className="px-5 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{initialData ? 'Save Changes' : 'Create Product'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
