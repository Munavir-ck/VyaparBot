'use client';

import React, { useEffect, useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { apiRequest, ApiError } from '@/lib/api-client';

export interface PartyFormInitial {
  _id: string;
  name: string;
  phone?: string | null;
  category?: string;
  notes?: string;
}

interface PartyFormModalProps {
  open: boolean;
  mode: 'CUSTOMER' | 'SUPPLIER';
  editing?: PartyFormInitial | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function PartyFormModal({
  open,
  mode,
  editing,
  onClose,
  onSuccess,
}: PartyFormModalProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(editing?.name || '');
      setPhone(editing?.phone || '');
      setCategory(editing?.category || 'GENERAL');
      setNotes(editing?.notes || '');
      setError(null);
    }
  }, [open, editing]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(`${mode === 'CUSTOMER' ? 'Customer' : 'Supplier'} name is required.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const base = mode === 'CUSTOMER' ? '/api/customers' : '/api/suppliers';
      const payload: Record<string, unknown> = {
        name: name.trim(),
        phone: phone.trim() || null,
        notes: notes.trim(),
      };
      if (mode === 'SUPPLIER') {
        payload.category = category.trim() || 'GENERAL';
      }

      if (editing) {
        await apiRequest(`${base}/${editing._id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest(base, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const label = mode === 'CUSTOMER' ? 'Customer' : 'Supplier';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">
            {editing ? `Edit ${label}` : `Add ${label}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Enter ${label.toLowerCase()} name`}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Phone (Optional)
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 9876543210"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {mode === 'SUPPLIER' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Wholesale, Dairy, Produce"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Address or payment terms"
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
              disabled={submitting}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : editing ? 'Save Changes' : `Add ${label}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
