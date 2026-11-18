'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Users,
  Plus,
  Search,
  Eye,
  Pencil,
  ArrowDownLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequestWithMeta, ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/formatters';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { StatCard } from '@/components/ui/StatCard';
import { PermissionGate } from '@/components/layout/PermissionGate';
import { PartyFormModal } from '@/components/contacts/PartyFormModal';
import { LedgerDrawer } from '@/components/contacts/LedgerDrawer';
import { RecordPaymentModal } from '@/components/contacts/RecordPaymentModal';
import type { CustomerSummaryItem } from '@/types/api';

interface CustomersResponse {
  status: string;
  count: number;
  total: number;
  page?: number;
  totalPages?: number;
  data: CustomerSummaryItem[];
}

export default function CustomersPage() {
  const { business } = useAuth();
  const currency = business?.currency || 'INR';
  const timezone = business?.timezone || 'Asia/Kolkata';

  const [customers, setCustomers] = useState<CustomerSummaryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerSummaryItem | null>(null);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentPartyId, setPaymentPartyId] = useState<string | undefined>(undefined);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '15' });
      if (search.trim()) params.set('search', search.trim());
      const res = await apiRequestWithMeta<CustomerSummaryItem>(`/api/customers?${params.toString()}`);
      setCustomers(res.data || []);
      setTotal(res.total ?? 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const pageReceivables = customers.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0);

  return (
    <PermissionGate
      permission="MANAGE_CUSTOMERS"
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          You do not have permission to manage customers.
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Customers</h1>
            <p className="text-sm text-slate-500">
              Manage customer directory, credit sales, payments, and ledgers.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setPaymentPartyId(undefined);
                setPaymentModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
              Record Payment
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              Add Customer
            </button>
          </div>
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
            title="Total Customers"
            value={String(total)}
            subtitle="Active customer profiles"
            icon={Users}
          />
          <StatCard
            title="Visible Outstanding"
            value={formatCurrency(pageReceivables, currency)}
            subtitle="Across current page"
            icon={ArrowDownLeft}
            tone={pageReceivables > 0 ? 'amber' : 'emerald'}
          />
          <StatCard
            title="Settled on Page"
            value={String(customers.filter((c) => c.outstandingBalance <= 0).length)}
            subtitle="Zero balance customers"
            icon={CheckCircle2}
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
              placeholder="Search by customer name or phone..."
              className="w-full rounded-lg border border-slate-200 py-2 pr-3 pl-9 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-slate-500">
            Showing {customers.length} of {total} customers
          </p>
        </div>

        <DataTable<CustomerSummaryItem>
          loading={loading}
          data={customers}
          keyExtractor={(c) => c._id}
          emptyMessage="No customers found. Add a customer or record a credit sale to get started."
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
              key: 'payments',
              header: 'Payments',
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
                    title="View details & ledger"
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(c);
                      setFormOpen(true);
                    }}
                    title="Edit customer"
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentPartyId(c._id);
                      setPaymentModalOpen(true);
                    }}
                    title="Record payment"
                    className="rounded-lg bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100"
                  >
                    <ArrowDownLeft className="h-3.5 w-3.5" />
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

        <PartyFormModal
          open={formOpen}
          mode="CUSTOMER"
          editing={editing}
          onClose={() => setFormOpen(false)}
          onSuccess={() => {
            setBanner(editing ? 'Customer updated.' : 'Customer added.');
            loadCustomers();
          }}
        />

        <LedgerDrawer
          open={Boolean(ledgerId)}
          mode="CUSTOMER"
          partyId={ledgerId}
          currency={currency}
          timezone={timezone}
          onClose={() => setLedgerId(null)}
          onEditParty={(id) => {
            const found = customers.find((c) => c._id === id) || null;
            setLedgerId(null);
            setEditing(found);
            setFormOpen(true);
          }}
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
            setBanner('Customer payment recorded and balance updated.');
            loadCustomers();
          }}
        />
      </div>
    </PermissionGate>
  );
}
