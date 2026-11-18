'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  Search,
  Eye,
  CheckCircle2,
  Users,
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
import type { CustomerSummaryItem, PaymentRecordItem } from '@/types/api';

interface ReceivablesResponse {
  status: string;
  totalReceivables: number;
  count: number;
  total: number;
  page?: number;
  totalPages?: number;
  data: CustomerSummaryItem[];
}

interface PaymentsResponse {
  status: string;
  count: number;
  data: PaymentRecordItem[];
}

export default function ReceivablesPage() {
  const { business } = useAuth();
  const currency = business?.currency || 'INR';
  const timezone = business?.timezone || 'Asia/Kolkata';

  const [customers, setCustomers] = useState<CustomerSummaryItem[]>([]);
  const [payments, setPayments] = useState<PaymentRecordItem[]>([]);
  const [totalReceivables, setTotalReceivables] = useState(0);
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

      const [balRes, payRes] = await Promise.all([
        apiRequestWithMeta<CustomerSummaryItem>(`/api/customers/balances?${params.toString()}`),
        apiRequest<PaymentRecordItem[]>('/api/customers/payments?limit=25'),
      ]);

      setCustomers(balRes.data || []);
      setTotalReceivables(balRes.totalReceivables || 0);
      setTotal(balRes.total ?? 0);
      setTotalPages(balRes.totalPages || 1);
      setPayments(payRes || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load receivables');
    } finally {
      setLoading(false);
    }
  }, [page, search, onlyOutstanding]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const recentCollected = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

  return (
    <PermissionGate
      permission="MANAGE_CUSTOMERS"
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          You do not have permission to view or collect customer receivables.
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Accounts Receivable</h1>
            <p className="text-sm text-slate-500">
              Track customer credit balances, collect payments, and inspect payment history.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setPaymentPartyId(undefined);
              setPaymentModalOpen(true);
            }}
            disabled={customers.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <ArrowDownLeft className="h-4 w-4" />
            Record Customer Payment
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
            title="Total Receivables"
            value={formatCurrency(totalReceivables, currency)}
            subtitle="Total outstanding from customers"
            icon={ArrowDownLeft}
            tone={totalReceivables > 0 ? 'amber' : 'emerald'}
          />
          <StatCard
            title="Customers Matching"
            value={String(total)}
            subtitle={onlyOutstanding ? 'With open balance' : 'All active customers'}
            icon={Users}
          />
          <StatCard
            title="Recent Payments"
            value={formatCurrency(recentCollected, currency)}
            subtitle={`${payments.length} recent receipts`}
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
              placeholder="Filter by customer name or phone..."
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
            Outstanding balances only
          </label>
        </div>

        <DataTable<CustomerSummaryItem>
          loading={loading}
          data={customers}
          keyExtractor={(c) => c._id}
          emptyMessage={
            onlyOutstanding
              ? 'All customer balances are settled.'
              : 'No customers match your filter.'
          }
          columns={[
            {
              key: 'name',
              header: 'Customer',
              render: (c) => (
                <div>
                  <p className="font-medium text-slate-900">{c.name}</p>
                  <p className="text-xs text-slate-500">{c.phone || 'No phone'}</p>
                </div>
              ),
            },
            {
              key: 'creditSales',
              header: 'Credit Sales',
              className: 'text-right',
              render: (c) => formatCurrency(c.totalCreditSales || 0, currency),
            },
            {
              key: 'received',
              header: 'Received',
              className: 'text-right',
              render: (c) => (
                <span className="text-emerald-700">
                  {formatCurrency(c.totalPaymentsReceived || 0, currency)}
                </span>
              ),
            },
            {
              key: 'balance',
              header: 'Outstanding',
              className: 'text-right',
              render: (c) => (
                <span
                  className={`font-semibold ${
                    c.outstandingBalance > 0 ? 'text-amber-700' : 'text-emerald-700'
                  }`}
                >
                  {formatCurrency(c.outstandingBalance, currency)}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (c) => (
                <Badge variant={c.outstandingBalance > 0 ? 'warning' : 'success'}>
                  {c.outstandingBalance > 0 ? 'Outstanding' : 'Settled'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              className: 'text-right',
              render: (c) => (
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLedgerId(c._id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Eye className="h-3.5 w-3.5" /> Ledger
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentPartyId(c._id);
                      setPaymentModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    <ArrowDownLeft className="h-3.5 w-3.5" /> Collect
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
          <h2 className="text-base font-semibold text-slate-900">Customer Payment History</h2>
          <DataTable<PaymentRecordItem>
            loading={loading}
            data={payments}
            keyExtractor={(p) => p._id}
            emptyMessage="No customer payments recorded yet."
            columns={[
              {
                key: 'customer',
                header: 'Customer',
                render: (p) => {
                  const name =
                    typeof p.customerId === 'object' && p.customerId
                      ? p.customerId.name
                      : 'Customer';
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
                  <span className="font-semibold text-emerald-700">
                    +{formatCurrency(p.amount, currency)}
                  </span>
                ),
              },
            ]}
          />
        </div>

        <LedgerDrawer
          open={Boolean(ledgerId)}
          mode="CUSTOMER"
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
          mode="CUSTOMER"
          parties={customers}
          initialPartyId={paymentPartyId}
          currency={currency}
          onClose={() => setPaymentModalOpen(false)}
          onSuccess={() => {
            setBanner('Customer payment recorded and receivable reduced.');
            loadData();
          }}
        />
      </div>
    </PermissionGate>
  );
}
