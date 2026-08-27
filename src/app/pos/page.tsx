'use client'

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { 
  Search, 
  Trash2, 
  Plus, 
  Minus, 
  User, 
  CreditCard, 
  Percent, 
  IndianRupee,
  CheckCircle,
  AlertCircle,
  X,
  Wallet,
  Download,
  Loader2,
  Camera,
  Calendar,
  Clock,
  Edit3,
  RotateCcw,
  ArrowLeft,
  MessageSquare
} from 'lucide-react';
import CameraScanner from '@/components/lookup/CameraScanner';
import { createClient } from '@/lib/supabase/client';
import { searchVariantsAction } from '@/lib/actions/pos';
import { checkoutSchema, updateFullInvoiceSchema } from '@/lib/actions/checkout';
import { getCustomersListAction, getOrCreateCustomerAction } from '@/lib/actions/customers';
import { getFullInvoiceAction } from '@/lib/actions/invoices';
import { getStoreSettingsAction } from '@/lib/actions/settings';
import { generateInvoicePDF } from '@/lib/pdf/generateInvoice';
import { 
  formatWhatsAppMessage, 
  openWhatsAppChat, 
  cleanWhatsAppPhone, 
  DEFAULT_WHATSAPP_INVOICE_TEMPLATE 
} from '@/lib/whatsapp';
import { WhatsAppPromptModal } from '@/components/whatsapp/WhatsAppPromptModal';
import ProductVariantSelectModal, { GroupedProductResult, GroupedProductVariant } from '@/components/pos/ProductVariantSelectModal';
import { formatINR, formatDualQuantity } from '@/lib/formatters';
import toast from 'react-hot-toast';

interface CartItem {
  variant_id: string;
  name: string;
  sets_quantity: number;
  loose_quantity: number;
  price: number;
  pieces_per_set: number;
  stock_quantity?: number;
  stock_sets?: number;
}

const round2 = (num: number): number => Math.round((num + Number.EPSILON) * 100) / 100;

function POSContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editInvoiceIdParam = searchParams.get('edit_invoice_id') || searchParams.get('editInvoiceId');

  const [editInvoiceId, setEditInvoiceId] = useState<string | null>(null);
  const [editInvoiceNumber, setEditInvoiceNumber] = useState<string | null>(null);
  const [isInitialLoadingInvoice, setIsInitialLoadingInvoice] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [resolvedCustomerId, setResolvedCustomerId] = useState<string | null>(null);
  const [customerCredit, setCustomerCredit] = useState<number>(0);
  const [originalStoreCreditApplied, setOriginalStoreCreditApplied] = useState<number>(0);
  const [originalInvoiceCustomerId, setOriginalInvoiceCustomerId] = useState<string | null>(null);
  const [isMobileCheckoutOpen, setIsMobileCheckoutOpen] = useState(false);
  const [customerSuggestions, setCustomerSuggestions] = useState<any[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  
  const [invoiceDateStr, setInvoiceDateStr] = useState<string>(''); // For backdating & editing timestamps
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState<string>('');
  const [roundOff, setRoundOff] = useState<string>('');
  const [gstApplied, setGstApplied] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'CREDIT' | 'SPLIT' | 'STORE_CREDIT'>('CASH');
  
  const [splitCash, setSplitCash] = useState<string>('');
  const [splitUpi, setSplitUpi] = useState<string>('');
  const [splitCredit, setSplitCredit] = useState<string>('');
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [splitSaved, setSplitSaved] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);

  const [amountPaidStr, setAmountPaidStr] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string, invoiceId?: string, invoiceNumber?: string } | null>(null);
  const [storeSettings, setStoreSettings] = useState<any>(null);

  // WhatsApp Checkout State & Modal
  const [lastCheckoutSummary, setLastCheckoutSummary] = useState<{
    customerName?: string;
    customerPhone?: string;
    totalAmount: number;
    paidAmount: number;
    dueAmount: number;
    itemCount: number;
    invoiceNumber?: string;
    invoiceId?: string;
  } | null>(null);

  const [whatsappModal, setWhatsappModal] = useState<{
    isOpen: boolean;
    title: string;
    defaultPhone: string;
    message: string;
    customerName: string;
  }>({
    isOpen: false,
    title: '',
    defaultPhone: '',
    message: '',
    customerName: ''
  });

  useEffect(() => {
    getStoreSettingsAction().then((res) => {
      if (res.success && res.data) {
        setStoreSettings(res.data);
      }
    });
  }, []);

  // WhatsApp Handler
  const handleSendWhatsAppReceipt = () => {
    if (!lastCheckoutSummary && !status?.invoiceNumber) return;
    const template = storeSettings?.whatsapp_invoice_template || DEFAULT_WHATSAPP_INVOICE_TEMPLATE;
    const totalAmt = lastCheckoutSummary?.totalAmount ?? 0;
    const paidAmt = lastCheckoutSummary?.paidAmount ?? 0;
    const dueAmt = lastCheckoutSummary?.dueAmount ?? 0;
    const itemCount = lastCheckoutSummary?.itemCount ?? 1;
    const invNumber = status?.invoiceNumber || lastCheckoutSummary?.invoiceNumber || 'N/A';
    const cName = lastCheckoutSummary?.customerName || customerName || 'Valued Customer';
    const cPhone = lastCheckoutSummary?.customerPhone || customerPhone || '';

    const message = formatWhatsAppMessage(template, {
      customer_name: cName,
      customer_phone: cPhone,
      store_name: storeSettings?.store_name || 'Melbun Wholesale',
      store_phone: storeSettings?.phone || '',
      store_address: storeSettings?.address || '',
      invoice_number: invNumber,
      date: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      item_count: itemCount,
      total_amount: totalAmt,
      paid_amount: paidAmt,
      due_amount: dueAmt,
      status: dueAmt > 0 ? `Partial (Due: ₹${dueAmt.toFixed(2)})` : 'Paid'
    });

    const cleanPhone = cleanWhatsAppPhone(cPhone);
    if (cleanPhone) {
      openWhatsAppChat({ phone: cleanPhone, message });
      toast.success('Opening WhatsApp...');
    } else {
      setWhatsappModal({
        isOpen: true,
        title: 'Send WhatsApp Receipt',
        defaultPhone: '',
        message,
        customerName: cName
      });
    }
  };

  // Success Modal Escape Key Dismissal
  useEffect(() => {
    if (status?.type !== 'success') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStatus(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status]);

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraStatusMessage, setCameraStatusMessage] = useState<string | null>(null);
  const [isClearCartModalOpen, setIsClearCartModalOpen] = useState(false);

  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedProductGroup, setSelectedProductGroup] = useState<GroupedProductResult | null>(null);

  // Group variant search results by Product for clean POS item picker
  const groupedSearchResults = useMemo<GroupedProductResult[]>(() => {
    if (!searchResults || searchResults.length === 0) return [];

    const groupMap = new Map<string, GroupedProductResult>();

    searchResults.forEach((v: any) => {
      const pId = v.product_id || v.variant_id;
      const rawName = String(v.name || '');
      const pName = String(v.product_name || (rawName.includes(' - ') ? rawName.split(' - ')[0] : rawName));
      const piecesPerSet = Math.max(1, Number(v.pieces_per_set) || 1);
      const price = Number(v.selling_price || v.price || 0);

      let varName = String(v.variant_name || rawName);
      if (rawName.startsWith(pName + ' - ')) {
        varName = rawName.slice((pName + ' - ').length);
      } else if (rawName.includes(' - ')) {
        varName = rawName.split(' - ').slice(1).join(' - ');
      }

      const variantObj: GroupedProductVariant = {
        variant_id: v.variant_id || v.id,
        name: rawName,
        variant_name: varName || rawName,
        barcode: v.barcode || '',
        price,
        selling_price: price,
        stock_quantity: Number(v.stock_quantity) || 0,
        stock_sets: Number(v.stock_sets) || 0,
        pieces_per_set: piecesPerSet
      };

      if (!groupMap.has(pId)) {
        groupMap.set(pId, {
          product_id: pId,
          product_name: pName,
          pieces_per_set: piecesPerSet,
          min_price: price,
          max_price: price,
          total_stock_quantity: variantObj.stock_quantity,
          total_stock_sets: variantObj.stock_sets,
          variants: [variantObj]
        });
      } else {
        const existing = groupMap.get(pId)!;
        existing.variants.push(variantObj);
        existing.min_price = Math.min(existing.min_price, price);
        existing.max_price = Math.max(existing.max_price, price);
        existing.total_stock_quantity += variantObj.stock_quantity;
        existing.total_stock_sets += variantObj.stock_sets;
      }
    });

    return Array.from(groupMap.values());
  }, [searchResults]);

  // Load existing invoice for full editing if editInvoiceIdParam is present
  useEffect(() => {
    if (!editInvoiceIdParam) {
      setEditInvoiceId(null);
      setEditInvoiceNumber(null);
      return;
    }

    const loadInvoiceForEdit = async () => {
      setIsInitialLoadingInvoice(true);
      setStatus(null);
      try {
        const res = await getFullInvoiceAction(editInvoiceIdParam);
        if (res.success && res.data) {
          const inv = res.data;
          if (inv.is_voided) {
            setStatus({ type: 'error', msg: `Invoice #${inv.invoice_number} is voided. Please undo void before editing.` });
            return;
          }
          if (inv.is_hidden) {
            setStatus({ type: 'error', msg: `Invoice #${inv.invoice_number} has been permanently deleted.` });
            return;
          }

          setEditInvoiceId(inv.id);
          setEditInvoiceNumber(inv.invoice_number);

          // 1. Format timestamp for datetime-local
          if (inv.created_at) {
            const d = new Date(inv.created_at);
            const offset = d.getTimezoneOffset() * 60000;
            const localISOTime = new Date(d.getTime() - offset).toISOString().slice(0, 16);
            setInvoiceDateStr(localISOTime);
          }

          // 2. Customer
          if (inv.customers) {
            setCustomerName(inv.customers.name || '');
            setCustomerPhone(inv.customers.phone || '');
            setResolvedCustomerId(inv.customers.id);
            setOriginalInvoiceCustomerId(inv.customers.id);
            setCustomerCredit(Number(inv.customers.credit_balance || 0));
          } else {
            setCustomerName('');
            setCustomerPhone('');
            setResolvedCustomerId(null);
            setOriginalInvoiceCustomerId(null);
            setCustomerCredit(0);
          }

          // 3. Financials
          setDiscountType('amount');
          setDiscountValue(inv.discount_amount > 0 ? inv.discount_amount.toString() : '');
          setRoundOff(inv.round_off !== 0 ? inv.round_off.toString() : '');
          setGstApplied(Boolean(inv.gst_applied));

          // 4. Cart Items
          if (inv.invoice_items && inv.invoice_items.length > 0) {
            const loadedCart: CartItem[] = inv.invoice_items.map((it: any) => {
              const variant = it.variants || {};
              const pcsPerSet = it.pieces_per_set || variant.products?.pieces_per_set || 1;
              const resolvedVariantId = it.variant_id || variant.id;
              return {
                variant_id: resolvedVariantId,
                name: variant.products?.name ? `${variant.products.name} - ${variant.name}` : (variant.name || 'Item'),
                price: Number(it.selling_price_snapshot || variant.selling_price || 0),
                pieces_per_set: pcsPerSet,
                sets_quantity: it.sets_quantity || 0,
                loose_quantity: it.loose_quantity !== undefined ? it.loose_quantity : (it.quantity % pcsPerSet),
                stock_quantity: (Number(variant.stock_quantity) || 0) + (Number(it.quantity) || 0),
                stock_sets: (Number(variant.stock_sets) || 0) + (Number(it.sets_quantity) || 0)
              };
            });
            setCart(loadedCart);
          }

          // 5. Payment details & Store Credit extraction
          let origStoreCredit = 0;
          if (inv.payments && inv.payments.length > 0) {
            inv.payments.forEach((p: any) => {
              if (p.method === 'STORE_CREDIT') {
                origStoreCredit += Number(p.amount) || 0;
              }
            });
            if (inv.payments.length === 1) {
              const p = inv.payments[0];
              if (p.method === 'STORE_CREDIT') {
                setPaymentMethod('STORE_CREDIT');
                setAmountPaidStr('');
              } else if (p.method === 'UPI') {
                setPaymentMethod('UPI');
                setAmountPaidStr(p.amount.toString());
              } else {
                setPaymentMethod('CASH');
                setAmountPaidStr(p.amount.toString());
              }
            } else {
              setPaymentMethod('SPLIT');
              let cAmt = 0, uAmt = 0, crAmt = 0;
              inv.payments.forEach((p: any) => {
                if (p.method === 'CASH') cAmt += Number(p.amount);
                if (p.method === 'UPI') uAmt += Number(p.amount);
                if (p.method === 'STORE_CREDIT') crAmt += Number(p.amount);
              });
              setSplitCash(cAmt > 0 ? cAmt.toString() : '');
              setSplitUpi(uAmt > 0 ? uAmt.toString() : '');
              setSplitCredit(crAmt > 0 ? crAmt.toString() : '');
              justLoadedInvoiceRef.current = true;
              setSplitSaved(true);
            }
          } else {
            setPaymentMethod('CREDIT');
            setAmountPaidStr('');
          }
          setOriginalStoreCreditApplied(origStoreCredit);
        } else {
          setStatus({ type: 'error', msg: res?.error || 'Failed to load invoice for editing' });
        }
      } catch (err: any) {
        setStatus({ type: 'error', msg: err.message || 'Error loading invoice' });
      } finally {
        setIsInitialLoadingInvoice(false);
      }
    };

    loadInvoiceForEdit();
  }, [editInvoiceIdParam]);

  const handleCameraScan = async (barcode: string) => {
    if (!barcode) return;
    try {
      const res = await searchVariantsAction(barcode.trim());
      if (res.success && res.data && res.data.length > 0) {
        const exact = res.data.find((v: any) => 
          (v.barcode && v.barcode.toLowerCase() === barcode.trim().toLowerCase()) ||
          (v.sku && v.sku.toLowerCase() === barcode.trim().toLowerCase())
        );
        if (exact) {
          handleAddToCart(exact);
          if (typeof window !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate?.(100);
          }
          setCameraStatusMessage(`Added: ${exact.name}`);
          setTimeout(() => setCameraStatusMessage(null), 1800);
        } else {
          if (typeof window !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate?.([100, 50, 100]);
          }
          setCameraStatusMessage(`No exact match for '${barcode}'`);
          setTimeout(() => setCameraStatusMessage(null), 2500);
        }
      } else {
        if (typeof window !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.([100, 50, 100]);
        }
        setCameraStatusMessage(`Barcode not found: ${barcode}`);
        setTimeout(() => setCameraStatusMessage(null), 2500);
      }
    } catch (err) {
      setCameraStatusMessage(`Scan error. Please retry.`);
    }
  };

  useEffect(() => {
    const query = (customerName || '').trim() || (customerPhone || '').trim();
    const fetchCustomers = async () => {
      if (!query || query.length < 2) {
        setCustomerSuggestions([]);
        return;
      }
      const res = await getCustomersListAction(query);
      if (res.success && res.data) {
        setCustomerSuggestions(res.data.slice(0, 5));
        const exactPhoneMatch = res.data.find((c: any) => c.phone && c.phone.trim() === customerPhone.trim());
        if (exactPhoneMatch && !resolvedCustomerId) {
          setResolvedCustomerId(exactPhoneMatch.id);
          setCustomerName(exactPhoneMatch.name);
          setCustomerCredit(Number(exactPhoneMatch.credit_balance || 0));
        }
      }
    };
    
    if (!resolvedCustomerId || customerSuggestions.length > 0) {
      const timer = setTimeout(fetchCustomers, 300);
      return () => clearTimeout(timer);
    }
  }, [customerName, customerPhone, resolvedCustomerId, customerSuggestions.length]);

  // Split Modal Escape Key Dismissal
  useEffect(() => {
    if (!isSplitModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSplitModalOpen(false);
        setSplitError(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSplitModalOpen]);

  const selectCustomer = (cust: any) => {
    setCustomerName(cust.name);
    setCustomerPhone(cust.phone || '');
    setResolvedCustomerId(cust.id);
    setCustomerCredit(Number(cust.credit_balance || 0));
    setCustomerSuggestions([]);
    setShowCustomerDropdown(false);
  };

  const isSubmittingRef = useRef(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      const res = await searchVariantsAction(query);
      if (res.success && res.data) {
        setSearchResults(res.data);
      }
      setIsSearching(false);
    }, 250);
  };

  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = (e.currentTarget.value || searchQuery).trim();
      if (!q) return;

      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      setSearchQuery('');
      setIsSearching(true);

      try {
        const localMatch = searchResults.find(v => (v.barcode && v.barcode.toLowerCase() === q.toLowerCase()) || v.sku?.toLowerCase() === q.toLowerCase());
        if (localMatch) {
          handleAddToCart(localMatch);
          setSearchResults([]);
          return;
        }

        const res = await searchVariantsAction(q);
        if (res.success && res.data && res.data.length > 0) {
          const exact = res.data.find((v: any) => (v.barcode && v.barcode.toLowerCase() === q.toLowerCase()) || (v.sku && v.sku.toLowerCase() === q.toLowerCase()));
          if (exact) {
            handleAddToCart(exact);
          } else if (res.data.length === 1 && ((res.data[0].barcode && res.data[0].barcode.toLowerCase() === q.toLowerCase()) || (res.data[0].sku && res.data[0].sku.toLowerCase() === q.toLowerCase()))) {
            handleAddToCart(res.data[0]);
          } else {
            setSearchResults(res.data);
          }
        } else {
          setSearchResults([]);
          setStatus({ type: 'error', msg: `No product found matching barcode '${q}'` });
        }
      } finally {
        setIsSearching(false);
      }
    }
  };

  const isSplitModalOpenRef = useRef(false);
  useEffect(() => {
    isSplitModalOpenRef.current = isSplitModalOpen;
  }, [isSplitModalOpen]);

  // Global Hardware USB Scanner Listener
  useEffect(() => {
    let scanBuffer = '';
    let lastKeyTime = 0;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isSplitModalOpenRef.current) return;

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
          searchVariantsAction(barcode).then((res) => {
            if (res.success && res.data && res.data.length > 0) {
              const exact = res.data.find((v: any) => (v.barcode && v.barcode.toLowerCase() === barcode.toLowerCase()) || (v.sku && v.sku.toLowerCase() === barcode.toLowerCase()));
              if (exact) {
                handleAddToCart(exact);
              } else {
                setStatus({ type: 'error', msg: `No exact product match found for barcode '${barcode}'` });
              }
            } else {
              setStatus({ type: 'error', msg: `No product found matching barcode '${barcode}'` });
            }
          });
        }
      } else if (e.key.length === 1) {
        scanBuffer += e.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // BeforeUnload Guard
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isSubmittingRef.current || cart.length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [cart.length]);

  const handleAddToCart = (variant: any) => {
    setSearchResults([]);
    setIsSearching(false);
    setSearchQuery(prev => (prev === variant.barcode || prev === variant.name ? '' : prev));
    setCart(prev => {
      const exists = prev.find(i => i.variant_id === variant.variant_id);
      if (exists) {
        const canIncrementSets = (exists.stock_sets && exists.stock_sets > 0) || (variant.stock_sets && variant.stock_sets > 0);
        return prev.map(i => {
          if (i.variant_id === variant.variant_id) {
            if (canIncrementSets) {
              return { ...i, sets_quantity: i.sets_quantity + 1 };
            } else {
              return { ...i, loose_quantity: i.loose_quantity + 1 };
            }
          }
          return i;
        });
      }
      return [...prev, {
        variant_id: variant.variant_id,
        name: variant.product_name ? `${variant.product_name} - ${variant.variant_name || variant.name}` : (variant.name || 'Item'),
        price: Number(variant.selling_price || variant.price || 0),
        pieces_per_set: variant.pieces_per_set || 1,
        sets_quantity: variant.stock_sets && variant.stock_sets > 0 ? 1 : 0,
        loose_quantity: variant.stock_sets && variant.stock_sets > 0 ? 0 : 1,
        stock_quantity: variant.stock_quantity,
        stock_sets: variant.stock_sets
      }];
    });
  };

  const handleBatchAddVariantsToCart = (
    productGroup: GroupedProductResult,
    itemsToAdd: Array<{ variant: GroupedProductVariant; sets: number; loose: number }>
  ) => {
    setSearchResults([]);
    setIsSearching(false);
    setSearchQuery('');
    setSelectedProductGroup(null);

    setCart(prev => {
      let nextCart = [...prev];

      itemsToAdd.forEach(({ variant, sets, loose }) => {
        if (sets <= 0 && loose <= 0) return;

        const existingIndex = nextCart.findIndex(i => i.variant_id === variant.variant_id);
        const fullName = `${productGroup.product_name} - ${variant.variant_name}`;

        if (existingIndex >= 0) {
          const existing = nextCart[existingIndex];
          nextCart[existingIndex] = {
            ...existing,
            sets_quantity: existing.sets_quantity + sets,
            loose_quantity: existing.loose_quantity + loose
          };
        } else {
          nextCart.push({
            variant_id: variant.variant_id,
            name: fullName,
            price: Number(variant.selling_price || variant.price || 0),
            pieces_per_set: variant.pieces_per_set || productGroup.pieces_per_set || 1,
            sets_quantity: sets,
            loose_quantity: loose,
            stock_quantity: variant.stock_quantity,
            stock_sets: variant.stock_sets
          });
        }
      });

      return nextCart;
    });

    setSplitSaved(false);
    toast.success(`Added ${productGroup.product_name} items to cart`);
  };

  const handleRemoveItem = (variantId: string) => {
    setCart(prev => prev.filter(i => i.variant_id !== variantId));
    setSplitSaved(false);
  };

  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => {
      const totalPcs = (item.sets_quantity * item.pieces_per_set) + item.loose_quantity;
      return sum + (totalPcs * item.price);
    }, 0);
  }, [cart]);

  const discountAmount = useMemo(() => {
    const val = parseFloat(discountValue) || 0;
    if (val <= 0) return 0;
    if (discountType === 'percent') {
      const clampedPct = Math.min(100, val);
      return round2((subtotal * clampedPct) / 100);
    }
    return round2(Math.min(subtotal, val));
  }, [subtotal, discountValue, discountType]);

  const preGstTotal = Math.max(0, subtotal - discountAmount);

  const { cgstAmount, sgstAmount } = useMemo(() => {
    if (!gstApplied) return { cgstAmount: 0, sgstAmount: 0 };
    const half = (preGstTotal * 0.025);
    return { cgstAmount: round2(half), sgstAmount: round2(half) };
  }, [gstApplied, preGstTotal]);

  const roundOffAmount = useMemo(() => {
    const raw = parseFloat(roundOff) || 0;
    const maxNegative = -(preGstTotal + cgstAmount + sgstAmount);
    return round2(Math.max(Math.max(-50, maxNegative), Math.min(50, raw)));
  }, [roundOff, preGstTotal, cgstAmount, sgstAmount]);

  const finalTotal = useMemo(() => {
    const rawTotal = preGstTotal + cgstAmount + sgstAmount + roundOffAmount;
    return round2(Math.max(0, rawTotal));
  }, [preGstTotal, cgstAmount, sgstAmount, roundOffAmount]);

  const prevFinalTotalRef = useRef(finalTotal);
  const justLoadedInvoiceRef = useRef(false);

  // Set default amount paid when total changes or method changes
  useEffect(() => {
    if (paymentMethod === 'CASH' || paymentMethod === 'UPI') {
      const currentPaid = parseFloat(amountPaidStr || '0');
      const isAutoMatching = !amountPaidStr.trim() || Math.abs(currentPaid - prevFinalTotalRef.current) < 0.01;
      if (isAutoMatching) {
        setAmountPaidStr(finalTotal.toString());
      }
    } else {
      setAmountPaidStr('');
    }

    if (justLoadedInvoiceRef.current) {
      justLoadedInvoiceRef.current = false;
      prevFinalTotalRef.current = finalTotal;
      return;
    }

    if (prevFinalTotalRef.current !== finalTotal) {
      setSplitSaved(false);
    }

    prevFinalTotalRef.current = finalTotal;
  }, [finalTotal, paymentMethod, amountPaidStr]);

  const handleUpdateItem = (variant_id: string, field: 'sets_quantity' | 'loose_quantity', value: number) => {
    setCart(prev => prev.map(item => {
      if (item.variant_id === variant_id) {
        const val = Math.max(0, isNaN(value) ? 0 : value);
        return { ...item, [field]: val };
      }
      return item;
    }));
  };

  const isOriginalInvoiceCustomer = Boolean(
    editInvoiceId && 
    resolvedCustomerId && 
    originalInvoiceCustomerId && 
    resolvedCustomerId === originalInvoiceCustomerId
  );
  const effectiveAvailableCredit = round2(
    (customerCredit || 0) + (isOriginalInvoiceCustomer ? originalStoreCreditApplied : 0)
  );

  const handleSaveSplit = () => {
    setSplitError(null);
    const cash = parseFloat(splitCash) || 0;
    const upi = parseFloat(splitUpi) || 0;
    const credit = parseFloat(splitCredit) || 0;
    
    if (cash < 0 || upi < 0 || credit < 0) {
      setSplitError('Payment amounts cannot be negative.');
      return;
    }

    if (credit > effectiveAvailableCredit) {
      setSplitError(`Store credit amount (₹${credit.toFixed(2)}) exceeds customer available credit balance of ₹${effectiveAvailableCredit.toFixed(2)}.`);
      return;
    }

    const total = round2(cash + upi + credit);
    
    if (total !== finalTotal) {
      setSplitError(`Split total (₹${total.toFixed(2)}) must exactly equal the bill total (₹${finalTotal.toFixed(2)}).`);
      return;
    }
    setSplitSaved(true);
    setIsSplitModalOpen(false);
  };

  const handleDownloadPdf = async (invoiceId: string) => {
    try {
      setDownloadingPdf(true);
      const [invRes, storeRes] = await Promise.all([
        getFullInvoiceAction(invoiceId),
        getStoreSettingsAction()
      ]);
      if (invRes.success && invRes.data) {
        const store = storeRes?.success && storeRes.data ? storeRes.data : null;
        const storeConfig = store ? {
          storeName: store.store_name || undefined,
          tagline: store.tagline || undefined,
          addressLine1: store.address || undefined,
          phone: store.phone || undefined,
          email: store.email || undefined,
          gstin: store.gstin || undefined
        } : undefined;
        generateInvoicePDF(invRes.data, { storeConfig });
      } else {
        alert(invRes?.error || 'Failed to load invoice details for PDF.');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error generating PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const resetFormState = () => {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setResolvedCustomerId(null);
    setCustomerCredit(0);
    setInvoiceDateStr('');
    setDiscountValue('');
    setRoundOff('');
    setGstApplied(false);
    setDiscountType('amount');
    setPaymentMethod('CASH');
    setAmountPaidStr('');
    setSplitCash('');
    setSplitUpi('');
    setSplitCredit('');
    setSplitSaved(false);
    setEditInvoiceId(null);
    setEditInvoiceNumber(null);
    setOriginalStoreCreditApplied(0);
    setOriginalInvoiceCustomerId(null);
  };

function formatHumanReadableError(errorMsg: string): string {
  const clean = (errorMsg || '').toLowerCase();
  
  if (clean.includes('unauthorized') || clean.includes('jwt') || clean.includes('auth.uid')) {
    return 'Your login session has expired. Please sign in again.';
  }
  if (clean.includes('insufficient stock') || clean.includes('packaged sets')) {
    return 'One or more items in the cart exceed available inventory on hand.';
  }
  if (clean.includes('store credit') || clean.includes('wallet')) {
    return `Store credit error: ${errorMsg}`;
  }
  if (clean.includes('customer is required') || clean.includes('walk-in')) {
    return 'A customer must be linked to complete a credit or partial-payment sale.';
  }
  if (clean.includes('duplicate key') || clean.includes('unique constraint')) {
    return 'A record with this number already exists. Please try again.';
  }
  if (clean.includes('foreign key') || clean.includes('not found')) {
    return 'Selected product variant or customer could not be found. Please refresh the page.';
  }
  if (clean.includes('cannot be edited') || clean.includes('existing return')) {
    return 'This invoice has processed customer returns and cannot be edited directly.';
  }
  if (clean.includes('voided') || clean.includes('is_voided')) {
    return 'This invoice is voided. You must undo the void before making changes.';
  }

  return errorMsg;
}

  const handleCheckoutOrUpdate = async () => {
    if (isSubmittingRef.current || loading || cart.length === 0) return;

    const validCart = cart.filter(i => ((i.sets_quantity * i.pieces_per_set) + i.loose_quantity) > 0);
    if (validCart.length === 0) {
      setStatus({ type: 'error', msg: 'Please enter a valid quantity (sets or loose > 0) for at least one item in the cart.' });
      return;
    }

    try {
      isSubmittingRef.current = true;
      setLoading(true);
      setStatus(null);

      const supabase = createClient();

      // 1. Resolve Customer if name OR phone is provided
      let finalCustomerId = resolvedCustomerId;
      if (customerName.trim() || customerPhone.trim()) {
        const { data: custData, error: custErr } = await supabase.rpc('get_or_create_customer', {
          p_name: customerName.trim() || null,
          p_phone: customerPhone.trim() || null
        });

        if (custErr || !custData || !custData.customer) {
          setStatus({ type: 'error', msg: formatHumanReadableError(custErr?.message || 'Failed to save customer') });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }
        finalCustomerId = custData.customer.id;
        setResolvedCustomerId(finalCustomerId);
      }

      // 2. Validate Packaged Sets & Payment Rules
      const hasOverSets = validCart.some(item => item.stock_sets !== undefined && item.sets_quantity > item.stock_sets);
      if (hasOverSets) {
        setStatus({ type: 'error', msg: 'One or more items in the cart exceed available packaged sets on hand.' });
        setLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      let payments: { amount: number, method: 'CASH' | 'UPI' | 'STORE_CREDIT' }[] = [];
      const amountPaid = parseFloat(amountPaidStr) || 0;

      if (finalTotal === 0) {
        payments = [];
      } else if (paymentMethod === 'SPLIT') {
        const cashAmt = parseFloat(splitCash) || 0;
        const upiAmt = parseFloat(splitUpi) || 0;
        const credAmt = parseFloat(splitCredit) || 0;
        const splitSum = round2(cashAmt + upiAmt + credAmt);

        if (!splitSaved || Math.abs(splitSum - finalTotal) > 0.01) {
          setStatus({ type: 'error', msg: 'Please complete and save the split payment (must equal invoice total).' });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }

        if (cashAmt > 0) payments.push({ amount: cashAmt, method: 'CASH' });
        if (upiAmt > 0) payments.push({ amount: upiAmt, method: 'UPI' });
        if (credAmt > 0) {
          if (!finalCustomerId) {
            setStatus({ type: 'error', msg: 'Customer is required when applying Store Credit in split payment.' });
            setLoading(false);
            isSubmittingRef.current = false;
            return;
          }
          payments.push({ amount: credAmt, method: 'STORE_CREDIT' });
        }
      } else if (paymentMethod === 'STORE_CREDIT') {
        if (!finalCustomerId) {
          setStatus({ type: 'error', msg: 'Customer is required when paying with Store Credit.' });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }
        if (effectiveAvailableCredit < finalTotal) {
          setStatus({ type: 'error', msg: `Insufficient store credit balance (Available: ₹${effectiveAvailableCredit.toFixed(2)}, Bill: ₹${finalTotal.toFixed(2)}).` });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }
        payments = [{ amount: finalTotal, method: 'STORE_CREDIT' }];
      } else if (paymentMethod === 'CREDIT') {
        if (!finalCustomerId) {
          setStatus({ type: 'error', msg: 'Customer is required for CREDIT sales.' });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }
      } else {
        // CASH or UPI
        if (amountPaid < 0) {
          setStatus({ type: 'error', msg: 'Payment amount cannot be negative.' });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }
        if (amountPaid > finalTotal) {
          setStatus({ type: 'error', msg: `Amount paid cannot exceed invoice total of ₹${finalTotal.toFixed(2)}.` });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }
        if (amountPaid < finalTotal && !finalCustomerId) {
          setStatus({ type: 'error', msg: 'Customer required for partial credit.' });
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }
        if (amountPaid > 0) {
          payments = [{ amount: amountPaid, method: paymentMethod as 'CASH' | 'UPI' }];
        }
      }

      // Convert timestamp to ISO UTC string if specified
      let isoTimestamp: string | null = null;
      if (invoiceDateStr.trim()) {
        isoTimestamp = new Date(invoiceDateStr).toISOString();
      }

      // Client-Side Zod Schema Validation Tier
      const payloadToValidate = {
        customer_id: finalCustomerId || null,
        created_at: isoTimestamp,
        subtotal: round2(subtotal),
        discount_amount: round2(discountAmount),
        round_off: round2(roundOffAmount),
        gst_applied: gstApplied,
        cgst_amount: round2(cgstAmount),
        sgst_amount: round2(sgstAmount),
        final_total: round2(finalTotal),
        items: validCart.map(i => ({
          variant_id: i.variant_id,
          sets_quantity: i.sets_quantity,
          loose_quantity: i.loose_quantity,
          selling_price_snapshot: round2(i.price)
        })),
        payments: payments.map(p => ({
          amount: round2(p.amount),
          method: p.method
        }))
      };

      const validation = editInvoiceId
        ? updateFullInvoiceSchema.safeParse({ ...payloadToValidate, invoice_id: editInvoiceId })
        : checkoutSchema.safeParse(payloadToValidate);

      if (!validation.success) {
        const errorMsg = validation.error.issues.map((i) => i.message).join('. ');
        setStatus({ type: 'error', msg: errorMsg });
        setLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      if (editInvoiceId) {
        // EXECUTE FULL INVOICE UPDATE DIRECTLY VIA CLIENT
        const { data: editData, error: editErr } = await supabase.rpc('update_full_invoice', {
          p_invoice_id: editInvoiceId,
          p_customer_id: finalCustomerId || null,
          p_created_at: isoTimestamp,
          p_subtotal: round2(subtotal),
          p_discount_amount: round2(discountAmount),
          p_round_off: round2(roundOffAmount),
          p_gst_applied: gstApplied,
          p_cgst_amount: round2(cgstAmount),
          p_sgst_amount: round2(sgstAmount),
          p_final_total: round2(finalTotal),
          p_items: validCart.map(i => ({
            variant_id: i.variant_id,
            sets_quantity: i.sets_quantity,
            loose_quantity: i.loose_quantity,
            selling_price: round2(i.price)
          })),
          p_payments: payments.map(p => ({
            amount: round2(p.amount),
            method: p.method
          }))
        });

        if (editErr) {
          setStatus({ type: 'error', msg: formatHumanReadableError(editErr.message) });
        } else if (!editData || !editData.invoice_id) {
          setStatus({ type: 'error', msg: 'Failed to update invoice in database.' });
        } else {
          const totalPaidAmt = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
          const pendingDueAmt = Math.max(0, finalTotal - totalPaidAmt);
          setLastCheckoutSummary({
            customerName: customerName || undefined,
            customerPhone: customerPhone || undefined,
            totalAmount: finalTotal,
            paidAmount: totalPaidAmt,
            dueAmount: pendingDueAmt,
            itemCount: validCart.length,
            invoiceNumber: editInvoiceNumber || undefined,
            invoiceId: editInvoiceId || undefined
          });

          setIsMobileCheckoutOpen(false);
          setStatus({ 
            type: 'success', 
            msg: `Invoice #${editInvoiceNumber} successfully updated and stock synchronized!`,
            invoiceId: editInvoiceId,
            invoiceNumber: editInvoiceNumber || undefined
          });
          resetFormState();
          router.refresh();
        }
      } else {
        // EXECUTE NEW CHECKOUT DIRECTLY VIA CLIENT
        const { data: checkData, error: checkErr } = await supabase.rpc('process_checkout', {
          p_customer_id: finalCustomerId || null,
          p_subtotal: round2(subtotal),
          p_discount_amount: round2(discountAmount),
          p_round_off: round2(roundOffAmount),
          p_gst_applied: gstApplied,
          p_cgst_amount: round2(cgstAmount),
          p_sgst_amount: round2(sgstAmount),
          p_final_total: round2(finalTotal),
          p_items: validCart.map(i => ({
            variant_id: i.variant_id,
            sets_quantity: i.sets_quantity,
            loose_quantity: i.loose_quantity,
            selling_price: round2(i.price)
          })),
          p_payments: payments.map(p => ({
            amount: round2(p.amount),
            method: p.method
          })),
          p_created_at: isoTimestamp
        });

        if (checkErr) {
          setStatus({ type: 'error', msg: formatHumanReadableError(checkErr.message) });
        } else if (!checkData || !checkData.invoice_id) {
          setStatus({ type: 'error', msg: 'Failed to create invoice in database.' });
        } else {
          const totalPaidAmt = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
          const pendingDueAmt = Math.max(0, finalTotal - totalPaidAmt);
          setLastCheckoutSummary({
            customerName: customerName || undefined,
            customerPhone: customerPhone || undefined,
            totalAmount: finalTotal,
            paidAmount: totalPaidAmt,
            dueAmount: pendingDueAmt,
            itemCount: validCart.length,
            invoiceNumber: checkData.invoice_number || undefined,
            invoiceId: checkData.invoice_id || undefined
          });

          setIsMobileCheckoutOpen(false);
          setStatus({ 
            type: 'success', 
            msg: `Invoice #${checkData.invoice_number} created successfully!`,
            invoiceId: checkData.invoice_id,
            invoiceNumber: checkData.invoice_number || undefined
          });
          resetFormState();
          router.refresh();
        }
      }
    } catch (err: any) {
      const rawMsg = String(err?.message || '');
      setStatus({ type: 'error', msg: formatHumanReadableError(rawMsg || 'An unexpected error occurred during checkout') });
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-canvas overflow-hidden font-sans">
      {/* EDITING INVOICE PROMINENT TOP BANNER */}
      {editInvoiceId && (
        <div className="bg-amber-600 text-white px-4 py-2.5 flex items-center justify-between shadow-md shrink-0 border-b border-amber-700 animate-in fade-in">
          <div className="flex items-center gap-3">
            <span className="p-1.5 bg-amber-700/80 rounded-lg">
              <Edit3 className="w-5 h-5 text-amber-200" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm tracking-wide font-mono">EDITING INVOICE #{editInvoiceNumber}</span>
                <span className="text-[11px] font-bold bg-amber-800 text-amber-100 px-2 py-0.5 rounded-full border border-amber-500">
                  Total Editability Active
                </span>
              </div>
              <p className="text-[11px] text-amber-100 mt-0.5">
                Modifying items, quantities, discounts, customer, or timestamp will atomically recalculate and adjust warehouse inventory.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              resetFormState();
              router.push('/invoices');
            }}
            className="bg-white text-amber-900 px-3.5 py-1.5 text-xs font-bold rounded-lg hover:bg-amber-50 transition-colors shadow-xs flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Cancel & Return to Invoices
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-hidden relative">
        {/* LEFT SECTION: Search & Cart Table */}
        <div className="flex-1 flex flex-col min-w-0 lg:border-r border-border h-full overflow-hidden">
          {/* Top Search Bar with Camera Scanner Button */}
          <div className="p-4 sm:p-6 bg-surface border-b border-border flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-muted" />
              <input 
                ref={searchInputRef}
                type="text"
                disabled={loading || isInitialLoadingInvoice}
                placeholder="Search product name or scan barcode..."
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="w-full pl-12 pr-4 py-3 bg-row-alt border border-border rounded-[10px] text-[15px] focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
              {isSearching && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-ink-muted font-medium">
                  Searching...
                </div>
              )}
              {/* Live Grouped Product Search Dropdown */}
              {groupedSearchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-surface border border-border rounded-[14px] shadow-xl max-h-80 overflow-y-auto z-50 divide-y divide-border">
                  {groupedSearchResults.map(group => {
                    const isOutOfStock = group.total_stock_quantity <= 0;
                    const priceRange = group.min_price === group.max_price
                      ? formatINR(group.min_price)
                      : `${formatINR(group.min_price)} – ${formatINR(group.max_price)}`;

                    return (
                      <div 
                        key={group.product_id}
                        onClick={() => {
                          setSelectedProductGroup(group);
                        }}
                        className="p-3.5 hover:bg-row-alt cursor-pointer flex justify-between items-center transition-colors group"
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="font-bold text-[14px] sm:text-[15px] text-ink-primary flex items-center gap-2 flex-wrap">
                            <span className="truncate">{group.product_name}</span>
                            {isOutOfStock && (
                              <span className="text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/40 px-1.5 py-0.5 rounded">
                                Out of Stock
                              </span>
                            )}
                          </div>
                          <div className="text-[12px] text-ink-muted flex items-center gap-2 mt-0.5">
                            <span className="font-semibold text-accent">{group.variants.length} variant{group.variants.length !== 1 ? 's' : ''}</span>
                            <span>•</span>
                            <span>{group.pieces_per_set} pcs/set</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="font-bold font-mono text-[14px] sm:text-[15px] text-accent">
                            {priceRange}
                          </div>
                          <div className="text-[11px] font-mono text-ink-muted mt-0.5">
                            {formatDualQuantity(group.total_stock_quantity, group.pieces_per_set)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Camera Scanner Button */}
            <button
              type="button"
              onClick={() => { setIsCameraOpen(true); setCameraStatusMessage(null); }}
              disabled={loading || isInitialLoadingInvoice}
              className="px-4 py-3 bg-accent hover:bg-accent-hover text-white rounded-[10px] font-bold text-xs sm:text-sm flex items-center gap-2 transition shadow-xs disabled:opacity-50 shrink-0"
              title="Scan Barcodes with Mobile Camera"
            >
              <Camera className="w-5 h-5" />
              <span className="hidden sm:inline">Camera Scan</span>
            </button>
          </div>

          {/* Cart Header & Clear Cart Action */}
          <div className="px-6 py-3 border-b border-border bg-surface flex justify-between items-center">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">Cart Items ({cart.length})</span>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => setIsClearCartModalOpen(true)}
                disabled={loading || isInitialLoadingInvoice}
                className="text-xs font-bold text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
              >
                Clear Cart
              </button>
            )}
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3">
            {isInitialLoadingInvoice ? (
              <div className="h-full flex flex-col items-center justify-center text-ink-muted space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
                <p className="text-sm font-medium">Loading invoice details into POS cart...</p>
              </div>
            ) : cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-ink-muted space-y-3">
                <Search className="w-12 h-12 opacity-20" />
                <p className="text-[16px] font-medium">Cart is empty</p>
                <p className="text-[13px]">Scan barcodes or search products to begin checkout</p>
              </div>
            ) : (
              <div className="space-y-3">
                {cart.map((item) => {
                  const totalPcs = (item.sets_quantity * item.pieces_per_set) + item.loose_quantity;
                  const itemTotal = totalPcs * item.price;
                  const isOverSets = item.stock_sets !== undefined && item.sets_quantity > item.stock_sets;
                  const isOverStock = item.stock_quantity !== undefined && totalPcs > item.stock_quantity;
                  return (
                    <div key={item.variant_id} className="bg-surface border border-border rounded-[16px] p-3.5 sm:p-4 space-y-3 shadow-xs hover:border-ink-muted transition-colors">
                      {/* Row 1: Title & Delete */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-[15px] sm:text-[16px] text-ink-primary truncate">{item.name}</div>
                          <div className="text-[12px] text-ink-muted mt-0.5">
                            {item.pieces_per_set} pcs/set • {totalPcs} pcs total
                          </div>
                        </div>
                        <button 
                          onClick={() => handleRemoveItem(item.variant_id)}
                          className="p-1.5 text-ink-muted hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors shrink-0"
                          title="Remove line item"
                        >
                          <Trash2 className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                        </button>
                      </div>

                      {/* Row 2: Unit Price & Line Total */}
                      <div className="flex items-center justify-between bg-row-alt px-3 py-2 rounded-[10px]">
                        <div className="text-[13px] font-mono font-semibold text-accent">
                          ₹{item.price.toFixed(2)} <span className="text-[10px] text-ink-muted uppercase">/ pc</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Total:</span>
                          <span className="font-mono font-black text-[16px] sm:text-[18px] text-ink-primary">
                            ₹{itemTotal.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      
                      {/* Warnings */}
                      {(isOverSets || isOverStock) && (
                        <div className="flex flex-wrap gap-1.5">
                          {isOverSets && (
                            <div className="text-[11px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200 inline-flex items-center">
                              ⚠️ Exceeds sets ({item.stock_sets} on hand)
                            </div>
                          )}
                          {isOverStock && !isOverSets && (
                            <div className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 inline-flex items-center">
                              ⚠️ Exceeds stock ({item.stock_quantity} on hand)
                            </div>
                          )}
                        </div>
                      )}

                      {/* Row 3: Steppers (Full Width Grid) */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        {/* Sets Stepper */}
                        <div className="bg-canvas border border-border rounded-[10px] p-2 flex flex-col items-center">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">Sets</span>
                          <div className="flex items-center justify-between w-full">
                            <button 
                              type="button"
                              onClick={() => handleUpdateItem(item.variant_id, 'sets_quantity', item.sets_quantity - 1)}
                              className="w-8 h-8 sm:w-9 sm:h-9 bg-surface hover:bg-row-alt border border-border rounded-[7px] flex items-center justify-center text-ink-primary transition-colors active:scale-95 shadow-xs"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <input 
                              type="number"
                              min="0"
                              value={item.sets_quantity}
                              onFocus={e => e.target.select()}
                              onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                              onChange={e => handleUpdateItem(item.variant_id, 'sets_quantity', parseInt(e.target.value) || 0)}
                              className="w-12 text-center py-1 bg-transparent font-mono font-bold text-[15px] focus:outline-none"
                            />
                            <button 
                              type="button"
                              onClick={() => handleUpdateItem(item.variant_id, 'sets_quantity', item.sets_quantity + 1)}
                              className="w-8 h-8 sm:w-9 sm:h-9 bg-surface hover:bg-row-alt border border-border rounded-[7px] flex items-center justify-center text-ink-primary transition-colors active:scale-95 shadow-xs"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Loose Stepper */}
                        <div className="bg-canvas border border-border rounded-[10px] p-2 flex flex-col items-center">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">Loose (Pcs)</span>
                          <div className="flex items-center justify-between w-full">
                            <button 
                              type="button"
                              onClick={() => handleUpdateItem(item.variant_id, 'loose_quantity', item.loose_quantity - 1)}
                              className="w-8 h-8 sm:w-9 sm:h-9 bg-surface hover:bg-row-alt border border-border rounded-[7px] flex items-center justify-center text-ink-primary transition-colors active:scale-95 shadow-xs"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <input 
                              type="number"
                              min="0"
                              value={item.loose_quantity}
                              onFocus={e => e.target.select()}
                              onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                              onChange={e => handleUpdateItem(item.variant_id, 'loose_quantity', parseInt(e.target.value) || 0)}
                              className="w-12 text-center py-1 bg-transparent font-mono font-bold text-[15px] focus:outline-none"
                            />
                            <button 
                              type="button"
                              onClick={() => handleUpdateItem(item.variant_id, 'loose_quantity', item.loose_quantity + 1)}
                              className="w-8 h-8 sm:w-9 sm:h-9 bg-surface hover:bg-row-alt border border-border rounded-[7px] flex items-center justify-center text-ink-primary transition-colors active:scale-95 shadow-xs"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          
          {/* MOBILE ONLY: Sticky Checkout Bar (Snug fit directly above mobile navigation bar) */}
          <div className="lg:hidden shrink-0 p-3.5 pb-20 bg-surface border-t border-border shadow-[0_-4px_16px_rgba(0,0,0,0.05)] z-40">
            <button
              onClick={() => setIsMobileCheckoutOpen(true)}
              disabled={cart.length === 0}
              className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-bold py-3.5 rounded-[12px] flex items-center justify-between px-5 transition-transform active:scale-[0.98] shadow-sm min-h-[48px]"
            >
              <span className="text-[15px] font-bold">Proceed to Checkout</span>
              <span className="font-mono text-[16px] font-extrabold">₹{finalTotal.toFixed(2)}</span>
            </button>
          </div>
        </div>

        {/* RIGHT SECTION: Customer, Totals & Checkout Panel */}
        <div className={`
          fixed inset-0 z-[110] bg-surface flex flex-col transform transition-transform duration-300 ease-out lg:relative lg:inset-auto lg:z-auto lg:w-[420px] lg:shrink-0 lg:translate-y-0 lg:border-l lg:border-border
          ${isMobileCheckoutOpen ? 'translate-y-0' : 'translate-y-full'}
        `}>
          {/* MOBILE ONLY: Close Sheet Header */}
          <div className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-row-alt">
            <h2 className="text-[18px] font-bold text-ink-primary">Checkout</h2>
            <button 
              onClick={() => setIsMobileCheckoutOpen(false)}
              className="p-2 bg-surface border border-border rounded-full shadow-sm"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div className="p-6 border-b border-border flex items-center justify-between">
            <h2 className="text-[18px] font-bold text-ink-primary">
              {editInvoiceId ? 'Edit Invoice Details' : 'Sale Summary'}
            </h2>
            {editInvoiceId && (
              <span className="text-xs font-mono font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded border border-amber-300">
                #{editInvoiceNumber}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col justify-between">
            <div className="p-6 space-y-6">
              {/* Checkout Error Toast / Banner */}
              {status && status.type === 'error' && (
                <div className="p-4 rounded-xl flex flex-col gap-2 border bg-red-50 text-red-700 border-red-200 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 flex-shrink-0" />
                      <span className="text-xs font-bold">{status.msg}</span>
                    </div>
                    <button onClick={() => setStatus(null)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Customer Details */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[13px] font-bold text-ink-primary flex items-center gap-1.5">
                    <User className="w-4 h-4 text-ink-muted" />
                    Customer
                  </label>
                  {resolvedCustomerId && (
                    <span className="text-[11px] font-bold bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-200">
                      Linked Account
                    </span>
                  )}
                </div>

                {/* Customer Search / Name & Phone Inputs */}
                <div className="relative space-y-2">
                  <input 
                    type="text" 
                    placeholder="Customer Name (Optional for cash)" 
                    value={customerName} 
                    disabled={loading || isInitialLoadingInvoice}
                    onChange={e => {
                      setCustomerName(e.target.value);
                      setResolvedCustomerId(null);
                      setCustomerCredit(0);
                      if (paymentMethod === 'STORE_CREDIT') setPaymentMethod('CASH');
                      if (paymentMethod === 'SPLIT') {
                        setSplitCredit('');
                        setSplitSaved(false);
                      }
                      setShowCustomerDropdown(true);
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    className="w-full p-2.5 bg-surface border border-border rounded-[8px] text-[14px] focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />

                  <input 
                    type="text" 
                    placeholder="Phone (Optional for cash)" 
                    value={customerPhone} 
                    disabled={loading || isInitialLoadingInvoice}
                    onChange={e => {
                      setCustomerPhone(e.target.value);
                      setShowCustomerDropdown(true);
                      const trimmed = e.target.value.trim();
                      if (!trimmed) {
                        setResolvedCustomerId(null);
                        setCustomerCredit(0);
                        if (paymentMethod === 'STORE_CREDIT' || paymentMethod === 'SPLIT') {
                          setPaymentMethod('CASH');
                          setSplitCredit('');
                          setSplitSaved(false);
                        }
                        return;
                      }
                      const matched = customerSuggestions.find(c => c.phone && c.phone.trim() === trimmed);
                      if (matched) {
                        setResolvedCustomerId(matched.id);
                        setCustomerName(matched.name);
                        setCustomerCredit(Number(matched.credit_balance || 0));
                      } else {
                        setResolvedCustomerId(null);
                        setCustomerCredit(0);
                        if (paymentMethod === 'STORE_CREDIT') setPaymentMethod('CASH');
                        if (paymentMethod === 'SPLIT') {
                          setSplitCredit('');
                          setSplitSaved(false);
                        }
                      }
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    className="w-full p-2.5 bg-surface border border-border rounded-[8px] text-[14px] focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />

                  {showCustomerDropdown && customerSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-[8px] shadow-lg max-h-48 overflow-y-auto z-50 divide-y divide-border">
                      {customerSuggestions.map(cust => (
                        <div 
                          key={cust.id} 
                          onClick={() => selectCustomer(cust)}
                          className="p-2.5 hover:bg-row-alt cursor-pointer flex justify-between items-center transition-colors"
                        >
                          <div>
                            <p className="font-bold text-[13px] text-ink-primary">{cust.name}</p>
                            <p className="text-[11px] text-ink-muted">{cust.phone || 'No phone'}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {Number(cust.credit_balance || 0) > 0 && (
                              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                                Wallet: ₹{Number(cust.credit_balance).toFixed(2)}
                              </span>
                            )}
                            {Number(cust.pending_dues || 0) > 0 && (
                              <span className="text-[11px] font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-md">
                                Dues: ₹{Number(cust.pending_dues).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {effectiveAvailableCredit > 0 && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-emerald-700" />
                      <div>
                        <p className="text-xs font-bold text-emerald-900">Available Store Credit</p>
                        <p className="text-[11px] text-emerald-700 font-mono">₹{effectiveAvailableCredit.toFixed(2)}</p>
                      </div>
                    </div>
                    {paymentMethod !== 'STORE_CREDIT' && paymentMethod !== 'SPLIT' && (
                      <button
                        type="button"
                        disabled={loading || isInitialLoadingInvoice}
                        onClick={() => setPaymentMethod('STORE_CREDIT')}
                        className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                      >
                        Use Credit
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* INVOICE DATE & TIME (Backdating & Retroactive Timestamp Selector) */}
              <div className="space-y-2 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-bold text-ink-primary flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-ink-muted" />
                    Invoice Date & Time
                  </label>
                  {invoiceDateStr && (
                    <button
                      type="button"
                      disabled={loading || isInitialLoadingInvoice}
                      onClick={() => setInvoiceDateStr('')}
                      className="text-[11px] font-bold text-accent hover:underline"
                    >
                      Reset to Real-time (Now)
                    </button>
                  )}
                </div>
                <input 
                  type="datetime-local"
                  value={invoiceDateStr}
                  disabled={loading || isInitialLoadingInvoice}
                  onChange={e => setInvoiceDateStr(e.target.value)}
                  className="w-full p-2.5 bg-surface border border-border rounded-[8px] text-[13px] focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 font-mono"
                />
                {invoiceDateStr ? (
                  <p className="text-[11px] text-amber-700 font-medium bg-amber-50 p-2 rounded-lg border border-amber-200">
                    ⚡ {editInvoiceId ? 'Retroactive Timestamp:' : 'Backdating:'} This invoice will be recorded at {new Date(invoiceDateStr).toLocaleString('en-IN')}.
                  </p>
                ) : (
                  <p className="text-[11px] text-ink-muted">
                    Default: Real-time current date & time ({new Date().toLocaleDateString('en-IN')}).
                  </p>
                )}
              </div>

              {/* Discount & Round Off Panel */}
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-bold text-ink-primary">Discount & Round Off</label>
                  <div className="flex gap-1">
                    {[
                      { type: 'percent' as const, val: '5', label: '5%' },
                      { type: 'percent' as const, val: '10', label: '10%' },
                      { type: 'amount' as const, val: '50', label: '₹50' },
                      { type: 'amount' as const, val: '100', label: '₹100' },
                    ].map(preset => (
                      <button
                        key={preset.label}
                        type="button"
                        disabled={loading || isInitialLoadingInvoice}
                        onClick={() => { setDiscountType(preset.type); setDiscountValue(preset.val); }}
                        className="px-1.5 py-0.5 bg-row-alt hover:bg-gray-200 text-ink-primary text-[10px] font-bold rounded border border-border disabled:opacity-50"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex bg-row-alt rounded-[8px] border border-border p-1">
                      <button disabled={loading || isInitialLoadingInvoice} onClick={() => setDiscountType('amount')} className={`px-4 py-1.5 rounded-[6px] text-[14px] font-medium transition-colors ${discountType === 'amount' ? 'bg-surface shadow-sm' : 'text-ink-muted'}`}>₹</button>
                      <button disabled={loading || isInitialLoadingInvoice} onClick={() => setDiscountType('percent')} className={`px-4 py-1.5 rounded-[6px] text-[14px] font-medium transition-colors ${discountType === 'percent' ? 'bg-surface shadow-sm' : 'text-ink-muted'}`}>%</button>
                    </div>
                    <input 
                      type="number" 
                      min="0"
                      disabled={loading || isInitialLoadingInvoice}
                      placeholder={discountType === 'percent' ? "0%" : "0.00"}
                      value={discountValue} 
                      onFocus={e => e.target.select()}
                      onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                      onChange={e => {
                        const val = e.target.value;
                        if (discountType === 'percent') {
                          const num = parseFloat(val);
                          if (num > 100) return;
                        }
                        setDiscountValue(val);
                      }}
                      className="flex-1 p-2 bg-surface border border-border rounded-[8px] text-[14px] font-mono focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    />
                  </div>
                  {discountAmount > subtotal && subtotal > 0 && (
                    <span className="text-[11px] font-bold text-red-600">
                      Discount cannot exceed subtotal (Max: ₹{subtotal.toFixed(2)})
                    </span>
                  )}
                </div>

                {/* Round Off Input */}
                <div className="flex items-center gap-2 pt-2">
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[11px] font-bold text-ink-muted">Round Off (₹-50 to ₹+50)</label>
                      {roundOffAmount !== 0 && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${roundOffAmount > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
                          {roundOffAmount > 0 ? `+₹${roundOffAmount.toFixed(2)}` : `-₹${Math.abs(roundOffAmount).toFixed(2)}`}
                        </span>
                      )}
                    </div>
                    <input 
                      type="number" 
                      step="0.01"
                      min="-50"
                      max="50"
                      disabled={loading || isInitialLoadingInvoice}
                      placeholder="0.00 (e.g. -0.40 or +0.60)"
                      value={roundOff} 
                      onFocus={e => e.target.select()}
                      onChange={e => setRoundOff(e.target.value)}
                      className="w-full p-2 bg-surface border border-border rounded-[8px] text-[13px] font-mono focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    />
                  </div>
                </div>

                {/* GST Toggle */}
                <div className="flex items-center justify-between pt-2">
                  <label className="text-[13px] font-medium text-ink-primary flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      disabled={loading || isInitialLoadingInvoice}
                      checked={gstApplied} 
                      onChange={e => setGstApplied(e.target.checked)}
                      className="w-4 h-4 rounded border-border text-accent focus:ring-accent disabled:opacity-50"
                    />
                    Apply 5% GST (2.5% CGST + 2.5% SGST)
                  </label>
                  {gstApplied && (
                    <span className="text-[12px] font-mono font-bold text-ink-primary">
                      +₹{(cgstAmount + sgstAmount).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              {/* Payment Methods */}
              <div className="space-y-3 pt-4 border-t border-border">
                <label className="text-[13px] font-bold text-ink-primary">Payment method</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['CASH', 'UPI', 'CREDIT', 'SPLIT', 'STORE_CREDIT'] as const).map(m => {
                    if (m === 'STORE_CREDIT' && effectiveAvailableCredit <= 0) return null;
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={loading || isInitialLoadingInvoice}
                        onClick={() => {
                          setPaymentMethod(m);
                          if (m === 'SPLIT') {
                            setIsSplitModalOpen(true);
                          }
                        }}
                        className={`p-2.5 rounded-[8px] border text-[13px] font-bold transition-all flex flex-col items-center gap-1 disabled:opacity-50 ${
                          paymentMethod === m 
                            ? m === 'STORE_CREDIT' 
                              ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-sm'
                              : 'border-accent bg-red-50 text-accent shadow-sm'
                            : 'border-border bg-surface text-ink-muted hover:border-gray-300'
                        }`}
                      >
                        {m === 'CASH' && <IndianRupee className="w-4 h-4" />}
                        {m === 'UPI' && <CreditCard className="w-4 h-4" />}
                        {m === 'CREDIT' && <User className="w-4 h-4" />}
                        {m === 'SPLIT' && <Percent className="w-4 h-4" />}
                        {m === 'STORE_CREDIT' && <Wallet className="w-4 h-4 text-emerald-700" />}
                        <span>{m === 'STORE_CREDIT' ? 'Store Credit' : m}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Split Details Display */}
              {paymentMethod === 'SPLIT' && (
                <div className="bg-surface border border-border rounded-[8px] p-4 text-[13px]">
                  <div className="flex justify-between mb-1"><span>Cash</span><span>₹{parseFloat(splitCash||'0').toFixed(2)}</span></div>
                  <div className="flex justify-between mb-1"><span>UPI</span><span>₹{parseFloat(splitUpi||'0').toFixed(2)}</span></div>
                  {parseFloat(splitCredit || '0') > 0 && (
                    <div className="flex justify-between mb-1 text-emerald-700 font-medium"><span>Store Credit</span><span>₹{parseFloat(splitCredit||'0').toFixed(2)}</span></div>
                  )}
                  <div className="flex justify-between font-bold mb-2"><span>Bill total</span><span>₹{finalTotal.toFixed(2)}</span></div>
                  {splitSaved ? (
                    <p className="text-green-600 font-medium mb-3">Split balances the bill.</p>
                  ) : (
                    <p className="text-red-600 font-medium mb-3">Split must cover the full bill. Partial dues are not allowed with Split.</p>
                  )}
                  <button onClick={() => setIsSplitModalOpen(true)} className="w-full py-2 border border-accent text-accent rounded-[8px] font-bold">Edit split amounts</button>
                </div>
              )}

              {/* Amount Paid for Single Methods */}
              {(paymentMethod === 'CASH' || paymentMethod === 'UPI') && (() => {
                const enteredPaid = parseFloat(amountPaidStr || '0');
                const isOverpaid = amountPaidStr.trim() !== '' && enteredPaid > finalTotal;

                return (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-[13px] font-bold text-ink-primary">Amount paid</label>
                      {isOverpaid && (
                        <span className="text-[11px] font-bold text-red-600">
                          Max ₹{finalTotal.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <input 
                      type="number" 
                      min="0"
                      disabled={loading || isInitialLoadingInvoice}
                      placeholder={finalTotal.toFixed(2)} 
                      value={amountPaidStr} 
                      onFocus={e => e.target.select()}
                      onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                      onChange={e => setAmountPaidStr(e.target.value)}
                      className={`w-full p-2.5 bg-surface border rounded-[8px] text-[14px] font-mono focus:outline-none ${
                        isOverpaid 
                          ? 'border-red-500 bg-red-50/40 text-red-700 focus:ring-1 focus:ring-red-500' 
                          : 'border-border focus:ring-1 focus:ring-accent'
                      }`}
                    />
                    {isOverpaid && (
                      <p className="text-xs text-red-600 font-medium">
                        Overpayment is not allowed. Amount cannot exceed invoice total of ₹{finalTotal.toFixed(2)}.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Bottom Totals & Submit */}
            <div className="p-5 bg-row-alt/50 border-t border-border space-y-3">
              <div className="flex justify-between text-[14px] font-medium text-ink-primary">
                <span>Subtotal</span>
                <span className="font-mono">₹{subtotal.toFixed(2)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-[14px] font-medium text-accent">
                  <span>Discount</span>
                  <span className="font-mono">-₹{discountAmount.toFixed(2)}</span>
                </div>
              )}
              {roundOffAmount !== 0 && (
                <div className="flex justify-between text-[14px] font-medium text-ink-muted">
                  <span>Round Off</span>
                  <span className="font-mono">{roundOffAmount > 0 ? `+₹${roundOffAmount.toFixed(2)}` : `-₹${Math.abs(roundOffAmount).toFixed(2)}`}</span>
                </div>
              )}
              {gstApplied && (
                <>
                  <div className="flex justify-between text-[14px] font-medium text-ink-muted">
                    <span>CGST (2.5%)</span>
                    <span className="font-mono">₹{cgstAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[14px] font-medium text-ink-muted">
                    <span>SGST (2.5%)</span>
                    <span className="font-mono">₹{sgstAmount.toFixed(2)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-[16px] font-bold text-ink-primary pt-2 border-t border-border">
                <span>Total to Pay</span>
                <span className="font-mono">₹{finalTotal.toFixed(2)}</span>
              </div>
              <button 
                onClick={handleCheckoutOrUpdate}
                disabled={
                  loading || 
                  isInitialLoadingInvoice ||
                  cart.length === 0 || 
                  ((paymentMethod === 'CASH' || paymentMethod === 'UPI') && parseFloat(amountPaidStr || '0') > finalTotal) ||
                  (paymentMethod === 'STORE_CREDIT' && effectiveAvailableCredit < finalTotal)
                }
                className={`w-full py-3.5 rounded-[10px] font-bold text-[15px] transition-colors disabled:opacity-50 shadow-sm flex items-center justify-center gap-2 ${
                  editInvoiceId 
                    ? 'bg-amber-600 hover:bg-amber-700 text-white' 
                    : 'bg-accent hover:bg-[#1D4ED8] text-white'
                }`}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : editInvoiceId ? (
                  <>
                    <Edit3 className="w-4 h-4" />
                    <span>Save Invoice Changes (₹{finalTotal.toFixed(2)})</span>
                  </>
                ) : (
                  <span>Complete Checkout (₹{finalTotal.toFixed(2)})</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Split Payment Modal */}
      {isSplitModalOpen && (
        <div 
          onClick={(e) => { if (e.target === e.currentTarget) { setIsSplitModalOpen(false); setSplitError(null); } }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto cursor-pointer animate-in fade-in duration-150"
        >
          <div className="bg-surface border border-border rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 cursor-default">
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <h2 className="text-base font-bold text-ink-primary">Split Payment</h2>
              <button 
                onClick={() => { setIsSplitModalOpen(false); setSplitError(null); }} 
                className="p-1.5 text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-full transition"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {splitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700">
                {splitError}
              </div>
            )}
            <div className="space-y-3.5">
              {effectiveAvailableCredit > 0 && (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                      <Wallet className="w-3.5 h-3.5 text-emerald-700" />
                      Store Credit (₹)
                    </label>
                    <span className="text-[11px] font-medium text-emerald-700">Max ₹{effectiveAvailableCredit.toFixed(2)}</span>
                  </div>
                  <input 
                    type="number" 
                    min="0"
                    step="0.01"
                    value={splitCredit} 
                    onFocus={e => e.target.select()}
                    onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                    onChange={e => { setSplitCredit(e.target.value); setSplitSaved(false); setSplitError(null); }}
                    placeholder={`0.00 (Max ${effectiveAvailableCredit.toFixed(2)})`} 
                    max={effectiveAvailableCredit}
                    className="w-full p-2.5 bg-emerald-50/50 border border-emerald-200 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 text-emerald-900"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Cash Amount (₹)</label>
                <input 
                  type="number" 
                  min="0"
                  step="0.01"
                  value={splitCash} 
                  onFocus={e => e.target.select()}
                  onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                  onChange={e => { setSplitCash(e.target.value); setSplitSaved(false); setSplitError(null); }}
                  placeholder="0.00" 
                  className="w-full p-2.5 bg-surface border border-border rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent text-ink-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">UPI Amount (₹)</label>
                <input 
                  type="number" 
                  min="0"
                  step="0.01"
                  value={splitUpi} 
                  onFocus={e => e.target.select()}
                  onKeyDown={e => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                  onChange={e => { setSplitUpi(e.target.value); setSplitSaved(false); setSplitError(null); }}
                  placeholder="0.00" 
                  className="w-full p-2.5 bg-surface border border-border rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent text-ink-primary"
                />
              </div>
            </div>
            <div className="pt-2 border-t border-border flex justify-between items-center text-xs">
              <span className="font-semibold text-ink-muted">Total Entered / Required</span>
              <span className="font-mono font-bold text-sm">
                ₹{((parseFloat(splitCash||'0')) + (parseFloat(splitUpi||'0')) + (parseFloat(splitCredit||'0'))).toFixed(2)} / ₹{finalTotal.toFixed(2)}
              </span>
            </div>
            <button 
              onClick={handleSaveSplit}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl font-bold text-xs transition shadow-xs"
            >
              Save Split
            </button>
          </div>
        </div>
      )}

      {/* Styled Clear Cart Confirmation Modal */}
      {isClearCartModalOpen && (
        <div 
          onClick={(e) => { if (e.target === e.currentTarget) setIsClearCartModalOpen(false); }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto cursor-pointer animate-in fade-in duration-150"
        >
          <div className="bg-surface border border-border rounded-2xl max-w-sm w-full p-5 sm:p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 cursor-default">
            <div className="flex items-center gap-3 text-red-600">
              <Trash2 className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-ink-primary">Clear Entire Cart?</h3>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              This will remove all <strong className="text-ink-primary">{cart.length} item(s)</strong> (Value: <strong className="text-ink-primary">₹{finalTotal.toFixed(2)}</strong>) from the active checkout screen.
            </p>
            <div className="flex gap-2.5 justify-end pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsClearCartModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition"
              >
                Keep Cart
              </button>
              <button
                type="button"
                onClick={() => {
                  setCart([]);
                  setSplitSaved(false);
                  setIsClearCartModalOpen(false);
                }}
                className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-xs transition"
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Camera Scanner Modal */}
      {isCameraOpen && (
        <CameraScanner
          continuous={true}
          statusMessage={cameraStatusMessage}
          onScan={handleCameraScan}
          onClose={() => {
            setIsCameraOpen(false);
            setCameraStatusMessage(null);
          }}
        />
      )}

      {/* Centered Success Toast / Celebration Modal */}
      {status && status.type === 'success' && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150 cursor-pointer"
          onClick={() => setStatus(null)}
        >
          <div 
            className="bg-surface rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-border text-center space-y-4 animate-in zoom-in-95 duration-150 cursor-default relative"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setStatus(null)}
              className="absolute right-2 top-2 text-ink-muted hover:text-ink-primary min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-row-alt transition"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-xs border border-emerald-200">
              <CheckCircle className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-ink-primary">Sale Completed!</h3>
              {status.invoiceNumber && (
                <p className="text-xs font-mono font-bold text-accent mt-0.5">
                  {status.invoiceNumber}
                </p>
              )}
              <p className="text-xs text-ink-muted mt-1">
                {status.msg}
              </p>
            </div>

            <div className="space-y-2 pt-2">
              {/* WhatsApp Share Button */}
              <button
                type="button"
                onClick={handleSendWhatsAppReceipt}
                className="w-full py-2.5 px-4 bg-[#25D366] hover:bg-[#20ba59] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs min-h-[42px] cursor-pointer"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Send on WhatsApp</span>
              </button>

              {status.invoiceId && (
                <button
                  onClick={() => handleDownloadPdf(status.invoiceId!)}
                  disabled={downloadingPdf}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs min-h-[42px]"
                >
                  {downloadingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span>Download / Print Receipt</span>
                </button>
              )}

              {status.invoiceId && (
                <button
                  onClick={() => {
                    const invId = status.invoiceId;
                    setStatus(null);
                    router.push(`/invoices/${invId}`);
                  }}
                  className="w-full py-2.5 px-4 bg-surface border border-border hover:bg-row-alt text-ink-primary rounded-xl text-xs font-bold transition shadow-2xs min-h-[42px]"
                >
                  View Invoice Details
                </button>
              )}

              <button
                onClick={() => setStatus(null)}
                className="w-full py-2.5 px-4 bg-row-alt hover:bg-border text-ink-muted hover:text-ink-primary rounded-xl text-xs font-bold transition min-h-[42px]"
              >
                New Sale (Done)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Variant Selection Modal */}
      <ProductVariantSelectModal
        isOpen={Boolean(selectedProductGroup)}
        onClose={() => setSelectedProductGroup(null)}
        productGroup={selectedProductGroup}
        onAddItems={handleBatchAddVariantsToCart}
      />

      {/* WhatsApp Prompt Modal */}
      <WhatsAppPromptModal
        isOpen={whatsappModal.isOpen}
        onClose={() => setWhatsappModal(prev => ({ ...prev, isOpen: false }))}
        title={whatsappModal.title}
        defaultPhone={whatsappModal.defaultPhone}
        message={whatsappModal.message}
        customerName={whatsappModal.customerName}
      />
    </div>
  );
}

export default function POSPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-canvas">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    }>
      <POSContent />
    </Suspense>
  );
}
