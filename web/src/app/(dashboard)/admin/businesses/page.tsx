'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Search, Eye, CheckCircle2, Ban, X, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/formatters';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface AdminBusinessRow {
  business: {
    _id: string;
    name: string;
    businessType: string;
    status: string;
    currency: string;
    timezone: string;
    createdAt: string;
    ownerId?: { name?: string; whatsappNumber?: string };
  };
  subscription: {
    _id: string;
    status: string;
    planCode?: string;
    isPilotParticipant?: boolean;
    billingExempt?: boolean;
    activationSource?: string | null;
    trialStartedAt?: string | null;
    trialEndsAt?: string | null;
    currentPeriodStart?: string | null;
    statusHistory?: Array<{ from?: string; to: string; reason: string; timestamp: string }>;
  } | null;
}

export default function AdminBusinessesPage() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';

  const [rows, setRows] = useState<AdminBusinessRow[]>([]);
  const [search, setSearch] = useState('');
  const [businessType, setBusinessType] = useState('ALL');
  const [subscriptionStatus, setSubscriptionStatus] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [selected, setSelected] = useState<AdminBusinessRow | null>(null);
  const [statusAction, setStatusAction] = useState<{
    row: AdminBusinessRow;
    nextStatus: 'ACTIVE' | 'SUSPENDED';
  } | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadBusinesses = useCallback(async () => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (businessType !== 'ALL') params.set('businessType', businessType);
      if (subscriptionStatus !== 'ALL') params.set('subscriptionStatus', subscriptionStatus);
      const data = await apiRequest<AdminBusinessRow[]>(
        `/api/admin/businesses?${params.toString()}`,
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load businesses');
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin, search, businessType, subscriptionStatus]);

  useEffect(() => {
    loadBusinesses();
  }, [loadBusinesses]);

  if (!isPlatformAdmin) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
        Platform Administrator access required.
      </div>
    );
  }

  const handleConfirmStatusChange = async () => {
    if (!statusAction || !reason.trim()) {
      setError('Audit reason is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/api/admin/businesses/${statusAction.row.business._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: statusAction.nextStatus, reason: reason.trim() }),
      });
      if (statusAction.nextStatus === 'SUSPENDED' && statusAction.row.subscription) {
        await apiRequest(
          `/api/admin/subscriptions/${statusAction.row.business._id}/suspend`,
          { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
        );
      }
      setBanner(
        `${statusAction.row.business.name} marked ${statusAction.nextStatus}.`,
      );
      setStatusAction(null);
      setReason('');
      await loadBusinesses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
      setStatusAction(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Business Management</h1>
        <p className="text-sm text-slate-500">
          Inspect registered tenants, pilot/grandfathered indicators, and activate or suspend workspaces.
        </p>
      </div>

      {banner && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="text-xs hover:underline">
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

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search business name..."
            className="w-full rounded-lg border border-slate-200 py-2 pr-3 pl-9 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
          >
            <option value="ALL">All Types</option>
            <option value="RESTAURANT">Restaurant</option>
            <option value="GROCERY">Grocery</option>
            <option value="RETAIL">Retail</option>
            <option value="WHOLESALE">Wholesale</option>
            <option value="GENERAL">General</option>
          </select>
          <select
            value={subscriptionStatus}
            onChange={(e) => setSubscriptionStatus(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
          >
            <option value="ALL">All Subscription Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="TRIALING">Trialing</option>
            <option value="EXPIRED">Expired</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="PENDING">Pending</option>
          </select>
        </div>
      </div>

      <DataTable<AdminBusinessRow>
        loading={loading}
        data={rows}
        keyExtractor={(r) => r.business._id}
        emptyMessage="No businesses match the selected filters."
        columns={[
          {
            key: 'business',
            header: 'Business & Owner',
            render: (r) => (
              <div>
                <p className="font-medium text-slate-900">{r.business.name}</p>
                <p className="text-xs text-slate-500">
                  {r.business.businessType} • {r.business.ownerId?.name || 'Owner'} (
                  {r.business.ownerId?.whatsappNumber || 'N/A'})
                </p>
              </div>
            ),
          },
          {
            key: 'dates',
            header: 'Registered / Activated',
            render: (r) => (
              <div className="text-xs text-slate-600">
                <p>Reg: {formatDate(r.business.createdAt)}</p>
                <p>
                  Act:{' '}
                  {r.subscription?.trialStartedAt
                    ? formatDate(r.subscription.trialStartedAt)
                    : r.subscription?.currentPeriodStart
                      ? formatDate(r.subscription.currentPeriodStart)
                      : '—'}
                </p>
              </div>
            ),
          },
          {
            key: 'sub',
            header: 'Subscription & Flags',
            render: (r) => {
              const s = r.subscription;
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant={
                      r.business.status === 'SUSPENDED'
                        ? 'danger'
                        : s?.status === 'ACTIVE'
                          ? 'success'
                          : s?.status === 'TRIALING'
                            ? 'info'
                            : 'warning'
                    }
                  >
                    {r.business.status === 'SUSPENDED' ? 'BIZ SUSPENDED' : s?.status || 'NONE'}
                  </Badge>
                  {s?.isPilotParticipant && <Badge variant="info">PILOT</Badge>}
                  {s?.billingExempt && <Badge variant="default">PRE_SAAS</Badge>}
                </div>
              );
            },
          },
          {
            key: 'actions',
            header: 'Actions',
            className: 'text-right',
            render: (r) => (
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelected(r)}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                  title="View details"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
                {r.business.status === 'SUSPENDED' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReason('');
                      setStatusAction({ row: r, nextStatus: 'ACTIVE' });
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Activate
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setReason('');
                      setStatusAction({ row: r, nextStatus: 'SUSPENDED' });
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                  >
                    <Ban className="h-3.5 w-3.5" /> Suspend
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">{selected.business.name}</h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 p-5 text-sm">
              <p>
                <strong>Type:</strong> {selected.business.businessType} •{' '}
                <strong>Currency:</strong> {selected.business.currency}
              </p>
              <p>
                <strong>Owner:</strong> {selected.business.ownerId?.name} (
                {selected.business.ownerId?.whatsappNumber})
              </p>
              <p>
                <strong>Subscription:</strong> {selected.subscription?.status || 'NONE'} (
                {selected.subscription?.planCode || '—'}) • Source:{' '}
                {selected.subscription?.activationSource || '—'}
              </p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                  Subscription Audit History
                </p>
                {(selected.subscription?.statusHistory || []).length === 0 ? (
                  <p className="text-xs text-slate-500">No transitions recorded.</p>
                ) : (
                  <ul className="space-y-1.5 text-xs text-slate-700">
                    {(selected.subscription?.statusHistory || []).map((h, idx) => (
                      <li key={idx}>
                        {h.from || 'INIT'} → <strong>{h.to}</strong> ({formatDate(h.timestamp)}):{' '}
                        {h.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {statusAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {statusAction.nextStatus === 'SUSPENDED' ? 'Suspend Business' : 'Activate Business'}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Enter a mandatory audit reason for updating {statusAction.row.business.name}.
            </p>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Audit reason..."
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStatusAction(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting || !reason.trim()}
                onClick={handleConfirmStatusChange}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={false}
        title=""
        description=""
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    </div>
  );
}
