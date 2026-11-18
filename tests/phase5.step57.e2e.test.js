import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { validateProductionEnv } from '../src/config/env.js';
import { conversationService } from '../src/modules/conversations/conversation.service.js';
import { Product } from '../src/modules/inventory/product.model.js';

function extractCookie(setCookieHeaders, name) {
  if (!Array.isArray(setCookieHeaders)) return null;
  const match = setCookieHeaders.find((c) => c.startsWith(`${name}=`));
  if (!match) return null;
  return match.split(';')[0].split('=')[1];
}

describe('Phase 5 (Step 5.7): End-to-End Integration & Production Readiness Audit', () => {
  it('runs complete onboarding -> inventory -> purchases -> sales -> WhatsApp -> reporting -> logout lifecycle on one business', async () => {
    const ownerPhone = '919899111001';
    const agent = request.agent(app);

    // 1. OTP Login & Onboarding
    const otpReq = await agent.post('/api/auth/request-otp').send({ phone: ownerPhone });
    expect(otpReq.status).toBe(200);
    const testOtp = otpReq.body.data.testOtp;
    expect(testOtp).toBeDefined();

    const verifyRes = await agent
      .post('/api/auth/verify-otp')
      .send({ phone: ownerPhone, otp: testOtp, name: 'E2E Owner' });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.needsOnboarding).toBe(true);

    const csrfToken = extractCookie(verifyRes.headers['set-cookie'], 'csrf_token');
    expect(csrfToken).toBeTruthy();

    const onboardRes = await agent
      .post('/api/business/onboard')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'E2E Integrated Store',
        businessType: 'GROCERY',
        currency: 'INR',
        timezone: 'Asia/Kolkata',
      });
    expect(onboardRes.status).toBe(201);
    expect(onboardRes.body.data.memberRole).toBe('OWNER');
    const businessId = onboardRes.body.data.business._id;

    // 2. Inventory Lifecycle
    const prodRes = await agent
      .post('/api/inventory/products')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({
        name: 'Sona Masoori Rice',
        category: 'Grains',
        unit: 'kg',
        initialStock: 10,
        minStockLevel: 5,
        costPrice: 60,
        sellingPrice: 80,
      });
    expect(prodRes.status).toBe(201);
    const productId = prodRes.body.data._id;

    await agent
      .post('/api/inventory/stock-in')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({ productId, quantity: 10, reason: 'Opening restock', idempotencyKey: 'e2e-in-1' });

    await agent
      .post('/api/inventory/stock-out')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({ productId, quantity: 2, reason: 'Sample pack', idempotencyKey: 'e2e-out-1' });

    await agent
      .post('/api/inventory/wastage')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({ productId, quantity: 1, type: 'WASTAGE', reason: 'Spilled', idempotencyKey: 'e2e-w-1' });

    await agent
      .post('/api/inventory/adjust')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({ productId, newStockCount: 15, reason: 'Audit match', idempotencyKey: 'e2e-adj-1' });

    let prod = await Product.findById(productId);
    expect(prod.currentStock).toBe(15);

    // 3. Purchases & Supplier Settlement
    const cashPur = await agent
      .post('/api/transactions/purchase')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({ amount: 1000, paymentMethod: 'CASH', merchantOrSupplier: 'Local Wholesaler' });
    expect(cashPur.status).toBe(201);

    const creditPur = await agent
      .post('/api/transactions/purchase')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({
        amount: 3000,
        paymentMethod: 'CREDIT',
        merchantOrSupplier: 'Grain Depot',
        items: [{ productId, productName: 'Sona Masoori Rice', quantity: 5, unitPrice: 60 }],
      });
    expect(creditPur.status).toBe(201);
    const supplierId = creditPur.body.data.supplier._id;

    prod = await Product.findById(productId);
    expect(prod.currentStock).toBe(20); // 15 + 5

    const supPay = await agent
      .post(`/api/suppliers/${supplierId}/payments`)
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({ amount: 1200, paymentMethod: 'UPI', idempotencyKey: 'e2e-sup-pay-1' });
    expect(supPay.status).toBe(201);
    expect(supPay.body.data.supplier.outstandingBalance).toBe(1800);

    // 4. Sales (Cash, UPI, Split, Itemized Credit, Lump-sum) + Customer Collection
    await agent
      .post('/api/transactions/sale')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({ amount: 1000, paymentMethod: 'CASH' });

    await agent
      .post('/api/transactions/sale')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({ amount: 800, paymentMethod: 'UPI' });

    await agent
      .post('/api/transactions/sale')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({
        amount: 1200,
        paymentMethod: 'SPLIT',
        paymentBreakdown: { cash: 500, upi: 700 },
      });

    const creditSale = await agent
      .post('/api/transactions/sale')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({
        amount: 200,
        paymentMethod: 'CREDIT',
        customerName: 'Kiran',
        items: [{ productId, productName: 'Sona Masoori Rice', quantity: 2, unitPrice: 100 }],
      });
    expect(creditSale.status).toBe(201);
    const customerId = creditSale.body.data.customer._id;

    prod = await Product.findById(productId);
    expect(prod.currentStock).toBe(18); // 20 - 2

    // Lump-sum sale does not deduct stock
    await agent
      .post('/api/transactions/sale')
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({ amount: 2500, paymentMethod: 'CASH', notes: 'Counter lump sum' });

    prod = await Product.findById(productId);
    expect(prod.currentStock).toBe(18);

    const custPay = await agent
      .post(`/api/customers/${customerId}/payments`)
      .set('x-csrf-token', csrfToken)
      .set('x-business-id', businessId)
      .send({ amount: 50, paymentMethod: 'CASH', idempotencyKey: 'e2e-cust-pay-1' });
    expect(custPay.status).toBe(201);
    expect(custPay.body.data.customer.outstandingBalance).toBe(150);

    // 5. WhatsApp message on SAME business account adds ₹500 cash sale
    await conversationService.handleIncomingMessage(
      ownerPhone,
      "Today's sales 500. Cash 500.",
      null,
      'E2E Owner',
    );

    // 6. Verify Dashboard Reports match all transactions & ledger
    // Total Sales = 1000 + 800 + 1200 + 200 + 2500 + 500 = 6200
    // Cash collections from sales = 1000 + 500 + 2500 + 500 = 4500
    // UPI collections from sales = 800 + 700 = 1500
    const dailyRes = await agent.get('/api/reports/daily').set('x-business-id', businessId);
    expect(dailyRes.status).toBe(200);
    expect(dailyRes.body.data.totalRecordedSales).toBe(6200);
    expect(dailyRes.body.data.cashCollections).toBe(4500);
    expect(dailyRes.body.data.upiCollections).toBe(1500);
    expect(dailyRes.body.data.totalSupplierPayments).toBe(1200);
    expect(dailyRes.body.data.totalCustomerPaymentsReceived).toBe(50);

    const recRes = await agent.get('/api/reports/receivables').set('x-business-id', businessId);
    expect(recRes.body.data.totalReceivables).toBe(150);

    const payRes = await agent.get('/api/reports/payables').set('x-business-id', businessId);
    expect(payRes.body.data.totalPayables).toBe(1800);

    const invRes = await agent.get('/api/reports/inventory').set('x-business-id', businessId);
    expect(invRes.body.data.valuation.totalValue).toBe(18 * 60);

    // 7. Logout invalidates session server-side (reusing old sessionToken fails)
    const oldSessionCookie = extractCookie(verifyRes.headers['set-cookie'], 'auth_session');
    const logoutRes = await agent.post('/api/auth/logout').set('x-csrf-token', csrfToken);
    expect(logoutRes.status).toBe(200);

    const reuseRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `auth_session=${oldSessionCookie}`);
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.code).toBe('INVALID_SESSION');
  });

  it('validates mandatory production environment configuration safely', () => {
    expect(() =>
      validateProductionEnv({
        NODE_ENV: 'production',
        SESSION_SECRET: 'short',
      }),
    ).toThrow(/Invalid production configuration/);

    const valid = validateProductionEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a_very_strong_production_secret_at_least_32_chars_long',
      WHATSAPP_APP_SECRET: 'meta_app_secret_123',
      WHATSAPP_VERIFY_TOKEN: 'custom_prod_verify_token',
      MONGODB_URI: 'mongodb+srv://cluster.example.mongodb.net/prod',
      CORS_ORIGIN: 'https://app.example.com',
    });
    expect(valid.valid).toBe(true);
  });
});
