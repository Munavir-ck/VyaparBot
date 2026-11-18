import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { User } from '../src/modules/users/user.model.js';
import { BusinessMember, ROLE_DEFAULT_PERMISSIONS } from '../src/modules/business-members/business-member.model.js';
import { Product } from '../src/modules/inventory/product.model.js';

describe('Phase 5 (Step 5.4): Inventory Management & Stock Ledger Integrity', () => {
  it('supports product creation, editing, archiving, and excludes archived products from active listing', async () => {
    const phone = '919866111001';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Step 5.4 Grocery');

    // Create product
    const createRes = await request(app)
      .post('/api/inventory/products')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        name: 'Basmati Rice',
        category: 'Grains',
        unit: 'kg',
        initialStock: 25,
        minStockLevel: 10,
        costPrice: 80,
        sellingPrice: 110,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.name).toBe('Basmati Rice');
    expect(createRes.body.data.currentStock).toBe(25);
    const productId = createRes.body.data._id;

    // Edit product
    const editRes = await request(app)
      .patch(`/api/inventory/products/${productId}`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        name: 'Premium Basmati Rice',
        minStockLevel: 15,
        costPrice: 85,
        sellingPrice: 120,
      });

    expect(editRes.status).toBe(200);
    expect(editRes.body.data.name).toBe('Premium Basmati Rice');
    expect(editRes.body.data.minStockLevel).toBe(15);

    // Archive product
    const archiveRes = await request(app)
      .delete(`/api/inventory/products/${productId}`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));

    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.data.status).toBe('ARCHIVED');

    // Active listing excludes archived
    const listRes = await request(app)
      .get('/api/inventory/products')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((p) => p._id === productId)).toBe(false);
  });

  it('handles stock-in, stock-out, wastage, adjustment, idempotency, low-stock/out-of-stock, and movement filters', async () => {
    const phone = '919866111002';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Step 5.4 Store');

    // Create two products: one will go low-stock, one will go out-of-stock
    const p1Res = await request(app)
      .post('/api/inventory/products')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        name: 'Cooking Oil',
        category: 'Oils',
        unit: 'litre',
        initialStock: 10,
        minStockLevel: 8,
        costPrice: 120,
        sellingPrice: 150,
      });
    expect(p1Res.status).toBe(201);
    const oilId = p1Res.body.data._id;

    const p2Res = await request(app)
      .post('/api/inventory/products')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        name: 'Fresh Milk',
        category: 'Dairy',
        unit: 'litre',
        initialStock: 5,
        minStockLevel: 5,
        costPrice: 40,
        sellingPrice: 55,
      });
    expect(p2Res.status).toBe(201);
    const milkId = p2Res.body.data._id;

    // Stock-in with idempotencyKey (duplicate prevented)
    const inKey = 'idem-in-001';
    const in1 = await request(app)
      .post('/api/inventory/stock-in')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ productId: oilId, quantity: 5, reason: 'Restock', idempotencyKey: inKey });
    expect(in1.status).toBe(201);
    expect(in1.body.data.product.currentStock).toBe(15);

    const in2 = await request(app)
      .post('/api/inventory/stock-in')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ productId: oilId, quantity: 5, reason: 'Restock', idempotencyKey: inKey });
    expect(in2.status).toBe(201);
    expect(in2.body.data.duplicate).toBe(true);
    expect(in2.body.data.product.currentStock).toBe(15);

    // Stock-out with idempotencyKey
    const outKey = 'idem-out-001';
    const out1 = await request(app)
      .post('/api/inventory/stock-out')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ productId: oilId, quantity: 9, reason: 'Kitchen dispatch', idempotencyKey: outKey });
    expect(out1.status).toBe(201);
    expect(out1.body.data.product.currentStock).toBe(6); // <= minStockLevel (8)

    const out2 = await request(app)
      .post('/api/inventory/stock-out')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ productId: oilId, quantity: 9, reason: 'Kitchen dispatch', idempotencyKey: outKey });
    expect(out2.status).toBe(201);
    expect(out2.body.data.duplicate).toBe(true);
    expect(out2.body.data.product.currentStock).toBe(6);

    // Wastage with idempotencyKey -> bring Fresh Milk from 5 to 0
    const wasteKey = 'idem-waste-001';
    const w1 = await request(app)
      .post('/api/inventory/wastage')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ productId: milkId, quantity: 5, type: 'WASTAGE', reason: 'Spoiled batch', idempotencyKey: wasteKey });
    expect(w1.status).toBe(201);
    expect(w1.body.data.product.currentStock).toBe(0);

    const w2 = await request(app)
      .post('/api/inventory/wastage')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ productId: milkId, quantity: 5, type: 'WASTAGE', reason: 'Spoiled batch', idempotencyKey: wasteKey });
    expect(w2.status).toBe(201);
    expect(w2.body.data.duplicate).toBe(true);
    expect(w2.body.data.product.currentStock).toBe(0);

    // Adjustment with idempotencyKey
    const adjKey = 'idem-adj-001';
    const adj1 = await request(app)
      .post('/api/inventory/adjust')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ productId: oilId, newStockCount: 7, reason: 'Physical audit', idempotencyKey: adjKey });
    expect(adj1.status).toBe(200);
    expect(adj1.body.data.product.currentStock).toBe(7);

    const adj2 = await request(app)
      .post('/api/inventory/adjust')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ productId: oilId, newStockCount: 10, reason: 'Physical audit', idempotencyKey: adjKey });
    expect(adj2.status).toBe(200);
    expect(adj2.body.data.duplicate).toBe(true);
    expect(adj2.body.data.product.currentStock).toBe(7);

    // Low-stock and out-of-stock calculations
    const lowRes = await request(app)
      .get('/api/inventory/alerts/low-stock')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(lowRes.status).toBe(200);
    expect(lowRes.body.count).toBe(2); // Oil (7 <= 8) and Milk (0 <= 5)

    const valRes = await request(app)
      .get('/api/inventory/valuation')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(valRes.status).toBe(200);
    expect(valRes.body.data.productCount).toBe(2);
    expect(valRes.body.data.outOfStockCount).toBe(1); // Fresh Milk is 0
    expect(valRes.body.data.totalValue).toBe(7 * 120); // 840

    // Stock movement filtering by product, type, and date range
    const today = new Date().toISOString().slice(0, 10);
    const oilWastageRes = await request(app)
      .get(`/api/inventory/movements?productId=${milkId}&type=WASTAGE&startDate=${today}&endDate=${today}`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(oilWastageRes.status).toBe(200);
    expect(oilWastageRes.body.total).toBe(1);
    expect(oilWastageRes.body.data[0].type).toBe('WASTAGE');
    expect(oilWastageRes.body.data[0].newStock).toBe(0);

    // Future date range returns empty
    const futureRes = await request(app)
      .get('/api/inventory/movements?startDate=2099-01-01&endDate=2099-01-02')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(futureRes.status).toBe(200);
    expect(futureRes.body.total).toBe(0);
  });

  it('enforces RBAC permissions for CASHIER on inventory mutations', async () => {
    const ownerPhone = '919866111003';
    const cashierPhone = '919866111004';
    const { business } = await businessService.resolveBusinessForUser(ownerPhone, 'Step 5.4 RBAC Biz');

    const cashierUser = await User.create({ whatsappNumber: cashierPhone, name: 'Cashier User' });
    await BusinessMember.create({
      businessId: business._id,
      userId: cashierUser._id,
      role: 'CASHIER',
      permissions: ROLE_DEFAULT_PERMISSIONS.CASHIER,
    });

    const pRes = await request(app)
      .post('/api/inventory/products')
      .set('x-user-phone', ownerPhone)
      .set('x-business-id', String(business._id))
      .send({ name: 'Sugar', unit: 'kg', initialStock: 20, minStockLevel: 5, costPrice: 40 });
    expect(pRes.status).toBe(201);
    const productId = pRes.body.data._id;

    // Cashier can view products (VIEW_INVENTORY)
    const viewRes = await request(app)
      .get('/api/inventory/products')
      .set('x-user-phone', cashierPhone)
      .set('x-business-id', String(business._id));
    expect(viewRes.status).toBe(200);

    // Cashier cannot create product (MANAGE_INVENTORY)
    const createDenied = await request(app)
      .post('/api/inventory/products')
      .set('x-user-phone', cashierPhone)
      .set('x-business-id', String(business._id))
      .send({ name: 'Salt', unit: 'kg' });
    expect(createDenied.status).toBe(403);

    // Cashier cannot stock-in (MANAGE_INVENTORY)
    const stockInDenied = await request(app)
      .post('/api/inventory/stock-in')
      .set('x-user-phone', cashierPhone)
      .set('x-business-id', String(business._id))
      .send({ productId, quantity: 5 });
    expect(stockInDenied.status).toBe(403);

    // Cashier cannot adjust stock (ADJUST_STOCK)
    const adjustDenied = await request(app)
      .post('/api/inventory/adjust')
      .set('x-user-phone', cashierPhone)
      .set('x-business-id', String(business._id))
      .send({ productId, newStockCount: 10, reason: 'Test' });
    expect(adjustDenied.status).toBe(403);
  });

  it('maintains inventory consistency across itemized sales/purchases, edits, voids, and lump-sum sales', async () => {
    const phone = '919866111005';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Step 5.4 Consistency');

    const pRes = await request(app)
      .post('/api/inventory/products')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        name: 'Coffee Powder',
        category: 'Beverages',
        unit: 'kg',
        initialStock: 20,
        minStockLevel: 5,
        costPrice: 300,
        sellingPrice: 450,
      });
    expect(pRes.status).toBe(201);
    const productId = pRes.body.data._id;

    // 1. Itemized sale deducts stock once (20 - 4 = 16)
    const saleRes = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        amount: 1800,
        paymentMethod: 'CASH',
        items: [{ productId, productName: 'Coffee Powder', quantity: 4, unitPrice: 450 }],
      });
    expect(saleRes.status).toBe(201);
    let product = await Product.findById(productId);
    expect(product.currentStock).toBe(16);

    // 2. Editing the sale does not re-deduct stock
    const saleTxId = saleRes.body.data.transaction._id;
    const editSaleRes = await request(app)
      .patch(`/api/transactions/${saleTxId}`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ notes: 'Updated receipt note' });
    expect(editSaleRes.status).toBe(200);
    product = await Product.findById(productId);
    expect(product.currentStock).toBe(16);

    // 3. Voiding (deleting) the itemized sale keeps ledger intact without duplicate deduction
    const voidSaleRes = await request(app)
      .post(`/api/transactions/${saleTxId}/void`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ reason: 'Voided itemized sale' });
    expect(voidSaleRes.status).toBe(200);

    // 4. Lump-sum sale does not deduct stock
    const lumpSumRes = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        amount: 5000,
        paymentMethod: 'UPI',
        notes: 'Daily counter lump-sum',
      });
    expect(lumpSumRes.status).toBe(201);
    product = await Product.findById(productId);
    expect(product.currentStock).toBe(16);

    // 5. Itemized purchase adds stock once (16 + 10 = 26) and editing purchase does not double-add
    const purRes = await request(app)
      .post('/api/transactions/purchase')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        amount: 3000,
        paymentMethod: 'CASH',
        merchantOrSupplier: 'Estate Roasters',
        items: [{ productId, productName: 'Coffee Powder', quantity: 10, unitPrice: 300 }],
      });
    expect(purRes.status).toBe(201);
    product = await Product.findById(productId);
    expect(product.currentStock).toBe(26);

    const editPurRes = await request(app)
      .patch(`/api/transactions/${purRes.body.data.transaction._id}`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ notes: 'Batch #42' });
    expect(editPurRes.status).toBe(200);
    product = await Product.findById(productId);
    expect(product.currentStock).toBe(26);
  });
});
