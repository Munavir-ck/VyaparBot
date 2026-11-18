import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { transactionService } from '../src/modules/transactions/transaction.service.js';
import { supplierService } from '../src/modules/suppliers/supplier.service.js';
import { reportService } from '../src/modules/reports/report.service.js';
import { Transaction } from '../src/modules/transactions/transaction.model.js';
import { Supplier } from '../src/modules/suppliers/supplier.model.js';

describe('Restaurant Accounting & Financial Management Engine', () => {
  const businessId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  describe('A. Sales Management & Double-Count Prevention', () => {
    it('records total sales with breakdown without double-counting (12500 = Cash 7500 + UPI 5000)', async () => {
      const res = await transactionService.recordSale({
        businessId,
        amount: 12500,
        paymentBreakdown: { cash: 7500, upi: 5000 },
        salePeriod: 'FULL_DAY',
        createdBy: userId,
      });

      expect(res.success).toBe(true);
      expect(res.transaction.amount).toBe(12500);
      expect(res.transaction.paymentBreakdown.cash).toBe(7500);
      expect(res.transaction.paymentBreakdown.upi).toBe(5000);
      expect(res.transaction.paymentMethod).toBe('SPLIT');

      // Verify in DB
      const saved = await Transaction.findById(res.transaction._id);
      expect(saved.amount).toBe(12500);
    });

    it('derives total amount automatically when only breakdown is provided (Cash 2500 + UPI 1500 = 4000)', async () => {
      const res = await transactionService.recordSale({
        businessId,
        amount: null,
        paymentBreakdown: { cash: 2500, upi: 1500 },
        salePeriod: 'EVENING',
        createdBy: userId,
      });

      expect(res.success).toBe(true);
      expect(res.transaction.amount).toBe(4000);
      expect(res.transaction.paymentBreakdown.cash).toBe(2500);
      expect(res.transaction.paymentBreakdown.upi).toBe(1500);
    });

    it('tracks morning, afternoon, and evening sales periods separately', async () => {
      const morning = await transactionService.recordSale({
        businessId,
        amount: 3500,
        salePeriod: 'MORNING',
        paymentMethod: 'CASH',
        createdBy: userId,
      });

      const evening = await transactionService.recordSale({
        businessId,
        amount: 8000,
        salePeriod: 'EVENING',
        paymentMethod: 'UPI',
        createdBy: userId,
      });

      expect(morning.transaction.category).toBe('MORNING_SALES');
      expect(evening.transaction.category).toBe('EVENING_SALES');
    });
  });

  describe('B. Expense Management Across Categories', () => {
    it('records expenses in standard restaurant categories', async () => {
      const veg = await transactionService.recordExpense({
        businessId,
        amount: 850,
        category: 'VEGETABLES',
        paymentMethod: 'CASH',
        createdBy: userId,
      });

      const meat = await transactionService.recordExpense({
        businessId,
        amount: 1400,
        category: 'MEAT_FISH',
        paymentMethod: 'UPI',
        createdBy: userId,
      });

      const gas = await transactionService.recordExpense({
        businessId,
        amount: 1200,
        category: 'GAS',
        paymentMethod: 'CASH',
        createdBy: userId,
      });

      expect(veg.transaction.category).toBe('VEGETABLES');
      expect(veg.transaction.amount).toBe(850);
      expect(meat.transaction.category).toBe('MEAT_FISH');
      expect(gas.transaction.category).toBe('GAS');
    });
  });

  describe('C. Transaction Editing & Voiding with Audit History', () => {
    it('edits a transaction amount and stores audit trail', async () => {
      const initial = await transactionService.recordExpense({
        businessId,
        amount: 850,
        category: 'VEGETABLES',
        createdBy: userId,
      });

      const edited = await transactionService.editTransaction({
        businessId,
        transactionId: initial.transaction._id,
        updates: { amount: 950 },
        changedBy: userId,
        reason: 'User corrected amount',
      });

      expect(edited.success).toBe(true);
      expect(edited.transaction.amount).toBe(950);
      expect(edited.transaction.auditHistory.length).toBe(2);
      expect(edited.transaction.auditHistory[1].action).toBe('UPDATED');
      expect(edited.transaction.auditHistory[1].previousValues.amount).toBe(850);
      expect(edited.transaction.auditHistory[1].newValues.amount).toBe(950);
    });

    it('voids a transaction safely and records audit reason', async () => {
      const initial = await transactionService.recordExpense({
        businessId,
        amount: 500,
        category: 'OTHER_EXPENSE',
        createdBy: userId,
      });

      const voided = await transactionService.voidTransaction({
        businessId,
        transactionId: initial.transaction._id,
        changedBy: userId,
        reason: 'Duplicate entry',
      });

      expect(voided.success).toBe(true);
      expect(voided.transaction.status).toBe('VOIDED');

      // Voided transactions are not included in active queries
      const activeLast = await transactionService.getLastTransaction(businessId);
      expect(activeLast?._id.toString()).not.toBe(initial.transaction._id.toString());
    });
  });

  describe('D. Supplier Management & Accounting Rule', () => {
    it('records credit purchase, increments supplier liability, and updates ledger', async () => {
      const res = await transactionService.recordPurchase({
        businessId,
        amount: 4500,
        category: 'MEAT_FISH',
        paymentMethod: 'CREDIT',
        merchantOrSupplier: 'Majeed Meat Traders',
        createdBy: userId,
      });

      expect(res.success).toBe(true);
      expect(res.supplier.name).toBe('Majeed Meat Traders');
      expect(res.supplier.totalPurchases).toBe(4500);
      expect(res.supplier.outstandingBalance).toBe(4500);
    });

    it('paying supplier settles outstanding balance without creating a duplicate operational expense', async () => {
      // 1. Initial credit purchase of 4500
      const purchaseRes = await transactionService.recordPurchase({
        businessId,
        amount: 4500,
        paymentMethod: 'CREDIT',
        merchantOrSupplier: 'Faizal Fish Suppliers',
        createdBy: userId,
      });
      expect(purchaseRes.supplier.outstandingBalance).toBe(4500);

      // 2. Pay 2000 towards the outstanding balance
      const paymentRes = await transactionService.recordSupplierPayment({
        businessId,
        amount: 2000,
        paymentMethod: 'UPI',
        merchantOrSupplier: 'Faizal Fish Suppliers',
        createdBy: userId,
      });

      expect(paymentRes.success).toBe(true);
      expect(paymentRes.supplier.totalPayments).toBe(2000);
      expect(paymentRes.supplier.outstandingBalance).toBe(2500); // 4500 - 2000

      // 3. Check Daily Report: Supplier payments are reported under supplier payments,
      // NOT as regular operating expenses to prevent double-counting!
      const report = await reportService.generateDailyReport(businessId, new Date());
      expect(report.totalSupplierPayments).toBeGreaterThanOrEqual(2000);
    });

    it('reverses supplier liability when a credit purchase is voided', async () => {
      const res = await transactionService.recordPurchase({
        businessId,
        amount: 3000,
        paymentMethod: 'CREDIT',
        merchantOrSupplier: 'Rashid Vegetables',
        createdBy: userId,
      });

      expect(res.supplier.outstandingBalance).toBe(3000);

      await transactionService.voidTransaction({
        businessId,
        transactionId: res.transaction._id,
        changedBy: userId,
      });

      const supplier = await Supplier.findById(res.supplier._id);
      expect(supplier.outstandingBalance).toBe(0);
      expect(supplier.totalPurchases).toBe(0);
    });
  });

  describe('E. Deterministic Daily & Monthly Reports', () => {
    it('computes daily report with accurate sales, collections, and operating surplus', async () => {
      const testBizId = new mongoose.Types.ObjectId();

      // Sales: 10,000 total (Cash 6000, UPI 4000)
      await transactionService.recordSale({
        businessId: testBizId,
        amount: 10000,
        paymentBreakdown: { cash: 6000, upi: 4000 },
        createdBy: userId,
      });

      // Expenses: 2000 (Veg 800, Gas 1200)
      await transactionService.recordExpense({
        businessId: testBizId,
        amount: 800,
        category: 'VEGETABLES',
        createdBy: userId,
      });
      await transactionService.recordExpense({
        businessId: testBizId,
        amount: 1200,
        category: 'GAS',
        createdBy: userId,
      });

      const report = await reportService.generateDailyReport(testBizId, new Date());

      expect(report.totalRecordedSales).toBe(10000);
      expect(report.cashCollections).toBe(6000);
      expect(report.upiCollections).toBe(4000);
      expect(report.totalExpenses).toBe(2000);
      expect(report.categoryExpenses.VEGETABLES).toBe(800);
      expect(report.categoryExpenses.GAS).toBe(1200);
      expect(report.recordedOperatingSurplus).toBe(8000); // 10000 - 2000

      // Verify formatted message
      const formatted = reportService.formatDailyReportMessage(report, 'en');
      expect(formatted).toContain('Total Recorded Sales:* ₹10,000');
      expect(formatted).toContain('Cash: ₹6,000');
      expect(formatted).toContain('UPI: ₹4,000');
      expect(formatted).toContain('Recorded Operating Surplus:* ₹8,000');
    });

    it('computes monthly report and month-on-month comparison deterministically', async () => {
      const testBizId = new mongoose.Types.ObjectId();

      await transactionService.recordSale({
        businessId: testBizId,
        amount: 50000,
        paymentBreakdown: { cash: 30000, upi: 20000 },
        createdBy: userId,
      });

      await transactionService.recordExpense({
        businessId: testBizId,
        amount: 15000,
        category: 'GROCERIES',
        createdBy: userId,
      });

      const report = await reportService.generateMonthlyReport(testBizId);

      expect(report.monthlySales).toBe(50000);
      expect(report.cashSales).toBe(30000);
      expect(report.upiSales).toBe(20000);
      expect(report.monthlyExpenses).toBe(15000);
      expect(report.recordedOperatingSurplus).toBe(35000);
    });
  });
});

