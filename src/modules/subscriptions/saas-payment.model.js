import mongoose from 'mongoose';

const saasPaymentSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      required: true,
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
    },
    amountInPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },
    method: {
      type: String,
      enum: ['MANUAL_UPI', 'MANUAL_BANK', 'MANUAL_CASH', 'RAZORPAY'],
      default: 'MANUAL_UPI',
    },
    status: {
      type: String,
      enum: ['PENDING', 'CAPTURED', 'FAILED', 'REFUNDED'],
      default: 'CAPTURED',
      index: true,
    },
    provider: {
      type: String,
      default: 'MANUAL',
    },
    providerPaymentId: {
      type: String,
      trim: true,
      default: null,
    },
    referenceId: {
      type: String,
      trim: true,
      default: null,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    paidAt: {
      type: Date,
      default: Date.now,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true },
);

saasPaymentSchema.index({ businessId: 1, createdAt: -1 });
saasPaymentSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
saasPaymentSchema.index(
  { provider: 1, providerPaymentId: 1 },
  { unique: true, partialFilterExpression: { providerPaymentId: { $type: 'string' } } },
);

export const SaasPayment =
  mongoose.models.SaasPayment || mongoose.model('SaasPayment', saasPaymentSchema);
