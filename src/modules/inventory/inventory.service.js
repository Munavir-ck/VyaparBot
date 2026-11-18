import { Product } from './product.model.js';
import { StockMovement } from './stock-movement.model.js';
import { Transaction } from '../transactions/transaction.model.js';
import { runInTransaction, sessionOpts } from '../../utils/db-transaction.js';
import { logger } from '../../config/logger.js';

const INBOUND_TYPES = new Set(['STOCK_IN', 'PURCHASE', 'RETURN']);
const OUTBOUND_TYPES = new Set(['STOCK_OUT', 'SALE_DEDUCTION', 'WASTAGE', 'DAMAGED']);

class InventoryService {
  /**
   * Create or update a product. If initialStock > 0 on creation, records a STOCK_IN movement
   * so the stock movement ledger remains the single source of truth.
   */
  async createOrUpdateProduct({
    businessId,
    name,
    sku = null,
    category = 'OTHER',
    unit = 'pcs',
    minStockLevel = 0,
    costPrice = 0,
    sellingPrice = 0,
    initialStock = 0,
    trackInventory = true,
    createdBy = null,
  }) {
    if (!businessId) throw new Error('businessId is required');
    if (!name) throw new Error('Product name is required');

    const cleanName = name.trim();
    const normalizedName = cleanName.toLowerCase();

    return runInTransaction(async (session) => {
      let product = await Product.findOne({ businessId, normalizedName }, null, sessionOpts(session));

      if (!product) {
        const [created] = await Product.create(
          [
            {
              businessId,
              name: cleanName,
              normalizedName,
              sku,
              category: String(category || 'OTHER').toUpperCase(),
              unit: String(unit || 'pcs').toLowerCase(),
              currentStock: 0,
              minStockLevel: Number(minStockLevel || 0),
              costPrice: Number(costPrice || 0),
              sellingPrice: Number(sellingPrice || 0),
              trackInventory,
              status: 'ACTIVE',
            },
          ],
          sessionOpts(session),
        );
        product = created;

        const initQty = Number(initialStock || 0);
        if (initQty > 0) {
          const movementRes = await this._applyMovementInSession({
            businessId,
            product,
            type: 'STOCK_IN',
            quantityDelta: initQty,
            unitCost: Number(costPrice || 0),
            idempotencyKey: `init_${product._id}`,
            reason: 'Initial opening stock',
            allowNegativeStock: false,
            createdBy,
            session,
          });
          product = movementRes.product;
        }
      } else {
        if (category) product.category = String(category).toUpperCase();
        if (unit) product.unit = String(unit).toLowerCase();
        if (minStockLevel !== undefined) product.minStockLevel = Number(minStockLevel);
        if (costPrice !== undefined && Number(costPrice) > 0) product.costPrice = Number(costPrice);
        if (sellingPrice !== undefined && Number(sellingPrice) > 0) product.sellingPrice = Number(sellingPrice);
        if (sku) product.sku = sku;
        await product.save(sessionOpts(session));
      }

      return product;
    });
  }

  /**
   * Internal atomic stock update + ledger append within an active session
   */
  async _applyMovementInSession({
    businessId,
    product,
    type,
    quantityDelta,
    unitCost = 0,
    relatedTransactionId = null,
    idempotencyKey = null,
    reason = '',
    allowNegativeStock = false,
    createdBy = null,
    session = null,
  }) {
    // 1. Idempotency check
    if (idempotencyKey) {
      const existing = await StockMovement.findOne(
        { businessId, idempotencyKey },
        null,
        sessionOpts(session),
      );
      if (existing) {
        logger.info({ businessId, idempotencyKey }, 'Duplicate stock movement prevented by idempotencyKey');
        return { duplicate: true, movement: existing, product };
      }
    }

    // 2. Atomic conditional balance update on Product
    const filter = { _id: product._id, businessId };
    if (!allowNegativeStock && quantityDelta < 0) {
      filter.currentStock = { $gte: Math.abs(quantityDelta) };
    }

    const updatedProduct = await Product.findOneAndUpdate(
      filter,
      {
        $inc: { currentStock: quantityDelta },
        ...(unitCost > 0 && INBOUND_TYPES.has(type) ? { $set: { costPrice: unitCost } } : {}),
      },
      { new: true, ...sessionOpts(session) },
    );

    if (!updatedProduct) {
      throw new Error(`INSUFFICIENT_STOCK_OR_NOT_FOUND:${product.name}`);
    }

    const newStock = updatedProduct.currentStock;
    const previousStock = newStock - quantityDelta;
    const absQty = Math.abs(quantityDelta);
    const effectiveCost = unitCost > 0 ? unitCost : updatedProduct.costPrice || 0;

    // 3. Append immutable ledger entry
    const [movement] = await StockMovement.create(
      [
        {
          businessId,
          productId: product._id,
          type,
          quantity: absQty,
          quantityChange: quantityDelta,
          previousStock,
          newStock,
          unitCost: effectiveCost,
          totalValue: absQty * effectiveCost,
          relatedTransactionId,
          idempotencyKey,
          reason,
          createdBy,
        },
      ],
      sessionOpts(session),
    );

    return { duplicate: false, movement, product: updatedProduct };
  }

  /**
   * Record a stock movement (STOCK_IN, STOCK_OUT, PURCHASE, SALE_DEDUCTION, WASTAGE, DAMAGED, ADJUSTMENT)
   */
  async recordStockMovement({
    businessId,
    productId = null,
    productName = null,
    type,
    quantity,
    unit = 'pcs',
    unitCost = 0,
    relatedTransactionId = null,
    idempotencyKey = null,
    reason = '',
    allowNegativeStock = false,
    createdBy = null,
  }) {
    if (!businessId) throw new Error('businessId is required');
    if (!type) throw new Error('Movement type is required');

    const numericQty = Number(quantity);
    if (Number.isNaN(numericQty) || (type !== 'ADJUSTMENT' && numericQty <= 0)) {
      throw new Error('Quantity must be a positive number');
    }

    let quantityDelta = numericQty;
    if (INBOUND_TYPES.has(type)) {
      quantityDelta = Math.abs(numericQty);
    } else if (OUTBOUND_TYPES.has(type)) {
      quantityDelta = -Math.abs(numericQty);
    }

    return runInTransaction(async (session) => {
      let product = null;
      if (productId) {
        product = await Product.findOne({ _id: productId, businessId }, null, sessionOpts(session));
      } else if (productName) {
        const normalizedName = productName.trim().toLowerCase();
        product = await Product.findOne({ businessId, normalizedName }, null, sessionOpts(session));
        if (!product && INBOUND_TYPES.has(type)) {
          const [created] = await Product.create(
            [
              {
                businessId,
                name: productName.trim(),
                normalizedName,
                unit: String(unit || 'pcs').toLowerCase(),
                costPrice: Number(unitCost || 0),
                currentStock: 0,
                status: 'ACTIVE',
              },
            ],
            sessionOpts(session),
          );
          product = created;
        }
      }

      if (!product) {
        throw new Error(`PRODUCT_NOT_FOUND:${productName || productId}`);
      }

      return this._applyMovementInSession({
        businessId,
        product,
        type,
        quantityDelta,
        unitCost,
        relatedTransactionId,
        idempotencyKey,
        reason,
        allowNegativeStock,
        createdBy,
        session,
      });
    });
  }

  /**
   * Record Wastage or Damaged stock with mandatory audit reason
   */
  async recordWastageOrDamage({
    businessId,
    productId = null,
    productName = null,
    quantity,
    type = 'WASTAGE',
    reason = 'Damaged / Spoiled',
    idempotencyKey = null,
    createdBy = null,
  }) {
    const validType = type === 'DAMAGED' ? 'DAMAGED' : 'WASTAGE';
    return this.recordStockMovement({
      businessId,
      productId,
      productName,
      type: validType,
      quantity,
      idempotencyKey,
      reason,
      createdBy,
    });
  }

  /**
   * Adjust stock to an exact physical count or by a delta, maintaining an audit trail
   */
  async adjustStock({
    businessId,
    productId = null,
    productName = null,
    newStockCount = null,
    quantityDelta = null,
    reason,
    idempotencyKey = null,
    createdBy = null,
  }) {
    if (!businessId) throw new Error('businessId is required');
    if (!reason || !String(reason).trim()) {
      throw new Error('Adjustment reason is required for audit trail');
    }

    return runInTransaction(async (session) => {
      const query = productId
        ? { _id: productId, businessId }
        : { businessId, normalizedName: String(productName || '').trim().toLowerCase() };

      const product = await Product.findOne(query, null, sessionOpts(session));
      if (!product) throw new Error('PRODUCT_NOT_FOUND');

      let delta = Number(quantityDelta);
      if (newStockCount !== null && newStockCount !== undefined) {
        delta = Number(newStockCount) - product.currentStock;
      }

      if (Number.isNaN(delta) || delta === 0) {
        return { duplicate: false, noChange: true, product };
      }

      return this._applyMovementInSession({
        businessId,
        product,
        type: 'ADJUSTMENT',
        quantityDelta: delta,
        idempotencyKey,
        reason: reason.trim(),
        allowNegativeStock: false,
        createdBy,
        session,
      });
    });
  }

  /**
   * Increase inventory for itemized purchase transactions (idempotent per transaction + product)
   */
  async processPurchaseStockIn({ businessId, transaction, items = [], createdBy = null }) {
    if (!businessId || !transaction || !Array.isArray(items) || items.length === 0) {
      return { processed: 0, movements: [] };
    }

    const movements = [];
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (!item.quantity || item.quantity <= 0) continue;

      const idempotencyKey = `purchase_${transaction._id}_${item.productId || item.productName}_${idx}`;
      const res = await this.recordStockMovement({
        businessId,
        productId: item.productId || null,
        productName: item.productName,
        type: 'PURCHASE',
        quantity: item.quantity,
        unit: item.unit || 'pcs',
        unitCost: item.unitPrice || 0,
        relatedTransactionId: transaction._id,
        idempotencyKey,
        reason: `Purchase #${transaction._id}`,
        createdBy,
      });
      movements.push(res.movement);
    }

    await Transaction.updateOne(
      { _id: transaction._id, businessId },
      { $set: { stockSynced: true } },
    );

    return { processed: movements.length, movements };
  }

  /**
   * Deduct inventory for itemized sales ONLY (never auto-deducts lump-sum daily sales
   * unless explicitly configured). Strictly idempotent so stock cannot be deducted twice.
   */
  async processSaleStockOut({
    businessId,
    transaction,
    items = [],
    businessSettings = {},
    createdBy = null,
  }) {
    if (!businessId || !transaction) {
      return { skipped: true, reason: 'MISSING_CONTEXT' };
    }

    // Rule 5: Lump-sum sales must not automatically deduct inventory
    if (transaction.isLumpSum || !Array.isArray(items) || items.length === 0) {
      const allowLumpSum = Boolean(businessSettings?.inventory?.autoDeductOnLumpSumSale);
      if (!allowLumpSum) {
        return { skipped: true, reason: 'LUMP_SUM_SALE_NO_AUTO_DEDUCT' };
      }
    }

    // Prevent duplicate sale deduction at transaction level
    if (transaction.stockSynced) {
      return { skipped: true, reason: 'ALREADY_DEDUCTED' };
    }

    const allowNegative = Boolean(businessSettings?.inventory?.allowNegativeStock);
    const movements = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (!item.quantity || item.quantity <= 0) continue;

      const idempotencyKey = `sale_${transaction._id}_${item.productId || item.productName}_${idx}`;
      const res = await this.recordStockMovement({
        businessId,
        productId: item.productId || null,
        productName: item.productName,
        type: 'SALE_DEDUCTION',
        quantity: item.quantity,
        relatedTransactionId: transaction._id,
        idempotencyKey,
        reason: `Sale #${transaction._id}`,
        allowNegativeStock: allowNegative,
        createdBy,
      });
      movements.push(res.movement);
    }

    await Transaction.updateOne(
      { _id: transaction._id, businessId },
      { $set: { stockSynced: true } },
    );

    return { skipped: false, processed: movements.length, movements };
  }

  /**
   * Get products at or below minimum stock level
   */
  async getLowStockAlerts(businessId) {
    if (!businessId) throw new Error('businessId is required');
    return Product.find({
      businessId,
      status: 'ACTIVE',
      trackInventory: true,
      $expr: { $lte: ['$currentStock', '$minStockLevel'] },
    }).sort({ currentStock: 1 });
  }

  /**
   * Compute deterministic inventory valuation
   */
  async getInventoryValuation(businessId) {
    if (!businessId) throw new Error('businessId is required');
    const products = await Product.find({
      businessId,
      status: 'ACTIVE',
      trackInventory: true,
    });

    let totalValue = 0;
    let totalUnits = 0;
    let outOfStockCount = 0;
    const byCategory = {};

    for (const p of products) {
      if (p.currentStock <= 0) outOfStockCount += 1;
      const value = Math.max(0, p.currentStock) * (p.costPrice || 0);
      totalValue += value;
      totalUnits += Math.max(0, p.currentStock);
      const cat = p.category || 'OTHER';
      if (!byCategory[cat]) {
        byCategory[cat] = { productCount: 0, totalValue: 0 };
      }
      byCategory[cat].productCount += 1;
      byCategory[cat].totalValue += value;
    }

    return {
      productCount: products.length,
      totalUnits,
      totalValue,
      outOfStockCount,
      byCategory,
    };
  }

  /**
   * Get stock movement history for a business or specific product
   */
  async getStockMovementHistory(businessId, { productId = null, type = null, limit = 50 } = {}) {
    if (!businessId) throw new Error('businessId is required');
    const filter = { businessId };
    if (productId) filter.productId = productId;
    if (type) filter.type = type;

    return StockMovement.find(filter)
      .populate('productId', 'name unit category')
      .sort({ createdAt: -1 })
      .limit(Number(limit));
  }
}

export const inventoryService = new InventoryService();

