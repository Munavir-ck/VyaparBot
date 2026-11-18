'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  Sparkles,
  Building2,
  CheckCircle2,
  Database,
  AlertCircle,
  Clock,
  Ban,
  Wallet,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, ApiError } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { StatCard } from '@/components/ui/StatCard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface AdminOverviewData {
  totalBusinesses: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  expiredSubscriptions: number;
  suspendedSubscriptions: number;
  pilotSlotsUsed: number;
  pilotMaxSlots: number;
  collectedRevenueInPaise: number;
  capturedPaymentCount: number;
  upcomingExpiries: Array<{
    subscriptionId: string;
    business?: { _id: string; name: string; businessType: string };
    status: string;
    planCode: string;
    expiresAt: string;
  }>;
}

interface GrandfatherReport {
  dryRun: boolean;
  totalInspected: number;
  alreadyExempt: Array<{ businessId: string; name: string }>;
  pilotSkipped: Array<{ businessId: string; name: string }>;
  missingSubscription: Array<{ businessId: string; name: string }>;
  existingNonExempt: Array<{ businessId: string; name: string }>;
  appliedCount: number;
}

export default function PlatformAdminOverviewPage() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';

  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [dryRunReport, setDryRunReport] = useState<GrandfatherReport | null>(null);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<AdminOverviewData>('/api/admin/overview');
      setOverview(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load platform overview');
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  if (!isPlatformAdmin) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
        Platform Administrator (`PLATFORM_ADMIN`) access required. Business owners cannot access this console.
      </div>
    );
  }

  const handleGrandfatherDryRun = async () => {
    setError(null);
    try {
      const report = await apiRequest<GrandfatherReport>('/api/admin/migrations/grandfather-pre-saas', {
        method: 'POST',
        body: JSON.stringify({ dryRun: true }),
      });
      setDryRunReport(report);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Dry-run failed');
    }
  };

  const handleGrandfatherApply = async () => {
    setApplying(true);
    setError(null);
    try {
      const report = await apiRequest<GrandfatherReport>('/api/admin/migrations/grandfather-pre-saas', {
        method: 'POST',
        body: JSON.stringify({ dryRun: false }),
      });
      setDryRunReport(report);
      setConfirmApplyOpen(false);
      setBanner(`Grandfathered ${report.appliedCount} pre-SaaS businesses.`);
      await loadOverview();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Migration failed');
      setConfirmApplyOpen(false);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Platform Overview</h1>
            <p className="text-sm text-slate-500">
              Multi-tenant SaaS health, 30-day pilot slots, actual SaaS revenue, and upcoming expiries.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleGrandfatherDryRun}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Database className="h-4 w-4" />
          Pre-SaaS Grandfather Dry-Run
        </button>
      </div>

      {banner && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            {banner}
          </span>
          <button type="button" onClick={() => setBanner(null)} className="text-xs font-medium hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Registered Businesses"
          value={String(overview?.totalBusinesses ?? 0)}
          subtitle="Total tenant workspaces"
          icon={Building2}
        />
        <StatCard
          title="Active Subscriptions"
          value={String(overview?.activeSubscriptions ?? 0)}
          subtitle="Paid or grandfathered active"
          icon={CheckCircle2}
          tone="emerald"
        />
        <StatCard
          title="Trialing Businesses"
          value={String(overview?.trialingSubscriptions ?? 0)}
          subtitle={`Pilot slots: ${overview?.pilotSlotsUsed ?? 0} / ${overview?.pilotMaxSlots ?? 3}`}
          icon={Sparkles}
          tone="emerald"
        />
        <StatCard
          title="Collected SaaS Revenue"
          value={formatCurrency((overview?.collectedRevenueInPaise ?? 0) / 100, 'INR')}
          subtitle={`${overview?.capturedPaymentCount ?? 0} captured payments`}
          icon={Wallet}
        />
        <StatCard
          title="Expired Subscriptions"
          value={String(overview?.expiredSubscriptions ?? 0)}
          subtitle="Read-only preserved access"
          icon={Clock}
          tone={(overview?.expiredSubscriptions ?? 0) > 0 ? 'amber' : 'slate'}
        />
        <StatCard
          title="Suspended Businesses"
          value={String(overview?.suspendedSubscriptions ?? 0)}
          subtitle="Restricted write access"
          icon={Ban}
          tone={(overview?.suspendedSubscriptions ?? 0) > 0 ? 'rose' : 'slate'}
        />
      </div>

      {dryRunReport && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="font-semibold">
                Grandfathering {dryRunReport.dryRun ? 'Dry-Run Preview' : 'Migration Result'}
              </p>
              <p className="mt-1 text-xs">
                Inspected: {dryRunReport.totalInspected} • Missing Sub:{' '}
                {dryRunReport.missingSubscription.length} • Existing Non-Exempt:{' '}
                {dryRunReport.existingNonExempt.length} • Already Exempt:{' '}
                {dryRunReport.alreadyExempt.length} • Pilot Skipped:{' '}
                {dryRunReport.pilotSkipped.length}
                {!dryRunReport.dryRun ? ` • Applied: ${dryRunReport.appliedCount}` : ''}
              </p>
            </div>
            {dryRunReport.dryRun &&
              dryRunReport.missingSubscription.length + dryRunReport.existingNonExempt.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmApplyOpen(true)}
                  className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Apply Grandfathering
                </button>
              )}
          </div>
        </div>
      )}

      {/* Quick Navigation */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: '/admin/businesses', title: 'Manage Businesses', desc: 'Search, inspect & suspend/activate' },
          { href: '/admin/pilot', title: '30-Day Pilot Slots', desc: 'Grant pilot, extend & convert' },
          { href: '/admin/subscriptions', title: 'Subscriptions & Plans', desc: 'Configure plans & quotas' },
          { href: '/admin/usage', title: 'Usage & SaaS Billing', desc: 'Monitor 80% warnings & invoices' },
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-300"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">{card.title}</p>
              <p className="text-xs text-slate-500">{card.desc}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400" />
          </Link>
        ))}
      </div>

      {/* Upcoming Expiries */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          Upcoming Subscription &amp; Trial Expiries (Next 7 Days)
        </h2>
        <DataTable
          loading={loading}
          data={overview?.upcomingExpiries || []}
          keyExtractor={(r) => r.subscriptionId}
          emptyMessage="No subscriptions or trials expiring in the next 7 days."
          columns={[
            {
              key: 'business',
              header: 'Business',
              render: (r) => (
                <div>
                  <p className="font-medium text-slate-900">{r.business?.name || 'Business'}</p>
                  <p className="text-xs text-slate-500">{r.business?.businessType}</p>
                </div>
              ),
            },
            {
              key: 'plan',
              header: 'Plan',
              render: (r) => <Badge variant="info">{r.planCode}</Badge>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <Badge variant={r.status === 'TRIALING' ? 'warning' : 'success'}>
                  {r.status}
                </Badge>
              ),
            },
            {
              key: 'expiresAt',
              header: 'Expires (UTC)',
              render: (r) => (r.expiresAt ? formatDate(r.expiresAt) : '—'),
            },
          ]}
        />
      </div>

      <ConfirmDialog
        open={confirmApplyOpen}
        title="Apply Pre-SaaS Grandfathering"
        description="This will mark eligible pre-SaaS businesses as billingExempt: true (PRE_SAAS) without affecting pilot slots or tenant transactions."
        confirmLabel="Apply Migration"
        loading={applying}
        onCancel={() => setConfirmApplyOpen(false)}
        onConfirm={handleGrandfatherApply}
      />
    </div>
  );
}
