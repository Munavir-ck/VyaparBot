import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { aiService } from '../src/ai/ai.service.js';
import { CONVERSATION_INTENTS } from '../src/ai/schemas/intent.schema.js';
import { conversationService } from '../src/modules/conversations/conversation.service.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { Product } from '../src/modules/inventory/product.model.js';
import { StockMovement } from '../src/modules/inventory/stock-movement.model.js';
import { Customer } from '../src/modules/customers/customer.model.js';
import { ConversationSession } from '../src/modules/conversations/session.model.js';
import { MessageLog } from '../src/modules/whatsapp/message-log.model.js';

describe('Phase 4: WhatsApp AI & Multilingual Conversation Integration', () => {
  describe('1. Multilingual AI Intent & Entity Extraction', () => {
    it('extracts Malayalam script inventory messages', async () => {
      const stockIn = await aiService.extractTransactionData({
        message: 'ഇന്ന് 50 കിലോ അരി സ്റ്റോക്ക് വന്നു',
      });
      expect(stockIn.intent).toBe(CONVERSATION_INTENTS.STOCK_IN);
      expect(stockIn.inventoryAction.productName).toBe('Rice');
      expect(stockIn.inventoryAction.quantity).toBe(50);
      expect(stockIn.inventoryAction.unit).toBe('kg');

      const check = await aiService.extractTransactionData({
        message: 'പഞ്ചസാര സ്റ്റോക്ക് എത്രയുണ്ട്?',
      });
      expect(check.intent).toBe(CONVERSATION_INTENTS.CHECK_STOCK);
      expect(check.inventoryAction.productName).toBe('Sugar');

      const wastage = await aiService.extractTransactionData({
        message: '2 കിലോ തക്കാളി നശിച്ചു',
      });
      expect(wastage.intent).toBe(CONVERSATION_INTENTS.RECORD_WASTAGE);
      expect(wastage.inventoryAction.productName).toBe('Tomato');
      expect(wastage.inventoryAction.quantity).toBe(2);
      expect(wastage.inventoryAction.unit).toBe('kg');
    });

    it('extracts Manglish & Mixed-language inventory messages', async () => {
      const stockIn = await aiService.extractTransactionData({
        message: 'Innu 50 kg ari stock vannu',
      });
      expect(stockIn.intent).toBe(CONVERSATION_INTENTS.STOCK_IN);
      expect(stockIn.inventoryAction.productName).toBe('Rice');
      expect(stockIn.inventoryAction.quantity).toBe(50);
      expect(stockIn.inventoryAction.unit).toBe('kg');

      const check = await aiService.extractTransactionData({
        message: 'Sugar stock ethra und?',
      });
      expect(check.intent).toBe(CONVERSATION_INTENTS.CHECK_STOCK);
      expect(check.inventoryAction.productName).toBe('Sugar');

      const wastage = await aiService.extractTransactionData({
        message: '2 kg tomato waste aayi',
      });
      expect(wastage.intent).toBe(CONVERSATION_INTENTS.RECORD_WASTAGE);
      expect(wastage.inventoryAction.productName).toBe('tomato');
      expect(wastage.inventoryAction.quantity).toBe(2);
    });

    it('extracts English inventory, customer, and extended report intents', async () => {
      const addProd = await aiService.extractTransactionData({
        message: 'Add product Sugar unit kg min 10 price 45',
      });
      expect(addProd.intent).toBe(CONVERSATION_INTENTS.ADD_PRODUCT);
      expect(addProd.inventoryAction.productName).toBe('Sugar');
      expect(addProd.inventoryAction.minStockLevel).toBe(10);
      expect(addProd.inventoryAction.unitCost).toBe(45);

      const lowStock = await aiService.extractTransactionData({ message: 'Low stock items' });
      expect(lowStock.intent).toBe(CONVERSATION_INTENTS.VIEW_LOW_STOCK);

      const valuation = await aiService.extractTransactionData({ message: 'Inventory valuation' });
      expect(valuation.intent).toBe(CONVERSATION_INTENTS.VIEW_INVENTORY_VALUATION);

      const weekly = await aiService.extractTransactionData({ message: 'Weekly report' });
      expect(weekly.intent).toBe(CONVERSATION_INTENTS.VIEW_WEEKLY_REPORT);

      const creditSale = await aiService.extractTransactionData({
        message: 'Credit sale 3000 to Ravi',
      });
      expect(creditSale.intent).toBe(CONVERSATION_INTENTS.ADD_CREDIT_SALE);
      expect(creditSale.amount).toBe(3000);
      expect(creditSale.customerName).toBe('Ravi');
    });
  });

  describe('2. End-to-End WhatsApp Conversation Flows (Inventory & Customers)', () => {
    const phone = '919876500111';
    const owner = 'Kochi Mart';

    it('adds product, records stock-in, stock-out, wastage, and checks stock via WhatsApp', async () => {
      await conversationService.handleIncomingMessage(
        phone,
        'Add product Sugar unit kg min 10 price 45',
        null,
        owner,
      );

      await conversationService.handleIncomingMessage(phone, 'Stock in 40 kg Sugar', null, owner);
      await conversationService.handleIncomingMessage(phone, 'Stock out 15 kg Sugar', null, owner);
      await conversationService.handleIncomingMessage(phone, '5 kg Sugar waste aayi', null, owner);

      const { business } = await businessService.resolveBusinessForUser(phone);
      const sugar = await Product.findOne({ businessId: business._id, normalizedName: 'sugar' });

      expect(sugar).toBeTruthy();
      expect(sugar.currentStock).toBe(20); // 40 - 15 - 5

      const movements = await StockMovement.find({ businessId: business._id, productId: sugar._id });
      expect(movements.length).toBe(3);

      // Check stock & low-stock & valuation & inventory report queries
      await conversationService.handleIncomingMessage(phone, 'Sugar stock ethra und?', null, owner);
      await conversationService.handleIncomingMessage(phone, 'Low stock items', null, owner);
      await conversationService.handleIncomingMessage(phone, 'Inventory valuation', null, owner);
      await conversationService.handleIncomingMessage(phone, 'Inventory report', null, owner);
    });

    it('requires explicit confirmation before executing destructive stock adjustments', async () => {
      await conversationService.handleIncomingMessage(phone, 'Stock in 50 kg Rice', null, owner);

      // Request adjustment -> should enter CONFIRM_STOCK_ADJUSTMENT state without modifying stock yet
      await conversationService.handleIncomingMessage(phone, 'Adjust Rice stock to 35 kg', null, owner);

      const { business } = await businessService.resolveBusinessForUser(phone);
      let rice = await Product.findOne({ businessId: business._id, normalizedName: 'rice' });
      expect(rice.currentStock).toBe(50);

      const session = await ConversationSession.findOne({ whatsappNumber: phone });
      expect(session.currentIntent).toBe('CONFIRM_STOCK_ADJUSTMENT');
      expect(session.pendingConfirmation?.type).toBe('STOCK_ADJUSTMENT');

      // Confirm via text or button
      await conversationService.handleIncomingMessage(phone, 'Confirm', null, owner);

      rice = await Product.findOne({ businessId: business._id, normalizedName: 'rice' });
      expect(rice.currentStock).toBe(35);
    });

    it('records customer credit sales, customer payments, and checks customer balances', async () => {
      await conversationService.handleIncomingMessage(phone, 'Credit sale 3000 to Ravi', null, owner);
      await conversationService.handleIncomingMessage(phone, 'Ravi paid 1200 via UPI', null, owner);
      await conversationService.handleIncomingMessage(phone, 'Customer balance Ravi', null, owner);
      await conversationService.handleIncomingMessage(phone, 'Weekly report', null, owner);

      const { business } = await businessService.resolveBusinessForUser(phone);
      const ravi = await Customer.findOne({ businessId: business._id, normalizedName: 'ravi' });

      expect(ravi).toBeTruthy();
      expect(ravi.totalCreditSales).toBe(3000);
      expect(ravi.totalPaymentsReceived).toBe(1200);
      expect(ravi.outstandingBalance).toBe(1800);
    });

    it('asks for clarification on ambiguous product/quantity and resolves on follow-up', async () => {
      // Missing quantity: "Stock in Rice"
      await conversationService.handleIncomingMessage(phone, 'Stock in Rice', null, owner);

      const session = await ConversationSession.findOne({ whatsappNumber: phone });
      expect(session.pendingTransaction).toBeTruthy();
      expect(session.pendingTransaction.intent).toBe(CONVERSATION_INTENTS.STOCK_IN);

      // User replies with missing quantity: "25 kg"
      await conversationService.handleIncomingMessage(phone, '25 kg', null, owner);

      const { business } = await businessService.resolveBusinessForUser(phone);
      const rice = await Product.findOne({ businessId: business._id, normalizedName: 'rice' });
      expect(rice).toBeTruthy();
      expect(rice.currentStock).toBe(25);
    });
  });

  describe('3. Duplicate Webhook Prevention & Tenant Isolation', () => {
    it('prevents duplicate stock-in when Meta retries the same WhatsApp webhook messageId', async () => {
      const phone = '919876500222';
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'BIZ_1',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  contacts: [{ wa_id: phone, profile: { name: 'Store One' } }],
                  messages: [
                    {
                      from: phone,
                      id: 'wamid.stock_retry_001',
                      timestamp: '1700000000',
                      type: 'text',
                      text: { body: 'Stock in 10 kg Sugar' },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const secret = process.env.WHATSAPP_APP_SECRET || env.WHATSAPP_APP_SECRET;
      const headers = secret
        ? {
            'x-hub-signature-256': `sha256=${crypto
              .createHmac('sha256', secret)
              .update(JSON.stringify(payload))
              .digest('hex')}`,
          }
        : {};

      await request(app).post('/webhook/whatsapp').set(headers).send(payload);
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const log = await MessageLog.findOne({ whatsappMessageId: 'wamid.stock_retry_001' });
        if (log && log.processingStatus === 'PROCESSED') break;
      }

      // Retry exact same webhook
      await request(app).post('/webhook/whatsapp').set(headers).send(payload);
      await new Promise((r) => setTimeout(r, 150));

      const { business } = await businessService.resolveBusinessForUser(phone);
      const sugar = await Product.findOne({ businessId: business._id, normalizedName: 'sugar' });
      expect(sugar.currentStock).toBe(10); // Added once, not 20
    });

    it('enforces strict tenant isolation between two businesses on WhatsApp', async () => {
      const phoneA = '919876500301';
      const phoneB = '919876500302';

      await conversationService.handleIncomingMessage(phoneA, 'Stock in 100 kg Rice', null, 'Biz A');
      await conversationService.handleIncomingMessage(phoneB, 'Stock in 5 kg Rice', null, 'Biz B');

      const resA = await businessService.resolveBusinessForUser(phoneA);
      const resB = await businessService.resolveBusinessForUser(phoneB);

      const riceA = await Product.findOne({ businessId: resA.business._id, normalizedName: 'rice' });
      const riceB = await Product.findOne({ businessId: resB.business._id, normalizedName: 'rice' });

      expect(riceA.currentStock).toBe(100);
      expect(riceB.currentStock).toBe(5);
    });
  });
});

