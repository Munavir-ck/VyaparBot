'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Search,
  Plus,
  Eye,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, apiRequestWithMeta } from '@/lib/api-client';
import { formatCurrency, formatDate, formatLabel } from '@/lib/formatters';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PermissionGate } from '@/components/layout/PermissionGate';
import { TransactionFormsModal } from '@/components/money/TransactionFormsModal';
import type { TransactionItem } from '@/types/api';

const TRANSACTION_TYPES = [
  '',
  'SALE',
  'EXPENSE',
  'PURCHASE',
  'SUPPLIER_PAYMENT',
  'CUSTOMER_PAYMENT',
];

export default function TransactionsPage() {
  const { business, businessConfig, hasPermission } = useAuth();
  const currency = business?.currency || 'INR';
  const timezone = business?.timezone || 'Asia/Kolkata';

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const limit = 15;

  const [rows, setRows] = useState<TransactionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTx, setDetailTx] = useState<TransactionItem | null>(null);
  const [editTx, setEditTx] = useState<TransactionItem | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editMethod, setEditMethod] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editReason, setEditReason] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [voidTx, setVoidTx] = useState<TransactionItem | null>(null);
  const [voiding, setVoiding] = useState(false);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (search.trim()) params.set('search', search.trim());
      if (typeFilter) params.set('type', typeFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await apiRequestWithMeta<TransactionItem>(`/api/transactions?${params.toString()}`);
      setRows(res.data);
      setTotal(res.total);
      setTotalPages(Math.max(1, res.totalPages));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter, categoryFilter, startDate, endDate]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const openEditModal = (tx: TransactionItem) => {
    setEditTx(tx);
    setEditAmount(String(tx.amount));
    setEditCategory(tx.category);
    setEditMethod(tx.paymentMethod);
    setEditDescription(tx.description || '');
    setEditReason('');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTx) return;
    setSavingEdit(true);
    setError(null);
    try {
      await apiRequest(`/api/transactions/${editTx._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          amount: Number(editAmount),
          category: editCategory,
          paymentMethod: editMethod,
          description: editDescription,
          reason: editReason || 'Updated from dashboard',
        }),
      });
      setEditTx(null);
      setSuccessMsg('Transaction updated successfully.');
      loadTransactions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update transaction');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmVoid = async () => {
    if (!voidTx) return;
    setVoiding(true);
    setError(null);
    try {
      await apiRequest(`/api/transactions/${voidTx._id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Voided from dashboard' }),
      });
      setVoidTx(null);
      setSuccessMsg('Transaction voided and balances updated.');
      loadTransactions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to void transaction');
    } finally {
      setVoiding(false);
    }
  };

  const availableCategories = [
    ...(businessConfig?.expenseCategories || []),
    ...(business?.settings?.customExpenseCategories || []),
    'DAILY_SALES',
    'CREDIT_SALES',
    'SUPPLIER_PURCHASE',
    'SUPPLIER_PAYMENT',
    'CUSTOMER_PAYMENT',
  ].filter((v, i, a) => a.indexOf(v) === i);

  const columns: Column<TransactionItem>[] = [
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
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">
            {row.supplierName || row.customerName || formatLabel(row.category)}
          </p>
          {row.description && (
            <p className="max-w-xs truncate text-xs text-slate-500">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'method',
      header: 'Payment',
      render: (row) => formatLabel(row.paymentMethod),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge variant={row.status === 'COMPLETED' ? 'success' : row.status === 'VOIDED' ? 'danger' : 'warning'}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'text-right font-semibold',
      render: (row) => formatCurrency(row.amount, currency),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => setDetailTx(row)}
            title="View Details"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <Eye className="h-4 w-4" />
          </button>
          {hasPermission('EDIT_TRANSACTIONS') && row.status !== 'VOIDED' && (
            <button
              onClick={() => openEditModal(row)}
              title="Edit Transaction"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {hasPermission('VOID_TRANSACTIONS') && row.status !== 'VOIDED' && (
            <button
              onClick={() => setVoidTx(row)}
              title="Void Transaction"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Transactions</h2>
          <p className="text-xs text-slate-500">
            Search, filter, inspect audit trails, edit, or void business transactions.
          </p>
        </div>

        <PermissionGate permission="RECORD_TRANSACTIONS">
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" /> New Transaction
          </button>
        </PermissionGate>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search party, note, ref..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
        >
          <option value="">All Types</option>
          {TRANSACTION_TYPES.filter(Boolean).map((t) => (
            <option key={t} value={t}>
              {formatLabel(t)}
            </option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
        >
          <option value="">All Categories</option>
          {availableCategories.map((c) => (
            <option key={c} value={c}>
              {formatLabel(c)}
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
        emptyMessage="No matching transactions found."
      />

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>
          Showing {rows.length} of {total} transactions (Page {page} of {totalPages})
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

      {/* Transaction Details & Audit History Modal */}
      {detailTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Transaction Details</h3>
              <button
                onClick={() => setDetailTx(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-slate-500">Type</dt>
                <dd className="font-semibold text-slate-900">{formatLabel(detailTx.type)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Amount</dt>
                <dd className="font-semibold text-slate-900">{formatCurrency(detailTx.amount, currency)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Category</dt>
                <dd className="font-medium text-slate-800">{formatLabel(detailTx.category)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Payment Method</dt>
                <dd className="font-medium text-slate-800">{formatLabel(detailTx.paymentMethod)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="font-medium text-slate-800">{detailTx.status}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Source</dt>
                <dd className="font-medium text-slate-800">{detailTx.source}</dd>
              </div>
              {detailTx.supplierName && (
                <div>
                  <dt className="text-slate-500">Supplier</dt>
                  <dd className="font-medium text-slate-800">{detailTx.supplierName}</dd>
                </div>
              )}
              {detailTx.customerName && (
                <div>
                  <dt className="text-slate-500">Customer</dt>
                  <dd className="font-medium text-slate-800">{detailTx.customerName}</dd>
                </div>
              )}
              {detailTx.description && (
                <div className="col-span-2">
                  <dt className="text-slate-500">Description</dt>
                  <dd className="font-medium text-slate-800">{detailTx.description}</dd>
                </div>
              )}
            </dl>

            {detailTx.items && detailTx.items.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold text-slate-700">Line Items</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {detailTx.items.map((item, i) => (
                    <li key={i} className="flex justify-between">
                      <span>
                        {item.productName} ({item.quantity} {item.unit})
                      </span>
                      <span>{formatCurrency(item.totalPrice, currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detailTx.auditHistory && detailTx.auditHistory.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold text-slate-700">Audit History</p>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                  {detailTx.auditHistory.map((entry, idx) => (
                    <li key={idx} className="rounded-lg bg-slate-50 px-3 py-2">
                      <span className="font-semibold text-slate-800">{entry.action}</span> &bull;{' '}
                      {formatDate(entry.timestamp, timezone)}
                      {entry.reason && <p className="mt-0.5 text-slate-500">Reason: {entry.reason}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {editTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Edit Transaction</h3>
              <button
                onClick={() => setEditTx(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Amount</label>
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Category</label>
                <input
                  type="text"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Payment Method</label>
                <select
                  value={editMethod}
                  onChange={(e) => setEditMethod(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="CASH">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="CARD">Card</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="CREDIT">Credit</option>
                  <option value="SPLIT">Split</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Description</label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Edit Reason (Audit)</label>
                <input
                  type="text"
                  placeholder="Why is this being changed?"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditTx(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  {savingEdit && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Void Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(voidTx)}
        title="Void Transaction"
        description={`Are you sure you want to void this ${voidTx ? formatLabel(voidTx.type) : ''} of ${voidTx ? formatCurrency(voidTx.amount, currency) : ''}? Any linked supplier or customer balances will be reversed and logged in the audit trail.`}
        confirmLabel="Void Transaction"
        loading={voiding}
        onConfirm={handleConfirmVoid}
        onCancel={() => setVoidTx(null)}
      />

      {/* New Transaction Modal */}
      <TransactionFormsModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={(msg) => {
          setSuccessMsg(msg);
          loadTransactions();
        }}
      />
    </div>
  );
}

