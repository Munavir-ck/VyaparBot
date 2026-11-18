'use client';

import React, { useEffect, useState } from 'react';
import { X, ArrowDownLeft, ArrowUpRight, Pencil } from 'lucide-react';
import { apiRequest, ApiError } from '@/lib/api-client';
import { formatCurrency, formatDate, formatLabel } from '@/lib/formatters';
import { Badge } from '@/components/ui/Badge';
import type { CustomerLedgerData, SupplierLedgerData } from '@/types/api';

interface LedgerDrawerProps {
  open: boolean;
  mode: 'CUSTOMER' | 'SUPPLIER';
  partyId: string | null;
  currency?: string;
  timezone?: string;
  onClose: () => void;
  onRecordPayment?: (partyId: string) => void;
  onEditParty?: (partyId: string) => void;
}

export function LedgerDrawer({
  open,
  mode,
  partyId,
  currency = 'INR',
  timezone = 'Asia/Kolkata',
  onClose,
  onRecordPayment,
  onEditParty,
}: LedgerDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerLedger, setCustomerLedger] = useState<CustomerLedgerData | null>(null);
  const [supplierLedger, setSupplierLedger] = useState<SupplierLedgerData | null>(null);
  const [tab, setTab] = useState<'LEDGER' | 'PRIMARY' | 'PAYMENTS'>('LEDGER');

  useEffect(() => {
    if (!open || !partyId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (mode === 'CUSTOMER') {
          const res = await apiRequest<CustomerLedgerData>(`/api/customers/${partyId}/ledger`);
          if (!cancelled) setCustomerLedger(res);
        } else {
          const res = await apiRequest<SupplierLedgerData>(`/api/suppliers/${partyId}/ledger`);
          if (!cancelled) setSupplierLedger(res);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load ledger');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, mode, partyId]);

  if (!open || !partyId) return null;

  const party = mode === 'CUSTOMER' ? customerLedger?.customer : supplierLedger?.supplier;
  const outstanding = party?.outstandingBalance ?? 0;
  const transactions =
    mode === 'CUSTOMER' ? customerLedger?.transactions || [] : supplierLedger?.transactions || [];
  const primaryList =
    mode === 'CUSTOMER' ? customerLedger?.creditSales || [] : supplierLedger?.purchases || [];
  const payments =
    mode === 'CUSTOMER' ? customerLedger?.payments || [] : supplierLedger?.payments || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {party?.name || (mode === 'CUSTOMER' ? 'Customer Ledger' : 'Supplier Ledger')}
            </h2>
            <p className="text-xs text-slate-500">
              {party?.phone || 'No phone'}
              {mode === 'SUPPLIER' && supplierLedger?.supplier.category
                ? ` • ${supplierLedger.supplier.category}`
                : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onEditParty && party && (
              <button
                type="button"
                onClick={() => onEditParty(party._id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
            {onRecordPayment && party && (
              <button
                type="button"
                onClick={() => onRecordPayment(party._id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
              >
                {mode === 'CUSTOMER' ? (
                  <ArrowDownLeft className="h-3.5 w-3.5" />
                ) : (
                  <ArrowUpRight className="h-3.5 w-3.5" />
                )}
                Record Payment
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="space-y-3">
              <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {error}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">
                    {mode === 'CUSTOMER' ? 'Total Credit Sales' : 'Total Purchases'}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {formatCurrency(
                      mode === 'CUSTOMER'
                        ? customerLedger?.summary.totalCreditSales || 0
                        : supplierLedger?.summary.totalPurchases || 0,
                      currency,
                    )}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">
                    {mode === 'CUSTOMER' ? 'Payments Received' : 'Payments Made'}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-emerald-700">
                    {formatCurrency(
                      mode === 'CUSTOMER'
                        ? customerLedger?.summary.totalPaymentsReceived || 0
                        : supplierLedger?.summary.totalPayments || 0,
                      currency,
                    )}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-500">Outstanding</p>
                    <Badge variant={outstanding > 0 ? 'warning' : 'success'}>
                      {outstanding > 0 ? 'Outstanding' : 'Settled'}
                    </Badge>
                  </div>
                  <p
                    className={`mt-1 text-lg font-semibold ${
                      outstanding > 0 ? 'text-amber-700' : 'text-emerald-700'
                    }`}
                  >
                    {formatCurrency(outstanding, currency)}
                  </p>
                </div>
              </div>

              {party?.notes && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  <span className="font-semibold text-slate-700">Notes: </span>
                  {party.notes}
                </div>
              )}

              <div className="flex gap-2 border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => setTab('LEDGER')}
                  className={`border-b-2 px-3 py-2 text-xs font-semibold ${
                    tab === 'LEDGER'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Full Ledger ({transactions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTab('PRIMARY')}
                  className={`border-b-2 px-3 py-2 text-xs font-semibold ${
                    tab === 'PRIMARY'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {mode === 'CUSTOMER'
                    ? `Credit Sales (${primaryList.length})`
                    : `Purchases (${primaryList.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => setTab('PAYMENTS')}
                  className={`border-b-2 px-3 py-2 text-xs font-semibold ${
                    tab === 'PAYMENTS'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Payments ({payments.length})
                </button>
              </div>

              {tab === 'PAYMENTS' ? (
                payments.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">No payments recorded yet.</p>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {payments.map((p) => (
                      <div key={p._id} className="flex items-center justify-between px-4 py-3 text-sm">
                        <div>
                          <p className="font-medium text-slate-900">
                            {formatLabel(p.paymentMethod)}
                            {p.referenceId ? ` • Ref: ${p.referenceId}` : ''}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatDate(p.paymentDate, timezone)}
                            {p.notes ? ` • ${p.notes}` : ''}
                          </p>
                        </div>
                        <span className="font-semibold text-emerald-700">
                          {formatCurrency(p.amount, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                (() => {
                  const list = tab === 'LEDGER' ? transactions : primaryList;
                  if (list.length === 0) {
                    return (
                      <p className="py-8 text-center text-sm text-slate-500">
                        No transactions found.
                      </p>
                    );
                  }
                  return (
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {list.map((tx) => {
                        const isPayment =
                          tx.type === 'CUSTOMER_PAYMENT' || tx.type === 'SUPPLIER_PAYMENT';
                        return (
                          <div
                            key={tx._id}
                            className="flex items-center justify-between px-4 py-3 text-sm"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <Badge variant={isPayment ? 'success' : 'info'}>
                                  {formatLabel(tx.type)}
                                </Badge>
                                <span className="text-xs text-slate-500">
                                  {formatLabel(tx.paymentMethod)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-slate-600">
                                {tx.description || formatLabel(tx.category)} •{' '}
                                {formatDate(tx.transactionDate, timezone)}
                              </p>
                            </div>
                            <span
                              className={`font-semibold ${
                                isPayment ? 'text-emerald-700' : 'text-slate-900'
                              }`}
                            >
                              {isPayment ? '-' : '+'}
                              {formatCurrency(tx.amount, currency)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
