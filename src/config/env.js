import crypto from 'crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const EPHEMERAL_DEV_SECRET = crypto.randomBytes(32).toString('hex');

export function parseTrustProxy(val) {
  if (val === undefined || val === null || val === '' || val === 'false' || val === '0') {
    return false;
  }
  if (val === 'true') return true;
  const num = Number(val);
  if (!Number.isNaN(num) && Number.isInteger(num) && num >= 0) {
    return num;
  }
  return String(val);
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  isTest: process.env.NODE_ENV === 'test',
  SESSION_SECRET: process.env.SESSION_SECRET || EPHEMERAL_DEV_SECRET,
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3001',
  TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY),

  // Rate Limiting
  RATE_LIMIT_STORE:
    process.env.RATE_LIMIT_STORE || (process.env.NODE_ENV === 'production' ? 'mongo' : 'mongo'),
  RATE_LIMIT_API_WINDOW_MS: parseInt(process.env.RATE_LIMIT_API_WINDOW_MS || '900000', 10),
  RATE_LIMIT_API_MAX: parseInt(process.env.RATE_LIMIT_API_MAX || '300', 10),
  RATE_LIMIT_OTP_REQUEST_WINDOW_MS: parseInt(
    process.env.RATE_LIMIT_OTP_REQUEST_WINDOW_MS || '900000',
    10,
  ),
  RATE_LIMIT_OTP_REQUEST_MAX: parseInt(process.env.RATE_LIMIT_OTP_REQUEST_MAX || '10', 10),
  RATE_LIMIT_OTP_VERIFY_WINDOW_MS: parseInt(
    process.env.RATE_LIMIT_OTP_VERIFY_WINDOW_MS || '900000',
    10,
  ),
  RATE_LIMIT_OTP_VERIFY_MAX: parseInt(process.env.RATE_LIMIT_OTP_VERIFY_MAX || '15', 10),
  RATE_LIMIT_MUTATION_WINDOW_MS: parseInt(process.env.RATE_LIMIT_MUTATION_WINDOW_MS || '60000', 10),
  RATE_LIMIT_MUTATION_MAX: parseInt(process.env.RATE_LIMIT_MUTATION_MAX || '60', 10),
  RATE_LIMIT_WEBHOOK_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS || '60000', 10),
  RATE_LIMIT_WEBHOOK_MAX: parseInt(process.env.RATE_LIMIT_WEBHOOK_MAX || '600', 10),

  // Database
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/restaurant_money_management',

  // WhatsApp Cloud API
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  WHATSAPP_BUSINESS_ACCOUNT_ID: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || 'restaurant_verify_token',
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET || '',
  WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION || 'v21.0',
  WHATSAPP_API_BASE_URL: process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com',

  // AI Integration (OpenAI or Groq / OpenAI-compatible)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '',
  AI_BASE_URL: process.env.AI_BASE_URL || '',
  AI_TEXT_MODEL: process.env.AI_TEXT_MODEL || '',
  AI_VISION_MODEL: process.env.AI_VISION_MODEL || '',
  AI_VOICE_MODEL: process.env.AI_VOICE_MODEL || '',

  // Object Storage
  STORAGE_BUCKET: process.env.STORAGE_BUCKET || '',
  STORAGE_REGION: process.env.STORAGE_REGION || 'ap-south-1',
  STORAGE_ACCESS_KEY: process.env.STORAGE_ACCESS_KEY || '',
  STORAGE_SECRET_KEY: process.env.STORAGE_SECRET_KEY || '',
  STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT || '',

  // Restaurant Defaults
  DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
  DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY || 'INR',
};

/**
 * Validate mandatory security & infrastructure configuration in production.
 * Fails fast if any required secret or connection setting is missing or weak.
 */
export function validateProductionEnv(targetEnv = process.env) {
  if (targetEnv.NODE_ENV !== 'production') return { valid: true, errors: [] };

  const errors = [];
  if (!targetEnv.SESSION_SECRET || targetEnv.SESSION_SECRET.length < 32) {
    errors.push('SESSION_SECRET must be set and at least 32 characters in production.');
  }
  if (!targetEnv.WHATSAPP_APP_SECRET) {
    errors.push('WHATSAPP_APP_SECRET is required in production.');
  }
  if (
    !targetEnv.WHATSAPP_VERIFY_TOKEN ||
    targetEnv.WHATSAPP_VERIFY_TOKEN === 'restaurant_verify_token'
  ) {
    errors.push('WHATSAPP_VERIFY_TOKEN must be explicitly configured in production.');
  }
  if (!targetEnv.MONGODB_URI) {
    errors.push('MONGODB_URI is required in production.');
  }
  if (!targetEnv.CORS_ORIGIN) {
    errors.push('CORS_ORIGIN is required in production.');
  }
  if (
    targetEnv.RATE_LIMIT_STORE === 'memory' &&
    targetEnv.RATE_LIMIT_ALLOW_IN_MEMORY_PROD !== 'true'
  ) {
    errors.push(
      'In-memory rate limiting is not allowed in production unless RATE_LIMIT_ALLOW_IN_MEMORY_PROD=true.',
    );
  }

  if (errors.length > 0) {
    const err = new Error(`Invalid production configuration: ${errors.join(' ')}`);
    err.code = 'INVALID_PRODUCTION_CONFIG';
    throw err;
  }

  return { valid: true, errors: [] };
}
