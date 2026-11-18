import { Business } from '../businesses/business.model.js';
import { BusinessMember } from '../business-members/business-member.model.js';
import { Product } from '../inventory/product.model.js';
import { Subscription } from './subscription.model.js';
import { SubscriptionPlan } from './subscription-plan.model.js';
import { PlatformCounter } from './platform-counter.model.js';
import { SaasPayment } from './saas-payment.model.js';
import { Invoice } from './invoice.model.js';
import { UsageRecord } from './usage-record.model.js';
import { runInTransaction, sessionOpts } from '../../utils/db-transaction.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function getUtcPeriodKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function makeAppError(message, statusCode = 400, code = 'SUBSCRIPTION_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

const businessLocks = new Map();

class SubscriptionService {
  async withBusinessLimitLock(key, fn) {
    const k = String(key);
    const prev = businessLocks.get(k) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    businessLocks.set(k, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (businessLocks.get(k) === next) {
        businessLocks.delete(k);
      }
    }
  }
  async ensureDefaultPilotPlan(session = null) {
    let plan = await SubscriptionPlan.findOne({ code: 'PILOT' }, null, sessionOpts(session));
    if (!plan) {
      try {
        plan = await SubscriptionPlan.findOneAndUpdate(
          { code: 'PILOT' },
          {
            $setOnInsert: {
              code: 'PILOT',
              name: '30-Day Pilot Plan',
              description: 'Complimentary 30-day pilot access for the first three approved businesses.',
              currency: 'INR',
              monthlyPriceInPaise: 0,
              billingInterval: 'MONTHLY',
              trialDays: 30,
              gracePeriodDays: 7,
              limits: {
                maxTeamMembers: 5,
                maxProducts: 500,
                monthlyAiRequests: 500,
                monthlyWhatsappMessages: 1000,
                monthlyTransactions: 5000,
              },
              features: {
                whatsappAssistant: true,
                voiceAndScreenshotAi: true,
                inventoryManagement: true,
                customerManagement: true,
                supplierManagement: true,
                financialReports: true,
                advancedReports: true,
                csvExport: true,
              },
              isActive: true,
              sortOrder: 0,
            },
          },
          { upsert: true, new: true, ...sessionOpts(session) },
        );
      } catch (err) {
        if (err?.code === 11000) {
          plan = await SubscriptionPlan.findOne({ code: 'PILOT' }, null, sessionOpts(session));
        } else {
          throw err;
        }
      }
    }
    return plan;
  }

  async _ensureCounter(id, defaultLimit, session = null) {
    try {
      await PlatformCounter.findOneAndUpdate(
        { _id: id },
        { $setOnInsert: { _id: id, used: 0, limit: defaultLimit } },
        { upsert: true, ...sessionOpts(session) },
      );
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }

  /**
   * Grant 30-day complimentary pilot access (TRIALING) to an eligible business.
   * Atomically enforces the 3-business cap and prevents duplicate pilot grants.
   * Never creates fake SaasPayment or Invoice records.
   */
  async grantPilotAccess({ businessId, adminUserId, reason, planCode = 'PILOT' }) {
    if (!reason || !String(reason).trim()) {
      throw makeAppError('Grant reason is required for pilot activation.', 400, 'REASON_REQUIRED');
    }

    return runInTransaction(async (session) => {
      const business = await Business.findById(businessId, null, sessionOpts(session));
      if (!business) {
        throw makeAppError('Business not found.', 404, 'BUSINESS_NOT_FOUND');
      }

      let sub = await Subscription.findOne({ businessId }, null, sessionOpts(session));
      if (sub?.isPilotParticipant) {
        throw makeAppError(
          'Business has already received pilot access.',
          409,
          'DUPLICATE_PILOT_GRANT',
        );
      }
      if (sub?.billingExempt) {
        throw makeAppError(
          'Pre-SaaS billing-exempt businesses cannot be enrolled in the pilot programme.',
          409,
          'PRE_SAAS_EXEMPT',
        );
      }

      // Atomically claim 1 of the 3 pilot slots
      await this._ensureCounter('pilot_slots', 3, session);
      const slot = await PlatformCounter.findOneAndUpdate(
        { _id: 'pilot_slots', $expr: { $lt: ['$used', '$limit'] } },
        { $inc: { used: 1 } },
        { new: true, ...sessionOpts(session) },
      );
      if (!slot) {
        throw makeAppError(
          'Maximum limit of 3 pilot businesses has already been reached.',
          409,
          'PILOT_LIMIT_REACHED',
        );
      }

      const plan =
        (await SubscriptionPlan.findOne(
          { code: String(planCode).toUpperCase() },
          null,
          sessionOpts(session),
        )) || (await this.ensureDefaultPilotPlan(session));

      const nowUtc = new Date();
      const trialEndsAt = new Date(nowUtc.getTime() + THIRTY_DAYS_MS);
      const prevStatus = sub ? sub.status : null;

      if (!sub) {
        sub = new Subscription({ businessId });
      }

      sub.subscriptionPlanId = plan._id;
      sub.planCode = plan.code;
      sub.plan = ['TRIAL', 'PILOT', 'STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'].includes(plan.code)
        ? plan.code
        : 'PILOT';
      sub.status = 'TRIALING';
      sub.isComplimentary = true;
      sub.isPilotParticipant = true;
      sub.migrationSource = 'PILOT';
      sub.activationSource = 'MANUAL_PILOT';
      sub.grantedBy = adminUserId;
      sub.grantReason = String(reason).trim();
      sub.trialStartedAt = nowUtc;
      sub.trialEndsAt = trialEndsAt;
      sub.startDate = nowUtc;
      sub.expiryDate = trialEndsAt;
      sub.usageLimits = {
        monthlyTransactions: plan.limits.monthlyTransactions,
        monthlyScreenshots: 500,
        monthlyVoiceNotes: 500,
        monthlyAiRequests: plan.limits.monthlyAiRequests,
        monthlyWhatsappMessages: plan.limits.monthlyWhatsappMessages,
        maxMembers: plan.limits.maxTeamMembers,
        maxProducts: plan.limits.maxProducts,
      };
      sub.features = { ...plan.features };
      sub.statusHistory.push({
        from: prevStatus,
        to: 'TRIALING',
        reason: String(reason).trim(),
        changedBy: adminUserId,
        timestamp: nowUtc,
      });

      await sub.save(sessionOpts(session));

      return { subscription: sub, slotsUsed: slot.used, maxSlots: slot.limit };
    });
  }

  /**
   * Audited manual paid activation (converts PENDING/TRIALING/EXPIRED -> ACTIVE).
   * Records a real SaasPayment and paid Invoice.
   */
  async activatePaidSubscription({
    businessId,
    adminUserId,
    planCode = 'STARTER',
    amountInPaise,
    method = 'MANUAL_UPI',
    referenceId = null,
    notes = '',
    idempotencyKey = null,
  }) {
    const finalAmount = Number(amountInPaise);
    if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
      throw makeAppError('Verified payment amount (> 0 paise) is required.', 400, 'INVALID_AMOUNT');
    }

    return runInTransaction(async (session) => {
      if (idempotencyKey) {
        const existingPay = await SaasPayment.findOne(
          { idempotencyKey },
          null,
          sessionOpts(session),
        );
        if (existingPay) {
          const [sub, inv] = await Promise.all([
            Subscription.findById(existingPay.subscriptionId, null, sessionOpts(session)),
            existingPay.invoiceId
              ? Invoice.findById(existingPay.invoiceId, null, sessionOpts(session))
              : null,
          ]);
          return { duplicate: true, payment: existingPay, invoice: inv, subscription: sub };
        }
      }

      const business = await Business.findById(businessId, null, sessionOpts(session));
      if (!business) {
        throw makeAppError('Business not found.', 404, 'BUSINESS_NOT_FOUND');
      }

      const plan = await SubscriptionPlan.findOne(
        { code: String(planCode).toUpperCase() },
        null,
        sessionOpts(session),
      );

      let sub = await Subscription.findOne({ businessId }, null, sessionOpts(session));
      const prevStatus = sub ? sub.status : null;
      if (!sub) {
        sub = new Subscription({ businessId });
      }

      const nowUtc = new Date();
      const periodEnd = new Date(nowUtc.getTime() + THIRTY_DAYS_MS);

      sub.subscriptionPlanId = plan ? plan._id : sub.subscriptionPlanId;
      sub.planCode = plan ? plan.code : String(planCode).toUpperCase();
      if (['TRIAL', 'PILOT', 'STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'].includes(sub.planCode)) {
        sub.plan = sub.planCode;
      }
      sub.status = 'ACTIVE';
      sub.isComplimentary = false;
      sub.activationSource = 'MANUAL_PAID';
      sub.grantedBy = adminUserId;
      sub.grantReason = notes || 'Manual paid activation';
      sub.currentPeriodStart = nowUtc;
      sub.currentPeriodEnd = periodEnd;
      sub.expiryDate = periodEnd;
      if (plan) {
        sub.usageLimits = {
          monthlyTransactions: plan.limits.monthlyTransactions,
          monthlyScreenshots: 500,
          monthlyVoiceNotes: 500,
          monthlyAiRequests: plan.limits.monthlyAiRequests,
          monthlyWhatsappMessages: plan.limits.monthlyWhatsappMessages,
          maxMembers: plan.limits.maxTeamMembers,
          maxProducts: plan.limits.maxProducts,
        };
        sub.features = { ...plan.features };
      }
      sub.statusHistory.push({
        from: prevStatus,
        to: 'ACTIVE',
        reason: notes || `Manual paid activation (${method})`,
        changedBy: adminUserId,
        timestamp: nowUtc,
      });

      await sub.save(sessionOpts(session));

      // Generate sequential invoice number VB-YYYY-NNNN
      await this._ensureCounter('invoice_seq', 1000000, session);
      const seq = await PlatformCounter.findOneAndUpdate(
        { _id: 'invoice_seq' },
        { $inc: { used: 1 } },
        { new: true, ...sessionOpts(session) },
      );
      const invoiceNumber = `VB-${nowUtc.getUTCFullYear()}-${String(seq.used).padStart(4, '0')}`;

      const [payment] = await SaasPayment.create(
        [
          {
            businessId,
            subscriptionId: sub._id,
            amountInPaise: finalAmount,
            currency: 'INR',
            method,
            status: 'CAPTURED',
            provider: 'MANUAL',
            referenceId,
            idempotencyKey: idempotencyKey || null,
            paidAt: nowUtc,
            recordedBy: adminUserId,
            notes,
          },
        ],
        sessionOpts(session),
      );

      const [invoice] = await Invoice.create(
        [
          {
            invoiceNumber,
            businessId,
            subscriptionId: sub._id,
            saasPaymentId: payment._id,
            currency: 'INR',
            subtotalInPaise: finalAmount,
            taxInPaise: 0,
            totalInPaise: finalAmount,
            periodStart: nowUtc,
            periodEnd,
            status: 'PAID',
            issuedAt: nowUtc,
            paidAt: nowUtc,
          },
        ],
        sessionOpts(session),
      );

      payment.invoiceId = invoice._id;
      await payment.save(sessionOpts(session));

      return { duplicate: false, payment, invoice, subscription: sub };
    });
  }

  /**
   * Exceptional trial extension (requires PLATFORM_ADMIN authorization & mandatory audit reason)
   */
  async extendTrial({ businessId, adminUserId, extraDays, reason }) {
    if (!reason || !String(reason).trim()) {
      throw makeAppError('Audit reason is required to extend a trial.', 400, 'REASON_REQUIRED');
    }
    const days = Number(extraDays);
    if (!Number.isFinite(days) || days <= 0) {
      throw makeAppError('extraDays must be greater than 0.', 400, 'INVALID_EXTENSION');
    }

    return runInTransaction(async (session) => {
      const sub = await Subscription.findOne({ businessId }, null, sessionOpts(session));
      if (!sub) {
        throw makeAppError('Subscription not found for business.', 404, 'SUBSCRIPTION_NOT_FOUND');
      }

      const nowUtc = new Date();
      const baseDate = sub.trialEndsAt && sub.trialEndsAt > nowUtc ? sub.trialEndsAt : nowUtc;
      const newEnd = new Date(baseDate.getTime() + days * DAY_MS);
      const prevStatus = sub.status;

      sub.trialEndsAt = newEnd;
      sub.expiryDate = newEnd;
      sub.status = 'TRIALING';
      sub.statusHistory.push({
        from: prevStatus,
        to: 'TRIALING',
        reason: `Trial extended by ${days} days: ${String(reason).trim()}`,
        changedBy: adminUserId,
        timestamp: nowUtc,
      });

      await sub.save(sessionOpts(session));
      return sub;
    });
  }

  /**
   * Suspend or revoke subscription access with mandatory reason (preserves all business data)
   */
  async suspendSubscription({ businessId, adminUserId, reason }) {
    if (!reason || !String(reason).trim()) {
      throw makeAppError('Suspension reason is required.', 400, 'REASON_REQUIRED');
    }

    return runInTransaction(async (session) => {
      const sub = await Subscription.findOne({ businessId }, null, sessionOpts(session));
      if (!sub) {
        throw makeAppError('Subscription not found for business.', 404, 'SUBSCRIPTION_NOT_FOUND');
      }
      const prevStatus = sub.status;
      sub.status = 'SUSPENDED';
      sub.statusHistory.push({
        from: prevStatus,
        to: 'SUSPENDED',
        reason: String(reason).trim(),
        changedBy: adminUserId,
        timestamp: new Date(),
      });
      await sub.save(sessionOpts(session));
      return sub;
    });
  }

  /**
   * Pilot programme summary (participants, UTC dates, remaining days, slots used)
   */
  async getPilotSummary() {
    const counter = await PlatformCounter.findById('pilot_slots');
    const maxSlots = counter?.limit ?? 3;
    const subs = await Subscription.find({ isPilotParticipant: true })
      .populate('businessId', 'name businessType status')
      .sort({ trialStartedAt: 1 });

    const nowMs = Date.now();
    const participants = subs.map((s) => {
      const endMs = s.trialEndsAt ? new Date(s.trialEndsAt).getTime() : 0;
      const remainingDays = endMs > nowMs ? Math.ceil((endMs - nowMs) / DAY_MS) : 0;
      return {
        subscriptionId: s._id,
        business: s.businessId,
        status: s.status,
        planCode: s.planCode,
        trialStartedAt: s.trialStartedAt,
        trialEndsAt: s.trialEndsAt,
        remainingDays,
        usageLimits: s.usageLimits,
        features: s.features,
        grantReason: s.grantReason,
        grantedBy: s.grantedBy,
      };
    });

    const slotsUsed = counter?.used ?? participants.length;
    return {
      maxSlots,
      slotsUsed,
      slotsRemaining: Math.max(0, maxSlots - slotsUsed),
      participants,
    };
  }

  /**
   * Explicitly change a business's subscription plan (audited; never silently alters other active subscriptions)
   */
  async changeSubscriptionPlan({ businessId, adminUserId, planCode, reason }) {
    if (!reason || !String(reason).trim()) {
      throw makeAppError('Audit reason is required to change plan.', 400, 'REASON_REQUIRED');
    }
    const cleanCode = String(planCode || '').trim().toUpperCase();
    const plan = await SubscriptionPlan.findOne({ code: cleanCode });
    if (!plan) {
      throw makeAppError('Subscription plan not found.', 404, 'PLAN_NOT_FOUND');
    }

    return runInTransaction(async (session) => {
      const sub = await Subscription.findOne({ businessId }, null, sessionOpts(session));
      if (!sub) {
        throw makeAppError('Subscription not found for business.', 404, 'SUBSCRIPTION_NOT_FOUND');
      }
      const prevPlan = sub.planCode || sub.plan;
      sub.subscriptionPlanId = plan._id;
      sub.planCode = plan.code;
      if (['TRIAL', 'PILOT', 'STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'].includes(plan.code)) {
        sub.plan = plan.code;
      }
      sub.usageLimits = {
        monthlyTransactions: plan.limits.monthlyTransactions,
        monthlyScreenshots: 500,
        monthlyVoiceNotes: 500,
        monthlyAiRequests: plan.limits.monthlyAiRequests,
        monthlyWhatsappMessages: plan.limits.monthlyWhatsappMessages,
        maxMembers: plan.limits.maxTeamMembers,
        maxProducts: plan.limits.maxProducts,
      };
      sub.features = { ...plan.features };
      sub.statusHistory.push({
        from: sub.status,
        to: sub.status,
        reason: `Plan changed from ${prevPlan} to ${plan.code}: ${String(reason).trim()}`,
        changedBy: adminUserId,
        timestamp: new Date(),
      });
      await sub.save(sessionOpts(session));
      return sub;
    });
  }

  /**
   * Safe Pre-SaaS Business Grandfathering (supports dryRun=true preview before applying)
   */
  async grandfatherPreSaaS({ dryRun = true, businessIds = null, adminUserId = null } = {}) {
    const filter = {};
    if (Array.isArray(businessIds) && businessIds.length > 0) {
      filter._id = { $in: businessIds };
    }

    const businesses = await Business.find(filter).sort({ createdAt: 1 });
    const subs = await Subscription.find({
      businessId: { $in: businesses.map((b) => b._id) },
    });
    const subMap = new Map(subs.map((s) => [String(s.businessId), s]));

    const report = {
      dryRun: Boolean(dryRun),
      totalInspected: businesses.length,
      alreadyExempt: [],
      pilotSkipped: [],
      missingSubscription: [],
      existingNonExempt: [],
      appliedCount: 0,
    };

    for (const biz of businesses) {
      const sub = subMap.get(String(biz._id));
      const item = { businessId: biz._id, name: biz.name, businessStatus: biz.status };
      if (sub?.billingExempt) {
        report.alreadyExempt.push(item);
      } else if (sub?.isPilotParticipant) {
        report.pilotSkipped.push(item);
      } else if (!sub) {
        report.missingSubscription.push(item);
      } else {
        report.existingNonExempt.push({
          ...item,
          currentPlan: sub.planCode || sub.plan,
          currentStatus: sub.status,
        });
      }
    }

    if (dryRun) {
      return report;
    }

    const toMigrateIds = [
      ...report.missingSubscription.map((x) => x.businessId),
      ...report.existingNonExempt.map((x) => x.businessId),
    ];

    if (toMigrateIds.length === 0) {
      return report;
    }

    await runInTransaction(async (session) => {
      const nowUtc = new Date();
      for (const bizId of toMigrateIds) {
        let sub = await Subscription.findOne({ businessId: bizId }, null, sessionOpts(session));
        const prevStatus = sub ? sub.status : null;
        if (!sub) {
          sub = new Subscription({ businessId: bizId });
        }
        if (sub.isPilotParticipant || sub.billingExempt) continue;

        sub.billingExempt = true;
        sub.migrationSource = 'PRE_SAAS';
        sub.activationSource = 'PRE_SAAS_GRANDFATHER';
        sub.status = 'ACTIVE';
        sub.grantedBy = adminUserId;
        sub.grantReason = 'Pre-SaaS business grandfathered';
        sub.statusHistory.push({
          from: prevStatus,
          to: 'ACTIVE',
          reason: 'Pre-SaaS business grandfathered (billingExempt: true)',
          changedBy: adminUserId,
          timestamp: nowUtc,
        });
        await sub.save(sessionOpts(session));
        report.appliedCount += 1;
      }
    });

    return report;
  }

  /**
   * Evaluate subscription status (auto-expiring elapsed TRIALING subscriptions in UTC)
   * and compute readOnly vs full access.
   */
  async evaluateSubscriptionAccess(businessId) {
    const sub = await Subscription.findOne({ businessId });
    if (!sub) {
      // Legacy business without Subscription doc retains access until migrated
      return {
        allowedWrite: true,
        readOnly: false,
        reasonCode: null,
        subscription: null,
      };
    }

    const nowUtc = new Date();

    if (sub.billingExempt) {
      return { allowedWrite: true, readOnly: false, reasonCode: null, subscription: sub };
    }

    // 1. Auto-transition elapsed TRIALING -> EXPIRED
    if (sub.status === 'TRIALING' && sub.trialEndsAt && nowUtc >= sub.trialEndsAt) {
      const prev = sub.status;
      sub.status = 'EXPIRED';
      sub.statusHistory.push({
        from: prev,
        to: 'EXPIRED',
        reason: '30-day pilot trial expired (UTC)',
        changedBy: null,
        timestamp: nowUtc,
      });
      await sub.save();
    }

    // 2. Auto-transition elapsed PAST_DUE grace period -> SUSPENDED
    if (sub.status === 'PAST_DUE' && sub.gracePeriodEndsAt && nowUtc >= sub.gracePeriodEndsAt) {
      const prev = sub.status;
      sub.status = 'SUSPENDED';
      sub.statusHistory.push({
        from: prev,
        to: 'SUSPENDED',
        reason: 'Grace period elapsed without payment (UTC)',
        changedBy: null,
        timestamp: nowUtc,
      });
      await sub.save();
    }

    // 3. Preserve CANCELLED access until paid-through currentPeriodEnd; expire thereafter
    if (sub.status === 'CANCELLED') {
      if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd && nowUtc < sub.currentPeriodEnd) {
        return { allowedWrite: true, readOnly: false, reasonCode: null, subscription: sub };
      }
      if (sub.currentPeriodEnd && nowUtc >= sub.currentPeriodEnd) {
        sub.status = 'EXPIRED';
        sub.statusHistory.push({
          from: 'CANCELLED',
          to: 'EXPIRED',
          reason: 'Paid-through period ended after cancellation (UTC)',
          changedBy: null,
          timestamp: nowUtc,
        });
        await sub.save();
      }
    }

    // 4. Auto-transition elapsed ACTIVE period -> EXPIRED (when currentPeriodEnd is explicitly set)
    if (sub.status === 'ACTIVE' && sub.currentPeriodEnd && nowUtc >= sub.currentPeriodEnd) {
      sub.status = 'EXPIRED';
      sub.statusHistory.push({
        from: 'ACTIVE',
        to: 'EXPIRED',
        reason: 'Billing period ended without renewal (UTC)',
        changedBy: null,
        timestamp: nowUtc,
      });
      await sub.save();
    }

    if (['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(sub.status)) {
      return { allowedWrite: true, readOnly: false, reasonCode: null, subscription: sub };
    }

    const reasonCode =
      sub.status === 'EXPIRED'
        ? 'SUBSCRIPTION_EXPIRED'
        : sub.status === 'SUSPENDED'
          ? 'SUBSCRIPTION_SUSPENDED'
          : 'SUBSCRIPTION_INACTIVE';

    return {
      allowedWrite: false,
      readOnly: true,
      reasonCode,
      subscription: sub,
    };
  }

  async incrementUsage(businessId, field, amount = 1) {
    const periodKey = getUtcPeriodKey();
    return UsageRecord.findOneAndUpdate(
      { businessId, periodKey },
      {
        $inc: { [field]: amount },
        $set: { lastUpdatedAt: new Date() },
      },
      { upsert: true, new: true },
    );
  }

  /**
   * Atomically check and consume 1 unit of monthly usage quota (e.g. aiRequestsCount, whatsappMessagesCount).
   * Safe under concurrent requests.
   */
  async consumeUsageQuota(businessId, field, limitField) {
    const sub = await Subscription.findOne({ businessId });
    const max = sub && !sub.billingExempt ? (sub.usageLimits?.[limitField] ?? -1) : -1;
    const periodKey = getUtcPeriodKey();

    // Ensure doc exists
    try {
      await UsageRecord.findOneAndUpdate(
        { businessId, periodKey },
        { $setOnInsert: { businessId, periodKey, lastUpdatedAt: new Date() } },
        { upsert: true },
      );
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }

    if (max < 0) {
      return this.incrementUsage(businessId, field, 1);
    }

    const updated = await UsageRecord.findOneAndUpdate(
      { businessId, periodKey, [field]: { $lt: max } },
      { $inc: { [field]: 1 }, $set: { lastUpdatedAt: new Date() } },
      { new: true },
    );
    if (!updated) {
      throw makeAppError(
        `Monthly quota (${max}) reached for ${limitField}.`,
        403,
        'USAGE_LIMIT_REACHED',
      );
    }
    return updated;
  }

  async checkFeatureEnabled(businessId, featureKey) {
    const sub = await Subscription.findOne({ businessId });
    if (!sub || sub.billingExempt) return;
    if (sub.features && sub.features[featureKey] === false) {
      throw makeAppError(
        `Feature "${featureKey}" is not enabled on your current plan.`,
        403,
        'FEATURE_NOT_IN_PLAN',
      );
    }
  }

  async getUsageSummary(businessId) {
    const periodKey = getUtcPeriodKey();
    const [sub, usage, memberCount, productCount] = await Promise.all([
      Subscription.findOne({ businessId }),
      UsageRecord.findOne({ businessId, periodKey }),
      BusinessMember.countDocuments({ businessId, status: { $ne: 'REVOKED' } }),
      Product.countDocuments({ businessId, status: 'ACTIVE' }),
    ]);

    const limits = sub?.usageLimits || {
      maxMembers: 5,
      maxProducts: 500,
      monthlyAiRequests: 500,
      monthlyWhatsappMessages: 1000,
    };
    const counts = {
      teamMembers: memberCount,
      products: productCount,
      aiRequests: usage?.aiRequestsCount || 0,
      whatsappMessages: usage?.whatsappMessagesCount || 0,
    };

    const warnings = [];
    const limitReached = [];
    const checkWarn = (key, current, max) => {
      if (max > 0) {
        const pct = Math.round((current / max) * 100);
        if (current >= max) {
          limitReached.push({ resource: key, current, limit: max, pct });
        } else if (current / max >= 0.8) {
          warnings.push({ resource: key, current, limit: max, pct });
        }
      }
    };
    checkWarn('teamMembers', counts.teamMembers, limits.maxMembers);
    checkWarn('products', counts.products, limits.maxProducts);
    checkWarn('aiRequests', counts.aiRequests, limits.monthlyAiRequests);
    checkWarn('whatsappMessages', counts.whatsappMessages, limits.monthlyWhatsappMessages);

    return { periodKey, limits, counts, warnings, limitReached };
  }

  async checkTeamMemberLimit(businessId) {
    const sub = await Subscription.findOne({ businessId });
    if (!sub || sub.billingExempt) return;
    const maxMembers = sub.usageLimits?.maxMembers ?? 5;
    if (maxMembers < 0) return;
    const currentCount = await BusinessMember.countDocuments({
      businessId,
      status: { $ne: 'REVOKED' },
    });
    if (currentCount >= maxMembers) {
      throw makeAppError(
        `Team member limit (${maxMembers}) reached for your current plan.`,
        403,
        'PLAN_LIMIT_EXCEEDED',
      );
    }
  }

  async checkProductLimit(businessId) {
    const sub = await Subscription.findOne({ businessId });
    if (!sub || sub.billingExempt) return;
    const maxProducts = sub.usageLimits?.maxProducts ?? 500;
    if (maxProducts < 0) return;
    const currentCount = await Product.countDocuments({ businessId, status: 'ACTIVE' });
    if (currentCount >= maxProducts) {
      throw makeAppError(
        `Product limit (${maxProducts}) reached for your current plan.`,
        403,
        'PLAN_LIMIT_EXCEEDED',
      );
    }
  }
}

export const subscriptionService = new SubscriptionService();
