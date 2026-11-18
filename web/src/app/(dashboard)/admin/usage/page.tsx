'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, ApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';

interface AdminUsageRow {
  _id: string;
  business?: { _id: string; name: string; businessType: string };
  periodKey: string;
  aiRequestsCount: number;
  aiLimit: number;
  aiPct: number;
  aiWarning: boolean;
  aiLimitReached: boolean;
  whatsappMessagesCount: number;
  waLimit: number;
  waPct: number;
  waWarning: boolean;
  waLimitReached: boolean;
}

export default function AdminUsagePage() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';

  const [periodKey, setPeriodKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<AdminUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUsage = useCallback(async () => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<AdminUsageRow[]>(`/api/admin/usage?periodKey=${periodKey}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin, periodKey]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  if (!isPlatformAdmin) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
        Platform Administrator access required.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Usage Monitoring</h1>
            <p className="text-sm text-slate-500">
              Monthly AI &amp; WhatsApp consumption per business with 80% warnings and limit-reached indicators.
            </p>
          </div>
        </div>
        <input
          type="month"
          value={periodKey}
          onChange={(e) => setPeriodKey(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <DataTable<AdminUsageRow>
        loading={loading}
        data={rows}
        keyExtractor={(r) => r._id}
        emptyMessage={`No usage recorded for ${periodKey}.`}
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
            key: 'ai',
            header: 'AI Requests',
            render: (r) => (
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">
                  {r.aiRequestsCount} / {r.aiLimit} ({r.aiPct}%)
                </span>
                {r.aiLimitReached ? (
                  <Badge variant="danger">Limit Reached</Badge>
                ) : r.aiWarning ? (
                  <Badge variant="warning">80%+ Warning</Badge>
                ) : null}
              </div>
            ),
          },
          {
            key: 'wa',
            header: 'WhatsApp Messages',
            render: (r) => (
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">
                  {r.whatsappMessagesCount} / {r.waLimit} ({r.waPct}%)
                </span>
                {r.waLimitReached ? (
                  <Badge variant="danger">Limit Reached</Badge>
                ) : r.waWarning ? (
                  <Badge variant="warning">80%+ Warning</Badge>
                ) : null}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
