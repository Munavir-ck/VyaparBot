'use client';

import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiRequest, ApiError } from '@/lib/api-client';
import { formatCurrency } from '@/lib/formatters';

export interface PartyOption {
  _id: string;
  name: string;
  phone?: string | null;
  outstandingBalance: number;
}

interface RecordPaymentModalProps {
  open: boolean;
  mode: 'CUSTOMER' | 'SUPPLIER';
  parties: PartyOption[];
  initialPartyId?: string;
  currency?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CARD'];

export function RecordPaymentModal({
  open,
  mode,
  parties,
  initialPartyId,
  currency = 'INR',
  onClose,
  onSuccess,
}: RecordPaymentModalProps) {
  const [partyId, setPartyId] = useState(initialPartyId || '');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [transactionDate, setTransactionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [referenceId, setReferenceId] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmStep, setConfirmStep] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  useEffect(() => {
    if (open) {
      setPartyId(initialPartyId || parties[0]?._id || '');
      const selected = parties.find((p) => p._id === (initialPartyId || parties[0]?._id));
      setAmount(selected && selected.outstandingBalance > 0 ? String(selected.outstandingBalance) : '');
      setPaymentMethod('CASH');
      setTransactionDate(new Date().toISOString().slice(0, 10));
      setReferenceId('');
      setNotes('');
      setConfirmStep(false);
      setError(null);
      setIdempotencyKey(
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `pay-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      );
    }
  }, [open, initialPartyId, parties]);

  if (!open) return null;

  const selectedParty = parties.find((p) => p._id === partyId);
  const numericAmount = Number(amount || 0);

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!partyId) {
      setError(`Please select a ${mode === 'CUSTOMER' ? 'customer' : 'supplier'}.`);
      return;
    }
    if (!numericAmount || numericAmount <= 0) {
      setError('Please enter a valid payment amount greater than 0.');
      return;
    }
    setConfirmStep(true);
  };

  const handleConfirmSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const endpoint =
        mode === 'CUSTOMER'
          ? `/api/customers/${partyId}/payments`
          : `/api/suppliers/${partyId}/payments`;

      await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          amount: numericAmount,
          paymentMethod,
          transactionDate,
          referenceId: referenceId.trim() || null,
          notes: notes.trim(),
          idempotencyKey,
        }),
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record payment');
      setConfirmStep(false);
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'CUSTOMER' ? 'Record Customer Payment' : 'Record Supplier Payment';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!confirmStep ? (
            <form onSubmit={handleContinue} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  {mode === 'CUSTOMER' ? 'Customer' : 'Supplier'}
                </label>
                <select
                  value={partyId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setPartyId(nextId);
                    const p = parties.find((x) => x._id === nextId);
                    if (p && p.outstandingBalance > 0) {
                      setAmount(String(p.outstandingBalance));
                    }
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  required
                >
                  <option value="">Select {mode === 'CUSTOMER' ? 'customer' : 'supplier'}</option>
                  {parties.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name} (Due: {formatCurrency(Math.max(0, p.outstandingBalance), currency)})
                    </option>
                  ))}
                </select>
              </div>

              {selectedParty && (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Current Outstanding Balance:{' '}
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(selectedParty.outstandingBalance, currency)}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Amount</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Payment Date</label>
                  <input
                    type="date"
                    value={transactionDate}
                    onChange={(e) => setTransactionDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Reference (Optional)
                  </label>
                  <input
                    type="text"
                    value={referenceId}
                    onChange={(e) => setReferenceId(e.target.value)}
                    placeholder="UTR / Receipt #"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Notes (Optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Settlement note"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  Review Payment
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <CheckCircle2 className="h-4 w-4 text-amber-600" />
                  Confirm Payment Settlement
                </div>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-600">
                      {mode === 'CUSTOMER' ? 'Customer' : 'Supplier'}:
                    </dt>
                    <dd className="font-medium text-slate-900">{selectedParty?.name}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Payment Amount:</dt>
                    <dd className="font-semibold text-emerald-700">
                      {formatCurrency(numericAmount, currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Payment Method:</dt>
                    <dd className="font-medium text-slate-900">{paymentMethod.replace('_', ' ')}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Date:</dt>
                    <dd className="font-medium text-slate-900">{transactionDate}</dd>
                  </div>
                </dl>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmStep(false)}
                  disabled={submitting}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSubmit}
                  disabled={submitting}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? 'Recording...' : 'Confirm & Record Payment'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
