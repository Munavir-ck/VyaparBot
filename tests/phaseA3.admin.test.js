import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { User } from '../src/modules/users/user.model.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { Subscription } from '../src/modules/subscriptions/subscription.model.js';
import { subscriptionService, getUtcPeriodKey } from '../src/modules/subscriptions/subscription.service.js';

describe('Phase A3: Platform Admin Dashboard APIs, Authorization & Isolation', () => {
  it('blocks business OWNER from all Phase A3 admin endpoints and serves overview/subscriptions/usage to PLATFORM_ADMIN', async () => {
    const ownerPhone = '919922111001';
    const adminPhone = '919922111002';

    const { business } = await businessService.resolveBusinessForUser(ownerPhone, 'A3 Grocery', {
      businessType: 'GROCERY',
    });
    await User.create({
      whatsappNumber: adminPhone,
      name: 'A3 Admin',
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
    });

    // Business OWNER blocked on new admin endpoints
    for (const path of ['/api/admin/overview', '/api/admin/subscriptions', '/api/admin/usage']) {
      const denied = await request(app).get(path).set('x-user-phone', ownerPhone);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('PLATFORM_ADMIN_REQUIRED');
    }

    // Create a plan & assign via PATCH /api/admin/subscriptions/:businessId/plan
    const planRes = await request(app)
      .post('/api/admin/plans')
      .set('x-user-phone', adminPhone)
      .send({
        code: 'GROWTH',
        name: 'Growth Plan',
        monthlyPriceInPaise: 149900,
        limits: {
          maxTeamMembers: 10,
          maxProducts: 1000,
          monthlyAiRequests: 10,
          monthlyWhatsappMessages: 100,
        },
      });
    expect(planRes.status).toBe(201);

    const changePlan = await request(app)
      .patch(`/api/admin/subscriptions/${business._id}/plan`)
      .set('x-user-phone', adminPhone)
      .send({ planCode: 'GROWTH', reason: 'Upgraded for A3 test' });
    expect(changePlan.status).toBe(200);
    expect(changePlan.body.data.planCode).toBe('GROWTH');
    expect(changePlan.body.data.usageLimits.monthlyAiRequests).toBe(10);

    // Record 8 AI requests -> 80% warning in GET /api/admin/usage
    for (let i = 0; i < 8; i++) {
      await subscriptionService.consumeUsageQuota(
        business._id,
        'aiRequestsCount',
        'monthlyAiRequests',
      );
    }

    const periodKey = getUtcPeriodKey();
    const usageRes = await request(app)
      .get(`/api/admin/usage?periodKey=${periodKey}`)
      .set('x-user-phone', adminPhone);
    expect(usageRes.status).toBe(200);
    const bizUsage = usageRes.body.data.find(
      (u) => String(u.business?._id) === String(business._id),
    );
    expect(bizUsage).toBeDefined();
    expect(bizUsage.aiPct).toBe(80);
    expect(bizUsage.aiWarning).toBe(true);
    expect(bizUsage.aiLimitReached).toBe(false);

    // Activate paid -> overview reflects actual collected SaaS revenue
    await request(app)
      .post(`/api/admin/subscriptions/${business._id}/activate-paid`)
      .set('x-user-phone', adminPhone)
      .send({
        planCode: 'GROWTH',
        amountInPaise: 149900,
        method: 'MANUAL_UPI',
        idempotencyKey: 'a3-paid-1',
      });

    // Set trialEndsAt within 3 days on a second business to verify upcomingExpiries
    const { business: biz2 } = await businessService.resolveBusinessForUser(
      '919922111003',
      'Expiring Soon Shop',
    );
    await Subscription.updateOne(
      { businessId: biz2._id },
      {
        $set: {
          status: 'TRIALING',
          trialEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        },
      },
    );

    const overviewRes = await request(app)
      .get('/api/admin/overview')
      .set('x-user-phone', adminPhone);
    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.data.totalBusinesses).toBeGreaterThanOrEqual(2);
    expect(overviewRes.body.data.collectedRevenueInPaise).toBe(149900);
    expect(
      overviewRes.body.data.upcomingExpiries.some(
        (e) => String(e.business?._id) === String(biz2._id),
      ),
    ).toBe(true);

    // Filter businesses by businessType & subscriptionStatus
    const filteredBiz = await request(app)
      .get('/api/admin/businesses?businessType=GROCERY&subscriptionStatus=ACTIVE')
      .set('x-user-phone', adminPhone);
    expect(filteredBiz.status).toBe(200);
    expect(filteredBiz.body.data.some((r) => String(r.business._id) === String(business._id))).toBe(
      true,
    );
  });
});
