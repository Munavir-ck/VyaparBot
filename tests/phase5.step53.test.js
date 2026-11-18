import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { transactionService } from '../src/modules/transactions/transaction.service.js';
import { customerService } from '../src/modules/customers/customer.service.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';
import { Supplier } from '../src/modules/suppliers/supplier.model.js';
import { Customer } from '../src/modules/customers/customer.model.js';
import { Product } from '../src/modules/inventory/product.model.js';
import { StockMovement } from '../src/modules/inventory/stock-movement.model.js';

describe('Phase 5 (Step 5.3): Money Management & Transaction Edit/Void Balance Integrity', () => {
  it('adjusts supplier and customer balances accurately when editing transactions', async () => {
    const phone = '919855111222';
    const { user, business } = await businessService.resolveBusinessForUser(phone, 'Step 5.3 Biz');

    // 1. Credit Purchase of 4000 -> edit to 5000 -> Supplier balance becomes 5000
    const pur = await transactionService.recordPurchase({
      businessId: business._id,
      amount: 4000,
      paymentMethod: 'CREDIT',
      merchantOrSupplier: 'Kochi Foods',
      createdBy: user._id,
    });
    expect(pur.supplier.outstandingBalance).toBe(4000);

    await transactionService.editTransaction({
      businessId: business._id,
      transactionId: pur.transaction._id,
      updates: { amount: 5000 },
      changedBy: user._id,
      reason: 'Invoice correction',
    });

    let sup = await Supplier.findById(pur.supplier._id);
    expect(sup.totalPurchases).toBe(5000);
    expect(sup.outstandingBalance).toBe(5000);

    // 2. Supplier Payment of 1000 -> edit to 1500 -> Supplier balance becomes 3500
    const supPay = await transactionService.recordSupplierPayment({
      businessId: business._id,
      amount: 1000,
      paymentMethod: 'UPI',
      merchantOrSupplier: 'Kochi Foods',
      createdBy: user._id,
    });
    await transactionService.editTransaction({
      businessId: business._id,
      transactionId: supPay.transaction._id,
      updates: { amount: 1500 },
      changedBy: user._id,
    });
    sup = await Supplier.findById(pur.supplier._id);
    expect(sup.totalPayments).toBe(1500);
    expect(sup.outstandingBalance).toBe(3500);

    // 3. Credit Sale of 2000 -> edit to 2500 -> Customer Payment of 500 -> edit to 1000 -> Customer balance 1500
    const sale = await transactionService.recordSale({
      businessId: business._id,
      amount: 2000,
      paymentMethod: 'CREDIT',
      customerName: 'Deepak',
      createdBy: user._id,
    });
    await transactionService.editTransaction({
      businessId: business._id,
      transactionId: sale.transaction._id,
      updates: { amount: 2500 },
      changedBy: user._id,
    });

    const custPay = await customerService.recordCustomerPayment({
      businessId: business._id,
      customerName: 'Deepak',
      amount: 500,
      paymentMethod: 'CASH',
      createdBy: user._id,
    });
    await transactionService.editTransaction({
      businessId: business._id,
      transactionId: custPay.transaction._id,
      updates: { amount: 1000 },
      changedBy: user._id,
    });

    const cust = await Customer.findById(custPay.customer._id);
    expect(cust.totalCreditSales).toBe(2500);
    expect(cust.totalPaymentsReceived).toBe(1000);
    expect(cust.outstandingBalance).toBe(1500);

    // 4. Voided transaction cannot be edited
    await transactionService.voidTransaction({
      businessId: business._id,
      transactionId: sale.transaction._id,
      changedBy: user._id,
    });
    await expect(
      transactionService.editTransaction({
        businessId: business._id,
        transactionId: sale.transaction._id,
        updates: { amount: 9999 },
        changedBy: user._id,
      }),
    ).rejects.toThrow('CANNOT_EDIT_VOIDED_TRANSACTION');
  });

  it('filters transactions by type, category, date range, and prevents duplicate stock deductions on edit', async () => {
    const headers = { 'x-user-phone': '919855111333' };
    const { user, business } = await businessService.resolveBusinessForUser('919855111333', 'Filter Biz');

    const prod = await inventoryService.createOrUpdateProduct({
      businessId: business._id,
      name: 'Tea Powder',
      unit: 'kg',
      initialStock: 20,
      createdBy: user._id,
    });

    const saleRes = await request(app)
      .post('/api/transactions/sale')
      .set(headers)
      .send({
        amount: 1000,
        paymentMethod: 'CASH',
        description: 'Tea counter',
        items: [{ productId: prod._id, productName: 'Tea Powder', quantity: 2, unit: 'kg', unitPrice: 500 }],
      });
    expect(saleRes.status).toBe(201);

    // Edit description/amount -> stock must NOT deduct again
    const editRes = await request(app)
      .patch(`/api/transactions/${saleRes.body.data.transaction._id}`)
      .set(headers)
      .send({ amount: 1100, description: 'Tea counter updated' });
    expect(editRes.status).toBe(200);

    const refreshedProd = await Product.findById(prod._id);
    expect(refreshedProd.currentStock).toBe(18); // 20 - 2 once only

    const movements = await StockMovement.find({ businessId: business._id, productId: prod._id });
    expect(movements.length).toBe(2); // STOCK_IN (20) + SALE_DEDUCTION (-2)

    const today = new Date().toISOString().split('T')[0];
    const listRes = await request(app)
      .get(`/api/transactions?type=SALE&startDate=${today}&endDate=${today}&search=updated`)
      .set(headers);
    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(1);
  });
});

