import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { Subscription } from '../src/modules/subscriptions/subscription.model.js';
import { UsageRecord } from '../src/modules/subscriptions/usage-record.model.js';
import { subscriptionService, getUtcPeriodKey } from '../src/modules/subscriptions/subscription.service.js';
import { conversationService } from '../src/modules/conversations/conversation.service.js';

describe('Phase A2: Subscription Enforcement, Entitlements, Usage Metering & Concurrency', () => {
  it('enforces PAST_DUE grace period, SUSPENDED, CANCELLED paid-through period, and PENDING rules', async () => {
    const phone = '919911111001';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Lifecycle Shop');

    // 1. PAST_DUE within grace period -> writes allowed
    await Subscription.updateOne(
      { businessId: business._id },
      {
        $set: {
          status: 'PAST_DUE',
          gracePeriodEndsAt: new Date(Date.now() + 3600 * 1000),
        },
      },
    );
    const withinGrace = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 300, paymentMethod: 'CASH' });
    expect(withinGrace.status).toBe(201);

    // 2. PAST_DUE after grace period -> auto-transitions to SUSPENDED & blocks writes
    await Subscription.updateOne(
      { businessId: business._id },
      { $set: { gracePeriodEndsAt: new Date(Date.now() - 1000) } },
    );
    const pastGrace = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 400, paymentMethod: 'CASH' });
    expect(pastGrace.status).toBe(402);
    expect(pastGrace.body.code).toBe('SUBSCRIPTION_SUSPENDED');

    // Read-only GET remains allowed
    const readSuspended = await request(app)
      .get('/api/transactions')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(readSuspended.status).toBe(200);

    // 3. CANCELLED with cancelAtPeriodEnd=true before currentPeriodEnd -> allowed
    await Subscription.updateOne(
      { businessId: business._id },
      {
        $set: {
          status: 'CANCELLED',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(Date.now() + 3600 * 1000),
        },
      },
    );
    const cancelBeforeEnd = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 500, paymentMethod: 'CASH' });
    expect(cancelBeforeEnd.status).toBe(201);

    // 4. CANCELLED after currentPeriodEnd -> transitions to EXPIRED & blocks writes
    await Subscription.updateOne(
      { businessId: business._id },
      { $set: { currentPeriodEnd: new Date(Date.now() - 1000) } },
    );
    const cancelAfterEnd = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 600, paymentMethod: 'CASH' });
    expect(cancelAfterEnd.status).toBe(402);
    expect(cancelAfterEnd.body.code).toBe('SUBSCRIPTION_EXPIRED');
  });

  it('enforces advancedReports feature entitlement on backend report routes', async () => {
    const phone = '919911111002';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Basic Plan Shop');

    await Subscription.updateOne(
      { businessId: business._id },
      { $set: { 'features.advancedReports': false } },
    );

    const dailyRes = await request(app)
      .get('/api/reports/daily')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(dailyRes.status).toBe(200);

    for (const path of [
      '/api/reports/weekly',
      '/api/reports/monthly',
      '/api/reports/cash-flow',
      '/api/reports/summary',
      '/api/reports/inventory',
    ]) {
      const res = await request(app)
        .get(path)
        .set('x-user-phone', phone)
        .set('x-business-id', String(business._id));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FEATURE_NOT_IN_PLAN');
    }
  });

  it('prevents race-condition bypasses under concurrent product creation, team invites, and usage increments', async () => {
    const phone = '919911111003';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Concurrency Shop');

    await Subscription.updateOne(
      { businessId: business._id },
      {
        $set: {
          'usageLimits.maxProducts': 2,
          'usageLimits.maxMembers': 2, // 1 owner + 1 staff
          'usageLimits.monthlyAiRequests': 3,
        },
      },
    );

    // Concurrent product creations (4 parallel requests, limit=2)
    const prodResults = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        request(app)
          .post('/api/inventory/products')
          .set('x-user-phone', phone)
          .set('x-business-id', String(business._id))
          .send({ name: `Concurrent Item ${i}`, unit: 'pcs' }),
      ),
    );
    expect(prodResults.filter((r) => r.status === 201).length).toBe(2);
    expect(prodResults.filter((r) => r.status === 403).length).toBe(2);

    // Concurrent team invitations (3 parallel requests, only 1 slot left)
    const memResults = await Promise.all(
      [1, 2, 3].map((i) =>
        request(app)
          .post('/api/business/members')
          .set('x-user-phone', phone)
          .set('x-business-id', String(business._id))
          .send({ whatsappNumber: `91991122200${i}`, name: `Staff ${i}`, role: 'CASHIER' }),
      ),
    );
    expect(memResults.filter((r) => r.status === 201).length).toBe(1);
    expect(memResults.filter((r) => r.status === 403).length).toBe(2);

    // Concurrent AI usage quota consumption (5 parallel requests, limit=3)
    const aiOutcomes = await Promise.allSettled(
      [1, 2, 3, 4, 5].map(() =>
        subscriptionService.consumeUsageQuota(
          business._id,
          'aiRequestsCount',
          'monthlyAiRequests',
        ),
      ),
    );
    expect(aiOutcomes.filter((o) => o.status === 'fulfilled').length).toBe(3);
    expect(aiOutcomes.filter((o) => o.status === 'rejected').length).toBe(2);
  });

  it('surfaces 80% warnings, blocks at 100% quota, and avoids double-counting webhook retries', async () => {
    const phone = '919911111004';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Metering Shop');

    await Subscription.updateOne(
      { businessId: business._id },
      {
        $set: {
          'usageLimits.monthlyAiRequests': 5,
          'usageLimits.monthlyWhatsappMessages': 10,
        },
      },
    );

    // Consume 4 AI requests (80% of 5)
    for (let i = 0; i < 4; i++) {
      await subscriptionService.consumeUsageQuota(
        business._id,
        'aiRequestsCount',
        'monthlyAiRequests',
      );
    }

    const usageRes = await request(app)
      .get('/api/business/usage')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(usageRes.status).toBe(200);
    expect(usageRes.body.data.warnings.some((w) => w.resource === 'aiRequests' && w.pct === 80)).toBe(
      true,
    );

    // 5th WhatsApp AI message succeeds (reaches 5/5)
    await conversationService.handleIncomingMessage(
      phone,
      "Today's sales 500. Cash 500.",
      null,
      'Owner',
    );

    // 6th WhatsApp AI message is blocked at 100% quota
    const blocked = await conversationService.handleIncomingMessage(
      phone,
      "Today's sales 200. Cash 200.",
      null,
      'Owner',
    );
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toBe('USAGE_LIMIT_REACHED');

    // Verify usage record is tenant-specific & uses UTC YYYY-MM
    const periodKey = getUtcPeriodKey();
    const record = await UsageRecord.findOne({ businessId: business._id, periodKey });
    expect(record.aiRequestsCount).toBe(5);
    expect(record.whatsappMessagesCount).toBe(2);
  });
});
