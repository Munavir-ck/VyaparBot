'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Download,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ShoppingBag,
  Info,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, ApiError } from '@/lib/api-client';
import { formatCurrency, formatLabel } from '@/lib/formatters';
import { StatCard } from '@/components/ui/StatCard';
import { PermissionGate } from '@/components/layout/PermissionGate';
import type {
  DailyReport,
  WeeklyReport,
  MonthlyReport,
  RangeFinancialReport,
  CashFlowReport,
  ReceivablesReport,
  PayablesReport,
} from '@/types/api';

type ReportPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

function getMonthRange(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

export default function FinancialReportsPage() {
  const { business } = useAuth();
  const currency = business?.currency || 'INR';

  const today = new Date().toISOString().slice(0, 10);
  const [period, setPeriod] = useState<ReportPeriod>('DAILY');
  const [refDate, setRefDate] = useState(today);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const [monthly, setMonthly] = useState<MonthlyReport | null>(null);
  const [customRange, setCustomRange] = useState<RangeFinancialReport | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowReport | null>(null);
  const [receivables, setReceivables] = useState<ReceivablesReport | null>(null);
  const [payables, setPayables] = useState<PayablesReport | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let cfStart = refDate;
      let cfEnd = refDate;

      let summaryPromise: Promise<unknown>;
      if (period === 'DAILY') {
        summaryPromise = apiRequest<DailyReport>(`/api/reports/daily?date=${refDate}`).then((d) => {
          setDaily(d);
          setWeekly(null);
          setMonthly(null);
          setCustomRange(null);
        });
      } else if (period === 'WEEKLY') {
        summaryPromise = apiRequest<WeeklyReport>(`/api/reports/weekly?date=${refDate}`).then(
          (w) => {
            setWeekly(w);
            setDaily(null);
            setMonthly(null);
            setCustomRange(null);
            cfStart = w.startDate;
            cfEnd = w.endDate;
          },
        );
      } else if (period === 'MONTHLY') {
        const range = getMonthRange(year, month);
        cfStart = range.start;
        cfEnd = range.end;
        summaryPromise = apiRequest<MonthlyReport>(
          `/api/reports/monthly?year=${year}&month=${month}`,
        ).then((m) => {
          setMonthly(m);
          setDaily(null);
          setWeekly(null);
          setCustomRange(null);
        });
      } else {
        cfStart = startDate;
        cfEnd = endDate;
        summaryPromise = apiRequest<RangeFinancialReport>(
          `/api/reports/summary?startDate=${startDate}&endDate=${endDate}`,
        ).then((r) => {
          setCustomRange(r);
          setDaily(null);
          setWeekly(null);
          setMonthly(null);
        });
      }

      await summaryPromise;

      const [cf, rec, pay] = await Promise.all([
        apiRequest<CashFlowReport>(`/api/reports/cash-flow?startDate=${cfStart}&endDate=${cfEnd}`),
        apiRequest<ReceivablesReport>('/api/reports/receivables'),
        apiRequest<PayablesReport>('/api/reports/payables'),
      ]);

      setCashFlow(cf);
      setReceivables(rec);
      setPayables(pay);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load financial reports');
    } finally {
      setLoading(false);
    }
  }, [period, refDate, year, month, startDate, endDate]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  // Read exact backend figures without re-computing financial logic
  const salesTotal =
    period === 'DAILY'
      ? daily?.totalRecordedSales ?? 0
      : period === 'WEEKLY'
        ? weekly?.totalSales ?? 0
        : period === 'MONTHLY'
          ? monthly?.monthlySales ?? 0
          : customRange?.totalSales ?? 0;

  const cashCollected =
    period === 'DAILY'
      ? daily?.cashCollections ?? 0
      : period === 'WEEKLY'
        ? weekly?.cashSales ?? 0
        : period === 'MONTHLY'
          ? monthly?.cashSales ?? 0
          : customRange?.cashSales ?? 0;

  const upiCollected =
    period === 'DAILY'
      ? daily?.upiCollections ?? 0
      : period === 'WEEKLY'
        ? weekly?.upiSales ?? 0
        : period === 'MONTHLY'
          ? monthly?.upiSales ?? 0
          : customRange?.upiSales ?? 0;

  const expensesTotal =
    period === 'DAILY'
      ? daily?.totalExpenses ?? 0
      : period === 'WEEKLY'
        ? weekly?.totalExpenses ?? 0
        : period === 'MONTHLY'
          ? monthly?.monthlyExpenses ?? 0
          : customRange?.totalExpenses ?? 0;

  const operatingSurplus =
    period === 'DAILY'
      ? daily?.recordedOperatingSurplus ?? 0
      : period === 'WEEKLY'
        ? weekly?.recordedOperatingSurplus ?? 0
        : period === 'MONTHLY'
          ? monthly?.recordedOperatingSurplus ?? 0
          : customRange?.recordedOperatingSurplus ?? 0;

  const purchasesTotal =
    period === 'DAILY'
      ? daily?.totalCreditPurchases ?? 0
      : period === 'WEEKLY'
        ? weekly?.supplierPurchases ?? 0
        : period === 'MONTHLY'
          ? monthly?.supplierPurchases ?? 0
          : customRange?.supplierPurchases ?? 0;

  const supplierPaymentsTotal =
    period === 'DAILY'
      ? daily?.totalSupplierPayments ?? 0
      : period === 'WEEKLY'
        ? weekly?.paymentsMade ?? 0
        : period === 'MONTHLY'
          ? monthly?.supplierPayments ?? 0
          : customRange?.paymentsMade ?? 0;

  const customerPaymentsReceived =
    period === 'DAILY'
      ? daily?.totalCustomerPaymentsReceived ?? 0
      : period === 'WEEKLY'
        ? weekly?.paymentsReceived ?? 0
        : period === 'MONTHLY'
          ? monthly?.customerPaymentsReceived ?? 0
          : customRange?.paymentsReceived ?? 0;

  const categoryExpenses: Record<string, number> =
    (period === 'DAILY'
      ? daily?.categoryExpenses
      : period === 'WEEKLY'
        ? weekly?.categoryExpenses
        : period === 'MONTHLY'
          ? monthly?.categoryExpenses
          : customRange?.categoryExpenses) || {};

  const txCount =
    period === 'DAILY'
      ? daily?.transactionCount ?? 0
      : period === 'WEEKLY'
        ? weekly?.transactionCount ?? 0
        : period === 'MONTHLY'
          ? monthly?.transactionCount ?? 0
          : customRange?.transactionCount ?? 0;

  const maxExpense = Math.max(1, ...Object.values(categoryExpenses));
  const maxChannel = Math.max(1, cashCollected, upiCollected, salesTotal);

  const handleExportCsv = () => {
    const rows = [
      ['Metric', 'Amount'],
      ['Period', period],
      ['Cash Flow Start Date', cashFlow?.startDate || ''],
      ['Cash Flow End Date', cashFlow?.endDate || ''],
      ['Total Recorded Sales', String(salesTotal)],
      ['Cash Collections (Sales)', String(cashCollected)],
      ['UPI Collections (Sales)', String(upiCollected)],
      ['Customer Payments Received', String(customerPaymentsReceived)],
      ['Total Operating Expenses', String(expensesTotal)],
      ['Recorded Operating Surplus', String(operatingSurplus)],
      ['Supplier Purchases', String(purchasesTotal)],
      ['Supplier Payments Made', String(supplierPaymentsTotal)],
      ['Total Receivables', String(receivables?.totalReceivables ?? 0)],
      ['Total Payables', String(payables?.totalPayables ?? 0)],
      ['Cash Closing Balance', String(cashFlow?.cash.closingBalance ?? 0)],
      ['Bank & UPI Closing Balance', String(cashFlow?.bankAndUpi.closingBalance ?? 0)],
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `financial-report-${period.toLowerCase()}-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PermissionGate
      permission="VIEW_REPORTS"
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          You do not have permission to view financial reports.
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Financial Reports</h1>
            <p className="text-sm text-slate-500">
              Sales, cash/UPI collections, expenses, operating surplus, cash flow, receivables, and payables.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        {/* Period & Date Filters */}
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'] as ReportPeriod[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  period === p
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {formatLabel(p)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(period === 'DAILY' || period === 'WEEKLY') && (
              <input
                type="date"
                value={refDate}
                onChange={(e) => setRefDate(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
              />
            )}
            {period === 'MONTHLY' && (
              <>
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                >
                  {Array.from({ length: 12 }, (_, idx) => (
                    <option key={idx + 1} value={idx + 1}>
                      {new Date(2025, idx, 1).toLocaleString('en-US', { month: 'long' })}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={2020}
                  max={2100}
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
                  className="w-24 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </>
            )}
            {period === 'CUSTOM' && (
              <>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <span>
            <strong>Accounting Distinction:</strong> Recorded Sales represent revenue (including credit sales), while Cash/UPI Collections reflect immediate receipts. Supplier Purchases are tracked separately from Supplier Payments. <strong>Recorded Operating Surplus</strong> is recorded sales minus operating expenses, not final net profit.
          </span>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                title="Recorded Sales"
                value={formatCurrency(salesTotal, currency)}
                subtitle={`Cash: ${formatCurrency(cashCollected, currency)} • UPI: ${formatCurrency(upiCollected, currency)}`}
                icon={TrendingUp}
                tone="emerald"
              />
              <StatCard
                title="Operating Expenses"
                value={formatCurrency(expensesTotal, currency)}
                subtitle={`${txCount} completed transactions in period`}
                icon={TrendingDown}
                tone="rose"
              />
              <StatCard
                title="Recorded Operating Surplus"
                value={formatCurrency(operatingSurplus, currency)}
                subtitle="Recorded sales minus expenses (not net profit)"
                icon={BarChart3}
                tone={operatingSurplus >= 0 ? 'emerald' : 'rose'}
              />
              <StatCard
                title={period === 'DAILY' ? 'Credit Purchases' : 'Supplier Purchases'}
                value={formatCurrency(purchasesTotal, currency)}
                subtitle={`Supplier Payments Made: ${formatCurrency(supplierPaymentsTotal, currency)}`}
                icon={ShoppingBag}
              />
              <StatCard
                title="Customer Receivables"
                value={formatCurrency(receivables?.totalReceivables ?? 0, currency)}
                subtitle={`Payments received in period: ${formatCurrency(customerPaymentsReceived, currency)}`}
                icon={ArrowDownLeft}
                tone="amber"
              />
              <StatCard
                title="Supplier Payables"
                value={formatCurrency(payables?.totalPayables ?? 0, currency)}
                subtitle={`${payables?.supplierCount ?? 0} active suppliers`}
                icon={ArrowUpRight}
                tone="rose"
              />
            </div>

            {/* Cash Flow Summary */}
            {cashFlow && (
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-emerald-600" />
                    <h2 className="text-base font-semibold text-slate-900">
                      Cash Flow Summary ({cashFlow.startDate} to {cashFlow.endDate})
                    </h2>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">
                    Total Closing Balance: {formatCurrency(cashFlow.totalClosingBalance, currency)}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5">Channel</th>
                        <th className="px-4 py-2.5 text-right">Opening</th>
                        <th className="px-4 py-2.5 text-right">Inflows</th>
                        <th className="px-4 py-2.5 text-right">Outflows</th>
                        <th className="px-4 py-2.5 text-right">Net Flow</th>
                        <th className="px-4 py-2.5 text-right">Closing</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="px-4 py-3 font-medium text-slate-900">Cash</td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(cashFlow.cash.openingBalance, currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-700">
                          +{formatCurrency(cashFlow.cash.inflows, currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-rose-700">
                          -{formatCurrency(cashFlow.cash.outflows, currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(cashFlow.cash.netFlow, currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {formatCurrency(cashFlow.cash.closingBalance, currency)}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-medium text-slate-900">Bank &amp; UPI</td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(cashFlow.bankAndUpi.openingBalance, currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-700">
                          +{formatCurrency(cashFlow.bankAndUpi.inflows, currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-rose-700">
                          -{formatCurrency(cashFlow.bankAndUpi.outflows, currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(cashFlow.bankAndUpi.netFlow, currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {formatCurrency(cashFlow.bankAndUpi.closingBalance, currency)}
                        </td>
                      </tr>
                      <tr className="bg-slate-50 font-semibold">
                        <td className="px-4 py-3 text-slate-900">Total</td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(cashFlow.totalOpeningBalance, currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-700">
                          +{formatCurrency(cashFlow.totalInflows, currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-rose-700">
                          -{formatCurrency(cashFlow.totalOutflows, currency)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(cashFlow.totalInflows - cashFlow.totalOutflows, currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-900">
                          {formatCurrency(cashFlow.totalClosingBalance, currency)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Charts: Collections Breakdown & Expense Categories */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-base font-semibold text-slate-900">
                  Sales vs Collections Breakdown
                </h2>
                <p className="mb-4 text-xs text-slate-500">
                  Comparison of total recorded sales against immediate Cash and UPI receipts.
                </p>
                <div className="space-y-4">
                  {[
                    { label: 'Total Recorded Sales', value: salesTotal, color: 'bg-slate-800' },
                    { label: 'Cash Collections', value: cashCollected, color: 'bg-emerald-600' },
                    { label: 'UPI Collections', value: upiCollected, color: 'bg-indigo-600' },
                    {
                      label: 'Customer Credit Settlements',
                      value: customerPaymentsReceived,
                      color: 'bg-amber-500',
                    },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="mb-1 flex justify-between text-xs font-medium text-slate-700">
                        <span>{item.label}</span>
                        <span>{formatCurrency(item.value, currency)}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${item.color}`}
                          style={{
                            width: `${Math.min(100, Math.round((item.value / maxChannel) * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-base font-semibold text-slate-900">
                  Expense Category Breakdown
                </h2>
                <p className="mb-4 text-xs text-slate-500">
                  Operating expenses by category (supplier settlements excluded).
                </p>
                {Object.keys(categoryExpenses).length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    No operating expenses recorded in this period.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(categoryExpenses)
                      .sort(([, a], [, b]) => b - a)
                      .map(([cat, amt]) => (
                        <div key={cat}>
                          <div className="mb-1 flex justify-between text-xs font-medium text-slate-700">
                            <span>{formatLabel(cat)}</span>
                            <span>{formatCurrency(amt, currency)}</span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-rose-500"
                              style={{
                                width: `${Math.min(100, Math.round((amt / maxExpense) * 100))}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </PermissionGate>
  );
}
