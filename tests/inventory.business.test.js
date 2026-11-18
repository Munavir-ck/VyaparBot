import { describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { getBusinessTypeConfig } from '../src/modules/businesses/business-types.config.js';
import { transactionService } from '../src/modules/transactions/transaction.service.js';
import { customerService } from '../src/modules/customers/customer.service.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';
import { Product } from '../src/modules/inventory/product.model.js';
import { StockMovement } from '../src/modules/inventory/stock-movement.model.js';
import { Customer } from '../src/modules/customers/customer.model.js';
import { PaymentRecord } from '../src/modules/payments/payment-record.model.js';

describe('Phase 1 & 2: Multi-Business Types, Customers & Inventory Management', () => {
  describe('1. Configurable Business Type Architecture', () => {
    it('supports RESTAURANT, GROCERY, RETAIL, WHOLESALE, and GENERAL configs', () => {
      const grocery = getBusinessTypeConfig('GROCERY');
      const retail = getBusinessTypeConfig('RETAIL');
      const wholesale = getBusinessTypeConfig('WHOLESALE');
      const general = getBusinessTypeConfig('GENERAL');
      const restaurant = getBusinessTypeConfig('RESTAURANT');

      expect(grocery.type).toBe('GROCERY');
      expect(grocery.expenseCategories).toContain('STOCK_PURCHASE');
      expect(retail.type).toBe('RETAIL');
      expect(wholesale.type).toBe('WHOLESALE');
      expect(general.type).toBe('GENERAL');
      expect(restaurant.inventoryDefaults.autoDeductOnLumpSumSale).toBe(false);
    });

    it('provisions and switches business types cleanly', async () => {
      const res = await businessService.resolveBusinessForUser('919111222333', 'Fresh Mart', {
        businessType: 'GROCERY',
        businessName: 'Fresh Mart Grocery',
      });

      expect(res.business.businessType).toBe('GROCERY');
      expect(res.business.settings.enabledModules.inventoryManagement).toBe(true);
      expect(res.permissions).toContain('MANAGE_INVENTORY');
      expect(res.permissions).toContain('ADJUST_STOCK');

      const updated = await businessService.updateBusinessType(res.business._id, 'WHOLESALE');
      expect(updated.business.businessType).toBe('WHOLESALE');
    });
  });

  describe('2. Customer Credit Sales & Receivables', () => {
    it('tracks customer credit sales and incoming payments accurately', async () => {
      const { user, business } = await businessService.resolveBusinessForUser('919222333444', 'Shop A', {
        businessType: 'RETAIL',
      });

      // Credit sale of 3000 to Customer Ravi
      const saleRes = await transactionService.recordSale({
        businessId: business._id,
        amount: 3000,
        paymentMethod: 'CREDIT',
        customerName: 'Ravi Kumar',
        createdBy: user._id,
      });

      expect(saleRes.success).toBe(true);
      expect(saleRes.customer.outstandingBalance).toBe(3000);

      // Customer pays 1200 via UPI
      const payRes = await customerService.recordCustomerPayment({
        businessId: business._id,
        customerName: 'Ravi Kumar',
        amount: 1200,
        paymentMethod: 'UPI',
        createdBy: user._id,
      });

      expect(payRes.success).toBe(true);
      expect(payRes.customer.totalPaymentsReceived).toBe(1200);
      expect(payRes.customer.outstandingBalance).toBe(1800);

      const savedCustomer = await Customer.findById(payRes.customer._id);
      expect(savedCustomer.outstandingBalance).toBe(1800);

      const paymentRec = await PaymentRecord.findOne({
        businessId: business._id,
        customerId: savedCustomer._id,
      });
      expect(paymentRec.direction).toBe('INCOMING');
      expect(paymentRec.amount).toBe(1200);
    });
  });

  describe('3. Inventory Ledger, Atomic Updates & Idempotency', () => {
    it('uses StockMovement as source of truth on product creation with initial stock', async () => {
      const { user, business } = await businessService.resolveBusinessForUser('919333444555', 'Grocery Store', {
        businessType: 'GROCERY',
      });

      const product = await inventoryService.createOrUpdateProduct({
        businessId: business._id,
        name: 'Matta Rice',
        category: 'GRAINS_PULSES',
        unit: 'kg',
        minStockLevel: 20,
        costPrice: 50,
        sellingPrice: 62,
        initialStock: 100,
        createdBy: user._id,
      });

      expect(product.currentStock).toBe(100);

      const movements = await StockMovement.find({ businessId: business._id, productId: product._id });
      expect(movements.length).toBe(1);
      expect(movements[0].type).toBe('STOCK_IN');
      expect(movements[0].previousStock).toBe(0);
      expect(movements[0].newStock).toBe(100);
    });

    it('prevents duplicate stock movements via idempotencyKey', async () => {
      const { user, business } = await businessService.resolveBusinessForUser('919333444556', 'Store B', {
        businessType: 'GROCERY',
      });

      const product = await inventoryService.createOrUpdateProduct({
        businessId: business._id,
        name: 'Sugar',
        unit: 'kg',
        initialStock: 50,
        createdBy: user._id,
      });

      const first = await inventoryService.recordStockMovement({
        businessId: business._id,
        productId: product._id,
        type: 'STOCK_IN',
        quantity: 25,
        idempotencyKey: 'retry_key_123',
        reason: 'Restock',
        createdBy: user._id,
      });

      const second = await inventoryService.recordStockMovement({
        businessId: business._id,
        productId: product._id,
        type: 'STOCK_IN',
        quantity: 25,
        idempotencyKey: 'retry_key_123',
        reason: 'Restock',
        createdBy: user._id,
      });

      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);

      const refreshed = await Product.findById(product._id);
      expect(refreshed.currentStock).toBe(75); // 50 + 25 once, not 100
    });

    it('increases inventory on itemized purchase and deducts only once on itemized sale', async () => {
      const { user, business } = await businessService.resolveBusinessForUser('919333444557', 'Wholesale Hub', {
        businessType: 'WHOLESALE',
      });

      const product = await inventoryService.createOrUpdateProduct({
        businessId: business._id,
        name: 'Coconut Oil',
        unit: 'litre',
        minStockLevel: 10,
        costPrice: 180,
        sellingPrice: 220,
        initialStock: 20,
        createdBy: user._id,
      });

      // 1. Itemized Purchase (+30 litres)
      const purchaseRes = await transactionService.recordPurchase({
        businessId: business._id,
        amount: 5400,
        paymentMethod: 'CREDIT',
        merchantOrSupplier: 'Kerala Mills',
        items: [{ productId: product._id, productName: 'Coconut Oil', quantity: 30, unit: 'litre', unitPrice: 180 }],
        createdBy: user._id,
      });

      expect(purchaseRes.stockResult.processed).toBe(1);
      let afterPurchase = await Product.findById(product._id);
      expect(afterPurchase.currentStock).toBe(50);

      // 2. Itemized Sale (-12 litres)
      const saleRes = await transactionService.recordSale({
        businessId: business._id,
        amount: 2640,
        paymentMethod: 'UPI',
        items: [{ productId: product._id, productName: 'Coconut Oil', quantity: 12, unit: 'litre', unitPrice: 220 }],
        createdBy: user._id,
      });

      expect(saleRes.stockResult.skipped).toBe(false);
      expect(saleRes.stockResult.processed).toBe(1);

      // Attempt duplicate sale stock deduction call
      const duplicateDeduction = await inventoryService.processSaleStockOut({
        businessId: business._id,
        transaction: { ...saleRes.transaction.toObject(), stockSynced: true },
        items: saleRes.transaction.items,
      });
      expect(duplicateDeduction.skipped).toBe(true);

      const afterSale = await Product.findById(product._id);
      expect(afterSale.currentStock).toBe(38); // 50 - 12
    });

    it('does NOT auto-deduct inventory for daily lump-sum sales', async () => {
      const { user, business } = await businessService.resolveBusinessForUser('919333444558', 'Pilot Kitchen', {
        businessType: 'RESTAURANT',
      });

      const product = await inventoryService.createOrUpdateProduct({
        businessId: business._id,
        name: 'Basmati Rice',
        unit: 'kg',
        initialStock: 40,
        createdBy: user._id,
      });

      const saleRes = await transactionService.recordSale({
        businessId: business._id,
        amount: 12500,
        paymentBreakdown: { cash: 7500, upi: 5000 },
        salePeriod: 'FULL_DAY',
        createdBy: user._id,
      });

      expect(saleRes.transaction.isLumpSum).toBe(true);
      expect(saleRes.stockResult.skipped).toBe(true);
      expect(saleRes.stockResult.reason).toBe('LUMP_SUM_SALE_NO_AUTO_DEDUCT');

      const refreshed = await Product.findById(product._id);
      expect(refreshed.currentStock).toBe(40);
    });

    it('handles wastage, audited adjustments, low-stock alerts, and valuation', async () => {
      const { user, business } = await businessService.resolveBusinessForUser('919333444559', 'Fresh Mart', {
        businessType: 'GROCERY',
      });

      const tomatoes = await inventoryService.createOrUpdateProduct({
        businessId: business._id,
        name: 'Tomato',
        category: 'VEGETABLES_FRUITS',
        unit: 'kg',
        minStockLevel: 10,
        costPrice: 40,
        initialStock: 15,
        createdBy: user._id,
      });

      // Wastage of 4 kg -> 11 kg remaining
      await inventoryService.recordWastageOrDamage({
        businessId: business._id,
        productId: tomatoes._id,
        quantity: 4,
        type: 'WASTAGE',
        reason: 'Spoiled overnight',
        createdBy: user._id,
      });

      // Adjustment to 8 kg (triggers low-stock alert since 8 <= 10)
      await inventoryService.adjustStock({
        businessId: business._id,
        productId: tomatoes._id,
        newStockCount: 8,
        reason: 'Physical shelf count reconciliation',
        createdBy: user._id,
      });

      const alerts = await inventoryService.getLowStockAlerts(business._id);
      expect(alerts.length).toBe(1);
      expect(alerts[0].name).toBe('Tomato');
      expect(alerts[0].currentStock).toBe(8);

      const valuation = await inventoryService.getInventoryValuation(business._id);
      expect(valuation.totalUnits).toBe(8);
      expect(valuation.totalValue).toBe(320); // 8 * 40

      const history = await inventoryService.getStockMovementHistory(business._id, { productId: tomatoes._id });
      expect(history.length).toBe(3); // STOCK_IN (15), WASTAGE (-4), ADJUSTMENT (-3)
    });

    it('enforces strict businessId tenant isolation for inventory', async () => {
      const bizA = await businessService.resolveBusinessForUser('919444000001', 'Biz A');
      const bizB = await businessService.resolveBusinessForUser('919444000002', 'Biz B');

      await inventoryService.createOrUpdateProduct({
        businessId: bizA.business._id,
        name: 'Secret Item A',
        initialStock: 10,
      });

      const alertsB = await inventoryService.getLowStockAlerts(bizB.business._id);
      const valB = await inventoryService.getInventoryValuation(bizB.business._id);
      expect(alertsB.length).toBe(0);
      expect(valB.productCount).toBe(0);
    });
  });

  describe('4. Inventory REST APIs', () => {
    it('creates products, records stock-in, wastage, valuation and alerts via HTTP', async () => {
      const headers = { 'x-user-phone': '919555666777' };

      const createRes = await request(app)
        .post('/api/inventory/products')
        .set(headers)
        .send({
          name: 'Cooking Oil',
          category: 'GROCERIES',
          unit: 'litre',
          minStockLevel: 15,
          costPrice: 120,
          initialStock: 10,
        });

      expect(createRes.status).toBe(201);
      const productId = createRes.body.data._id;

      const stockInRes = await request(app)
        .post('/api/inventory/stock-in')
        .set(headers)
        .send({ productId, quantity: 10, reason: 'Morning delivery' });
      expect(stockInRes.status).toBe(201);
      expect(stockInRes.body.data.product.currentStock).toBe(20);

      const valRes = await request(app).get('/api/inventory/valuation').set(headers);
      expect(valRes.status).toBe(200);
      expect(valRes.body.data.totalValue).toBe(2400); // 20 * 120
    });
  });
});

