import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { User } from '../src/modules/users/user.model.js';
import { Business } from '../src/modules/businesses/business.model.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { Subscription } from '../src/modules/subscriptions/subscription.model.js';
import { SaasPayment } from '../src/modules/subscriptions/saas-payment.model.js';
import { Invoice } from '../src/modules/subscriptions/invoice.model.js';
import { Transaction } from '../src/modules/transactions/transaction.model.js';
import { PaymentRecord } from '../src/modules/payments/payment-record.model.js';
import { conversationService } from '../src/modules/conversations/conversation.service.js';

describe('Phase A1: PLATFORM_ADMIN, 30-Day Pilot, Entitlements, Billing & Grandfathering', () => {
  it('enforces PLATFORM_ADMIN authorization separately from business OWNER', async () => {
    const ownerPhone = '919900111001';
    const adminPhone = '919900111002';

    await businessService.resolveBusinessForUser(ownerPhone, 'Owner Shop');
    await User.create({
      whatsappNumber: adminPhone,
      name: 'Platform Admin',
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
    });

    // Business OWNER cannot access /api/admin/*
    const ownerDenied = await request(app)
      .get('/api/admin/businesses')
      .set('x-user-phone', ownerPhone);
    expect(ownerDenied.status).toBe(403);
    expect(ownerDenied.body.code).toBe('PLATFORM_ADMIN_REQUIRED');

    // PLATFORM_ADMIN can access /api/admin/businesses and /api/admin/plans
    const adminList = await request(app)
      .get('/api/admin/businesses')
      .set('x-user-phone', adminPhone);
    expect(adminList.status).toBe(200);
    expect(adminList.body.count).toBeGreaterThanOrEqual(1);

    const plansRes = await request(app)
      .get('/api/admin/plans')
      .set('x-user-phone', adminPhone);
    expect(plansRes.status).toBe(200);
    expect(plansRes.body.data.some((p) => p.code === 'PILOT')).toBe(true);
  });

  it('enforces 3-business 30-day pilot cap, prevents duplicate grants, and creates zero fake payments', async () => {
    const adminPhone = '919900111010';
    await User.create({
      whatsappNumber: adminPhone,
      name: 'Pilot Admin',
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
    });

    const businesses = [];
    for (let i = 1; i <= 4; i++) {
      const { business } = await businessService.resolveBusinessForUser(
        `91990011110${i}`,
        `Pilot Candidate ${i}`,
      );
      businesses.push(business);
    }

    // Grant pilot to first 3 businesses
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post(`/api/admin/subscriptions/${businesses[i]._id}/grant-pilot`)
        .set('x-user-phone', adminPhone)
        .send({ reason: `Pilot shop #${i + 1}` });
      expect(res.status).toBe(200);
      expect(res.body.data.subscription.status).toBe('TRIALING');
      expect(res.body.data.subscription.activationSource).toBe('MANUAL_PILOT');
      expect(res.body.data.subscription.isComplimentary).toBe(true);
      expect(res.body.data.subscription.isPilotParticipant).toBe(true);
      const diffMs =
        new Date(res.body.data.subscription.trialEndsAt).getTime() -
        new Date(res.body.data.subscription.trialStartedAt).getTime();
      expect(Math.round(diffMs / (24 * 60 * 60 * 1000))).toBe(30);
    }

    // Zero fake SaasPayment or Invoice records created
    expect(await SaasPayment.countDocuments()).toBe(0);
    expect(await Invoice.countDocuments()).toBe(0);

    // Duplicate pilot grant to business 0 is rejected
    const dupRes = await request(app)
      .post(`/api/admin/subscriptions/${businesses[0]._id}/grant-pilot`)
      .set('x-user-phone', adminPhone)
      .send({ reason: 'Duplicate attempt' });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.code).toBe('DUPLICATE_PILOT_GRANT');

    // 4th business is rejected because max 3 pilot slots are full
    const fourthRes = await request(app)
      .post(`/api/admin/subscriptions/${businesses[3]._id}/grant-pilot`)
      .set('x-user-phone', adminPhone)
      .send({ reason: 'Fourth shop' });
    expect(fourthRes.status).toBe(409);
    expect(fourthRes.body.code).toBe('PILOT_LIMIT_REACHED');

    const pilotSummary = await request(app)
      .get('/api/admin/pilot/summary')
      .set('x-user-phone', adminPhone);
    expect(pilotSummary.status).toBe(200);
    expect(pilotSummary.body.data.slotsUsed).toBe(3);
    expect(pilotSummary.body.data.slotsRemaining).toBe(0);
  });

  it('enforces read-only access on expired trials, keeps tenant data intact, and isolates SaaS billing from shop accounting', async () => {
    const adminPhone = '919900111020';
    const shopPhone = '919900111021';
    await User.create({
      whatsappNumber: adminPhone,
      name: 'Billing Admin',
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
    });

    const { business } = await businessService.resolveBusinessForUser(shopPhone, 'Expiry Test Shop');

    // Record a sale while active
    const sale1 = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', shopPhone)
      .set('x-business-id', String(business._id))
      .send({ amount: 1500, paymentMethod: 'CASH' });
    expect(sale1.status).toBe(201);

    // Grant pilot and simulate expiry in UTC
    await request(app)
      .post(`/api/admin/subscriptions/${business._id}/grant-pilot`)
      .set('x-user-phone', adminPhone)
      .send({ reason: 'Pilot shop' });

    await Subscription.updateOne(
      { businessId: business._id },
      { $set: { trialEndsAt: new Date(Date.now() - 60000) } },
    );

    // Read operations (GET) remain allowed on expired trial
    const readTx = await request(app)
      .get('/api/transactions')
      .set('x-user-phone', shopPhone)
      .set('x-business-id', String(business._id));
    expect(readTx.status).toBe(200);
    expect(readTx.body.data.length).toBe(1); // Historical data preserved

    const readReport = await request(app)
      .get('/api/reports/daily')
      .set('x-user-phone', shopPhone)
      .set('x-business-id', String(business._id));
    expect(readReport.status).toBe(200);

    // Write operations (POST) are blocked with 402 SUBSCRIPTION_EXPIRED
    const writeSale = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', shopPhone)
      .set('x-business-id', String(business._id))
      .send({ amount: 500, paymentMethod: 'CASH' });
    expect(writeSale.status).toBe(402);
    expect(writeSale.body.code).toBe('SUBSCRIPTION_EXPIRED');

    // WhatsApp write operations are also blocked when expired
    const waRes = await conversationService.handleIncomingMessage(
      shopPhone,
      "Today's sales 500. Cash 500.",
      null,
      'Owner',
    );
    expect(waRes.blocked).toBe(true);
    expect(waRes.reason).toBe('SUBSCRIPTION_EXPIRED');

    // Audited manual paid activation restores write access WITHOUT creating shop Transaction/PaymentRecord
    const paidRes = await request(app)
      .post(`/api/admin/subscriptions/${business._id}/activate-paid`)
      .set('x-user-phone', adminPhone)
      .send({
        planCode: 'STARTER',
        amountInPaise: 99900,
        method: 'MANUAL_UPI',
        referenceId: 'UTR-SAAS-001',
        idempotencyKey: 'saas-pay-001',
      });
    expect(paidRes.status).toBe(200);
    expect(paidRes.body.data.subscription.status).toBe('ACTIVE');
    expect(paidRes.body.data.invoice.invoiceNumber).toMatch(/^VB-/);

    // Tenant accounting remains completely clean (still only the 1 shop sale)
    expect(await Transaction.countDocuments({ businessId: business._id })).toBe(1);
    expect(await PaymentRecord.countDocuments({ businessId: business._id })).toBe(0);

    // Write access is restored
    const sale2 = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', shopPhone)
      .set('x-business-id', String(business._id))
      .send({ amount: 700, paymentMethod: 'UPI' });
    expect(sale2.status).toBe(201);
  });

  it('enforces plan entitlement limits (products & team members) and supports safe dry-run pre-SaaS grandfathering', async () => {
    const adminPhone = '919900111030';
    const shopPhone = '919900111031';
    const adminUser = await User.create({
      whatsappNumber: adminPhone,
      name: 'Migration Admin',
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
    });

    const { business } = await businessService.resolveBusinessForUser(shopPhone, 'Limit Shop');
    // Create a legacy business with NO Subscription document
    const legacyBiz = await Business.create({
      name: 'Legacy Pre-SaaS Shop',
      businessType: 'RESTAURANT',
      ownerId: adminUser._id,
      status: 'ACTIVE',
    });

    // Set strict limits on shopPhone's subscription to test backend enforcement
    await Subscription.updateOne(
      { businessId: business._id },
      { $set: { 'usageLimits.maxProducts': 1, 'usageLimits.maxMembers': 1 } },
    );

    const p1 = await request(app)
      .post('/api/inventory/products')
      .set('x-user-phone', shopPhone)
      .set('x-business-id', String(business._id))
      .send({ name: 'Item 1', unit: 'pcs' });
    expect(p1.status).toBe(201);

    const p2 = await request(app)
      .post('/api/inventory/products')
      .set('x-user-phone', shopPhone)
      .set('x-business-id', String(business._id))
      .send({ name: 'Item 2', unit: 'pcs' });
    expect(p2.status).toBe(403);
    expect(p2.body.code).toBe('PLAN_LIMIT_EXCEEDED');

    const mDenied = await request(app)
      .post('/api/business/members')
      .set('x-user-phone', shopPhone)
      .set('x-business-id', String(business._id))
      .send({ whatsappNumber: '919900111099', name: 'Extra Staff', role: 'CASHIER' });
    expect(mDenied.status).toBe(403);
    expect(mDenied.body.code).toBe('PLAN_LIMIT_EXCEEDED');

    // Dry-run grandfathering inspects both without modifying DB
    const dryRunRes = await request(app)
      .post('/api/admin/migrations/grandfather-pre-saas')
      .set('x-user-phone', adminPhone)
      .send({ dryRun: true });
    expect(dryRunRes.status).toBe(200);
    expect(dryRunRes.body.data.dryRun).toBe(true);
    expect(dryRunRes.body.data.missingSubscription.some((b) => String(b.businessId) === String(legacyBiz._id))).toBe(true);
    expect(dryRunRes.body.data.appliedCount).toBe(0);

    // Apply grandfathering
    const applyRes = await request(app)
      .post('/api/admin/migrations/grandfather-pre-saas')
      .set('x-user-phone', adminPhone)
      .send({ dryRun: false });
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.data.appliedCount).toBe(2);

    const legacySub = await Subscription.findOne({ businessId: legacyBiz._id });
    expect(legacySub.billingExempt).toBe(true);
    expect(legacySub.migrationSource).toBe('PRE_SAAS');
    expect(legacySub.status).toBe('ACTIVE');
  });
});
