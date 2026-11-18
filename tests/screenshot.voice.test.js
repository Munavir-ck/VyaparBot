import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { conversationService } from '../src/modules/conversations/conversation.service.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { transactionService } from '../src/modules/transactions/transaction.service.js';
import { Transaction } from '../src/modules/transactions/transaction.model.js';
import { ConversationSession } from '../src/modules/conversations/session.model.js';
import { validateImageBuffer } from '../src/utils/image-validator.js';

describe('Screenshot, Voice, and Multi-Tenant Isolation', () => {
  // Helper to construct a valid JPEG image buffer for testing
  function createTestJpegBuffer(textMarker = 'GPAY') {
    const minimalValidJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
      0x00, 0x48, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x00, 0xc8, 0x01, 0x01, 0x11,
      0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07,
      0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14,
      0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23,
      0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38,
      0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
      ...Buffer.from(`[MARKER:${textMarker}:${Date.now()}]`),
      ...new Array(600).fill(0x55),
      0xff, 0xd9,
    ]);
    return minimalValidJpeg;
  }

  describe('1. Screenshot Processing & Safeguards', () => {
    it('validates image signature, dimensions, and computes SHA-256 hash', () => {
      const buffer = createTestJpegBuffer('GPay_1500');
      const val = validateImageBuffer(buffer, 'image/jpeg');
      expect(val.valid).toBe(true);
      expect(val.format).toBe('jpeg');
      expect(val.hash).toBeTruthy();
    });

    it('rejects corrupt or non-image files', () => {
      const fakeBuffer = Buffer.alloc(1000, 0x41); // 1000 bytes of non-image data
      const val = validateImageBuffer(fakeBuffer, 'image/jpeg');
      expect(val.valid).toBe(false);
      expect(val.error).toBe('UNSUPPORTED_FORMAT');
    });

    it('extracts screenshot details and presents interactive confirmation to user', async () => {
      const testPhone = '919876543211';
      const buffer = createTestJpegBuffer('GPay_Incoming_1500');

      await conversationService.handleIncomingMessage(testPhone, '', null, 'Hotel Grand', {
        type: 'image',
        id: 'media_gpay_001',
        buffer,
        contentType: 'image/jpeg',
        mockData: {
          isFinancialScreenshot: true,
          appType: 'GPAY',
          amount: 1500,
          paymentMethod: 'UPI',
          transactionStatus: 'SUCCESS',
          transactionDirection: 'INCOMING',
          referenceId: 'UPI123456789012',
          merchantOrRecipient: 'Customer Anoop',
        },
      });

      // Verify session entered confirmation state
      const session = await ConversationSession.findOne({ whatsappNumber: testPhone });
      expect(session.currentIntent).toBe('CONFIRM_SCREENSHOT');
      expect(session.pendingTransaction).toBeTruthy();
      expect(session.pendingTransaction.amount).toBe(1500);
      expect(session.pendingTransaction.type).toBe('SALE');

      // User confirms via button
      await conversationService.handleIncomingMessage(testPhone, 'Confirm', 'confirm_screenshot', 'Hotel Grand');

      // Verify transaction saved
      const savedTx = await Transaction.findOne({
        businessId: session.businessId,
        referenceId: 'UPI123456789012',
      });
      expect(savedTx).toBeTruthy();
      expect(savedTx.amount).toBe(1500);
      expect(savedTx.type).toBe('SALE');
    });

    it('SAFEGUARD: Does NOT record failed payment screenshots as completed transactions', async () => {
      const testPhone = '919876543212';
      const buffer = createTestJpegBuffer('Failed_PhonePe');

      await conversationService.handleIncomingMessage(testPhone, '', null, 'Owner', {
        type: 'image',
        id: 'media_failed_001',
        buffer,
        contentType: 'image/jpeg',
        mockData: {
          isFinancialScreenshot: true,
          amount: 800,
          transactionStatus: 'FAILED',
          transactionDirection: 'OUTGOING',
        },
      });

      const session = await ConversationSession.findOne({ whatsappNumber: testPhone });
      expect(session.pendingTransaction).toBeNull();

      const tx = await Transaction.findOne({ businessId: session.businessId, amount: 800 });
      expect(tx).toBeNull();
    });

    it('detects duplicate payment screenshots and warns user without saving twice', async () => {
      const testPhone = '919876543213';
      const buffer = createTestJpegBuffer('Duplicate_GPay');
      const val = validateImageBuffer(buffer);

      const { business } = await businessService.resolveBusinessForUser(testPhone);

      // Save first transaction with image hash
      await transactionService.recordSale({
        businessId: business._id,
        amount: 500,
        imageHash: val.hash,
        source: 'SCREENSHOT',
      });

      // Send same image again
      await conversationService.handleIncomingMessage(testPhone, '', null, 'Owner', {
        type: 'image',
        id: 'media_dup_001',
        buffer,
        contentType: 'image/jpeg',
      });

      // Count transactions with this imageHash
      const count = await Transaction.countDocuments({
        businessId: business._id,
        imageHash: val.hash,
      });
      expect(count).toBe(1);
    });
  });

  describe('2. Voice Note Processing', () => {
    it('downloads voice note, transcribes Malayalam speech, and records expense', async () => {
      const testPhone = '919876543214';
      const fakeVoiceBuffer = Buffer.from('VOICE_AUDIO_DATA');

      await conversationService.handleIncomingMessage(testPhone, '', null, 'Ali', {
        type: 'voice',
        id: 'voice_note_001',
        buffer: fakeVoiceBuffer,
        mockTranscript: 'Innu 850 rupa pachakkari vangichu',
      });

      const { business } = await businessService.resolveBusinessForUser(testPhone);
      const tx = await Transaction.findOne({
        businessId: business._id,
        amount: 850,
        category: 'VEGETABLES',
      });

      expect(tx).toBeTruthy();
      expect(tx.type).toBe('EXPENSE');
    });
  });

  describe('3. Multi-Tenant Business Data Isolation', () => {
    it('enforces strict data isolation between two different restaurant accounts', async () => {
      const phoneA = '919000000001';
      const phoneB = '919000000002';

      const resA = await businessService.resolveBusinessForUser(phoneA, 'Restaurant A');
      const resB = await businessService.resolveBusinessForUser(phoneB, 'Restaurant B');

      expect(resA.business._id.toString()).not.toBe(resB.business._id.toString());

      // Record transaction for Restaurant A
      await transactionService.recordSale({
        businessId: resA.business._id,
        amount: 50000,
        createdBy: resA.user._id,
      });

      // Record transaction for Restaurant B
      await transactionService.recordSale({
        businessId: resB.business._id,
        amount: 12000,
        createdBy: resB.user._id,
      });

      // Query Restaurant A's transactions
      const txsA = await Transaction.find({ businessId: resA.business._id });
      const txsB = await Transaction.find({ businessId: resB.business._id });

      expect(txsA.length).toBe(1);
      expect(txsA[0].amount).toBe(50000);

      expect(txsB.length).toBe(1);
      expect(txsB[0].amount).toBe(12000);
    });
  });
});

