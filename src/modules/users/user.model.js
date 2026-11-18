import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    whatsappNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
      default: 'Restaurant Owner',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'ONBOARDING', 'INACTIVE', 'PAUSED', 'SUSPENDED', 'DELETED'],
      default: 'ACTIVE',
      index: true,
    },
    role: {
      type: String,
      enum: ['OWNER', 'MANAGER', 'STAFF', 'USER', 'ADMIN', 'PLATFORM_ADMIN'],
      default: 'OWNER',
    },
    consentGiven: {
      type: Boolean,
      default: true,
    },
    consentTimestamp: {
      type: Date,
      default: Date.now,
    },
    preferredLanguage: {
      type: String,
      enum: ['auto', 'en', 'ml', 'manglish'],
      default: 'auto',
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

export const User = mongoose.models.User || mongoose.model('User', userSchema);
