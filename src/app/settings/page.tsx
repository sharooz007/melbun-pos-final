'use client'

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Settings, 
  Store, 
  Clock, 
  ShieldCheck, 
  LogOut, 
  Save, 
  CheckCircle2, 
  AlertCircle,
  Building,
  Phone,
  Mail,
  FileText,
  MapPin,
  Globe,
  RotateCcw,
  Sparkles,
  Receipt,
  QrCode,
  Check,
  Calendar,
  Lock
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { getStoreSettingsAction, updateStoreSettingsAction } from '@/lib/actions/settings';
import { StoreSettings } from '@/types/settings';
import toast from 'react-hot-toast';

const HOURS = [
  { value: 0, label: '12:00 AM (Midnight)' },
  { value: 1, label: '01:00 AM' },
  { value: 2, label: '02:00 AM' },
  { value: 3, label: '03:00 AM' },
  { value: 4, label: '04:00 AM' },
  { value: 5, label: '05:00 AM' },
  { value: 6, label: '06:00 AM (Recommended Default)' },
  { value: 7, label: '07:00 AM' },
  { value: 8, label: '08:00 AM' },
  { value: 9, label: '09:00 AM' },
  { value: 10, label: '10:00 AM' },
  { value: 11, label: '11:00 AM' },
  { value: 12, label: '12:00 PM (Noon)' },
  { value: 13, label: '01:00 PM' },
  { value: 14, label: '02:00 PM' },
  { value: 15, label: '03:00 PM' },
  { value: 16, label: '04:00 PM' },
  { value: 17, label: '05:00 PM' },
  { value: 18, label: '06:00 PM' },
  { value: 19, label: '07:00 PM' },
  { value: 20, label: '08:00 PM' },
  { value: 21, label: '09:00 PM' },
  { value: 22, label: '10:00 PM' },
  { value: 23, label: '11:00 PM' },
];

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  // Form State
  const [storeName, setStoreName] = useState('Melbon Wholesale');
  const [tagline, setTagline] = useState('Premium Wholesale & Retail POS');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gstin, setGstin] = useState('');
  const [startHour, setStartHour] = useState<number>(6);
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  // Baseline Snapshot for Dirty Tracking & Discard
  const [initialData, setInitialData] = useState<StoreSettings | null>(null);

  // Live IST Clock for Timezone Card
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      try {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        }).format(now);
        setCurrentTimeStr(formatted);
      } catch {
        setCurrentTimeStr(new Date().toLocaleTimeString());
      }
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Compute isDirty
  const isDirty = useMemo(() => {
    if (!initialData) return false;
    return (
      storeName !== (initialData.store_name || '') ||
      tagline !== (initialData.tagline || '') ||
      address !== (initialData.address || '') ||
      phone !== (initialData.phone || '') ||
      email !== (initialData.email || '') ||
      gstin !== (initialData.gstin || '') ||
      startHour !== (initialData.business_day_start_hour ?? 6) ||
      timezone !== (initialData.timezone || 'Asia/Kolkata')
    );
  }, [initialData, storeName, tagline, address, phone, email, gstin, startHour, timezone]);

  // BeforeUnload Guard
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Load Settings
  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getStoreSettingsAction();
      if (res.success && res.data) {
        setInitialData(res.data);
        setStoreName(res.data.store_name || '');
        setTagline(res.data.tagline || '');
        setAddress(res.data.address || '');
        setPhone(res.data.phone || '');
        setEmail(res.data.email || '');
        setGstin(res.data.gstin || '');
        setStartHour(res.data.business_day_start_hour ?? 6);
        setTimezone(res.data.timezone || 'Asia/Kolkata');
        if (res.data.updated_at) {
          setLastSavedTime(new Date(res.data.updated_at).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          }));
        }
      }
    } catch {
      toast.error('Failed to load store settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Discard Changes
  const handleDiscard = () => {
    if (!initialData) return;
    setStoreName(initialData.store_name || '');
    setTagline(initialData.tagline || '');
    setAddress(initialData.address || '');
    setPhone(initialData.phone || '');
    setEmail(initialData.email || '');
    setGstin(initialData.gstin || '');
    setStartHour(initialData.business_day_start_hour ?? 6);
    setTimezone(initialData.timezone || 'Asia/Kolkata');
    toast.success('Changes reverted to saved profile.');
  };

  // Save Settings
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (saving) return;

    const trimmedName = storeName.trim();
    if (!trimmedName) {
      toast.error('Store / Business Name is required.');
      return;
    }

    if (gstin.trim()) {
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstinRegex.test(gstin.trim().toUpperCase())) {
        toast.error('Invalid GSTIN format: Must be 15 alphanumeric characters (e.g. 29ABCDE1234F1Z5).');
        return;
      }
    }

    try {
      setSaving(true);
      const res = await updateStoreSettingsAction({
        store_name: trimmedName,
        tagline: tagline.trim() ? tagline.trim() : null,
        address: address.trim() ? address.trim() : null,
        phone: phone.trim() ? phone.trim() : null,
        email: email.trim() ? email.trim() : null,
        gstin: gstin.trim() ? gstin.trim().toUpperCase() : null,
        business_day_start_hour: startHour,
        timezone: timezone.trim() || 'Asia/Kolkata'
      });

      if (res.success && res.data) {
        setInitialData(res.data);
        setLastSavedTime(new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }));
        toast.success('Store & reporting settings saved successfully!');
      } else {
        toast.error(res.error || 'Failed to save settings.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'An error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  // Keyboard shortcut: Cmd+S / Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handleLogout = async () => {
    if (confirm('Are you sure you want to end your session and sign out from this terminal?')) {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <div className="p-3.5 pb-36 sm:p-6 md:p-8 md:pb-12 max-w-6xl w-full mx-auto space-y-6 bg-canvas min-h-screen text-ink-primary font-sans">
      {/* Top Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink-primary flex items-center gap-2.5">
            <Settings className="w-6 h-6 text-accent" />
            System & Store Settings
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            Configure business day timing, legal store profile, and live receipt branding.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-surface border border-border rounded-full text-xs font-semibold text-ink-muted shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>{lastSavedTime ? `Synced at ${lastSavedTime}` : 'Cloud Connected'}</span>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center text-ink-muted gap-3">
          <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs font-semibold">Loading store configuration...</span>
        </div>
      ) : (
        <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT COLUMN: Configuration Forms (7 cols on desktop) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Card 1: Business Day & Reporting Engine */}
            <div className="bg-surface p-5 sm:p-6 rounded-2xl border border-border shadow-xs space-y-5">
              <div className="flex items-center gap-3 border-b border-border pb-3.5">
                <div className="p-2 bg-accent/10 text-accent rounded-xl">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-ink-primary">
                    Business Day & Reporting Cutoff
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Automates how late-night transactions roll into daily sales reports.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-ink-primary mb-1.5">
                    Business Day Start Cutoff Hour
                  </label>
                  <select
                    value={startHour}
                    onChange={(e) => setStartHour(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm font-semibold text-ink-primary focus:ring-2 focus:ring-accent focus:bg-surface outline-none transition min-h-[44px] cursor-pointer"
                  >
                    {HOURS.map((h) => (
                      <option key={h.value} value={h.value}>
                        {h.label}
                      </option>
                    ))}
                  </select>

                  <div className="mt-2.5 p-3 bg-row-alt rounded-xl border border-border/70 text-xs text-ink-muted leading-relaxed">
                    {startHour === 0 ? (
                      <p>
                        Transactions are grouped using standard <strong className="text-ink-primary">12:00 AM to 11:59 PM</strong> calendar day boundaries for Dashboard and Reports. Exact timestamps are always preserved on receipts.
                      </p>
                    ) : (
                      <p>
                        Transactions occurring between <strong className="text-ink-primary">12:00 AM (Midnight)</strong> and <strong className="text-ink-primary">{startHour === 12 ? '12:00 PM' : startHour < 12 ? `${startHour}:00 AM` : `${startHour - 12}:00 PM`}</strong> will automatically be attributed to the <strong className="text-ink-primary font-bold">previous business day</strong> in reports.
                      </p>
                    )}
                  </div>
                </div>

                {/* Operating Timezone */}
                <div className="pt-2 border-t border-border/60">
                  <label className="block text-xs font-bold text-ink-primary mb-1.5">
                    Store Operating Timezone & Live Clock
                  </label>
                  <div className="flex items-center justify-between gap-3 p-3 bg-row-alt border border-border rounded-xl">
                    <div className="flex items-center gap-2 text-xs font-semibold text-ink-primary">
                      <Globe className="w-4 h-4 text-accent" />
                      <span>{timezone} (IST · UTC+05:30)</span>
                    </div>
                    {currentTimeStr && (
                      <span className="text-xs font-mono font-bold text-accent bg-surface px-2.5 py-1 rounded-lg border border-border">
                        {currentTimeStr}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Store Identity & Legal Profile */}
            <div className="bg-surface p-5 sm:p-6 rounded-2xl border border-border shadow-xs space-y-5">
              <div className="flex items-center gap-3 border-b border-border pb-3.5">
                <div className="p-2 bg-accent/10 text-accent rounded-xl">
                  <Store className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-ink-primary">
                    Store Profile & Receipt Branding
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Information printed on customer thermal invoices, PDF bills, and store reports.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Store Name */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-ink-primary mb-1.5 flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-accent" /> Store / Business Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="e.g. Melbon Wholesale"
                    className="w-full px-3.5 py-2.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm font-semibold text-ink-primary focus:ring-2 focus:ring-accent focus:bg-surface outline-none transition min-h-[44px]"
                  />
                </div>

                {/* Tagline */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-ink-primary mb-1.5 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-ink-muted" /> Tagline / Subtitle
                  </label>
                  <input
                    type="text"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    placeholder="e.g. Premium Wholesale & Retail POS"
                    className="w-full px-3.5 py-2.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm font-semibold text-ink-primary focus:ring-2 focus:ring-accent focus:bg-surface outline-none transition min-h-[44px]"
                  />
                </div>

                {/* Contact Phone */}
                <div>
                  <label className="block text-xs font-bold text-ink-primary mb-1.5 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-ink-muted" /> Contact Phone
                  </label>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +91 98765 43210"
                    className="w-full px-3.5 py-2.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm font-mono font-semibold text-ink-primary focus:ring-2 focus:ring-accent focus:bg-surface outline-none transition min-h-[44px]"
                  />
                </div>

                {/* Billing Email */}
                <div>
                  <label className="block text-xs font-bold text-ink-primary mb-1.5 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-ink-muted" /> Billing Email
                  </label>
                  <input
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. billing@melbonwholesale.com"
                    className="w-full px-3.5 py-2.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm font-semibold text-ink-primary focus:ring-2 focus:ring-accent focus:bg-surface outline-none transition min-h-[44px]"
                  />
                </div>

                {/* GSTIN */}
                <div className="sm:col-span-2">
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-bold text-ink-primary flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-accent" /> GSTIN / Tax Identification
                    </label>
                    <span className="text-[10px] font-mono font-bold text-ink-muted">
                      {gstin.length}/15 chars
                    </span>
                  </div>
                  <input
                    type="text"
                    maxLength={15}
                    autoCapitalize="characters"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="e.g. 29ABCDE1234F1Z5"
                    className="w-full px-3.5 py-2.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm font-mono font-bold text-ink-primary uppercase tracking-wider focus:ring-2 focus:ring-accent focus:bg-surface outline-none transition min-h-[44px]"
                  />
                </div>

                {/* Address */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-ink-primary mb-1.5 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-ink-muted" /> Store Address
                  </label>
                  <textarea
                    rows={2}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Street address, market name, city, state, and pincode"
                    className="w-full px-3.5 py-2.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm font-medium text-ink-primary focus:ring-2 focus:ring-accent focus:bg-surface outline-none transition resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Card 3: Session & Security */}
            <div className="bg-surface p-5 sm:p-6 rounded-2xl border border-border shadow-xs space-y-4">
              <div className="flex items-center gap-3 border-b border-border pb-3.5">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-ink-primary">
                    Terminal Session & Authentication
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Active cashier session is secured with Supabase token authentication.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <p className="text-xs text-ink-muted max-w-md">
                  When closing the cash register or leaving the counter unattended, safely sign out from this terminal.
                </p>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs rounded-xl border border-red-200 transition cursor-pointer min-h-[40px] shrink-0"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out Terminal
                </button>
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN: Live Receipt Header Preview (5 cols on desktop, sticky) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="sticky top-20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
                  <Receipt className="w-4 h-4 text-accent" /> Live Receipt Header Preview
                </span>
                <span className="text-[10px] bg-accent/10 text-accent font-bold px-2 py-0.5 rounded-full">
                  Real-time
                </span>
              </div>

              {/* Thermal Paper Simulation Card */}
              <div className="bg-surface rounded-2xl border-2 border-dashed border-border p-6 shadow-sm space-y-4 font-mono text-center relative overflow-hidden">
                {/* Store Header Simulation */}
                <div className="space-y-1 border-b border-dashed border-border pb-4">
                  <h3 className="font-extrabold text-base tracking-tight text-ink-primary uppercase truncate">
                    {storeName || 'MELBON POS'}
                  </h3>
                  {tagline && (
                    <p className="text-[11px] text-ink-muted font-sans font-medium">
                      {tagline}
                    </p>
                  )}
                  {address && (
                    <p className="text-[10px] text-ink-muted leading-tight pt-1 max-w-xs mx-auto">
                      {address}
                    </p>
                  )}
                  <div className="pt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[10px] text-ink-muted">
                    {phone && <span>Tel: {phone}</span>}
                    {email && <span>Email: {email}</span>}
                  </div>
                  {gstin && (
                    <div className="pt-1 text-[11px] font-bold text-ink-primary">
                      GSTIN: {gstin}
                    </div>
                  )}
                </div>

                {/* Simulated Invoice Body */}
                <div className="space-y-2 text-[11px] text-left text-ink-muted">
                  <div className="flex justify-between border-b border-border/50 pb-1">
                    <span>INVOICE: #MELBON-PREVIEW</span>
                    <span>{new Date().toLocaleDateString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-ink-primary font-bold">
                    <span>Sample Premium Item × 2</span>
                    <span>₹1,499.00</span>
                  </div>
                  <div className="flex justify-between text-ink-muted">
                    <span>CGST (2.5%) + SGST (2.5%)</span>
                    <span>₹74.95</span>
                  </div>
                  <div className="flex justify-between text-ink-primary font-extrabold text-xs pt-1 border-t border-dashed border-border">
                    <span>TOTAL AMOUNT</span>
                    <span className="text-accent">₹1,573.95</span>
                  </div>
                </div>

                {/* Footer Simulation */}
                <div className="pt-3 border-t border-dashed border-border text-[10px] text-ink-muted text-center space-y-1">
                  <p>*** THANK YOU FOR SHOPPING ***</p>
                  <p className="text-[9px] text-ink-muted/70">Powered by Melbon Engine</p>
                </div>
              </div>

              {/* Quick Save Hint */}
              <div className="p-3.5 bg-surface rounded-xl border border-border text-xs text-ink-muted flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-accent shrink-0" />
                <span>
                  Tip: Press <kbd className="px-1.5 py-0.5 bg-row-alt border border-border rounded font-mono font-bold text-ink-primary text-[10px]">Cmd+S</kbd> or <kbd className="px-1.5 py-0.5 bg-row-alt border border-border rounded font-mono font-bold text-ink-primary text-[10px]">Ctrl+S</kbd> to save at any time.
                </span>
              </div>
            </div>
          </div>

          {/* FLOATING ACTION BAR WHEN DIRTY */}
          {isDirty && (
            <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[80] w-[92%] max-w-2xl bg-ink-primary text-white p-3 sm:p-4 rounded-2xl shadow-2xl border border-white/10 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
                <span className="text-xs sm:text-sm font-bold text-white">
                  Unsaved configuration changes
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={saving}
                  className="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-accent hover:bg-accent-hover text-white font-bold text-xs rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 min-h-[36px]"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving...' : 'Save Settings'}</span>
                </button>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
