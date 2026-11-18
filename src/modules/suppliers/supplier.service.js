import { Supplier } from './supplier.model.js';
import { Transaction } from '../transactions/transaction.model.js';
import { PaymentRecord } from '../payments/payment-record.model.js';

class SupplierService {
  /**
   * Find or create a supplier for a business
   */
  async findOrCreateSupplier(businessId, name, phone = null, notes = '') {
    if (!businessId) throw new Error('businessId is required');
    if (!name) throw new Error('Supplier name is required');
    const cleanName = name.trim();
    const normalizedName = cleanName.toLowerCase();

    let supplier = await Supplier.findOne({ businessId, normalizedName });
    if (!supplier) {
      supplier = await Supplier.create({
        businessId,
        name: cleanName,
        normalizedName,
        phone,
        notes,
        status: 'ACTIVE',
      });
    } else if (phone && !supplier.phone) {
      supplier.phone = phone;
      await supplier.save();
    }
    return supplier;
  }

  /**
   * Get all active suppliers for a business with balances (optional search)
   */
  async getSuppliersWithBalances(businessId, { search = '' } = {}) {
    if (!businessId) throw new Error('businessId is required');
    const filter = { businessId, status: 'ACTIVE' };
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { phone: regex }];
    }
    return Supplier.find(filter).sort({ outstandingBalance: -1 });
  }

  /**
   * Get single supplier by name or ID
   */
  async getSupplierByNameOrId(businessId, identifier) {
    if (!businessId) throw new Error('businessId is required');
    if (!identifier) return null;
    const clean = String(identifier).trim();
    const normalized = clean.toLowerCase();

    let supplier = await Supplier.findOne({ businessId, normalizedName: normalized });
    if (!supplier && clean.length === 24) {
      supplier = await Supplier.findOne({ businessId, _id: clean });
    }
    return supplier;
  }

  /**
   * Update supplier details with businessId isolation
   */
  async updateSupplier(businessId, supplierId, { name, phone, category, notes, status } = {}) {
    if (!businessId) throw new Error('businessId is required');
    const supplier = await Supplier.findOne({ _id: supplierId, businessId });
    if (!supplier) throw new Error('SUPPLIER_NOT_FOUND');

    if (name && name.trim()) {
      supplier.name = name.trim();
      supplier.normalizedName = name.trim().toLowerCase();
    }
    if (phone !== undefined) supplier.phone = phone;
    if (category !== undefined) supplier.category = category;
    if (notes !== undefined) supplier.notes = notes;
    if (status && ['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(status)) {
      supplier.status = status;
    }

    await supplier.save();
    return supplier;
  }

  /**
   * Get supplier purchase history
   */
  async getSupplierPurchases(businessId, supplierId) {
    if (!businessId) throw new Error('businessId is required');
    return Transaction.find({
      businessId,
      supplierId,
      type: 'PURCHASE',
      status: 'COMPLETED',
    }).sort({ transactionDate: -1 });
  }

  /**
   * Get supplier payment history
   */
  async getSupplierPayments(businessId, supplierId) {
    if (!businessId) throw new Error('businessId is required');
    return PaymentRecord.find({
      businessId,
      supplierId,
      direction: { $in: ['OUTGOING', null] },
      status: 'COMPLETED',
    }).sort({ paymentDate: -1 });
  }

  /**
   * Get business-wide supplier payment history
   */
  async getAllSupplierPayments(businessId, { limit = 100 } = {}) {
    if (!businessId) throw new Error('businessId is required');
    return PaymentRecord.find({
      businessId,
      direction: { $in: ['OUTGOING', null] },
      supplierId: { $ne: null },
      status: 'COMPLETED',
    })
      .populate('supplierId', 'name phone')
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(limit);
  }

  /**
   * Get complete transaction ledger & summary for a supplier
   */
  async getSupplierLedger(businessId, supplierId) {
    if (!businessId) throw new Error('businessId is required');
    const supplier = await Supplier.findOne({ _id: supplierId, businessId });
    if (!supplier) throw new Error('SUPPLIER_NOT_FOUND');

    const purchases = await this.getSupplierPurchases(businessId, supplierId);
    const payments = await this.getSupplierPayments(businessId, supplierId);
    const transactions = await Transaction.find({
      businessId,
      supplierId,
      status: 'COMPLETED',
    }).sort({ transactionDate: -1 });

    return {
      supplier,
      summary: {
        totalPurchases: supplier.totalPurchases,
        totalPayments: supplier.totalPayments,
        outstandingBalance: supplier.outstandingBalance,
        purchaseCount: purchases.length,
        paymentCount: payments.length,
        transactionCount: transactions.length,
      },
      purchases,
      payments,
      transactions,
    };
  }
}

export const supplierService = new SupplierService();
