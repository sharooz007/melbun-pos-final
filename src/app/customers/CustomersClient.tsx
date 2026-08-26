'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Loader2, Users, UserX, RotateCcw, UserPlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { 
  getCustomersListAction, 
  deactivateCustomerAction, 
  reactivateCustomerAction,
  createCustomerAction 
} from '@/lib/actions/customers';

export default function CustomersClient() {
  const router = useRouter();
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // New Customer Modal State (CUST-02)
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
    const res = await getCustomersListAction(q, inactive);
    if (res.success && res.data) {
      setCustomers(res.data);
    }
    setLoading(false);
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCustomers(search, showInactive);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, showInactive, fetchCustomers]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setAddError('Customer name is required');
      return;
    }
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsAdding(true);
    setAddError('');

    try {
      const res = await createCustomerAction(newName, newPhone, newGstin, newAddress);
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

    // Guard: Block deactivating customer with outstanding balance or store credit
    if (Number(customer.pending_dues || 0) > 0) {
      alert(`Cannot deactivate customer "${customer.name}". They have an outstanding debt of ₹${Number(customer.pending_dues).toFixed(2)}. Please settle all pending dues before deactivating.`);
      return;
    }
    if (Number(customer.credit_balance || 0) > 0) {
      alert(`Cannot deactivate customer "${customer.name}". They have an unused store credit wallet balance of ₹${Number(customer.credit_balance).toFixed(2)}. Please refund or utilize credit before deactivating.`);
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
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <Search className="w-4 h-4 text-ink-muted" />
          </div>
          <input 
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name or phone..."
            className="w-full pl-10 pr-4 py-3 bg-white rounded-[8px] text-[14px] focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
          />
        </div>

        {/* Show Inactive Filter Toggle */}
        <button
          type="button"
          onClick={() => setShowInactive(!showInactive)}
          className={`px-4 py-3 rounded-[8px] text-[13px] font-bold flex items-center gap-2 transition-colors border ${
            showInactive 
              ? 'bg-amber-100 border-amber-300 text-amber-900 shadow-xs' 
              : 'bg-white border-border text-ink-muted hover:bg-gray-50'
          }`}
        >
          {showInactive ? <UserX className="w-4 h-4 text-amber-700" /> : <Users className="w-4 h-4 text-gray-500" />}
          {showInactive ? 'Showing Inactive' : 'Active Only'}
        </button>

        {/* Add New Customer Button (CUST-02) */}
        <button
          type="button"
          onClick={() => {
            setAddError('');
            setIsAddModalOpen(true);
          }}
          className="px-4 py-3 bg-[#A83D24] hover:bg-[#91321C] text-white rounded-[8px] text-[13px] font-bold flex items-center gap-2 transition-colors shadow-xs"
        >
          <UserPlus className="w-4 h-4" />
          New Customer
        </button>
      </div>

      <div className="flex-1 bg-white rounded-[12px] overflow-hidden flex flex-col shadow-sm border border-border">
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 text-ink-muted animate-spin" /></div>
          ) : customers.length === 0 ? (
            <div className="p-8 text-center text-ink-muted text-[14px]">No customers found.</div>
          ) : (
            <div className="divide-y divide-border">
              {customers.map((c) => (
                <div 
                  key={c.id} 
                  onClick={() => router.push(`/customers/${c.id}`)} 
                  className="p-5 hover:bg-gray-50 transition-colors cursor-pointer flex justify-between items-start"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[15px] text-ink-primary uppercase">{c.name}</span>
                      {!c.is_active && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 uppercase">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] text-ink-muted font-mono mb-1">{c.phone || 'No Phone'}</div>
                    <div className="text-[12px] text-ink-muted">
                      {c.total_visits} visit{c.total_visits !== 1 ? 's' : ''} • Spend ₹{Number(c.total_spend || 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2" onClick={(e) => e.stopPropagation()}>
                    <div className={`text-[13px] font-bold ${Number(c.pending_dues || 0) > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                      ₹{Math.max(0, Number(c.pending_dues || 0)).toFixed(2)} Outstanding
                    </div>
                    {c.is_active ? (
                      <button 
                        onClick={(e) => handleDeactivate(e, c)}
                        className="text-[12px] text-ink-muted hover:text-red-600 font-medium"
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button 
                        onClick={(e) => handleReactivate(e, c)}
                        className="text-[12px] text-emerald-700 hover:text-emerald-800 font-bold flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Reactivate
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-border bg-gray-50 text-[13px] text-ink-muted flex justify-between items-center">
          <span>Total {customers.length} customer{customers.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* New Customer Onboarding Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-[#A83D24]" />
                Register New Customer
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {addError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700 mb-4">
                {addError}
              </div>
            )}

            <form onSubmit={handleCreateCustomer} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-700 mb-1">
                  Customer / Business Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar / Sharma Textiles"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-gray-700 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="10-digit mobile number"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-gray-700 mb-1">
                  GSTIN (Optional)
                </label>
                <input
                  type="text"
                  placeholder="15-digit GSTIN (e.g. 29AAAAA0000A1Z5)"
                  value={newGstin}
                  onChange={(e) => setNewGstin(e.target.value.toUpperCase())}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-gray-700 mb-1">
                  Billing Address (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Shop / warehouse address"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#A83D24]"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={isAdding}
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAdding}
                  className="px-5 py-2 bg-[#A83D24] hover:bg-[#91321C] text-white rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                >
                  {isAdding && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
