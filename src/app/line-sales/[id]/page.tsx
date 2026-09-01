'use client';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Truck, 
  ArrowLeft, 
  PackagePlus, 
  Receipt, 
  RotateCcw, 
  Search, 
  Plus, 
  Trash2, 
  Loader2, 
  AlertCircle, 
  Phone, 
  FileText, 
  Printer, 
  ChevronRight,
  ChevronDown,
  UserCheck, 
  X,
  FileCheck,
  Download,
  Package,
  Layers,
  Check
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { 
  getLineStaffListAction, 
  getLineVanInventoryAction, 
  getLineStockMovementsAction, 
  getLineDummyInvoicesAction,
  dispatchLineStockAction, 
  billLineStaffSalesAction, 
  returnLineVanStockAction,
  createLineDummyInvoiceAction,
  toggleLineStaffStatusAction
} from '@/lib/actions/line-sales';
import { getPricingVariantsAction } from '@/lib/actions/pricing';
import { getStoreSettingsAction } from '@/lib/actions/settings';
import { generateInvoicePDF } from '@/lib/pdf/generateInvoice';
import toast from 'react-hot-toast';

const formatINR = (amount: number | string | null | undefined) => {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || 0));
  const safeNum = isNaN(num) ? 0 : num;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(safeNum);
};

export default function LineStaffDetailPage() {
  const params = useParams();
  const router = useRouter();
  const staffId = params?.id as string;
  const isSubmittingRef = useRef(false);

  const [staff, setStaff] = useState<any>(null);
  const [vanInventory, setVanInventory] = useState<any[]>([]);
  const [dummyInvoices, setDummyInvoices] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'inventory' | 'dummy_invoices' | 'movements'>('inventory');
  const [toggleStatusLoading, setToggleStatusLoading] = useState(false);

  // Grouped Van Accordion State
  const [expandedVanProducts, setExpandedVanProducts] = useState<Set<string>>(new Set());

  // Road Proforma Printable PDF View Modal State
  const [selectedDummyForView, setSelectedDummyForView] = useState<any>(null);
  const [isViewDummyOpen, setIsViewDummyOpen] = useState(false);

  // Search in Van Inventory
  const [searchQuery, setSearchQuery] = useState('');

  // Warehouse Catalog for Dispatch
  const [warehouseVariants, setWarehouseVariants] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Dispatch Modal state
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [dispatchRows, setDispatchRows] = useState<Array<{
    variant_id: string;
    variant_name: string;
    product_name: string;
    pieces_per_set: number;
    stock_sets: number;
    stock_loose: number;
    sets_quantity: string;
    loose_quantity: string;
  }>>([]);
  const [dispatchVariantSearch, setDispatchVariantSearch] = useState('');
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchError, setDispatchError] = useState('');

  // Multi-Variant Quantity Selector Modal State
  const [dispatchModalProduct, setDispatchModalProduct] = useState<any | null>(null);
  const [dispatchVariantInputs, setDispatchVariantInputs] = useState<Record<string, { sets: string; loose: string }>>({});

  // Bill Sold Items Modal State
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [billItems, setBillItems] = useState<Array<{
    variant_id: string;
    variant_name: string;
    product_name: string;
    pieces_per_set: number;
    max_sets: number;
    max_loose: number;
    max_total_pieces: number;
    selling_price: number;
    sets_quantity: string;
    loose_quantity: string;
  }>>([]);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'CREDIT'>('CASH');
  const [discountAmount, setDiscountAmount] = useState<string>('0');
  const [amountPaid, setAmountPaid] = useState<string>('');
  const [billNotes, setBillNotes] = useState('');
  const [billLoading, setBillLoading] = useState(false);
  const [billError, setBillError] = useState('');

  // Road Proforma / Dummy Invoice Modal State
  const [isDummyModalOpen, setIsDummyModalOpen] = useState(false);
  const [dummyShopName, setDummyShopName] = useState('');
  const [dummyShopPhone, setDummyShopPhone] = useState('');
  const [dummyDiscount, setDummyDiscount] = useState('0');
  const [dummyNotes, setDummyNotes] = useState('');
  const [dummyItems, setDummyItems] = useState<Array<{
    variant_id: string;
    variant_name: string;
    product_name: string;
    pieces_per_set: number;
    max_sets: number;
    max_loose: number;
    max_total_pieces: number;
    selling_price: number;
    sets_quantity: string;
    loose_quantity: string;
  }>>([]);
  const [dummyLoading, setDummyLoading] = useState(false);
  const [dummyError, setDummyError] = useState('');

  // Single Item Return Modal State
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [selectedReturnItem, setSelectedReturnItem] = useState<any>(null);
  const [returnSets, setReturnSets] = useState<string>('0');
  const [returnLoose, setReturnLoose] = useState<string>('0');
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnError, setReturnError] = useState('');

  // Put Back All Confirmation Modal State
  const [isPutBackAllOpen, setIsPutBackAllOpen] = useState(false);
  const [putBackAllLoading, setPutBackAllLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!staffId) return;
    setLoading(true);
    try {
      const [staffRes, invRes, dummyRes, movRes] = await Promise.all([
        getLineStaffListAction(),
        getLineVanInventoryAction(staffId),
        getLineDummyInvoicesAction(staffId),
        getLineStockMovementsAction(staffId)
      ]);

      if (staffRes.success && staffRes.data) {
        const found = staffRes.data.find(s => s.id === staffId);
        setStaff(found || null);
      }
      if (invRes.success && invRes.data) setVanInventory(invRes.data);
      if (dummyRes.success && dummyRes.data) setDummyInvoices(dummyRes.data);
      if (movRes.success && movRes.data) setMovements(movRes.data);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load line salesman data');
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleStaffStatus = async () => {
    if (!staff || toggleStatusLoading) return;
    const nextStatus = !staff.is_active;
    setToggleStatusLoading(true);
    try {
      const res = await toggleLineStaffStatusAction(staff.id, nextStatus);
      if (res.success && res.data) {
        setStaff((prev: any) => ({ ...prev, is_active: nextStatus }));
        toast.success(`Staff status marked as ${nextStatus ? 'Active' : 'Inactive'}`);
      } else {
        toast.error(res.error || 'Failed to update staff status');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error updating status');
    } finally {
      setToggleStatusLoading(false);
    }
  };

  const handleDownloadProformaPdf = async (dummy: any) => {
    try {
      const storeRes = await getStoreSettingsAction();
      const store = storeRes?.success && storeRes.data ? storeRes.data : null;
      const storeConfig = store ? {
        storeName: store.store_name || undefined,
        tagline: store.tagline || undefined,
        addressLine1: store.address || undefined,
        phone: store.phone || undefined,
        email: store.email || undefined,
        gstin: store.gstin || undefined
      } : undefined;

      generateInvoicePDF({
        ...dummy,
        is_proforma: true,
        line_staff: staff
      }, {
        storeConfig,
        fileName: `Road_Proforma_${dummy.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`
      });
    } catch (err: any) {
      toast.error('Failed to generate Proforma PDF');
    }
  };

  // Load Warehouse Catalog for Dispatch
  const handleOpenDispatchModal = async () => {
    setIsDispatchModalOpen(true);
    setDispatchRows([]);
    setDispatchVariantSearch('');
    setDispatchError('');
    setCatalogLoading(true);
    try {
      const res = await getPricingVariantsAction();
      if (res.success && res.data) {
        setWarehouseVariants(res.data);
      }
    } finally {
      setCatalogLoading(false);
    }
  };

  // Group Warehouse Variants by Product
  const groupedWarehouseProducts = useMemo(() => {
    const map = new Map<string, {
      id: string;
      name: string;
      category_name: string;
      pieces_per_set: number;
      total_stock_sets: number;
      total_stock_pcs: number;
      variants: any[];
    }>();

    warehouseVariants.forEach((v: any) => {
      const prod = v.products || { id: 'unknown', name: 'Other Item' };
      const prodId = prod.id || v.product_id || 'unknown';
      const pps = v.pieces_per_set || prod.pieces_per_set || 1;

      if (!map.has(prodId)) {
        map.set(prodId, {
          id: prodId,
          name: prod.name || 'Unnamed Product',
          category_name: prod.categories?.name || 'General',
          pieces_per_set: pps,
          total_stock_sets: 0,
          total_stock_pcs: 0,
          variants: []
        });
      }
      const g = map.get(prodId)!;
      g.total_stock_sets += Number(v.stock_sets || 0);
      g.total_stock_pcs += Number(v.stock_quantity || 0);
      g.variants.push(v);
    });

    return Array.from(map.values());
  }, [warehouseVariants]);

  const filteredWarehouseProducts = useMemo(() => {
    const q = dispatchVariantSearch.trim().toLowerCase();
    if (!q) return groupedWarehouseProducts;
    return groupedWarehouseProducts.filter(p => {
      const nameMatch = p.name.toLowerCase().includes(q);
      const catMatch = p.category_name.toLowerCase().includes(q);
      const variantMatch = p.variants.some((v: any) => 
        (v.name && v.name.toLowerCase().includes(q)) || 
        (v.barcode && v.barcode.toLowerCase().includes(q))
      );
      return nameMatch || catMatch || variantMatch;
    });
  }, [groupedWarehouseProducts, dispatchVariantSearch]);

  const handleOpenVariantSelector = (prod: any) => {
    const initialInputs: Record<string, { sets: string; loose: string }> = {};
    prod.variants.forEach((v: any) => {
      const existing = dispatchRows.find(r => r.variant_id === v.id);
      initialInputs[v.id] = {
        sets: existing ? String(existing.sets_quantity || '0') : '',
        loose: existing ? String(existing.loose_quantity || '0') : ''
      };
    });
    setDispatchVariantInputs(initialInputs);
    setDispatchModalProduct(prod);
  };

  const updateVariantSelectorInput = (variantId: string, field: 'sets' | 'loose', val: string) => {
    setDispatchVariantInputs(prev => ({
      ...prev,
      [variantId]: {
        sets: field === 'sets' ? val : (prev[variantId]?.sets || ''),
        loose: field === 'loose' ? val : (prev[variantId]?.loose || '')
      }
    }));
  };

  const stepVariantSelectorInput = (variantId: string, field: 'sets' | 'loose', delta: number) => {
    setDispatchVariantInputs(prev => {
      const currentVal = Math.max(0, Math.floor(Number(prev[variantId]?.[field] || 0)));
      const nextVal = Math.max(0, currentVal + delta);
      return {
        ...prev,
        [variantId]: {
          sets: field === 'sets' ? String(nextVal) : (prev[variantId]?.sets || ''),
          loose: field === 'loose' ? String(nextVal) : (prev[variantId]?.loose || '')
        }
      };
    });
  };

  const handleApplyVariantQuantities = () => {
    if (!dispatchModalProduct) return;
    const newRows = [...dispatchRows];

    for (const v of dispatchModalProduct.variants) {
      const input = dispatchVariantInputs[v.id];
      const s = Math.max(0, Math.floor(Number(input?.sets || 0)));
      const l = Math.max(0, Math.floor(Number(input?.loose || 0)));

      const existingIdx = newRows.findIndex(r => r.variant_id === v.id);
      if (s > 0 || l > 0) {
        const pps = v.pieces_per_set || dispatchModalProduct.pieces_per_set || 1;
        const stockSets = v.stock_sets || 0;
        const totalStockPieces = v.stock_quantity || 0;
        const stockLoose = Math.max(0, totalStockPieces - (stockSets * pps));

        const rowData = {
          variant_id: v.id,
          product_name: dispatchModalProduct.name,
          variant_name: v.name,
          pieces_per_set: pps,
          stock_sets: stockSets,
          stock_loose: stockLoose,
          sets_quantity: String(s),
          loose_quantity: String(l)
        };

        if (existingIdx >= 0) {
          newRows[existingIdx] = rowData;
        } else {
          newRows.push(rowData);
        }
      } else if (existingIdx >= 0) {
        newRows.splice(existingIdx, 1);
      }
    }

    setDispatchRows(newRows);
    setDispatchModalProduct(null);
    setDispatchVariantSearch('');
  };

  const handleAddDispatchItem = (variant: any) => {
    if (dispatchRows.some(r => r.variant_id === variant.id)) {
      toast.error('Item is already in dispatch list');
      return;
    }
    const pps = variant.pieces_per_set || variant.products?.pieces_per_set || 1;
    const stockSets = variant.stock_sets || 0;
    const totalPieces = variant.stock_quantity || 0;
    const loosePieces = Math.max(0, totalPieces - (stockSets * pps));

    setDispatchRows(prev => [
      ...prev,
      {
        variant_id: variant.id,
        variant_name: variant.name,
        product_name: variant.products?.name || 'Product',
        pieces_per_set: pps,
        stock_sets: stockSets,
        stock_loose: loosePieces,
        sets_quantity: '0',
        loose_quantity: '0'
      }
    ]);
    setDispatchVariantSearch('');
  };

  const handleRemoveDispatchRow = (index: number) => {
    setDispatchRows(prev => prev.filter((_, idx) => idx !== index));
  };

  const updateDispatchRow = (index: number, field: 'sets_quantity' | 'loose_quantity', value: string) => {
    setDispatchRows(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const submitDispatch = async () => {
    if (isSubmittingRef.current || dispatchLoading) return;
    const validItems = dispatchRows.filter(r => (parseInt(r.sets_quantity) || 0) > 0 || (parseInt(r.loose_quantity) || 0) > 0);
    if (validItems.length === 0) {
      setDispatchError('Please enter at least 1 set or loose piece to dispatch.');
      return;
    }

    // Client side stock bounds validation against warehouse stock
    for (const item of validItems) {
      const sets = parseInt(item.sets_quantity) || 0;
      const loose = parseInt(item.loose_quantity) || 0;
      const requestedPieces = (sets * item.pieces_per_set) + loose;
      const availablePieces = (item.stock_sets * item.pieces_per_set) + item.stock_loose;
      if (requestedPieces > availablePieces) {
        setDispatchError(`Cannot dispatch ${requestedPieces} pcs of ${item.product_name} - ${item.variant_name} (Only ${availablePieces} pcs available in warehouse).`);
        return;
      }
    }

    isSubmittingRef.current = true;
    setDispatchLoading(true);
    setDispatchError('');

    try {
      const res = await dispatchLineStockAction({
        staff_id: staffId,
        items: validItems.map(i => ({
          variant_id: i.variant_id,
          sets_quantity: parseInt(i.sets_quantity) || 0,
          loose_quantity: parseInt(i.loose_quantity) || 0
        }))
      });

      if (res.success) {
        toast.success('Stock successfully dispatched to van inventory!');
        setIsDispatchModalOpen(false);
        await loadData();
      } else {
        setDispatchError(res.error || 'Failed to dispatch stock');
      }
    } catch (err: any) {
      setDispatchError(err?.message || 'Error dispatching stock');
    } finally {
      isSubmittingRef.current = false;
      setDispatchLoading(false);
    }
  };

  // Open Bill Modal with all current Van Inventory pre-populated
  const handleOpenBillModal = () => {
    if (vanInventory.length === 0) {
      toast.error('No items in van to bill');
      return;
    }

    setBillItems(
      vanInventory.map(item => {
        const pps = item.variants?.pieces_per_set || item.variants?.products?.pieces_per_set || 1;
        const sets = item.sets_quantity || 0;
        const totalPcs = item.quantity || 0;
        const loose = Math.max(0, totalPcs - (sets * pps));
        return {
          variant_id: item.variant_id,
          variant_name: item.variants?.name || 'Variant',
          product_name: item.variants?.products?.name || 'Product',
          pieces_per_set: pps,
          max_sets: sets,
          max_loose: loose,
          max_total_pieces: totalPcs,
          selling_price: Number(item.variants?.selling_price || 0),
          sets_quantity: '0',
          loose_quantity: '0'
        };
      })
    );
    setPaymentMethod('CASH');
    setDiscountAmount('0');
    setAmountPaid('');
    setBillNotes('');
    setBillError('');
    setIsBillModalOpen(true);
  };

  const updateBillRow = (index: number, field: 'sets_quantity' | 'loose_quantity', value: string) => {
    setBillItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // Calculate Bill Totals
  const billSubtotal = billItems.reduce((acc, item) => {
    const sets = parseInt(item.sets_quantity) || 0;
    const loose = parseInt(item.loose_quantity) || 0;
    const totalPcs = (sets * item.pieces_per_set) + loose;
    return acc + (totalPcs * item.selling_price);
  }, 0);

  const billDiscount = Math.min(billSubtotal, Math.max(0, parseFloat(discountAmount) || 0));
  const billFinalTotal = Math.max(0, billSubtotal - billDiscount);

  const submitBillSales = async () => {
    if (isSubmittingRef.current || billLoading) return;
    const selectedItems = billItems.filter(i => (parseInt(i.sets_quantity) || 0) > 0 || (parseInt(i.loose_quantity) || 0) > 0);
    if (selectedItems.length === 0) {
      setBillError('Please enter quantities for the items sold on the road.');
      return;
    }

    // Van stock bounds check
    for (const item of selectedItems) {
      const sets = parseInt(item.sets_quantity) || 0;
      const loose = parseInt(item.loose_quantity) || 0;
      const requestedPieces = (sets * item.pieces_per_set) + loose;
      if (requestedPieces > item.max_total_pieces) {
        setBillError(`Cannot sell ${requestedPieces} pcs of ${item.product_name} - ${item.variant_name} (Only ${item.max_total_pieces} pcs in van).`);
        return;
      }
    }

    isSubmittingRef.current = true;
    setBillLoading(true);
    setBillError('');

    try {
      const parsedPaid = amountPaid.trim() === '' ? billFinalTotal : (parseFloat(amountPaid) || 0);
      const payments = (paymentMethod === 'CREDIT' || parsedPaid <= 0)
        ? []
        : [{ amount: Math.min(parsedPaid, billFinalTotal), method: paymentMethod }];

      const res = await billLineStaffSalesAction({
        staff_id: staffId,
        items: selectedItems.map(i => ({
          variant_id: i.variant_id,
          sets_quantity: parseInt(i.sets_quantity) || 0,
          loose_quantity: parseInt(i.loose_quantity) || 0,
          selling_price: i.selling_price
        })),
        payments,
        discount_amount: billDiscount,
        notes: billNotes.trim() || null
      });

      if (res.success && res.data) {
        toast.success(`Invoice #${res.data.invoice_number} created and van stock updated!`);
        setIsBillModalOpen(false);
        await loadData();
      } else {
        setBillError(res.error || 'Failed to bill line sales');
      }
    } catch (err: any) {
      setBillError(err?.message || 'Error billing sales');
    } finally {
      isSubmittingRef.current = false;
      setBillLoading(false);
    }
  };

  // Open Road Proforma Modal
  const handleOpenDummyModal = () => {
    if (vanInventory.length === 0) {
      toast.error('No items in van for transit proforma');
      return;
    }

    setDummyItems(
      vanInventory.map(item => {
        const pps = item.variants?.pieces_per_set || item.variants?.products?.pieces_per_set || 1;
        const sets = item.sets_quantity || 0;
        const totalPcs = item.quantity || 0;
        const loose = Math.max(0, totalPcs - (sets * pps));
        return {
          variant_id: item.variant_id,
          variant_name: item.variants?.name || 'Variant',
          product_name: item.variants?.products?.name || 'Product',
          pieces_per_set: pps,
          max_sets: sets,
          max_loose: loose,
          max_total_pieces: totalPcs,
          selling_price: Number(item.variants?.selling_price || 0),
          sets_quantity: String(sets),
          loose_quantity: String(loose)
        };
      })
    );
    setDummyShopName('');
    setDummyShopPhone('');
    setDummyDiscount('0');
    setDummyNotes('');
    setDummyError('');
    setIsDummyModalOpen(true);
  };

  const updateDummyRow = (index: number, field: 'sets_quantity' | 'loose_quantity', value: string) => {
    setDummyItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const dummySubtotal = dummyItems.reduce((acc, item) => {
    const sets = parseInt(item.sets_quantity) || 0;
    const loose = parseInt(item.loose_quantity) || 0;
    const totalPcs = (sets * item.pieces_per_set) + loose;
    return acc + (totalPcs * item.selling_price);
  }, 0);

  const dummyDiscountAmt = Math.min(dummySubtotal, Math.max(0, parseFloat(dummyDiscount) || 0));
  const dummyFinalTotal = Math.max(0, dummySubtotal - dummyDiscountAmt);

  const submitDummyInvoice = async () => {
    if (isSubmittingRef.current || dummyLoading) return;
    const selectedItems = dummyItems.filter(i => (parseInt(i.sets_quantity) || 0) > 0 || (parseInt(i.loose_quantity) || 0) > 0);
    if (selectedItems.length === 0) {
      setDummyError('Please select at least 1 item for road proforma.');
      return;
    }

    isSubmittingRef.current = true;
    setDummyLoading(true);
    setDummyError('');

    try {
      const res = await createLineDummyInvoiceAction({
        staff_id: staffId,
        shop_name: dummyShopName.trim() || 'Valued Shop',
        shop_phone: dummyShopPhone.trim() || null,
        items: selectedItems.map(i => {
          const sets = parseInt(i.sets_quantity) || 0;
          const loose = parseInt(i.loose_quantity) || 0;
          const totalPcs = (sets * i.pieces_per_set) + loose;
          return {
            variant_id: i.variant_id,
            variant_name: `${i.product_name} - ${i.variant_name}`,
            sets_quantity: sets,
            loose_quantity: loose,
            selling_price: i.selling_price,
            total_pieces: totalPcs
          };
        }),
        subtotal: dummySubtotal,
        discount_amount: dummyDiscountAmt,
        final_total: dummyFinalTotal,
        notes: dummyNotes.trim() || null
      });

      if (res.success && res.data) {
        toast.success(`Road Proforma #${res.data.invoice_number} created!`);
        setIsDummyModalOpen(false);
        setSelectedDummyForView(res.data);
        setIsViewDummyOpen(true);
        await loadData();
      } else {
        setDummyError(res.error || 'Failed to create road proforma');
      }
    } catch (err: any) {
      setDummyError(err?.message || 'Error creating road proforma');
    } finally {
      isSubmittingRef.current = false;
      setDummyLoading(false);
    }
  };

  // Single Item Return
  const handleOpenReturnModal = (item: any) => {
    setSelectedReturnItem(item);
    const pps = item.variants?.pieces_per_set || item.variants?.products?.pieces_per_set || 1;
    const sets = item.sets_quantity || 0;
    const totalPcs = item.quantity || 0;
    const loose = Math.max(0, totalPcs - (sets * pps));

    setReturnSets(String(sets));
    setReturnLoose(String(loose));
    setReturnError('');
    setIsReturnModalOpen(true);
  };

  const submitSingleReturn = async () => {
    if (!selectedReturnItem || isSubmittingRef.current || returnLoading) return;
    const setsToReturn = parseInt(returnSets) || 0;
    const looseToReturn = parseInt(returnLoose) || 0;

    if (setsToReturn <= 0 && looseToReturn <= 0) {
      setReturnError('Please specify quantities to return to warehouse.');
      return;
    }

    const pps = selectedReturnItem.variants?.pieces_per_set || selectedReturnItem.variants?.products?.pieces_per_set || 1;
    const totalReq = (setsToReturn * pps) + looseToReturn;
    const currentInVan = selectedReturnItem.quantity || 0;
    if (totalReq > currentInVan) {
      setReturnError(`Cannot return ${totalReq} pcs (Only ${currentInVan} pcs in van).`);
      return;
    }

    isSubmittingRef.current = true;
    setReturnLoading(true);
    setReturnError('');

    try {
      const res = await returnLineVanStockAction({
        staff_id: staffId,
        items: [{
          variant_id: selectedReturnItem.variant_id,
          sets_quantity: setsToReturn,
          loose_quantity: looseToReturn
        }],
        put_back_all: false
      });

      if (res.success) {
        toast.success('Stock returned to warehouse inventory!');
        setIsReturnModalOpen(false);
        await loadData();
      } else {
        setReturnError(res.error || 'Failed to return stock');
      }
    } catch (err: any) {
      setReturnError(err?.message || 'Error returning stock');
    } finally {
      isSubmittingRef.current = false;
      setReturnLoading(false);
    }
  };

  // Put Back All Stock
  const submitPutBackAll = async () => {
    if (isSubmittingRef.current || putBackAllLoading) return;
    isSubmittingRef.current = true;
    setPutBackAllLoading(true);

    try {
      const res = await returnLineVanStockAction({
        staff_id: staffId,
        put_back_all: true
      });
      if (res.success) {
        toast.success('All remaining van stock returned to warehouse!');
        setIsPutBackAllOpen(false);
        await loadData();
      } else {
        toast.error(res.error || 'Failed to return van stock');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error returning van stock');
    } finally {
      isSubmittingRef.current = false;
      setPutBackAllLoading(false);
    }
  };

  const filteredVanItems = vanInventory.filter(item => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const pName = item.variants?.products?.name || '';
    const vName = item.variants?.name || '';
    const barcode = item.variants?.barcode || '';
    return pName.toLowerCase().includes(q) || vName.toLowerCase().includes(q) || barcode.toLowerCase().includes(q);
  });

  // Group filtered van items by product
  const groupedVanProducts = useMemo(() => {
    const map = new Map<string, {
      id: string;
      name: string;
      category_name: string;
      pieces_per_set: number;
      total_sets: number;
      total_pcs: number;
      items: any[];
    }>();

    filteredVanItems.forEach((item: any) => {
      const prod = item.variants?.products || { id: 'unknown', name: 'Other Items' };
      const prodId = prod.id || item.variants?.product_id || 'unknown';
      const pps = item.variants?.pieces_per_set || prod.pieces_per_set || 1;
      const sets = item.sets_quantity || 0;
      const pcs = item.quantity || 0;

      if (!map.has(prodId)) {
        map.set(prodId, {
          id: prodId,
          name: prod.name || item.variants?.name || 'Unnamed Product',
          category_name: prod.categories?.name || 'General',
          pieces_per_set: pps,
          total_sets: 0,
          total_pcs: 0,
          items: []
        });
      }
      const g = map.get(prodId)!;
      g.total_sets += sets;
      g.total_pcs += pcs;
      g.items.push(item);
    });

    return Array.from(map.values());
  }, [filteredVanItems]);

  // Auto-expand van products on load
  useEffect(() => {
    if (groupedVanProducts.length > 0) {
      setExpandedVanProducts(prev => {
        if (prev.size === 0) {
          return new Set(groupedVanProducts.map(p => p.id));
        }
        return prev;
      });
    }
  }, [groupedVanProducts]);

  const toggleVanProduct = (prodId: string) => {
    setExpandedVanProducts(prev => {
      const next = new Set(prev);
      if (next.has(prodId)) next.delete(prodId);
      else next.add(prodId);
      return next;
    });
  };

  const toggleAllVanProducts = () => {
    if (expandedVanProducts.size === groupedVanProducts.length) {
      setExpandedVanProducts(new Set());
    } else {
      setExpandedVanProducts(new Set(groupedVanProducts.map(p => p.id)));
    }
  };

  const totalVanPieces = vanInventory.reduce((acc, i) => acc + (i.quantity || 0), 0);
  const totalVanSets = vanInventory.reduce((acc, i) => acc + (i.sets_quantity || 0), 0);

  return (
    <div className="p-3.5 pb-36 sm:p-6 md:p-8 md:pb-12 max-w-7xl w-full mx-auto space-y-6 bg-canvas min-h-screen text-ink-primary font-sans">
      {/* Top Header & Breadcrumb */}
      <div className="space-y-3">
        <Link
          href="/line-sales"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-ink-primary transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Line Sales Hub</span>
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 text-accent font-bold flex items-center justify-center text-lg">
              {staff?.name ? staff.name.charAt(0).toUpperCase() : <Truck className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-ink-primary">
                  {staff?.name || 'Line Salesman'}
                </h1>
                <button
                  onClick={handleToggleStaffStatus}
                  disabled={toggleStatusLoading}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition cursor-pointer flex items-center gap-1 ${
                    staff?.is_active 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' 
                      : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                  }`}
                  title="Click to toggle Active/Inactive status"
                >
                  {toggleStatusLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>{staff?.is_active ? 'Active' : 'Inactive'} (Toggle)</span>
                </button>
              </div>
              <p className="text-xs text-ink-muted flex items-center gap-2 mt-0.5 flex-wrap">
                {staff?.phone && <span className="font-mono flex items-center gap-1"><Phone className="w-3 h-3" /> {staff.phone}</span>}
                {staff?.route_name && <span>• Route: <strong className="text-ink-primary">{staff.route_name}</strong></span>}
                {staff?.customer_id && (
                  <Link href={`/customers/${staff.customer_id}`} className="text-accent underline font-semibold flex items-center gap-1">
                    <UserCheck className="w-3 h-3" /> View Customer Ledger
                  </Link>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={handleOpenDispatchModal}
              disabled={!staff?.is_active}
              className="px-3.5 py-2 bg-surface hover:bg-row-alt border border-border text-ink-primary text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-2xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={!staff?.is_active ? 'Cannot dispatch to inactive staff' : undefined}
            >
              <PackagePlus className="w-4 h-4 text-accent" />
              <span>Dispatch Stock</span>
            </button>

            <Link
              href={staff?.is_active && vanInventory.length > 0 ? `/pos?mode=proforma&line_staff_id=${staff.id}` : '#'}
              className={`px-3.5 py-2 bg-surface hover:bg-row-alt border border-border text-blue-700 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-2xs transition cursor-pointer ${
                !staff?.is_active || vanInventory.length === 0 ? 'opacity-40 pointer-events-none' : ''
              }`}
              title={!staff?.is_active ? 'Cannot issue proforma for inactive staff' : undefined}
            >
              <FileCheck className="w-4 h-4 text-blue-600" />
              <span>Road Proforma</span>
            </Link>

            <Link
              href={staff?.is_active && vanInventory.length > 0 ? `/pos?mode=line_sale&line_staff_id=${staff.id}` : '#'}
              className={`px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs transition cursor-pointer ${
                !staff?.is_active || vanInventory.length === 0 ? 'opacity-40 pointer-events-none' : ''
              }`}
              title={!staff?.is_active ? 'Cannot bill sales for inactive staff' : undefined}
            >
              <Receipt className="w-4 h-4" />
              <span>Bill Sold Items</span>
            </Link>

            {vanInventory.length > 0 && (
              <button
                onClick={() => setIsPutBackAllOpen(true)}
                className="px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold rounded-xl flex items-center gap-1.5 transition cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Put Back All</span>
              </button>
            )}
          </div>
        </div>

        {/* Inactive Notice Banner */}
        {staff && !staff.is_active && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-amber-900 text-xs shadow-2xs">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h4 className="font-bold text-sm text-amber-950">Line Staff Inactive</h4>
              <p className="text-amber-800 leading-relaxed">
                This salesman is currently inactive. Stock dispatch and road sales billing are locked.
                Any remaining van stock can still be returned to the main warehouse using <strong>Return Stock</strong> or <strong>Put Back All</strong>.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-surface rounded-2xl border border-border space-y-1 shadow-2xs">
          <span className="text-[11px] text-ink-muted font-medium">Van Inventory</span>
          <p className="text-lg sm:text-xl font-extrabold text-ink-primary font-mono">{vanInventory.length} Products</p>
        </div>
        <div className="p-4 bg-surface rounded-2xl border border-border space-y-1 shadow-2xs">
          <span className="text-[11px] text-ink-muted font-medium">Packaged Sets in Van</span>
          <p className="text-lg sm:text-xl font-extrabold text-accent font-mono">{totalVanSets} Sets</p>
        </div>
        <div className="p-4 bg-surface rounded-2xl border border-border space-y-1 shadow-2xs">
          <span className="text-[11px] text-ink-muted font-medium">Total Pieces in Van</span>
          <p className="text-lg sm:text-xl font-extrabold text-emerald-700 font-mono">{totalVanPieces} Pcs</p>
        </div>
        <div className="p-4 bg-surface rounded-2xl border border-border space-y-1 shadow-2xs">
          <span className="text-[11px] text-ink-muted font-medium">Transit Dummy Proformas</span>
          <p className="text-lg sm:text-xl font-extrabold text-blue-700 font-mono">{dummyInvoices.length} Issued</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 border-b border-border pb-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
            activeTab === 'inventory'
              ? 'bg-accent text-white shadow-xs'
              : 'bg-surface text-ink-muted hover:text-ink-primary border border-border'
          }`}
        >
          Van Inventory ({vanInventory.length})
        </button>
        <button
          onClick={() => setActiveTab('dummy_invoices')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
            activeTab === 'dummy_invoices'
              ? 'bg-accent text-white shadow-xs'
              : 'bg-surface text-ink-muted hover:text-ink-primary border border-border'
          }`}
        >
          Road Proforma Invoices ({dummyInvoices.length})
        </button>
        <button
          onClick={() => setActiveTab('movements')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
            activeTab === 'movements'
              ? 'bg-accent text-white shadow-xs'
              : 'bg-surface text-ink-muted hover:text-ink-primary border border-border'
          }`}
        >
          Stock Dispatch Audit ({movements.length})
        </button>
      </div>

      {/* TAB 1: VAN INVENTORY */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:max-w-md">
              <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search van items by product name, variant or barcode..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-surface border border-border rounded-xl text-xs sm:text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div className="flex items-center gap-3">
              {groupedVanProducts.length > 0 && (
                <button
                  onClick={toggleAllVanProducts}
                  className="px-3 py-1.5 bg-surface border border-border text-ink-primary rounded-xl text-xs font-semibold hover:bg-row-alt transition shadow-2xs cursor-pointer"
                >
                  {expandedVanProducts.size === groupedVanProducts.length ? 'Collapse All' : 'Expand All'}
                </button>
              )}
              <span className="text-xs text-ink-muted">
                Showing {groupedVanProducts.length} products ({filteredVanItems.length} sizes in van)
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="bg-surface border border-border rounded-2xl p-12 text-center text-ink-muted text-xs flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-accent" />
                <span>Loading van stock...</span>
              </div>
            ) : groupedVanProducts.length === 0 ? (
              <div className="bg-surface border border-border rounded-2xl p-12 text-center text-ink-muted text-xs space-y-2">
                <Truck className="w-10 h-10 mx-auto text-ink-muted/50" />
                <p className="font-bold text-ink-primary">Van is currently empty</p>
                <p>Click &quot;Dispatch Stock&quot; to load inventory for road sales.</p>
              </div>
            ) : (
              groupedVanProducts.map((group) => {
                const isExpanded = expandedVanProducts.has(group.id);
                const isMixedPps = new Set(group.items.map((i: any) => i.variants?.pieces_per_set || group.pieces_per_set || 1)).size > 1;

                return (
                  <div key={group.id} className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xs">
                    {/* Group Header */}
                    <div 
                      onClick={() => toggleVanProduct(group.id)}
                      className="p-3.5 sm:p-4 hover:bg-row-alt/50 transition cursor-pointer flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button 
                          aria-label="Toggle variants"
                          className="text-ink-muted hover:text-ink-primary p-1 rounded-lg hover:bg-row-alt transition cursor-pointer"
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
                              {group.name}
                            </h3>
                            <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                              {group.category_name}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 sm:gap-3 flex-wrap text-xs text-ink-muted mt-1">
                            <span className="inline-flex items-center gap-1 font-medium bg-row-alt px-2 py-0.5 rounded-md border border-border text-[11px]">
                              <Package className="w-3.5 h-3.5 text-ink-muted" />
                              {isMixedPps ? 'Mixed Pack Sizes' : `${group.pieces_per_set} pcs / set`}
                            </span>
                            
                            <span className="font-medium text-[11px]">
                              {group.items.length} size{group.items.length !== 1 ? 's' : ''} in van
                            </span>

                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">
                              Van Stock: {group.total_sets} Sets ({group.total_pcs} Pcs)
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-bold font-mono text-sm sm:text-base text-ink-primary">
                          {group.total_sets} Sets
                        </div>
                        <div className="text-[11px] text-emerald-700 font-mono font-bold">
                          {group.total_pcs} Total Pcs
                        </div>
                      </div>
                    </div>

                    {/* Nested Variant Breakdown Table */}
                    {isExpanded && (
                      <div className="border-t border-border bg-row-alt/20 divide-y divide-border">
                        {group.items.map((item: any) => {
                          const pps = item.variants?.pieces_per_set || group.pieces_per_set || 1;
                          const sets = item.sets_quantity || 0;
                          const totalPcs = item.quantity || 0;
                          const loose = Math.max(0, totalPcs - (sets * pps));

                          return (
                            <div key={item.id || item.variant_id} className="p-3.5 pl-12 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:bg-row-alt/40 transition">
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="w-2 h-2 rounded-full bg-accent/50"></span>
                                  <span className="font-bold text-xs sm:text-sm text-ink-primary">
                                    {item.variants?.name}
                                  </span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono">
                                    {pps} pcs/set
                                  </span>
                                  {item.variants?.barcode && (
                                    <span className="text-[10px] font-mono text-ink-muted">
                                      [{item.variants.barcode}]
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-ink-muted">
                                  Selling Price: <strong className="text-ink-primary font-mono">{formatINR(item.variants?.selling_price)}</strong>
                                </p>
                              </div>

                              <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
                                <div className="text-left sm:text-right">
                                  <div className="font-bold font-mono text-xs sm:text-sm text-ink-primary">
                                    {sets} Sets + {loose} Loose
                                  </div>
                                  <div className="text-[11px] text-emerald-700 font-mono font-bold">
                                    Total: {totalPcs} Pcs
                                  </div>
                                </div>

                                <button
                                  onClick={() => handleOpenReturnModal(item)}
                                  className="px-3 py-1.5 bg-surface hover:bg-row-alt text-ink-primary border border-border rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer"
                                >
                                  Return Stock
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 2: DUMMY INVOICES */}
      {activeTab === 'dummy_invoices' && (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xs">
          {dummyInvoices.length === 0 ? (
            <div className="p-12 text-center text-ink-muted text-xs">
              No road proforma dummy invoices generated yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {dummyInvoices.map((d: any) => (
                <div 
                  key={d.id} 
                  onClick={() => { setSelectedDummyForView(d); setIsViewDummyOpen(true); }}
                  className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:bg-row-alt/50 transition cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold font-mono text-xs sm:text-sm text-accent group-hover:underline">
                        {d.invoice_number}
                      </span>
                      <span className="text-[10px] bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                        <FileCheck className="w-3 h-3 text-blue-600" />
                        <span>Road Transit Proforma</span>
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-muted mt-1">
                      Shop: <strong className="text-ink-primary">{d.shop_name}</strong> {d.shop_phone ? `(${d.shop_phone})` : ''} • Issued {new Date(d.created_at).toLocaleString('en-IN')}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-bold font-mono text-xs sm:text-sm text-ink-primary">
                        {formatINR(d.final_total || d.subtotal)}
                      </div>
                      <div className="text-[11px] text-ink-muted">
                        {Array.isArray(d.items) ? d.items.reduce((acc: number, it: any) => acc + (it.total_pieces || 0), 0) : 0} Total Pieces
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadProformaPdf(d); }}
                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-xl flex items-center gap-1 border border-blue-200 shadow-2xs transition cursor-pointer"
                        title="Download Luxury A4 PDF"
                      >
                        <Download className="w-3.5 h-3.5 text-blue-600" />
                        <span>A4 PDF</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedDummyForView(d); setIsViewDummyOpen(true); }}
                        className="px-3 py-1.5 bg-surface hover:bg-row-alt border border-border text-ink-primary font-bold text-xs rounded-xl flex items-center gap-1 shadow-2xs transition cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5 text-ink-muted" />
                        <span>Print</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MOVEMENTS */}
      {activeTab === 'movements' && (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xs">
          {movements.length === 0 ? (
            <div className="p-12 text-center text-ink-muted text-xs">
              No stock movements recorded for this linesman yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {movements.map((m: any) => {
                const isAddition = m.movement_type === 'DISPATCH';
                return (
                  <div key={m.id} className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          m.movement_type === 'DISPATCH' 
                            ? 'bg-blue-50 text-blue-800 border-blue-200'
                            : m.movement_type === 'SALE_DEDUCT' 
                            ? 'bg-amber-50 text-amber-800 border-amber-200' 
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}>
                          {m.movement_type}
                        </span>
                        <span className="font-bold text-xs sm:text-sm text-ink-primary">
                          {m.variants?.products?.name} - {m.variants?.name}
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-muted mt-1">
                        {new Date(m.created_at).toLocaleString('en-IN')} {m.notes ? `• ${m.notes}` : ''}
                      </p>
                    </div>

                    <div className="text-right font-mono text-xs sm:text-sm font-bold">
                      {isAddition ? '+' : '-'}{Math.abs(m.quantity || 0)} Pcs ({m.sets_quantity || 0} Sets)
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* DISPATCH STOCK MODAL with z-[200] */}
      {isDispatchModalOpen && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !dispatchLoading) setIsDispatchModalOpen(false); }}
        >
          <div 
            className="bg-surface w-full max-w-2xl rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4 max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <PackagePlus className="w-5 h-5 text-accent" />
                <h2 className="text-base sm:text-lg font-bold text-ink-primary">Dispatch Stock to Van</h2>
              </div>
              <button 
                onClick={() => setIsDispatchModalOpen(false)} 
                disabled={dispatchLoading}
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full hover:bg-row-alt"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {dispatchError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{dispatchError}</span>
              </div>
            )}

            {/* Warehouse Product Selector */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-ink-primary">Select Product from Warehouse</label>
              <div className="relative">
                <Search className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Type product name to view and select sizes/variants..."
                  value={dispatchVariantSearch}
                  onChange={e => setDispatchVariantSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-row-alt border border-border rounded-xl text-xs text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              {/* Product Search Results Dropdown */}
              {dispatchVariantSearch.trim() && (
                <div className="max-h-52 overflow-y-auto border border-border rounded-xl bg-surface divide-y divide-border shadow-lg">
                  {catalogLoading ? (
                    <div className="p-4 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-accent" />
                      <span>Loading products...</span>
                    </div>
                  ) : filteredWarehouseProducts.length === 0 ? (
                    <div className="p-4 text-center text-xs text-ink-muted">
                      No products found matching &quot;{dispatchVariantSearch}&quot;
                    </div>
                  ) : (
                    filteredWarehouseProducts.map(prod => (
                      <div 
                        key={prod.id}
                        onClick={() => handleOpenVariantSelector(prod)}
                        className="p-3 hover:bg-accent/10 cursor-pointer flex justify-between items-center text-xs transition"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <strong className="text-ink-primary text-xs sm:text-sm">{prod.name}</strong>
                            <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                              {prod.category_name}
                            </span>
                          </div>
                          <p className="text-[11px] text-ink-muted">
                            {prod.variants.length} size{prod.variants.length > 1 ? 's' : ''} • Stock: <strong className="text-ink-primary font-mono">{prod.total_stock_sets} Sets ({prod.total_stock_pcs} Pcs)</strong>
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleOpenVariantSelector(prod); }}
                          className="px-2.5 py-1.5 bg-accent text-white text-[11px] font-bold rounded-lg hover:bg-accent-hover flex items-center gap-1 shadow-2xs transition shrink-0 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Select Sizes</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Dispatch Items Table */}
            <div className="flex-1 overflow-y-auto space-y-2 min-h-[140px]">
              {dispatchRows.length === 0 ? (
                <div className="p-8 text-center text-ink-muted text-xs border border-dashed border-border rounded-xl">
                  Search and select warehouse products above to dispatch into this van.
                </div>
              ) : (
                dispatchRows.map((row, idx) => (
                  <div key={row.variant_id} className="p-3 bg-row-alt/60 rounded-xl border border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-ink-primary">{row.product_name} - {row.variant_name}</h4>
                      <p className="text-[11px] text-ink-muted">Pack size: {row.pieces_per_set} pcs/set • Available: {row.stock_sets} Sets ({row.stock_sets * row.pieces_per_set + row.stock_loose} Pcs)</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div>
                        <label className="text-[10px] text-ink-muted block font-semibold">Sets</label>
                        <input
                          type="number"
                          min="0"
                          value={row.sets_quantity}
                          onFocus={e => e.target.select()}
                          onChange={e => updateDispatchRow(idx, 'sets_quantity', e.target.value)}
                          className="w-16 p-1.5 text-xs font-mono font-bold bg-surface border border-border rounded-lg text-center"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-ink-muted block font-semibold">Loose</label>
                        <input
                          type="number"
                          min="0"
                          value={row.loose_quantity}
                          onFocus={e => e.target.select()}
                          onChange={e => updateDispatchRow(idx, 'loose_quantity', e.target.value)}
                          className="w-16 p-1.5 text-xs font-mono font-bold bg-surface border border-border rounded-lg text-center"
                        />
                      </div>
                      <button
                        onClick={() => handleRemoveDispatchRow(idx)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition mt-3 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-3 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setIsDispatchModalOpen(false)}
                disabled={dispatchLoading}
                className="flex-1 py-2.5 rounded-xl border border-border text-xs font-bold text-ink-muted hover:bg-row-alt transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDispatch}
                disabled={dispatchLoading || dispatchRows.length === 0}
                className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {dispatchLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{dispatchLoading ? 'Dispatching...' : `Confirm Dispatch (${dispatchRows.length} Items)`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MULTI-VARIANT QUANTITY SELECTOR POPUP with z-[220] */}
      {dispatchModalProduct && (
        <div 
          className="fixed inset-0 z-[220] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget) setDispatchModalProduct(null); }}
        >
          <div 
            className="bg-surface w-full max-w-xl rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4 max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-accent" />
                  <h3 className="text-base sm:text-lg font-bold text-ink-primary">
                    {dispatchModalProduct.name}
                  </h3>
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <span className="font-semibold px-2 py-0.5 bg-row-alt border border-border rounded text-[11px]">
                    {dispatchModalProduct.category_name}
                  </span>
                  <span>Select dispatch quantities for each size/variant below</span>
                </div>
              </div>
              <button 
                onClick={() => setDispatchModalProduct(null)} 
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full hover:bg-row-alt cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Variant List Table */}
            <div className="flex-1 overflow-y-auto space-y-2.5 min-h-[160px] max-h-[50vh] pr-1">
              {dispatchModalProduct.variants.map((v: any) => {
                const pps = v.pieces_per_set || dispatchModalProduct.pieces_per_set || 1;
                const stockSets = v.stock_sets || 0;
                const totalStockPcs = v.stock_quantity || 0;
                const stockLoose = Math.max(0, totalStockPcs - (stockSets * pps));

                const currentSets = dispatchVariantInputs[v.id]?.sets || '';
                const currentLoose = dispatchVariantInputs[v.id]?.loose || '';
                const numSets = Math.max(0, Math.floor(Number(currentSets || 0)));
                const numLoose = Math.max(0, Math.floor(Number(currentLoose || 0)));
                const totalRequestedPcs = (numSets * pps) + numLoose;
                const isOverStock = totalRequestedPcs > totalStockPcs;

                return (
                  <div 
                    key={v.id} 
                    className={`p-3.5 rounded-xl border transition ${
                      isOverStock 
                        ? 'bg-red-50/50 border-red-300' 
                        : (numSets > 0 || numLoose > 0) 
                          ? 'bg-accent/5 border-accent/30' 
                          : 'bg-row-alt/50 border-border'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs sm:text-sm text-ink-primary">
                            {v.name}
                          </span>
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                            {pps} pcs/set
                          </span>
                          {v.barcode && (
                            <span className="text-[10px] font-mono text-ink-muted">
                              [{v.barcode}]
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-ink-muted">
                          Available Warehouse Stock: <strong className="text-ink-primary font-mono">{stockSets} Sets + {stockLoose} Loose ({totalStockPcs} Pcs)</strong>
                        </p>
                        {isOverStock && (
                          <p className="text-[10px] text-red-600 font-bold flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            Exceeds warehouse stock by {totalRequestedPcs - totalStockPcs} pcs
                          </p>
                        )}
                      </div>

                      {/* Sets and Loose Quantity Entry */}
                      <div className="flex items-center gap-3 self-end sm:self-center">
                        {/* Sets Input */}
                        <div className="text-center">
                          <label className="text-[10px] font-bold text-ink-muted block mb-0.5">Sets</label>
                          <div className="flex items-center border border-border rounded-lg bg-surface shadow-2xs overflow-hidden">
                            <button
                              type="button"
                              onClick={() => stepVariantSelectorInput(v.id, 'sets', -1)}
                              className="px-2 py-1 text-ink-muted hover:bg-row-alt font-bold text-xs cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="0"
                              max={stockSets}
                              value={currentSets}
                              onFocus={e => e.target.select()}
                              onChange={e => updateVariantSelectorInput(v.id, 'sets', e.target.value)}
                              placeholder="0"
                              className="w-14 py-1 text-center text-xs font-mono font-bold bg-transparent text-ink-primary focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => stepVariantSelectorInput(v.id, 'sets', 1)}
                              className="px-2 py-1 text-ink-muted hover:bg-row-alt font-bold text-xs cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* Loose Input */}
                        <div className="text-center">
                          <label className="text-[10px] font-bold text-ink-muted block mb-0.5">Loose Pcs</label>
                          <div className="flex items-center border border-border rounded-lg bg-surface shadow-2xs overflow-hidden">
                            <button
                              type="button"
                              onClick={() => stepVariantSelectorInput(v.id, 'loose', -1)}
                              className="px-2 py-1 text-ink-muted hover:bg-row-alt font-bold text-xs cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="0"
                              value={currentLoose}
                              onFocus={e => e.target.select()}
                              onChange={e => updateVariantSelectorInput(v.id, 'loose', e.target.value)}
                              placeholder="0"
                              className="w-14 py-1 text-center text-xs font-mono font-bold bg-transparent text-ink-primary focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => stepVariantSelectorInput(v.id, 'loose', 1)}
                              className="px-2 py-1 text-ink-muted hover:bg-row-alt font-bold text-xs cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setDispatchModalProduct(null)}
                className="flex-1 py-2.5 rounded-xl border border-border text-xs font-bold text-ink-muted hover:bg-row-alt transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyVariantQuantities}
                className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Add to Dispatch List</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BILL SOLD ITEMS MODAL with z-[200] */}
      {isBillModalOpen && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !billLoading) setIsBillModalOpen(false); }}
        >
          <div 
            className="bg-surface w-full max-w-3xl rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4 max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-ink-primary">Bill Sold Items (Non-GST Sales)</h2>
                <p className="text-xs text-ink-muted">Select items sold from the van and record invoice under {staff?.name}</p>
              </div>
              <button 
                onClick={() => setIsBillModalOpen(false)} 
                disabled={billLoading}
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full hover:bg-row-alt"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {billError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{billError}</span>
              </div>
            )}

            {/* Bill Rows List */}
            <div className="flex-1 overflow-y-auto space-y-2 min-h-[160px]">
              {billItems.map((item, idx) => (
                <div key={item.variant_id} className="p-3 bg-row-alt/60 rounded-xl border border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <h4 className="text-xs font-bold text-ink-primary">{item.product_name} - {item.variant_name}</h4>
                    <p className="text-[11px] text-ink-muted">In Van: {item.max_sets} Sets ({item.max_total_pieces} Pcs) • Rate: ₹{item.selling_price}/pc</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div>
                      <label className="text-[10px] text-ink-muted block font-semibold">Sold Sets</label>
                      <input
                        type="number"
                        min="0"
                        value={item.sets_quantity}
                        onFocus={e => e.target.select()}
                        onChange={e => updateBillRow(idx, 'sets_quantity', e.target.value)}
                        className="w-16 p-1.5 text-xs font-mono font-bold bg-surface border border-border rounded-lg text-center"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-ink-muted block font-semibold">Sold Loose</label>
                      <input
                        type="number"
                        min="0"
                        value={item.loose_quantity}
                        onFocus={e => e.target.select()}
                        onChange={e => updateBillRow(idx, 'loose_quantity', e.target.value)}
                        className="w-16 p-1.5 text-xs font-mono font-bold bg-surface border border-border rounded-lg text-center"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary & Payment Controls */}
            <div className="p-4 bg-row-alt rounded-xl border border-border space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-ink-primary mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={e => setPaymentMethod(e.target.value as any)}
                    className="w-full p-2 text-xs bg-surface border border-border rounded-lg font-bold"
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI / Online</option>
                    <option value="CREDIT">Line Credit (Dues)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-ink-primary mb-1">Discount (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={discountAmount}
                    onChange={e => setDiscountAmount(e.target.value)}
                    className="w-full p-2 text-xs font-mono bg-surface border border-border rounded-lg font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-ink-primary mb-1">Amount Paid (₹)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder={String(billFinalTotal)}
                    value={amountPaid}
                    onChange={e => setAmountPaid(e.target.value)}
                    className="w-full p-2 text-xs font-mono bg-surface border border-border rounded-lg font-bold"
                  />
                </div>

                <div className="text-right flex flex-col justify-center">
                  <span className="text-[11px] text-ink-muted font-semibold">Bill Grand Total</span>
                  <span className="text-base font-extrabold font-mono text-accent">{formatINR(billFinalTotal)}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsBillModalOpen(false)}
                disabled={billLoading}
                className="flex-1 py-2.5 rounded-xl border border-border text-xs font-bold text-ink-muted hover:bg-row-alt transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitBillSales}
                disabled={billLoading || billFinalTotal <= 0}
                className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {billLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {billLoading ? 'Generating Invoice...' : `Bill ${formatINR(billFinalTotal)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ROAD PROFORMA MODAL with z-[200] */}
      {isDummyModalOpen && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !dummyLoading) setIsDummyModalOpen(false); }}
        >
          <div 
            className="bg-surface w-full max-w-3xl rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4 max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-ink-primary">Generate Road Transit Proforma</h2>
                <p className="text-xs text-ink-muted">Create dummy bill for vehicle inspection and transit without affecting actual store sales</p>
              </div>
              <button 
                onClick={() => setIsDummyModalOpen(false)} 
                disabled={dummyLoading}
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full hover:bg-row-alt"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {dummyError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{dummyError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Shop / Consignee Name</label>
                <input
                  type="text"
                  placeholder="e.g. City Garments Hub"
                  value={dummyShopName}
                  onChange={e => setDummyShopName(e.target.value)}
                  className="w-full p-2.5 text-xs bg-row-alt border border-border rounded-xl text-ink-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Phone Number (Optional)</label>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={dummyShopPhone}
                  onChange={e => setDummyShopPhone(e.target.value)}
                  className="w-full p-2.5 text-xs font-mono bg-row-alt border border-border rounded-xl text-ink-primary"
                />
              </div>
            </div>

            {/* Dummy Items */}
            <div className="flex-1 overflow-y-auto space-y-2 min-h-[140px]">
              {dummyItems.map((item, idx) => (
                <div key={item.variant_id} className="p-3 bg-row-alt/60 rounded-xl border border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <h4 className="text-xs font-bold text-ink-primary">{item.product_name} - {item.variant_name}</h4>
                    <p className="text-[11px] text-ink-muted">In Van: {item.max_sets} Sets ({item.max_total_pieces} Pcs) • Rate: ₹{item.selling_price}/pc</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div>
                      <label className="text-[10px] text-ink-muted block font-semibold">Sets</label>
                      <input
                        type="number"
                        min="0"
                        value={item.sets_quantity}
                        onFocus={e => e.target.select()}
                        onChange={e => updateDummyRow(idx, 'sets_quantity', e.target.value)}
                        className="w-16 p-1.5 text-xs font-mono font-bold bg-surface border border-border rounded-lg text-center"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-ink-muted block font-semibold">Loose</label>
                      <input
                        type="number"
                        min="0"
                        value={item.loose_quantity}
                        onFocus={e => e.target.select()}
                        onChange={e => updateDummyRow(idx, 'loose_quantity', e.target.value)}
                        className="w-16 p-1.5 text-xs font-mono font-bold bg-surface border border-border rounded-lg text-center"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex justify-between items-center text-xs">
              <span className="font-semibold text-blue-900">Total Proforma Amount</span>
              <span className="font-mono font-extrabold text-blue-950 text-sm">{formatINR(dummyFinalTotal)}</span>
            </div>

            <div className="flex gap-3 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsDummyModalOpen(false)}
                disabled={dummyLoading}
                className="flex-1 py-2.5 rounded-xl border border-border text-xs font-bold text-ink-muted hover:bg-row-alt transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDummyInvoice}
                disabled={dummyLoading || dummyFinalTotal <= 0}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {dummyLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {dummyLoading ? 'Issuing...' : 'Issue Road Proforma'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SINGLE ITEM RETURN MODAL with z-[200] */}
      {isReturnModalOpen && selectedReturnItem && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !returnLoading) setIsReturnModalOpen(false); }}
        >
          <div 
            className="bg-surface w-full max-w-md rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 className="text-base sm:text-lg font-bold text-ink-primary">Return Stock to Warehouse</h2>
              <button 
                onClick={() => setIsReturnModalOpen(false)} 
                disabled={returnLoading}
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full hover:bg-row-alt"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-row-alt rounded-xl space-y-1 text-xs">
              <strong className="text-ink-primary block">{selectedReturnItem.variants?.products?.name} - {selectedReturnItem.variants?.name}</strong>
              <p className="text-ink-muted">In Van: {selectedReturnItem.sets_quantity || 0} Sets ({selectedReturnItem.quantity || 0} Pcs)</p>
            </div>

            {returnError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{returnError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Return Sets</label>
                <input
                  type="number"
                  min="0"
                  value={returnSets}
                  onChange={e => setReturnSets(e.target.value)}
                  className="w-full p-2.5 text-xs font-mono font-bold bg-row-alt border border-border rounded-xl text-center"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">Return Loose Pcs</label>
                <input
                  type="number"
                  min="0"
                  value={returnLoose}
                  onChange={e => setReturnLoose(e.target.value)}
                  className="w-full p-2.5 text-xs font-mono font-bold bg-row-alt border border-border rounded-xl text-center"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsReturnModalOpen(false)}
                disabled={returnLoading}
                className="flex-1 py-2.5 rounded-xl border border-border text-xs font-bold text-ink-muted hover:bg-row-alt transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitSingleReturn}
                disabled={returnLoading}
                className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                {returnLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {returnLoading ? 'Returning...' : 'Confirm Return'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PUT BACK ALL CONFIRMATION MODAL with z-[200] */}
      {isPutBackAllOpen && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !putBackAllLoading) setIsPutBackAllOpen(false); }}
        >
          <div 
            className="bg-surface w-full max-w-md rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <RotateCcw className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-ink-primary">Put Back All Van Stock?</h2>
            </div>

            <p className="text-xs text-ink-muted leading-relaxed">
              This will return all remaining items (<strong>{totalVanSets} sets / {totalVanPieces} pieces</strong>) currently in the van back to the main warehouse inventory.
            </p>

            <div className="flex gap-3 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsPutBackAllOpen(false)}
                disabled={putBackAllLoading}
                className="flex-1 py-2.5 rounded-xl border border-border text-xs font-bold text-ink-muted hover:bg-row-alt transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitPutBackAll}
                disabled={putBackAllLoading}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                {putBackAllLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {putBackAllLoading ? 'Returning All...' : 'Yes, Put Back All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ROAD PROFORMA PDF PREVIEW / PRINT MODAL with z-[200] */}
      {isViewDummyOpen && selectedDummyForView && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget) setIsViewDummyOpen(false); }}
        >
          <div 
            className="bg-surface w-full max-w-2xl rounded-2xl shadow-2xl p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4 max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border print:hidden">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-blue-600" />
                <h2 className="text-base sm:text-lg font-bold text-ink-primary">Road Transit Proforma PDF</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print / Save PDF</span>
                </button>
                <button 
                  onClick={() => setIsViewDummyOpen(false)} 
                  className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full hover:bg-row-alt"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Sheet (Standard A4 Proforma Invoice) */}
            <div id="printable-proforma" className="p-6 bg-white text-gray-900 rounded-xl border border-gray-200 font-sans space-y-4 shadow-xs overflow-y-auto flex-1">
              {/* Header */}
              <div className="border-b-2 border-gray-800 pb-3 flex justify-between items-start">
                <div>
                  <h1 className="text-xl font-black tracking-wider text-gray-900">MELBUN</h1>
                  <p className="text-[11px] text-gray-600 uppercase font-semibold">Wholesale & Distribution</p>
                </div>
                <div className="text-right">
                  <span className="px-2.5 py-1 rounded bg-blue-100 text-blue-900 font-bold text-[10px] uppercase tracking-wider block w-fit ml-auto mb-1">
                    Road Transit Proforma
                  </span>
                  <p className="text-xs font-mono font-bold text-gray-900">{selectedDummyForView.invoice_number}</p>
                  <p className="text-[11px] text-gray-500">{new Date(selectedDummyForView.created_at).toLocaleString('en-IN')}</p>
                </div>
              </div>

              {/* Consignee & Route Details */}
              <div className="grid grid-cols-2 gap-4 text-xs bg-gray-50 p-3 rounded-lg border border-gray-200">
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-bold block">Consignee / Shop</span>
                  <p className="font-bold text-gray-900 text-sm">{selectedDummyForView.shop_name}</p>
                  {selectedDummyForView.shop_phone && (
                    <p className="text-gray-600 font-mono mt-0.5">Phone: {selectedDummyForView.shop_phone}</p>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-gray-500 uppercase font-bold block">Delivered By (Salesman)</span>
                  <p className="font-bold text-gray-900">{staff?.name}</p>
                  {staff?.route_name && <p className="text-gray-600 mt-0.5">Route: {staff.route_name}</p>}
                </div>
              </div>

              {/* Items Table */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-gray-100 font-bold text-gray-700 uppercase tracking-wider text-[10px] border-b border-gray-200">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Item Description</th>
                      <th className="py-2 px-3 text-center">Packaging</th>
                      <th className="py-2 px-3 text-right">Total Pcs</th>
                      <th className="py-2 px-3 text-right">Rate</th>
                      <th className="py-2 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 text-xs">
                    {Array.isArray(selectedDummyForView.items) && selectedDummyForView.items.map((it: any, idx: number) => (
                      <tr key={idx}>
                        <td className="py-2 px-3 font-mono text-gray-500">{idx + 1}</td>
                        <td className="py-2 px-3 font-semibold text-gray-900">{it.variant_name}</td>
                        <td className="py-2 px-3 text-center text-gray-600 font-mono">
                          {it.sets_quantity > 0 ? `${it.sets_quantity} Sets` : ''}
                          {it.sets_quantity > 0 && it.loose_quantity > 0 ? ' + ' : ''}
                          {it.loose_quantity > 0 ? `${it.loose_quantity} Loose` : ''}
                          {it.sets_quantity === 0 && it.loose_quantity === 0 ? `${it.total_pieces} Pcs` : ''}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold">{it.total_pieces}</td>
                        <td className="py-2 px-3 text-right font-mono">{formatINR(it.selling_price)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold">{formatINR((it.total_pieces || 0) * (it.selling_price || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals Breakdown */}
              <div className="flex justify-end pt-2">
                <div className="w-64 space-y-1.5 text-xs">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal:</span>
                    <span className="font-mono font-semibold">{formatINR(selectedDummyForView.subtotal)}</span>
                  </div>
                  {Number(selectedDummyForView.discount_amount || 0) > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>Discount:</span>
                      <span className="font-mono font-semibold">-{formatINR(selectedDummyForView.discount_amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-gray-900 border-t-2 border-gray-800 pt-1.5 text-sm">
                    <span>Final Total:</span>
                    <span className="font-mono">{formatINR(selectedDummyForView.final_total || selectedDummyForView.subtotal)}</span>
                  </div>
                </div>
              </div>

              {/* Proforma Disclaimer */}
              <div className="border-t border-gray-200 pt-3 text-[10px] text-gray-500 text-center leading-relaxed">
                * This document is a road transit proforma estimate issued for line delivery and is not a Tax Invoice.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
