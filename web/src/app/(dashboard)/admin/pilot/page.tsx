'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles, Clock, CheckCircle2, AlertCircle, PlusCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/formatters';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';

interface PilotSummary {
  maxSlots: number;
  slotsUsed: number;
  slotsRemaining: number;
  participants: Array<{
    subscriptionId: string;
    business?: { _id: string; name: string; businessType: string };
    status: string;
    planCode: string;
    trialStartedAt?: string;
    trialEndsAt?: string;
    remainingDays: number;
    usageLimits?: {
      maxMembers: number;
      maxProducts: number;
      monthlyAiRequests: number;
      monthlyWhatsappMessages: number;
    };
    grantReason?: string;
  }>;
}

interface AdminBusinessRow {
  business: { _id: string; name: string; businessType: string };
  subscription: { isPilotParticipant?: boolean; billingExempt?: boolean; status?: string } | null;
}

export default function AdminPilotPage() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';

  const [summary, setSummary] = useState<PilotSummary | null>(null);
  const [eligible, setEligible] = useState<AdminBusinessRow[]>([]);
  const [selectedBizId, setSelectedBizId] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadPilot = useCallback(async () => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [sum, allBiz] = await Promise.all([
        apiRequest<PilotSummary>('/api/admin/pilot/summary'),
        apiRequest<AdminBusinessRow[]>('/api/admin/businesses'),
      ]);
      setSummary(sum);
      const elig = (allBiz || []).filter(
        (r) => !r.subscription?.isPilotParticipant && !r.subscription?.billingExempt,
      );
      setEligible(elig);
      if (elig.length > 0 && !selectedBizId) setSelectedBizId(elig[0].business._id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load pilot summary');
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin, selectedBizId]);

  useEffect(() => {
    loadPilot();
  }, [loadPilot]);

  if (!isPlatformAdmin) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
        Platform Administrator access required.
      </div>
    );
  }

  const handleGrantPilot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBizId || !grantReason.trim()) return;
    setError(null);
    try {
      await apiRequest(`/api/admin/subscriptions/${selectedBizId}/grant-pilot`, {
        method: 'POST',
        body: JSON.stringify({ reason: grantReason.trim(), planCode: 'PILOT' }),
      });
      setBanner('30-day complimentary pilot granted.');
      setGrantReason('');
      await loadPilot();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to grant pilot');
    }
  };

  const handleExtend = async (businessId: string, name: string) => {
    const daysStr = window.prompt(`Extend trial for "${name}" by how many days?`, '7');
    const extraDays = Number(daysStr);
    if (!extraDays || extraDays <= 0) return;
    const reason = window.prompt('Mandatory audit reason for exceptional extension:');
    if (!reason || !reason.trim()) return;
    setError(null);
    try {
      await apiRequest(`/api/admin/subscriptions/${businessId}/extend-trial`, {
        method: 'POST',
        body: JSON.stringify({ extraDays, reason: reason.trim() }),
      });
      setBanner(`Extended trial for ${name} by ${extraDays} days.`);
      await loadPilot();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to extend trial');
    }
  };

  const handleConvertPaid = async (businessId: string, name: string) => {
    const amtStr = window.prompt(`Convert "${name}" to paid ACTIVE. Enter verified INR amount:`);
    const rupees = Number(amtStr);
    if (!rupees || rupees <= 0) return;
    const ref = window.prompt('Payment reference (UTR / Bank Ref):') || '';
    setError(null);
    try {
      await apiRequest(`/api/admin/subscriptions/${businessId}/activate-paid`, {
        method: 'POST',
        body: JSON.stringify({
          planCode: 'STARTER',
          amountInPaise: Math.round(rupees * 100),
          method: 'MANUAL_UPI',
          referenceId: ref.trim() || null,
          notes: `Pilot conversion for ${name}`,
          idempotencyKey: `pilot-conv-${businessId}-${Date.now()}`,
        }),
      });
      setBanner(`${name} converted to paid ACTIVE subscription.`);
      await loadPilot();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Conversion failed');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">30-Day Pilot Programme</h1>
        <p className="text-sm text-slate-500">
          Manage the 3 complimentary pilot slots, track remaining days in UTC, extend with audit reason, or convert to paid.
        </p>
      </div>

      {banner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {banner}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Pilot Slots Used"
          value={`${summary?.slotsUsed ?? 0} / ${summary?.maxSlots ?? 3}`}
          subtitle="Maximum 3 approved pilot shops"
          icon={Sparkles}
          tone="emerald"
        />
        <StatCard
          title="Slots Remaining"
          value={String(summary?.slotsRemaining ?? 3)}
          subtitle="Available for manual grant"
          icon={Clock}
        />
        <StatCard
          title="Active Trials"
          value={String((summary?.participants || []).filter((p) => p.status === 'TRIALING').length)}
          subtitle="Currently in 30-day window"
          icon={CheckCircle2}
        />
      </div>

      {(summary?.slotsRemaining ?? 0) > 0 && (
        <form
          onSubmit={handleGrantPilot}
          className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3"
        >
          <select
            value={selectedBizId}
            onChange={(e) => setSelectedBizId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">Select eligible business</option>
            {eligible.map((r) => (
              <option key={r.business._id} value={r.business._id}>
                {r.business.name} ({r.business.businessType})
              </option>
            ))}
          </select>
          <input
            type="text"
            value={grantReason}
            onChange={(e) => setGrantReason(e.target.value)}
            placeholder="Mandatory grant reason (e.g. Pilot shop #1)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <button
            type="submit"
            disabled={!selectedBizId}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <PlusCircle className="h-4 w-4" />
            Grant 30-Day Pilot
          </button>
        </form>
      )}

      {loading ? (
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
      ) : (summary?.participants || []).length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No pilot businesses activated yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {(summary?.participants || []).map((p, idx) => (
            <div key={p.subscriptionId} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-400">Slot #{idx + 1}</p>
                  <h3 className="text-base font-semibold text-slate-900">
                    {p.business?.name || 'Business'}
                  </h3>
                  <p className="text-xs text-slate-500">{p.business?.businessType}</p>
                </div>
                <Badge variant={p.status === 'TRIALING' ? 'info' : 'success'}>{p.status}</Badge>
              </div>
              <div className="space-y-1 text-xs text-slate-600">
                <p>Start (UTC): {p.trialStartedAt ? formatDate(p.trialStartedAt) : '—'}</p>
                <p>Expiry (UTC): {p.trialEndsAt ? formatDate(p.trialEndsAt) : '—'}</p>
                <p className="font-semibold text-emerald-700">
                  Remaining: {p.remainingDays} day(s)
                </p>
                <p>
                  Limits: {p.usageLimits?.maxMembers ?? 5} members •{' '}
                  {p.usageLimits?.maxProducts ?? 500} products •{' '}
                  {p.usageLimits?.monthlyAiRequests ?? 500} AI/mo
                </p>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleExtend(p.business?._id || '', p.business?.name || 'Shop')}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Extend Trial
                </button>
                <button
                  type="button"
                  onClick={() => handleConvertPaid(p.business?._id || '', p.business?.name || 'Shop')}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  Convert to Paid
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
