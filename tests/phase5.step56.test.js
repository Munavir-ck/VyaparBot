import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { User } from '../src/modules/users/user.model.js';
import {
  BusinessMember,
  ROLE_DEFAULT_PERMISSIONS,
} from '../src/modules/business-members/business-member.model.js';

describe('Phase 5 (Step 5.6): Reports, Business Settings & Team Management', () => {
  it('computes financial summary and cash-flow reports accurately across date ranges', async () => {
    const phone = '919888111001';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Step 5.6 Cafe');

    // Prior day transaction (to test cash-flow opening balance)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 1000, paymentMethod: 'CASH', transactionDate: yesterday });

    // Today: Cash Sale (2000), UPI Sale (1500), Credit Sale (500) -> Total Sales = 4000
    await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 2000, paymentMethod: 'CASH', transactionDate: today });

    await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 1500, paymentMethod: 'UPI', transactionDate: today });

    await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 500, paymentMethod: 'CREDIT', customerName: 'Raju', transactionDate: today });

    // Today: Operating Expense (600 CASH) + Credit Purchase (1200) + Supplier Payment (400 UPI)
    await request(app)
      .post('/api/transactions/expense')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 600, category: 'UTILITIES', paymentMethod: 'CASH', transactionDate: today });

    const purRes = await request(app)
      .post('/api/transactions/purchase')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        amount: 1200,
        paymentMethod: 'CREDIT',
        merchantOrSupplier: 'Fresh Farms',
        transactionDate: today,
      });

    await request(app)
      .post(`/api/suppliers/${purRes.body.data.supplier._id}/payments`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 400, paymentMethod: 'UPI', transactionDate: today });

    // Custom date-range summary for today
    const summaryRes = await request(app)
      .get(`/api/reports/summary?startDate=${today}&endDate=${today}`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.data.totalSales).toBe(4000);
    expect(summaryRes.body.data.cashSales).toBe(2000);
    expect(summaryRes.body.data.upiSales).toBe(1500);
    expect(summaryRes.body.data.creditSales).toBe(500);
    expect(summaryRes.body.data.totalExpenses).toBe(600); // Supplier payment NOT counted as expense
    expect(summaryRes.body.data.supplierPurchases).toBe(1200);
    expect(summaryRes.body.data.paymentsMade).toBe(400);
    expect(summaryRes.body.data.recordedOperatingSurplus).toBe(3400);

    // Cash flow for today: openingCash = 1000, cashIn = 2000, cashOut = 600 -> closingCash = 2400
    // bankAndUpi: opening = 0, in = 1500, out = 400 -> closing = 1100
    const cfRes = await request(app)
      .get(`/api/reports/cash-flow?startDate=${today}&endDate=${today}`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));

    expect(cfRes.status).toBe(200);
    expect(cfRes.body.data.cash.openingBalance).toBe(1000);
    expect(cfRes.body.data.cash.inflows).toBe(2000);
    expect(cfRes.body.data.cash.outflows).toBe(600);
    expect(cfRes.body.data.cash.closingBalance).toBe(2400);
    expect(cfRes.body.data.bankAndUpi.inflows).toBe(1500);
    expect(cfRes.body.data.bankAndUpi.outflows).toBe(400);
    expect(cfRes.body.data.bankAndUpi.closingBalance).toBe(1100);
    expect(cfRes.body.data.totalClosingBalance).toBe(3500);
  });

  it('maintains inventory valuation and report consistency with category and date filters', async () => {
    const phone = '919888111002';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Step 5.6 Mart');

    const p1 = await request(app)
      .post('/api/inventory/products')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ name: 'Tea Leaves', category: 'Beverages', unit: 'kg', initialStock: 10, minStockLevel: 5, costPrice: 200 });
    const teaId = p1.body.data._id;

    await request(app)
      .post('/api/inventory/products')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ name: 'Bread', category: 'Bakery', unit: 'pack', initialStock: 0, minStockLevel: 4, costPrice: 30 });

    await request(app)
      .post('/api/inventory/wastage')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ productId: teaId, quantity: 2, type: 'WASTAGE', reason: 'Moisture' });

    const invRes = await request(app)
      .get('/api/reports/inventory?category=Beverages')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));

    expect(invRes.status).toBe(200);
    expect(invRes.body.data.currentStock.length).toBe(1);
    expect(invRes.body.data.currentStock[0].stockValue).toBe(8 * 200);
    expect(invRes.body.data.movementSummaryByType.WASTAGE.totalQuantity).toBe(2);
    expect(invRes.body.data.valuation.outOfStockCount).toBe(1);
  });

  it('enforces RBAC, self-escalation protection, owner protection, and cross-business isolation for settings & team', async () => {
    const ownerPhone = '919888111003';
    const otherOwnerPhone = '919888111004';
    const staffPhone = '919888111005';

    const { business: bizA } = await businessService.resolveBusinessForUser(ownerPhone, 'Biz A');
    const { business: bizB } = await businessService.resolveBusinessForUser(otherOwnerPhone, 'Biz B');

    // Update business settings as OWNER
    const patchBiz = await request(app)
      .patch('/api/business')
      .set('x-user-phone', ownerPhone)
      .set('x-business-id', String(bizA._id))
      .send({
        name: 'Biz A Updated',
        businessType: 'GROCERY',
        currency: 'AED',
        timezone: 'Asia/Dubai',
        settings: {
          inventory: { allowNegativeStock: true },
          customExpenseCategories: ['PACKAGING'],
        },
      });
    expect(patchBiz.status).toBe(200);
    expect(patchBiz.body.data.business.name).toBe('Biz A Updated');
    expect(patchBiz.body.data.business.currency).toBe('AED');
    expect(patchBiz.body.data.business.settings.inventory.allowNegativeStock).toBe(true);

    // Add team member as OWNER
    const addMember = await request(app)
      .post('/api/business/members')
      .set('x-user-phone', ownerPhone)
      .set('x-business-id', String(bizA._id))
      .send({
        whatsappNumber: staffPhone,
        name: 'Salim',
        role: 'CASHIER',
      });
    expect(addMember.status).toBe(201);
    const memberId = addMember.body.data._id;

    // Unauthorized CASHIER cannot update business settings or list members
    const cashierPatchBiz = await request(app)
      .patch('/api/business')
      .set('x-user-phone', staffPhone)
      .set('x-business-id', String(bizA._id))
      .send({ name: 'Unauthorized Rename' });
    expect(cashierPatchBiz.status).toBe(403);

    const cashierListMembers = await request(app)
      .get('/api/business/members')
      .set('x-user-phone', staffPhone)
      .set('x-business-id', String(bizA._id));
    expect(cashierListMembers.status).toBe(403);

    // Grant MANAGE_MEMBERS to staff and verify self-privilege-escalation is blocked
    const grantManage = await request(app)
      .patch(`/api/business/members/${memberId}`)
      .set('x-user-phone', ownerPhone)
      .set('x-business-id', String(bizA._id))
      .send({
        role: 'MANAGER',
        permissions: ['MANAGE_MEMBERS', 'VIEW_INVENTORY'],
      });
    expect(grantManage.status).toBe(200);

    const selfEscalate = await request(app)
      .patch(`/api/business/members/${memberId}`)
      .set('x-user-phone', staffPhone)
      .set('x-business-id', String(bizA._id))
      .send({
        permissions: ['MANAGE_MEMBERS', 'VOID_TRANSACTIONS', 'EDIT_TRANSACTIONS'],
      });
    expect(selfEscalate.status).toBe(403);

    // Owner cannot be demoted or revoked
    const membersList = await request(app)
      .get('/api/business/members')
      .set('x-user-phone', ownerPhone)
      .set('x-business-id', String(bizA._id));
    const ownerMember = membersList.body.data.find((m) => m.role === 'OWNER');

    const demoteOwner = await request(app)
      .patch(`/api/business/members/${ownerMember._id}`)
      .set('x-user-phone', ownerPhone)
      .set('x-business-id', String(bizA._id))
      .send({ role: 'MANAGER' });
    expect(demoteOwner.status).toBe(400);

    const revokeOwner = await request(app)
      .delete(`/api/business/members/${ownerMember._id}`)
      .set('x-user-phone', ownerPhone)
      .set('x-business-id', String(bizA._id));
    expect(revokeOwner.status).toBe(400);

    // Cross-business isolation: Biz B cannot modify Biz A's member
    const crossPatchMember = await request(app)
      .patch(`/api/business/members/${memberId}`)
      .set('x-user-phone', otherOwnerPhone)
      .set('x-business-id', String(bizB._id))
      .send({ role: 'STAFF' });
    expect(crossPatchMember.status).toBe(404);

    // Owner can revoke non-owner member
    const revokeMember = await request(app)
      .delete(`/api/business/members/${memberId}`)
      .set('x-user-phone', ownerPhone)
      .set('x-business-id', String(bizA._id));
    expect(revokeMember.status).toBe(200);
  });
});
