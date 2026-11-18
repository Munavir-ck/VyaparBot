import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    category: {
      type: String,
      trim: true,
      default: 'GENERAL',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    totalPurchases: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPayments: {
      type: Number,
      default: 0,
      min: 0,
    },
    outstandingBalance: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'],
      default: 'ACTIVE',
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

supplierSchema.index({ businessId: 1, normalizedName: 1 }, { unique: true });

supplierSchema.pre('validate', function (next) {
  if (this.name && !this.normalizedName) {
    this.normalizedName = this.name.trim().toLowerCase();
  }
  next();
});

export const Supplier =
  mongoose.models.Supplier || mongoose.model('Supplier', supplierSchema);

