import express from 'express';
import { Business } from '../businesses/business.model.js';
import { BusinessMember } from '../business-members/business-member.model.js';
import { Subscription } from '../subscriptions/subscription.model.js';
import { SubscriptionPlan } from '../subscriptions/subscription-plan.model.js';
import { SaasPayment } from '../subscriptions/saas-payment.model.js';
import { Invoice } from '../subscriptions/invoice.model.js';
import { UsageRecord } from '../subscriptions/usage-record.model.js';
import { subscriptionService, getUtcPeriodKey } from '../subscriptions/subscription.service.js';
import { resolveUserOnly, requirePlatformAdmin } from '../../middleware/auth.middleware.js';
import { logger } from '../../config/logger.js';

const router = express.Router();

// All platform admin routes strictly require authenticated PLATFORM_ADMIN user
router.use(resolveUserOnly, requirePlatformAdmin);

// GET /api/admin/overview - Platform overview KPIs, actual revenue, and upcoming expiries
router.get('/overview', async (_req, res, next) => {
  try {
    const nowUtc = new Date();
    const sevenDaysFromNow = new Date(nowUtc.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalBusinesses,
      activeSubscriptions,
      trialingSubscriptions,
      expiredSubscriptions,
      suspendedSubscriptions,
      pilotSummary,
      capturedPayments,
      upcomingSubs,
    ] = await Promise.all([
      Business.countDocuments(),
      Subscription.countDocuments({ status: 'ACTIVE' }),
      Subscription.countDocuments({ status: 'TRIALING' }),
      Subscription.countDocuments({ status: 'EXPIRED' }),
      Subscription.countDocuments({ status: 'SUSPENDED' }),
      subscriptionService.getPilotSummary(),
      SaasPayment.aggregate([
        { $match: { status: 'CAPTURED' } },
        { $group: { _id: null, totalPaise: { $sum: '$amountInPaise' }, count: { $sum: 1 } } },
      ]),
      Subscription.find({
        $or: [
          { status: 'TRIALING', trialEndsAt: { $gte: nowUtc, $lte: sevenDaysFromNow } },
          { status: 'ACTIVE', currentPeriodEnd: { $gte: nowUtc, $lte: sevenDaysFromNow } },
        ],
      })
        .populate('businessId', 'name businessType')
        .sort({ trialEndsAt: 1, currentPeriodEnd: 1 })
        .limit(20),
    ]);

    const collectedRevenueInPaise = capturedPayments[0]?.totalPaise || 0;
    const capturedPaymentCount = capturedPayments[0]?.count || 0;

    res.json({
      status: 'success',
      data: {
        totalBusinesses,
        activeSubscriptions,
        trialingSubscriptions,
        expiredSubscriptions,
        suspendedSubscriptions,
        pilotSlotsUsed: pilotSummary.slotsUsed,
        pilotMaxSlots: pilotSummary.maxSlots,
        collectedRevenueInPaise,
        capturedPaymentCount,
        upcomingExpiries: upcomingSubs.map((s) => ({
          subscriptionId: s._id,
          business: s.businessId,
          status: s.status,
          planCode: s.planCode || s.plan,
          expiresAt: s.status === 'TRIALING' ? s.trialEndsAt : s.currentPeriodEnd,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/businesses - List all registered businesses with filters & subscription status
router.get('/businesses', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status && req.query.status !== 'ALL') {
      filter.status = String(req.query.status).toUpperCase();
    }
    if (req.query.businessType && req.query.businessType !== 'ALL') {
      filter.businessType = String(req.query.businessType).toUpperCase();
    }
    if (req.query.search && String(req.query.search).trim()) {
      const regex = new RegExp(
        String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.name = regex;
    }

    const businesses = await Business.find(filter)
      .populate('ownerId', 'name whatsappNumber')
      .sort({ createdAt: -1 });
    const subs = await Subscription.find({
      businessId: { $in: businesses.map((b) => b._id) },
    });
    const subMap = new Map(subs.map((s) => [String(s.businessId), s]));

    let data = businesses.map((b) => ({
      business: b,
      subscription: subMap.get(String(b._id)) || null,
    }));

    if (req.query.subscriptionStatus && req.query.subscriptionStatus !== 'ALL') {
      const targetSubStatus = String(req.query.subscriptionStatus).toUpperCase();
      data = data.filter((row) => (row.subscription?.status || 'NONE') === targetSubStatus);
    }

    res.json({ status: 'success', count: data.length, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/businesses/:id - View business details, subscription & usage
router.get('/businesses/:id', async (req, res, next) => {
  try {
    const business = await Business.findById(req.params.id).populate('ownerId', 'name whatsappNumber');
    if (!business) {
      return res.status(404).json({ status: 'fail', message: 'Business not found' });
    }
    const [subscription, usage, membersCount] = await Promise.all([
      Subscription.findOne({ businessId: business._id }),
      subscriptionService.getUsageSummary(business._id),
      BusinessMember.countDocuments({ businessId: business._id, status: { $ne: 'REVOKED' } }),
    ]);

    res.json({
      status: 'success',
      data: { business, subscription, usage, membersCount },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/businesses/:id/status - Activate or suspend a business
router.patch('/businesses/:id/status', async (req, res, next) => {
  try {
    const { status, reason } = req.body;
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({ status: 'fail', message: 'Status must be ACTIVE or SUSPENDED' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ status: 'fail', message: 'Audit reason is required' });
    }

    const business = await Business.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true },
    );
    if (!business) {
      return res.status(404).json({ status: 'fail', message: 'Business not found' });
    }

    logger.info(
      { adminId: req.user._id, businessId: business._id, status, reason: String(reason).trim() },
      'Admin updated business status',
    );
    res.json({ status: 'success', data: business });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/plans - List subscription plans
router.get('/plans', async (_req, res, next) => {
  try {
    await subscriptionService.ensureDefaultPilotPlan();
    const plans = await SubscriptionPlan.find().sort({ sortOrder: 1, createdAt: 1 });
    res.json({ status: 'success', count: plans.length, data: plans });
  } catch (err) {
    next(err);
  }
});

function pickPlanPayload(body = {}, isCreate = false) {
  const allowed = {};
  if (isCreate && body.code !== undefined) allowed.code = String(body.code).trim().toUpperCase();
  if (body.name !== undefined) allowed.name = String(body.name).trim();
  if (body.description !== undefined) allowed.description = String(body.description).trim();
  if (body.monthlyPriceInPaise !== undefined) {
    allowed.monthlyPriceInPaise = Math.max(0, Number(body.monthlyPriceInPaise) || 0);
  }
  if (body.trialDays !== undefined) allowed.trialDays = Math.max(0, Number(body.trialDays) || 0);
  if (body.gracePeriodDays !== undefined) {
    allowed.gracePeriodDays = Math.max(0, Number(body.gracePeriodDays) || 0);
  }
  if (body.limits && typeof body.limits === 'object') allowed.limits = body.limits;
  if (body.features && typeof body.features === 'object') allowed.features = body.features;
  if (body.isActive !== undefined) allowed.isActive = Boolean(body.isActive);
  if (body.sortOrder !== undefined) allowed.sortOrder = Number(body.sortOrder) || 0;
  return allowed;
}

// POST /api/admin/plans - Create subscription plan
router.post('/plans', async (req, res, next) => {
  try {
    const payload = pickPlanPayload(req.body, true);
    const plan = await SubscriptionPlan.create(payload);
    logger.info({ adminId: req.user._id, planCode: plan.code }, 'Admin created subscription plan');
    res.status(201).json({ status: 'success', data: plan });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ status: 'fail', message: 'Plan code already exists' });
    }
    next(err);
  }
});

// PATCH /api/admin/plans/:id - Update subscription plan
router.patch('/plans/:id', async (req, res, next) => {
  try {
    const payload = pickPlanPayload(req.body, false);
    const plan = await SubscriptionPlan.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true, runValidators: true },
    );
    if (!plan) {
      return res.status(404).json({ status: 'fail', message: 'Plan not found' });
    }
    logger.info({ adminId: req.user._id, planCode: plan.code }, 'Admin updated subscription plan');
    res.json({ status: 'success', data: plan });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/pilot/summary - View pilot slots and participant trials
router.get('/pilot/summary', async (_req, res, next) => {
  try {
    const summary = await subscriptionService.getPilotSummary();
    res.json({ status: 'success', data: summary });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/subscriptions/:businessId/grant-pilot - Manually grant 30-day complimentary pilot
router.post('/subscriptions/:businessId/grant-pilot', async (req, res, next) => {
  try {
    const result = await subscriptionService.grantPilotAccess({
      businessId: req.params.businessId,
      adminUserId: req.user._id,
      reason: req.body.reason,
      planCode: req.body.planCode || 'PILOT',
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ status: 'fail', code: err.code, message: err.message });
    }
    next(err);
  }
});

// POST /api/admin/subscriptions/:businessId/activate-paid - Audited manual paid activation
router.post('/subscriptions/:businessId/activate-paid', async (req, res, next) => {
  try {
    const result = await subscriptionService.activatePaidSubscription({
      ...req.body,
      businessId: req.params.businessId,
      adminUserId: req.user._id,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ status: 'fail', code: err.code, message: err.message });
    }
    next(err);
  }
});

// POST /api/admin/subscriptions/:businessId/extend-trial - Exceptional trial extension with reason
router.post('/subscriptions/:businessId/extend-trial', async (req, res, next) => {
  try {
    const sub = await subscriptionService.extendTrial({
      businessId: req.params.businessId,
      adminUserId: req.user._id,
      extraDays: req.body.extraDays,
      reason: req.body.reason,
    });
    res.json({ status: 'success', data: sub });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ status: 'fail', code: err.code, message: err.message });
    }
    next(err);
  }
});

// POST /api/admin/subscriptions/:businessId/suspend - Suspend subscription with reason
router.post('/subscriptions/:businessId/suspend', async (req, res, next) => {
  try {
    const sub = await subscriptionService.suspendSubscription({
      businessId: req.params.businessId,
      adminUserId: req.user._id,
      reason: req.body.reason,
    });
    res.json({ status: 'success', data: sub });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ status: 'fail', code: err.code, message: err.message });
    }
    next(err);
  }
});

// GET /api/admin/payments - Platform SaaS payment records
router.get('/payments', async (_req, res, next) => {
  try {
    const payments = await SaasPayment.find()
      .populate('businessId', 'name')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ status: 'success', count: payments.length, data: payments });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/invoices - Platform SaaS invoices
router.get('/invoices', async (_req, res, next) => {
  try {
    const invoices = await Invoice.find()
      .populate('businessId', 'name')
      .sort({ issuedAt: -1 })
      .limit(100);
    res.json({ status: 'success', count: invoices.length, data: invoices });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/subscriptions - List all subscriptions with plan details
router.get('/subscriptions', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status && req.query.status !== 'ALL') {
      filter.status = String(req.query.status).toUpperCase();
    }
    const subs = await Subscription.find(filter)
      .populate('businessId', 'name businessType status')
      .populate('subscriptionPlanId', 'code name monthlyPriceInPaise')
      .sort({ updatedAt: -1 });
    res.json({ status: 'success', count: subs.length, data: subs });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/subscriptions/:businessId/plan - Change business plan (audited)
router.patch('/subscriptions/:businessId/plan', async (req, res, next) => {
  try {
    const sub = await subscriptionService.changeSubscriptionPlan({
      businessId: req.params.businessId,
      adminUserId: req.user._id,
      planCode: req.body.planCode,
      reason: req.body.reason,
    });
    logger.info(
      { adminId: req.user._id, businessId: req.params.businessId, planCode: req.body.planCode },
      'Admin changed business subscription plan',
    );
    res.json({ status: 'success', data: sub });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ status: 'fail', code: err.code, message: err.message });
    }
    next(err);
  }
});

// GET /api/admin/usage - Platform monthly usage monitoring with percentages & warnings
router.get('/usage', async (req, res, next) => {
  try {
    const periodKey = String(req.query.periodKey || getUtcPeriodKey());
    const records = await UsageRecord.find({ periodKey })
      .populate('businessId', 'name businessType')
      .sort({ aiRequestsCount: -1 });

    const subs = await Subscription.find({
      businessId: { $in: records.map((r) => r.businessId?._id || r.businessId) },
    });
    const subMap = new Map(subs.map((s) => [String(s.businessId), s]));

    const enriched = records.map((r) => {
      const bizId = String(r.businessId?._id || r.businessId);
      const sub = subMap.get(bizId);
      const aiLimit = sub?.usageLimits?.monthlyAiRequests ?? 500;
      const waLimit = sub?.usageLimits?.monthlyWhatsappMessages ?? 1000;
      const aiPct = aiLimit > 0 ? Math.round((r.aiRequestsCount / aiLimit) * 100) : 0;
      const waPct = waLimit > 0 ? Math.round((r.whatsappMessagesCount / waLimit) * 100) : 0;
      return {
        _id: r._id,
        business: r.businessId,
        periodKey: r.periodKey,
        aiRequestsCount: r.aiRequestsCount,
        aiLimit,
        aiPct,
        aiWarning: aiLimit > 0 && r.aiRequestsCount < aiLimit && aiPct >= 80,
        aiLimitReached: aiLimit > 0 && r.aiRequestsCount >= aiLimit,
        whatsappMessagesCount: r.whatsappMessagesCount,
        waLimit,
        waPct,
        waWarning: waLimit > 0 && r.whatsappMessagesCount < waLimit && waPct >= 80,
        waLimitReached: waLimit > 0 && r.whatsappMessagesCount >= waLimit,
        lastUpdatedAt: r.lastUpdatedAt,
      };
    });

    res.json({ status: 'success', periodKey, count: enriched.length, data: enriched });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/migrations/grandfather-pre-saas - Safe dry-run / apply pre-SaaS grandfathering
router.post('/migrations/grandfather-pre-saas', async (req, res, next) => {
  try {
    const dryRun = req.body?.dryRun !== false; // Default to dryRun=true for safety
    const report = await subscriptionService.grandfatherPreSaaS({
      dryRun,
      businessIds: req.body?.businessIds || null,
      adminUserId: req.user._id,
    });
    res.json({ status: 'success', data: report });
  } catch (err) {
    next(err);
  }
});

export default router;
