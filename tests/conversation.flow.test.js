import { describe, it, expect } from 'vitest';
import { conversationService } from '../src/modules/conversations/conversation.service.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { Transaction } from '../src/modules/transactions/transaction.model.js';
import { Supplier } from '../src/modules/suppliers/supplier.model.js';

describe('Restaurant Conversational Workflows (E2E Conversation Flow)', () => {
  const restaurantPhone = '919876543299';
  const ownerName = 'Malabar Delights';

  it('1. Records Sales with Cash and UPI breakdown via natural language', async () => {
    await conversationService.handleIncomingMessage(
      restaurantPhone,
      "Today's sales 12500. Cash 7500 and UPI 5000.",
      null,
      ownerName,
    );

    const { business } = await businessService.resolveBusinessForUser(restaurantPhone);
    const sale = await Transaction.findOne({ businessId: business._id, type: 'SALE' });

    expect(sale).toBeTruthy();
    expect(sale.amount).toBe(12500);
    expect(sale.paymentBreakdown.cash).toBe(7500);
    expect(sale.paymentBreakdown.upi).toBe(5000);
  });

  it('2. Records Expense in Manglish ("Innu vegetables vangiyathu 850 rupa")', async () => {
    await conversationService.handleIncomingMessage(
      restaurantPhone,
      'Innu vegetables vangiyathu 850 rupa',
      null,
      ownerName,
    );

    const { business } = await businessService.resolveBusinessForUser(restaurantPhone);
    const expense = await Transaction.findOne({
      businessId: business._id,
      type: 'EXPENSE',
      category: 'VEGETABLES',
    });

    expect(expense).toBeTruthy();
    expect(expense.amount).toBe(850);
  });

  it('3. Records Supplier Credit Purchase ("Bought meat from Majeed on credit 4500")', async () => {
    await conversationService.handleIncomingMessage(
      restaurantPhone,
      'Bought meat from Majeed on credit 4500',
      null,
      ownerName,
    );

    const { business } = await businessService.resolveBusinessForUser(restaurantPhone);
    const supplier = await Supplier.findOne({
      businessId: business._id,
      normalizedName: 'majeed',
    });

    expect(supplier).toBeTruthy();
    expect(supplier.totalPurchases).toBe(4500);
    expect(supplier.outstandingBalance).toBe(4500);
  });

  it('4. Records Supplier Payment ("Paid 2000 to supplier Majeed via UPI")', async () => {
    // Record initial purchase
    await conversationService.handleIncomingMessage(
      restaurantPhone,
      'Bought meat from Majeed on credit 4500',
      null,
      ownerName,
    );

    await conversationService.handleIncomingMessage(
      restaurantPhone,
      'Paid 2000 to supplier Majeed via UPI',
      null,
      ownerName,
    );

    const { business } = await businessService.resolveBusinessForUser(restaurantPhone);
    const supplier = await Supplier.findOne({
      businessId: business._id,
      normalizedName: 'majeed',
    });

    expect(supplier.totalPayments).toBe(2000);
    expect(supplier.outstandingBalance).toBe(2500); // 4500 - 2000
  });

  it('5. Edits last transaction amount ("Change amount to 950")', async () => {
    // Record initial expense
    await conversationService.handleIncomingMessage(
      restaurantPhone,
      'Innu vegetables vangiyathu 850 rupa',
      null,
      ownerName,
    );

    const { business } = await businessService.resolveBusinessForUser(restaurantPhone);
    const vegBefore = await Transaction.findOne({
      businessId: business._id,
      category: 'VEGETABLES',
    });
    expect(vegBefore.amount).toBe(850);

    await conversationService.handleIncomingMessage(
      restaurantPhone,
      'Change amount to 950',
      null,
      ownerName,
    );

    const vegAfter = await Transaction.findById(vegBefore._id);
    expect(vegAfter.amount).toBe(950);
  });

  it('6. Voids last transaction safely ("Delete last entry")', async () => {
    // Record initial expense
    await conversationService.handleIncomingMessage(
      restaurantPhone,
      'Innu vegetables vangiyathu 850 rupa',
      null,
      ownerName,
    );

    const { business } = await businessService.resolveBusinessForUser(restaurantPhone);
    const lastActiveBefore = await Transaction.findOne({
      businessId: business._id,
      status: 'COMPLETED',
    }).sort({ createdAt: -1 });

    await conversationService.handleIncomingMessage(
      restaurantPhone,
      'Delete last entry',
      null,
      ownerName,
    );

    const check = await Transaction.findById(lastActiveBefore._id);
    expect(check.status).toBe('VOIDED');
  });

  it('7. Handles incomplete details with clarification follow-up', async () => {
    // Send expense with missing amount: "Innu vegetables vangi"
    await conversationService.handleIncomingMessage(
      restaurantPhone,
      'Innu vegetables vangi',
      null,
      ownerName,
    );

    // Follow up with just the amount: "650"
    await conversationService.handleIncomingMessage(
      restaurantPhone,
      '650',
      null,
      ownerName,
    );

    const { business } = await businessService.resolveBusinessForUser(restaurantPhone);
    const completed = await Transaction.findOne({
      businessId: business._id,
      amount: 650,
      category: 'VEGETABLES',
    });

    expect(completed).toBeTruthy();
  });
});
