import mongoose from 'mongoose';
import { PAYMENT_METHODS } from '../transactions/transaction.model.js';

const paymentRecordSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ['OUTGOING', 'INCOMING'],
      default: 'OUTGOING',
      index: true,
    },
    relatedTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
      index: true,
    },
    purchaseTransactionIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
      },
    ],
    relatedSaleTransactionIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
      },
    ],
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      default: null,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: 'CASH',
    },
    paymentDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    referenceId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['COMPLETED', 'PENDING', 'FAILED', 'VOIDED'],
      default: 'COMPLETED',
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  },
);

paymentRecordSchema.index({ businessId: 1, supplierId: 1, paymentDate: -1 });
paymentRecordSchema.index({ businessId: 1, customerId: 1, paymentDate: -1 });
paymentRecordSchema.index(
  { businessId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export const PaymentRecord =
  mongoose.models.PaymentRecord || mongoose.model('PaymentRecord', paymentRecordSchema);
