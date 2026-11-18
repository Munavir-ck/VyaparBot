import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
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
    sku: {
      type: String,
      trim: true,
      default: null,
    },
    category: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'OTHER',
      index: true,
    },
    unit: {
      type: String,
      trim: true,
      lowercase: true,
      default: 'pcs',
    },
    currentStock: {
      type: Number,
      default: 0,
    },
    minStockLevel: {
      type: Number,
      default: 0,
      min: 0,
    },
    costPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    sellingPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    trackInventory: {
      type: Boolean,
      default: true,
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

productSchema.index({ businessId: 1, normalizedName: 1 }, { unique: true });
productSchema.index({ businessId: 1, status: 1, currentStock: 1 });

productSchema.pre('validate', function (next) {
  if (this.name && !this.normalizedName) {
    this.normalizedName = this.name.trim().toLowerCase();
  }
  next();
});

export const Product =
  mongoose.models.Product || mongoose.model('Product', productSchema);

