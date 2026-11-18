import { Transaction } from './transaction.model.js';
import { Supplier } from '../suppliers/supplier.model.js';
import { Customer } from '../customers/customer.model.js';
import { PaymentRecord } from '../payments/payment-record.model.js';
import { Business } from '../businesses/business.model.js';
import { customerService } from '../customers/customer.service.js';
import { inventoryService } from '../inventory/inventory.service.js';
import { runInTransaction, sessionOpts } from '../../utils/db-transaction.js';
import { logger } from '../../config/logger.js';

class TransactionService {
  /**
   * Helper to resolve transaction date reference
   */
  resolveTransactionDate(dateRef) {
    if (!dateRef || dateRef === 'TODAY') {
      return new Date();
    }
    if (dateRef === 'YESTERDAY') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d;
    }
    const parsed = new Date(dateRef);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  /**
   * Check for duplicate transaction by referenceId or imageHash
   */
  async checkDuplicate({ businessId, referenceId = null, imageHash = null, amount = null, category = null }) {
    if (referenceId) {
      const existingRef = await Transaction.findOne({
        businessId,
        referenceId,
        status: { $in: ['COMPLETED', 'PENDING'] },
      });
      if (existingRef) {
        return { isDuplicate: true, reason: 'REFERENCE_ID_EXISTS', existingTransaction: existingRef };
      }
    }

    if (imageHash) {
      const existingHash = await Transaction.findOne({
        businessId,
        imageHash,
        status: { $in: ['COMPLETED', 'PENDING'] },
      });
      if (existingHash) {
        return { isDuplicate: true, reason: 'IMAGE_HASH_EXISTS', existingTransaction: existingHash };
      }
    }

    // Check for near-identical transaction in the last 60 seconds (webhook retry or double tap)
    if (amount !== null && category) {
      const recentWindow = new Date(Date.now() - 60 * 1000);
      const recent = await Transaction.findOne({
        businessId,
        amount,
        category,
        createdAt: { $gte: recentWindow },
        status: { $in: ['COMPLETED', 'PENDING'] },
      });
      if (recent) {
        return { isDuplicate: true, reason: 'RECENT_IDENTICAL_TRANSACTION', existingTransaction: recent };
      }
    }

    return { isDuplicate: false };
  }

  /**
   * Record a Sale
   * Important: Does not double count when both total sales and breakdown are provided.
   */
  async recordSale({
    businessId,
    amount,
    currency = 'INR',
    paymentMethod = 'UNKNOWN',
    paymentBreakdown = {},
    salePeriod = 'FULL_DAY',
    items = [],
    customerName = null,
    transactionDate = 'TODAY',
    source = 'TEXT',
    referenceId = null,
    imageHash = null,
    description = '',
    createdBy = null,
    metadata = {},
  }) {
    if (!businessId) throw new Error('businessId is required');

    // Duplicate check
    const dup = await this.checkDuplicate({ businessId, referenceId, imageHash });
    if (dup.isDuplicate) {
      logger.warn({ businessId, referenceId, imageHash }, 'Duplicate sale transaction ignored');
      return { duplicate: true, transaction: dup.existingTransaction };
    }

    const cash = Number(paymentBreakdown.cash || 0);
    const upi = Number(paymentBreakdown.upi || 0);
    const card = Number(paymentBreakdown.card || 0);
    const bankTransfer = Number(paymentBreakdown.bankTransfer || 0);
    const credit = Number(paymentBreakdown.credit || 0);

    let finalAmount = Number(amount || 0);
    const breakdownSum = cash + upi + card + bankTransfer + credit;

    // Accounting safeguard: If no explicit total given, sum breakdown
    if (finalAmount <= 0 && breakdownSum > 0) {
      finalAmount = breakdownSum;
    }

    // Calculate unreconciled portion if any
    let unreconciled = 0;
    if (finalAmount > 0 && breakdownSum > 0 && breakdownSum < finalAmount) {
      unreconciled = finalAmount - breakdownSum;
    }

    let finalPaymentMethod = paymentMethod;
    if (cash > 0 && upi > 0) {
      finalPaymentMethod = 'SPLIT';
    } else if (cash > 0 && upi === 0) {
      finalPaymentMethod = 'CASH';
    } else if (upi > 0 && cash === 0) {
      finalPaymentMethod = 'UPI';
    }

    const resolvedDate = this.resolveTransactionDate(transactionDate);
    const hasItems = Array.isArray(items) && items.length > 0;
    const isLumpSum = !hasItems;

    let customer = null;
    if (customerName) {
      customer = await customerService.findOrCreateCustomer(businessId, customerName);
      if (finalPaymentMethod === 'CREDIT' || credit > 0) {
        const creditAmt = credit > 0 ? credit : finalAmount;
        customer.totalCreditSales += creditAmt;
        customer.outstandingBalance += creditAmt;
        await customer.save();
      }
    }

    const transaction = await Transaction.create({
      businessId,
      type: 'SALE',
      category:
        finalPaymentMethod === 'CREDIT'
          ? 'CREDIT_SALES'
          : salePeriod
            ? `${salePeriod}_SALES`
            : 'DAILY_SALES',
      amount: finalAmount,
      currency,
      paymentMethod: finalPaymentMethod,
      paymentBreakdown: {
        cash,
        upi,
        card,
        bankTransfer,
        credit,
        unreconciled,
      },
      salePeriod,
      items: hasItems ? items : [],
      isLumpSum,
      stockSynced: false,
      customerId: customer ? customer._id : null,
      customerName: customer ? customer.name : customerName,
      transactionDate: resolvedDate,
      source,
      referenceId,
      imageHash,
      status: 'COMPLETED',
      description,
      createdBy,
      auditHistory: [
        {
          action: 'CREATED',
          changedBy: createdBy,
          timestamp: new Date(),
          newValues: { amount: finalAmount, paymentMethod: finalPaymentMethod },
        },
      ],
      metadata,
    });

    // Deduct stock ONLY for itemized sales (lump-sum sales are skipped unless configured)
    let stockResult = { skipped: true, reason: 'LUMP_SUM_SALE_NO_AUTO_DEDUCT' };
    if (hasItems) {
      const business = await Business.findById(businessId);
      stockResult = await inventoryService.processSaleStockOut({
        businessId,
        transaction,
        items,
        businessSettings: business?.settings || {},
        createdBy,
      });
    }

    return { success: true, transaction, customer, stockResult };
  }

  /**
   * Record an Expense
   */
  async recordExpense({
    businessId,
    amount,
    currency = 'INR',
    category = 'OTHER_EXPENSE',
    paymentMethod = 'UNKNOWN',
    transactionDate = 'TODAY',
    source = 'TEXT',
    referenceId = null,
    imageHash = null,
    merchantOrSupplier = null,
    description = '',
    createdBy = null,
    metadata = {},
  }) {
    if (!businessId) throw new Error('businessId is required');
    const finalAmount = Number(amount || 0);
    if (finalAmount <= 0) throw new Error('Expense amount must be greater than zero');

    // Duplicate check
    const dup = await this.checkDuplicate({ businessId, referenceId, imageHash, amount: finalAmount, category });
    if (dup.isDuplicate) {
      logger.warn({ businessId, referenceId, imageHash }, 'Duplicate expense transaction ignored');
      return { duplicate: true, transaction: dup.existingTransaction };
    }

    const resolvedDate = this.resolveTransactionDate(transactionDate);

    // If merchant/supplier specified, find or create supplier record
    let supplierId = null;
    if (merchantOrSupplier) {
      const normalized = merchantOrSupplier.trim().toLowerCase();
      let sup = await Supplier.findOne({ businessId, normalizedName: normalized });
      if (!sup) {
        sup = await Supplier.create({
          businessId,
          name: merchantOrSupplier.trim(),
          normalizedName: normalized,
          status: 'ACTIVE',
        });
      }
      supplierId = sup._id;
    }

    const transaction = await Transaction.create({
      businessId,
      type: 'EXPENSE',
      category: (category || 'OTHER_EXPENSE').toUpperCase(),
      amount: finalAmount,
      currency,
      paymentMethod: paymentMethod || 'UNKNOWN',
      supplierId,
      supplierName: merchantOrSupplier,
      transactionDate: resolvedDate,
      source,
      referenceId,
      imageHash,
      status: 'COMPLETED',
      description,
      createdBy,
      auditHistory: [
        {
          action: 'CREATED',
          changedBy: createdBy,
          timestamp: new Date(),
          newValues: { amount: finalAmount, category },
        },
      ],
      metadata,
    });

    return { success: true, transaction };
  }

  /**
   * Record a Supplier Purchase (Credit or Direct)
   * Important Accounting Rule: If bought on credit, it records a purchase liability.
   */
  async recordPurchase({
    businessId,
    amount,
    currency = 'INR',
    category = 'GROCERIES',
    paymentMethod = 'CREDIT',
    merchantOrSupplier,
    items = [],
    transactionDate = 'TODAY',
    source = 'TEXT',
    referenceId = null,
    description = '',
    createdBy = null,
  }) {
    if (!businessId) throw new Error('businessId is required');
    const finalAmount = Number(amount || 0);
    if (finalAmount <= 0) throw new Error('Purchase amount must be greater than zero');

    const supplierName = merchantOrSupplier ? merchantOrSupplier.trim() : 'General Supplier';
    const normalized = supplierName.toLowerCase();

    const { transaction, supplier } = await runInTransaction(async (session) => {
      // Find or create supplier
      let sup = await Supplier.findOne({ businessId, normalizedName: normalized }, null, sessionOpts(session));
      if (!sup) {
        const [created] = await Supplier.create(
          [
            {
              businessId,
              name: supplierName,
              normalizedName: normalized,
              status: 'ACTIVE',
            },
          ],
          sessionOpts(session),
        );
        sup = created;
      }

      const resolvedDate = this.resolveTransactionDate(transactionDate);
      const hasItems = Array.isArray(items) && items.length > 0;

      const [tx] = await Transaction.create(
        [
          {
            businessId,
            type: 'PURCHASE',
            category: category ? category.toUpperCase() : 'SUPPLIER_PURCHASE',
            amount: finalAmount,
            currency,
            paymentMethod,
            items: hasItems ? items : [],
            isLumpSum: !hasItems,
            supplierId: sup._id,
            supplierName: sup.name,
            transactionDate: resolvedDate,
            source,
            referenceId,
            status: 'COMPLETED',
            description,
            createdBy,
            auditHistory: [
              {
                action: 'CREATED',
                changedBy: createdBy,
                timestamp: new Date(),
                newValues: { amount: finalAmount, supplierId: sup._id },
              },
            ],
          },
        ],
        sessionOpts(session),
      );

      // Update supplier accounting ledger: credit purchases increase total purchases & outstanding balance
      sup.totalPurchases += finalAmount;
      if (paymentMethod === 'CREDIT') {
        sup.outstandingBalance += finalAmount;
      } else {
        sup.totalPayments += finalAmount;
      }
      await sup.save(sessionOpts(session));

      return { transaction: tx, supplier: sup };
    });

    // Increase inventory when purchase includes line items
    let stockResult = { processed: 0, movements: [] };
    if (Array.isArray(items) && items.length > 0) {
      stockResult = await inventoryService.processPurchaseStockIn({
        businessId,
        transaction,
        items,
        createdBy,
      });
    }

    return { success: true, transaction, supplier, stockResult };
  }

  /**
   * Record a Supplier Payment (Settling outstanding balance)
   * Critical Accounting Rule: Paying off an existing credit purchase DOES NOT count
   * as a second expense in daily/monthly operational P&L!
   */
  async recordSupplierPayment({
    businessId,
    amount,
    paymentMethod = 'CASH',
    merchantOrSupplier,
    referenceId = null,
    idempotencyKey = null,
    transactionDate = 'TODAY',
    source = 'TEXT',
    notes = '',
    createdBy = null,
  }) {
    if (!businessId) throw new Error('businessId is required');
    const finalAmount = Number(amount || 0);
    if (finalAmount <= 0) throw new Error('Payment amount must be greater than zero');

    const supplierName = merchantOrSupplier ? merchantOrSupplier.trim() : 'General Supplier';
    const normalized = supplierName.toLowerCase();
    const resolvedDate = this.resolveTransactionDate(transactionDate);

    return runInTransaction(async (session) => {
      if (idempotencyKey) {
        const existingPayment = await PaymentRecord.findOne(
          { businessId, idempotencyKey },
          null,
          sessionOpts(session),
        );
        if (existingPayment) {
          const [existingTx, existingSup] = await Promise.all([
            existingPayment.relatedTransactionId
              ? Transaction.findOne({ _id: existingPayment.relatedTransactionId, businessId }, null, sessionOpts(session))
              : null,
            existingPayment.supplierId
              ? Supplier.findOne({ _id: existingPayment.supplierId, businessId }, null, sessionOpts(session))
              : null,
          ]);
          return {
            success: true,
            duplicate: true,
            transaction: existingTx,
            paymentRecord: existingPayment,
            supplier: existingSup,
          };
        }
      }

      let supplier = await Supplier.findOne({ businessId, normalizedName: normalized }, null, sessionOpts(session));
      if (!supplier) {
        const [createdSup] = await Supplier.create(
          [
            {
              businessId,
              name: supplierName,
              normalizedName: normalized,
              status: 'ACTIVE',
            },
          ],
          sessionOpts(session),
        );
        supplier = createdSup;
      }

      // 1. Create Transaction of type SUPPLIER_PAYMENT
      const [transaction] = await Transaction.create(
        [
          {
            businessId,
            type: 'SUPPLIER_PAYMENT',
            category: 'SUPPLIER_PAYMENT',
            amount: finalAmount,
            currency: 'INR',
            paymentMethod,
            supplierId: supplier._id,
            supplierName: supplier.name,
            transactionDate: resolvedDate,
            source,
            referenceId,
            status: 'COMPLETED',
            description: notes || `Payment to ${supplier.name}`,
            createdBy,
            auditHistory: [
              {
                action: 'CREATED',
                changedBy: createdBy,
                timestamp: new Date(),
                newValues: { amount: finalAmount, supplierId: supplier._id },
              },
            ],
          },
        ],
        sessionOpts(session),
      );

      // 2. Create PaymentRecord
      const [paymentRecord] = await PaymentRecord.create(
        [
          {
            businessId,
            direction: 'OUTGOING',
            relatedTransactionId: transaction._id,
            supplierId: supplier._id,
            amount: finalAmount,
            paymentMethod,
            paymentDate: resolvedDate,
            referenceId,
            idempotencyKey: idempotencyKey || null,
            notes,
            status: 'COMPLETED',
            createdBy,
          },
        ],
        sessionOpts(session),
      );

      // 3. Update Supplier Ledger
      supplier.totalPayments += finalAmount;
      supplier.outstandingBalance -= finalAmount;
      await supplier.save(sessionOpts(session));

      return { success: true, transaction, paymentRecord, supplier };
    });
  }

  /**
   * Edit/Update an existing transaction with audit history
   */
  async editTransaction({ businessId, transactionId, updates = {}, changedBy = null, reason = 'User edited' }) {
    if (!businessId || !transactionId) throw new Error('businessId and transactionId are required');

    return runInTransaction(async (session) => {
      const transaction = await Transaction.findOne(
        { _id: transactionId, businessId },
        null,
        sessionOpts(session),
      );
      if (!transaction) throw new Error('TRANSACTION_NOT_FOUND');
      if (transaction.status === 'VOIDED') {
        throw new Error('CANNOT_EDIT_VOIDED_TRANSACTION');
      }

      const previousValues = {
        amount: transaction.amount,
        category: transaction.category,
        paymentMethod: transaction.paymentMethod,
        description: transaction.description,
      };

      const oldAmount = transaction.amount;
      const newAmount =
        typeof updates.amount === 'number' && updates.amount > 0 ? updates.amount : oldAmount;
      const delta = newAmount - oldAmount;

      if (delta !== 0) {
        if (transaction.supplierId) {
          const supplier = await Supplier.findOne(
            { _id: transaction.supplierId, businessId },
            null,
            sessionOpts(session),
          );
          if (supplier) {
            if (transaction.type === 'PURCHASE') {
              supplier.totalPurchases = Math.max(0, supplier.totalPurchases + delta);
              if (transaction.paymentMethod === 'CREDIT') {
                supplier.outstandingBalance += delta;
              }
              await supplier.save(sessionOpts(session));
            } else if (transaction.type === 'SUPPLIER_PAYMENT') {
              supplier.totalPayments = Math.max(0, supplier.totalPayments + delta);
              supplier.outstandingBalance -= delta;
              await supplier.save(sessionOpts(session));
            }
          }
        }

        if (transaction.customerId) {
          const customer = await Customer.findOne(
            { _id: transaction.customerId, businessId },
            null,
            sessionOpts(session),
          );
          if (customer) {
            if (transaction.type === 'SALE' && transaction.paymentMethod === 'CREDIT') {
              customer.totalCreditSales = Math.max(0, customer.totalCreditSales + delta);
              customer.outstandingBalance += delta;
              await customer.save(sessionOpts(session));
            } else if (transaction.type === 'CUSTOMER_PAYMENT') {
              customer.totalPaymentsReceived = Math.max(0, customer.totalPaymentsReceived + delta);
              customer.outstandingBalance -= delta;
              await customer.save(sessionOpts(session));
            }
          }
        }

        transaction.amount = newAmount;
      }

      if (updates.category) {
        transaction.category = updates.category.toUpperCase();
      }
      if (updates.paymentMethod) {
        transaction.paymentMethod = updates.paymentMethod;
      }
      if (updates.description !== undefined) {
        transaction.description = updates.description;
      }

      transaction.auditHistory.push({
        action: 'UPDATED',
        changedBy,
        timestamp: new Date(),
        previousValues,
        newValues: updates,
        reason,
      });

      await transaction.save(sessionOpts(session));
      return { success: true, transaction };
    });
  }

  /**
   * Void/Delete transaction with audit trail
   */
  async voidTransaction({ businessId, transactionId, changedBy = null, reason = 'User requested void' }) {
    if (!businessId || !transactionId) throw new Error('businessId and transactionId are required');

    return runInTransaction(async (session) => {
      const transaction = await Transaction.findOne(
        { _id: transactionId, businessId },
        null,
        sessionOpts(session),
      );
      if (!transaction) throw new Error('TRANSACTION_NOT_FOUND');

      if (transaction.status === 'VOIDED') {
        return { success: true, alreadyVoided: true, transaction };
      }

      // Reverse supplier ledger balances when voiding purchase or supplier payment
      if (transaction.supplierId) {
        const supplier = await Supplier.findOne(
          { _id: transaction.supplierId, businessId },
          null,
          sessionOpts(session),
        );
        if (supplier) {
          if (transaction.type === 'PURCHASE') {
            supplier.totalPurchases = Math.max(0, supplier.totalPurchases - transaction.amount);
            if (transaction.paymentMethod === 'CREDIT') {
              supplier.outstandingBalance = Math.max(0, supplier.outstandingBalance - transaction.amount);
            }
            await supplier.save(sessionOpts(session));
          } else if (transaction.type === 'SUPPLIER_PAYMENT') {
            supplier.totalPayments = Math.max(0, supplier.totalPayments - transaction.amount);
            supplier.outstandingBalance += transaction.amount;
            await supplier.save(sessionOpts(session));
          }
        }
      }

      // Reverse customer receivable balances when voiding credit sale or customer payment
      if (transaction.customerId) {
        const customer = await Customer.findOne(
          { _id: transaction.customerId, businessId },
          null,
          sessionOpts(session),
        );
        if (customer) {
          if (transaction.type === 'SALE' && transaction.paymentMethod === 'CREDIT') {
            customer.totalCreditSales = Math.max(0, customer.totalCreditSales - transaction.amount);
            customer.outstandingBalance = Math.max(0, customer.outstandingBalance - transaction.amount);
            await customer.save(sessionOpts(session));
          } else if (transaction.type === 'CUSTOMER_PAYMENT') {
            customer.totalPaymentsReceived = Math.max(0, customer.totalPaymentsReceived - transaction.amount);
            customer.outstandingBalance += transaction.amount;
            await customer.save(sessionOpts(session));
          }
        }
      }

      transaction.status = 'VOIDED';
      transaction.auditHistory.push({
        action: 'VOIDED',
        changedBy,
        timestamp: new Date(),
        previousValues: { status: 'COMPLETED' },
        newValues: { status: 'VOIDED' },
        reason,
      });

      await transaction.save(sessionOpts(session));

      if (transaction.type === 'CUSTOMER_PAYMENT' || transaction.type === 'SUPPLIER_PAYMENT') {
        await PaymentRecord.updateMany(
          { businessId, relatedTransactionId: transaction._id },
          { $set: { status: 'VOIDED' } },
          sessionOpts(session),
        );
      }

      return { success: true, transaction };
    });
  }

  /**
   * Get the most recently recorded active transaction for a business (for quick edit/void/context)
   */
  async getLastTransaction(businessId) {
    return Transaction.findOne({
      businessId,
      status: { $in: ['COMPLETED', 'PENDING'] },
    }).sort({ createdAt: -1 });
  }
}

export const transactionService = new TransactionService();

