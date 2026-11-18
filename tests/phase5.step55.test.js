import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { User } from '../src/modules/users/user.model.js';
import {
  BusinessMember,
  ROLE_DEFAULT_PERMISSIONS,
} from '../src/modules/business-members/business-member.model.js';
import { Transaction } from '../src/modules/transactions/transaction.model.js';

describe('Phase 5 (Step 5.5): Customers, Suppliers, Receivables & Payables', () => {
  it('supports Customer & Supplier CRUD, search, pagination, and editing', async () => {
    const phone = '919877111001';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Step 5.5 Biz');

    // Create 2 customers
    const c1 = await request(app)
      .post('/api/customers')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ name: 'Arun Traders', phone: '9847001122', notes: 'Net 15' });
    expect(c1.status).toBe(201);
    const customerId = c1.body.data._id;

    const c2 = await request(app)
      .post('/api/customers')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ name: 'Balan Store', phone: '9847003344' });
    expect(c2.status).toBe(201);

    // Edit customer
    const cEdit = await request(app)
      .patch(`/api/customers/${customerId}`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ name: 'Arun Wholesale', notes: 'VIP buyer' });
    expect(cEdit.status).toBe(200);
    expect(cEdit.body.data.name).toBe('Arun Wholesale');

    // Search & paginate customers
    const cList = await request(app)
      .get('/api/customers?search=Arun&page=1&limit=10')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(cList.status).toBe(200);
    expect(cList.body.total).toBe(1);
    expect(cList.body.data[0].notes).toBe('VIP buyer');

    // Create & edit supplier
    const s1 = await request(app)
      .post('/api/suppliers')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ name: 'Malabar Mills', phone: '9447005566', notes: 'Grain vendor' });
    expect(s1.status).toBe(201);
    const supplierId = s1.body.data._id;

    const sEdit = await request(app)
      .patch(`/api/suppliers/${supplierId}`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ category: 'Grains', notes: 'Weekly delivery' });
    expect(sEdit.status).toBe(200);
    expect(sEdit.body.data.category).toBe('Grains');

    const sList = await request(app)
      .get('/api/suppliers?search=Malabar&page=1&limit=10')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(sList.status).toBe(200);
    expect(sList.body.total).toBe(1);
    expect(sList.body.data[0].notes).toBe('Weekly delivery');
  });

  it('maintains receivable/payable balances, prevents duplicate payments, and reverses on void', async () => {
    const phone = '919877111002';
    const { business } = await businessService.resolveBusinessForUser(phone, 'Step 5.5 Ledger Biz');

    // 1. Credit sale increases customer receivable (3000)
    const saleRes = await request(app)
      .post('/api/transactions/sale')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        amount: 3000,
        paymentMethod: 'CREDIT',
        customerName: 'Faisal',
      });
    expect(saleRes.status).toBe(201);
    const customerId = saleRes.body.data.customer._id;
    expect(saleRes.body.data.customer.outstandingBalance).toBe(3000);

    // 2. Customer payment (1200) reduces receivable -> 1800, does NOT create a SALE transaction
    const custPayKey = 'cust-pay-001';
    const cp1 = await request(app)
      .post(`/api/customers/${customerId}/payments`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        amount: 1200,
        paymentMethod: 'UPI',
        referenceId: 'UTR-101',
        idempotencyKey: custPayKey,
      });
    expect(cp1.status).toBe(201);
    expect(cp1.body.data.customer.outstandingBalance).toBe(1800);
    const custPayTxId = cp1.body.data.transaction._id;

    // Duplicate customer payment prevented
    const cp2 = await request(app)
      .post(`/api/customers/${customerId}/payments`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        amount: 1200,
        paymentMethod: 'UPI',
        idempotencyKey: custPayKey,
      });
    expect(cp2.status).toBe(201);
    expect(cp2.body.data.duplicate).toBe(true);
    expect(cp2.body.data.customer.outstandingBalance).toBe(1800);

    const salesCount = await Transaction.countDocuments({
      businessId: business._id,
      type: 'SALE',
      status: 'COMPLETED',
    });
    expect(salesCount).toBe(1);

    // Business-wide customer payment history & balances
    const custBalRes = await request(app)
      .get('/api/customers/balances?onlyOutstanding=true')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(custBalRes.status).toBe(200);
    expect(custBalRes.body.totalReceivables).toBe(1800);

    const allCustPays = await request(app)
      .get('/api/customers/payments')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(allCustPays.status).toBe(200);
    expect(allCustPays.body.count).toBe(1);

    // 3. Credit purchase increases supplier payable (5000)
    const purRes = await request(app)
      .post('/api/transactions/purchase')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        amount: 5000,
        paymentMethod: 'CREDIT',
        merchantOrSupplier: 'Metro Dairy',
      });
    expect(purRes.status).toBe(201);
    const supplierId = purRes.body.data.supplier._id;
    expect(purRes.body.data.supplier.outstandingBalance).toBe(5000);

    // 4. Supplier payment (2000) reduces payable -> 3000, does NOT create PURCHASE or EXPENSE
    const supPayKey = 'sup-pay-001';
    const sp1 = await request(app)
      .post(`/api/suppliers/${supplierId}/payments`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        amount: 2000,
        paymentMethod: 'BANK_TRANSFER',
        referenceId: 'NEFT-202',
        idempotencyKey: supPayKey,
      });
    expect(sp1.status).toBe(201);
    expect(sp1.body.data.supplier.outstandingBalance).toBe(3000);
    const supPayTxId = sp1.body.data.transaction._id;

    // Duplicate supplier payment prevented
    const sp2 = await request(app)
      .post(`/api/suppliers/${supplierId}/payments`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({
        amount: 2000,
        paymentMethod: 'BANK_TRANSFER',
        idempotencyKey: supPayKey,
      });
    expect(sp2.status).toBe(201);
    expect(sp2.body.data.duplicate).toBe(true);
    expect(sp2.body.data.supplier.outstandingBalance).toBe(3000);

    const purAndExpCount = await Transaction.countDocuments({
      businessId: business._id,
      type: { $in: ['PURCHASE', 'EXPENSE'] },
      status: 'COMPLETED',
    });
    expect(purAndExpCount).toBe(1);

    // Business-wide supplier payment history
    const allSupPays = await request(app)
      .get('/api/suppliers/payments')
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(allSupPays.status).toBe(200);
    expect(allSupPays.body.count).toBe(1);

    // 5. Voiding customer payment reverses receivable back to 3000 and removes from payment history
    const voidCustPay = await request(app)
      .post(`/api/transactions/${custPayTxId}/void`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ reason: 'Bounced UPI' });
    expect(voidCustPay.status).toBe(200);

    const custLedgerAfterVoid = await request(app)
      .get(`/api/customers/${customerId}/ledger`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(custLedgerAfterVoid.status).toBe(200);
    expect(custLedgerAfterVoid.body.data.summary.outstandingBalance).toBe(3000);
    expect(custLedgerAfterVoid.body.data.payments.length).toBe(0);

    // 6. Voiding supplier payment reverses payable back to 5000 and removes from payment history
    const voidSupPay = await request(app)
      .post(`/api/transactions/${supPayTxId}/void`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id))
      .send({ reason: 'Reversed NEFT' });
    expect(voidSupPay.status).toBe(200);

    const supLedgerAfterVoid = await request(app)
      .get(`/api/suppliers/${supplierId}/ledger`)
      .set('x-user-phone', phone)
      .set('x-business-id', String(business._id));
    expect(supLedgerAfterVoid.status).toBe(200);
    expect(supLedgerAfterVoid.body.data.summary.outstandingBalance).toBe(5000);
    expect(supLedgerAfterVoid.body.data.payments.length).toBe(0);
  });

  it('enforces RBAC permissions and cross-business isolation for customers and suppliers', async () => {
    const ownerAPhone = '919877111003';
    const cashierPhone = '919877111004';
    const ownerBPhone = '919877111005';

    const { business: bizA } = await businessService.resolveBusinessForUser(ownerAPhone, 'Biz A');
    const { business: bizB } = await businessService.resolveBusinessForUser(ownerBPhone, 'Biz B');

    const cashierUser = await User.create({ whatsappNumber: cashierPhone, name: 'Cashier A' });
    await BusinessMember.create({
      businessId: bizA._id,
      userId: cashierUser._id,
      role: 'CASHIER',
      permissions: ROLE_DEFAULT_PERMISSIONS.CASHIER,
    });

    const cRes = await request(app)
      .post('/api/customers')
      .set('x-user-phone', ownerAPhone)
      .set('x-business-id', String(bizA._id))
      .send({ name: 'BizA Customer' });
    const custAId = cRes.body.data._id;

    const sRes = await request(app)
      .post('/api/suppliers')
      .set('x-user-phone', ownerAPhone)
      .set('x-business-id', String(bizA._id))
      .send({ name: 'BizA Supplier' });
    const supAId = sRes.body.data._id;

    // CASHIER lacks MANAGE_CUSTOMERS and MANAGE_SUPPLIERS
    const cashierCust = await request(app)
      .get('/api/customers')
      .set('x-user-phone', cashierPhone)
      .set('x-business-id', String(bizA._id));
    expect(cashierCust.status).toBe(403);

    const cashierSup = await request(app)
      .get('/api/suppliers')
      .set('x-user-phone', cashierPhone)
      .set('x-business-id', String(bizA._id));
    expect(cashierSup.status).toBe(403);

    // Cross-business isolation: Biz B cannot read or edit Biz A's customer or supplier
    const crossCustGet = await request(app)
      .get(`/api/customers/${custAId}/ledger`)
      .set('x-user-phone', ownerBPhone)
      .set('x-business-id', String(bizB._id));
    expect(crossCustGet.status).toBe(404);

    const crossSupPatch = await request(app)
      .patch(`/api/suppliers/${supAId}`)
      .set('x-user-phone', ownerBPhone)
      .set('x-business-id', String(bizB._id))
      .send({ name: 'Hacked Supplier' });
    expect(crossSupPatch.status).toBe(404);
  });
});
