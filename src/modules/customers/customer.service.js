import { Customer } from './customer.model.js';
import { Transaction } from '../transactions/transaction.model.js';
import { PaymentRecord } from '../payments/payment-record.model.js';
import { runInTransaction, sessionOpts } from '../../utils/db-transaction.js';

class CustomerService {
  /**
   * Find or create a customer for a business (enforces businessId isolation)
   */
  async findOrCreateCustomer(businessId, name, phone = null, notes = '', session = null) {
    if (!businessId) throw new Error('businessId is required');
    if (!name) throw new Error('Customer name is required');
    const cleanName = name.trim();
    const normalizedName = cleanName.toLowerCase();

    let customer = await Customer.findOne({ businessId, normalizedName }, null, sessionOpts(session));
    if (!customer) {
      const [created] = await Customer.create(
        [
          {
            businessId,
            name: cleanName,
            normalizedName,
            phone,
            notes,
            status: 'ACTIVE',
          },
        ],
        sessionOpts(session),
      );
      customer = created;
    } else if (phone && !customer.phone) {
      customer.phone = phone;
      await customer.save(sessionOpts(session));
    }
    return customer;
  }

  /**
   * List and search active customers for a business
   */
  async listCustomers(businessId, { search = '' } = {}) {
    if (!businessId) throw new Error('businessId is required');
    const filter = { businessId, status: 'ACTIVE' };
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { phone: regex }];
    }
    return Customer.find(filter).sort({ name: 1 });
  }

  /**
   * List active customers with outstanding receivable balances
   */
  async getCustomersWithBalances(businessId) {
    if (!businessId) throw new Error('businessId is required');
    return Customer.find({ businessId, status: 'ACTIVE' }).sort({ outstandingBalance: -1 });
  }

  /**
   * Get single customer by ID with businessId isolation
   */
  async getCustomerById(businessId, customerId) {
    if (!businessId) throw new Error('businessId is required');
    if (!customerId) return null;
    return Customer.findOne({ _id: customerId, businessId });
  }

  /**
   * Update customer details
   */
  async updateCustomer(businessId, customerId, { name, phone, notes, status } = {}) {
    if (!businessId) throw new Error('businessId is required');
    const customer = await Customer.findOne({ _id: customerId, businessId });
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

    if (name && name.trim()) {
      customer.name = name.trim();
      customer.normalizedName = name.trim().toLowerCase();
    }
    if (phone !== undefined) customer.phone = phone;
    if (notes !== undefined) customer.notes = notes;
    if (status && ['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(status)) {
      customer.status = status;
    }

    await customer.save();
    return customer;
  }

  /**
   * Record a customer payment against an existing receivable balance
   */
  async recordCustomerPayment({
    businessId,
    customerId = null,
    customerName = null,
    amount,
    paymentMethod = 'CASH',
    referenceId = null,
    idempotencyKey = null,
    transactionDate = new Date(),
    notes = '',
    createdBy = null,
  }) {
    if (!businessId) throw new Error('businessId is required');
    const finalAmount = Number(amount || 0);
    if (finalAmount <= 0) throw new Error('Payment amount must be greater than zero');

    return runInTransaction(async (session) => {
      if (idempotencyKey) {
        const existingPayment = await PaymentRecord.findOne(
          { businessId, idempotencyKey },
          null,
          sessionOpts(session),
        );
        if (existingPayment) {
          const [existingTx, existingCust] = await Promise.all([
            existingPayment.relatedTransactionId
              ? Transaction.findOne({ _id: existingPayment.relatedTransactionId, businessId }, null, sessionOpts(session))
              : null,
            existingPayment.customerId
              ? Customer.findOne({ _id: existingPayment.customerId, businessId }, null, sessionOpts(session))
              : null,
          ]);
          return {
            success: true,
            duplicate: true,
            transaction: existingTx,
            paymentRecord: existingPayment,
            customer: existingCust,
          };
        }
      }

      let customer = null;
      if (customerId) {
        customer = await Customer.findOne({ _id: customerId, businessId }, null, sessionOpts(session));
        if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
      } else if (customerName) {
        customer = await this.findOrCreateCustomer(businessId, customerName, null, '', session);
      } else {
        throw new Error('customerId or customerName is required');
      }

      const [transaction] = await Transaction.create(
        [
          {
            businessId,
            type: 'CUSTOMER_PAYMENT',
            category: 'CUSTOMER_PAYMENT',
            amount: finalAmount,
            currency: 'INR',
            paymentMethod,
            customerId: customer._id,
            customerName: customer.name,
            transactionDate: new Date(transactionDate),
            source: 'TEXT',
            referenceId,
            status: 'COMPLETED',
            description: notes || `Payment received from ${customer.name}`,
            createdBy,
            auditHistory: [
              {
                action: 'CREATED',
                changedBy: createdBy,
                timestamp: new Date(),
                newValues: { amount: finalAmount, customerId: customer._id },
              },
            ],
          },
        ],
        sessionOpts(session),
      );

      const [paymentRecord] = await PaymentRecord.create(
        [
          {
            businessId,
            direction: 'INCOMING',
            relatedTransactionId: transaction._id,
            customerId: customer._id,
            amount: finalAmount,
            paymentMethod,
            paymentDate: new Date(transactionDate),
            referenceId,
            idempotencyKey: idempotencyKey || null,
            notes,
            status: 'COMPLETED',
            createdBy,
          },
        ],
        sessionOpts(session),
      );

      customer.totalPaymentsReceived += finalAmount;
      customer.outstandingBalance -= finalAmount;
      await customer.save(sessionOpts(session));

      return { success: true, transaction, paymentRecord, customer };
    });
  }

  /**
   * Get customer payment history
   */
  async getCustomerPaymentHistory(businessId, customerId) {
    if (!businessId) throw new Error('businessId is required');
    return PaymentRecord.find({
      businessId,
      customerId,
      direction: 'INCOMING',
      status: 'COMPLETED',
    }).sort({ paymentDate: -1 });
  }

  /**
   * Get business-wide customer payment history
   */
  async getAllCustomerPayments(businessId, { limit = 100 } = {}) {
    if (!businessId) throw new Error('businessId is required');
    return PaymentRecord.find({
      businessId,
      direction: 'INCOMING',
      status: 'COMPLETED',
    })
      .populate('customerId', 'name phone')
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(limit);
  }

  /**
   * Get customer transaction ledger (credit sales & payment settlements) + summary
   */
  async getCustomerLedger(businessId, customerId) {
    if (!businessId) throw new Error('businessId is required');
    const customer = await Customer.findOne({ _id: customerId, businessId });
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

    const creditSales = await Transaction.find({
      businessId,
      customerId,
      type: 'SALE',
      status: 'COMPLETED',
    }).sort({ transactionDate: -1 });

    const payments = await this.getCustomerPaymentHistory(businessId, customerId);

    const transactions = await Transaction.find({
      businessId,
      customerId,
      status: 'COMPLETED',
    }).sort({ transactionDate: -1 });

    return {
      customer,
      summary: {
        totalCreditSales: customer.totalCreditSales,
        totalPaymentsReceived: customer.totalPaymentsReceived,
        outstandingBalance: customer.outstandingBalance,
        creditSaleCount: creditSales.length,
        paymentCount: payments.length,
      },
      creditSales,
      payments,
      transactions,
    };
  }
}

export const customerService = new CustomerService();
