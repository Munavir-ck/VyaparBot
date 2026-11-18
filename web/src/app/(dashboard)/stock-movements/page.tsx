'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequestWithMeta } from '@/lib/api-client';
import { formatDate, formatLabel } from '@/lib/formatters';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { StockOperationModal } from '@/components/inventory/StockOperationModal';
import type { ProductItem, StockMovementItem } from '@/types/api';

const MOVEMENT_TYPES = [
  '',
  'STOCK_IN',
  'STOCK_OUT',
  'PURCHASE',
  'SALE_DEDUCTION',
  'ADJUSTMENT',
  'WASTAGE',
  'DAMAGED',
  'RETURN',
];

export default function StockMovementsPage() {
  const { business, hasPermission } = useAuth();
  const timezone = business?.timezone || 'Asia/Kolkata';

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [productId, setProductId] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const [rows, setRows] = useState<StockMovementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [opOpen, setOpOpen] = useState(false);

  const loadProducts = useCallback(async () => {
    try {
      const res = await apiRequestWithMeta<ProductItem>('/api/inventory/products?limit=200');
      setProducts(res.data);
    } catch {}
  }, []);

  const loadMovements = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (productId) params.set('productId', productId);
      if (typeFilter) params.set('type', typeFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await apiRequestWithMeta<StockMovementItem>(
        `/api/inventory/movements?${params.toString()}`,
      );
      setRows(res.data);
      setTotal(res.total);
      setTotalPages(Math.max(1, res.totalPages));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stock movements');
    } finally {
      setLoading(false);
    }
  }, [page, productId, typeFilter, startDate, endDate]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    loadMovements();
  }, [loadMovements]);

  const canRecordMovement = hasPermission('MANAGE_INVENTORY') || hasPermission('ADJUST_STOCK');

  const columns: Column<StockMovementItem>[] = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.createdAt, timezone) },
    {
      key: 'product',
      header: 'Product',
      render: (r) => (
        <span className="font-medium text-slate-900">
          {typeof r.productId === 'object' ? r.productId.name : r.productId}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Movement Type',
      render: (r) => (
        <Badge variant={r.quantityChange >= 0 ? 'success' : 'danger'}>{formatLabel(r.type)}</Badge>
      ),
    },
    {
      key: 'qty',
      header: 'Quantity',
      render: (r) => {
        const unit = typeof r.productId === 'object' ? r.productId.unit : '';
        return (
          <span className={r.quantityChange >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
            {r.quantityChange > 0 ? '+' : ''}
            {r.quantityChange} {unit}
          </span>
        );
      },
    },
    {
      key: 'prev',
      header: 'Previous',
      render: (r) => {
        const unit = typeof r.productId === 'object' ? r.productId.unit : '';
        return `${r.previousStock} ${unit}`;
      },
    },
    {
      key: 'next',
      header: 'Resulting',
      render: (r) => {
        const unit = typeof r.productId === 'object' ? r.productId.unit : '';
        return <span className="font-semibold">{r.newStock} {unit}</span>;
      },
    },
    {
      key: 'reason',
      header: 'Reason / Reference',
      render: (r) => (
        <div>
          <p className="max-w-xs truncate text-xs text-slate-700">{r.reason || '-'}</p>
          {r.relatedTransactionId && (
            <p className="text-[11px] text-slate-400">Tx: {r.relatedTransactionId}</p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Stock Movements</h2>
          <p className="text-xs text-slate-500">
            Immutable inventory ledger tracking every stock-in, sale deduction, wastage, and adjustment.
          </p>
        </div>

        {canRecordMovement && (
          <button
            onClick={() => setOpOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" /> Record Movement
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <select
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
        >
          <option value="">All Products</option>
          {products.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
        >
          <option value="">All Movement Types</option>
          {MOVEMENT_TYPES.filter(Boolean).map((t) => (
            <option key={t} value={t}>
              {formatLabel(t)}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            setPage(1);
          }}
          aria-label="Start Date"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
        />

        <input
          type="date"
          value={endDate}
          onChange={(e) => {
            setEndDate(e.target.value);
            setPage(1);
          }}
          aria-label="End Date"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
        />
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

      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(r) => r._id}
        loading={loading}
        emptyMessage="No stock movements found."
      />

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>
          Showing {rows.length} of {total} movements (Page {page} of {totalPages})
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-40"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <StockOperationModal
        open={opOpen}
        products={products}
        onClose={() => setOpOpen(false)}
        onSuccess={(msg) => {
          setSuccessMsg(msg);
          loadMovements();
          loadProducts();
        }}
      />
    </div>
  );
}

