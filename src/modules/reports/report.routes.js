import express from 'express';
import { reportService } from './report.service.js';
import {
  resolveBusinessContext,
  requirePermission,
  requireModule,
  requirePlanFeature,
} from '../../middleware/auth.middleware.js';

const router = express.Router();

router.use(resolveBusinessContext);

// GET /api/reports/daily
router.get('/daily', requirePermission('VIEW_REPORTS'), async (req, res, next) => {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const report = await reportService.generateDailyReport(
      req.business._id,
      date,
      req.business.timezone || 'Asia/Kolkata',
    );
    res.json({ status: 'success', data: report });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/weekly
router.get('/weekly', requirePermission('VIEW_REPORTS'), requirePlanFeature('advancedReports'), async (req, res, next) => {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const report = await reportService.generateWeeklyReport(
      req.business._id,
      date,
      req.business.timezone || 'Asia/Kolkata',
    );
    res.json({ status: 'success', data: report });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/monthly
router.get('/monthly', requirePermission('VIEW_REPORTS'), requirePlanFeature('advancedReports'), async (req, res, next) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : undefined;
    const month = req.query.month ? parseInt(req.query.month, 10) : undefined;
    const report = await reportService.generateMonthlyReport(
      req.business._id,
      year,
      month,
      req.business.timezone || 'Asia/Kolkata',
    );
    res.json({ status: 'success', data: report });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/summary - Custom date-range financial summary
router.get('/summary', requirePermission('VIEW_REPORTS'), requirePlanFeature('advancedReports'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const report = await reportService.generateRangeFinancialReport(req.business._id, {
      startDate,
      endDate,
      timezone: req.business.timezone || 'Asia/Kolkata',
    });
    res.json({ status: 'success', data: report });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/cash-flow
router.get('/cash-flow', requirePermission('VIEW_REPORTS'), requirePlanFeature('advancedReports'), async (req, res, next) => {
  try {
    const { startDate, endDate, openingCash, openingBankUpi } = req.query;
    const report = await reportService.generateCashFlowReport(req.business._id, {
      startDate,
      endDate,
      openingCash: openingCash !== undefined ? Number(openingCash) : null,
      openingBankUpi: openingBankUpi !== undefined ? Number(openingBankUpi) : null,
      timezone: req.business.timezone || 'Asia/Kolkata',
    });
    res.json({ status: 'success', data: report });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/receivables
router.get('/receivables', requireModule('customers'), requirePermission('VIEW_REPORTS'), async (req, res, next) => {
  try {
    const report = await reportService.generateReceivablesReport(req.business._id);
    res.json({ status: 'success', data: report });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/payables
router.get('/payables', requireModule('purchases'), requirePermission('VIEW_REPORTS'), async (req, res, next) => {
  try {
    const report = await reportService.generatePayablesReport(req.business._id);
    res.json({ status: 'success', data: report });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/inventory
router.get('/inventory', requireModule('inventory'), requirePermission('VIEW_INVENTORY'), requirePlanFeature('advancedReports'), async (req, res, next) => {
  try {
    const { startDate, endDate, category } = req.query;
    const report = await reportService.generateInventoryReport(req.business._id, {
      startDate,
      endDate,
      category,
    });
    res.json({ status: 'success', data: report });
  } catch (err) {
    next(err);
  }
});

export default router;
