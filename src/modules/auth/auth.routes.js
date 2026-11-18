import express from 'express';
import { authService } from './auth.service.js';
import { User } from '../users/user.model.js';
import { resolveUserOnly } from '../../middleware/auth.middleware.js';
import {
  otpRequestLimiter,
  otpVerifyLimiter,
  logoutLimiter,
} from '../../middleware/rate-limiter.js';
import { env } from '../../config/env.js';

const router = express.Router();

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getCookieOptions(httpOnly = true) {
  return {
    httpOnly,
    sameSite: 'lax',
    secure: env.isProduction,
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

// POST /api/auth/request-otp
router.post('/request-otp', otpRequestLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    const result = await authService.requestOtp(phone);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    res.status(err.statusCode || 400).json({
      status: 'fail',
      code: err.code || 'OTP_REQUEST_FAILED',
      message: err.message,
    });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', otpVerifyLimiter, async (req, res) => {
  try {
    const { phone, otp, name } = req.body;
    const result = await authService.verifyOtp(phone, otp, name);

    res.cookie('auth_session', result.sessionToken, getCookieOptions(true));
    res.cookie('csrf_token', result.csrfToken, getCookieOptions(false));

    res.status(200).json({
      status: 'success',
      data: {
        user: result.user,
        business: result.business,
        businessConfig: result.businessConfig,
        memberRole: result.memberRole,
        permissions: result.permissions,
        needsOnboarding: result.needsOnboarding,
        csrfToken: result.csrfToken,
      },
    });
  } catch (err) {
    res.status(err.statusCode || 401).json({
      status: 'fail',
      code: err.code || 'OTP_VERIFY_FAILED',
      message: err.message,
    });
  }
});

// POST /api/auth/logout
router.post('/logout', logoutLimiter, async (req, res) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionMatch = cookieHeader
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('auth_session='));
    const cookieToken = sessionMatch ? decodeURIComponent(sessionMatch.split('=')[1]) : null;
    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const token = cookieToken || bearerToken;

    if (token) {
      const payload = authService.verifySessionToken(token);
      if (payload?.userId) {
        await User.findByIdAndUpdate(payload.userId, { $inc: { tokenVersion: 1 } });
      }
    }
  } catch {
    // Still clear cookies even if token lookup fails
  }
  res.clearCookie('auth_session', { path: '/' });
  res.clearCookie('csrf_token', { path: '/' });
  res.status(200).json({ status: 'success', message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', resolveUserOnly, async (req, res, next) => {
  try {
    const context = await authService.getUserBusinessContext(req.user);
    res.status(200).json({ status: 'success', data: context });
  } catch (err) {
    next(err);
  }
});

export default router;

