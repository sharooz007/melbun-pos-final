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
  Lock,
  MessageSquare,
  Send,
  RefreshCw,
  Sliders,
  Sun,
  Moon,
  Laptop
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { getStoreSettingsAction, updateStoreSettingsAction } from '@/lib/actions/settings';
import { StoreSettings } from '@/types/settings';
import { 
  DEFAULT_WHATSAPP_INVOICE_TEMPLATE, 
  DEFAULT_WHATSAPP_DUE_REMINDER_TEMPLATE, 
  formatWhatsAppMessage 
} from '@/lib/whatsapp';
import { useTheme } from '@/components/theme/ThemeProvider';
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
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  // Form State
  const [storeName, setStoreName] = useState('Melbun Wholesale');
  const [tagline, setTagline] = useState('Premium Wholesale & Retail POS');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gstin, setGstin] = useState('');
  const [startHour, setStartHour] = useState<number>(6);
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [whatsappInvoiceTemplate, setWhatsappInvoiceTemplate] = useState(DEFAULT_WHATSAPP_INVOICE_TEMPLATE);
  const [whatsappDueReminderTemplate, setWhatsappDueReminderTemplate] = useState(DEFAULT_WHATSAPP_DUE_REMINDER_TEMPLATE);
  const [activeTemplateTab, setActiveTemplateTab] = useState<'invoice' | 'due'>('invoice');
  const [rightPreviewTab, setRightPreviewTab] = useState<'receipt' | 'whatsapp' | 'invoice'>('invoice');

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
      timezone !== (initialData.timezone || 'Asia/Kolkata') ||
      whatsappInvoiceTemplate !== (initialData.whatsapp_invoice_template || DEFAULT_WHATSAPP_INVOICE_TEMPLATE) ||
      whatsappDueReminderTemplate !== (initialData.whatsapp_due_reminder_template || DEFAULT_WHATSAPP_DUE_REMINDER_TEMPLATE)
    );
  }, [initialData, storeName, tagline, address, phone, email, gstin, startHour, timezone, whatsappInvoiceTemplate, whatsappDueReminderTemplate]);

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
        setWhatsappInvoiceTemplate(res.data.whatsapp_invoice_template || DEFAULT_WHATSAPP_INVOICE_TEMPLATE);
        setWhatsappDueReminderTemplate(res.data.whatsapp_due_reminder_template || DEFAULT_WHATSAPP_DUE_REMINDER_TEMPLATE);
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
    setWhatsappInvoiceTemplate(initialData.whatsapp_invoice_template || DEFAULT_WHATSAPP_INVOICE_TEMPLATE);
    setWhatsappDueReminderTemplate(initialData.whatsapp_due_reminder_template || DEFAULT_WHATSAPP_DUE_REMINDER_TEMPLATE);
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
        timezone: timezone.trim() || 'Asia/Kolkata',
        whatsapp_invoice_template: whatsappInvoiceTemplate.trim() ? whatsappInvoiceTemplate.trim() : null,
        whatsapp_due_reminder_template: whatsappDueReminderTemplate.trim() ? whatsappDueReminderTemplate.trim() : null
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
            
            {/* Card 0: Appearance & Theme */}
            <div className="bg-surface p-5 sm:p-6 rounded-2xl border border-border shadow-xs space-y-4">
              <div className="flex items-center gap-3 border-b border-border pb-3.5">
                <div className="p-2 bg-accent/10 text-accent rounded-xl">
                  {resolvedTheme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-ink-primary">
                    Appearance &amp; Dark Mode
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Customize interface color scheme for comfortable day and night operation.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 pt-1">
                {[
                  { id: 'light', label: 'Light', icon: Sun, desc: 'Clean high contrast' },
                  { id: 'dark', label: 'Dark', icon: Moon, desc: 'Night shift mode' },
                  { id: 'system', label: 'System', icon: Laptop, desc: 'Syncs with device' },
                ].map((mode) => {
                  const isSelected = theme === mode.id;
                  const Icon = mode.icon;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setTheme(mode.id as 'light' | 'dark' | 'system')}
                      className={`p-3 sm:p-4 rounded-2xl border text-left transition flex flex-col justify-between gap-2 min-h-[76px] cursor-pointer ${
                        isSelected
                          ? 'bg-accent/10 border-accent text-accent shadow-2xs font-bold'
                          : 'bg-row-alt border-border text-ink-muted hover:text-ink-primary hover:bg-border/60'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <Icon className={`w-5 h-5 ${isSelected ? 'text-accent' : 'text-ink-muted'}`} />
                        {isSelected && <Check className="w-4 h-4 text-accent" />}
                      </div>
                      <div>
                        <div className={`text-xs font-bold ${isSelected ? 'text-accent' : 'text-ink-primary'}`}>
                          {mode.label}
                        </div>
                        <div className="text-[10px] text-ink-muted hidden sm:block">
                          {mode.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

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
                    placeholder="e.g. Melbun Wholesale"
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
                    placeholder="e.g. billing@melbunwholesale.com"
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

            {/* Card 3: WhatsApp Messaging & Due Reminders Configuration */}
            <div className="bg-surface p-5 sm:p-6 rounded-2xl border border-border shadow-xs space-y-5">
              <div className="flex items-center justify-between border-b border-border pb-3.5 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-ink-primary">
                      WhatsApp Messaging &amp; Due Reminders
                    </h2>
                    <p className="text-xs text-ink-muted">
                      Customise instant message templates sent to customer WhatsApp chats.
                    </p>
                  </div>
                </div>

                {/* Sub-tab switcher */}
                <div className="flex items-center gap-1 bg-row-alt p-1 rounded-xl border border-border">
                  <button
                    type="button"
                    onClick={() => { setActiveTemplateTab('invoice'); setRightPreviewTab('whatsapp'); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      activeTemplateTab === 'invoice'
                        ? 'bg-surface text-ink-primary shadow-2xs'
                        : 'text-ink-muted hover:text-ink-primary'
                    }`}
                  >
                    Invoice Receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTemplateTab('due'); setRightPreviewTab('whatsapp'); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      activeTemplateTab === 'due'
                        ? 'bg-surface text-ink-primary shadow-2xs'
                        : 'text-ink-muted hover:text-ink-primary'
                    }`}
                  >
                    Due Reminder
                  </button>
                </div>
              </div>

              {/* Template Editor */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-ink-primary flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-accent" />
                    {activeTemplateTab === 'invoice' ? 'Invoice Receipt Message Template' : 'Pending Due Reminder Template'}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTemplateTab === 'invoice') {
                        setWhatsappInvoiceTemplate(DEFAULT_WHATSAPP_INVOICE_TEMPLATE);
                      } else {
                        setWhatsappDueReminderTemplate(DEFAULT_WHATSAPP_DUE_REMINDER_TEMPLATE);
                      }
                      toast.success('Reset template to default.');
                    }}
                    className="text-[11px] font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reset to Default
                  </button>
                </div>

                {activeTemplateTab === 'invoice' ? (
                  <textarea
                    rows={8}
                    value={whatsappInvoiceTemplate}
                    onChange={(e) => setWhatsappInvoiceTemplate(e.target.value)}
                    placeholder="Enter WhatsApp invoice message template..."
                    className="w-full p-3.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm font-mono text-ink-primary focus:ring-2 focus:ring-accent focus:bg-surface outline-none transition resize-y leading-relaxed"
                  />
                ) : (
                  <textarea
                    rows={8}
                    value={whatsappDueReminderTemplate}
                    onChange={(e) => setWhatsappDueReminderTemplate(e.target.value)}
                    placeholder="Enter WhatsApp due reminder message template..."
                    className="w-full p-3.5 bg-row-alt border border-border rounded-xl text-xs sm:text-sm font-mono text-ink-primary focus:ring-2 focus:ring-accent focus:bg-surface outline-none transition resize-y leading-relaxed"
                  />
                )}

                {/* Variable Placeholder Chips */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block">
                    Click to Insert Dynamic Placeholders:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { tag: '{customer_name}', label: 'Customer Name' },
                      { tag: '{store_name}', label: 'Store Name' },
                      { tag: '{invoice_number}', label: 'Invoice #' },
                      { tag: '{date}', label: 'Date' },
                      { tag: '{item_count}', label: 'Items' },
                      { tag: '{total_amount}', label: 'Total' },
                      { tag: '{paid_amount}', label: 'Paid' },
                      { tag: '{due_amount}', label: 'Due Balance' },
                      { tag: '{status}', label: 'Status' },
                      { tag: '{store_phone}', label: 'Store Phone' },
                    ].map((item) => (
                      <button
                        key={item.tag}
                        type="button"
                        onClick={() => {
                          if (activeTemplateTab === 'invoice') {
                            setWhatsappInvoiceTemplate(prev => prev + ' ' + item.tag);
                          } else {
                            setWhatsappDueReminderTemplate(prev => prev + ' ' + item.tag);
                          }
                        }}
                        className="px-2 py-1 bg-surface border border-border hover:border-accent hover:bg-accent/5 rounded-lg text-[11px] font-mono text-ink-primary transition cursor-pointer shadow-2xs flex items-center gap-1"
                      >
                        <span className="text-accent font-bold">+</span>
                        <span>{item.tag}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Card 4: Session & Security */}
            <div className="bg-surface p-5 sm:p-6 rounded-2xl border border-border shadow-xs space-y-4">
              <div className="flex items-center gap-3 border-b border-border pb-3.5">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-ink-primary">
                    Terminal Session &amp; Authentication
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

          {/* RIGHT COLUMN: Live Receipt / WhatsApp Preview (5 cols on desktop, sticky) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="sticky top-20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-row-alt p-1 rounded-xl border border-border">
                  <button
                    type="button"
                    onClick={() => setRightPreviewTab('whatsapp')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      rightPreviewTab === 'whatsapp'
                        ? 'bg-surface text-ink-primary shadow-2xs'
                        : 'text-ink-muted hover:text-ink-primary'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    <span>WhatsApp Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightPreviewTab('receipt')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      rightPreviewTab === 'receipt'
                        ? 'bg-surface text-ink-primary shadow-2xs'
                        : 'text-ink-muted hover:text-ink-primary'
                    }`}
                  >
                    <Receipt className="w-3.5 h-3.5 text-accent" />
                    <span>Thermal</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightPreviewTab('invoice')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      rightPreviewTab === 'invoice'
                        ? 'bg-surface text-ink-primary shadow-2xs'
                        : 'text-ink-muted hover:text-ink-primary'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 text-[#8B2515]" />
                    <span>A4 Invoice</span>
                  </button>
                </div>
                <span className="text-[10px] bg-accent/10 text-accent font-bold px-2 py-0.5 rounded-full">
                  Live Preview
                </span>
              </div>

              {rightPreviewTab === 'whatsapp' ? (
                /* WhatsApp Mockup Preview Card */
                <div className="bg-[#EFEAE2] rounded-2xl border border-border/80 p-4 sm:p-5 shadow-sm space-y-3 relative overflow-hidden">
                  {/* WhatsApp Chat Header */}
                  <div className="flex items-center gap-3 bg-[#075E54] text-white p-3 rounded-xl shadow-xs">
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-xs">
                      MC
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold truncate">Ramesh Kumar (Customer)</div>
                      <div className="text-[10px] text-white/80">Online · WhatsApp</div>
                    </div>
                  </div>

                  {/* WhatsApp Speech Bubble */}
                  <div className="flex justify-end pt-2">
                    <div className="bg-[#DCF8C6] text-gray-900 rounded-2xl rounded-tr-xs p-3.5 shadow-xs max-w-[95%] sm:max-w-[90%] text-xs space-y-2 border border-emerald-200/50">
                      <div className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-gray-800">
                        {formatWhatsAppMessage(
                          activeTemplateTab === 'invoice' ? whatsappInvoiceTemplate : whatsappDueReminderTemplate,
                          {
                            customer_name: 'Ramesh Kumar',
                            store_name: storeName || 'MELBUN CLOTHING',
                            invoice_number: 'MELBUN/2026/000142',
                            date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
                            item_count: 3,
                            total_amount: 1573.95,
                            paid_amount: activeTemplateTab === 'invoice' ? 1573.95 : 1000.00,
                            due_amount: activeTemplateTab === 'invoice' ? 0 : 573.95,
                            status: activeTemplateTab === 'invoice' ? 'Paid' : 'Partial (Due: ₹573.95)',
                            store_phone: phone || '+91 9440028819',
                            store_address: address || 'SMS CENTRE, BANK ROAD, KASARAGOD 671121'
                          }
                        )}
                      </div>
                      <div className="flex items-center justify-end gap-1 text-[10px] text-gray-500 pt-1">
                        <span>{currentTimeStr || '12:00 PM'}</span>
                        <span className="text-blue-500 font-bold">✓✓</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : rightPreviewTab === 'invoice' ? (
                /* Luxury Terracotta A4 Tax Invoice Live Simulation Card */
                <div className="bg-[#FCFBF9] text-gray-900 rounded-2xl border border-[#D9B9B2] p-4 shadow-md space-y-3 text-left font-sans text-[11px] overflow-hidden">
                  {/* Top Header */}
                  <div className="flex items-start justify-between gap-2 border-b border-[#D9B9B2]/60 pb-3">
                    {/* Logo block */}
                    <div className="w-16 h-16 bg-[#8B2515] rounded-lg p-1.5 flex flex-col items-center justify-center text-white shrink-0 shadow-2xs">
                      <div className="w-7 h-7 mb-0.5 relative">
                        {/* Emblem Icon */}
                        <svg viewBox="0 0 125.83 148.84" className="w-full h-full fill-white">
                          <path d="M70.37,95.64l16.11-10.96c-7.82-1.27-10.93-.72-16.16,4.44l-2.51,26.27c-1.33,2.28-3.26,4.49-4.97,6.4l-4.61-6.31-2.6-26.55c-2.07-1.49-4.23-3.82-6.55-4.34-3.1-.71-6.15-.43-9.52.08l15.77,10.8.08,8.18-16.08-8.21-.15-10.92-6.11,4.44,13.65,24.28,2.04,35.14-3.65-3.45c-3.43-3.24-6.46-6.65-8.94-10.75l-12.47-20.66-.98-19.57c-2.49-2.47-3.13-5.54-1.09-8.53.5-1.04.67-2.81-.13-3.62l-8.22-8.31c-.54-.55-1.19-2.26-1.19-3.04l-.04-11.8c-3.32-1.61-4.02-4.43-3.94-7.69l.19-8.53c.08-3.55-4.17-3.35-4.18-9.03v-11.42C.46,20.17-.05,17.13,0,13.62L.23,0l17.29,17.55,21.78,22.05c6.03-5.39,12.25-8.16,19.98-9.88l-4.47-4.81,8.16-17.78,8.26,17.71-4.54,4.81c7.63,1.83,14.04,4.51,20.09,9.94l18.18-18.49L125.78.04l.05,18.4c-1.7,1.55-3.91,3.39-3.91,5.77v11.18c0,2.64-4.13,3.03-4.16,7.6l-.07,12.4c-2,1.75-3.9,3.52-3.9,6.3l.02,10.42-10.15,10.73,2.28,6.76c-1.7,2.6-2.77,5.11-2.93,8.18l-.82,15.99-14.31,23.63-10.6,11.45,2.22-35.55,13.38-24.44-6.15-4.47-.12,11.08-15.96,8.14-.29-7.96Z" />
                        </svg>
                      </div>
                      <span className="font-extrabold text-[8px] tracking-wider leading-none">MELBUN</span>
                      <span className="text-[4px] tracking-widest leading-none mt-0.5 opacity-90">SIGN OF RICH</span>
                    </div>

                    {/* Store details */}
                    <div className="min-w-0 flex-1 px-1">
                      <h4 className="font-black text-xs text-[#8B2515] uppercase tracking-wide truncate">
                        {storeName || 'MELBUN CLOTHING'}
                      </h4>
                      <p className="text-[9px] text-gray-600 truncate mt-0.5">
                        {address || 'SMS CENTRE, BANK ROAD, KASARAGOD 671121'}
                      </p>
                      <p className="text-[9px] text-gray-600">
                        Phone: {phone || '9440028819'} • Email: {email || 'melbunindia@gmail.com'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] font-bold text-gray-800 font-mono">
                          GSTIN: {gstin || '32CHLPA3518R2Z8'}
                        </span>
                        <span className="px-1.5 py-0.2 bg-[#8B2515]/10 text-[#8B2515] font-bold rounded text-[8px]">
                          State: 32-Kerala
                        </span>
                      </div>
                    </div>

                    {/* Document Title */}
                    <div className="text-right shrink-0">
                      <div className="font-serif font-black text-sm text-[#8B2515] tracking-wide">
                        TAX INVOICE
                      </div>
                      <div className="text-[7px] text-[#C28936] font-bold mt-0.5">
                        ◆   ❖   ◆
                      </div>
                    </div>
                  </div>

                  {/* Dual Card: BILL TO & INVOICE DETAILS */}
                  <div className="grid grid-cols-2 gap-2 text-[9px]">
                    <div className="bg-white p-2 rounded-lg border border-[#D9B9B2]">
                      <div className="bg-[#8B2515] text-white px-1.5 py-0.5 rounded font-bold text-[8px] mb-1">
                        👤 BILL TO:
                      </div>
                      <div className="font-bold text-gray-900">Strawberry kids</div>
                      <div className="text-gray-500 text-[8px] truncate">NANAN COMPLEX, NELLYADY</div>
                      <div className="text-gray-600 text-[8px]">Contact: +919747640579</div>
                      <div className="text-gray-600 text-[8px] flex justify-between font-mono">
                        <span>State: 29-Karnataka</span>
                        <span className="font-bold">GSTIN: 29AFHPN...</span>
                      </div>
                    </div>

                    <div className="bg-white p-2 rounded-lg border border-[#D9B9B2]">
                      <div className="bg-[#8B2515] text-white px-1.5 py-0.5 rounded font-bold text-[8px] mb-1">
                        📄 INVOICE DETAILS:
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">No:</span>
                        <span className="font-bold font-mono">MELBUN/2026/57</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Date:</span>
                        <span className="font-bold">{new Date().toLocaleDateString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Place of Supply:</span>
                        <span className="font-bold text-gray-800">29-Karnataka</span>
                      </div>
                    </div>
                  </div>

                  {/* Line Items Mini Table */}
                  <div className="bg-white rounded-lg border border-[#D9B9B2] overflow-hidden text-[9px]">
                    <div className="bg-[#8B2515] text-white font-bold grid grid-cols-6 p-1 text-center text-[8px]">
                      <span className="col-span-2 text-left pl-1">Item Name</span>
                      <span>HSN</span>
                      <span>Qty</span>
                      <span className="text-right">Price</span>
                      <span className="text-right pr-1">Amount</span>
                    </div>
                    <div className="divide-y divide-gray-100 p-1 space-y-0.5">
                      <div className="grid grid-cols-6 text-[8.5px] items-center">
                        <span className="col-span-2 font-medium truncate pl-1">5800 1-5 Shirt</span>
                        <span className="text-center font-mono text-gray-500">6109</span>
                        <span className="text-center font-bold">20 Pcs</span>
                        <span className="text-right font-mono">₹255.00</span>
                        <span className="text-right font-mono font-bold pr-1">₹5,100.00</span>
                      </div>
                      <div className="grid grid-cols-6 text-[8.5px] items-center pt-0.5">
                        <span className="col-span-2 font-medium truncate pl-1">Honko wonzne 6-10</span>
                        <span className="text-center font-mono text-gray-500">6109</span>
                        <span className="text-center font-bold">25 Pcs</span>
                        <span className="text-right font-mono">₹285.00</span>
                        <span className="text-right font-mono font-bold pr-1">₹7,125.00</span>
                      </div>
                    </div>
                    <div className="bg-[#701C0F] text-white font-bold grid grid-cols-6 p-1 text-[8.5px]">
                      <span className="col-span-2 text-left pl-1">Total Pieces: 45 Pcs</span>
                      <span className="col-span-4 text-right pr-1 font-mono">₹12,225.00</span>
                    </div>
                  </div>

                  {/* Bottom: Totals & Words */}
                  <div className="bg-white p-2 rounded-lg border border-[#D9B9B2] space-y-1.5 text-[9px]">
                    <div className="bg-[#8B2515] text-white p-1 rounded font-bold flex justify-between text-[10px]">
                      <span>FINAL INVOICE TOTAL</span>
                      <span className="font-mono">₹12,836.25</span>
                    </div>
                    <div className="text-[8px] text-gray-700 font-serif italic">
                      <span className="font-bold not-italic text-[#8B2515]">INVOICE AMOUNT IN WORDS: </span>
                      Twelve Thousand Eight Hundred and Thirty Six Rupees and Twenty Five Paise only
                    </div>
                  </div>

                  {/* Bottom Ribbon */}
                  <div className="bg-[#8B2515] text-white text-center py-1 rounded font-serif italic text-[9px]">
                    ❖ Thank you for your business! ❖
                  </div>
                </div>
              ) : (
                /* Thermal Paper Simulation Card */
                <div className="bg-surface rounded-2xl border-2 border-dashed border-border p-6 shadow-sm space-y-4 font-mono text-center relative overflow-hidden">
                  {/* Store Header Simulation */}
                  <div className="space-y-1 border-b border-dashed border-border pb-4">
                    <h3 className="font-extrabold text-base tracking-tight text-ink-primary uppercase truncate">
                      {storeName || 'MELBUN CLOTHING'}
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
                      <span>INVOICE: #MELBUN-PREVIEW</span>
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
                    <p className="text-[9px] text-ink-muted/70">Powered by Melbun Engine</p>
                  </div>
                </div>
              )}

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
