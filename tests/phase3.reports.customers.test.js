import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { transactionService } from '../src/modules/transactions/transaction.service.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';

describe('Phase 3: Customer APIs, Supplier Extensions & Financial/Inventory Reports', () => {
  describe('1. Customer Management APIs & Business Isolation', () => {
    it('creates, searches, updates customers, tracks credit sales and records payments via HTTP', async () => {
      const headers = { 'x-user-phone': '919666111222' };

      // Create customer
      const createRes = await request(app)
        .post('/api/customers')
        .set(headers)
        .send({ name: 'Arun Menon', phone: '9847011223', notes: 'Regular credit customer' });
      expect(createRes.status).toBe(201);
      const customerId = createRes.body.data._id;

      // Search customer
      const searchRes = await request(app)
        .get('/api/customers?search=Arun')
        .set(headers);
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.count).toBe(1);
      expect(searchRes.body.data[0].name).toBe('Arun Menon');

      // Update customer
      const patchRes = await request(app)
        .patch(`/api/customers/${customerId}`)
        .set(headers)
        .send({ notes: 'VIP wholesale buyer' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.notes).toBe('VIP wholesale buyer');

      // Record credit sale to customer
      const { business, user } = await businessService.resolveBusinessForUser('919666111222');
      await transactionService.recordSale({
        businessId: business._id,
        amount: 5000,
        paymentMethod: 'CREDIT',
        customerName: 'Arun Menon',
        createdBy: user._id,
      });

      // Record partial payment via API
      const payRes = await request(app)
        .post(`/api/customers/${customerId}/payments`)
        .set(headers)
        .send({ amount: 2000, paymentMethod: 'UPI', notes: 'First installment' });
      expect(payRes.status).toBe(201);
      expect(payRes.body.data.customer.outstandingBalance).toBe(3000);

      // View payment history
      const histRes = await request(app)
        .get(`/api/customers/${customerId}/payments`)
        .set(headers);
      expect(histRes.status).toBe(200);
      expect(histRes.body.count).toBe(1);
      expect(histRes.body.data[0].amount).toBe(2000);

      // View ledger & summary
      const ledgerRes = await request(app)
        .get(`/api/customers/${customerId}/ledger`)
        .set(headers);
      expect(ledgerRes.status).toBe(200);
      expect(ledgerRes.body.data.summary.totalCreditSales).toBe(5000);
      expect(ledgerRes.body.data.summary.totalPaymentsReceived).toBe(2000);
      expect(ledgerRes.body.data.summary.outstandingBalance).toBe(3000);

      // Tenant isolation: another business cannot access Arun Menon
      const otherHeaders = { 'x-user-phone': '919666999888' };
      const isolatedRes = await request(app)
        .get(`/api/customers/${customerId}`)
        .set(otherHeaders);
      expect(isolatedRes.status).toBe(404);
    });
  });

  describe('2. Supplier Management Extensions', () => {
    it('tracks supplier purchase history, payment history, and summary via HTTP', async () => {
      const headers = { 'x-user-phone': '919777111222' };
      const { business, user } = await businessService.resolveBusinessForUser('919777111222');

      const purchase = await transactionService.recordPurchase({
        businessId: business._id,
        amount: 6000,
        paymentMethod: 'CREDIT',
        merchantOrSupplier: 'Malabar Spices',
        createdBy: user._id,
      });
      const supplierId = purchase.supplier._id;

      // Record payment via Supplier REST API
      const payRes = await request(app)
        .post(`/api/suppliers/${supplierId}/payments`)
        .set(headers)
        .send({ amount: 2500, paymentMethod: 'BANK_TRANSFER', notes: 'NEFT ref 9988' });
      expect(payRes.status).toBe(201);
      expect(payRes.body.data.supplier.outstandingBalance).toBe(3500);

      // Purchase history
      const purHist = await request(app)
        .get(`/api/suppliers/${supplierId}/purchases`)
        .set(headers);
      expect(purHist.status).toBe(200);
      expect(purHist.body.count).toBe(1);

      // Payment history
      const payHist = await request(app)
        .get(`/api/suppliers/${supplierId}/payments`)
        .set(headers);
      expect(payHist.status).toBe(200);
      expect(payHist.body.count).toBe(1);
      expect(payHist.body.data[0].amount).toBe(2500);

      // Supplier summary
      const detailRes = await request(app)
        .get(`/api/suppliers/${supplierId}`)
        .set(headers);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.summary.totalPurchases).toBe(6000);
      expect(detailRes.body.data.summary.totalPayments).toBe(2500);
      expect(detailRes.body.data.summary.outstandingBalance).toBe(3500);
    });
  });

  describe('3. Extended Financial & Inventory Reports', () => {
    it('computes weekly, cash flow, receivables, payables, and inventory reports accurately', async () => {
      const headers = { 'x-user-phone': '919888111222' };
      const { business, user } = await businessService.resolveBusinessForUser('919888111222', 'Kochi Mart', {
        businessType: 'GROCERY',
      });

      // 1. Cash + UPI sale: 10,000 (Cash 6000, UPI 4000)
      await transactionService.recordSale({
        businessId: business._id,
        amount: 10000,
        paymentBreakdown: { cash: 6000, upi: 4000 },
        createdBy: user._id,
      });

      // 2. Credit sale to Customer: 3,000 (does NOT enter cash flow until paid)
      await transactionService.recordSale({
        businessId: business._id,
        amount: 3000,
        paymentMethod: 'CREDIT',
        customerName: 'Suresh',
        createdBy: user._id,
      });

      // 3. Customer pays 1,000 in Cash
      await request(app)
        .post('/api/customers')
        .set(headers)
        .send({ name: 'Suresh' });
      const custRes = await request(app).get('/api/customers?search=Suresh').set(headers);
      const sureshId = custRes.body.data[0]._id;
      await request(app)
        .post(`/api/customers/${sureshId}/payments`)
        .set(headers)
        .send({ amount: 1000, paymentMethod: 'CASH' });

      // 4. Operating Expense: 1,500 in Cash
      await transactionService.recordExpense({
        businessId: business._id,
        amount: 1500,
        category: 'ELECTRICITY',
        paymentMethod: 'CASH',
        createdBy: user._id,
      });

      // 5. Credit Purchase from Supplier: 4,000 + Supplier Payment of 1,200 via UPI
      await transactionService.recordPurchase({
        businessId: business._id,
        amount: 4000,
        paymentMethod: 'CREDIT',
        merchantOrSupplier: 'Kochi Wholesale',
        createdBy: user._id,
      });
      await transactionService.recordSupplierPayment({
        businessId: business._id,
        amount: 1200,
        paymentMethod: 'UPI',
        merchantOrSupplier: 'Kochi Wholesale',
        createdBy: user._id,
      });

      // 6. Inventory product + wastage
      const rice = await inventoryService.createOrUpdateProduct({
        businessId: business._id,
        name: 'Jaya Rice',
        unit: 'kg',
        minStockLevel: 20,
        costPrice: 50,
        initialStock: 25,
        createdBy: user._id,
      });
      await inventoryService.recordWastageOrDamage({
        businessId: business._id,
        productId: rice._id,
        quantity: 6,
        reason: 'Damaged sack',
        createdBy: user._id,
      });

      // Weekly Report
      const weeklyRes = await request(app).get('/api/reports/weekly').set(headers);
      expect(weeklyRes.status).toBe(200);
      const w = weeklyRes.body.data;
      expect(w.totalSales).toBe(13000); // 10000 + 3000
      expect(w.cashSales).toBe(6000);
      expect(w.upiSales).toBe(4000);
      expect(w.creditSales).toBe(3000);
      expect(w.totalExpenses).toBe(1500); // Supplier payment 1200 NOT counted as expense!
      expect(w.supplierPurchases).toBe(4000);
      expect(w.paymentsReceived).toBe(1000);
      expect(w.paymentsMade).toBe(1200);
      expect(w.recordedOperatingSurplus).toBe(11500); // 13000 - 1500

      // Cash Flow Report (with explicit opening balances: Cash 5000, Bank/UPI 10000)
      const cfRes = await request(app)
        .get('/api/reports/cash-flow?openingCash=5000&openingBankUpi=10000')
        .set(headers);
      expect(cfRes.status).toBe(200);
      const cf = cfRes.body.data;
      // Cash inflows: 6000 (sale) + 1000 (customer payment) = 7000; Cash outflows: 1500 (expense)
      expect(cf.cash.inflows).toBe(7000);
      expect(cf.cash.outflows).toBe(1500);
      expect(cf.cash.closingBalance).toBe(10500); // 5000 + 7000 - 1500
      // Bank/UPI inflows: 4000 (sale); Bank/UPI outflows: 1200 (supplier payment)
      expect(cf.bankAndUpi.inflows).toBe(4000);
      expect(cf.bankAndUpi.outflows).toBe(1200);
      expect(cf.bankAndUpi.closingBalance).toBe(12800); // 10000 + 4000 - 1200

      // Receivables Report
      const recRes = await request(app).get('/api/reports/receivables').set(headers);
      expect(recRes.status).toBe(200);
      expect(recRes.body.data.totalReceivables).toBe(2000); // 3000 - 1000
      expect(recRes.body.data.paymentHistory.length).toBe(1);

      // Payables Report
      const payRepRes = await request(app).get('/api/reports/payables').set(headers);
      expect(payRepRes.status).toBe(200);
      expect(payRepRes.body.data.totalPayables).toBe(2800); // 4000 - 1200
      expect(payRepRes.body.data.paymentHistory.length).toBe(1);

      // Inventory Report
      const invRes = await request(app).get('/api/reports/inventory').set(headers);
      expect(invRes.status).toBe(200);
      expect(invRes.body.data.lowStockCount).toBe(1); // 19 <= 20
      expect(invRes.body.data.valuation.totalValue).toBe(950); // 19 * 50
      expect(invRes.body.data.movementSummaryByType.STOCK_IN.totalQuantity).toBe(25);
      expect(invRes.body.data.movementSummaryByType.WASTAGE.totalQuantity).toBe(6);
    });
  });
});

