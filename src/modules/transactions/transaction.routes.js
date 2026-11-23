import express from 'express';
import { transactionService } from './transaction.service.js';
import { Transaction } from './transaction.model.js';
import {
  resolveBusinessContext,
  requirePermission,
  requireModule,
  requireWriteSubscription,
} from '../../middleware/auth.middleware.js';
import { mutationLimiter } from '../../middleware/rate-limiter.js';

const router = express.Router();

router.use(resolveBusinessContext, requireWriteSubscription);

// GET /api/transactions - List transactions with search, filters & pagination
router.get('/', requirePermission('VIEW_REPORTS'), async (req, res, next) => {
  try {
    const {
      type,
      status,
      category,
      search,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = req.query;

    const filter = { businessId: req.business._id };
    if (type) filter.type = String(type).toUpperCase();
    if (status) filter.status = String(status).toUpperCase();
    if (category) filter.category = String(category).toUpperCase();

    if (startDate || endDate) {
      filter.transactionDate = {};
      if (startDate) filter.transactionDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.transactionDate.$lte = end;
      }
    }

    if (search && String(search).trim()) {
      const regex = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { description: regex },
        { category: regex },
        { supplierName: regex },
        { customerName: regex },
        { referenceId: regex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [transactions, total] = await Promise.all([
      Transaction.find(filter).sort({ transactionDate: -1 }).skip(skip).limit(limitNum),
      Transaction.countDocuments(filter),
    ]);

    res.json({
      status: 'success',
      count: transactions.length,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      data: transactions,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/transactions/sale - Record sale
router.post('/sale', mutationLimiter, requirePermission('RECORD_TRANSACTIONS'), async (req, res, next) => {
  try {
    const result = await transactionService.recordSale({
      ...req.body,
      businessId: req.business._id,
      createdBy: req.user._id,
      source: 'API',
    });
    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/transactions/expense - Record expense
router.post('/expense', mutationLimiter, requirePermission('RECORD_TRANSACTIONS'), async (req, res, next) => {
  try {
    const result = await transactionService.recordExpense({
      ...req.body,
      businessId: req.business._id,
      createdBy: req.user._id,
      source: 'API',
    });
    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/transactions/purchase - Record supplier purchase
router.post('/purchase', mutationLimiter, requireModule('purchases'), requirePermission('RECORD_TRANSACTIONS'), async (req, res, next) => {
  try {
    const result = await transactionService.recordPurchase({
      ...req.body,
      businessId: req.business._id,
      createdBy: req.user._id,
      source: 'API',
    });
    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/transactions/:id - Edit transaction with audit trail
router.patch('/:id', mutationLimiter, requirePermission('EDIT_TRANSACTIONS'), async (req, res, next) => {
  try {
    const { amount, category, paymentMethod, description, reason } = req.body;
    const result = await transactionService.editTransaction({
      businessId: req.business._id,
      transactionId: req.params.id,
      updates: { amount, category, paymentMethod, description },
      changedBy: req.user._id,
      reason: reason || 'Dashboard edit',
    });
    res.json({ status: 'success', data: result });
  } catch (err) {
    if (err.message === 'TRANSACTION_NOT_FOUND') {
      return res.status(404).json({ status: 'fail', message: 'Transaction not found' });
    }
    next(err);
  }
});

// POST /api/transactions/:id/void - Void transaction
router.post('/:id/void', mutationLimiter, requirePermission('VOID_TRANSACTIONS'), async (req, res, next) => {
  try {
    const result = await transactionService.voidTransaction({
      businessId: req.business._id,
      transactionId: req.params.id,
      changedBy: req.user._id,
      reason: req.body.reason || 'API void request',
    });
    res.json({ status: 'success', data: result });
  } catch (err) {
    if (err.message === 'TRANSACTION_NOT_FOUND') {
      return res.status(404).json({ status: 'fail', message: 'Transaction not found' });
    }
    next(err);
  }
});

export default router;
