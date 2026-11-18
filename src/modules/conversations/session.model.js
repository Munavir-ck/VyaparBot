import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    whatsappNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      index: true,
    },
    currentIntent: {
      type: String,
      default: 'IDLE',
    },
    detectedLanguage: {
      type: String,
      enum: ['en', 'ml', 'manglish', 'mixed'],
      default: 'en',
    },
    pendingTransaction: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    pendingConfirmation: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    lastReferencedTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    conversationContext: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastInteractionAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

export const ConversationSession =
  mongoose.models.ConversationSession ||
  mongoose.model('ConversationSession', sessionSchema);
