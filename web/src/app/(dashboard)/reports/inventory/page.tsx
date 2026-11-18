'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Package,
  AlertTriangle,
  XCircle,
  Boxes,
  Download,
  TrendingUp,
  TrendingDown,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, ApiError } from '@/lib/api-client';
import { formatCurrency, formatLabel } from '@/lib/formatters';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { StatCard } from '@/components/ui/StatCard';
import { PermissionGate } from '@/components/layout/PermissionGate';
import type { InventoryReport } from '@/types/api';

type StockValuationRow = InventoryReport['currentStock'][number];

export default function InventoryReportsPage() {
  const { business, businessConfig } = useAuth();
  const currency = business?.currency || 'INR';

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [category, setCategory] = useState('ALL');
  const [report, setReport] = useState<InventoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (category && category !== 'ALL') params.set('category', category);
      const qs = params.toString();
      const data = await apiRequest<InventoryReport>(
        `/api/reports/inventory${qs ? `?${qs}` : ''}`,
      );
      setReport(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load inventory report');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, category]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const categories = Array.from(
    new Set([
      ...(businessConfig?.productCategories || []),
      ...Object.keys(report?.valuation.byCategory || {}),
    ]),
  );

  const byType = report?.movementSummaryByType || {};
  const stockInQty = (byType.STOCK_IN?.totalQuantity || 0) + (byType.PURCHASE?.totalQuantity || 0);
  const stockInVal = (byType.STOCK_IN?.totalValue || 0) + (byType.PURCHASE?.totalValue || 0);
  const stockOutQty =
    (byType.STOCK_OUT?.totalQuantity || 0) + (byType.SALE_DEDUCTION?.totalQuantity || 0);
  const stockOutVal =
    (byType.STOCK_OUT?.totalValue || 0) + (byType.SALE_DEDUCTION?.totalValue || 0);
  const wastageQty = (byType.WASTAGE?.totalQuantity || 0) + (byType.DAMAGED?.totalQuantity || 0);
  const wastageVal = (byType.WASTAGE?.totalValue || 0) + (byType.DAMAGED?.totalValue || 0);

  const handleExportCsv = () => {
    if (!report) return;
    const rows = [
      ['Product', 'Category', 'Unit', 'Current Stock', 'Min Stock', 'Cost Price', 'Stock Value'],
      ...report.currentStock.map((p) => [
        p.name,
        p.category,
        p.unit,
        String(p.currentStock),
        String(p.minStockLevel),
        String(p.costPrice),
        String(p.stockValue),
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventory-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const maxCatVal = Math.max(
    1,
    ...Object.values(report?.valuation.byCategory || {}).map((c) => c.value),
  );

  return (
    <PermissionGate
      permission="VIEW_INVENTORY"
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          You do not have permission to view inventory reports.
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Inventory Reports</h1>
            <p className="text-sm text-slate-500">
              Product-wise stock valuation, low-stock alerts, stock-in/out analysis, and wastage summary.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loading || !report}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export Valuation CSV
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-slate-600">Category:</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-slate-600">Movements:</label>
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
            {(startDate || endDate || category !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setCategory('ALL');
                }}
                className="text-xs font-medium text-emerald-700 hover:underline"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Inventory Valuation"
            value={formatCurrency(report?.valuation.totalValue || 0, currency)}
            subtitle={`${report?.valuation.totalUnits || 0} total units`}
            icon={Boxes}
            tone="emerald"
          />
          <StatCard
            title="Active Products"
            value={String(report?.valuation.productCount || 0)}
            subtitle="Tracked catalog items"
            icon={Package}
          />
          <StatCard
            title="Low-Stock Products"
            value={String(report?.lowStockCount || 0)}
            subtitle="At or below minimum level"
            icon={AlertTriangle}
            tone={(report?.lowStockCount || 0) > 0 ? 'amber' : 'emerald'}
          />
          <StatCard
            title="Out-of-Stock Products"
            value={String(report?.valuation.outOfStockCount || 0)}
            subtitle="Zero or negative stock"
            icon={XCircle}
            tone={(report?.valuation.outOfStockCount || 0) > 0 ? 'rose' : 'emerald'}
          />
        </div>

        {/* Stock-In / Stock-Out / Wastage Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-emerald-700">
              <TrendingUp className="h-4 w-4" /> Stock-In &amp; Purchases
            </div>
            <p className="mt-2 text-xl font-bold text-slate-900">
              {stockInQty} units
            </p>
            <p className="text-xs text-slate-500">
              Value: {formatCurrency(stockInVal, currency)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-indigo-700">
              <TrendingDown className="h-4 w-4" /> Stock-Out &amp; Sales
            </div>
            <p className="mt-2 text-xl font-bold text-slate-900">
              {stockOutQty} units
            </p>
            <p className="text-xs text-slate-500">
              Value: {formatCurrency(stockOutVal, currency)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-rose-700">
              <Trash2 className="h-4 w-4" /> Wastage &amp; Damaged
            </div>
            <p className="mt-2 text-xl font-bold text-slate-900">
              {wastageQty} units
            </p>
            <p className="text-xs text-slate-500">
              Loss Value: {formatCurrency(wastageVal, currency)}
            </p>
          </div>
        </div>

        {/* Movement Summary by Type & Category Valuation */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">
              Stock Movement Summary ({report?.totalMovements || 0} movements)
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Breakdown by movement type across the selected date range.
            </p>
            {Object.keys(byType).length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                No stock movements recorded in this period.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 text-sm">
                {Object.entries(byType).map(([type, stats]) => (
                  <div key={type} className="flex items-center justify-between py-2.5">
                    <div>
                      <Badge variant={type === 'WASTAGE' || type === 'DAMAGED' ? 'danger' : 'info'}>
                        {formatLabel(type)}
                      </Badge>
                      <span className="ml-2 text-xs text-slate-500">{stats.count} entries</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-slate-900">{stats.totalQuantity} units</span>
                      <span className="ml-2 text-xs text-slate-500">
                        ({formatCurrency(stats.totalValue, currency)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">
              Valuation by Category
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Current stock value grouped by product category.
            </p>
            {Object.keys(report?.valuation.byCategory || {}).length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No active products.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(report?.valuation.byCategory || {})
                  .sort(([, a], [, b]) => b.value - a.value)
                  .map(([cat, info]) => (
                    <div key={cat}>
                      <div className="mb-1 flex justify-between text-xs font-medium text-slate-700">
                        <span>
                          {cat} ({info.count} items)
                        </span>
                        <span>{formatCurrency(info.value, currency)}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-emerald-600"
                          style={{
                            width: `${Math.min(100, Math.round((info.value / maxCatVal) * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Product-wise Valuation Table */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">
            Product-Wise Inventory Valuation
          </h2>
          <DataTable<StockValuationRow>
            loading={loading}
            data={report?.currentStock || []}
            keyExtractor={(p) => p.productId}
            emptyMessage="No active products found for the selected filter."
            columns={[
              {
                key: 'name',
                header: 'Product',
                render: (p) => (
                  <div>
                    <p className="font-medium text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">{p.category}</p>
                  </div>
                ),
              },
              {
                key: 'stock',
                header: 'Current Stock',
                className: 'text-right',
                render: (p) => (
                  <span className="font-medium">
                    {p.currentStock} {p.unit}
                  </span>
                ),
              },
              {
                key: 'min',
                header: 'Min Level',
                className: 'text-right',
                render: (p) => `${p.minStockLevel} ${p.unit}`,
              },
              {
                key: 'cost',
                header: 'Cost Price',
                className: 'text-right',
                render: (p) => formatCurrency(p.costPrice, currency),
              },
              {
                key: 'value',
                header: 'Stock Value',
                className: 'text-right',
                render: (p) => (
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(p.stockValue, currency)}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (p) =>
                  p.currentStock <= 0 ? (
                    <Badge variant="danger">Out of Stock</Badge>
                  ) : p.currentStock <= p.minStockLevel ? (
                    <Badge variant="warning">Low Stock</Badge>
                  ) : (
                    <Badge variant="success">Healthy</Badge>
                  ),
              },
            ]}
          />
        </div>
      </div>
    </PermissionGate>
  );
}
