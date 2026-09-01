'use client'

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { getPricingVariantsAction, updateVariantCostAction } from '@/lib/actions/pricing';
import { getCategoriesAction } from '@/lib/actions/categories';
import { 
  Search, 
  RefreshCw, 
  Info, 
  Save, 
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Package
} from 'lucide-react';
import toast from 'react-hot-toast';

const formatINR = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2
  }).format(amount);
};

export default function PricingManagerPage() {
  const [variants, setVariants] = useState<any[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [editedCosts, setEditedCosts] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [varRes, catRes] = await Promise.all([
        getPricingVariantsAction(searchQuery, selectedCategory),
        getCategoriesAction()
      ]);

      if (varRes.success) {
        setVariants(varRes.data || []);
      } else {
        toast.error(varRes.error || 'Failed to load price catalog');
      }

      if (catRes.success) {
        setCategories(catRes.data || []);
      }
    } catch (err: any) {
      toast.error(err.message || 'An error occurred loading prices');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedCategory]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadData();
    }, 250);
    return () => clearTimeout(timer);
  }, [loadData]);

  // Group variants by Product
  const groupedProducts = useMemo(() => {
    const map = new Map<string, {
      id: string;
      name: string;
      category_name: string;
      category_id: string | null;
      pieces_per_set: number;
      min_price: number;
      max_price: number;
      variants: any[];
      has_dirty: boolean;
      dirty_count: number;
    }>();

    variants.forEach((v: any) => {
      const prod = v.products || { id: 'unknown', name: 'Unnamed Product' };
      const prodId = prod.id || v.product_id || 'unknown';
      const price = Number(v.selling_price || 0);
      const isDirty = editedCosts[v.id] !== undefined && editedCosts[v.id] !== String(v.cost_price ?? 0);
      const pps = v.pieces_per_set || prod.pieces_per_set || 1;

      if (!map.has(prodId)) {
        map.set(prodId, {
          id: prodId,
          name: prod.name || 'Unnamed Product',
          category_name: prod.categories?.name || 'Uncategorized',
          category_id: prod.category_id || null,
          pieces_per_set: pps,
          min_price: price,
          max_price: price,
          variants: [],
          has_dirty: isDirty,
          dirty_count: isDirty ? 1 : 0
        });
      }

      const g = map.get(prodId)!;
      g.variants.push(v);
      if (price < g.min_price) g.min_price = price;
      if (price > g.max_price) g.max_price = price;
      if (isDirty) {
        g.has_dirty = true;
        g.dirty_count += 1;
      }
    });

    return Array.from(map.values());
  }, [variants, editedCosts]);

  // Auto-expand all products on initial load or search
  useEffect(() => {
    if (groupedProducts.length > 0) {
      setExpandedProducts(prev => {
        if (prev.size === 0) {
          return new Set(groupedProducts.map(p => p.id));
        }
        return prev;
      });
    }
  }, [groupedProducts]);

  const toggleProduct = (prodId: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(prodId)) next.delete(prodId);
      else next.add(prodId);
      return next;
    });
  };

  const toggleAllProducts = () => {
    if (expandedProducts.size === groupedProducts.length) {
      setExpandedProducts(new Set());
    } else {
      setExpandedProducts(new Set(groupedProducts.map(p => p.id)));
    }
  };

  const handleCostChange = (variantId: string, val: string) => {
    setEditedCosts(prev => ({
      ...prev,
      [variantId]: val
    }));
  };

  const handleSaveCost = async (variant: any) => {
    const rawVal = editedCosts[variant.id] !== undefined ? editedCosts[variant.id] : String(variant.cost_price ?? 0);
    const numCost = parseFloat(rawVal);

    if (isNaN(numCost) || numCost < 0) {
      toast.error('Please enter a valid, non-negative cost price.');
      return;
    }

    setSavingIds(prev => ({ ...prev, [variant.id]: true }));
    try {
      const res = await updateVariantCostAction({
        variantId: variant.id,
        newCostPrice: numCost
      });

      if (res.success) {
        toast.success(`Updated ${variant.name} cost to ${formatINR(numCost)}. Past invoice profits recalculated!`);
        setVariants(prev => prev.map(v => v.id === variant.id ? { ...v, cost_price: numCost } : v));
        setEditedCosts(prev => {
          const next = { ...prev };
          delete next[variant.id];
          return next;
        });
      } else {
        toast.error(res.error || 'Failed to update cost price.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error updating cost price');
    } finally {
      setSavingIds(prev => ({ ...prev, [variant.id]: false }));
    }
  };

  const handleSaveProductCosts = async (prod: any) => {
    const dirtyVariants = prod.variants.filter((v: any) => 
      editedCosts[v.id] !== undefined && editedCosts[v.id] !== String(v.cost_price ?? 0)
    );

    if (dirtyVariants.length === 0) {
      toast.error('No cost changes to save for this product.');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    const successfulIds: string[] = [];

    for (const v of dirtyVariants) {
      const rawVal = editedCosts[v.id];
      const numCost = parseFloat(rawVal);
      if (isNaN(numCost) || numCost < 0) {
        failCount++;
        continue;
      }

      setSavingIds(prev => ({ ...prev, [v.id]: true }));
      try {
        const res = await updateVariantCostAction({
          variantId: v.id,
          newCostPrice: numCost
        });
        if (res.success) {
          successCount++;
          successfulIds.push(v.id);
          setVariants(prev => prev.map(item => item.id === v.id ? { ...item, cost_price: numCost } : item));
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      } finally {
        setSavingIds(prev => ({ ...prev, [v.id]: false }));
      }
    }

    if (successfulIds.length > 0) {
      setEditedCosts(prev => {
        const next = { ...prev };
        successfulIds.forEach(id => delete next[id]);
        return next;
      });
      toast.success(`Saved ${successCount} variant cost(s) for "${prod.name}"!`);
    }

    if (failCount > 0) {
      toast.error(`Failed to update ${failCount} variant(s). Please verify inputs.`);
    }
  };

  const handleSaveAll = async () => {
    const dirtyIds = Object.keys(editedCosts);
    if (dirtyIds.length === 0) {
      toast.error('No cost changes to save.');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    const successfulIds: string[] = [];

    for (const id of dirtyIds) {
      const rawVal = editedCosts[id];
      const numCost = parseFloat(rawVal);
      if (isNaN(numCost) || numCost < 0) {
        failCount++;
        continue;
      }

      setSavingIds(prev => ({ ...prev, [id]: true }));
      try {
        const res = await updateVariantCostAction({
          variantId: id,
          newCostPrice: numCost
        });
        if (res.success) {
          successCount++;
          successfulIds.push(id);
          setVariants(prev => prev.map(item => item.id === id ? { ...item, cost_price: numCost } : item));
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      } finally {
        setSavingIds(prev => ({ ...prev, [id]: false }));
      }
    }

    if (successfulIds.length > 0) {
      setEditedCosts(prev => {
        const next = { ...prev };
        successfulIds.forEach(id => delete next[id]);
        return next;
      });
      toast.success(`Successfully saved ${successCount} cost updates! Past invoices recalculated.`);
    }

    if (failCount > 0) {
      toast.error(`Failed to update ${failCount} item(s). Please check values and retry.`);
    }
  };

  const dirtyCount = Object.keys(editedCosts).length;

  return (
    <div className="p-3.5 pb-36 sm:p-6 md:p-6 md:pb-8 w-full max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Link 
              href="/inventory/products"
              className="p-1.5 bg-surface border border-border text-ink-muted hover:text-ink-primary rounded-lg hover:bg-row-alt transition"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-2xl font-bold text-ink-primary tracking-tight">Price & Cost Manager</h1>
          </div>
          <p className="text-xs md:text-sm text-ink-muted mt-1">
            Update product costs. Modifying cost price retroactively recalculates gross profit on historical invoices.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={toggleAllProducts}
            className="px-3 py-2 bg-surface border border-border text-ink-primary rounded-lg hover:bg-row-alt font-medium text-xs transition shadow-2xs cursor-pointer"
          >
            {expandedProducts.size === groupedProducts.length ? 'Collapse All' : 'Expand All'}
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-surface border border-border text-ink-primary rounded-lg hover:bg-row-alt font-medium text-[13px] transition shadow-sm disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {dirtyCount > 0 && (
            <button
              onClick={handleSaveAll}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover font-bold text-[13px] transition shadow-sm animate-pulse cursor-pointer"
            >
              <Save className="w-4 h-4" />
              Save All ({dirtyCount})
            </button>
          )}
        </div>
      </div>

      {/* Info Notice Banner */}
      <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4 flex items-start gap-3 text-xs text-blue-800">
        <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Retroactive Cost Recalculation:</span>
          <p className="mt-0.5 text-blue-700">
            When you enter or revise the cost of a variant, MelbunPOS automatically updates all historical invoices containing this item to reflect the true gross profit. Selling prices and invoice totals are never modified.
          </p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-surface p-4 rounded-xl border border-border shadow-xs">
        <div className="sm:col-span-2 relative">
          <Search className="w-4 h-4 text-ink-muted absolute left-3 top-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by product name, variant name, or barcode..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-row-alt border border-border rounded-lg text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent transition"
          />
        </div>
        <div>
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="w-full px-3 py-2 bg-row-alt border border-border rounded-lg text-xs text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent transition"
          >
            <option value="ALL">All Categories</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Grouped Products Accordion List */}
      <div className="space-y-3.5">
        {loading ? (
          <div className="bg-surface border border-border rounded-2xl p-12 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-accent" />
            Loading price catalog...
          </div>
        ) : groupedProducts.length === 0 ? (
          <div className="bg-surface border border-border rounded-2xl p-12 text-center text-xs text-ink-muted">
            No products found matching your filters.
          </div>
        ) : (
          groupedProducts.map(p => {
            const isExpanded = expandedProducts.has(p.id);
            const variantPpsList = p.variants.map((v: any) => Number(v.pieces_per_set || p.pieces_per_set || 1));
            const isMixedPps = new Set(variantPpsList).size > 1;
            const priceDisplay = p.min_price === p.max_price
              ? formatINR(p.min_price)
              : `${formatINR(p.min_price)} – ${formatINR(p.max_price)}`;

            return (
              <div key={p.id} className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xs">
                {/* Product Header Row */}
                <div 
                  onClick={() => toggleProduct(p.id)}
                  className="p-3.5 sm:p-4 hover:bg-row-alt/50 transition cursor-pointer flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-transparent"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button 
                      aria-label="Toggle variants"
                      className="text-ink-muted hover:text-ink-primary p-1 rounded-lg hover:bg-row-alt transition"
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
                          {p.category_name}
                        </span>
                        {p.has_dirty && (
                          <span className="text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-full animate-pulse">
                            {p.dirty_count} Unsaved Cost{p.dirty_count > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      {/* Subtitle Tokens */}
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap text-xs text-ink-muted mt-1">
                        <span className="inline-flex items-center gap-1 font-medium bg-row-alt px-2 py-0.5 rounded-md border border-border text-[11px]">
                          <Package className="w-3.5 h-3.5 text-ink-muted" />
                          {isMixedPps ? 'Mixed Pack Sizes' : `${p.variants[0]?.pieces_per_set || p.pieces_per_set || 1} pcs / set`}
                        </span>
                        
                        <span className="font-medium text-[11px]">
                          {p.variants.length} variant{p.variants.length !== 1 ? 's' : ''}
                        </span>

                        <span className="font-mono font-bold text-ink-primary text-xs">
                          {priceDisplay}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right Header Actions */}
                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end" onClick={e => e.stopPropagation()}>
                    {p.has_dirty && (
                      <button
                        onClick={() => handleSaveProductCosts(p)}
                        className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Save Product</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded Variants Table */}
                {isExpanded && (
                  <div className="border-t border-border bg-surface overflow-x-auto">
                    <table className="w-full text-left text-xs divide-y divide-border">
                      <thead className="bg-row-alt/60 text-ink-muted font-semibold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="p-3 pl-12">Variant / Size</th>
                          <th className="p-3">Barcode</th>
                          <th className="p-3 text-center">Pack Size</th>
                          <th className="p-3 text-right">Selling Price</th>
                          <th className="p-3 text-right w-44">Cost Price (₹)</th>
                          <th className="p-3 text-right">Gross Margin</th>
                          <th className="p-3 text-right pr-4">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border font-sans">
                        {p.variants.map((v: any) => {
                          const rawCost = editedCosts[v.id] !== undefined ? editedCosts[v.id] : String(v.cost_price ?? 0);
                          const parsedCost = parseFloat(rawCost);
                          const currentCost = isNaN(parsedCost) ? 0 : parsedCost;
                          const selling = Number(v.selling_price || 0);
                          const isDirty = editedCosts[v.id] !== undefined && editedCosts[v.id] !== String(v.cost_price ?? 0);
                          const isSaving = savingIds[v.id];

                          const marginPct = selling > 0 
                            ? Math.round(((selling - currentCost) / selling) * 1000) / 10 
                            : 0;

                          return (
                            <tr key={v.id} className={`hover:bg-row-alt/50 transition ${isDirty ? 'bg-amber-50/40' : ''}`}>
                              <td className="p-3 pl-12 font-bold text-ink-primary">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-accent/40"></span>
                                  <span>{v.name}</span>
                                </div>
                              </td>
                              <td className="p-3 font-mono text-[11px] text-ink-muted">
                                {v.barcode || '—'}
                              </td>
                              <td className="p-3 text-center font-mono text-ink-primary font-bold">
                                {v.pieces_per_set || p.pieces_per_set || 1} pcs/set
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-ink-primary">
                                {formatINR(selling)}
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <span className="text-ink-muted">₹</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={rawCost}
                                    onChange={e => handleCostChange(v.id, e.target.value)}
                                    className={`w-28 px-2.5 py-1.5 text-right font-mono font-bold text-xs rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent transition ${
                                      isDirty 
                                        ? 'border-amber-400 bg-amber-50 text-amber-900' 
                                        : 'border-border bg-row-alt text-ink-primary'
                                    }`}
                                  />
                                </div>
                              </td>
                              <td className="p-3 text-right">
                                <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded-md ${
                                  marginPct >= 30 ? 'bg-emerald-50 text-emerald-700' :
                                  marginPct > 0 ? 'bg-amber-50 text-amber-700' :
                                  'bg-red-50 text-red-700'
                                }`}>
                                  {marginPct}%
                                </span>
                              </td>
                              <td className="p-3 text-right pr-4">
                                <button
                                  onClick={() => handleSaveCost(v)}
                                  disabled={!isDirty || isSaving}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ml-auto shadow-2xs ${
                                    isDirty 
                                      ? 'bg-accent text-white hover:bg-accent-hover cursor-pointer' 
                                      : 'bg-row-alt text-ink-muted border border-border opacity-40 cursor-not-allowed'
                                  }`}
                                >
                                  <Save className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
                                  <span>{isSaving ? 'Saving...' : 'Save'}</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
