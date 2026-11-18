import { Transaction } from '../transactions/transaction.model.js';
import { Supplier } from '../suppliers/supplier.model.js';
import { Customer } from '../customers/customer.model.js';
import { PaymentRecord } from '../payments/payment-record.model.js';
import { Product } from '../inventory/product.model.js';
import { StockMovement } from '../inventory/stock-movement.model.js';
import { inventoryService } from '../inventory/inventory.service.js';

class ReportService {
  /**
   * Helper to format currency values as ₹X,XXX
   */
  formatCurrency(amount = 0) {
    return `₹${Math.round(amount).toLocaleString('en-IN')}`;
  }

  /**
   * Get start and end Date bounds for a given date in a specific timezone
   */
  getDateBounds(date = new Date(), timezone = 'Asia/Kolkata') {
    const d = new Date(date);
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);

    const end = new Date(d);
    end.setHours(23, 59, 59, 999);

    return { start, end, timezone };
  }

  /**
   * Get start and end Date bounds for a 7-day week (Monday..Sunday containing referenceDate)
   */
  getWeekBounds(referenceDate = new Date(), timezone = 'Asia/Kolkata') {
    const d = new Date(referenceDate);
    const day = d.getDay(); // 0=Sun, 1=Mon..6=Sat
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const start = new Date(d);
    start.setDate(d.getDate() + diffToMonday);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end, timezone };
  }

  /**
   * Get start and end Date bounds for a specific month
   */
  getMonthBounds(year, month, timezone = 'Asia/Kolkata') {
    const now = new Date();
    const targetYear = year || now.getFullYear();
    const targetMonth = month !== undefined && month !== null ? month - 1 : now.getMonth();

    const start = new Date(targetYear, targetMonth, 1, 0, 0, 0, 0);
    const end = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);

    return { start, end, year: targetYear, month: targetMonth + 1, timezone };
  }

  /**
   * Extract cash vs bank/UPI inflow/outflow amounts from a transaction
   * Credit sales & credit purchases do NOT move cash/bank until settled via PaymentRecord/Payment.
   */
  _classifyPaymentChannels(tx) {
    const b = tx.paymentBreakdown || {};
    const hasBreakdown =
      (b.cash || 0) > 0 || (b.upi || 0) > 0 || (b.card || 0) > 0 || (b.bankTransfer || 0) > 0;

    if (hasBreakdown) {
      return {
        cash: b.cash || 0,
        upi: b.upi || 0,
        bankOrCard: (b.card || 0) + (b.bankTransfer || 0),
        credit: b.credit || 0,
      };
    }

    if (tx.paymentMethod === 'CASH') return { cash: tx.amount, upi: 0, bankOrCard: 0, credit: 0 };
    if (tx.paymentMethod === 'UPI') return { cash: 0, upi: tx.amount, bankOrCard: 0, credit: 0 };
    if (tx.paymentMethod === 'CARD' || tx.paymentMethod === 'BANK_TRANSFER') {
      return { cash: 0, upi: 0, bankOrCard: tx.amount, credit: 0 };
    }
    if (tx.paymentMethod === 'CREDIT') return { cash: 0, upi: 0, bankOrCard: 0, credit: tx.amount };

    return { cash: 0, upi: 0, bankOrCard: 0, credit: 0 };
  }

  /**
   * Generate Deterministic Daily Financial Report
   * All calculations done in code, NEVER by LLM.
   */
  async generateDailyReport(businessId, targetDate = new Date(), timezone = 'Asia/Kolkata') {
    const { start, end } = this.getDateBounds(targetDate, timezone);

    const transactions = await Transaction.find({
      businessId,
      transactionDate: { $gte: start, $lte: end },
      status: 'COMPLETED',
    });

    let totalRecordedSales = 0;
    let cashCollections = 0;
    let upiCollections = 0;
    let cardCollections = 0;
    let otherSalesCollections = 0;
    let unreconciledAmount = 0;

    let totalExpenses = 0;
    const categoryExpenses = {};

    let totalSupplierPayments = 0;
    let totalCreditPurchases = 0;
    let totalCustomerPaymentsReceived = 0;

    for (const tx of transactions) {
      if (tx.type === 'SALE') {
        totalRecordedSales += tx.amount;
        const b = tx.paymentBreakdown || {};

        if (b.cash || b.upi || b.card) {
          cashCollections += b.cash || 0;
          upiCollections += b.upi || 0;
          cardCollections += b.card || 0;
          unreconciledAmount += b.unreconciled || 0;
        } else if (tx.paymentMethod === 'CASH') {
          cashCollections += tx.amount;
        } else if (tx.paymentMethod === 'UPI') {
          upiCollections += tx.amount;
        } else if (tx.paymentMethod === 'CARD') {
          cardCollections += tx.amount;
        } else {
          otherSalesCollections += tx.amount;
        }
      } else if (tx.type === 'EXPENSE') {
        totalExpenses += tx.amount;
        const cat = tx.category || 'OTHER_EXPENSE';
        categoryExpenses[cat] = (categoryExpenses[cat] || 0) + tx.amount;
      } else if (tx.type === 'SUPPLIER_PAYMENT') {
        totalSupplierPayments += tx.amount;
      } else if (tx.type === 'PURCHASE') {
        totalCreditPurchases += tx.amount;
      } else if (tx.type === 'CUSTOMER_PAYMENT') {
        totalCustomerPaymentsReceived += tx.amount;
      }
    }

    // Recorded Operating Surplus (Carefully documented: Not final accounting net profit!)
    const recordedOperatingSurplus = totalRecordedSales - totalExpenses;

    const dateStr = start.toISOString().split('T')[0];

    return {
      date: dateStr,
      timezone,
      totalRecordedSales,
      cashCollections,
      upiCollections,
      cardCollections,
      otherSalesCollections,
      unreconciledAmount,
      totalExpenses,
      categoryExpenses,
      totalSupplierPayments,
      totalCreditPurchases,
      totalCustomerPaymentsReceived,
      recordedOperatingSurplus,
      transactionCount: transactions.length,
    };
  }

  /**
   * Generate Deterministic Weekly Financial Report
   */
  async generateWeeklyReport(businessId, referenceDate = new Date(), timezone = 'Asia/Kolkata') {
    const { start, end } = this.getWeekBounds(referenceDate, timezone);

    const transactions = await Transaction.find({
      businessId,
      transactionDate: { $gte: start, $lte: end },
      status: 'COMPLETED',
    });

    let totalSales = 0;
    let cashSales = 0;
    let upiSales = 0;
    let creditSales = 0;
    let totalExpenses = 0;
    const categoryExpenses = {};
    let supplierPurchases = 0;
    let paymentsReceived = 0;
    let paymentsMade = 0;

    for (const tx of transactions) {
      if (tx.type === 'SALE') {
        totalSales += tx.amount;
        const ch = this._classifyPaymentChannels(tx);
        cashSales += ch.cash;
        upiSales += ch.upi;
        creditSales += ch.credit;
      } else if (tx.type === 'EXPENSE') {
        // Supplier payments are NEVER counted as expenses here
        totalExpenses += tx.amount;
        const cat = tx.category || 'OTHER_EXPENSE';
        categoryExpenses[cat] = (categoryExpenses[cat] || 0) + tx.amount;
      } else if (tx.type === 'PURCHASE') {
        supplierPurchases += tx.amount;
      } else if (tx.type === 'CUSTOMER_PAYMENT') {
        paymentsReceived += tx.amount;
      } else if (tx.type === 'SUPPLIER_PAYMENT') {
        paymentsMade += tx.amount;
      }
    }

    return {
      period: 'WEEKLY',
      timezone,
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      totalSales,
      cashSales,
      upiSales,
      creditSales,
      totalExpenses,
      categoryExpenses,
      supplierPurchases,
      paymentsReceived,
      paymentsMade,
      recordedOperatingSurplus: totalSales - totalExpenses,
      transactionCount: transactions.length,
    };
  }

  /**
   * Generate Deterministic Financial Summary for a Custom Date Range
   */
  async generateRangeFinancialReport(
    businessId,
    { startDate = null, endDate = null, timezone = 'Asia/Kolkata' } = {},
  ) {
    const start = startDate
      ? this.getDateBounds(startDate, timezone).start
      : this.getDateBounds(new Date(), timezone).start;
    const end = endDate
      ? this.getDateBounds(endDate, timezone).end
      : this.getDateBounds(new Date(), timezone).end;

    const transactions = await Transaction.find({
      businessId,
      transactionDate: { $gte: start, $lte: end },
      status: 'COMPLETED',
    });

    let totalSales = 0;
    let cashSales = 0;
    let upiSales = 0;
    let creditSales = 0;
    let totalExpenses = 0;
    const categoryExpenses = {};
    let supplierPurchases = 0;
    let paymentsReceived = 0;
    let paymentsMade = 0;
    const byType = {};

    for (const tx of transactions) {
      if (!byType[tx.type]) {
        byType[tx.type] = { count: 0, amount: 0 };
      }
      byType[tx.type].count += 1;
      byType[tx.type].amount += tx.amount;

      if (tx.type === 'SALE') {
        totalSales += tx.amount;
        const ch = this._classifyPaymentChannels(tx);
        cashSales += ch.cash;
        upiSales += ch.upi;
        creditSales += ch.credit;
      } else if (tx.type === 'EXPENSE') {
        totalExpenses += tx.amount;
        const cat = tx.category || 'OTHER_EXPENSE';
        categoryExpenses[cat] = (categoryExpenses[cat] || 0) + tx.amount;
      } else if (tx.type === 'PURCHASE') {
        supplierPurchases += tx.amount;
      } else if (tx.type === 'CUSTOMER_PAYMENT') {
        paymentsReceived += tx.amount;
      } else if (tx.type === 'SUPPLIER_PAYMENT') {
        paymentsMade += tx.amount;
      }
    }

    return {
      period: 'CUSTOM',
      timezone,
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      totalSales,
      cashSales,
      upiSales,
      creditSales,
      totalExpenses,
      categoryExpenses,
      supplierPurchases,
      paymentsReceived,
      paymentsMade,
      recordedOperatingSurplus: totalSales - totalExpenses,
      byType,
      transactionCount: transactions.length,
    };
  }

  /**
   * Generate Deterministic Monthly Financial Report
   */
  async generateMonthlyReport(businessId, year = null, month = null, timezone = 'Asia/Kolkata') {
    const { start, end, year: targetYear, month: targetMonth } = this.getMonthBounds(year, month, timezone);

    const transactions = await Transaction.find({
      businessId,
      transactionDate: { $gte: start, $lte: end },
      status: 'COMPLETED',
    });

    let monthlySales = 0;
    let cashSales = 0;
    let upiSales = 0;
    let monthlyExpenses = 0;
    const categoryExpenses = {};
    let supplierPurchases = 0;
    let supplierPayments = 0;
    let customerPaymentsReceived = 0;

    for (const tx of transactions) {
      if (tx.type === 'SALE') {
        monthlySales += tx.amount;
        const ch = this._classifyPaymentChannels(tx);
        cashSales += ch.cash;
        upiSales += ch.upi;
      } else if (tx.type === 'EXPENSE') {
        monthlyExpenses += tx.amount;
        const cat = tx.category || 'OTHER_EXPENSE';
        categoryExpenses[cat] = (categoryExpenses[cat] || 0) + tx.amount;
      } else if (tx.type === 'PURCHASE') {
        supplierPurchases += tx.amount;
      } else if (tx.type === 'SUPPLIER_PAYMENT') {
        supplierPayments += tx.amount;
      } else if (tx.type === 'CUSTOMER_PAYMENT') {
        customerPaymentsReceived += tx.amount;
      }
    }

    // Previous month comparison
    const prevMonthBounds = this.getMonthBounds(
      targetMonth === 1 ? targetYear - 1 : targetYear,
      targetMonth === 1 ? 12 : targetMonth - 1,
      timezone,
    );

    const prevTxs = await Transaction.find({
      businessId,
      transactionDate: { $gte: prevMonthBounds.start, $lte: prevMonthBounds.end },
      status: 'COMPLETED',
    });

    let prevSales = 0;
    let prevExpenses = 0;
    for (const tx of prevTxs) {
      if (tx.type === 'SALE') prevSales += tx.amount;
      if (tx.type === 'EXPENSE') prevExpenses += tx.amount;
    }

    const salesGrowthPct = prevSales > 0 ? ((monthlySales - prevSales) / prevSales) * 100 : null;

    return {
      year: targetYear,
      month: targetMonth,
      timezone,
      monthlySales,
      cashSales,
      upiSales,
      monthlyExpenses,
      categoryExpenses,
      supplierPurchases,
      supplierPayments,
      customerPaymentsReceived,
      recordedOperatingSurplus: monthlySales - monthlyExpenses,
      previousMonth: {
        sales: prevSales,
        expenses: prevExpenses,
        salesGrowthPct: salesGrowthPct !== null ? Math.round(salesGrowthPct * 10) / 10 : null,
      },
      transactionCount: transactions.length,
    };
  }

  /**
   * Generate Deterministic Cash Flow Report (Cash & Bank/UPI Inflows/Outflows + Opening/Closing)
   */
  async generateCashFlowReport(
    businessId,
    { startDate = null, endDate = null, openingCash = null, openingBankUpi = null, timezone = 'Asia/Kolkata' } = {},
  ) {
    const start = startDate ? this.getDateBounds(startDate, timezone).start : this.getDateBounds(new Date(), timezone).start;
    const end = endDate ? this.getDateBounds(endDate, timezone).end : this.getDateBounds(new Date(), timezone).end;

    // Compute historical opening balance from prior transactions if not explicitly supplied
    let computedOpeningCash = 0;
    let computedOpeningBankUpi = 0;

    if (openingCash === null || openingBankUpi === null) {
      const priorTxs = await Transaction.find({
        businessId,
        transactionDate: { $lt: start },
        status: 'COMPLETED',
      });

      for (const tx of priorTxs) {
        const ch = this._classifyPaymentChannels(tx);
        const bankUpi = ch.upi + ch.bankOrCard;
        if (tx.type === 'SALE' || tx.type === 'CUSTOMER_PAYMENT') {
          computedOpeningCash += ch.cash;
          computedOpeningBankUpi += bankUpi;
        } else if (
          tx.type === 'EXPENSE' ||
          tx.type === 'SUPPLIER_PAYMENT' ||
          (tx.type === 'PURCHASE' && tx.paymentMethod !== 'CREDIT') ||
          tx.type === 'OWNER_WITHDRAWAL' ||
          tx.type === 'CUSTOMER_REFUND'
        ) {
          computedOpeningCash -= ch.cash;
          computedOpeningBankUpi -= bankUpi;
        }
      }
    }

    const startCash = openingCash !== null && openingCash !== undefined ? Number(openingCash) : computedOpeningCash;
    const startBankUpi =
      openingBankUpi !== null && openingBankUpi !== undefined ? Number(openingBankUpi) : computedOpeningBankUpi;

    const periodTxs = await Transaction.find({
      businessId,
      transactionDate: { $gte: start, $lte: end },
      status: 'COMPLETED',
    });

    let cashInflows = 0;
    let cashOutflows = 0;
    let bankUpiInflows = 0;
    let bankUpiOutflows = 0;

    for (const tx of periodTxs) {
      const ch = this._classifyPaymentChannels(tx);
      const bankUpi = ch.upi + ch.bankOrCard;

      if (tx.type === 'SALE' || tx.type === 'CUSTOMER_PAYMENT') {
        cashInflows += ch.cash;
        bankUpiInflows += bankUpi;
      } else if (
        tx.type === 'EXPENSE' ||
        tx.type === 'SUPPLIER_PAYMENT' ||
        (tx.type === 'PURCHASE' && tx.paymentMethod !== 'CREDIT') ||
        tx.type === 'OWNER_WITHDRAWAL' ||
        tx.type === 'CUSTOMER_REFUND'
      ) {
        cashOutflows += ch.cash;
        bankUpiOutflows += bankUpi;
      }
    }

    const closingCash = startCash + cashInflows - cashOutflows;
    const closingBankUpi = startBankUpi + bankUpiInflows - bankUpiOutflows;

    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      timezone,
      cash: {
        openingBalance: startCash,
        inflows: cashInflows,
        outflows: cashOutflows,
        netFlow: cashInflows - cashOutflows,
        closingBalance: closingCash,
      },
      bankAndUpi: {
        openingBalance: startBankUpi,
        inflows: bankUpiInflows,
        outflows: bankUpiOutflows,
        netFlow: bankUpiInflows - bankUpiOutflows,
        closingBalance: closingBankUpi,
      },
      totalOpeningBalance: startCash + startBankUpi,
      totalInflows: cashInflows + bankUpiInflows,
      totalOutflows: cashOutflows + bankUpiOutflows,
      totalClosingBalance: closingCash + closingBankUpi,
    };
  }

  /**
   * Generate Accounts Receivable Report (Customer-wise balances + payment history)
   */
  async generateReceivablesReport(businessId) {
    const customers = await Customer.find({ businessId, status: 'ACTIVE' }).sort({ outstandingBalance: -1 });
    const totalReceivables = customers.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0);

    const paymentHistory = await PaymentRecord.find({
      businessId,
      direction: 'INCOMING',
      status: 'COMPLETED',
    })
      .populate('customerId', 'name phone')
      .sort({ paymentDate: -1 })
      .limit(50);

    return {
      totalReceivables,
      customerCount: customers.length,
      customers: customers.map((c) => ({
        customerId: c._id,
        name: c.name,
        phone: c.phone,
        totalCreditSales: c.totalCreditSales,
        totalPaymentsReceived: c.totalPaymentsReceived,
        outstandingBalance: c.outstandingBalance,
      })),
      paymentHistory,
    };
  }

  /**
   * Generate Accounts Payable Report (Supplier-wise balances + payment history)
   */
  async generatePayablesReport(businessId) {
    const suppliers = await Supplier.find({ businessId, status: 'ACTIVE' }).sort({ outstandingBalance: -1 });
    const totalPayables = suppliers.reduce((sum, s) => sum + Math.max(0, s.outstandingBalance), 0);

    const paymentHistory = await PaymentRecord.find({
      businessId,
      direction: { $in: ['OUTGOING', null] },
      status: 'COMPLETED',
    })
      .populate('supplierId', 'name phone')
      .sort({ paymentDate: -1 })
      .limit(50);

    return {
      totalPayables,
      supplierCount: suppliers.length,
      suppliers: suppliers.map((s) => ({
        supplierId: s._id,
        name: s.name,
        phone: s.phone,
        totalPurchases: s.totalPurchases,
        totalPayments: s.totalPayments,
        outstandingBalance: s.outstandingBalance,
      })),
      paymentHistory,
    };
  }

  /**
   * Generate Comprehensive Inventory Report (Current Stock, Low-Stock, Valuation, Movement Summary)
   */
  async generateInventoryReport(businessId, { startDate = null, endDate = null, category = null } = {}) {
    const productFilter = { businessId, status: 'ACTIVE' };
    if (category && String(category).trim() && String(category).trim() !== 'ALL') {
      productFilter.category = String(category).trim();
    }
    const products = await Product.find(productFilter).sort({ name: 1 });
    const productIds = products.map((p) => p._id);
    const lowStockAll = await inventoryService.getLowStockAlerts(businessId);
    const lowStockProducts =
      category && String(category).trim() && String(category).trim() !== 'ALL'
        ? lowStockAll.filter((p) => p.category === String(category).trim())
        : lowStockAll;
    const valuation = await inventoryService.getInventoryValuation(businessId);

    const movementFilter = { businessId };
    if (category && String(category).trim() && String(category).trim() !== 'ALL') {
      movementFilter.productId = { $in: productIds };
    }
    if (startDate || endDate) {
      movementFilter.createdAt = {};
      if (startDate) movementFilter.createdAt.$gte = this.getDateBounds(startDate).start;
      if (endDate) movementFilter.createdAt.$lte = this.getDateBounds(endDate).end;
    }

    const movements = await StockMovement.find(movementFilter);
    const movementSummaryByType = {};

    for (const m of movements) {
      if (!movementSummaryByType[m.type]) {
        movementSummaryByType[m.type] = { count: 0, totalQuantity: 0, totalValue: 0 };
      }
      movementSummaryByType[m.type].count += 1;
      movementSummaryByType[m.type].totalQuantity += m.quantity;
      movementSummaryByType[m.type].totalValue += m.totalValue || 0;
    }

    return {
      currentStock: products.map((p) => ({
        productId: p._id,
        name: p.name,
        category: p.category,
        unit: p.unit,
        currentStock: p.currentStock,
        minStockLevel: p.minStockLevel,
        costPrice: p.costPrice,
        stockValue: Math.max(0, p.currentStock) * (p.costPrice || 0),
      })),
      lowStockProducts,
      lowStockCount: lowStockProducts.length,
      valuation,
      movementSummaryByType,
      totalMovements: movements.length,
    };
  }

  /**
   * Format Daily Report into Natural Conversational Text (Malayalam, Manglish, English)
   */
  formatDailyReportMessage(report, languageStyle = 'en') {
    const {
      totalRecordedSales,
      cashCollections,
      upiCollections,
      totalExpenses,
      categoryExpenses,
      recordedOperatingSurplus,
      unreconciledAmount,
      totalSupplierPayments,
    } = report;

    const catLines = Object.entries(categoryExpenses)
      .map(([cat, amt]) => `• ${this.formatCategoryName(cat, languageStyle)}: ${this.formatCurrency(amt)}`)
      .join('\n');

    if (languageStyle === 'ml') {
      return (
        `📊 *ഇന്നത്തെ കണക്ക് റിപ്പോർട്ട്*\n\n` +
        `💰 *മൊത്തം വിൽപ്പന:* ${this.formatCurrency(totalRecordedSales)}\n` +
        `  • ക്യാഷ്: ${this.formatCurrency(cashCollections)}\n` +
        `  • യുപിഐ: ${this.formatCurrency(upiCollections)}\n` +
        (unreconciledAmount > 0 ? `  • ബാക്കി കളക്ഷൻ: ${this.formatCurrency(unreconciledAmount)}\n` : '') +
        `\n📉 *മൊത്തം ചിലവ്:* ${this.formatCurrency(totalExpenses)}\n` +
        (catLines ? `${catLines}\n` : '') +
        (totalSupplierPayments > 0
          ? `\n🚚 *സപ്ലയർ പേയ്മെന്റുകൾ:* ${this.formatCurrency(totalSupplierPayments)}\n`
          : '') +
        `\n💵 *പ്രവർത്തന മിച്ചം (Surplus):* ${this.formatCurrency(recordedOperatingSurplus)}\n` +
        `_(ശ്രദ്ധിക്കുക: ഇത് അന്തിമ ലാഭമല്ല; രേഖപ്പെടുത്തിയ വരുമാനവും ചിലവും മാത്രമാണ്)_`
      );
    }

    if (languageStyle === 'manglish' || languageStyle === 'mixed') {
      return (
        `📊 *Innathe Financial Report*\n\n` +
        `💰 *Total Sales:* ${this.formatCurrency(totalRecordedSales)}\n` +
        `  • Cash: ${this.formatCurrency(cashCollections)}\n` +
        `  • UPI: ${this.formatCurrency(upiCollections)}\n` +
        (unreconciledAmount > 0 ? `  • Unreconciled: ${this.formatCurrency(unreconciledAmount)}\n` : '') +
        `\n📉 *Total Expenses:* ${this.formatCurrency(totalExpenses)}\n` +
        (catLines ? `${catLines}\n` : '') +
        (totalSupplierPayments > 0
          ? `\n🚚 *Supplier Payments:* ${this.formatCurrency(totalSupplierPayments)}\n`
          : '') +
        `\n💵 *Operating Surplus:* ${this.formatCurrency(recordedOperatingSurplus)}\n` +
        `_(Note: This is recorded sales minus expenses, not final net profit)_`
      );
    }

    return (
      `📊 *Today's Financial Report*\n\n` +
      `💰 *Total Recorded Sales:* ${this.formatCurrency(totalRecordedSales)}\n` +
      `  • Cash: ${this.formatCurrency(cashCollections)}\n` +
      `  • UPI: ${this.formatCurrency(upiCollections)}\n` +
      (unreconciledAmount > 0 ? `  • Unreconciled: ${this.formatCurrency(unreconciledAmount)}\n` : '') +
      `\n📉 *Total Expenses:* ${this.formatCurrency(totalExpenses)}\n` +
      (catLines ? `${catLines}\n` : '') +
      (totalSupplierPayments > 0
        ? `\n🚚 *Supplier Payments:* ${this.formatCurrency(totalSupplierPayments)}\n`
        : '') +
      `\n💵 *Recorded Operating Surplus:* ${this.formatCurrency(recordedOperatingSurplus)}\n` +
      `_(Note: Operating surplus represents sales minus recorded operating costs, not audited net profit)_`
    );
  }

  /**
   * Format Monthly Report into Natural Conversational Text
   */
  formatMonthlyReportMessage(report, languageStyle = 'en') {
    const {
      year,
      month,
      monthlySales,
      cashSales,
      upiSales,
      monthlyExpenses,
      categoryExpenses,
      supplierPurchases,
      supplierPayments,
      recordedOperatingSurplus,
      previousMonth,
    } = report;

    const catLines = Object.entries(categoryExpenses)
      .map(([cat, amt]) => `• ${this.formatCategoryName(cat, languageStyle)}: ${this.formatCurrency(amt)}`)
      .join('\n');

    let compLine = '';
    if (previousMonth?.sales > 0 && previousMonth.salesGrowthPct !== null) {
      const sign = previousMonth.salesGrowthPct >= 0 ? '+' : '';
      compLine = `\n📈 *MoM Sales Change:* ${sign}${previousMonth.salesGrowthPct}% (Prev: ${this.formatCurrency(previousMonth.sales)})\n`;
    }

    if (languageStyle === 'ml') {
      return (
        `📅 *${month}/${year} മാസത്തെ കണക്ക് റിപ്പോർട്ട്*\n\n` +
        `💰 *മാസത്തെ മൊത്തം വിൽപ്പന:* ${this.formatCurrency(monthlySales)}\n` +
        `  • ക്യാഷ്: ${this.formatCurrency(cashSales)}\n` +
        `  • യുപിഐ: ${this.formatCurrency(upiSales)}\n` +
        compLine +
        `\n📉 *മാസത്തെ ചിലവ്:* ${this.formatCurrency(monthlyExpenses)}\n` +
        (catLines ? `${catLines}\n` : '') +
        `\n🚚 *സപ്ലയർ ഇടപാടുകൾ:*\n` +
        `  • പർച്ചേസ് (ക്രെഡിറ്റ്/പറ്റ്): ${this.formatCurrency(supplierPurchases)}\n` +
        `  • പേയ്മെന്റുകൾ: ${this.formatCurrency(supplierPayments)}\n` +
        `\n💵 *പ്രവർത്തന മിച്ചം:* ${this.formatCurrency(recordedOperatingSurplus)}`
      );
    }

    return (
      `📅 *Monthly Financial Report (${month}/${year})*\n\n` +
      `💰 *Total Sales:* ${this.formatCurrency(monthlySales)}\n` +
      `  • Cash: ${this.formatCurrency(cashSales)}\n` +
      `  • UPI: ${this.formatCurrency(upiSales)}\n` +
      compLine +
      `\n📉 *Total Expenses:* ${this.formatCurrency(monthlyExpenses)}\n` +
      (catLines ? `${catLines}\n` : '') +
      `\n🚚 *Supplier Summary:*\n` +
      `  • Purchases: ${this.formatCurrency(supplierPurchases)}\n` +
      `  • Payments Made: ${this.formatCurrency(supplierPayments)}\n` +
      `\n💵 *Operating Surplus:* ${this.formatCurrency(recordedOperatingSurplus)}`
    );
  }

  formatCategoryName(category = '', lang = 'en') {
    const map = {
      VEGETABLES: { en: 'Vegetables', ml: 'പച്ചക്കറി', manglish: 'Pachakkari' },
      MEAT_FISH: { en: 'Meat & Fish', ml: 'ഇറച്ചി & മീൻ', manglish: 'Meen & Irachi' },
      GROCERIES: { en: 'Groceries', ml: 'പലചരക്ക്', manglish: 'Palacharakku' },
      GAS: { en: 'Gas Cylinder', ml: 'ഗ്യാസ്', manglish: 'Gas' },
      ELECTRICITY: { en: 'Electricity / KSEB', ml: 'കറന്റ് ബിൽ', manglish: 'Current Bill' },
      STAFF_WAGES: { en: 'Staff Wages / Salary', ml: 'സ്റ്റാഫ് ശമ്പളം/കൂലി', manglish: 'Staff Kooli' },
      RENT: { en: 'Shop Rent', ml: 'വാടക', manglish: 'Vadaka' },
      MAINTENANCE: { en: 'Maintenance & Repairs', ml: 'റിപ്പയർ', manglish: 'Maintenance' },
      TRANSPORTATION: { en: 'Transport / Petrol', ml: 'വണ്ടി കൂലി / പെട്രോൾ', manglish: 'Vandi Kooli' },
      OTHER_EXPENSE: { en: 'Other Expense', ml: 'മറ്റ് ചിലവുകൾ', manglish: 'Matte Chilavu' },
    };
    return map[category]?.[lang] || map[category]?.en || category;
  }
}

export const reportService = new ReportService();
