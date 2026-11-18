'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Package, Plus, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, ApiError } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';

interface AdminPlanItem {
  _id: string;
  code: string;
  name: string;
  monthlyPriceInPaise: number;
  trialDays: number;
  gracePeriodDays: number;
  isActive: boolean;
  limits: {
    maxTeamMembers: number;
    maxProducts: number;
    monthlyAiRequests: number;
    monthlyWhatsappMessages: number;
  };
  features: {
    advancedReports: boolean;
    whatsappAssistant: boolean;
    inventoryManagement: boolean;
  };
}

interface AdminSubscriptionRow {
  _id: string;
  businessId?: { _id: string; name: string; businessType: string };
  subscriptionPlanId?: { code: string; name: string; monthlyPriceInPaise: number } | null;
  planCode?: string;
  plan: string;
  status: string;
  activationSource?: string | null;
  trialEndsAt?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  gracePeriodEndsAt?: string | null;
  billingExempt?: boolean;
}

export default function AdminSubscriptionsAndPlansPage() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';

  const [subs, setSubs] = useState<AdminSubscriptionRow[]>([]);
  const [plans, setPlans] = useState<AdminPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // New Plan Form
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [priceInr, setPriceInr] = useState('0');
  const [maxMembers, setMaxMembers] = useState('5');
  const [maxProducts, setMaxProducts] = useState('500');
  const [maxAi, setMaxAi] = useState('500');
  const [maxWa, setMaxWa] = useState('1000');
  const [advancedReports, setAdvancedReports] = useState(true);

  const loadAll = useCallback(async () => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [subList, planList] = await Promise.all([
        apiRequest<AdminSubscriptionRow[]>('/api/admin/subscriptions'),
        apiRequest<AdminPlanItem[]>('/api/admin/plans'),
      ]);
      setSubs(Array.isArray(subList) ? subList : []);
      setPlans(Array.isArray(planList) ? planList : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load subscriptions & plans');
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (!isPlatformAdmin) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
        Platform Administrator access required.
      </div>
    );
  }

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/api/admin/plans', {
        method: 'POST',
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          monthlyPriceInPaise: Math.round(Number(priceInr || 0) * 100),
          limits: {
            maxTeamMembers: Number(maxMembers),
            maxProducts: Number(maxProducts),
            monthlyAiRequests: Number(maxAi),
            monthlyWhatsappMessages: Number(maxWa),
          },
          features: { advancedReports },
        }),
      });
      setBanner('Subscription plan created.');
      setShowPlanForm(false);
      setCode('');
      setName('');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create plan');
    }
  };

  const handleTogglePlan = async (plan: AdminPlanItem) => {
    setError(null);
    try {
      await apiRequest(`/api/admin/plans/${plan._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !plan.isActive }),
      });
      setBanner(`Plan ${plan.code} ${plan.isActive ? 'deactivated' : 'activated'}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update plan');
    }
  };

  const handleChangeSubPlan = async (businessId: string, currentPlan: string) => {
    const nextCode = window.prompt(
      `Enter target plan code (${plans.map((p) => p.code).join(', ')}):`,
      currentPlan,
    );
    if (!nextCode || !nextCode.trim()) return;
    const reason = window.prompt('Mandatory audit reason for plan change:');
    if (!reason || !reason.trim()) return;
    setError(null);
    try {
      await apiRequest(`/api/admin/subscriptions/${businessId}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({ planCode: nextCode.trim().toUpperCase(), reason: reason.trim() }),
      });
      setBanner('Subscription plan updated.');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change plan');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Subscriptions &amp; Plans</h1>
          <p className="text-sm text-slate-500">
            Manage tenant subscription states and configure plan limits without silently altering active snapshots.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowPlanForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          New Plan
        </button>
      </div>

      {banner && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>{banner}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showPlanForm && (
        <form
          onSubmit={handleCreatePlan}
          className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3"
        >
          <input
            type="text"
            placeholder="Code (e.g. STARTER)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Plan Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Monthly INR"
            value={priceInr}
            onChange={(e) => setPriceInr(e.target.value)}
            min="0"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Max Members"
            value={maxMembers}
            onChange={(e) => setMaxMembers(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Max Products"
            value={maxProducts}
            onChange={(e) => setMaxProducts(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Monthly AI Quota"
            value={maxAi}
            onChange={(e) => setMaxAi(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Monthly WA Quota"
            value={maxWa}
            onChange={(e) => setMaxWa(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={advancedReports}
              onChange={(e) => setAdvancedReports(e.target.checked)}
            />
            Advanced Reports Enabled
          </label>
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Create Plan
          </button>
        </form>
      )}

      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Package className="h-4 w-4 text-emerald-600" />
          Subscription Plans
        </h2>
        <DataTable<AdminPlanItem>
          loading={loading}
          data={plans}
          keyExtractor={(p) => p._id}
          emptyMessage="No subscription plans configured."
          columns={[
            {
              key: 'code',
              header: 'Plan',
              render: (p) => (
                <div>
                  <p className="font-medium text-slate-900">
                    {p.name} ({p.code})
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.limits.maxTeamMembers} members • {p.limits.maxProducts} products •{' '}
                    {p.limits.monthlyAiRequests} AI/mo • {p.limits.monthlyWhatsappMessages} WA/mo
                  </p>
                </div>
              ),
            },
            {
              key: 'price',
              header: 'Monthly Price',
              className: 'text-right',
              render: (p) => formatCurrency(p.monthlyPriceInPaise / 100, 'INR'),
            },
            {
              key: 'status',
              header: 'Status',
              render: (p) => (
                <Badge variant={p.isActive ? 'success' : 'default'}>
                  {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              className: 'text-right',
              render: (p) => (
                <button
                  type="button"
                  onClick={() => handleTogglePlan(p)}
                  className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {p.isActive ? 'Deactivate' : 'Activate'}
                </button>
              ),
            },
          ]}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Tenant Subscriptions</h2>
        <DataTable<AdminSubscriptionRow>
          loading={loading}
          data={subs}
          keyExtractor={(s) => s._id}
          emptyMessage="No subscriptions found."
          columns={[
            {
              key: 'business',
              header: 'Business',
              render: (s) => (
                <div>
                  <p className="font-medium text-slate-900">{s.businessId?.name || 'Business'}</p>
                  <p className="text-xs text-slate-500">{s.activationSource || 'LEGACY'}</p>
                </div>
              ),
            },
            {
              key: 'plan',
              header: 'Plan & Price',
              render: (s) => (
                <div>
                  <p className="font-medium text-slate-900">{s.planCode || s.plan}</p>
                  <p className="text-xs text-slate-500">
                    {s.billingExempt
                      ? 'Exempt (PRE_SAAS)'
                      : formatCurrency((s.subscriptionPlanId?.monthlyPriceInPaise || 0) / 100, 'INR')}
                  </p>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (s) => (
                <Badge
                  variant={
                    s.status === 'ACTIVE'
                      ? 'success'
                      : s.status === 'TRIALING'
                        ? 'info'
                        : 'warning'
                  }
                >
                  {s.status}
                </Badge>
              ),
            },
            {
              key: 'period',
              header: 'Next Billing / Grace',
              render: (s) => (
                <div className="text-xs text-slate-600">
                  <p>
                    Next:{' '}
                    {s.currentPeriodEnd
                      ? formatDate(s.currentPeriodEnd)
                      : s.trialEndsAt
                        ? formatDate(s.trialEndsAt)
                        : '—'}
                  </p>
                  {s.gracePeriodEndsAt && <p>Grace: {formatDate(s.gracePeriodEndsAt)}</p>}
                </div>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              className: 'text-right',
              render: (s) => (
                <button
                  type="button"
                  onClick={() =>
                    handleChangeSubPlan(s.businessId?._id || '', s.planCode || s.plan)
                  }
                  className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Change Plan
                </button>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
