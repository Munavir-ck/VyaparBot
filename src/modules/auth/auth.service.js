import crypto from 'crypto';
import { OtpChallenge } from './otp.model.js';
import { User } from '../users/user.model.js';
import { Business } from '../businesses/business.model.js';
import { BusinessMember } from '../business-members/business-member.model.js';
import { subscriptionService } from '../subscriptions/subscription.service.js';
import { getBusinessTypeConfig } from '../businesses/business-types.config.js';
import { whatsappService } from '../whatsapp/whatsapp.service.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_VERIFY_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_OTP_REQUESTS = 5;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

class AuthService {
  getSessionSecret() {
    return process.env.SESSION_SECRET || env.SESSION_SECRET;
  }

  hashOtp(phone, otp) {
    return crypto
      .createHmac('sha256', this.getSessionSecret())
      .update(`${phone}:${otp}`)
      .digest('hex');
  }

  /**
   * Sign a compact stateless session token (payloadB64.sigB64)
   */
  signSessionToken(payload) {
    const data = {
      ...payload,
      iat: Date.now(),
      exp: Date.now() + SESSION_TTL_MS,
    };
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.getSessionSecret())
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${sig}`;
  }

  /**
   * Verify a signed session token using timing-safe comparison
   */
  verifySessionToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [encoded, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', this.getSessionSecret())
      .update(encoded)
      .digest('base64url');

    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (!payload.exp || payload.exp < Date.now()) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Generate and send a 6-digit WhatsApp OTP with rate limiting and 5-minute expiry.
   * Never logs OTP in production.
   */
  async requestOtp(rawPhone) {
    const phone = String(rawPhone || '').replace(/\D/g, '');
    if (phone.length < 10) {
      const err = new Error('Valid WhatsApp phone number is required');
      err.statusCode = 400;
      throw err;
    }

    const now = new Date();
    const existing = await OtpChallenge.findOne({ whatsappNumber: phone });

    let requestCount = 1;
    let windowStart = now;

    if (existing) {
      const windowElapsed = now.getTime() - new Date(existing.windowStart).getTime();
      if (windowElapsed < RATE_LIMIT_WINDOW_MS) {
        if (existing.requestCount >= MAX_OTP_REQUESTS) {
          const err = new Error('Too many OTP requests. Please try again later.');
          err.statusCode = 429;
          err.code = 'OTP_RATE_LIMITED';
          throw err;
        }
        requestCount = existing.requestCount + 1;
        windowStart = existing.windowStart;
      }
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = this.hashOtp(phone, otp);
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

    await OtpChallenge.findOneAndUpdate(
      { whatsappNumber: phone },
      {
        whatsappNumber: phone,
        otpHash,
        expiresAt,
        attempts: 0,
        used: false,
        requestCount,
        windowStart,
        lastRequestedAt: now,
      },
      { upsert: true, new: true },
    );

    const message =
      `🔐 Your Business Dashboard login code is *${otp}*.\n` +
      `Valid for 5 minutes. Do not share this code with anyone.`;

    await whatsappService.sendTextMessage(phone, message);

    logger.info({ phone, expiresAt }, 'WhatsApp login OTP dispatched');

    return {
      success: true,
      expiresInSeconds: 300,
      // Only expose OTP in automated test mode when explicitly needed; NEVER in production
      ...(env.isTest ? { testOtp: otp } : {}),
    };
  }

  /**
   * Verify OTP, enforce expiry & max attempts, and return signed session + user/business context
   */
  async verifyOtp(rawPhone, otpInput, name = 'Business Owner') {
    const phone = String(rawPhone || '').replace(/\D/g, '');
    const otp = String(otpInput || '').trim();

    if (phone.length < 10 || !otp) {
      const err = new Error('Phone number and OTP are required');
      err.statusCode = 400;
      throw err;
    }

    const challenge = await OtpChallenge.findOne({ whatsappNumber: phone });
    if (!challenge || challenge.used) {
      const err = new Error('No active OTP challenge found. Please request a new code.');
      err.statusCode = 401;
      err.code = 'OTP_NOT_FOUND';
      throw err;
    }

    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      const err = new Error('OTP has expired. Please request a new code.');
      err.statusCode = 401;
      err.code = 'OTP_EXPIRED';
      throw err;
    }

    if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
      const err = new Error('Maximum verification attempts exceeded. Please request a new OTP.');
      err.statusCode = 429;
      err.code = 'MAX_ATTEMPTS_EXCEEDED';
      throw err;
    }

    const providedHash = this.hashOtp(phone, otp);
    const a = Buffer.from(providedHash);
    const b = Buffer.from(challenge.otpHash);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      challenge.attempts += 1;
      await challenge.save();
      const err = new Error('Invalid OTP code.');
      err.statusCode = 401;
      err.code = 'INVALID_OTP';
      throw err;
    }

    challenge.used = true;
    await challenge.save();

    // Find or create User (do not force-create business so user can onboard via dashboard if new)
    let user = await User.findOne({ whatsappNumber: phone });
    if (!user) {
      user = await User.create({
        whatsappNumber: phone,
        name: name || 'Business Owner',
        role: 'OWNER',
        status: 'ACTIVE',
        consentGiven: true,
      });
    }

    const context = await this.getUserBusinessContext(user);
    const sessionToken = this.signSessionToken({
      userId: String(user._id),
      phone: user.whatsappNumber,
      tokenVersion: user.tokenVersion ?? 0,
    });
    const csrfToken = crypto.randomBytes(24).toString('hex');

    return {
      sessionToken,
      csrfToken,
      ...context,
    };
  }

  /**
   * Load user's active business, role, and permissions (without auto-provisioning)
   */
  async getUserBusinessContext(user) {
    const membership = await BusinessMember.findOne({
      userId: user._id,
      status: 'ACTIVE',
    }).populate('businessId');

    if (membership && membership.businessId && membership.businessId.status === 'ACTIVE') {
      const [access, usage] = await Promise.all([
        subscriptionService.evaluateSubscriptionAccess(membership.businessId._id),
        subscriptionService.getUsageSummary(membership.businessId._id),
      ]);
      const sub = access.subscription;
      const remainingDays =
        sub?.trialEndsAt && new Date(sub.trialEndsAt).getTime() > Date.now()
          ? Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
          : 0;

      return {
        user,
        business: membership.businessId,
        memberRole: membership.role,
        permissions: membership.permissions || [],
        businessConfig: getBusinessTypeConfig(membership.businessId.businessType),
        subscription: sub
          ? {
              status: sub.status,
              planCode: sub.planCode || sub.plan,
              isPilotParticipant: Boolean(sub.isPilotParticipant),
              billingExempt: Boolean(sub.billingExempt),
              trialEndsAt: sub.trialEndsAt,
              remainingDays,
              readOnly: access.readOnly,
            }
          : null,
        usage,
        needsOnboarding: false,
      };
    }

    const ownedBusiness = await Business.findOne({ ownerId: user._id, status: 'ACTIVE' });
    if (ownedBusiness) {
      return {
        user,
        business: ownedBusiness,
        memberRole: 'OWNER',
        permissions: membership?.permissions || [],
        businessConfig: getBusinessTypeConfig(ownedBusiness.businessType),
        needsOnboarding: false,
      };
    }

    return {
      user,
      business: null,
      memberRole: null,
      permissions: [],
      businessConfig: null,
      needsOnboarding: true,
    };
  }
}

export const authService = new AuthService();

