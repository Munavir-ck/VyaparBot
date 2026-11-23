import crypto from 'crypto';
import { authService } from '../modules/auth/auth.service.js';
import { businessService } from '../modules/businesses/business.service.js';
import { isModuleEnabled, resolveBusinessModules } from '../modules/businesses/business-modules.config.js';
import { subscriptionService } from '../modules/subscriptions/subscription.service.js';
import { User } from '../modules/users/user.model.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

function parseCookies(cookieHeader = '') {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const val = decodeURIComponent(part.slice(idx + 1).trim());
      cookies[key] = val;
    }
  }
  return cookies;
}

function verifyCsrfForCookieMutation(req, cookies) {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;

  // Enforce CSRF whenever cookie auth is used
  if (!cookies.auth_session) return true;

  const headerToken = req.headers['x-csrf-token'];
  const cookieToken = cookies.csrf_token;
  if (!headerToken || !cookieToken) return false;

  const a = Buffer.from(String(headerToken));
  const b = Buffer.from(String(cookieToken));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Resolve authenticated User only (used for /api/auth/me and business onboarding).
 * Strictly requires a signed session cookie/Bearer token in production.
 */
export async function resolveUserOnly(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie);

    if (!verifyCsrfForCookieMutation(req, cookies)) {
      return res.status(403).json({
        status: 'fail',
        code: 'CSRF_TOKEN_INVALID',
        message: 'Invalid or missing CSRF token',
      });
    }

    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const sessionToken = cookies.auth_session || bearerToken;

    if (sessionToken) {
      const payload = authService.verifySessionToken(sessionToken);
      if (!payload || !payload.userId) {
        return res.status(401).json({
          status: 'fail',
          code: 'INVALID_SESSION',
          message: 'Session expired or invalid. Please log in again.',
        });
      }

      const user = await User.findById(payload.userId);
      if (!user || user.status === 'SUSPENDED' || user.status === 'DELETED') {
        return res.status(401).json({ status: 'fail', message: 'User account not active' });
      }
      if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
        return res.status(401).json({
          status: 'fail',
          code: 'INVALID_SESSION',
          message: 'Session has been invalidated. Please log in again.',
        });
      }
      req.user = user;
      req.authMethod = 'session';
      return next();
    }

    // Never allow raw x-user-phone authentication in production
    if (env.isProduction || process.env.NODE_ENV === 'production') {
      return res.status(401).json({
        status: 'fail',
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
      });
    }

    // Non-production fallback for automated tests and local CLI testing
    const phone = req.headers['x-user-phone'] || req.query.phone;
    if (!phone) {
      return res.status(401).json({
        status: 'fail',
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
      });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    let user = await User.findOne({ whatsappNumber: cleanPhone });
    if (!user) {
      user = await User.create({
        whatsappNumber: cleanPhone,
        name: 'Business Owner',
        role: 'OWNER',
        status: 'ACTIVE',
      });
    }
    req.user = user;
    req.authMethod = 'dev_header';
    return next();
  } catch (err) {
    return res.status(401).json({ status: 'error', message: err.message });
  }
}

/**
 * Resolve authenticated user and business workspace.
 * Never trusts a client-supplied businessId in body, query, or headers.
 */
export async function resolveBusinessContext(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);

  if (!verifyCsrfForCookieMutation(req, cookies)) {
    return res.status(403).json({
      status: 'fail',
      code: 'CSRF_TOKEN_INVALID',
      message: 'Invalid or missing CSRF token',
    });
  }

  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const sessionToken = cookies.auth_session || bearerToken;

  let phone = null;

  if (sessionToken) {
    const payload = authService.verifySessionToken(sessionToken);
    if (!payload || !payload.phone || !payload.userId) {
      return res.status(401).json({
        status: 'fail',
        code: 'INVALID_SESSION',
        message: 'Session expired or invalid. Please log in again.',
      });
    }
    const sessionUser = await User.findById(payload.userId);
    if (!sessionUser || sessionUser.status === 'SUSPENDED' || sessionUser.status === 'DELETED') {
      return res.status(401).json({
        status: 'fail',
        code: 'INVALID_SESSION',
        message: 'User account not active',
      });
    }
    if ((payload.tokenVersion ?? 0) !== (sessionUser.tokenVersion ?? 0)) {
      return res.status(401).json({
        status: 'fail',
        code: 'INVALID_SESSION',
        message: 'Session has been invalidated. Please log in again.',
      });
    }
    phone = sessionUser.whatsappNumber || payload.phone;
  } else {
    // Strictly block raw x-user-phone in production
    if (env.isProduction || process.env.NODE_ENV === 'production') {
      return res.status(401).json({
        status: 'fail',
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
      });
    }
    phone = req.headers['x-user-phone'] || req.query.phone || '919876543210';
  }

  try {
    const { user, business, memberRole, permissions, businessConfig } =
      await businessService.resolveBusinessForUser(phone);

    // Reject explicit cross-tenant access attempts
    const claimedBusinessId = req.headers['x-business-id'] || req.body?.businessId || req.query?.businessId;
    if (claimedBusinessId && String(claimedBusinessId) !== String(business._id)) {
      logger.warn(
        { userId: user._id, actualBusinessId: business._id, claimedBusinessId },
        'Cross-business access attempt blocked',
      );
      return res.status(403).json({
        status: 'fail',
        code: 'CROSS_TENANT_FORBIDDEN',
        message: 'Access denied: cannot access another business workspace',
      });
    }

    req.user = user;
    req.business = business;
    req.memberRole = memberRole;
    req.permissions = permissions || [];
    req.businessConfig = businessConfig;
    req.enabledModules = resolveBusinessModules(business);
    next();
  } catch (err) {
    res.status(err.statusCode || 401).json({
      status: 'fail',
      code: err.code || 'AUTH_ERROR',
      message: err.message,
    });
  }
}

/**
 * Enforce RBAC permission on REST endpoints
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user || !req.business) {
      return res.status(401).json({ status: 'fail', message: 'Authentication required' });
    }

    if (req.memberRole === 'OWNER' || (Array.isArray(req.permissions) && req.permissions.includes(permission))) {
      return next();
    }

    logger.warn(
      { userId: req.user._id, businessId: req.business._id, role: req.memberRole, required: permission },
      'Unauthorized REST API action blocked by RBAC',
    );

    return res.status(403).json({
      status: 'fail',
      code: 'FORBIDDEN',
      message: `Insufficient permissions: ${permission} required`,
    });
  };
}

/**
 * Enforce PLATFORM_ADMIN role (strictly separate from tenant business OWNER)
 */
export function requirePlatformAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ status: 'fail', message: 'Authentication required' });
  }
  if (req.user.role !== 'PLATFORM_ADMIN') {
    logger.warn(
      { userId: req.user._id, role: req.user.role },
      'Unauthorized PLATFORM_ADMIN access attempt blocked',
    );
    return res.status(403).json({
      status: 'fail',
      code: 'PLATFORM_ADMIN_REQUIRED',
      message: 'Platform administrator access required.',
    });
  }
  return next();
}

/**
 * Enforce that a business has the requested optional/core module enabled.
 * Always enforced server-side regardless of frontend visibility.
 */
export function requireModule(moduleKey) {
  return (req, res, next) => {
    if (!req.business) {
      return res.status(401).json({ status: 'fail', message: 'Business context required' });
    }
    if (!isModuleEnabled(req.business, moduleKey)) {
      logger.warn(
        { userId: req.user?._id, businessId: req.business._id, moduleKey },
        'Access to disabled business module blocked',
      );
      return res.status(403).json({
        status: 'fail',
        code: 'MODULE_DISABLED',
        message: `The ${moduleKey} module is not enabled for this business.`,
      });
    }
    return next();
  };
}

/**
 * Enforce active/trialing/exempt subscription for write operations.
 * Expired or suspended subscriptions retain read-only access (GET/HEAD/OPTIONS).
 */
export async function requireWriteSubscription(req, res, next) {
  try {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
      return next();
    }
    if (!req.business) {
      return res.status(401).json({ status: 'fail', message: 'Business context required' });
    }
    const access = await subscriptionService.evaluateSubscriptionAccess(req.business._id);
    if (!access.allowedWrite) {
      return res.status(402).json({
        status: 'fail',
        code: access.reasonCode || 'SUBSCRIPTION_INACTIVE',
        message:
          access.reasonCode === 'SUBSCRIPTION_EXPIRED'
            ? 'Your 30-day pilot trial has expired. Data is in read-only mode; please renew to continue.'
            : 'Your subscription is inactive or suspended. Data is in read-only mode.',
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Enforce plan feature entitlement (e.g. 'advancedReports')
 */
export function requirePlanFeature(featureKey) {
  return async (req, res, next) => {
    try {
      if (!req.business) {
        return res.status(401).json({ status: 'fail', message: 'Business context required' });
      }
      await subscriptionService.checkFeatureEnabled(req.business._id, featureKey);
      return next();
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ status: 'fail', code: err.code, message: err.message });
      }
      return next(err);
    }
  };
}
