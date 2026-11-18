'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  TrendingDown,
  ShoppingBag,
  Banknote,
  Smartphone,
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Plus,
  ArrowRight,
  Calendar,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api-client';
import { formatCurrency } from '@/lib/formatters';
import { StatCard } from '@/components/ui/StatCard';
import { PermissionGate } from '@/components/layout/PermissionGate';
import {
  TransactionFormsModal,
  type TransactionFormType,
} from '@/components/money/TransactionFormsModal';
import type { DailyReport } from '@/types/api';

export default function MoneyManagementPage() {
  const { business, hasPermission } = useAuth();
  const currency = business?.currency || 'INR';
  const todayStr = new Date().toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [receivables, setReceivables] = useState(0);
  const [payables, setPayables] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<TransactionFormType>('SALE');

  const loadData = useCallback(async () => {
    if (!hasPermission('VIEW_REPORTS')) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [d, r, p] = await Promise.all([
        apiRequest<DailyReport>(`/api/reports/daily?date=${encodeURIComponent(selectedDate)}`),
        apiRequest<{ totalReceivables: number }>('/api/reports/receivables'),
        apiRequest<{ totalPayables: number }>('/api/reports/payables'),
      ]);
      setDaily(d);
      setReceivables(r.totalReceivables || 0);
      setPayables(p.totalPayables || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load money management data');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, hasPermission]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openModal = (type: TransactionFormType) => {
    setModalType(type);
    setModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Money Management</h2>
          <p className="text-xs text-slate-500">
            Track sales, collections, expenses, purchases, receivables, and payables.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
            <Calendar className="h-4 w-4 text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs font-medium text-slate-700 focus:outline-none"
            />
          </div>

          <PermissionGate permission="RECORD_TRANSACTIONS">
            <button
              onClick={() => openModal('SALE')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" /> Record Sale
            </button>
            <button
              onClick={() => openModal('EXPENSE')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
            >
              <Plus className="h-3.5 w-3.5" /> Record Expense
            </button>
            <button
              onClick={() => openModal('PURCHASE')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" /> Record Purchase
            </button>
          </PermissionGate>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      {/* Daily Financial Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Recorded Sales"
          value={loading ? '...' : formatCurrency(daily?.totalRecordedSales || 0, currency)}
          subtitle="Includes cash, UPI & credit sales"
          icon={TrendingUp}
          tone="emerald"
        />
        <StatCard
          title="Operating Expenses"
          value={loading ? '...' : formatCurrency(daily?.totalExpenses || 0, currency)}
          subtitle="Excludes supplier credit settlements"
          icon={TrendingDown}
          tone="rose"
        />
        <StatCard
          title="Supplier Purchases"
          value={loading ? '...' : formatCurrency(daily?.totalCreditPurchases || 0, currency)}
          subtitle={`Settled today: ${formatCurrency(daily?.totalSupplierPayments || 0, currency)}`}
          icon={ShoppingBag}
          tone="amber"
        />
        <StatCard
          title="Recorded Operating Surplus"
          value={loading ? '...' : formatCurrency(daily?.recordedOperatingSurplus || 0, currency)}
          subtitle="Sales minus recorded expenses (not net profit)"
          icon={Wallet}
          tone="indigo"
        />
      </div>

      {/* Collections vs Outstanding Balances */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Cash Collections"
          value={loading ? '...' : formatCurrency(daily?.cashCollections || 0, currency)}
          subtitle="Cash received on selected date"
          icon={Banknote}
          tone="emerald"
        />
        <StatCard
          title="UPI Collections"
          value={loading ? '...' : formatCurrency(daily?.upiCollections || 0, currency)}
          subtitle="UPI received on selected date"
          icon={Smartphone}
          tone="indigo"
        />
        <StatCard
          title="Customer Receivables"
          value={loading ? '...' : formatCurrency(receivables, currency)}
          subtitle={`Collected today: ${formatCurrency(daily?.totalCustomerPaymentsReceived || 0, currency)}`}
          icon={ArrowDownLeft}
          tone="emerald"
        />
        <StatCard
          title="Supplier Payables"
          value={loading ? '...' : formatCurrency(payables, currency)}
          subtitle="Total unpaid supplier balances"
          icon={ArrowUpRight}
          tone="rose"
        />
      </div>

      {/* Accounting Clarity Banner + Link to Transactions */}
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
        <div className="text-xs text-slate-600">
          <p className="font-semibold text-slate-900">Accounting Integrity Notes</p>
          <p className="mt-1">
            Credit sales increase Customer Receivables rather than Cash/UPI collections. Supplier
            payments settle Supplier Payables without creating duplicate operating expenses.
          </p>
        </div>
        <Link
          href="/transactions"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          View All Transactions <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <TransactionFormsModal
        open={modalOpen}
        initialType={modalType}
        onClose={() => setModalOpen(false)}
        onSuccess={(msg) => {
          setSuccessMsg(msg);
          loadData();
        }}
      />
    </div>
  );
}

