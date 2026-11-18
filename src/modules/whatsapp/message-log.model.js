import mongoose from 'mongoose';

const messageLogSchema = new mongoose.Schema(
  {
    whatsappMessageId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      default: null,
      index: true,
    },
    sender: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    messageType: {
      type: String,
      default: 'text',
    },
    processingStatus: {
      type: String,
      enum: ['RECEIVED', 'PROCESSING', 'PROCESSED', 'DUPLICATE', 'FAILED', 'IGNORED'],
      default: 'RECEIVED',
      index: true,
    },
    extractedData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

export const MessageLog =
  mongoose.models.MessageLog || mongoose.model('MessageLog', messageLogSchema);

