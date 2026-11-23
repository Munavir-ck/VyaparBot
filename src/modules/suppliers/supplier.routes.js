import express from 'express';
import { supplierService } from './supplier.service.js';
import { transactionService } from '../transactions/transaction.service.js';
import {
  resolveBusinessContext,
  requirePermission,
  requireModule,
  requireWriteSubscription,
} from '../../middleware/auth.middleware.js';
import { mutationLimiter } from '../../middleware/rate-limiter.js';

const router = express.Router();

router.use(resolveBusinessContext, requireModule('purchases'), requireWriteSubscription);

// GET /api/suppliers - List active suppliers with balances (optional pagination)
router.get('/', requirePermission('MANAGE_SUPPLIERS'), async (req, res, next) => {
  try {
    const allSuppliers = await supplierService.getSuppliersWithBalances(req.business._id);
    const totalPayables = allSuppliers.reduce((sum, s) => sum + Math.max(0, s.outstandingBalance), 0);

    let filtered = allSuppliers;
    if (req.query.search && String(req.query.search).trim()) {
      const q = String(req.query.search).trim().toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.phone && String(s.phone).toLowerCase().includes(q)) ||
          (s.category && String(s.category).toLowerCase().includes(q)),
      );
    }
    if (req.query.onlyOutstanding === 'true') {
      filtered = filtered.filter((s) => s.outstandingBalance > 0);
    }

    const total = filtered.length;
    if (req.query.page || req.query.limit) {
      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const start = (pageNum - 1) * limitNum;
      const paged = filtered.slice(start, start + limitNum);
      return res.json({
        status: 'success',
        totalPayables,
        count: paged.length,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
        data: paged,
      });
    }

    res.json({ status: 'success', totalPayables, count: total, total, data: filtered });
  } catch (err) {
    next(err);
  }
});

// GET /api/suppliers/payments - Business-wide supplier payment history
router.get('/payments', requirePermission('MANAGE_SUPPLIERS'), async (req, res, next) => {
  try {
    const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const payments = await supplierService.getAllSupplierPayments(req.business._id, {
      limit: limitNum,
    });
    res.json({ status: 'success', count: payments.length, data: payments });
  } catch (err) {
    next(err);
  }
});

// POST /api/suppliers - Create or update supplier
router.post('/', requirePermission('MANAGE_SUPPLIERS'), async (req, res, next) => {
  try {
    const { name, phone, notes } = req.body;
    const supplier = await supplierService.findOrCreateSupplier(req.business._id, name, phone, notes);
    res.status(201).json({ status: 'success', data: supplier });
  } catch (err) {
    next(err);
  }
});

// GET /api/suppliers/:id - Supplier details & summary
router.get('/:id', requirePermission('MANAGE_SUPPLIERS'), async (req, res, next) => {
  try {
    const ledger = await supplierService.getSupplierLedger(req.business._id, req.params.id);
    res.json({ status: 'success', data: ledger });
  } catch (err) {
    if (err.message === 'SUPPLIER_NOT_FOUND') {
      return res.status(404).json({ status: 'fail', message: 'Supplier not found' });
    }
    next(err);
  }
});

// PATCH /api/suppliers/:id - Update supplier details
router.patch('/:id', requirePermission('MANAGE_SUPPLIERS'), async (req, res, next) => {
  try {
    const supplier = await supplierService.updateSupplier(req.business._id, req.params.id, req.body);
    res.json({ status: 'success', data: supplier });
  } catch (err) {
    if (err.message === 'SUPPLIER_NOT_FOUND') {
      return res.status(404).json({ status: 'fail', message: 'Supplier not found' });
    }
    next(err);
  }
});

// GET /api/suppliers/:id/purchases - Supplier purchase history
router.get('/:id/purchases', requirePermission('MANAGE_SUPPLIERS'), async (req, res, next) => {
  try {
    const purchases = await supplierService.getSupplierPurchases(req.business._id, req.params.id);
    res.json({ status: 'success', count: purchases.length, data: purchases });
  } catch (err) {
    next(err);
  }
});

// GET /api/suppliers/:id/payments - Supplier payment history
router.get('/:id/payments', requirePermission('MANAGE_SUPPLIERS'), async (req, res, next) => {
  try {
    const payments = await supplierService.getSupplierPayments(req.business._id, req.params.id);
    res.json({ status: 'success', count: payments.length, data: payments });
  } catch (err) {
    next(err);
  }
});

// POST /api/suppliers/:id/payments - Record payment to settle supplier payable
router.post('/:id/payments', mutationLimiter, requirePermission('MANAGE_SUPPLIERS'), async (req, res, next) => {
  try {
    const supplier = await supplierService.getSupplierByNameOrId(req.business._id, req.params.id);
    if (!supplier) {
      return res.status(404).json({ status: 'fail', message: 'Supplier not found' });
    }
    const result = await transactionService.recordSupplierPayment({
      ...req.body,
      businessId: req.business._id,
      merchantOrSupplier: supplier.name,
      createdBy: req.user._id,
      source: 'API',
    });
    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/suppliers/:id/ledger - Get supplier transaction ledger
router.get('/:id/ledger', requirePermission('MANAGE_SUPPLIERS'), async (req, res, next) => {
  try {
    const ledger = await supplierService.getSupplierLedger(req.business._id, req.params.id);
    res.json({ status: 'success', data: ledger });
  } catch (err) {
    if (err.message === 'SUPPLIER_NOT_FOUND') {
      return res.status(404).json({ status: 'fail', message: 'Supplier not found' });
    }
    next(err);
  }
});

export default router;
