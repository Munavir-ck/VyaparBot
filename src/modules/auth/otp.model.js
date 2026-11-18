import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema(
  {
    whatsappNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    used: {
      type: Boolean,
      default: false,
    },
    requestCount: {
      type: Number,
      default: 1,
    },
    windowStart: {
      type: Date,
      default: Date.now,
    },
    lastRequestedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

export const OtpChallenge =
  mongoose.models.OtpChallenge || mongoose.model('OtpChallenge', otpSchema);

