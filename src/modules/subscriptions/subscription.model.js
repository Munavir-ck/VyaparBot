import mongoose from 'mongoose';

export const SUBSCRIPTION_STATUSES = [
  'PENDING',
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
];

export const ACTIVATION_SOURCES = [
  'MANUAL_PILOT',
  'MANUAL_PAID',
  'SELF_SERVE',
  'GATEWAY',
  'PRE_SAAS_GRANDFATHER',
  null,
];

const statusHistoryEntrySchema = new mongoose.Schema(
  {
    from: { type: String, default: null },
    to: { type: String, required: true },
    reason: { type: String, default: '' },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const subscriptionSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      unique: true,
      index: true,
    },
    subscriptionPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SubscriptionPlan',
      default: null,
    },
    plan: {
      type: String,
      enum: ['TRIAL', 'PILOT', 'STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'],
      default: 'TRIAL',
    },
    planCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: 'TRIAL',
    },
    status: {
      type: String,
      enum: SUBSCRIPTION_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    isComplimentary: {
      type: Boolean,
      default: false,
    },
    isPilotParticipant: {
      type: Boolean,
      default: false,
      index: true,
    },
    billingExempt: {
      type: Boolean,
      default: false,
      index: true,
    },
    migrationSource: {
      type: String,
      enum: ['PRE_SAAS', 'PILOT', 'STANDARD', null],
      default: null,
    },
    activationSource: {
      type: String,
      enum: ACTIVATION_SOURCES,
      default: null,
    },
    grantedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    grantReason: {
      type: String,
      trim: true,
      default: '',
    },
    trialStartedAt: {
      type: Date,
      default: null,
    },
    trialEndsAt: {
      type: Date,
      default: null,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    expiryDate: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    currentPeriodStart: {
      type: Date,
      default: null,
    },
    currentPeriodEnd: {
      type: Date,
      default: null,
    },
    gracePeriodEndsAt: {
      type: Date,
      default: null,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    usageLimits: {
      monthlyTransactions: { type: Number, default: 5000 },
      monthlyScreenshots: { type: Number, default: 500 },
      monthlyVoiceNotes: { type: Number, default: 500 },
      monthlyAiRequests: { type: Number, default: 500 },
      monthlyWhatsappMessages: { type: Number, default: 1000 },
      maxMembers: { type: Number, default: 5 },
      maxProducts: { type: Number, default: 500 },
    },
    features: {
      whatsappAssistant: { type: Boolean, default: true },
      voiceAndScreenshotAi: { type: Boolean, default: true },
      inventoryManagement: { type: Boolean, default: true },
      customerManagement: { type: Boolean, default: true },
      supplierManagement: { type: Boolean, default: true },
      financialReports: { type: Boolean, default: true },
      advancedReports: { type: Boolean, default: true },
      csvExport: { type: Boolean, default: true },
    },
    statusHistory: {
      type: [statusHistoryEntrySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });
subscriptionSchema.index({ billingExempt: 1, migrationSource: 1 });

export const Subscription =
  mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
