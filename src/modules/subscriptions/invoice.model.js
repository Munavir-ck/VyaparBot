import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
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
    },
    saasPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SaasPayment',
      default: null,
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },
    subtotalInPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    taxInPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalInPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['ISSUED', 'PAID', 'VOID'],
      default: 'PAID',
      index: true,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

invoiceSchema.index({ businessId: 1, issuedAt: -1 });

export const Invoice =
  mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);
