import express from 'express';
import { inventoryService } from './inventory.service.js';
import { Product } from './product.model.js';
import { StockMovement } from './stock-movement.model.js';
import {
  resolveBusinessContext,
  requirePermission,
  requireWriteSubscription,
} from '../../middleware/auth.middleware.js';
import { subscriptionService } from '../subscriptions/subscription.service.js';
import { mutationLimiter } from '../../middleware/rate-limiter.js';

const router = express.Router();

router.use(resolveBusinessContext, requireWriteSubscription);

// GET /api/inventory/products
router.get('/products', requirePermission('VIEW_INVENTORY'), async (req, res, next) => {
  try {
    const { search, category, page = 1, limit = 100 } = req.query;
    const filter = { businessId: req.business._id, status: 'ACTIVE' };

    if (category) filter.category = String(category).toUpperCase();
    if (search && String(search).trim()) {
      const regex = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { sku: regex }, { category: regex }];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(filter).sort({ name: 1 }).skip(skip).limit(limitNum),
      Product.countDocuments(filter),
    ]);

    res.json({
      status: 'success',
      count: products.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      data: products,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/products
router.post('/products', requirePermission('MANAGE_INVENTORY'), async (req, res, next) => {
  try {
    const product = await subscriptionService.withBusinessLimitLock(
      `prod:${req.business._id}`,
      async () => {
        await subscriptionService.checkProductLimit(req.business._id);
        return inventoryService.createOrUpdateProduct({
          businessId: req.business._id,
          createdBy: req.user._id,
          ...req.body,
        });
      },
    );
    res.status(201).json({ status: 'success', data: product });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ status: 'fail', code: err.code, message: err.message });
    }
    next(err);
  }
});

// PATCH /api/inventory/products/:id
router.patch('/products/:id', requirePermission('MANAGE_INVENTORY'), async (req, res, next) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, businessId: req.business._id });
    if (!product) {
      return res.status(404).json({ status: 'fail', message: 'Product not found' });
    }

    const { name, sku, category, unit, minStockLevel, costPrice, sellingPrice, trackInventory } = req.body;
    if (name && String(name).trim()) {
      product.name = String(name).trim();
      product.normalizedName = product.name.toLowerCase();
    }
    if (sku !== undefined) product.sku = sku;
    if (category) product.category = String(category).toUpperCase();
    if (unit) product.unit = String(unit).toLowerCase();
    if (minStockLevel !== undefined) product.minStockLevel = Number(minStockLevel);
    if (costPrice !== undefined) product.costPrice = Number(costPrice);
    if (sellingPrice !== undefined) product.sellingPrice = Number(sellingPrice);
    if (trackInventory !== undefined) product.trackInventory = Boolean(trackInventory);

    await product.save();
    res.json({ status: 'success', data: product });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/inventory/products/:id (Archive)
router.delete('/products/:id', requirePermission('MANAGE_INVENTORY'), async (req, res, next) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, businessId: req.business._id },
      { $set: { status: 'ARCHIVED' } },
      { new: true },
    );
    if (!product) {
      return res.status(404).json({ status: 'fail', message: 'Product not found' });
    }
    res.json({ status: 'success', message: 'Product archived', data: product });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/stock-in
router.post('/stock-in', mutationLimiter, requirePermission('MANAGE_INVENTORY'), async (req, res, next) => {
  try {
    const result = await inventoryService.recordStockMovement({
      businessId: req.business._id,
      createdBy: req.user._id,
      type: 'STOCK_IN',
      ...req.body,
    });
    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/stock-out
router.post('/stock-out', mutationLimiter, requirePermission('MANAGE_INVENTORY'), async (req, res, next) => {
  try {
    const result = await inventoryService.recordStockMovement({
      businessId: req.business._id,
      createdBy: req.user._id,
      type: 'STOCK_OUT',
      ...req.body,
    });
    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/wastage
router.post('/wastage', mutationLimiter, requirePermission('MANAGE_INVENTORY'), async (req, res, next) => {
  try {
    const result = await inventoryService.recordWastageOrDamage({
      businessId: req.business._id,
      createdBy: req.user._id,
      ...req.body,
    });
    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/adjust
router.post('/adjust', mutationLimiter, requirePermission('ADJUST_STOCK'), async (req, res, next) => {
  try {
    const result = await inventoryService.adjustStock({
      businessId: req.business._id,
      createdBy: req.user._id,
      ...req.body,
    });
    res.json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/inventory/alerts/low-stock
router.get('/alerts/low-stock', requirePermission('VIEW_INVENTORY'), async (req, res, next) => {
  try {
    const alerts = await inventoryService.getLowStockAlerts(req.business._id);
    res.json({ status: 'success', count: alerts.length, data: alerts });
  } catch (err) {
    next(err);
  }
});

// GET /api/inventory/valuation
router.get('/valuation', requirePermission('VIEW_INVENTORY'), async (req, res, next) => {
  try {
    const valuation = await inventoryService.getInventoryValuation(req.business._id);
    res.json({ status: 'success', data: valuation });
  } catch (err) {
    next(err);
  }
});

// GET /api/inventory/movements
router.get('/movements', requirePermission('VIEW_INVENTORY'), async (req, res, next) => {
  try {
    const { productId, type, startDate, endDate, page = 1, limit = 50 } = req.query;
    const filter = { businessId: req.business._id };
    if (productId) filter.productId = productId;
    if (type) filter.type = type;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [movements, total] = await Promise.all([
      StockMovement.find(filter)
        .populate('productId', 'name unit category')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      StockMovement.countDocuments(filter),
    ]);

    res.json({
      status: 'success',
      count: movements.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      data: movements,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
