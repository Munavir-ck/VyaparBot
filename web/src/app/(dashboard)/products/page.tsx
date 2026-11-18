'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Search,
  Plus,
  Eye,
  Pencil,
  Archive,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, apiRequestWithMeta } from '@/lib/api-client';
import { formatCurrency, formatLabel } from '@/lib/formatters';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PermissionGate } from '@/components/layout/PermissionGate';
import type { ProductItem } from '@/types/api';

const SUPPORTED_UNITS = ['kg', 'g', 'litre', 'ml', 'pcs', 'pack', 'box'];

export default function ProductsPage() {
  const { business, businessConfig, hasPermission } = useAuth();
  const currency = business?.currency || 'INR';

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 15;

  const [rows, setRows] = useState<ProductItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Add / Edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<ProductItem | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [unit, setUnit] = useState('pcs');
  const [initialStock, setInitialStock] = useState('0');
  const [minStockLevel, setMinStockLevel] = useState('0');
  const [costPrice, setCostPrice] = useState('0');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [saving, setSaving] = useState(false);

  // Details & Archive
  const [detailProd, setDetailProd] = useState<ProductItem | null>(null);
  const [archiveProd, setArchiveProd] = useState<ProductItem | null>(null);
  const [archiving, setArchiving] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (search.trim()) params.set('search', search.trim());
      if (categoryFilter) params.set('category', categoryFilter);

      const res = await apiRequestWithMeta<ProductItem>(`/api/inventory/products?${params.toString()}`);
      setRows(res.data);
      setTotal(res.total);
      setTotalPages(Math.max(1, res.totalPages));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [page, search, categoryFilter]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const categories = businessConfig?.productCategories || [
    'RAW_INGREDIENTS',
    'BEVERAGES',
    'PACKAGING',
    'GOODS',
    'OTHER',
  ];

  const openCreate = () => {
    setEditingProd(null);
    setName('');
    setCategory(categories[0] || 'OTHER');
    setUnit(businessConfig?.defaultUnits?.[0] || 'pcs');
    setInitialStock('0');
    setMinStockLevel('0');
    setCostPrice('0');
    setSellingPrice('0');
    setFormOpen(true);
  };

  const openEdit = (prod: ProductItem) => {
    setEditingProd(prod);
    setName(prod.name);
    setCategory(prod.category);
    setUnit(prod.unit);
    setMinStockLevel(String(prod.minStockLevel));
    setCostPrice(String(prod.costPrice));
    setSellingPrice(String(prod.sellingPrice));
    setFormOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingProd) {
        await apiRequest(`/api/inventory/products/${editingProd._id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: name.trim(),
            category,
            unit,
            minStockLevel: Number(minStockLevel || 0),
            costPrice: Number(costPrice || 0),
            sellingPrice: Number(sellingPrice || 0),
          }),
        });
        setSuccessMsg('Product updated successfully.');
      } else {
        await apiRequest('/api/inventory/products', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            category,
            unit,
            initialStock: Number(initialStock || 0),
            minStockLevel: Number(minStockLevel || 0),
            costPrice: Number(costPrice || 0),
            sellingPrice: Number(sellingPrice || 0),
          }),
        });
        setSuccessMsg('Product added successfully.');
      }
      setFormOpen(false);
      loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!archiveProd) return;
    setArchiving(true);
    setError(null);
    try {
      await apiRequest(`/api/inventory/products/${archiveProd._id}`, {
        method: 'DELETE',
      });
      setArchiveProd(null);
      setSuccessMsg('Product archived.');
      loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive product');
    } finally {
      setArchiving(false);
    }
  };

  const columns: Column<ProductItem>[] = [
    { key: 'name', header: 'Product Name', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: 'category', header: 'Category', render: (r) => formatLabel(r.category) },
    {
      key: 'stock',
      header: 'Current Stock',
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold">
            {r.currentStock} {r.unit}
          </span>
          {r.currentStock <= 0 ? (
            <Badge variant="danger">Out of Stock</Badge>
          ) : r.currentStock <= r.minStockLevel ? (
            <Badge variant="warning">Low</Badge>
          ) : null}
        </div>
      ),
    },
    { key: 'min', header: 'Min Level', render: (r) => `${r.minStockLevel} ${r.unit}` },
    { key: 'cost', header: 'Purchase Price', render: (r) => formatCurrency(r.costPrice, currency) },
    { key: 'sell', header: 'Selling Price', render: (r) => formatCurrency(r.sellingPrice, currency) },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => setDetailProd(r)}
            title="View Product"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <Eye className="h-4 w-4" />
          </button>
          {hasPermission('MANAGE_INVENTORY') && (
            <>
              <button
                onClick={() => openEdit(r)}
                title="Edit Product"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => setArchiveProd(r)}
                title="Archive Product"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
              >
                <Archive className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Products</h2>
          <p className="text-xs text-slate-500">
            Manage product catalog, units, minimum stock thresholds, and pricing.
          </p>
        </div>

        <PermissionGate permission="MANAGE_INVENTORY">
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" /> Add Product
          </button>
        </PermissionGate>
      </div>

      {/* Search & Category Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by product name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {formatLabel(c)}
            </option>
          ))}
        </select>
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
        emptyMessage="No active products found."
      />

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>
          Showing {rows.length} of {total} products (Page {page} of {totalPages})
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

      {/* Add / Edit Product Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingProd ? 'Edit Product' : 'Add Product'}
              </h3>
              <button
                onClick={() => setFormOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveProduct} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Product Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Matta Rice"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {formatLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Unit</label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {SUPPORTED_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {!editingProd && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Initial Stock</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={initialStock}
                      onChange={(e) => setInitialStock(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                )}
                <div className={editingProd ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium text-slate-700">
                    Minimum Stock Level
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={minStockLevel}
                    onChange={(e) => setMinStockLevel(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Purchase Price ({currency})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Selling Price ({currency})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {editingProd && (
                <p className="text-[11px] text-slate-500">
                  Note: Current stock ({editingProd.currentStock} {editingProd.unit}) can only be
                  changed via stock movements or adjustments to preserve ledger integrity.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {editingProd ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Product Details Modal */}
      {detailProd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">{detailProd.name}</h3>
              <button
                onClick={() => setDetailProd(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-slate-500">Category</dt>
                <dd className="font-medium text-slate-800">{formatLabel(detailProd.category)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Unit</dt>
                <dd className="font-medium text-slate-800">{detailProd.unit}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Current Stock</dt>
                <dd className="font-semibold text-slate-900">
                  {detailProd.currentStock} {detailProd.unit}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Minimum Stock</dt>
                <dd className="font-medium text-slate-800">
                  {detailProd.minStockLevel} {detailProd.unit}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Purchase Price</dt>
                <dd className="font-medium text-slate-800">
                  {formatCurrency(detailProd.costPrice, currency)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Selling Price</dt>
                <dd className="font-medium text-slate-800">
                  {formatCurrency(detailProd.sellingPrice, currency)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Stock Value</dt>
                <dd className="font-semibold text-emerald-700">
                  {formatCurrency(Math.max(0, detailProd.currentStock) * (detailProd.costPrice || 0), currency)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {/* Archive Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(archiveProd)}
        title="Archive Product"
        description={`Are you sure you want to archive "${archiveProd?.name}"? Archived products will no longer appear for new transactions.`}
        confirmLabel="Archive Product"
        loading={archiving}
        onConfirm={handleArchive}
        onCancel={() => setArchiveProd(null)}
      />
    </div>
  );
}

