import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import app from '../src/app.js';
import { User } from '../src/modules/users/user.model.js';
import { BusinessMember, ROLE_DEFAULT_PERMISSIONS } from '../src/modules/business-members/business-member.model.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { transactionService } from '../src/modules/transactions/transaction.service.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';
import { customerService } from '../src/modules/customers/customer.service.js';
import { conversationService } from '../src/modules/conversations/conversation.service.js';
import { Transaction } from '../src/modules/transactions/transaction.model.js';
import { Product } from '../src/modules/inventory/product.model.js';
import { validateImageBuffer } from '../src/utils/image-validator.js';
import { validateAudioBuffer } from '../src/utils/audio-validator.js';

describe('Security, RBAC & Integration Readiness Tests', () => {
  const originalAppSecret = process.env.WHATSAPP_APP_SECRET;

  afterEach(() => {
    if (originalAppSecret === undefined) {
      delete process.env.WHATSAPP_APP_SECRET;
    } else {
      process.env.WHATSAPP_APP_SECRET = originalAppSecret;
    }
  });

  async function setupOwnerAndCashier(ownerPhone, cashierPhone) {
    const ownerRes = await businessService.resolveBusinessForUser(ownerPhone, 'Owner');
    const cashierUser = await User.create({
      whatsappNumber: cashierPhone,
      name: 'Cashier',
      role: 'STAFF',
      status: 'ACTIVE',
    });
    await BusinessMember.create({
      businessId: ownerRes.business._id,
      userId: cashierUser._id,
      role: 'CASHIER',
      permissions: [...ROLE_DEFAULT_PERMISSIONS.CASHIER], // RECORD_TRANSACTIONS, VIEW_INVENTORY only
      status: 'ACTIVE',
    });
    return { owner: ownerRes, cashierUser };
  }

  describe('1. RBAC Enforcement (REST APIs & WhatsApp)', () => {
    it('blocks unauthorized inventory adjustments via REST and WhatsApp', async () => {
      const ownerPhone = '919100000001';
      const cashierPhone = '919100000002';
      const { owner } = await setupOwnerAndCashier(ownerPhone, cashierPhone);

      const product = await inventoryService.createOrUpdateProduct({
        businessId: owner.business._id,
        name: 'Rice',
        unit: 'kg',
        initialStock: 50,
        createdBy: owner.user._id,
      });

      // REST: Cashier attempts POST /api/inventory/adjust -> 403
      const restRes = await request(app)
        .post('/api/inventory/adjust')
        .set('x-user-phone', cashierPhone)
        .send({ productId: product._id, newStockCount: 10, reason: 'Unauthorized' });

      expect(restRes.status).toBe(403);
      expect(restRes.body.code).toBe('FORBIDDEN');

      // WhatsApp: Cashier attempts "Adjust Rice stock to 10 kg" -> blocked
      await conversationService.handleIncomingMessage(
        cashierPhone,
        'Adjust Rice stock to 10 kg',
        null,
        'Cashier',
      );

      const refreshed = await Product.findById(product._id);
      expect(refreshed.currentStock).toBe(50);
    });

    it('blocks unauthorized transaction deletion/voiding via REST and WhatsApp', async () => {
      const ownerPhone = '919100000003';
      const cashierPhone = '919100000004';
      const { owner } = await setupOwnerAndCashier(ownerPhone, cashierPhone);

      const sale = await transactionService.recordSale({
        businessId: owner.business._id,
        amount: 2000,
        paymentMethod: 'CASH',
        createdBy: owner.user._id,
      });

      // REST: Cashier attempts POST /api/transactions/:id/void -> 403
      const restRes = await request(app)
        .post(`/api/transactions/${sale.transaction._id}/void`)
        .set('x-user-phone', cashierPhone)
        .send({ reason: 'Unauthorized void' });

      expect(restRes.status).toBe(403);
      expect(restRes.body.code).toBe('FORBIDDEN');

      // WhatsApp: Cashier attempts "Delete last entry" -> blocked
      await conversationService.handleIncomingMessage(cashierPhone, 'Delete last entry', null, 'Cashier');

      const refreshed = await Transaction.findById(sale.transaction._id);
      expect(refreshed.status).toBe('COMPLETED');
    });

    it('blocks unauthorized customer payment operations via REST and WhatsApp', async () => {
      const ownerPhone = '919100000005';
      const cashierPhone = '919100000006';
      const { owner } = await setupOwnerAndCashier(ownerPhone, cashierPhone);

      const customer = await customerService.findOrCreateCustomer(owner.business._id, 'Ravi');

      // REST: Cashier attempts POST /api/customers/:id/payments -> 403
      const restRes = await request(app)
        .post(`/api/customers/${customer._id}/payments`)
        .set('x-user-phone', cashierPhone)
        .send({ amount: 500, paymentMethod: 'CASH' });

      expect(restRes.status).toBe(403);

      // WhatsApp: Cashier attempts "Ravi paid 500" -> blocked
      await conversationService.handleIncomingMessage(cashierPhone, 'Ravi paid 500', null, 'Cashier');

      const txCount = await Transaction.countDocuments({
        businessId: owner.business._id,
        type: 'CUSTOMER_PAYMENT',
      });
      expect(txCount).toBe(0);
    });
  });

  describe('2. Cross-Business Data Isolation', () => {
    it('rejects explicit cross-tenant businessId claims and isolates data', async () => {
      const bizA = await businessService.resolveBusinessForUser('919100000011', 'Biz A');
      const bizB = await businessService.resolveBusinessForUser('919100000012', 'Biz B');

      // Biz A tries to pass Biz B's businessId in header
      const res = await request(app)
        .get('/api/transactions')
        .set('x-user-phone', '919100000011')
        .set('x-business-id', bizB.business._id.toString());

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CROSS_TENANT_FORBIDDEN');

      // Biz B creates a transaction; Biz A cannot void it
      const saleB = await transactionService.recordSale({
        businessId: bizB.business._id,
        amount: 5000,
        createdBy: bizB.user._id,
      });

      const voidAttempt = await request(app)
        .post(`/api/transactions/${saleB.transaction._id}/void`)
        .set('x-user-phone', '919100000011')
        .send({ reason: 'Cross tenant attack' });

      expect(voidAttempt.status).toBe(404);
    });
  });

  describe('3. Duplicate Financial & Stock Operations', () => {
    it('prevents duplicate transactions by referenceId and duplicate stock updates by idempotencyKey', async () => {
      const { user, business } = await businessService.resolveBusinessForUser('919100000021', 'Dup Biz');

      const tx1 = await transactionService.recordSale({
        businessId: business._id,
        amount: 1500,
        paymentMethod: 'UPI',
        referenceId: 'UTR998877665544',
        createdBy: user._id,
      });
      const tx2 = await transactionService.recordSale({
        businessId: business._id,
        amount: 1500,
        paymentMethod: 'UPI',
        referenceId: 'UTR998877665544',
        createdBy: user._id,
      });

      expect(tx1.success).toBe(true);
      expect(tx2.duplicate).toBe(true);

      const prod = await inventoryService.createOrUpdateProduct({
        businessId: business._id,
        name: 'Oil',
        initialStock: 10,
      });
      await inventoryService.recordStockMovement({
        businessId: business._id,
        productId: prod._id,
        type: 'STOCK_IN',
        quantity: 5,
        idempotencyKey: 'dup_stock_001',
      });
      const dupStock = await inventoryService.recordStockMovement({
        businessId: business._id,
        productId: prod._id,
        type: 'STOCK_IN',
        quantity: 5,
        idempotencyKey: 'dup_stock_001',
      });
      expect(dupStock.duplicate).toBe(true);
    });
  });

  describe('4. Webhook Signature Verification & Media Validation', () => {
    it('rejects invalid or missing X-Hub-Signature-256 when WHATSAPP_APP_SECRET is set', async () => {
      process.env.WHATSAPP_APP_SECRET = 'super_secret_meta_key';
      const payload = { object: 'whatsapp_business_account', entry: [] };

      // Missing signature
      const missingRes = await request(app).post('/webhook/whatsapp').send(payload);
      expect(missingRes.status).toBe(401);

      // Invalid signature
      const invalidRes = await request(app)
        .post('/webhook/whatsapp')
        .set('x-hub-signature-256', 'sha256=invalid_signature_hex')
        .send(payload);
      expect(invalidRes.status).toBe(401);

      // Valid signature
      const raw = JSON.stringify(payload);
      const validSig = `sha256=${crypto
        .createHmac('sha256', 'super_secret_meta_key')
        .update(raw)
        .digest('hex')}`;
      const validRes = await request(app)
        .post('/webhook/whatsapp')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', validSig)
        .send(raw);
      expect(validRes.status).toBe(200);
    });

    it('rejects invalid image and audio media buffers', () => {
      const badImage = validateImageBuffer(Buffer.alloc(600, 0x00), 'image/jpeg');
      expect(badImage.valid).toBe(false);
      expect(badImage.error).toBe('UNSUPPORTED_FORMAT');

      const badAudioMime = validateAudioBuffer(Buffer.from('AUDIO_BYTES'), 'application/pdf');
      expect(badAudioMime.valid).toBe(false);
      expect(badAudioMime.error).toBe('UNSUPPORTED_AUDIO_MIME');

      const emptyAudio = validateAudioBuffer(Buffer.from(''), 'audio/ogg');
      expect(emptyAudio.valid).toBe(false);
      expect(emptyAudio.error).toBe('AUDIO_TOO_SMALL');

      const validAudio = validateAudioBuffer(Buffer.from('OGG_OPUS_BYTES'), 'audio/ogg; codecs=opus');
      expect(validAudio.valid).toBe(true);
      expect(validAudio.mimeType).toBe('audio/ogg');
    });
  });
});

