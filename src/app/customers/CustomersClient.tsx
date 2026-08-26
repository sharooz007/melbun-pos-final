'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Loader2, Users, UserX, RotateCcw, UserPlus, X, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { 
  getCustomersListAction, 
  deactivateCustomerAction, 
  reactivateCustomerAction, 
  createCustomerAction 
} from '@/lib/actions/customers';

const formatINR = (amount: number | string | null | undefined) => {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || 0));
  const safeNum = isNaN(num) ? 0 : num;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(safeNum);
};

export default function CustomersClient() {
  const router = useRouter();
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // New Customer Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newGstin, setNewGstin] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [addError, setAddError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const isSubmittingRef = useRef(false);

  const fetchCustomers = useCallback(async (q?: string, inactive: boolean = false) => {
    setLoading(true);
    try {
      const res = await getCustomersListAction(q, inactive);
      if (res.success && res.data) {
        setCustomers(res.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCustomers(search, showInactive);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, showInactive, fetchCustomers]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setAddError('Customer name is required');
      return;
    }
    if (isSubmittingRef.current || isAdding) return;
    isSubmittingRef.current = true;
    setIsAdding(true);
    setAddError('');

    try {
      const res = await createCustomerAction(newName.trim(), newPhone.trim(), newGstin.trim(), newAddress.trim());
      if (res.success && res.data) {
        setIsAddModalOpen(false);
        setNewName('');
        setNewPhone('');
        setNewGstin('');
        setNewAddress('');
        await fetchCustomers(search, showInactive);
        router.push(`/customers/${res.data.id}`);
      } else {
        setAddError(res.error || 'Failed to create customer');
      }
    } finally {
      isSubmittingRef.current = false;
      setIsAdding(false);
    }
  };

  const handleDeactivate = async (e: React.MouseEvent, customer: any) => {
    e.preventDefault();
    e.stopPropagation();

    if (Number(customer.pending_dues || 0) > 0) {
      alert(`Cannot deactivate "${customer.name}". Outstanding debt balance: ₹${Number(customer.pending_dues).toFixed(2)}. Please settle dues before deactivating.`);
      return;
    }
    if (Number(customer.credit_balance || 0) > 0) {
      alert(`Cannot deactivate "${customer.name}". Unused store credit balance: ₹${Number(customer.credit_balance).toFixed(2)}. Please refund or utilize credit first.`);
      return;
    }

    if (confirm(`Are you sure you want to deactivate customer "${customer.name}"?`)) {
      const res = await deactivateCustomerAction(customer.id);
      if (res.success) {
        if (showInactive) {
          setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, is_active: false } : c));
        } else {
          setCustomers(prev => prev.filter(c => c.id !== customer.id));
        }
      } else {
        alert('Failed to deactivate: ' + res.error);
      }
    }
  };

  const handleReactivate = async (e: React.MouseEvent, customer: any) => {
    e.preventDefault();
    e.stopPropagation();
    const res = await reactivateCustomerAction(customer.id);
    if (res.success) {
      fetchCustomers(search, showInactive);
    } else {
      alert('Failed to reactivate: ' + res.error);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-4">
      {/* Search & Actions Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input 
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name, phone, GSTIN..."
            className="w-full pl-10 pr-9 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent text-ink-primary shadow-2xs"
          />
          {search && (
            <button 
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-primary p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Inactive Filter Toggle */}
          <button
            type="button"
            onClick={() => setShowInactive(!showInactive)}
            className={`flex-1 sm:flex-none px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition border shadow-2xs min-h-[40px] ${
              showInactive 
                ? 'bg-amber-50 border-amber-300 text-amber-900' 
                : 'bg-surface border-border text-ink-muted hover:bg-row-alt'
            }`}
          >
            {showInactive ? <UserX className="w-4 h-4 text-amber-700" /> : <Users className="w-4 h-4 text-ink-muted" />}
            <span>{showInactive ? 'Showing Inactive' : 'Active Only'}</span>
          </button>

          {/* New Customer Button */}
          <button
            type="button"
            onClick={() => {
              setAddError('');
              setIsAddModalOpen(true);
            }}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-xs min-h-[40px]"
          >
            <UserPlus className="w-4 h-4" />
            <span>New Customer</span>
          </button>
        </div>
      </div>

      {/* Customer List Card Directory */}
      <div className="flex-1 bg-surface rounded-2xl overflow-hidden flex flex-col shadow-xs border border-border">
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 flex justify-center items-center">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
            </div>
          ) : customers.length === 0 ? (
            <div className="p-12 text-center text-ink-muted text-sm space-y-2">
              <Users className="w-8 h-8 text-ink-muted mx-auto stroke-1" />
              <p className="font-semibold text-ink-primary">No customers found</p>
              <p className="text-xs">Try adjusting your search query or add a new customer.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {customers.map((c) => {
                const dues = Number(c.pending_dues || 0);
                const credit = Number(c.credit_balance || 0);
                return (
                  <div 
                    key={c.id} 
                    onClick={() => router.push(`/customers/${c.id}`)} 
                    className="p-4 hover:bg-row-alt/40 transition-colors cursor-pointer flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm sm:text-base text-ink-primary truncate">
                          {c.name}
                        </span>
                        {!c.is_active && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-100 text-red-800 border border-red-200 uppercase">
                            Inactive
                          </span>
                        )}
                        {credit > 0 && (
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">
                            Wallet: {formatINR(credit)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-ink-muted mt-1 flex-wrap">
                        <span className="font-mono">{c.phone || 'No phone'}</span>
                        <span>•</span>
                        <span>{c.total_visits || 0} visit{c.total_visits !== 1 ? 's' : ''}</span>
                        <span>•</span>
                        <span>Total Spend: <strong className="text-ink-primary font-mono">{formatINR(c.total_spend)}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-border" onClick={(e) => e.stopPropagation()}>
                      <div className="text-left sm:text-right">
                        <div className={`text-xs sm:text-sm font-bold font-mono ${dues > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
                          {dues > 0 ? `${formatINR(dues)} Due` : 'No Dues'}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {c.is_active ? (
                          <button 
                            onClick={(e) => handleDeactivate(e, c)}
                            className="px-2.5 py-1 text-xs text-ink-muted hover:text-red-600 hover:bg-red-50 font-medium rounded-lg transition"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button 
                            onClick={(e) => handleReactivate(e, c)}
                            className="px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 font-bold rounded-lg transition flex items-center gap-1"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Reactivate
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3.5 border-t border-border bg-row-alt/40 text-xs text-ink-muted flex justify-between items-center">
          <span>Total {customers.length} customer{customers.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* New Customer Onboarding Modal with z-[200] */}
      {isAddModalOpen && (
        <div 
          className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !isAdding) setIsAddModalOpen(false); }}
        >
          <div 
            className="bg-surface rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-border animate-in zoom-in-95 duration-150 cursor-default"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-border">
              <h3 className="text-base font-bold text-ink-primary flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-accent" />
                Register New Customer
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                disabled={isAdding}
                className="p-1.5 text-ink-muted hover:text-ink-primary hover:bg-row-alt rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {addError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{addError}</span>
              </div>
            )}

            <form onSubmit={handleCreateCustomer} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">
                  Customer / Business Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar / Sharma Textiles"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full p-2.5 bg-surface border border-border rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-accent text-ink-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="10-digit mobile number"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full p-2.5 bg-surface border border-border rounded-xl text-xs font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-accent text-ink-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">
                  GSTIN (Optional)
                </label>
                <input
                  type="text"
                  placeholder="15-digit GSTIN (e.g. 29AAAAA0000A1Z5)"
                  value={newGstin}
                  onChange={(e) => setNewGstin(e.target.value.toUpperCase())}
                  className="w-full p-2.5 bg-surface border border-border rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent text-ink-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">
                  Billing Address (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Shop / warehouse address"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full p-2.5 bg-surface border border-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-accent text-ink-primary"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  disabled={isAdding}
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-ink-muted hover:bg-row-alt rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAdding}
                  className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs disabled:opacity-50 transition"
                >
                  {isAdding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create Customer</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
