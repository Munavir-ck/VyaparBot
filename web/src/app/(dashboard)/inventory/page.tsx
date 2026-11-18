'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Package,
  Wallet,
  AlertTriangle,
  PackageX,
  Plus,
  Minus,
  Trash2,
  SlidersHorizontal,
  ArrowRight,
  Search,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, apiRequestWithMeta } from '@/lib/api-client';
import { formatCurrency, formatDate, formatLabel } from '@/lib/formatters';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { PermissionGate } from '@/components/layout/PermissionGate';
import {
  StockOperationModal,
  type StockOperationType,
} from '@/components/inventory/StockOperationModal';
import type { ProductItem, StockMovementItem } from '@/types/api';

export default function InventoryOverviewPage() {
  const { business, businessConfig, hasPermission } = useAuth();
  const currency = business?.currency || 'INR';
  const timezone = business?.timezone || 'Asia/Kolkata';

  const [valuation, setValuation] = useState<{
    productCount: number;
    totalUnits: number;
    totalValue: number;
    outOfStockCount: number;
  } | null>(null);
  const [lowStock, setLowStock] = useState<ProductItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [movements, setMovements] = useState<StockMovementItem[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalOp, setModalOp] = useState<StockOperationType>('STOCK_IN');

  const loadInventoryData = useCallback(async () => {
    if (!hasPermission('VIEW_INVENTORY')) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [val, alerts, prodRes, movRes] = await Promise.all([
        apiRequest<{ productCount: number; totalUnits: number; totalValue: number; outOfStockCount: number }>(
          '/api/inventory/valuation',
        ),
        apiRequest<ProductItem[]>('/api/inventory/alerts/low-stock'),
        apiRequestWithMeta<ProductItem>('/api/inventory/products?limit=200'),
        apiRequestWithMeta<StockMovementItem>('/api/inventory/movements?limit=10'),
      ]);
      setValuation(val);
      setLowStock(Array.isArray(alerts) ? alerts : []);
      setProducts(prodRes.data);
      setMovements(movRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory overview');
    } finally {
      setLoading(false);
    }
  }, [hasPermission]);

  useEffect(() => {
    loadInventoryData();
  }, [loadInventoryData]);

  const openOp = (op: StockOperationType) => {
    setModalOp(op);
    setModalOpen(true);
  };

  const filteredLowStock = lowStock.filter((item) => {
    const matchesSearch =
      !search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase());
    const matchesCat = !categoryFilter || item.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  const lowStockColumns: Column<ProductItem>[] = [
    { key: 'name', header: 'Product', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'category', header: 'Category', render: (r) => formatLabel(r.category) },
    {
      key: 'stock',
      header: 'Current / Min',
      render: (r) => (
        <Badge variant={r.currentStock <= 0 ? 'danger' : 'warning'}>
          {r.currentStock} / {r.minStockLevel} {r.unit}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        r.currentStock <= 0 ? (
          <Badge variant="danger">Out of Stock</Badge>
        ) : (
          <Badge variant="warning">Low Stock</Badge>
        ),
    },
  ];

  const movementColumns: Column<StockMovementItem>[] = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.createdAt, timezone) },
    {
      key: 'product',
      header: 'Product',
      render: (r) => (typeof r.productId === 'object' ? r.productId.name : r.productId),
    },
    {
      key: 'type',
      header: 'Type',
      render: (r) => (
        <Badge variant={r.quantityChange >= 0 ? 'success' : 'danger'}>{formatLabel(r.type)}</Badge>
      ),
    },
    {
      key: 'change',
      header: 'Change',
      render: (r) => {
        const unit = typeof r.productId === 'object' ? r.productId.unit : '';
        return `${r.quantityChange > 0 ? '+' : ''}${r.quantityChange} ${unit}`;
      },
    },
    {
      key: 'balance',
      header: 'Resulting Stock',
      render: (r) => {
        const unit = typeof r.productId === 'object' ? r.productId.unit : '';
        return `${r.newStock} ${unit}`;
      },
    },
  ];

  const categories = businessConfig?.productCategories || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Inventory Management</h2>
          <p className="text-xs text-slate-500">
            Track stock levels, valuation, low-stock alerts, and ledger-backed stock movements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PermissionGate permission="MANAGE_INVENTORY">
            <button
              onClick={() => openOp('STOCK_IN')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" /> Stock-In
            </button>
            <button
              onClick={() => openOp('STOCK_OUT')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Minus className="h-3.5 w-3.5" /> Stock-Out
            </button>
            <button
              onClick={() => openOp('WASTAGE')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" /> Wastage
            </button>
          </PermissionGate>
          <PermissionGate permission="ADJUST_STOCK">
            <button
              onClick={() => openOp('ADJUSTMENT')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> Adjust Stock
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Active Products"
          value={String(valuation?.productCount || 0)}
          subtitle={`${valuation?.totalUnits || 0} total units on hand`}
          icon={Package}
          tone="indigo"
        />
        <StatCard
          title="Inventory Valuation"
          value={formatCurrency(valuation?.totalValue || 0, currency)}
          subtitle="Computed from cost price × stock"
          icon={Wallet}
          tone="emerald"
        />
        <StatCard
          title="Low-Stock Products"
          value={String(lowStock.length)}
          subtitle="At or below minimum alert level"
          icon={AlertTriangle}
          tone="amber"
        />
        <StatCard
          title="Out-of-Stock Products"
          value={String(valuation?.outOfStockCount || 0)}
          subtitle="Zero remaining units"
          icon={PackageX}
          tone="rose"
        />
      </div>

      {/* Low-Stock List with Search & Category Filter */}
      <div className="space-y-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <h3 className="text-sm font-semibold text-slate-900">Low-Stock Products</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search low stock..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {formatLabel(c)}
                </option>
              ))}
            </select>
            <Link
              href="/products"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Manage Products <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
        <DataTable
          columns={lowStockColumns}
          data={filteredLowStock}
          keyExtractor={(r) => r._id}
          loading={loading}
          emptyMessage="No low-stock products."
        />
      </div>

      {/* Recent Stock Movements */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Recent Stock Movements</h3>
          <Link
            href="/stock-movements"
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
          >
            Full Ledger <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <DataTable
          columns={movementColumns}
          data={movements}
          keyExtractor={(r) => r._id}
          loading={loading}
          emptyMessage="No stock movements recorded yet."
        />
      </div>

      <StockOperationModal
        open={modalOpen}
        initialOperation={modalOp}
        products={products}
        onClose={() => setModalOpen(false)}
        onSuccess={(msg) => {
          setSuccessMsg(msg);
          loadInventoryData();
        }}
      />
    </div>
  );
}

