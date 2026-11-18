import mongoose from 'mongoose';

const platformCounterSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    used: {
      type: Number,
      default: 0,
      min: 0,
    },
    limit: {
      type: Number,
      default: 3,
      min: 0,
    },
  },
  { timestamps: true },
);

export const PlatformCounter =
  mongoose.models.PlatformCounter || mongoose.model('PlatformCounter', platformCounterSchema);
