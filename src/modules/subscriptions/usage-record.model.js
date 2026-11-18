import mongoose from 'mongoose';

const usageRecordSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    periodKey: {
      type: String,
      required: true,
      trim: true,
    },
    aiRequestsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    whatsappMessagesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    transactionsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    screenshotsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    voiceNotesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

usageRecordSchema.index({ businessId: 1, periodKey: 1 }, { unique: true });

export const UsageRecord =
  mongoose.models.UsageRecord || mongoose.model('UsageRecord', usageRecordSchema);
