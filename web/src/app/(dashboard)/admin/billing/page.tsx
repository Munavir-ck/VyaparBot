'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Wallet, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, ApiError } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';

interface SaasPaymentRow {
  _id: string;
  businessId?: { _id: string; name: string };
  amountInPaise: number;
  currency: string;
  method: string;
  status: string;
  referenceId?: string | null;
  paidAt: string;
}

interface InvoiceRow {
  _id: string;
  invoiceNumber: string;
  businessId?: { _id: string; name: string };
  totalInPaise: number;
  currency: string;
  status: string;
  issuedAt: string;
}

export default function AdminBillingPage() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';

  const [payments, setPayments] = useState<SaasPaymentRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [pay, inv] = await Promise.all([
        apiRequest<SaasPaymentRow[]>('/api/admin/payments'),
        apiRequest<InvoiceRow[]>('/api/admin/invoices'),
      ]);
      setPayments(Array.isArray(pay) ? pay : []);
      setInvoices(Array.isArray(inv) ? inv : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load SaaS billing records');
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  if (!isPlatformAdmin) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
        Platform Administrator access required.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
          <Wallet className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">SaaS Billing &amp; Invoices</h1>
          <p className="text-sm text-slate-500">
            Actual platform subscription payments and invoices (strictly separate from tenant shop accounting).
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">SaaS Payments</h2>
        <DataTable<SaasPaymentRow>
          loading={loading}
          data={payments}
          keyExtractor={(p) => p._id}
          emptyMessage="No SaaS subscription payments recorded yet (complimentary pilot trials do not generate payment records)."
          columns={[
            {
              key: 'business',
              header: 'Business',
              render: (p) => (
                <span className="font-medium text-slate-900">{p.businessId?.name || 'Business'}</span>
              ),
            },
            {
              key: 'method',
              header: 'Method / Ref',
              render: (p) => (
                <span className="text-xs text-slate-600">
                  {p.method}
                  {p.referenceId ? ` • ${p.referenceId}` : ''}
                </span>
              ),
            },
            {
              key: 'date',
              header: 'Paid Date',
              render: (p) => formatDate(p.paidAt),
            },
            {
              key: 'status',
              header: 'Status',
              render: (p) => (
                <Badge variant={p.status === 'CAPTURED' ? 'success' : 'warning'}>{p.status}</Badge>
              ),
            },
            {
              key: 'amount',
              header: 'Amount',
              className: 'text-right',
              render: (p) => (
                <span className="font-semibold text-slate-900">
                  {formatCurrency(p.amountInPaise / 100, p.currency || 'INR')}
                </span>
              ),
            },
          ]}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">SaaS Invoices</h2>
        <DataTable<InvoiceRow>
          loading={loading}
          data={invoices}
          keyExtractor={(i) => i._id}
          emptyMessage="No SaaS invoices issued yet."
          columns={[
            {
              key: 'number',
              header: 'Invoice #',
              render: (i) => <span className="font-medium text-slate-900">{i.invoiceNumber}</span>,
            },
            {
              key: 'business',
              header: 'Business',
              render: (i) => i.businessId?.name || 'Business',
            },
            {
              key: 'date',
              header: 'Issued Date',
              render: (i) => formatDate(i.issuedAt),
            },
            {
              key: 'status',
              header: 'Status',
              render: (i) => (
                <Badge variant={i.status === 'PAID' ? 'success' : 'default'}>{i.status}</Badge>
              ),
            },
            {
              key: 'total',
              header: 'Total',
              className: 'text-right',
              render: (i) => formatCurrency(i.totalInPaise / 100, i.currency || 'INR'),
            },
          ]}
        />
      </div>
    </div>
  );
}
