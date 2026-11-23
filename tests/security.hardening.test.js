import { describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { authService } from '../src/modules/auth/auth.service.js';
import { User } from '../src/modules/users/user.model.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

describe('Security Hardening Regression Tests', () => {
  it('rejects revoked sessions (post-logout tokenVersion bump) on business-scoped endpoints', async () => {
    const phone = '919876540001';
    const { user } = await businessService.resolveBusinessForUser(phone, 'Security Owner');

    const token = authService.signSessionToken({
      userId: String(user._id),
      phone: user.whatsappNumber,
      tokenVersion: user.tokenVersion ?? 0,
    });

    // Valid before logout
    const okRes = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(okRes.status).toBe(200);

    // Revoke via logout
    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    // Must be rejected on business-scoped endpoints too
    const revokedRes = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(revokedRes.status).toBe(401);
  });

  it('rejects suspended users on business-scoped endpoints', async () => {
    const phone = '919876540002';
    const { user } = await businessService.resolveBusinessForUser(phone, 'Suspended Owner');

    const token = authService.signSessionToken({
      userId: String(user._id),
      phone: user.whatsappNumber,
      tokenVersion: user.tokenVersion ?? 0,
    });

    await User.findByIdAndUpdate(user._id, { status: 'SUSPENDED' });

    const res = await request(app)
      .get('/api/inventory/products')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('prevents mass-assignment override of createdBy and source on POST /api/transactions/sale', async () => {
    const phone = '919876540003';
    const { user } = await businessService.resolveBusinessForUser(phone, 'Owner 3');

    const token = authService.signSessionToken({
      userId: String(user._id),
      phone: user.whatsappNumber,
      tokenVersion: user.tokenVersion ?? 0,
    });

    const fakeUserId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/transactions/sale')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 1500,
        paymentMethod: 'CASH',
        createdBy: String(fakeUserId),
        source: 'WHATSAPP',
      });

    expect(res.status).toBe(201);
    const tx = res.body.data.transaction;
    expect(String(tx.createdBy)).toBe(String(user._id));
    expect(tx.source).toBe('API');
  });

  it('prevents NoSQL operator injection in GET /api/transactions?type[$ne]=INVALID', async () => {
    const phone = '919876540004';
    const { user } = await businessService.resolveBusinessForUser(phone, 'Owner 4');

    const token = authService.signSessionToken({
      userId: String(user._id),
      phone: user.whatsappNumber,
      tokenVersion: user.tokenVersion ?? 0,
    });

    await request(app)
      .post('/api/transactions/sale')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 500, paymentMethod: 'CASH' });

    const res = await request(app)
      .get('/api/transactions?type[$ne]=INVALID')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('redacts internal 500 error messages in production errorHandler', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const jsonCalls = [];
      const res = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          jsonCalls.push(body);
        },
      };
      errorHandler(
        new Error('MongoServerError: E11000 internal connection string mongodb://secret'),
        { method: 'GET', url: '/test', ip: '127.0.0.1' },
        res,
        () => {},
      );
      expect(res.statusCode).toBe(500);
      expect(jsonCalls[0].message).toBe('Internal server error');
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });
});
