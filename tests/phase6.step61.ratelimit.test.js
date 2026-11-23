import crypto from 'crypto';
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import {
  RateLimitBucket,
  createRateLimiter,
  defaultMongoStore,
  getClientIp,
} from '../src/middleware/rate-limiter.js';
import { parseTrustProxy, validateProductionEnv } from '../src/config/env.js';

describe('Phase 6 (Step 6.1): API Rate Limiting & Security Hardening', () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...originalEnv };
    await RateLimitBucket.deleteMany({});
  });

  it('enforces general API rate limiting with standard headers and consistent 429 JSON', async () => {
    process.env.RATE_LIMIT_API_MAX = '3';
    process.env.RATE_LIMIT_API_WINDOW_MS = '60000';

    const phone = '919800111001';
    const { business } = await businessService.resolveBusinessForUser(phone, 'RL Biz');

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .get('/api/business')
        .set('x-user-phone', phone)
        .set('x-business-id', String(business._id));
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('3');
      expect(res.headers['ratelimit-remaining']).toBe(String(2 - i));
    }

    const blocked = await request(app)
      .get('/api/business')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));

    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.status).toBe('fail');
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('enforces stricter limits on /api/auth/request-otp and /api/auth/verify-otp', async () => {
    process.env.RATE_LIMIT_OTP_REQUEST_MAX = '2';
    process.env.RATE_LIMIT_OTP_VERIFY_MAX = '2';

    // OTP request limit
    const r1 = await request(app).post('/api/auth/request-otp').send({ phone: '919800111002' });
    expect(r1.status).toBe(200);
    const r2 = await request(app).post('/api/auth/request-otp').send({ phone: '919800111003' });
    expect(r2.status).toBe(200);
    const r3 = await request(app).post('/api/auth/request-otp').send({ phone: '919800111004' });
    expect(r3.status).toBe(429);
    expect(r3.body.code).toBe('RATE_LIMIT_EXCEEDED');

    // OTP verify limit against repeated failed attempts
    const v1 = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '919800111002', otp: '000000' });
    expect(v1.status).toBe(401);
    const v2 = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '919800111002', otp: '000000' });
    expect(v2.status).toBe(401);
    const v3 = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '919800111002', otp: '000000' });
    expect(v3.status).toBe(429);
    expect(v3.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('enforces sensitive mutation limits on transactions and inventory adjustments', async () => {
    process.env.RATE_LIMIT_MUTATION_MAX = '2';
    process.env.RATE_LIMIT_MUTATION_WINDOW_MS = '60000';

    const phone = '919800111005';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Mutation RL Biz');

    const s1 = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 100, paymentMethod: 'CASH' });
    expect(s1.status).toBe(201);

    const s2 = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 200, paymentMethod: 'CASH' });
    expect(s2.status).toBe(201);

    const s3 = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ amount: 300, paymentMethod: 'CASH' });
    expect(s3.status).toBe(429);
    expect(s3.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('prevents IP spoofing when trust proxy is false and separates proxied clients when trust proxy is 1', async () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);

    // 1. Direct mode (trust proxy = false): X-Forwarded-For is ignored
    const directApp = express();
    directApp.set('trust proxy', false);
    directApp.use(createRateLimiter({ name: 'test_direct', max: 1, windowMs: 60000 }));
    directApp.get('/ping', (req, res) => res.json({ ip: getClientIp(req) }));

    const d1 = await request(directApp).get('/ping').set('X-Forwarded-For', '1.1.1.1');
    expect(d1.status).toBe(200);
    // Changing X-Forwarded-For cannot bypass the limit
    const d2 = await request(directApp).get('/ping').set('X-Forwarded-For', '2.2.2.2');
    expect(d2.status).toBe(429);

    // 2. Behind 1 reverse proxy (trust proxy = 1): distinct clients get separate buckets,
    //    and prepended spoofed headers cannot bypass the rightmost trusted client IP
    const proxyApp = express();
    proxyApp.set('trust proxy', 1);
    proxyApp.use(createRateLimiter({ name: 'test_proxy', max: 1, windowMs: 60000 }));
    proxyApp.get('/ping', (req, res) => res.json({ ip: getClientIp(req) }));

    const p1 = await request(proxyApp).get('/ping').set('X-Forwarded-For', '10.0.0.1');
    expect(p1.status).toBe(200);
    expect(p1.body.ip).toBe('10.0.0.1');

    // Different client behind the same proxy is NOT blocked
    const p2 = await request(proxyApp).get('/ping').set('X-Forwarded-For', '10.0.0.2');
    expect(p2.status).toBe(200);
    expect(p2.body.ip).toBe('10.0.0.2');

    // Spoofing attempt prepending 9.9.9.9 before proxy-appended 10.0.0.1 still resolves to 10.0.0.1
    const spoofed = await request(proxyApp)
      .get('/ping')
      .set('X-Forwarded-For', '9.9.9.9, 10.0.0.1');
    expect(spoofed.status).toBe(429);
  });

  it('shares rate-limit counters across multiple backend instances via MongoDB store', async () => {
    const instanceA = express();
    instanceA.use(
      createRateLimiter({ name: 'shared_multi', max: 2, windowMs: 60000, store: defaultMongoStore }),
    );
    instanceA.get('/test', (_req, res) => res.json({ ok: true }));

    const instanceB = express();
    instanceB.use(
      createRateLimiter({ name: 'shared_multi', max: 2, windowMs: 60000, store: defaultMongoStore }),
    );
    instanceB.get('/test', (_req, res) => res.json({ ok: true }));

    expect((await request(instanceA).get('/test')).status).toBe(200);
    expect((await request(instanceB).get('/test')).status).toBe(200);
    // 3rd request hitting instance A is blocked because instance B incremented the shared store
    expect((await request(instanceA).get('/test')).status).toBe(429);

    // Production guard rejects in-memory store
    expect(() =>
      validateProductionEnv({
        NODE_ENV: 'production',
        SESSION_SECRET: 'a_very_strong_production_secret_at_least_32_chars_long',
        WHATSAPP_APP_SECRET: 'secret',
        WHATSAPP_VERIFY_TOKEN: 'verify',
        MONGODB_URI: 'mongodb+srv://prod/db',
        CORS_ORIGIN: 'https://app.example.com',
        RATE_LIMIT_STORE: 'memory',
      }),
    ).toThrow(/In-memory rate limiting is not allowed in production/);
  });

  it('allows legitimate WhatsApp webhook retries without premature blocking', async () => {
    const body = { object: 'whatsapp_business_account', entry: [] };
    const secret = process.env.WHATSAPP_APP_SECRET || env.WHATSAPP_APP_SECRET;
    const headers = secret
      ? {
          'x-hub-signature-256': `sha256=${crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(body))
            .digest('hex')}`,
        }
      : {};

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/webhook/whatsapp')
        .set(headers)
        .send(body);
      expect(res.status).toBe(200);
    }
  });
});
