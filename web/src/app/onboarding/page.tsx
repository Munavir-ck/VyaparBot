'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api-client';
import type { BusinessType } from '@/types/api';

const BUSINESS_TYPES: { value: BusinessType; label: string; desc: string }[] = [
  { value: 'RESTAURANT', label: 'Restaurant / Cafe', desc: 'Daily sales, kitchen expenses & supplier bills' },
  { value: 'GROCERY', label: 'Grocery Shop', desc: 'Itemized stock, grains, dairy & daily collections' },
  { value: 'RETAIL', label: 'Retail Store', desc: 'Product catalog, sales stock deduction & payables' },
  { value: 'WHOLESALE', label: 'Wholesale Business', desc: 'Bulk units, credit sales & receivables' },
  { value: 'GENERAL', label: 'General Small Business', desc: 'Flexible money & inventory management' },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { refreshAuth } = useAuth();

  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('RESTAURANT');
  const [currency, setCurrency] = useState('INR');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiRequest('/api/business/onboard', {
        method: 'POST',
        body: JSON.stringify({ name, businessType, currency, timezone, address }),
      });
      await refreshAuth();
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create business');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Set up your business</h1>
            <p className="text-xs text-slate-500">
              Configure your workspace for Money &amp; Inventory Management
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        <form onSubmit={handleCreateBusiness} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Business Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Malabar Kitchen / Kochi Grocers"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Business Type</label>
            <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {BUSINESS_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setBusinessType(t.value)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    businessType === t.value
                      ? 'border-emerald-600 bg-emerald-50/70'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-xs font-semibold text-slate-900">{t.label}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="INR">INR (₹)</option>
                <option value="AED">AED</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Address (optional)</label>
            <input
              type="text"
              placeholder="Kozhikode, Kerala"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Business Workspace
          </button>
        </form>
      </div>
    </div>
  );
}

