'use client'

import { useState, useRef, useEffect, useCallback } from 'react';
import { ScanBarcode, Search, AlertCircle, Package, Camera, Loader2 } from 'lucide-react';
import { searchVariantsAction } from '@/lib/actions/pos';
import CameraScanner from '@/components/lookup/CameraScanner';

const formatINR = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2
  }).format(amount);
};

export default function LookupPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const activeQueryRef = useRef('');

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadingRef = useRef(false);

  const executeSearch = useCallback(async (searchQuery: string) => {
    const clean = searchQuery.trim();
    if (!clean) {
      if (isMountedRef.current) {
        setResults([]);
        setLoading(false);
      }
      return;
    }
    if (activeQueryRef.current === clean && loadingRef.current) return;
    activeQueryRef.current = clean;
    loadingRef.current = true;
    if (isMountedRef.current) setLoading(true);

    try {
      const res = await searchVariantsAction(clean);
      if (isMountedRef.current) {
        if (res.success && res.data) {
          setResults(res.data);
        } else {
          setResults([]);
        }
      }
    } finally {
      loadingRef.current = false;
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  // Debounced live search
  useEffect(() => {
    const timer = setTimeout(() => {
      executeSearch(query);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, executeSearch]);

  // Global keydown capture for hardware USB barcode guns
  useEffect(() => {
    let scanBuffer = '';
    let lastKeyTime = 0;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is actively focused on search input or holding modifier keys
      if (document.activeElement === inputRef.current || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const now = Date.now();
      if (now - lastKeyTime > 150) {
        scanBuffer = '';
      }
      lastKeyTime = now;

      if (e.key === 'Enter') {
        if (scanBuffer.trim()) {
          const finalScan = scanBuffer.trim();
          scanBuffer = '';
          setQuery(finalScan);
          executeSearch(finalScan);
        }
      } else if (e.key.length === 1 && !isCameraOpen) {
        scanBuffer += e.key;
        setQuery(scanBuffer);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isCameraOpen, executeSearch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(query);
  };

  const handleCameraScan = async (decodedText: string) => {
    setIsCameraOpen(false);
    setQuery(decodedText);
    executeSearch(decodedText);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <header className="text-center space-y-2">
        <div className="mx-auto w-16 h-16 bg-[#8B0000]/10 rounded-2xl flex items-center justify-center text-[#8B0000] mb-4">
          <ScanBarcode className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900">Price & Stock Scanner</h1>
        <p className="text-gray-500">Scan a barcode or search by name to instantly view price and availability.</p>
      </header>

      <form onSubmit={handleSearch} className="relative max-w-2xl mx-auto flex gap-3">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search className="w-6 h-6 text-gray-400" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Scan barcode or type product name..."
            className="w-full pl-12 pr-12 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:border-[#8B0000] focus:ring-4 focus:ring-[#8B0000]/10 outline-none transition-all"
            autoFocus
          />
          <button 
            type="button"
            onClick={() => setIsCameraOpen(true)}
            className="absolute inset-y-2 right-2 px-4 text-gray-500 hover:text-[#8B0000] hover:bg-red-50 rounded-xl transition-colors flex items-center justify-center"
            title="Scan with Camera"
          >
            <Camera className="w-6 h-6" />
          </button>
        </div>
        <button 
          type="submit" 
          disabled={loading}
          className="px-8 bg-[#8B0000] text-white font-bold text-lg rounded-2xl hover:bg-[#A52A2A] transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Lookup'}
        </button>
      </form>

      {isCameraOpen && (
        <CameraScanner 
          onScan={handleCameraScan} 
          onClose={() => setIsCameraOpen(false)} 
        />
      )}

      {results.length > 0 && (
        <div className="grid gap-4 mt-8">
          {results.map(variant => (
            <div key={variant.variant_id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{variant.name}</h3>
                  <p className="text-sm text-gray-500 font-mono mt-1">Barcode: {variant.barcode || 'N/A'}</p>
                  <p className="text-sm text-gray-500 mt-1">Packaged as: {variant.pieces_per_set} pieces / set</p>
                </div>
              </div>
              <div className="text-right space-y-2">
                <div className="text-3xl font-bold text-[#8B0000]">
                  {formatINR(variant.price)}
                </div>
                <div className="flex gap-2 justify-end">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold bg-gray-100 text-gray-700">
                    Total: {variant.stock_quantity} pcs
                  </span>
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold bg-blue-50 text-blue-700">
                    {variant.stock_sets} sets ({Math.max(0, variant.stock_quantity - (variant.stock_sets * (variant.pieces_per_set || 1)))} loose)
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {query && results.length === 0 && !loading && (
        <div className="text-center p-12 bg-gray-50 rounded-2xl border border-gray-200">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900">Product Not Found</h3>
          <p className="text-gray-500 mt-1">No matching barcode or product name in inventory.</p>
        </div>
      )}
    </div>
  );
}
