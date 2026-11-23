import mongoose from 'mongoose';

export const ALL_BUSINESS_TYPES = [
  'RESTAURANT',
  'GROCERY',
  'RETAIL',
  'WHOLESALE',
  'GENERAL',
  'ELECTRONICS',
  'CLOTHING',
  'PHARMACY',
  'SERVICE',
  'FREELANCER',
  'CAFE',
  'BAKERY',
  'CLOUD_KITCHEN',
  'CATERING',
  'OTHER',
];

const businessSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      default: 'My Business',
    },
    businessType: {
      type: String,
      enum: ALL_BUSINESS_TYPES,
      default: 'RESTAURANT',
      index: true,
    },
    businessCategory: {
      type: String,
      trim: true,
      default: 'FOOD_AND_BEVERAGE',
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },
    address: {
      type: String,
      trim: true,
      default: 'Kerala, India',
    },
    settings: {
      modules: {
        finance: {
          enabled: { type: Boolean, default: true },
        },
        inventory: {
          enabled: { type: Boolean },
        },
        purchases: {
          enabled: { type: Boolean },
        },
        customers: {
          enabled: { type: Boolean },
        },
      },
      moduleAuditLog: {
        type: [
          {
            moduleKey: { type: String, required: true },
            previousEnabled: { type: Boolean, required: true },
            nextEnabled: { type: Boolean, required: true },
            changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
            reason: { type: String, trim: true, default: '' },
            changedAt: { type: Date, default: Date.now },
          },
        ],
        default: [],
      },
      enabledModules: {
        moneyManagement: { type: Boolean, default: true },
        inventoryManagement: { type: Boolean, default: true },
      },
      inventory: {
        autoDeductOnItemizedSale: { type: Boolean, default: true },
        autoDeductOnLumpSumSale: { type: Boolean, default: false },
        allowNegativeStock: { type: Boolean, default: false },
      },
      customExpenseCategories: {
        type: [String],
        default: [],
      },
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'],
      default: 'ACTIVE',
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

businessSchema.index({ ownerId: 1, status: 1 });

export const Business = mongoose.models.Business || mongoose.model('Business', businessSchema);
