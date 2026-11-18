import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { OtpChallenge } from '../src/modules/auth/otp.model.js';

describe('Phase 5 (Step 5.1): Auth Security, Business Onboarding, Settings & Team APIs', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('1. WhatsApp OTP Auth, Expiry, Rate Limiting, CSRF & Production Guard', () => {
    it('completes WhatsApp OTP login, sets HttpOnly cookie & enforces CSRF on mutations', async () => {
      const phone = '919800111222';

      // 1. Request OTP
      const reqRes = await request(app).post('/api/auth/request-otp').send({ phone });
      expect(reqRes.status).toBe(200);
      expect(reqRes.body.data.expiresInSeconds).toBe(300);
      const testOtp = reqRes.body.data.testOtp;
      expect(testOtp).toMatch(/^\d{6}$/);

      // 2. Verify OTP
      const verifyRes = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone, otp: testOtp, name: 'Faisal' });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.needsOnboarding).toBe(true);

      const cookies = verifyRes.headers['set-cookie'];
      expect(cookies).toBeTruthy();
      const cookieStr = cookies.map((c) => c.split(';')[0]).join('; ');
      expect(cookieStr).toContain('auth_session=');
      expect(cookieStr).toContain('csrf_token=');
      const csrfToken = verifyRes.body.data.csrfToken;

      // 3. GET /api/auth/me with cookie succeeds
      const meRes = await request(app).get('/api/auth/me').set('Cookie', cookieStr);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.needsOnboarding).toBe(true);

      // 4. Cookie-authenticated mutation WITHOUT x-csrf-token is rejected (403)
      const noCsrfRes = await request(app)
        .post('/api/business/onboard')
        .set('Cookie', cookieStr)
        .send({ name: 'Faisal Grocers', businessType: 'GROCERY' });
      expect(noCsrfRes.status).toBe(403);
      expect(noCsrfRes.body.code).toBe('CSRF_TOKEN_INVALID');

      // 5. Cookie-authenticated mutation WITH valid x-csrf-token succeeds (201)
      const onboardRes = await request(app)
        .post('/api/business/onboard')
        .set('Cookie', cookieStr)
        .set('x-csrf-token', csrfToken)
        .send({
          name: 'Faisal Grocers',
          businessType: 'GROCERY',
          currency: 'INR',
          timezone: 'Asia/Kolkata',
        });
      expect(onboardRes.status).toBe(201);
      expect(onboardRes.body.data.business.name).toBe('Faisal Grocers');
      expect(onboardRes.body.data.business.businessType).toBe('GROCERY');
      expect(onboardRes.body.data.memberRole).toBe('OWNER');

      // 6. Verify /api/auth/me now shows business & needsOnboarding: false
      const meAfter = await request(app).get('/api/auth/me').set('Cookie', cookieStr);
      expect(meAfter.body.data.needsOnboarding).toBe(false);
      expect(meAfter.body.data.business.name).toBe('Faisal Grocers');
    });

    it('rejects expired OTPs and locks out after max verification attempts', async () => {
      const phone = '919800111333';
      await request(app).post('/api/auth/request-otp').send({ phone });

      // 5 wrong attempts -> 6th attempt returns 429 MAX_ATTEMPTS_EXCEEDED
      for (let i = 0; i < 5; i++) {
        const wrong = await request(app)
          .post('/api/auth/verify-otp')
          .send({ phone, otp: '000000' });
        expect(wrong.status).toBe(401);
      }

      const locked = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone, otp: '000000' });
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('MAX_ATTEMPTS_EXCEEDED');

      // Expired OTP check
      await OtpChallenge.updateOne(
        { whatsappNumber: phone },
        { $set: { expiresAt: new Date(Date.now() - 1000), attempts: 0 } },
      );
      const expired = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phone, otp: '123456' });
      expect(expired.status).toBe(401);
      expect(expired.body.code).toBe('OTP_EXPIRED');
    });

    it('rate-limits excessive OTP requests (429)', async () => {
      const phone = '919800111444';
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/api/auth/request-otp').send({ phone });
        expect(res.status).toBe(200);
      }
      const blocked = await request(app).post('/api/auth/request-otp').send({ phone });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('OTP_RATE_LIMITED');
    });

    it('rejects raw x-user-phone authentication when NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';
      const res = await request(app)
        .get('/api/transactions')
        .set('x-user-phone', '919800111555');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('2. Business Settings, Team RBAC, Transactions & Product Updates', () => {
    it('manages business settings, team members, paginated transactions and product updates', async () => {
      const ownerHeaders = { 'x-user-phone': '919800222111' };

      // Get business & update settings
      const bizRes = await request(app).get('/api/business').set(ownerHeaders);
      expect(bizRes.status).toBe(200);

      const patchBiz = await request(app)
        .patch('/api/business')
        .set(ownerHeaders)
        .send({ name: 'Calicut Wholesale', businessType: 'WHOLESALE', currency: 'INR' });
      expect(patchBiz.status).toBe(200);
      expect(patchBiz.body.data.business.name).toBe('Calicut Wholesale');
      expect(patchBiz.body.data.business.businessType).toBe('WHOLESALE');

      // Add a CASHIER team member
      const addMember = await request(app)
        .post('/api/business/members')
        .set(ownerHeaders)
        .send({ whatsappNumber: '919800222999', name: 'Nithin', role: 'CASHIER' });
      expect(addMember.status).toBe(201);
      expect(addMember.body.data.role).toBe('CASHIER');
      const memberId = addMember.body.data._id;

      // Cashier cannot update business settings (403)
      const cashierPatch = await request(app)
        .patch('/api/business')
        .set('x-user-phone', '919800222999')
        .send({ name: 'Hacked' });
      expect(cashierPatch.status).toBe(403);

      // Owner promotes member to MANAGER & then revokes
      const promote = await request(app)
        .patch(`/api/business/members/${memberId}`)
        .set(ownerHeaders)
        .send({ role: 'MANAGER' });
      expect(promote.status).toBe(200);
      expect(promote.body.data.role).toBe('MANAGER');

      const revoke = await request(app)
        .delete(`/api/business/members/${memberId}`)
        .set(ownerHeaders);
      expect(revoke.status).toBe(200);

      // Purchase & Edit Transaction endpoints
      const purRes = await request(app)
        .post('/api/transactions/purchase')
        .set(ownerHeaders)
        .send({ amount: 4000, merchantOrSupplier: 'Metro Suppliers', paymentMethod: 'CREDIT' });
      expect(purRes.status).toBe(201);

      const saleRes = await request(app)
        .post('/api/transactions/sale')
        .set(ownerHeaders)
        .send({ amount: 2500, paymentMethod: 'UPI', description: 'Evening Counter' });
      expect(saleRes.status).toBe(201);
      const saleId = saleRes.body.data.transaction._id;

      const editRes = await request(app)
        .patch(`/api/transactions/${saleId}`)
        .set(ownerHeaders)
        .send({ amount: 2600, reason: 'Corrected counter total' });
      expect(editRes.status).toBe(200);
      expect(editRes.body.data.transaction.amount).toBe(2600);

      const listTx = await request(app)
        .get('/api/transactions?page=1&limit=10&search=Counter')
        .set(ownerHeaders);
      expect(listTx.status).toBe(200);
      expect(listTx.body.total).toBe(1);

      // Product PATCH & DELETE (archive)
      const prodRes = await request(app)
        .post('/api/inventory/products')
        .set(ownerHeaders)
        .send({ name: 'Wheat Flour', unit: 'kg', costPrice: 35, initialStock: 20 });
      const prodId = prodRes.body.data._id;

      const patchProd = await request(app)
        .patch(`/api/inventory/products/${prodId}`)
        .set(ownerHeaders)
        .send({ minStockLevel: 15, sellingPrice: 45 });
      expect(patchProd.status).toBe(200);
      expect(patchProd.body.data.minStockLevel).toBe(15);

      const delProd = await request(app)
        .delete(`/api/inventory/products/${prodId}`)
        .set(ownerHeaders);
      expect(delProd.status).toBe(200);
    });
  });
});

