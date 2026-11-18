'use client';

import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Package,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api-client';
import { formatCurrency, formatDate, formatLabel } from '@/lib/formatters';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import type { DailyReport, ProductItem, TransactionItem } from '@/types/api';

export default function DashboardOverviewPage() {
  const { business, hasPermission } = useAuth();
  const currency = business?.currency || 'INR';
  const timezone = business?.timezone || 'Asia/Kolkata';

  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [receivables, setReceivables] = useState<number>(0);
  const [payables, setPayables] = useState<number>(0);
  const [valuation, setValuation] = useState<{ totalValue: number; productCount: number } | null>(null);
  const [lowStock, setLowStock] = useState<ProductItem[]>([]);
  const [recentTx, setRecentTx] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadOverview() {
      setLoading(true);
      setError(null);
      try {
        const tasks: Promise<void>[] = [];

        if (hasPermission('VIEW_REPORTS')) {
          tasks.push(
            apiRequest<DailyReport>('/api/reports/daily').then((d) => {
              if (active) setDaily(d);
            }),
            apiRequest<{ totalReceivables: number }>('/api/reports/receivables').then((r) => {
              if (active) setReceivables(r.totalReceivables || 0);
            }),
            apiRequest<{ totalPayables: number }>('/api/reports/payables').then((p) => {
              if (active) setPayables(p.totalPayables || 0);
            }),
            apiRequest<TransactionItem[]>('/api/transactions?limit=8').then((txs) => {
              if (active) setRecentTx(Array.isArray(txs) ? txs : []);
            }),
          );
        }

        if (hasPermission('VIEW_INVENTORY')) {
          tasks.push(
            apiRequest<{ totalValue: number; productCount: number }>('/api/inventory/valuation').then(
              (v) => {
                if (active) setValuation(v);
              },
            ),
            apiRequest<ProductItem[]>('/api/inventory/alerts/low-stock').then((alerts) => {
              if (active) setLowStock(Array.isArray(alerts) ? alerts : []);
            }),
          );
        }

        await Promise.all(tasks);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load dashboard overview');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadOverview();
    return () => {
      active = false;
    };
  }, [hasPermission]);

  const txColumns: Column<TransactionItem>[] = [
    {
      key: 'date',
      header: 'Date',
      render: (row) => formatDate(row.transactionDate, timezone),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => (
        <Badge
          variant={
            row.type === 'SALE' || row.type === 'CUSTOMER_PAYMENT'
              ? 'success'
              : row.type === 'EXPENSE'
                ? 'danger'
                : 'info'
          }
        >
          {formatLabel(row.type)}
        </Badge>
      ),
    },
    {
      key: 'category',
      header: 'Category / Party',
      render: (row) => row.supplierName || row.customerName || formatLabel(row.category),
    },
    {
      key: 'method',
      header: 'Payment',
      render: (row) => formatLabel(row.paymentMethod),
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'text-right font-semibold',
      render: (row) => formatCurrency(row.amount, currency),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Business Overview</h2>
        <p className="text-xs text-slate-500">
          Real-time summary powered by the same financial and inventory engine as WhatsApp.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Today's Recorded Sales"
          value={formatCurrency(daily?.totalRecordedSales || 0, currency)}
          subtitle={`Cash: ${formatCurrency(daily?.cashCollections || 0, currency)} • UPI: ${formatCurrency(daily?.upiCollections || 0, currency)}`}
          icon={TrendingUp}
          tone="emerald"
        />
        <StatCard
          title="Today's Expenses"
          value={formatCurrency(daily?.totalExpenses || 0, currency)}
          subtitle="Excludes supplier credit settlements"
          icon={TrendingDown}
          tone="rose"
        />
        <StatCard
          title="Recorded Operating Surplus"
          value={formatCurrency(daily?.recordedOperatingSurplus || 0, currency)}
          subtitle="Sales minus recorded expenses (not net profit)"
          icon={Wallet}
          tone="indigo"
        />
        <StatCard
          title="Inventory Valuation"
          value={formatCurrency(valuation?.totalValue || 0, currency)}
          subtitle={`${valuation?.productCount || 0} active tracked products`}
          icon={Package}
          tone="amber"
        />
      </div>

      {/* Receivables, Payables & Low-Stock Alerts */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          title="Customer Receivables"
          value={formatCurrency(receivables, currency)}
          subtitle="Uncollected credit sales"
          icon={ArrowDownLeft}
          tone="emerald"
        />
        <StatCard
          title="Supplier Payables"
          value={formatCurrency(payables, currency)}
          subtitle="Outstanding supplier balances"
          icon={ArrowUpRight}
          tone="rose"
        />
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Low-Stock Alerts
            </p>
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          </div>
          {lowStock.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">All tracked products are above minimum stock.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {lowStock.slice(0, 4).map((item) => (
                <li key={item._id} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-800">{item.name}</span>
                  <Badge variant="warning">
                    {item.currentStock} / {item.minStockLevel} {item.unit}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Recent Transactions</h3>
        <DataTable
          columns={txColumns}
          data={recentTx}
          keyExtractor={(row) => row._id}
          loading={loading}
          emptyMessage="No transactions recorded yet."
        />
      </div>
    </div>
  );
}

