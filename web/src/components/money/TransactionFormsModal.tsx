'use client';

import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { formatLabel } from '@/lib/formatters';
import type { CustomerSummaryItem, ProductItem, SupplierSummaryItem } from '@/types/api';

export type TransactionFormType = 'SALE' | 'EXPENSE' | 'PURCHASE';

interface LineItemDraft {
  productId: string;
  productName: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

interface TransactionFormsModalProps {
  open: boolean;
  initialType?: TransactionFormType;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function TransactionFormsModal({
  open,
  initialType = 'SALE',
  onClose,
  onSuccess,
}: TransactionFormsModalProps) {
  const { business, businessConfig, hasPermission } = useAuth();

  const [tab, setTab] = useState<TransactionFormType>(initialType);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reference lists (loaded only if user has permission)
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [customers, setCustomers] = useState<CustomerSummaryItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierSummaryItem[]>([]);

  // Shared form fields
  const todayStr = new Date().toISOString().split('T')[0];
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [transactionDate, setTransactionDate] = useState(todayStr);

  // Sale fields
  const [salePaymentStatus, setSalePaymentStatus] = useState<'PAID' | 'CREDIT'>('PAID');
  const [saleMethod, setSaleMethod] = useState('CASH');
  const [cashPart, setCashPart] = useState('');
  const [upiPart, setUpiPart] = useState('');
  const [salePeriod, setSalePeriod] = useState('FULL_DAY');
  const [customerName, setCustomerName] = useState('');

  // Expense fields
  const expenseCategories = [
    ...(businessConfig?.expenseCategories || ['OTHER_EXPENSE']),
    ...(business?.settings?.customExpenseCategories || []),
  ].filter((v, i, a) => a.indexOf(v) === i);
  const [expenseCategory, setExpenseCategory] = useState(expenseCategories[0] || 'OTHER_EXPENSE');
  const [expenseMethod, setExpenseMethod] = useState('CASH');

  // Purchase fields
  const [supplierName, setSupplierName] = useState('');
  const [purchasePaymentStatus, setPurchasePaymentStatus] = useState<'CREDIT' | 'PAID'>('CREDIT');
  const [purchaseMethod, setPurchaseMethod] = useState('CASH');

  // Optional itemized products for Sale / Purchase
  const [items, setItems] = useState<LineItemDraft[]>([]);

  useEffect(() => {
    setTab(initialType);
    setError(null);
  }, [initialType, open]);

  useEffect(() => {
    if (!open) return;
    if (hasPermission('VIEW_INVENTORY')) {
      apiRequest<ProductItem[]>('/api/inventory/products?limit=200')
        .then((data) => setProducts(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
    if (hasPermission('MANAGE_CUSTOMERS')) {
      apiRequest<CustomerSummaryItem[]>('/api/customers')
        .then((data) => setCustomers(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
    if (hasPermission('MANAGE_SUPPLIERS')) {
      apiRequest<SupplierSummaryItem[]>('/api/suppliers')
        .then((data) => setSuppliers(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [open, hasPermission]);

  if (!open) return null;

  const addItemRow = () => {
    setItems((prev) => [
      ...prev,
      { productId: '', productName: '', quantity: '1', unit: 'pcs', unitPrice: '0' },
    ]);
  };

  const removeItemRow = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateItemRow = (index: number, patch: Partial<LineItemDraft>) => {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const handleSelectProduct = (index: number, productId: string) => {
    const prod = products.find((p) => p._id === productId);
    if (!prod) {
      updateItemRow(index, { productId: '', productName: '' });
      return;
    }
    const price = tab === 'PURCHASE' ? prod.costPrice : prod.sellingPrice;
    updateItemRow(index, {
      productId: prod._id,
      productName: prod.name,
      unit: prod.unit,
      unitPrice: String(price || 0),
    });
  };

  const parsedItems = items
    .filter((i) => i.productName.trim() && Number(i.quantity) > 0)
    .map((i) => ({
      ...(i.productId ? { productId: i.productId } : {}),
      productName: i.productName.trim(),
      quantity: Number(i.quantity),
      unit: i.unit || 'pcs',
      unitPrice: Number(i.unitPrice || 0),
      totalPrice: Number(i.quantity) * Number(i.unitPrice || 0),
    }));

  const resetAndClose = (msg: string) => {
    setDescription('');
    setAmount('');
    setCashPart('');
    setUpiPart('');
    setCustomerName('');
    setSupplierName('');
    setItems([]);
    onSuccess(msg);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (tab === 'SALE') {
        const isCredit = salePaymentStatus === 'CREDIT';
        const isSplit = !isCredit && saleMethod === 'SPLIT';
        const cashVal = isSplit ? Number(cashPart || 0) : 0;
        const upiVal = isSplit ? Number(upiPart || 0) : 0;
        const itemsTotal = parsedItems.reduce((sum, i) => sum + i.totalPrice, 0);
        const finalAmt = Number(amount || 0) || (isSplit ? cashVal + upiVal : itemsTotal);

        if (finalAmt <= 0) {
          throw new Error('Sale amount must be greater than zero');
        }
        if (isCredit && !customerName.trim()) {
          throw new Error('Customer name is required for a credit sale');
        }

        await apiRequest('/api/transactions/sale', {
          method: 'POST',
          body: JSON.stringify({
            amount: finalAmt,
            paymentMethod: isCredit ? 'CREDIT' : saleMethod,
            paymentBreakdown: isSplit ? { cash: cashVal, upi: upiVal } : {},
            salePeriod,
            customerName: customerName.trim() || null,
            items: parsedItems,
            transactionDate,
            description: description.trim(),
          }),
        });
        resetAndClose('Sale recorded successfully.');
      } else if (tab === 'EXPENSE') {
        const finalAmt = Number(amount || 0);
        if (finalAmt <= 0) {
          throw new Error('Expense amount must be greater than zero');
        }
        await apiRequest('/api/transactions/expense', {
          method: 'POST',
          body: JSON.stringify({
            amount: finalAmt,
            category: expenseCategory,
            paymentMethod: expenseMethod,
            transactionDate,
            description: description.trim(),
          }),
        });
        resetAndClose('Expense recorded successfully.');
      } else {
        const itemsTotal = parsedItems.reduce((sum, i) => sum + i.totalPrice, 0);
        const finalAmt = Number(amount || 0) || itemsTotal;
        if (finalAmt <= 0) {
          throw new Error('Purchase amount must be greater than zero');
        }
        if (!supplierName.trim()) {
          throw new Error('Supplier name is required');
        }
        await apiRequest('/api/transactions/purchase', {
          method: 'POST',
          body: JSON.stringify({
            amount: finalAmt,
            merchantOrSupplier: supplierName.trim(),
            paymentMethod: purchasePaymentStatus === 'CREDIT' ? 'CREDIT' : purchaseMethod,
            items: parsedItems,
            transactionDate,
            description: description.trim(),
          }),
        });
        resetAndClose('Purchase recorded successfully.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save transaction');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h3 className="text-base font-bold text-slate-900">Record Transaction</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Type Tabs */}
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-100 p-1">
          {(['SALE', 'EXPENSE', 'PURCHASE'] as TransactionFormType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                tab === t ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t === 'SALE' ? 'Record Sale' : t === 'EXPENSE' ? 'Record Expense' : 'Record Purchase'}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* SALE FIELDS */}
          {tab === 'SALE' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Payment Status</label>
                  <select
                    value={salePaymentStatus}
                    onChange={(e) => setSalePaymentStatus(e.target.value as 'PAID' | 'CREDIT')}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="PAID">Paid (Collected)</option>
                    <option value="CREDIT">Credit Sale (Receivable)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Sale Period</label>
                  <select
                    value={salePeriod}
                    onChange={(e) => setSalePeriod(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="FULL_DAY">Full Day</option>
                    <option value="MORNING">Morning</option>
                    <option value="AFTERNOON">Afternoon</option>
                    <option value="EVENING">Evening</option>
                  </select>
                </div>
              </div>

              {salePaymentStatus === 'PAID' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700">Payment Method</label>
                  <select
                    value={saleMethod}
                    onChange={(e) => setSaleMethod(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="SPLIT">Split (Cash + UPI)</option>
                    <option value="CARD">Card</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                  </select>
                </div>
              )}

              {salePaymentStatus === 'PAID' && saleMethod === 'SPLIT' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Cash Part</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={cashPart}
                      onChange={(e) => setCashPart(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">UPI Part</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={upiPart}
                      onChange={(e) => setUpiPart(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Customer {salePaymentStatus === 'CREDIT' ? '(Required)' : '(Optional)'}
                </label>
                <input
                  type="text"
                  list="customer-options"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer name"
                  required={salePaymentStatus === 'CREDIT'}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <datalist id="customer-options">
                  {customers.map((c) => (
                    <option key={c._id} value={c.name} />
                  ))}
                </datalist>
              </div>
            </>
          )}

          {/* EXPENSE FIELDS */}
          {tab === 'EXPENSE' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Category</label>
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {expenseCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {formatLabel(cat)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Payment Method</label>
                <select
                  value={expenseMethod}
                  onChange={(e) => setExpenseMethod(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="CASH">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="CARD">Card</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
          )}

          {/* PURCHASE FIELDS */}
          {tab === 'PURCHASE' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700">Supplier (Required)</label>
                <input
                  type="text"
                  list="supplier-options"
                  required
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="e.g. Malabar Traders"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <datalist id="supplier-options">
                  {suppliers.map((s) => (
                    <option key={s._id} value={s.name} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Payment Status</label>
                  <select
                    value={purchasePaymentStatus}
                    onChange={(e) => setPurchasePaymentStatus(e.target.value as 'CREDIT' | 'PAID')}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="CREDIT">On Credit (Payable)</option>
                    <option value="PAID">Paid Immediately</option>
                  </select>
                </div>
                {purchasePaymentStatus === 'PAID' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Payment Method</label>
                    <select
                      value={purchaseMethod}
                      onChange={(e) => setPurchaseMethod(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="CASH">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="BANK_TRANSFER">Bank Transfer</option>
                    </select>
                  </div>
                )}
              </div>
            </>
          )}

          {/* AMOUNT & DATE */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Amount ({business?.currency || 'INR'})
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={parsedItems.length > 0 ? 'Auto or override' : '0'}
                required={parsedItems.length === 0 && !(tab === 'SALE' && saleMethod === 'SPLIT')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Date</label>
              <input
                type="date"
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional note or bill details"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {/* OPTIONAL ITEMIZED PRODUCTS (SALE / PURCHASE) */}
          {(tab === 'SALE' || tab === 'PURCHASE') && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700">
                  Itemized Products (Optional — updates inventory)
                </p>
                <button
                  type="button"
                  onClick={addItemRow}
                  className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-slate-200 hover:bg-emerald-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Item
                </button>
              </div>
              {items.length > 0 && (
                <div className="mt-2 space-y-2">
                  {items.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-12 items-center gap-1.5">
                      <div className="col-span-5">
                        {products.length > 0 ? (
                          <select
                            value={row.productId}
                            onChange={(e) => handleSelectProduct(idx, e.target.value)}
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                          >
                            <option value="">Select product...</option>
                            {products.map((p) => (
                              <option key={p._id} value={p._id}>
                                {p.name} ({p.unit})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            placeholder="Product name"
                            value={row.productName}
                            onChange={(e) => updateItemRow(idx, { productName: e.target.value })}
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                          />
                        )}
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="Qty"
                        value={row.quantity}
                        onChange={(e) => updateItemRow(idx, { quantity: e.target.value })}
                        className="col-span-3 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      />
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="Price"
                        value={row.unitPrice}
                        onChange={(e) => updateItemRow(idx, { unitPrice: e.target.value })}
                        className="col-span-3 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => removeItemRow(idx)}
                        className="col-span-1 flex justify-center text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
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
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Save {tab === 'SALE' ? 'Sale' : tab === 'EXPENSE' ? 'Expense' : 'Purchase'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

