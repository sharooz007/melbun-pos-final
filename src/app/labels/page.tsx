'use client'

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Printer, 
  Search, 
  Plus, 
  Minus, 
  Trash2, 
  Layers, 
  Sliders, 
  RotateCcw, 
  Tag, 
  Check, 
  AlertCircle,
  Eye,
  PackageCheck,
  Sparkles,
  FileDown,
  Loader2
} from 'lucide-react';
import { searchVariantsForLabelsAction } from '@/lib/actions/labels';
import { getStoreSettingsAction } from '@/lib/actions/settings';
import { LabelVariantItem, PrintQueueItem, LabelLayoutMode, LabelConfig, SHEET_COLUMN_PRESETS } from '@/types/labels';
import { BarcodeSvg } from '@/components/BarcodeSvg';
import { generateLabelsPDF } from '@/lib/pdf/generateLabelsPdf';

const formatINR = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amount);
};

export default function LabelsPage() {
  // State: Inventory catalog search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LabelVariantItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // State: Store settings for dynamic store name
  const [storeSettings, setStoreSettings] = useState<any>(null);

  // State: Print Queue
  const [queue, setQueue] = useState<PrintQueueItem[]>([]);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // State: Layout & Dimensions
  const [layoutMode, setLayoutMode] = useState<LabelLayoutMode>('thermal-1col');

  // State: Visual Customization Config
  const [config, setConfig] = useState<LabelConfig>({
    showStoreName: true,
    showProductName: true,
    showVariantName: true,
    showPrice: true,
    showPackSize: true,
    showBarcodeText: true,
    barcodeHeight: 34,
    customHeader: '',
    columns: 3
  });

  // Debounced search for variants
  const performSearch = useCallback(async (query: string) => {
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await searchVariantsForLabelsAction(query);
      if (res.success && res.data) {
        setSearchResults(res.data);
      } else {
        setSearchError(res.error || 'Failed to fetch variants.');
      }
    } catch {
      setSearchError('An unexpected network error occurred.');
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getStoreSettingsAction().then((res) => {
      if (mounted && res.success && res.data) {
        setStoreSettings(res.data);
      }
    }).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, performSearch]);

  // Global Hardware USB Scanner Capture (LAB-HIGH-02)
  useEffect(() => {
    let scanBuffer = '';
    let lastKeyTime = 0;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInput) return;

      const now = Date.now();
      if (now - lastKeyTime > 150) {
        scanBuffer = '';
      }
      lastKeyTime = now;

      if (e.key === 'Enter') {
        if (scanBuffer.length >= 3) {
          e.preventDefault();
          const barcode = scanBuffer.trim();
          scanBuffer = '';
          setSearchQuery(barcode);
          performSearch(barcode);
        }
      } else if (e.key.length === 1) {
        scanBuffer += e.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [performSearch]);

  // Queue Operations
  const addToQueue = (variant: LabelVariantItem, qty: number = 1) => {
    setQueue((prev) => {
      const existingIdx = prev.findIndex((item) => item.variant.variant_id === variant.variant_id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = { ...updated[existingIdx], quantity: updated[existingIdx].quantity + qty };
        return updated;
      }
      return [...prev, { variant, quantity: qty }];
    });
  };

  const updateQuantity = (variantId: string, delta: number) => {
    setQueue((prev) =>
      prev
        .map((item) => {
          if (item.variant.variant_id === variantId) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean) as PrintQueueItem[]
    );
  };

  const setDirectQuantity = (variantId: string, qty: number) => {
    const val = isNaN(qty) ? 0 : Math.max(0, Math.min(qty, 500));
    setQueue((prev) =>
      prev.map((item) =>
        item.variant.variant_id === variantId ? { ...item, quantity: val } : item
      )
    );
  };

  const removeFromQueue = (variantId: string) => {
    setQueue((prev) => prev.filter((item) => item.variant.variant_id !== variantId));
  };

  const clearQueue = () => {
    setQueue([]);
  };

  const fillAllFromStock = () => {
    // High 13: Batched queue update with strict stock clamp to 500
    setQueue((prev) => {
      const updated = [...prev];
      searchResults.forEach((variant) => {
        if (variant.stock_quantity > 0) {
          const clampedQty = Math.min(variant.stock_quantity, 500);
          const existingIdx = updated.findIndex((item) => item.variant.variant_id === variant.variant_id);
          if (existingIdx >= 0) {
            updated[existingIdx] = { ...updated[existingIdx], quantity: clampedQty };
          } else {
            updated.push({ variant, quantity: clampedQty });
          }
        }
      });
      return updated;
    });
  };

  // Flattened queue items for printing
  const flattenedLabels = useMemo(() => {
    const list: LabelVariantItem[] = [];
    queue.forEach((item) => {
      for (let i = 0; i < item.quantity; i++) {
        list.push(item.variant);
      }
    });
    return list;
  }, [queue]);

  // Dynamic column & pagination calculations
  const activeColumns = config.columns && SHEET_COLUMN_PRESETS[config.columns] ? config.columns : 3;
  const sheetPreset = SHEET_COLUMN_PRESETS[activeColumns];
  const labelsPerSheet = sheetPreset.labelsPerPage;

  // Group into chunks of labelsPerSheet for A4 Sheet pagination
  const labelPages = useMemo(() => {
    if (layoutMode !== 'a4-sheet') {
      return [flattenedLabels];
    }
    const pages: LabelVariantItem[][] = [];
    for (let i = 0; i < flattenedLabels.length; i += labelsPerSheet) {
      pages.push(flattenedLabels.slice(i, i + labelsPerSheet));
    }
    return pages.length > 0 ? pages : [[]];
  }, [flattenedLabels, layoutMode, labelsPerSheet]);

  const totalLabelCount = flattenedLabels.length;

  const handlePrint = () => {
    if (totalLabelCount === 0) return;
    setIsPrinting(true);
    setTimeout(() => {
      try {
        window.print();
      } finally {
        setIsPrinting(false);
      }
    }, 150);
  };

  const handleDownloadPdf = () => {
    if (totalLabelCount === 0) return;
    try {
      setIsDownloadingPdf(true);
      const storeName = (config.customHeader || '').trim() || storeSettings?.store_name || 'MELBUN';
      const doc = generateLabelsPDF(flattenedLabels, config, storeName, layoutMode);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      doc.save(`Labels_${layoutMode}_${totalLabelCount}_items_${timestamp}.pdf`);
    } catch (err: any) {
      alert('Failed to generate PDF: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <div className="p-3.5 pb-36 sm:p-6 md:p-6 md:pb-8 max-w-[1600px] w-full mx-auto space-y-6">
      {/* ========================================================================= */}
      {/* 1. SCREEN-ONLY CONTROLS & HEADER (HIDDEN ON PRINT)                        */}
      {/* ========================================================================= */}
      <div className="no-print space-y-6">
        {/* Header Bar */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-accent/10 text-accent rounded-xl">
                <Tag className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Barcode Label Studio</h1>
                <p className="text-sm text-gray-500">Configure, batch, and print barcode price tags</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={clearQueue}
              disabled={queue.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4" />
              Clear Queue
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={totalLabelCount === 0 || isDownloadingPdf}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-accent bg-accent/10 hover:bg-accent/20 border border-accent/20 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {isDownloadingPdf ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4" />
              )}
              {isDownloadingPdf ? 'Generating PDF...' : 'Download PDF'}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={totalLabelCount === 0}
              className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-accent hover:bg-accent-hover rounded-xl shadow-md transition-all active:scale-[0.98] disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              Print {totalLabelCount > 0 ? `(${totalLabelCount} Labels)` : ''}
            </button>
          </div>
        </header>

        {/* 3-Column Studio Grid: Search & Add | Print Queue | Layout & Customizer */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* COLUMN 1: Search & Inventory Catalog (4 cols) */}
          <div className="lg:col-span-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Search className="w-4 h-4 text-gray-500" />
                Select Products
              </h2>
              {searchResults.length > 0 && (
                <button
                  type="button"
                  onClick={fillAllFromStock}
                  className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Add All In-Stock
                </button>
              )}
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search by barcode, variant, or product..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    performSearch(e.currentTarget.value.trim());
                  }
                }}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
            </div>

            {searchError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl flex items-center gap-2 border border-red-100">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{searchError}</span>
              </div>
            )}

            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {isSearching && searchResults.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400">Loading catalog...</div>
              ) : searchResults.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400">No products found</div>
              ) : (
                searchResults.map((variant) => {
                  const inQueue = queue.find((q) => q.variant.variant_id === variant.variant_id);
                  return (
                    <div
                      key={variant.variant_id}
                      className="p-3 border border-gray-100 rounded-xl hover:border-gray-300 transition-all bg-[#FDFBF7]/40 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-gray-900 truncate">
                            {variant.product_name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded font-medium">
                            {variant.variant_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500">
                          <span className="font-mono bg-white px-1 border rounded text-[10px]">
                            {variant.barcode}
                          </span>
                          <span>•</span>
                          <span className="font-semibold text-gray-800">{formatINR(variant.selling_price)}</span>
                          <span>•</span>
                          <span className={variant.stock_quantity > 0 ? 'text-green-600' : 'text-gray-400'}>
                            Stock: {variant.stock_quantity}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => addToQueue(variant, 1)}
                        className="px-2.5 py-1.5 bg-white border border-gray-200 hover:bg-accent hover:text-white hover:border-accent text-gray-700 rounded-lg text-xs font-medium transition-colors shrink-0 flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {inQueue ? `+1 (${inQueue.quantity})` : 'Add'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* COLUMN 2: Print Queue Management (4 cols) */}
          <div className="lg:col-span-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-gray-500" />
                Print Queue ({queue.length} items)
              </h2>
              <span className="text-xs font-semibold px-2 py-0.5 bg-accent/10 text-accent rounded-full">
                {totalLabelCount} labels total
              </span>
            </div>

            {queue.length === 0 ? (
              <div className="py-16 text-center border-2 border-dashed border-gray-100 rounded-xl space-y-2">
                <Tag className="w-8 h-8 text-gray-300 mx-auto" />
                <p className="text-sm font-medium text-gray-500">Queue is empty</p>
                <p className="text-xs text-gray-400 max-w-[200px] w-full mx-auto">
                  Search and add products from the left to build your print batch.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                {queue.map((item) => (
                  <div
                    key={item.variant.variant_id}
                    className="p-3 border border-gray-100 rounded-xl bg-white shadow-xs flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-gray-900 truncate">
                        {item.variant.product_name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-gray-500">
                        <span className="text-gray-700 font-medium">{item.variant.variant_name}</span>
                        <span>•</span>
                        <span className="font-mono text-[10px]">{item.variant.barcode}</span>
                      </div>
                    </div>

                    {/* Quantity Controls */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.variant.variant_id, -1)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        max="500"
                        value={item.quantity === 0 ? '' : item.quantity}
                        onChange={(e) => setDirectQuantity(item.variant.variant_id, parseInt(e.target.value || '0', 10))}
                        className="w-11 h-7 text-center text-xs font-bold border border-gray-200 rounded-lg focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.variant.variant_id, 1)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFromQueue(item.variant.variant_id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-colors ml-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* COLUMN 3: Hardware Layout & Label Customization (4 cols) */}
          <div className="lg:col-span-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-5">
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-gray-500" />
              Layout & Template Settings
            </h2>

            {/* Layout Mode Selector */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Printer Layout Profile
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'thermal-1col', label: '1-Col Roll', desc: '50×25mm' },
                  { id: 'thermal-2col', label: '2-Col Roll', desc: '100×25mm' },
                  { id: 'a4-sheet', label: 'A4 Sheet', desc: `${sheetPreset.labelsPerPage}-up Grid` }
                ].map((layout) => (
                  <button
                    key={layout.id}
                    type="button"
                    onClick={() => setLayoutMode(layout.id as LabelLayoutMode)}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      layoutMode === layout.id
                        ? 'border-accent bg-accent/5 text-accent font-bold shadow-xs'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <p className="text-xs">{layout.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{layout.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Sheet Column Customizer (When A4 Sheet is active) */}
            {layoutMode === 'a4-sheet' && (
              <div className="space-y-2 pt-2 border-t border-gray-100 animate-in fade-in duration-150">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    A4 Sheet Columns
                  </label>
                  <span className="text-[11px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                    {sheetPreset.labelsPerPage} labels / page
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((cols) => {
                    const preset = SHEET_COLUMN_PRESETS[cols];
                    const isSelected = activeColumns === cols;
                    return (
                      <button
                        key={cols}
                        type="button"
                        onClick={() => setConfig(prev => ({ ...prev, columns: cols }))}
                        className={`py-2 px-1 rounded-xl border text-center transition-all ${
                          isSelected
                            ? 'border-accent bg-accent text-white font-bold shadow-xs'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
                        }`}
                      >
                        <p className="text-xs font-bold">{cols} Col</p>
                        <p className={`text-[9px] mt-0.5 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                          {preset.labelsPerPage}-up
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Visual Toggles */}
            <div className="space-y-3 pt-2 border-t border-gray-100">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Visible Tag Fields
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { key: 'showStoreName', label: 'Store Name' },
                  { key: 'showProductName', label: 'Product Name' },
                  { key: 'showVariantName', label: 'Variant / Size' },
                  { key: 'showPrice', label: 'Selling Price (₹)' },
                  { key: 'showPackSize', label: 'Pack Size (Pcs)' },
                  { key: 'showBarcodeText', label: 'Barcode Text' }
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-2 p-2 border border-gray-100 rounded-lg cursor-pointer hover:bg-gray-50 select-none"
                  >
                    <input
                      type="checkbox"
                      checked={(config as any)[item.key]}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, [item.key]: e.target.checked }))
                      }
                      className="rounded text-accent focus:ring-accent w-4 h-4"
                    />
                    <span className="text-gray-700 font-medium">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Custom Header Store Name */}
            {config.showStoreName && (
              <div className="space-y-1.5 pt-2 border-t border-gray-100">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Custom Header / Store Name
                </label>
                <input
                  type="text"
                  value={config.customHeader || ''}
                  onChange={(e) => setConfig((prev) => ({ ...prev, customHeader: e.target.value }))}
                  placeholder={storeSettings?.store_name || 'MELBUN'}
                  className="w-full p-2 text-xs border border-gray-200 rounded-lg focus:ring-1 focus:ring-accent focus:border-accent font-medium"
                />
              </div>
            )}

            {/* Barcode Height Slider */}
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold uppercase tracking-wider text-gray-500">Barcode Height</span>
                <span className="font-mono text-gray-700">{config.barcodeHeight}px</span>
              </div>
              <input
                type="range"
                min="24"
                max="48"
                step="2"
                value={config.barcodeHeight}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, barcodeHeight: parseInt(e.target.value, 10) }))
                }
                className="w-full accent-accent"
              />
            </div>
          </div>
        </div>

        {/* Live WYSIWYG Preview Box (Screen only) */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Eye className="w-4 h-4 text-gray-500" />
              Live Interactive Print Preview ({totalLabelCount} labels queued)
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                Profile: <strong className="text-gray-700">{layoutMode === 'a4-sheet' ? `A4 SHEET (${activeColumns} COLS • ${sheetPreset.labelsPerPage}/PAGE)` : layoutMode.toUpperCase()}</strong>
              </span>
              {layoutMode === 'a4-sheet' && totalLabelCount > 0 && (
                <span className="text-[11px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20">
                  {labelPages.length} Page{labelPages.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {flattenedLabels.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              Add items to the queue above to inspect rendered label geometry.
            </div>
          ) : (
            <div className="bg-[#F4EFE6]/50 p-6 rounded-xl overflow-x-auto">
              <div
                className={`mx-auto bg-white p-4 rounded-lg shadow-sm border border-gray-200 ${
                  layoutMode === 'thermal-1col'
                    ? 'w-[220px] flex flex-col gap-3'
                    : layoutMode === 'thermal-2col'
                    ? 'w-[460px] grid grid-cols-2 gap-3'
                    : 'w-full max-w-[950px] grid gap-3'
                }`}
                style={layoutMode === 'a4-sheet' ? { gridTemplateColumns: `repeat(${activeColumns}, minmax(0, 1fr))` } : undefined}
              >
                {flattenedLabels.slice(0, 6).map((variant, idx) => (
                  <div
                    key={`${variant.variant_id}-${idx}`}
                    className="border border-dashed border-gray-300 p-2.5 rounded bg-white flex flex-col items-center justify-between text-center min-h-[110px]"
                  >
                    {config.showStoreName && (
                      <p className="text-[9px] font-extrabold uppercase tracking-wider text-gray-500 line-clamp-1 leading-tight">
                        {(config.customHeader || '').trim() || storeSettings?.store_name || 'MELBUN'}
                      </p>
                    )}
                    {config.showProductName && (
                      <p className="text-[11px] font-bold text-gray-900 line-clamp-1 leading-tight mt-0.5">
                        {variant.product_name}
                      </p>
                    )}
                    {config.showVariantName && (
                      <p className="text-[10px] text-gray-600 font-medium">
                        {variant.variant_name}
                      </p>
                    )}

                    <div className="my-1.5 w-full flex justify-center">
                      <BarcodeSvg
                        value={variant.barcode}
                        height={config.barcodeHeight}
                        showText={config.showBarcodeText}
                      />
                    </div>

                    {(config.showPrice || config.showPackSize) && (
                      <p className="text-xs font-black text-black leading-none mt-0.5">
                        {config.showPrice ? `MRP: ${formatINR(variant.selling_price)}` : ''}
                        {config.showPackSize && variant.pieces_per_set > 1 ? ` (Pack of ${variant.pieces_per_set})` : ''}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {flattenedLabels.length > 6 && (
                <p className="text-center text-xs text-gray-400 mt-3">
                  + {flattenedLabels.length - 6} more labels queued for printing
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. ISOLATED HARDWARE PRINT CONTAINER (PRINT MEDIA ONLY)                    */}
      {/* ========================================================================= */}
      {isPrinting && (
        <div id="print-area" className="print-only">
        {layoutMode === 'a4-sheet' ? (
          <div className="print-a4-pages-container">
            {labelPages.map((pageLabels, pageIdx) => (
              <div key={`page-${pageIdx}`} className="a4-sheet-page">
                {pageLabels.map((variant, idx) => (
                  <div key={`print-a4-${variant.variant_id}-${pageIdx}-${idx}`} className="print-label-card">
                    {config.showStoreName && (
                      <div className="label-store-name text-[9px] font-bold uppercase">
                        {(config.customHeader || '').trim() || storeSettings?.store_name || 'MELBUN'}
                      </div>
                    )}
                    {config.showProductName && (
                      <div className="label-title">{variant.product_name}</div>
                    )}
                    {config.showVariantName && (
                      <div className="label-variant">{variant.variant_name}</div>
                    )}
                    <div className="label-barcode">
                      <BarcodeSvg
                        value={variant.barcode}
                        height={config.barcodeHeight}
                        showText={config.showBarcodeText}
                      />
                    </div>
                    {(config.showPrice || config.showPackSize) && (
                      <div className="label-price">
                        {config.showPrice ? `MRP: ${formatINR(variant.selling_price)}` : ''}
                        {config.showPackSize && variant.pieces_per_set > 1 ? ` (Pack of ${variant.pieces_per_set})` : ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className={`print-container ${layoutMode}`}>
            {flattenedLabels.map((variant, idx) => (
              <div key={`print-${variant.variant_id}-${idx}`} className="print-label-card">
                {config.showStoreName && (
                  <div className="label-store-name text-[9px] font-bold uppercase">
                    {(config.customHeader || '').trim() || storeSettings?.store_name || 'MELBUN'}
                  </div>
                )}
                {config.showProductName && (
                  <div className="label-title">{variant.product_name}</div>
                )}
                {config.showVariantName && (
                  <div className="label-variant">{variant.variant_name}</div>
                )}
                <div className="label-barcode">
                  <BarcodeSvg
                    value={variant.barcode}
                    height={config.barcodeHeight}
                    showText={config.showBarcodeText}
                  />
                </div>
                {(config.showPrice || config.showPackSize) && (
                  <div className="label-price">
                    {config.showPrice ? `MRP: ${formatINR(variant.selling_price)}` : ''}
                    {config.showPackSize && variant.pieces_per_set > 1 ? ` (Pack of ${variant.pieces_per_set})` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* ========================================================================= */}
      {/* 3. CALIBRATED PRINT CSS ENGINE                                            */}
      {/* ========================================================================= */}
      <style jsx global>{`
        /* Default Screen Visibility Rules */
        .print-only {
          display: none;
        }

        /* Pure Isolated Hardware Print Stylesheet */
        @media print {
          @page {
            size: auto;
            margin: 0mm;
          }

          html, body, #__next, body > div, main {
            height: auto !important;
            min-height: 100% !important;
            max-height: none !important;
            overflow: visible !important;
            display: block !important;
            position: static !important;
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Hide all application UI, sidebars, navigation, modals, and preview panels */
          aside, nav, header, .no-print {
            display: none !important;
            visibility: hidden !important;
          }

          .print-only {
            display: block !important;
            visibility: visible !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }

          .print-a4-pages-container {
            display: block !important;
            width: 100% !important;
            overflow: visible !important;
          }

          /* 1-Column Thermal Roll (50mm x 25-30mm) */
          .print-container.thermal-1col {
            width: 50mm;
            margin: 0 auto;
            display: flex;
            flex-direction: column;
          }
          .print-container.thermal-1col .print-label-card {
            width: 50mm;
            min-height: 25mm;
            max-height: 32mm;
            padding: 1.5mm 1mm;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            text-align: center;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: always !important;
            break-after: page !important;
          }
          .print-container.thermal-1col .print-label-card:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }

          /* 2-Column Thermal Roll (100mm wide roll, 2 labels per row) */
          /* High 14 Fix: Replace display:grid with display:block and inline-flex for WebKit/Chromium print pagination */
          .print-container.thermal-2col {
            width: 100mm;
            margin: 0 auto;
            display: block !important;
            font-size: 0;
            line-height: 0;
          }
          .print-container.thermal-2col .print-label-card {
            width: 48mm;
            min-height: 25mm;
            max-height: 32mm;
            margin-right: 4mm;
            margin-bottom: 0;
            display: inline-flex !important;
            vertical-align: top;
            padding: 1.5mm 1mm;
            box-sizing: border-box;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            text-align: center;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .print-container.thermal-2col .print-label-card:nth-child(2n) {
            margin-right: 0 !important;
            page-break-after: always !important;
            break-after: page !important;
          }
          .print-container.thermal-2col .print-label-card:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }

          /* A4 Sheet (Dynamic Grid, multi-page discrete page blocks) */
          .a4-sheet-page {
            width: 194mm;
            max-height: 275mm;
            margin: 0 auto;
            padding: 4mm 0;
            box-sizing: border-box;
            display: grid;
            grid-template-columns: repeat(${activeColumns}, ${sheetPreset.colWidthMm}mm);
            grid-auto-rows: ${sheetPreset.rowHeightMm}mm;
            column-gap: ${sheetPreset.colGapMm}mm;
            row-gap: ${sheetPreset.rowGapMm}mm;
            justify-content: center;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: always !important;
            break-after: page !important;
          }
          .a4-sheet-page:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
          .a4-sheet-page .print-label-card {
            width: ${sheetPreset.colWidthMm}mm;
            height: ${sheetPreset.rowHeightMm}mm;
            padding: 1.5mm 1mm;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            text-align: center;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            border: 0.1mm dotted #ccc;
          }

          /* Micro-Typography for Printing */
          .label-title {
            font-size: ${activeColumns >= 4 ? '6.5pt' : '7.5pt'};
            font-weight: 700;
            line-height: 1.1;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .label-variant {
            font-size: ${activeColumns >= 4 ? '5.5pt' : '7pt'};
            color: #333;
            line-height: 1;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .label-barcode {
            margin: 0.5mm 0;
            display: flex;
            justify-content: center;
          }
          .label-price {
            font-size: ${activeColumns >= 4 ? '7pt' : '8.5pt'};
            font-weight: 900;
            line-height: 1;
          }
        }
      `}</style>
    </div>
  );
}
