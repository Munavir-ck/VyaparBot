import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
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
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    totalCreditSales: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPaymentsReceived: {
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

customerSchema.index({ businessId: 1, normalizedName: 1 }, { unique: true });

customerSchema.pre('validate', function (next) {
  if (this.name && !this.normalizedName) {
    this.normalizedName = this.name.trim().toLowerCase();
  }
  next();
});

export const Customer =
  mongoose.models.Customer || mongoose.model('Customer', customerSchema);

