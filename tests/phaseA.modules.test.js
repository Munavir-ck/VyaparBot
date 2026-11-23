import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { authService } from '../src/modules/auth/auth.service.js';
import { Business } from '../src/modules/businesses/business.model.js';
import { BusinessMember, ROLE_DEFAULT_PERMISSIONS } from '../src/modules/business-members/business-member.model.js';
import { User } from '../src/modules/users/user.model.js';
import { Subscription } from '../src/modules/subscriptions/subscription.model.js';
import { resolveBusinessModules } from '../src/modules/businesses/business-modules.config.js';

async function createOnboardedUser(phone, onboardBody) {
  const user = await User.create({
    whatsappNumber: phone,
    name: 'Module Owner',
    role: 'OWNER',
    status: 'ACTIVE',
  });
  const token = authService.signSessionToken({
    userId: String(user._id),
    phone: user.whatsappNumber,
    tokenVersion: 0,
  });

  const res = await request(app)
    .post('/api/business/onboard')
    .set('Authorization', `Bearer ${token}`)
    .send(onboardBody);

  return { user, token, onboardRes: res };
}

describe('Phase A: Dynamic Module Configuration & Backend Enforcement', () => {
  it('enforces Finance always enabled and rejects disabling finance', async () => {
    const { token, onboardRes } = await createOnboardedUser('919811000001', {
      name: 'Solo Freelancer',
      businessType: 'FREELANCER',
      modules: { inventory: false, purchases: false, customers: false },
    });
    expect(onboardRes.status).toBe(201);
    expect(onboardRes.body.data.modules).toEqual({
      finance: { enabled: true },
      inventory: { enabled: false },
      purchases: { enabled: false },
      customers: { enabled: false },
    });

    const disableAttempt = await request(app)
      .patch('/api/business/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ modules: { finance: false } });
    expect(disableAttempt.status).toBe(400);
    expect(disableAttempt.body.code).toBe('CORE_MODULE_REQUIRED');

    const badOnboard = await createOnboardedUser('919811000002', {
      name: 'Bad Biz',
      businessType: 'SERVICE',
      modules: { finance: { enabled: false } },
    });
    expect(badOnboard.onboardRes.status).toBe(400);
    expect(badOnboard.onboardRes.body.code).toBe('CORE_MODULE_REQUIRED');
  });

  it('allows Finance-only business to use core finance APIs while blocking disabled modules with 403 MODULE_DISABLED', async () => {
    const { token } = await createOnboardedUser('919811000003', {
      name: 'Finance Only Consultancy',
      businessType: 'SERVICE',
      modules: { inventory: false, purchases: false, customers: false },
    });

    // Core finance allowed
    const saleRes = await request(app)
      .post('/api/transactions/sale')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 5000, paymentMethod: 'UPI' });
    expect(saleRes.status).toBe(201);

    const expRes = await request(app)
      .post('/api/transactions/expense')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 500, category: 'ELECTRICITY', paymentMethod: 'CASH' });
    expect(expRes.status).toBe(201);

    const dailyRes = await request(app)
      .get('/api/reports/daily')
      .set('Authorization', `Bearer ${token}`);
    expect(dailyRes.status).toBe(200);

    // Optional modules blocked
    const blockedEndpoints = [
      request(app).get('/api/inventory/products').set('Authorization', `Bearer ${token}`),
      request(app).post('/api/inventory/products').set('Authorization', `Bearer ${token}`).send({ name: 'Pen' }),
      request(app).get('/api/suppliers').set('Authorization', `Bearer ${token}`),
      request(app).post('/api/transactions/purchase').set('Authorization', `Bearer ${token}`).send({ amount: 1000, merchantOrSupplier: 'S1' }),
      request(app).get('/api/customers').set('Authorization', `Bearer ${token}`),
      request(app).get('/api/reports/inventory').set('Authorization', `Bearer ${token}`),
      request(app).get('/api/reports/receivables').set('Authorization', `Bearer ${token}`),
      request(app).get('/api/reports/payables').set('Authorization', `Bearer ${token}`),
    ];

    const responses = await Promise.all(blockedEndpoints);
    for (const r of responses) {
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('MODULE_DISABLED');
    }
  });

  it('supports Finance + Inventory only, Finance + Purchases only, Finance + Customers only, and multiple modules', async () => {
    const invOnly = await createOnboardedUser('919811000004', {
      name: 'Inv Only',
      businessType: 'RETAIL',
      modules: { inventory: true, purchases: false, customers: false },
    });
    expect((await request(app).get('/api/inventory/products').set('Authorization', `Bearer ${invOnly.token}`)).status).toBe(200);
    expect((await request(app).get('/api/suppliers').set('Authorization', `Bearer ${invOnly.token}`)).status).toBe(403);
    expect((await request(app).get('/api/customers').set('Authorization', `Bearer ${invOnly.token}`)).status).toBe(403);

    const purOnly = await createOnboardedUser('919811000005', {
      name: 'Purchases Only',
      businessType: 'GENERAL',
      modules: { inventory: false, purchases: true, customers: false },
    });
    expect((await request(app).get('/api/suppliers').set('Authorization', `Bearer ${purOnly.token}`)).status).toBe(200);
    expect((await request(app).get('/api/inventory/products').set('Authorization', `Bearer ${purOnly.token}`)).status).toBe(403);
    expect((await request(app).get('/api/customers').set('Authorization', `Bearer ${purOnly.token}`)).status).toBe(403);

    const custOnly = await createOnboardedUser('919811000006', {
      name: 'Customers Only',
      businessType: 'SERVICE',
      modules: { inventory: false, purchases: false, customers: true },
    });
    expect((await request(app).get('/api/customers').set('Authorization', `Bearer ${custOnly.token}`)).status).toBe(200);
    expect((await request(app).get('/api/reports/receivables').set('Authorization', `Bearer ${custOnly.token}`)).status).toBe(200);
    expect((await request(app).get('/api/inventory/products').set('Authorization', `Bearer ${custOnly.token}`)).status).toBe(403);
    expect((await request(app).get('/api/suppliers').set('Authorization', `Bearer ${custOnly.token}`)).status).toBe(403);
  });

  it('preserves backward compatibility for legacy businesses without settings.modules and legacy enabledModules', async () => {
    const legacyBiz = {
      settings: {
        enabledModules: { moneyManagement: true, inventoryManagement: true },
      },
    };
    expect(resolveBusinessModules(legacyBiz)).toEqual({
      finance: { enabled: true },
      inventory: { enabled: true },
      purchases: { enabled: true },
      customers: { enabled: true },
    });

    const legacyNoInv = {
      settings: {
        enabledModules: { moneyManagement: true, inventoryManagement: false },
      },
    };
    expect(resolveBusinessModules(legacyNoInv)).toEqual({
      finance: { enabled: true },
      inventory: { enabled: false },
      purchases: { enabled: true },
      customers: { enabled: true },
    });

    const emptySettingsBiz = {};
    expect(resolveBusinessModules(emptySettingsBiz)).toEqual({
      finance: { enabled: true },
      inventory: { enabled: true },
      purchases: { enabled: true },
      customers: { enabled: true },
    });
  });

  it('enforces cross-business module isolation and rejects unauthorized module changes', async () => {
    const bizA = await createOnboardedUser('919811000007', {
      name: 'Biz A',
      businessType: 'RETAIL',
      modules: { inventory: true, purchases: true, customers: true },
    });
    const bizB = await createOnboardedUser('919811000008', {
      name: 'Biz B',
      businessType: 'SERVICE',
      modules: { inventory: false, purchases: false, customers: false },
    });

    // Biz A can access inventory, Biz B cannot
    expect((await request(app).get('/api/inventory/products').set('Authorization', `Bearer ${bizA.token}`)).status).toBe(200);
    expect((await request(app).get('/api/inventory/products').set('Authorization', `Bearer ${bizB.token}`)).status).toBe(403);

    // Add CASHIER member to Biz B and verify CASHIER cannot enable modules
    const cashier = await User.create({
      whatsappNumber: '919811000009',
      name: 'Cashier B',
      role: 'OWNER',
      status: 'ACTIVE',
    });
    await BusinessMember.create({
      businessId: bizB.onboardRes.body.data.business._id,
      userId: cashier._id,
      role: 'CASHIER',
      permissions: [...ROLE_DEFAULT_PERMISSIONS.CASHIER],
      status: 'ACTIVE',
    });
    const cashierToken = authService.signSessionToken({
      userId: String(cashier._id),
      phone: cashier.whatsappNumber,
      tokenVersion: 0,
    });

    const unauthUpdate = await request(app)
      .patch('/api/business/modules')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ modules: { inventory: true } });
    expect(unauthUpdate.status).toBe(403);
  });

  it('audits module enable/disable changes and preserves historical transactions when disabling a module', async () => {
    const { user, token } = await createOnboardedUser('919811000010', {
      name: 'Audit Kitchen',
      businessType: 'RESTAURANT',
      modules: { inventory: true, purchases: true, customers: true },
    });

    // Record a supplier purchase while purchases is enabled
    const purchaseRes = await request(app)
      .post('/api/transactions/purchase')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 2500, merchantOrSupplier: 'Fresh Farms' });
    expect(purchaseRes.status).toBe(201);

    // Disable purchases with reason
    const toggleRes = await request(app)
      .patch('/api/business/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ modules: { purchases: false }, reason: 'Switched to cash expenses only' });
    expect(toggleRes.status).toBe(200);
    expect(toggleRes.body.data.modules.purchases.enabled).toBe(false);
    expect(toggleRes.body.data.changes).toHaveLength(1);
    expect(toggleRes.body.data.changes[0]).toMatchObject({
      moduleKey: 'purchases',
      previousEnabled: true,
      nextEnabled: false,
      reason: 'Switched to cash expenses only',
    });

    const updatedBiz = await Business.findById(toggleRes.body.data.business._id);
    expect(updatedBiz.settings.moduleAuditLog).toHaveLength(1);
    expect(String(updatedBiz.settings.moduleAuditLog[0].changedBy)).toBe(String(user._id));

    // Historical purchase transaction still exists in finance transaction history
    const txList = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(txList.status).toBe(200);
    expect(txList.body.data.some((t) => t.type === 'PURCHASE' && t.amount === 2500)).toBe(true);

    // New supplier API access is now blocked
    const supRes = await request(app)
      .get('/api/suppliers')
      .set('Authorization', `Bearer ${token}`);
    expect(supRes.status).toBe(403);
    expect(supRes.body.code).toBe('MODULE_DISABLED');
  });
});
