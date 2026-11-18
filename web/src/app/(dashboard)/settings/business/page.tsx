'use client';

import React, { useEffect, useState } from 'react';
import { Settings, CheckCircle2, AlertCircle, Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { BusinessConfig, BusinessType } from '@/types/api';

const CURRENCIES = ['INR', 'AED', 'USD', 'EUR', 'GBP', 'SAR'];
const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Singapore',
  'Europe/London',
  'UTC',
];

export default function BusinessSettingsPage() {
  const { business, memberRole, refreshAuth } = useAuth();
  const canEdit = memberRole === 'OWNER' || memberRole === 'MANAGER';

  const [businessTypes, setBusinessTypes] = useState<BusinessConfig[]>([]);
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('RESTAURANT');
  const [address, setAddress] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [autoDeductItemized, setAutoDeductItemized] = useState(true);
  const [autoDeductLumpSum, setAutoDeductLumpSum] = useState(false);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [customCategoriesInput, setCustomCategoriesInput] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<BusinessConfig[]>('/api/business/types')
      .then((types) => setBusinessTypes(Array.isArray(types) ? types : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (business) {
      setName(business.name || '');
      setBusinessType(business.businessType || 'RESTAURANT');
      setAddress(business.address || '');
      setCurrency(business.currency || 'INR');
      setTimezone(business.timezone || 'Asia/Kolkata');
      setAutoDeductItemized(business.settings?.inventory?.autoDeductOnItemizedSale ?? true);
      setAutoDeductLumpSum(business.settings?.inventory?.autoDeductOnLumpSumSale ?? false);
      setAllowNegativeStock(business.settings?.inventory?.allowNegativeStock ?? false);
      setCustomCategoriesInput((business.settings?.customExpenseCategories || []).join(', '));
    }
  }, [business]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError('Business name is required.');
      return;
    }

    setSaving(true);
    try {
      const customExpenseCategories = customCategoriesInput
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

      await apiRequest('/api/business', {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          businessType,
          address: address.trim(),
          currency,
          timezone,
          settings: {
            inventory: {
              autoDeductOnItemizedSale: autoDeductItemized,
              autoDeductOnLumpSumSale: autoDeductLumpSum,
              allowNegativeStock,
            },
            customExpenseCategories,
          },
        }),
      });
      await refreshAuth();
      setSuccess('Business settings saved successfully.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save business settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
          <Settings className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Business Settings</h1>
          <p className="text-sm text-slate-500">
            Manage business profile, localization, and inventory deduction rules.
          </p>
        </div>
      </div>

      {!canEdit && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            Read-only access: Only Owners or Managers can modify business settings (your role:{' '}
            <strong>{memberRole || 'STAFF'}</strong>).
          </span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Business Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Business Type</label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value as BusinessType)}
              disabled={!canEdit}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            >
              {businessTypes.length > 0 ? (
                businessTypes.map((cfg) => (
                  <option key={cfg.type} value={cfg.type}>
                    {cfg.label}
                  </option>
                ))
              ) : (
                <option value={businessType}>{businessType}</option>
              )}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={!canEdit}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              disabled={!canEdit}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={!canEdit}
            placeholder="City, State, Country"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Custom Expense Categories (comma-separated)
          </label>
          <input
            type="text"
            value={customCategoriesInput}
            onChange={(e) => setCustomCategoriesInput(e.target.value)}
            disabled={!canEdit}
            placeholder="e.g. PACKAGING, DELIVERY, MAINTENANCE"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
          />
        </div>

        <div className="space-y-3 border-t border-slate-200 pt-5">
          <h2 className="text-sm font-semibold text-slate-900">Inventory Rules</h2>

          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={autoDeductItemized}
              onChange={(e) => setAutoDeductItemized(e.target.checked)}
              disabled={!canEdit}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>
              <strong className="block font-medium text-slate-900">
                Auto-deduct stock on itemized sales
              </strong>
              <span className="text-xs text-slate-500">
                Deduct product stock once when recording itemized sales.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={autoDeductLumpSum}
              onChange={(e) => setAutoDeductLumpSum(e.target.checked)}
              disabled={!canEdit}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>
              <strong className="block font-medium text-slate-900">
                Auto-deduct on lump-sum daily sales
              </strong>
              <span className="text-xs text-slate-500">
                Disabled by default so daily lump-sum totals do not alter inventory.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={allowNegativeStock}
              onChange={(e) => setAllowNegativeStock(e.target.checked)}
              disabled={!canEdit}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>
              <strong className="block font-medium text-slate-900">Allow negative stock</strong>
              <span className="text-xs text-slate-500">
                Permit stock-out or sales deductions even when stock reaches zero.
              </span>
            </span>
          </label>
        </div>

        {canEdit && (
          <div className="flex justify-end border-t border-slate-200 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
