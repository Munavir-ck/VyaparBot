import mongoose from 'mongoose';

export const TRANSACTION_TYPES = [
  'SALE',
  'EXPENSE',
  'PURCHASE',
  'SUPPLIER_PAYMENT',
  'CUSTOMER_PAYMENT',
  'CUSTOMER_REFUND',
  'OWNER_WITHDRAWAL',
  'ADJUSTMENT',
];

export const PAYMENT_METHODS = [
  'CASH',
  'UPI',
  'CARD',
  'BANK_TRANSFER',
  'CREDIT',
  'SPLIT',
  'OTHER',
  'UNKNOWN',
];

export const EXPENSE_CATEGORIES = [
  'VEGETABLES',
  'MEAT_FISH',
  'GROCERIES',
  'GAS',
  'ELECTRICITY',
  'STAFF_WAGES',
  'RENT',
  'MAINTENANCE',
  'TRANSPORTATION',
  'STOCK_PURCHASE',
  'PACKAGING',
  'SUPPLIES',
  'MARKETING',
  'WAREHOUSE_RENT',
  'LOADING_UNLOADING',
  'OTHER_EXPENSE',
];

export const SALE_CATEGORIES = [
  'DAILY_SALES',
  'MORNING_SALES',
  'AFTERNOON_SALES',
  'EVENING_SALES',
  'CASH_SALES',
  'UPI_SALES',
  'CREDIT_SALES',
  'GENERAL_SALES',
];

export const ALL_CATEGORIES = [
  ...EXPENSE_CATEGORIES,
  ...SALE_CATEGORIES,
  'SUPPLIER_PURCHASE',
  'SUPPLIER_PAYMENT',
  'CUSTOMER_PAYMENT',
  'REFUND',
  'WITHDRAWAL',
  'ADJUSTMENT',
  'OTHER',
];

const lineItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    productName: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    unit: {
      type: String,
      trim: true,
      default: 'pcs',
    },
    unitPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false },
);

const auditEntrySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['CREATED', 'UPDATED', 'VOIDED', 'DELETED'],
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    previousValues: {
      type: mongoose.Schema.Types.Mixed,
    },
    newValues: {
      type: mongoose.Schema.Types.Mixed,
    },
    reason: {
      type: String,
    },
  },
  { _id: false },
);

const transactionSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: TRANSACTION_TYPES,
      required: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      default: 'OTHER',
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: 'UNKNOWN',
      index: true,
    },
    paymentBreakdown: {
      cash: { type: Number, default: 0, min: 0 },
      upi: { type: Number, default: 0, min: 0 },
      card: { type: Number, default: 0, min: 0 },
      bankTransfer: { type: Number, default: 0, min: 0 },
      credit: { type: Number, default: 0, min: 0 },
      unreconciled: { type: Number, default: 0 },
    },
    salePeriod: {
      type: String,
      enum: ['FULL_DAY', 'MORNING', 'AFTERNOON', 'EVENING', 'SINGLE', null],
      default: null,
    },
    items: {
      type: [lineItemSchema],
      default: [],
    },
    isLumpSum: {
      type: Boolean,
      default: true,
    },
    stockSynced: {
      type: Boolean,
      default: false,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      default: null,
      index: true,
    },
    supplierName: {
      type: String,
      trim: true,
      default: null,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    customerName: {
      type: String,
      trim: true,
      default: null,
    },
    transactionDate: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    source: {
      type: String,
      enum: ['TEXT', 'VOICE', 'SCREENSHOT', 'API', 'MANUAL'],
      default: 'TEXT',
    },
    referenceId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    imageHash: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['COMPLETED', 'PENDING', 'FAILED', 'VOIDED', 'DELETED'],
      default: 'COMPLETED',
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    auditHistory: {
      type: [auditEntrySchema],
      default: [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

transactionSchema.index({ businessId: 1, transactionDate: -1, status: 1 });
transactionSchema.index({ businessId: 1, type: 1, transactionDate: -1 });
transactionSchema.index(
  { businessId: 1, referenceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      referenceId: { $type: 'string', $gt: '' },
      status: { $in: ['COMPLETED', 'PENDING'] },
    },
  },
);

export const Transaction =
  mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
