import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { User } from '../src/modules/users/user.model.js';
import { Business } from '../src/modules/businesses/business.model.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { Subscription } from '../src/modules/subscriptions/subscription.model.js';
import { SaasPayment } from '../src/modules/subscriptions/saas-payment.model.js';

describe('Phase A4: SaaS Security, Concurrency, Billing & Isolation Audit Tests', () => {
  it('blocks suspended business owners from bypassing suspension via auto-provisioning', async () => {
    const adminPhone = '919933111001';
    const ownerPhone = '919933111002';

    await User.create({
      whatsappNumber: adminPhone,
      name: 'Audit Admin',
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
    });
    const { business } = await businessService.resolveBusinessForUser(ownerPhone, 'Suspended Shop');

    // Admin suspends the business with mandatory reason
    const suspRes = await request(app)
      .patch(`/api/admin/businesses/${business._id}/status`)
      .set('x-user-phone', adminPhone)
      .send({ status: 'SUSPENDED', reason: 'Policy review' });
    expect(suspRes.status).toBe(200);

    // Owner attempting API access gets 403 BUSINESS_SUSPENDED and NO second business is created
    const blocked = await request(app)
      .get('/api/transactions')
      .set('x-user-phone', ownerPhone);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('BUSINESS_SUSPENDED');

    const bizCount = await Business.countDocuments({ name: /Suspended Shop|My Business/ });
    expect(bizCount).toBe(1);
  });

  it('enforces the 3-pilot-slot cap under concurrent grant-pilot requests', async () => {
    const adminPhone = '919933111010';
    await User.create({
      whatsappNumber: adminPhone,
      name: 'Concurrent Admin',
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
    });

    const businesses = [];
    for (let i = 1; i <= 5; i++) {
      const { business } = await businessService.resolveBusinessForUser(
        `91993322200${i}`,
        `Concurrent Pilot ${i}`,
      );
      businesses.push(business);
    }

    const results = await Promise.all(
      businesses.map((b, idx) =>
        request(app)
          .post(`/api/admin/subscriptions/${b._id}/grant-pilot`)
          .set('x-user-phone', adminPhone)
          .send({ reason: `Concurrent grant #${idx + 1}` }),
      ),
    );

    const granted = results.filter((r) => r.status === 200);
    const rejected = results.filter((r) => r.status === 409);
    expect(granted.length).toBe(3);
    expect(rejected.length).toBe(2);
  });

  it('excludes PENDING/FAILED/REFUNDED SaasPayments from revenue and preserves active entitlement snapshots on plan edits', async () => {
    const adminPhone = '919933111020';
    const shopPhone = '919933111021';

    await User.create({
      whatsappNumber: adminPhone,
      name: 'Revenue Admin',
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
    });
    const { business } = await businessService.resolveBusinessForUser(shopPhone, 'Snapshot Shop');

    // Create plan & grant pilot (snapshots 100 AI requests)
    const planRes = await request(app)
      .post('/api/admin/plans')
      .set('x-user-phone', adminPhone)
      .send({
        code: 'CUSTOM_PILOT',
        name: 'Custom Pilot',
        monthlyPriceInPaise: 0,
        limits: { maxTeamMembers: 5, maxProducts: 100, monthlyAiRequests: 100, monthlyWhatsappMessages: 200 },
      });
    expect(planRes.status).toBe(201);
    const planId = planRes.body.data._id;

    await request(app)
      .post(`/api/admin/subscriptions/${business._id}/grant-pilot`)
      .set('x-user-phone', adminPhone)
      .send({ reason: 'Snapshot test', planCode: 'CUSTOM_PILOT' });

    // Edit plan defaults to 999 -> active subscription snapshot remains 100
    await request(app)
      .patch(`/api/admin/plans/${planId}`)
      .set('x-user-phone', adminPhone)
      .send({ limits: { maxTeamMembers: 20, maxProducts: 999, monthlyAiRequests: 999, monthlyWhatsappMessages: 999 } });

    const activeSub = await Subscription.findOne({ businessId: business._id });
    expect(activeSub.usageLimits.monthlyAiRequests).toBe(100);

    // Record 1 CAPTURED payment (50000 paise) + PENDING, FAILED, REFUNDED payments
    await request(app)
      .post(`/api/admin/subscriptions/${business._id}/activate-paid`)
      .set('x-user-phone', adminPhone)
      .send({
        planCode: 'CUSTOM_PILOT',
        amountInPaise: 50000,
        method: 'MANUAL_UPI',
        idempotencyKey: 'a4-cap-1',
      });

    await SaasPayment.create([
      {
        businessId: business._id,
        subscriptionId: activeSub._id,
        amountInPaise: 99900,
        status: 'PENDING',
      },
      {
        businessId: business._id,
        subscriptionId: activeSub._id,
        amountInPaise: 99900,
        status: 'FAILED',
      },
      {
        businessId: business._id,
        subscriptionId: activeSub._id,
        amountInPaise: 99900,
        status: 'REFUNDED',
      },
    ]);

    const overview = await request(app)
      .get('/api/admin/overview')
      .set('x-user-phone', adminPhone);
    expect(overview.status).toBe(200);
    expect(overview.body.data.collectedRevenueInPaise).toBe(50000);
    expect(overview.body.data.capturedPaymentCount).toBe(1);
  });

  it('prevents cross-tenant access to /api/business/usage', async () => {
    const phoneA = '919933111031';
    const phoneB = '919933111032';
    const { business: bizA } = await businessService.resolveBusinessForUser(phoneA, 'Biz A');
    await businessService.resolveBusinessForUser(phoneB, 'Biz B');

    const crossUsage = await request(app)
      .get('/api/business/usage')
      .set('x-user-phone', phoneB)
      .set('x-business-id', String(bizA._id));
    expect(crossUsage.status).toBe(403);
    expect(crossUsage.body.code).toBe('CROSS_TENANT_FORBIDDEN');
  });
});
