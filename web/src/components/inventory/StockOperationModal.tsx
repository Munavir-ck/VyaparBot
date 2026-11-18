'use client';

import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import type { ProductItem } from '@/types/api';

export type StockOperationType = 'STOCK_IN' | 'STOCK_OUT' | 'WASTAGE' | 'ADJUSTMENT';

interface StockOperationModalProps {
  open: boolean;
  initialOperation?: StockOperationType;
  initialProduct?: ProductItem | null;
  products: ProductItem[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function StockOperationModal({
  open,
  initialOperation = 'STOCK_IN',
  initialProduct = null,
  products,
  onClose,
  onSuccess,
}: StockOperationModalProps) {
  const { hasPermission } = useAuth();

  const [operation, setOperation] = useState<StockOperationType>(initialOperation);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [newStockCount, setNewStockCount] = useState('');
  const [wastageKind, setWastageKind] = useState<'WASTAGE' | 'DAMAGED'>('WASTAGE');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [confirmAdjust, setConfirmAdjust] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOperation(initialOperation);
    setProductId(initialProduct?._id || products[0]?._id || '');
    setQuantity('');
    setNewStockCount(initialProduct ? String(initialProduct.currentStock) : '');
    setReason('');
    setConfirmAdjust(false);
    setError(null);
    setIdempotencyKey(`ui_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  }, [open, initialOperation, initialProduct, products]);

  if (!open) return null;

  const selectedProduct = products.find((p) => p._id === productId) || null;
  const canManage = hasPermission('MANAGE_INVENTORY');
  const canAdjust = hasPermission('ADJUST_STOCK');

  const executeSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (!productId) throw new Error('Please select a product.');

      if (operation === 'ADJUSTMENT') {
        if (!reason.trim()) throw new Error('Reason is required for stock adjustment.');
        await apiRequest('/api/inventory/adjust', {
          method: 'POST',
          body: JSON.stringify({
            productId,
            newStockCount: Number(newStockCount),
            reason: reason.trim(),
            idempotencyKey,
          }),
        });
        onSuccess('Stock adjusted and logged in ledger.');
      } else if (operation === 'WASTAGE') {
        const qty = Number(quantity);
        if (qty <= 0) throw new Error('Quantity must be greater than zero.');
        await apiRequest('/api/inventory/wastage', {
          method: 'POST',
          body: JSON.stringify({
            productId,
            quantity: qty,
            type: wastageKind,
            reason: reason.trim() || 'Recorded from dashboard',
            idempotencyKey,
          }),
        });
        onSuccess('Wastage/damage recorded in ledger.');
      } else {
        const qty = Number(quantity);
        if (qty <= 0) throw new Error('Quantity must be greater than zero.');
        const endpoint = operation === 'STOCK_IN' ? '/api/inventory/stock-in' : '/api/inventory/stock-out';
        await apiRequest(endpoint, {
          method: 'POST',
          body: JSON.stringify({
            productId,
            quantity: qty,
            reason: reason.trim() || `${operation} via dashboard`,
            idempotencyKey,
          }),
        });
        onSuccess(operation === 'STOCK_IN' ? 'Stock added successfully.' : 'Stock removed successfully.');
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stock operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (operation === 'ADJUSTMENT' && !confirmAdjust) {
      if (!reason.trim()) {
        setError('Adjustment reason is required for audit trail.');
        return;
      }
      setConfirmAdjust(true);
      return;
    }
    executeSubmit();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900">Record Stock Movement</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Operation Tabs */}
        <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1 sm:grid-cols-4">
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => {
                  setOperation('STOCK_IN');
                  setConfirmAdjust(false);
                }}
                className={`rounded-md py-1.5 text-xs font-semibold ${
                  operation === 'STOCK_IN' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Stock-In
              </button>
              <button
                type="button"
                onClick={() => {
                  setOperation('STOCK_OUT');
                  setConfirmAdjust(false);
                }}
                className={`rounded-md py-1.5 text-xs font-semibold ${
                  operation === 'STOCK_OUT' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Stock-Out
              </button>
              <button
                type="button"
                onClick={() => {
                  setOperation('WASTAGE');
                  setConfirmAdjust(false);
                }}
                className={`rounded-md py-1.5 text-xs font-semibold ${
                  operation === 'WASTAGE' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Wastage
              </button>
            </>
          )}
          {canAdjust && (
            <button
              type="button"
              onClick={() => {
                setOperation('ADJUSTMENT');
                setConfirmAdjust(false);
              }}
              className={`rounded-md py-1.5 text-xs font-semibold ${
                operation === 'ADJUSTMENT' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Adjust
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Product</label>
            <select
              required
              value={productId}
              onChange={(e) => {
                const pid = e.target.value;
                setProductId(pid);
                const p = products.find((item) => item._id === pid);
                if (p && operation === 'ADJUSTMENT') {
                  setNewStockCount(String(p.currentStock));
                }
                setConfirmAdjust(false);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select product...</option>
              {products.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} — Current: {p.currentStock} {p.unit}
                </option>
              ))}
            </select>
          </div>

          {operation === 'WASTAGE' && (
            <div>
              <label className="block text-xs font-medium text-slate-700">Type</label>
              <select
                value={wastageKind}
                onChange={(e) => setWastageKind(e.target.value as 'WASTAGE' | 'DAMAGED')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="WASTAGE">Wastage / Spoiled</option>
                <option value="DAMAGED">Damaged</option>
              </select>
            </div>
          )}

          {operation === 'ADJUSTMENT' ? (
            <div>
              <label className="block text-xs font-medium text-slate-700">
                New Physical Stock Count ({selectedProduct?.unit || 'units'})
              </label>
              <input
                type="number"
                required
                min="0"
                step="any"
                value={newStockCount}
                onChange={(e) => {
                  setNewStockCount(e.target.value);
                  setConfirmAdjust(false);
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {selectedProduct && (
                <p className="mt-1 text-xs text-slate-500">
                  Current ledger balance: {selectedProduct.currentStock} {selectedProduct.unit}
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Quantity ({selectedProduct?.unit || 'units'})
              </label>
              <input
                type="number"
                required
                min="0.01"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Reason {operation === 'ADJUSTMENT' || operation === 'WASTAGE' ? '(Required)' : '(Optional)'}
            </label>
            <input
              type="text"
              required={operation === 'ADJUSTMENT' || operation === 'WASTAGE'}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setConfirmAdjust(false);
              }}
              placeholder={
                operation === 'ADJUSTMENT'
                  ? 'e.g. Physical shelf count reconciliation'
                  : 'e.g. Morning delivery / Spoiled'
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {confirmAdjust && operation === 'ADJUSTMENT' && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Confirm stock adjustment for <strong>{selectedProduct?.name}</strong> from{' '}
                <strong>{selectedProduct?.currentStock}</strong> to <strong>{newStockCount}</strong>{' '}
                {selectedProduct?.unit}? Click <strong>Confirm Adjustment</strong> to commit.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {operation === 'ADJUSTMENT' && confirmAdjust ? 'Confirm Adjustment' : 'Save Movement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

