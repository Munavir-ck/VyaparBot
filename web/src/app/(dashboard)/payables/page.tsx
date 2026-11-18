'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Search,
  Eye,
  CheckCircle2,
  Truck,
  Receipt,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, apiRequestWithMeta, ApiError } from '@/lib/api-client';
import { formatCurrency, formatDate, formatLabel } from '@/lib/formatters';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { StatCard } from '@/components/ui/StatCard';
import { PermissionGate } from '@/components/layout/PermissionGate';
import { LedgerDrawer } from '@/components/contacts/LedgerDrawer';
import { RecordPaymentModal } from '@/components/contacts/RecordPaymentModal';
import type { SupplierSummaryItem, PaymentRecordItem } from '@/types/api';

interface PayablesResponse {
  status: string;
  totalPayables: number;
  count: number;
  total: number;
  page?: number;
  totalPages?: number;
  data: SupplierSummaryItem[];
}

interface PaymentsResponse {
  status: string;
  count: number;
  data: PaymentRecordItem[];
}

export default function PayablesPage() {
  const { business } = useAuth();
  const currency = business?.currency || 'INR';
  const timezone = business?.timezone || 'Asia/Kolkata';

  const [suppliers, setSuppliers] = useState<SupplierSummaryItem[]>([]);
  const [payments, setPayments] = useState<PaymentRecordItem[]>([]);
  const [totalPayables, setTotalPayables] = useState(0);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [onlyOutstanding, setOnlyOutstanding] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentPartyId, setPaymentPartyId] = useState<string | undefined>(undefined);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '15',
        onlyOutstanding: String(onlyOutstanding),
      });
      if (search.trim()) params.set('search', search.trim());

      const [supRes, payRes] = await Promise.all([
        apiRequestWithMeta<SupplierSummaryItem>(`/api/suppliers?${params.toString()}`),
        apiRequest<PaymentRecordItem[]>('/api/suppliers/payments?limit=25'),
      ]);

      setSuppliers(supRes.data || []);
      setTotalPayables(supRes.totalPayables || 0);
      setTotal(supRes.total ?? 0);
      setTotalPages(supRes.totalPages || 1);
      setPayments(payRes || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load payables');
    } finally {
      setLoading(false);
    }
  }, [page, search, onlyOutstanding]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const recentPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

  return (
    <PermissionGate
      permission="MANAGE_SUPPLIERS"
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          You do not have permission to view or settle supplier payables.
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Accounts Payable</h1>
            <p className="text-sm text-slate-500">
              Track supplier dues, settle payables without duplicating expenses, and review payment history.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setPaymentPartyId(undefined);
              setPaymentModalOpen(true);
            }}
            disabled={suppliers.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <ArrowUpRight className="h-4 w-4" />
            Record Supplier Payment
          </button>
        </div>

        {banner && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {banner}
            </span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-xs font-medium text-emerald-700 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            title="Total Payables"
            value={formatCurrency(totalPayables, currency)}
            subtitle="Total owed to suppliers"
            icon={ArrowUpRight}
            tone={totalPayables > 0 ? 'rose' : 'emerald'}
          />
          <StatCard
            title="Suppliers Matching"
            value={String(total)}
            subtitle={onlyOutstanding ? 'With payable due' : 'All active suppliers'}
            icon={Truck}
          />
          <StatCard
            title="Recent Settlements"
            value={formatCurrency(recentPaid, currency)}
            subtitle={`${payments.length} recent payouts`}
            icon={Receipt}
            tone="emerald"
          />
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Filter by supplier name, phone, or category..."
              className="w-full rounded-lg border border-slate-200 py-2 pr-3 pl-9 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={onlyOutstanding}
              onChange={(e) => {
                setOnlyOutstanding(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Outstanding payables only
          </label>
        </div>

        <DataTable<SupplierSummaryItem>
          loading={loading}
          data={suppliers}
          keyExtractor={(s) => s._id}
          emptyMessage={
            onlyOutstanding
              ? 'All supplier payables are settled.'
              : 'No suppliers match your filter.'
          }
          columns={[
            {
              key: 'name',
              header: 'Supplier',
              render: (s) => (
                <div>
                  <p className="font-medium text-slate-900">{s.name}</p>
                  <p className="text-xs text-slate-500">
                    {s.phone || 'No phone'}
                    {s.category ? ` • ${s.category}` : ''}
                  </p>
                </div>
              ),
            },
            {
              key: 'purchases',
              header: 'Purchases',
              className: 'text-right',
              render: (s) => formatCurrency(s.totalPurchases || 0, currency),
            },
            {
              key: 'paid',
              header: 'Paid',
              className: 'text-right',
              render: (s) => (
                <span className="text-emerald-700">
                  {formatCurrency(s.totalPayments || 0, currency)}
                </span>
              ),
            },
            {
              key: 'balance',
              header: 'Payable',
              className: 'text-right',
              render: (s) => (
                <span
                  className={`font-semibold ${
                    s.outstandingBalance > 0 ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {formatCurrency(s.outstandingBalance, currency)}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (s) => (
                <Badge variant={s.outstandingBalance > 0 ? 'danger' : 'success'}>
                  {s.outstandingBalance > 0 ? 'Payable Due' : 'Settled'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              className: 'text-right',
              render: (s) => (
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLedgerId(s._id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Eye className="h-3.5 w-3.5" /> Ledger
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentPartyId(s._id);
                      setPaymentModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" /> Pay
                  </button>
                </div>
              ),
            },
          ]}
        />

        {totalPages > 1 && (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <span className="text-slate-600">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Supplier Payment History</h2>
          <DataTable<PaymentRecordItem>
            loading={loading}
            data={payments}
            keyExtractor={(p) => p._id}
            emptyMessage="No supplier payments recorded yet."
            columns={[
              {
                key: 'supplier',
                header: 'Supplier',
                render: (p) => {
                  const name =
                    typeof p.supplierId === 'object' && p.supplierId
                      ? p.supplierId.name
                      : 'Supplier';
                  return <span className="font-medium text-slate-900">{name}</span>;
                },
              },
              {
                key: 'date',
                header: 'Date',
                render: (p) => formatDate(p.paymentDate, timezone),
              },
              {
                key: 'method',
                header: 'Method',
                render: (p) => <Badge variant="info">{formatLabel(p.paymentMethod)}</Badge>,
              },
              {
                key: 'notes',
                header: 'Reference / Notes',
                render: (p) => (
                  <span className="text-xs text-slate-600">
                    {p.referenceId ? `Ref: ${p.referenceId}` : p.notes || '—'}
                  </span>
                ),
              },
              {
                key: 'amount',
                header: 'Amount',
                className: 'text-right',
                render: (p) => (
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(p.amount, currency)}
                  </span>
                ),
              },
            ]}
          />
        </div>

        <LedgerDrawer
          open={Boolean(ledgerId)}
          mode="SUPPLIER"
          partyId={ledgerId}
          currency={currency}
          timezone={timezone}
          onClose={() => setLedgerId(null)}
          onRecordPayment={(id) => {
            setLedgerId(null);
            setPaymentPartyId(id);
            setPaymentModalOpen(true);
          }}
        />

        <RecordPaymentModal
          open={paymentModalOpen}
          mode="SUPPLIER"
          parties={suppliers}
          initialPartyId={paymentPartyId}
          currency={currency}
          onClose={() => setPaymentModalOpen(false)}
          onSuccess={() => {
            setBanner('Supplier payment recorded and payable reduced.');
            loadData();
          }}
        />
      </div>
    </PermissionGate>
  );
}
