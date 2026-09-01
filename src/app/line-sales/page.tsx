'use client';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Truck, 
  Search, 
  Phone, 
  MapPin, 
  Package, 
  UserPlus, 
  X, 
  Loader2, 
  AlertCircle,
  ChevronRight,
  UserCheck
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { 
  getLineStaffListAction, 
  createLineStaffAction 
} from '@/lib/actions/line-sales';
import toast from 'react-hot-toast';

export default function LineSalesHubPage() {
  const router = useRouter();
  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const isSubmittingRef = useRef(false);

  // Add Staff Modal
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [staffPhone, setStaffPhone] = useState('');
  const [staffRoute, setStaffRoute] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLineStaffListAction();
      if (res.success && res.data) {
        setStaffList(res.data);
      } else {
        toast.error(res.error || 'Failed to load line staff');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error loading line sales');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCloseModal = () => {
    if (addLoading) return;
    setIsAddStaffOpen(false);
    setStaffName('');
    setStaffPhone('');
    setStaffRoute('');
    setAddError('');
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || addLoading) return;
    if (!staffName.trim() || !staffPhone.trim()) {
      setAddError('Staff Name and Phone Number are required.');
      return;
    }

    isSubmittingRef.current = true;
    setAddLoading(true);
    setAddError('');

    try {
      const res = await createLineStaffAction({
        name: staffName.trim(),
        phone: staffPhone.trim(),
        route_name: staffRoute.trim() || null
      });

      if (res.success && res.data) {
        toast.success(`Line staff "${res.data.name}" added successfully!`);
        handleCloseModal();
        await loadData();
      } else {
        setAddError(res.error || 'Failed to create line staff');
      }
    } catch (err: any) {
      setAddError(err?.message || 'Error creating line staff');
    } finally {
      isSubmittingRef.current = false;
      setAddLoading(false);
    }
  };

  const [selectedRoute, setSelectedRoute] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  const routesList = useMemo(() => {
    const set = new Set<string>();
    staffList.forEach(s => {
      if (s.route_name && s.route_name.trim()) set.add(s.route_name.trim());
    });
    return Array.from(set);
  }, [staffList]);

  const filteredStaff = staffList.filter(s => {
    // Status Filter
    if (statusFilter === 'ACTIVE' && !s.is_active) return false;
    if (statusFilter === 'INACTIVE' && s.is_active) return false;

    // Route Filter
    if (selectedRoute !== 'ALL' && s.route_name !== selectedRoute) return false;

    // Search Query
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      (s.phone && s.phone.includes(q)) ||
      (s.route_name && s.route_name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="p-3.5 pb-36 sm:p-6 md:p-8 md:pb-12 max-w-7xl w-full mx-auto space-y-6 bg-canvas min-h-screen text-ink-primary font-sans">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-primary flex items-center gap-2.5">
            <Truck className="w-6 h-6 text-accent" />
            Line Sales (Van Distribution)
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            Manage field salesmen, dispatch perpetual van inventory, bill returned sales, and restock warehouse items.
          </p>
        </div>

        <button
          onClick={() => { setAddError(''); setIsAddStaffOpen(true); }}
          className="px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-xs transition cursor-pointer w-fit"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add Line Staff</span>
        </button>
      </header>

      {/* Search & Status Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search line staff by name, phone, or route..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-xs sm:text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-accent text-white shadow-2xs'
                : 'bg-surface border border-border text-ink-muted hover:text-ink-primary'
            }`}
          >
            All ({staffList.length})
          </button>
          <button
            onClick={() => setStatusFilter('ACTIVE')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              statusFilter === 'ACTIVE'
                ? 'bg-emerald-600 text-white shadow-2xs'
                : 'bg-surface border border-border text-ink-muted hover:text-ink-primary'
            }`}
          >
            Active ({staffList.filter(s => s.is_active).length})
          </button>
          <button
            onClick={() => setStatusFilter('INACTIVE')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              statusFilter === 'INACTIVE'
                ? 'bg-gray-700 text-white shadow-2xs'
                : 'bg-surface border border-border text-ink-muted hover:text-ink-primary'
            }`}
          >
            Inactive ({staffList.filter(s => !s.is_active).length})
          </button>
        </div>
      </div>

      {/* Route Filter Pills */}
      {routesList.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="text-xs font-bold text-ink-muted mr-1 shrink-0">Routes:</span>
          <button
            onClick={() => setSelectedRoute('ALL')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer shrink-0 ${
              selectedRoute === 'ALL'
                ? 'bg-row-alt text-ink-primary border border-ink-primary/20'
                : 'bg-surface border border-border text-ink-muted hover:text-ink-primary'
            }`}
          >
            All Routes
          </button>
          {routesList.map(r => (
            <button
              key={r}
              onClick={() => setSelectedRoute(r)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer shrink-0 ${
                selectedRoute === r
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'bg-surface border border-border text-ink-muted hover:text-ink-primary'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {/* Staff Grid */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center text-ink-muted gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <span className="text-xs font-semibold">Loading line sales directory...</span>
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="bg-surface rounded-2xl p-12 text-center border border-border space-y-3">
          <Truck className="w-12 h-12 text-ink-muted/50 mx-auto" />
          <h3 className="text-base font-bold text-ink-primary">No Line Staff Found</h3>
          <p className="text-xs text-ink-muted max-w-md mx-auto">
            {searchQuery ? 'No line staff matched your search query.' : 'Add your first field salesman to start perpetual van inventory dispatch and billing.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStaff.map((staff) => (
            <div 
              key={staff.id}
              onClick={() => router.push(`/line-sales/${staff.id}`)}
              className="bg-surface border border-border hover:border-accent/40 rounded-2xl p-5 shadow-xs hover:shadow-md transition cursor-pointer flex flex-col justify-between space-y-4 group"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent font-bold flex items-center justify-center text-sm">
                      {staff.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-ink-primary group-hover:text-accent transition">
                        {staff.name}
                      </h3>
                      <p className="text-[11px] text-ink-muted font-mono flex items-center gap-1">
                        <Phone className="w-3 h-3 text-ink-muted" /> {staff.phone || 'No phone recorded'}
                      </p>
                    </div>
                  </div>

                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    staff.is_active 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                      : 'bg-gray-100 text-gray-600 border-gray-200'
                  }`}>
                    {staff.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/60 text-xs">
                  <div>
                    <span className="text-[10px] text-ink-muted block">Route</span>
                    <span className="font-semibold text-ink-primary flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-ink-muted" /> {staff.route_name || 'All Routes'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-ink-muted block">Billing Account</span>
                    <span className="font-semibold text-ink-primary flex items-center gap-1">
                      <UserCheck className="w-3 h-3 text-emerald-600" /> Linked
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-border flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-accent font-bold">
                  <Package className="w-4 h-4" />
                  <span>Open Van Inventory</span>
                </div>
                <ChevronRight className="w-4 h-4 text-ink-muted group-hover:text-accent group-hover:translate-x-0.5 transition" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ADD LINE STAFF MODAL with z-[200] */}
      {isAddStaffOpen && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto cursor-pointer animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget && !addLoading) handleCloseModal(); }}
        >
          <div 
            className="bg-surface w-full max-w-md rounded-2xl shadow-2xl p-5 sm:p-6 border border-border animate-in zoom-in-95 duration-150 cursor-default space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-accent" />
                <h2 className="text-base font-bold text-ink-primary">Add Line Sales Staff</h2>
              </div>
              <button 
                onClick={handleCloseModal} 
                disabled={addLoading}
                className="p-1.5 text-ink-muted hover:text-ink-primary rounded-full hover:bg-row-alt"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {addError && (
              <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-xl border border-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{addError}</span>
              </div>
            )}

            <form onSubmit={handleCreateStaff} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  placeholder="e.g. Ramesh Kumar"
                  value={staffName}
                  onChange={e => setStaffName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  maxLength={20}
                  placeholder="e.g. 9876543210"
                  value={staffPhone}
                  onChange={e => setStaffPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm font-mono text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-primary mb-1">
                  Route Name (Optional)
                </label>
                <input
                  type="text"
                  maxLength={100}
                  placeholder="e.g. North Zone / Highway Line"
                  value={staffRoute}
                  onChange={e => setStaffRoute(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div className="flex gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={addLoading}
                  className="flex-1 py-2.5 rounded-xl border border-border text-xs font-bold text-ink-muted hover:bg-row-alt transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-bold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  {addLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {addLoading ? 'Adding...' : 'Add Linesman'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
