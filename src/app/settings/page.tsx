'use client'

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
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
  Globe
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { getStoreSettingsAction, updateStoreSettingsAction } from '@/lib/actions/settings';
import { StoreSettings } from '@/types/settings';

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
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Form State
  const [storeName, setStoreName] = useState('Melbun Wholesale');
  const [tagline, setTagline] = useState('Premium Wholesale & Retail POS');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gstin, setGstin] = useState('');
  const [startHour, setStartHour] = useState<number>(6);
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [isDirty, setIsDirty] = useState(false);

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

  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      const res = await getStoreSettingsAction();
      if (res.success && res.data) {
        setStoreName(res.data.store_name || '');
        setTagline(res.data.tagline || '');
        setAddress(res.data.address || '');
        setPhone(res.data.phone || '');
        setEmail(res.data.email || '');
        setGstin(res.data.gstin || '');
        setStartHour(res.data.business_day_start_hour ?? 6);
        setTimezone(res.data.timezone || 'Asia/Kolkata');
        setIsDirty(false);
      }
      setLoading(false);
    }
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    try {
      setSaving(true);
      setStatus(null);

      const res = await updateStoreSettingsAction({
        store_name: storeName,
        tagline: tagline.trim() ? tagline : null,
        address: address.trim() ? address : null,
        phone: phone.trim() ? phone : null,
        email: email.trim() ? email : null,
        gstin: gstin.trim() ? gstin : null,
        business_day_start_hour: startHour,
        timezone
      });

      if (res.success) {
        setIsDirty(false);
        setStatus({ type: 'success', msg: 'Store and business day settings saved successfully!' });
      } else {
        setStatus({ type: 'error', msg: res.error || 'Failed to save settings.' });
      }
    } catch (err: unknown) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : 'An error occurred while saving.' });
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="p-4 pb-28 md:p-8 max-w-5xl w-full mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Settings className="w-8 h-8 text-accent" />
            System & Store Settings
          </h1>
          <p className="text-gray-500 mt-1">
            Configure business day timing, store profile, and print header information.
          </p>
        </div>
      </header>

      {/* Status Feedback */}
      {status && (
        <div
          className={`p-4 rounded-xl flex items-center gap-3 border ${
            status.type === 'error'
              ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-green-50 text-green-700 border-green-200'
          }`}
        >
          {status.type === 'error' ? (
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          )}
          <span className="font-medium text-sm">{status.msg}</span>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-gray-400 font-medium">Loading store configuration...</div>
      ) : (
        <form onSubmit={handleSave} className="space-y-8">
          {/* Section 1: Business Day & Timezone Engine */}
          <div className="bg-white p-6 md:p-8 rounded-2xl border border-gray-200 shadow-sm space-y-6">
            <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
              <div className="p-2 bg-red-50 rounded-lg text-accent">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Business Day & Reporting Cutoff</h2>
                <p className="text-xs text-gray-500">Controls how late-night sales and expenses roll into daily reports and dashboards.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5">
                  Business Day Start Time
                </label>
                <select
                  value={startHour}
                  onChange={(e) => { setStartHour(Number(e.target.value)); setIsDirty(true); }}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 font-medium focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none transition"
                >
                  {HOURS.map((h) => (
                    <option key={h.value} value={h.value}>
                      {h.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                  {startHour === 0 ? (
                    <>Transactions are grouped using standard <strong>12:00 AM to 11:59 PM</strong> calendar day boundaries for Dashboard and Reports metrics. Exact timestamps will always be preserved on invoice receipts.</>
                  ) : (
                    <>Transactions occurring between <strong>12:00 AM (Midnight)</strong> and <strong>{startHour === 12 ? '12:00 PM' : startHour < 12 ? `${startHour}:00 AM` : `${startHour - 12}:00 PM`}</strong> will be grouped into the <strong>previous business day</strong> for Dashboard and Reports metrics. Exact timestamps will always be preserved on invoice receipts.</>
                  )}
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5">
                  Store Operating Timezone
                </label>
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 border border-gray-200 rounded-xl text-gray-700 font-medium">
                  <Globe className="w-4 h-4 text-gray-400" />
                  <span>{timezone} (India Standard Time - UTC+05:30)</span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  All transaction ledgers and reporting boundaries are synchronized with this timezone.
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: Store Identity & Receipt Branding */}
          <div className="bg-white p-6 md:p-8 rounded-2xl border border-gray-200 shadow-sm space-y-6">
            <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
              <div className="p-2 bg-red-50 rounded-lg text-accent">
                <Store className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Store Profile & Receipt Branding</h2>
                <p className="text-xs text-gray-500">Information displayed on customer PDF invoices and receipt headers.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5 flex items-center gap-2">
                  <Building className="w-4 h-4 text-gray-400" /> Store / Business Name *
                </label>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={(e) => { setStoreName(e.target.value); setIsDirty(true); }}
                  placeholder="e.g. Melbun Wholesale"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 font-medium focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-400" /> Business Tagline / Subtitle
                </label>
                <input
                  type="text"
                  value={tagline}
                  onChange={(e) => { setTagline(e.target.value); setIsDirty(true); }}
                  placeholder="e.g. Premium Wholesale & Retail POS"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 font-medium focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5 flex items-center gap-2">
                  <Phone className="w-4 h-4 text-gray-400" /> Contact Phone
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setIsDirty(true); }}
                  placeholder="e.g. +91 98765 43210"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 font-medium focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-gray-400" /> Billing Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setIsDirty(true); }}
                  placeholder="e.g. billing@melbunwholesale.com"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 font-medium focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-400" /> GSTIN / Tax Identification
                </label>
                <input
                  type="text"
                  value={gstin}
                  onChange={(e) => { setGstin(e.target.value); setIsDirty(true); }}
                  placeholder="e.g. 29ABCDE1234F1Z5"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 font-medium focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gray-400" /> Store Address
                </label>
                <textarea
                  rows={2}
                  value={address}
                  onChange={(e) => { setAddress(e.target.value); setIsDirty(true); }}
                  placeholder="Store street address, city, state and pincode"
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 font-medium focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-6 py-3 bg-accent hover:bg-[#6e0000] text-white font-bold rounded-xl shadow-sm transition disabled:opacity-50"
              >
                <Save className="w-5 h-5" />
                {saving ? 'Saving Changes...' : 'Save Store Settings'}
              </button>
            </div>
          </div>

          {/* Section 3: Authentication & Shift Security */}
          <div className="bg-white p-6 md:p-8 rounded-2xl border border-gray-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3 text-gray-900 mb-2">
              <ShieldCheck className="w-6 h-6 text-accent" />
              <h2 className="text-lg font-bold">Session & Authentication</h2>
            </div>
            <p className="text-gray-600 text-sm">
              You are securely signed into the POS terminal. When ending your shift or leaving the counter unattended, please sign out.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-100 hover:bg-red-50 text-gray-800 hover:text-red-700 font-bold rounded-xl transition"
              >
                <LogOut className="w-4 h-4" />
                Sign Out from Terminal
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
