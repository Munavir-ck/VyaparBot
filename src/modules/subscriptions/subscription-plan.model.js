import mongoose from 'mongoose';

const subscriptionPlanSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },
    monthlyPriceInPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    billingInterval: {
      type: String,
      enum: ['MONTHLY'],
      default: 'MONTHLY',
    },
    trialDays: {
      type: Number,
      default: 30,
      min: 0,
    },
    gracePeriodDays: {
      type: Number,
      default: 7,
      min: 0,
    },
    limits: {
      maxTeamMembers: { type: Number, default: 5 },
      maxProducts: { type: Number, default: 500 },
      monthlyAiRequests: { type: Number, default: 500 },
      monthlyWhatsappMessages: { type: Number, default: 1000 },
      monthlyTransactions: { type: Number, default: 5000 },
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
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

subscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });

export const SubscriptionPlan =
  mongoose.models.SubscriptionPlan || mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
