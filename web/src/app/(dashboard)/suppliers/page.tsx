'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Truck,
  Plus,
  Search,
  Eye,
  Pencil,
  ArrowUpRight,
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
import type { SupplierSummaryItem } from '@/types/api';

interface SuppliersResponse {
  status: string;
  totalPayables: number;
  count: number;
  total: number;
  page?: number;
  totalPages?: number;
  data: SupplierSummaryItem[];
}

export default function SuppliersPage() {
  const { business } = useAuth();
  const currency = business?.currency || 'INR';
  const timezone = business?.timezone || 'Asia/Kolkata';

  const [suppliers, setSuppliers] = useState<SupplierSummaryItem[]>([]);
  const [totalPayables, setTotalPayables] = useState(0);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierSummaryItem | null>(null);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentPartyId, setPaymentPartyId] = useState<string | undefined>(undefined);

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '15' });
      if (search.trim()) params.set('search', search.trim());
      const res = await apiRequestWithMeta<SupplierSummaryItem>(`/api/suppliers?${params.toString()}`);
      setSuppliers(res.data || []);
      setTotalPayables(res.totalPayables || 0);
      setTotal(res.total ?? 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  return (
    <PermissionGate
      permission="MANAGE_SUPPLIERS"
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          You do not have permission to manage suppliers.
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Suppliers</h1>
            <p className="text-sm text-slate-500">
              Manage vendor contacts, purchases, payments, and payable ledgers.
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
              <ArrowUpRight className="h-4 w-4 text-rose-600" />
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
              Add Supplier
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
            title="Total Suppliers"
            value={String(total)}
            subtitle="Active vendor accounts"
            icon={Truck}
          />
          <StatCard
            title="Total Payables"
            value={formatCurrency(totalPayables, currency)}
            subtitle="Outstanding across all suppliers"
            icon={ArrowUpRight}
            tone={totalPayables > 0 ? 'rose' : 'emerald'}
          />
          <StatCard
            title="Settled on Page"
            value={String(suppliers.filter((s) => s.outstandingBalance <= 0).length)}
            subtitle="Zero balance suppliers"
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
              placeholder="Search by supplier name, phone, or category..."
              className="w-full rounded-lg border border-slate-200 py-2 pr-3 pl-9 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-slate-500">
            Showing {suppliers.length} of {total} suppliers
          </p>
        </div>

        <DataTable<SupplierSummaryItem>
          loading={loading}
          data={suppliers}
          keyExtractor={(s) => s._id}
          emptyMessage="No suppliers found. Add a supplier or record a purchase to get started."
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
              key: 'payments',
              header: 'Payments',
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
                    title="View details & ledger"
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(s);
                      setFormOpen(true);
                    }}
                    title="Edit supplier"
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentPartyId(s._id);
                      setPaymentModalOpen(true);
                    }}
                    title="Record payment"
                    className="rounded-lg bg-rose-50 p-1.5 text-rose-700 hover:bg-rose-100"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
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
          mode="SUPPLIER"
          editing={editing}
          onClose={() => setFormOpen(false)}
          onSuccess={() => {
            setBanner(editing ? 'Supplier updated.' : 'Supplier added.');
            loadSuppliers();
          }}
        />

        <LedgerDrawer
          open={Boolean(ledgerId)}
          mode="SUPPLIER"
          partyId={ledgerId}
          currency={currency}
          timezone={timezone}
          onClose={() => setLedgerId(null)}
          onEditParty={(id) => {
            const found = suppliers.find((s) => s._id === id) || null;
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
          mode="SUPPLIER"
          parties={suppliers}
          initialPartyId={paymentPartyId}
          currency={currency}
          onClose={() => setPaymentModalOpen(false)}
          onSuccess={() => {
            setBanner('Supplier payment recorded and payable updated.');
            loadSuppliers();
          }}
        />
      </div>
    </PermissionGate>
  );
}
