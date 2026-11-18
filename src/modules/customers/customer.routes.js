import express from 'express';
import { customerService } from './customer.service.js';
import {
  resolveBusinessContext,
  requirePermission,
  requireWriteSubscription,
} from '../../middleware/auth.middleware.js';
import { mutationLimiter } from '../../middleware/rate-limiter.js';

const router = express.Router();

router.use(resolveBusinessContext, requireWriteSubscription);

// GET /api/customers - List & search customers (with optional pagination)
router.get('/', requirePermission('MANAGE_CUSTOMERS'), async (req, res, next) => {
  try {
    const allCustomers = await customerService.listCustomers(req.business._id, {
      search: req.query.search,
    });
    const total = allCustomers.length;
    if (req.query.page || req.query.limit) {
      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const start = (pageNum - 1) * limitNum;
      const paged = allCustomers.slice(start, start + limitNum);
      return res.json({
        status: 'success',
        count: paged.length,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
        data: paged,
      });
    }
    res.json({ status: 'success', count: total, total, data: allCustomers });
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/balances - Customers sorted by outstanding balance
router.get('/balances', requirePermission('MANAGE_CUSTOMERS'), async (req, res, next) => {
  try {
    const allCustomers = await customerService.getCustomersWithBalances(req.business._id);
    const totalReceivables = allCustomers.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0);

    let filtered = allCustomers;
    if (req.query.search && String(req.query.search).trim()) {
      const q = String(req.query.search).trim().toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.phone && String(c.phone).toLowerCase().includes(q)),
      );
    }
    if (req.query.onlyOutstanding === 'true') {
      filtered = filtered.filter((c) => c.outstandingBalance > 0);
    }

    const total = filtered.length;
    if (req.query.page || req.query.limit) {
      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const start = (pageNum - 1) * limitNum;
      const paged = filtered.slice(start, start + limitNum);
      return res.json({
        status: 'success',
        totalReceivables,
        count: paged.length,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
        data: paged,
      });
    }

    res.json({ status: 'success', totalReceivables, count: total, total, data: filtered });
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/payments - Business-wide customer payment history
router.get('/payments', requirePermission('MANAGE_CUSTOMERS'), async (req, res, next) => {
  try {
    const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const payments = await customerService.getAllCustomerPayments(req.business._id, {
      limit: limitNum,
    });
    res.json({ status: 'success', count: payments.length, data: payments });
  } catch (err) {
    next(err);
  }
});

// POST /api/customers - Create or find customer
router.post('/', requirePermission('MANAGE_CUSTOMERS'), async (req, res, next) => {
  try {
    const { name, phone, notes } = req.body;
    const customer = await customerService.findOrCreateCustomer(req.business._id, name, phone, notes);
    res.status(201).json({ status: 'success', data: customer });
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/:id - View individual customer details & summary
router.get('/:id', requirePermission('MANAGE_CUSTOMERS'), async (req, res, next) => {
  try {
    const ledger = await customerService.getCustomerLedger(req.business._id, req.params.id);
    res.json({ status: 'success', data: ledger });
  } catch (err) {
    if (err.message === 'CUSTOMER_NOT_FOUND') {
      return res.status(404).json({ status: 'fail', message: 'Customer not found' });
    }
    next(err);
  }
});

// PATCH /api/customers/:id - Update customer
router.patch('/:id', requirePermission('MANAGE_CUSTOMERS'), async (req, res, next) => {
  try {
    const customer = await customerService.updateCustomer(req.business._id, req.params.id, req.body);
    res.json({ status: 'success', data: customer });
  } catch (err) {
    if (err.message === 'CUSTOMER_NOT_FOUND') {
      return res.status(404).json({ status: 'fail', message: 'Customer not found' });
    }
    next(err);
  }
});

// POST /api/customers/:id/payments - Record customer payment
router.post('/:id/payments', mutationLimiter, requirePermission('MANAGE_CUSTOMERS'), async (req, res, next) => {
  try {
    const result = await customerService.recordCustomerPayment({
      businessId: req.business._id,
      customerId: req.params.id,
      createdBy: req.user._id,
      ...req.body,
    });
    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    if (err.message === 'CUSTOMER_NOT_FOUND') {
      return res.status(404).json({ status: 'fail', message: 'Customer not found' });
    }
    next(err);
  }
});

// GET /api/customers/:id/payments - View customer payment history
router.get('/:id/payments', requirePermission('MANAGE_CUSTOMERS'), async (req, res, next) => {
  try {
    const payments = await customerService.getCustomerPaymentHistory(req.business._id, req.params.id);
    res.json({ status: 'success', count: payments.length, data: payments });
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/:id/ledger - View customer credit sales & payment settlements
router.get('/:id/ledger', requirePermission('MANAGE_CUSTOMERS'), async (req, res, next) => {
  try {
    const ledger = await customerService.getCustomerLedger(req.business._id, req.params.id);
    res.json({ status: 'success', data: ledger });
  } catch (err) {
    if (err.message === 'CUSTOMER_NOT_FOUND') {
      return res.status(404).json({ status: 'fail', message: 'Customer not found' });
    }
    next(err);
  }
});

export default router;
