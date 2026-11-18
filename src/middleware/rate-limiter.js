import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const rateLimitBucketSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    count: {
      type: Number,
      required: true,
      default: 0,
    },
    resetAt: {
      type: Date,
      required: true,
    },
  },
  { versionKey: false },
);

// Automatically expire stale buckets in MongoDB
rateLimitBucketSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitBucket =
  mongoose.models.RateLimitBucket || mongoose.model('RateLimitBucket', rateLimitBucketSchema);

export class MemoryRateLimitStore {
  constructor() {
    this.buckets = new Map();
  }

  async increment(key, windowMs) {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const next = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, next);
      return next;
    }
    existing.count += 1;
    return existing;
  }

  reset() {
    this.buckets.clear();
  }
}

export class MongoRateLimitStore {
  constructor(fallbackStore = new MemoryRateLimitStore()) {
    this.fallbackStore = fallbackStore;
  }

  async increment(key, windowMs) {
    if (mongoose.connection.readyState !== 1) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Shared MongoDB rate-limit store unavailable in production');
      }
      return this.fallbackStore.increment(key, windowMs);
    }

    const now = new Date();
    const nextResetAt = new Date(now.getTime() + windowMs);

    // 1. Reset expired bucket if one exists
    const resetDoc = await RateLimitBucket.findOneAndUpdate(
      { key, resetAt: { $lte: now } },
      { $set: { count: 1, resetAt: nextResetAt } },
      { new: true },
    );
    if (resetDoc) {
      return { count: resetDoc.count, resetAt: resetDoc.resetAt.getTime() };
    }

    // 2. Increment active bucket or atomically insert new one
    try {
      const doc = await RateLimitBucket.findOneAndUpdate(
        { key },
        {
          $inc: { count: 1 },
          $setOnInsert: { resetAt: nextResetAt },
        },
        { upsert: true, new: true },
      );
      return { count: doc.count, resetAt: doc.resetAt.getTime() };
    } catch (err) {
      // Handle concurrent first-insert E11000 race cleanly
      if (err?.code === 11000) {
        const doc = await RateLimitBucket.findOneAndUpdate(
          { key },
          { $inc: { count: 1 } },
          { new: true },
        );
        if (doc) {
          return { count: doc.count, resetAt: doc.resetAt.getTime() };
        }
      }
      throw err;
    }
  }
}

export const defaultMemoryStore = new MemoryRateLimitStore();
export const defaultMongoStore = new MongoRateLimitStore(defaultMemoryStore);

/**
 * Extract normalized client IP using Express's trust-proxy-aware req.ip.
 * Arbitrary X-Forwarded-For headers are ignored unless Express trust proxy is configured.
 */
export function getClientIp(req) {
  const raw = req.ip || req.socket?.remoteAddress || 'unknown';
  return String(raw).replace(/^::ffff:/, '');
}

/**
 * Create an Express rate-limiting middleware backed by shared MongoDB store (or memory store).
 */
export function createRateLimiter({
  name = 'api',
  windowMs = 15 * 60 * 1000,
  max = 300,
  keyGenerator = null,
  store = null,
  message = 'Too many requests. Please try again later.',
} = {}) {
  return async function rateLimitMiddleware(req, res, next) {
    try {
      const resolvedMax = typeof max === 'function' ? max(req) : max;
      const resolvedWindow = typeof windowMs === 'function' ? windowMs(req) : windowMs;
      const activeStore =
        store || (env.RATE_LIMIT_STORE === 'memory' ? defaultMemoryStore : defaultMongoStore);

      const clientKey = keyGenerator ? keyGenerator(req) : getClientIp(req);
      const bucketKey = `rl:${name}:${clientKey}`;

      const { count, resetAt } = await activeStore.increment(bucketKey, resolvedWindow);
      const remaining = Math.max(0, resolvedMax - count);
      const resetSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

      res.setHeader('RateLimit-Limit', String(resolvedMax));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(resetSeconds));

      if (count > resolvedMax) {
        res.setHeader('Retry-After', String(resetSeconds));
        logger.warn({ limiter: name, clientKey, count, max: resolvedMax }, 'Rate limit exceeded');
        return res.status(429).json({
          status: 'fail',
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          retryAfterSeconds: resetSeconds,
        });
      }

      return next();
    } catch (err) {
      logger.error({ err: err.message, limiter: name }, 'Rate limiter error');
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({
          status: 'fail',
          code: 'RATE_LIMIT_UNAVAILABLE',
          message: 'Service temporarily unavailable',
        });
      }
      return next();
    }
  };
}

export const apiLimiter = createRateLimiter({
  name: 'api_global',
  windowMs: () => Number(process.env.RATE_LIMIT_API_WINDOW_MS || env.RATE_LIMIT_API_WINDOW_MS),
  max: () => Number(process.env.RATE_LIMIT_API_MAX || env.RATE_LIMIT_API_MAX),
  message: 'Too many API requests from this client. Please slow down.',
});

export const otpRequestLimiter = createRateLimiter({
  name: 'auth_otp_request',
  windowMs: () =>
    Number(process.env.RATE_LIMIT_OTP_REQUEST_WINDOW_MS || env.RATE_LIMIT_OTP_REQUEST_WINDOW_MS),
  max: () => Number(process.env.RATE_LIMIT_OTP_REQUEST_MAX || env.RATE_LIMIT_OTP_REQUEST_MAX),
  message: 'Too many OTP requests from this IP. Please try again later.',
});

export const otpVerifyLimiter = createRateLimiter({
  name: 'auth_otp_verify',
  windowMs: () =>
    Number(process.env.RATE_LIMIT_OTP_VERIFY_WINDOW_MS || env.RATE_LIMIT_OTP_VERIFY_WINDOW_MS),
  max: () => Number(process.env.RATE_LIMIT_OTP_VERIFY_MAX || env.RATE_LIMIT_OTP_VERIFY_MAX),
  message: 'Too many OTP verification attempts. Please try again later.',
});

export const logoutLimiter = createRateLimiter({
  name: 'auth_logout',
  windowMs: () => Number(process.env.RATE_LIMIT_API_WINDOW_MS || env.RATE_LIMIT_API_WINDOW_MS),
  max: () => Number(process.env.RATE_LIMIT_LOGOUT_MAX || 30),
  message: 'Too many logout requests. Please try again later.',
});

export const mutationLimiter = createRateLimiter({
  name: 'sensitive_mutation',
  windowMs: () =>
    Number(process.env.RATE_LIMIT_MUTATION_WINDOW_MS || env.RATE_LIMIT_MUTATION_WINDOW_MS),
  max: () => Number(process.env.RATE_LIMIT_MUTATION_MAX || env.RATE_LIMIT_MUTATION_MAX),
  keyGenerator: (req) => {
    const ip = getClientIp(req);
    const userId = req.user?._id ? String(req.user._id) : null;
    return userId ? `${ip}:u:${userId}` : ip;
  },
  message: 'Too many write operations in a short period. Please wait a moment.',
});

export const webhookLimiter = createRateLimiter({
  name: 'whatsapp_webhook',
  windowMs: () =>
    Number(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS || env.RATE_LIMIT_WEBHOOK_WINDOW_MS),
  max: () => Number(process.env.RATE_LIMIT_WEBHOOK_MAX || env.RATE_LIMIT_WEBHOOK_MAX),
  message: 'Webhook rate limit exceeded.',
});
