import { ConversationSession } from './session.model.js';
import { businessService } from '../businesses/business.service.js';
import { transactionService } from '../transactions/transaction.service.js';
import { supplierService } from '../suppliers/supplier.service.js';
import { customerService } from '../customers/customer.service.js';
import { inventoryService } from '../inventory/inventory.service.js';
import { Product } from '../inventory/product.model.js';
import { reportService } from '../reports/report.service.js';
import { subscriptionService } from '../subscriptions/subscription.service.js';
import { aiService } from '../../ai/ai.service.js';
import { languageDetectionService } from '../../ai/language-detection.service.js';
import { whatsappService } from '../whatsapp/whatsapp.service.js';
import { whatsappMediaService } from '../whatsapp/whatsapp-media.service.js';
import { validateImageBuffer } from '../../utils/image-validator.js';
import { validateAudioBuffer } from '../../utils/audio-validator.js';
import { logger } from '../../config/logger.js';
import { normalizeWhatsappNumber } from '../../utils/phone.js';
import { CONVERSATION_INTENTS } from '../../ai/schemas/intent.schema.js';

class ConversationService {
  /**
   * Helper to format currency values as ₹X,XXX
   */
  formatCurrency(amount = 0) {
    return `₹${Math.round(amount).toLocaleString('en-IN')}`;
  }

  /**
   * Main entrypoint for incoming WhatsApp messages
   */
  async handleIncomingMessage(senderNumber, textContent = '', buttonId = null, senderName = 'User', media = null) {
    const cleanNumber = normalizeWhatsappNumber(senderNumber);
    const cleanText = (textContent || '').trim();

    // 1. Resolve business & authenticated user context
    const { user, business, memberRole, permissions, businessConfig } =
      await businessService.resolveBusinessForUser(cleanNumber, senderName);

    const authContext = { memberRole, permissions: permissions || [] };

    // 1b. Enforce subscription status (EXPIRED / SUSPENDED blocks WhatsApp business operations)
    const subAccess = await subscriptionService.evaluateSubscriptionAccess(business._id);
    if (!subAccess.allowedWrite) {
      await whatsappService.sendTextMessage(
        cleanNumber,
        subAccess.reasonCode === 'SUBSCRIPTION_EXPIRED'
          ? 'Your 30-day VyaparBot pilot trial has expired. Your historical data is safe in read-only mode on the web dashboard. Please renew your subscription to continue recording via WhatsApp.'
          : 'Your VyaparBot subscription is currently inactive or suspended. Please contact support or renew on the web dashboard.',
      );
      return { blocked: true, reason: subAccess.reasonCode };
    }

    // Meter unique deduplicated inbound WhatsApp message & enforce monthly WhatsApp quota
    try {
      await subscriptionService.consumeUsageQuota(
        business._id,
        'whatsappMessagesCount',
        'monthlyWhatsappMessages',
      );
    } catch (quotaErr) {
      if (quotaErr?.code === 'USAGE_LIMIT_REACHED') {
        await whatsappService.sendTextMessage(
          cleanNumber,
          'Monthly WhatsApp message quota reached for your current plan. Please upgrade on the web dashboard to continue.',
        );
        return { blocked: true, reason: 'USAGE_LIMIT_REACHED' };
      }
      throw quotaErr;
    }

    // 2. Retrieve or initialize conversation session
    let session = await ConversationSession.findOne({ whatsappNumber: cleanNumber });
    if (!session) {
      session = await ConversationSession.create({
        whatsappNumber: cleanNumber,
        userId: user._id,
        businessId: business._id,
        currentIntent: 'IDLE',
      });
    }

    logger.info(
      {
        phone: cleanNumber,
        businessId: business._id,
        businessType: business.businessType,
        role: memberRole,
        text: cleanText,
        buttonId,
        mediaType: media?.type,
      },
      'Handling business conversation input',
    );

    // 3. Handle Interactive Button Clicks
    if (buttonId) {
      return this.handleButtonClick(session, user, business, buttonId, authContext);
    }

    // 4. Handle Media Messages (Payment Screenshots or Voice Notes)
    if (media) {
      try {
        await subscriptionService.consumeUsageQuota(
          business._id,
          'aiRequestsCount',
          'monthlyAiRequests',
        );
      } catch (quotaErr) {
        if (quotaErr?.code === 'USAGE_LIMIT_REACHED') {
          await whatsappService.sendTextMessage(
            cleanNumber,
            'Monthly AI request quota reached for your current plan. Please upgrade on the web dashboard.',
          );
          return { blocked: true, reason: 'USAGE_LIMIT_REACHED' };
        }
        throw quotaErr;
      }
      if (media.type === 'image') {
        return this.handleScreenshotMessage(session, user, business, media, cleanText, authContext);
      }
      if (media.type === 'audio' || media.type === 'voice') {
        return this.handleVoiceMessage(session, user, business, media, businessConfig, authContext);
      }
    }

    // 5. Handle Text Messages (AI extraction)
    try {
      await subscriptionService.consumeUsageQuota(
        business._id,
        'aiRequestsCount',
        'monthlyAiRequests',
      );
    } catch (quotaErr) {
      if (quotaErr?.code === 'USAGE_LIMIT_REACHED') {
        await whatsappService.sendTextMessage(
          cleanNumber,
          'Monthly AI request quota reached for your current plan. Please upgrade on the web dashboard.',
        );
        return { blocked: true, reason: 'USAGE_LIMIT_REACHED' };
      }
      throw quotaErr;
    }
    return this.handleTextMessage(session, user, business, cleanText, businessConfig, authContext);
  }

  hasPermission(authContext, requiredPermission) {
    if (!authContext) return false;
    if (authContext.memberRole === 'OWNER') return true;
    return Array.isArray(authContext.permissions) && authContext.permissions.includes(requiredPermission);
  }

  getRequiredPermissionForIntent(intent) {
    const map = {
      [CONVERSATION_INTENTS.ADD_SALE]: 'RECORD_TRANSACTIONS',
      [CONVERSATION_INTENTS.ADD_EXPENSE]: 'RECORD_TRANSACTIONS',
      [CONVERSATION_INTENTS.ADD_PURCHASE]: 'RECORD_TRANSACTIONS',
      [CONVERSATION_INTENTS.RECORD_PAYMENT]: 'RECORD_TRANSACTIONS',
      [CONVERSATION_INTENTS.EDIT_TRANSACTION]: 'EDIT_TRANSACTIONS',
      [CONVERSATION_INTENTS.DELETE_TRANSACTION]: 'VOID_TRANSACTIONS',
      [CONVERSATION_INTENTS.ADD_CREDIT_SALE]: 'MANAGE_CUSTOMERS',
      [CONVERSATION_INTENTS.RECORD_CUSTOMER_PAYMENT]: 'MANAGE_CUSTOMERS',
      [CONVERSATION_INTENTS.VIEW_CUSTOMER_BALANCE]: 'MANAGE_CUSTOMERS',
      [CONVERSATION_INTENTS.ADD_PRODUCT]: 'MANAGE_INVENTORY',
      [CONVERSATION_INTENTS.STOCK_IN]: 'MANAGE_INVENTORY',
      [CONVERSATION_INTENTS.STOCK_OUT]: 'MANAGE_INVENTORY',
      [CONVERSATION_INTENTS.RECORD_WASTAGE]: 'MANAGE_INVENTORY',
      [CONVERSATION_INTENTS.STOCK_ADJUSTMENT]: 'ADJUST_STOCK',
      [CONVERSATION_INTENTS.CHECK_STOCK]: 'VIEW_INVENTORY',
      [CONVERSATION_INTENTS.VIEW_LOW_STOCK]: 'VIEW_INVENTORY',
      [CONVERSATION_INTENTS.VIEW_INVENTORY_VALUATION]: 'VIEW_INVENTORY',
      [CONVERSATION_INTENTS.VIEW_INVENTORY_REPORT]: 'VIEW_INVENTORY',
      [CONVERSATION_INTENTS.VIEW_DAILY_REPORT]: 'VIEW_REPORTS',
      [CONVERSATION_INTENTS.VIEW_WEEKLY_REPORT]: 'VIEW_REPORTS',
      [CONVERSATION_INTENTS.VIEW_MONTHLY_REPORT]: 'VIEW_REPORTS',
      [CONVERSATION_INTENTS.VIEW_CASH_FLOW]: 'VIEW_REPORTS',
      [CONVERSATION_INTENTS.VIEW_RECEIVABLES]: 'VIEW_REPORTS',
      [CONVERSATION_INTENTS.VIEW_PAYABLES]: 'VIEW_REPORTS',
      [CONVERSATION_INTENTS.VIEW_SUPPLIER_BALANCE]: 'MANAGE_SUPPLIERS',
    };
    return map[intent] || null;
  }

  /**
   * Process Natural-Language Text Messages
   */
  async handleTextMessage(session, user, business, text, businessConfig = null, authContext = null) {
    const cleanText = String(text || '').trim();
    const detectedLang = languageDetectionService.detectLanguage(cleanText);
    const responseStyle = languageDetectionService.getResponseStyle(
      detectedLang,
      user.preferredLanguage,
    );

    // AI Extraction
    const extraction = await aiService.extractTransactionData({
      message: cleanText,
      businessConfig,
      sessionContext: {
        currentIntent: session.currentIntent,
        pendingTransaction: session.pendingTransaction,
        pendingConfirmation: session.pendingConfirmation,
        lastReferencedTransactionId: session.lastReferencedTransactionId,
      },
    });

    session.detectedLanguage = detectedLang;
    session.lastInteractionAt = new Date();

    // Backend RBAC check (never trust AI-extracted permissions)
    const requiredPermission = this.getRequiredPermissionForIntent(extraction.intent);
    if (requiredPermission && authContext && !this.hasPermission(authContext, requiredPermission)) {
      logger.warn(
        { userId: user._id, businessId: business._id, intent: extraction.intent, requiredPermission },
        'Unauthorized WhatsApp conversational action blocked by RBAC',
      );
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        `⛔ Authorization denied: You do not have permission (${requiredPermission}) to perform this action.`,
      );
    }

    // Handle Greetings
    if (extraction.intent === CONVERSATION_INTENTS.GREETING) {
      await session.save();
      const greeting = this.getGreetingMessage(business.name, responseStyle);
      return whatsappService.sendTextMessage(session.whatsappNumber, greeting);
    }

    // Handle Help
    if (extraction.intent === CONVERSATION_INTENTS.HELP) {
      await session.save();
      const help = this.getHelpMessage(responseStyle);
      return whatsappService.sendTextMessage(session.whatsappNumber, help);
    }

    // Handle Confirmation of Pending Action (e.g., Stock Adjustment, Text Action) or Pending Transaction
    if (extraction.intent === CONVERSATION_INTENTS.CONFIRM) {
      if (session.pendingConfirmation?.type === 'STOCK_ADJUSTMENT') {
        return this.confirmStockAdjustment(session, user, business, responseStyle);
      }
      if (session.pendingConfirmation?.type === 'TEXT_ACTION') {
        return this.confirmPendingTextAction(session, user, business, responseStyle, authContext);
      }
      if (session.pendingTransaction) {
        return this.confirmPendingTransaction(session, user, business, responseStyle);
      }
    }

    // Handle Cancellation of Pending Transaction
    if (extraction.intent === CONVERSATION_INTENTS.CANCEL) {
      session.pendingTransaction = null;
      session.pendingConfirmation = null;
      session.currentIntent = 'IDLE';
      await session.save();
      const msg =
        responseStyle === 'ml'
          ? 'ഇടപാട് റദ്ദാക്കി 👍'
          : responseStyle === 'manglish'
            ? 'Transaction cancel cheythu 👍'
            : 'Transaction cancelled 👍';
      return whatsappService.sendTextMessage(session.whatsappNumber, msg);
    }

    // Handle Missing Information / Clarification
    if (extraction.needsClarification && extraction.clarificationQuestion) {
      session.pendingTransaction = {
        ...extraction,
        intent: extraction.intent,
      };
      session.currentIntent = extraction.intent;
      await session.save();
      return whatsappService.sendTextMessage(session.whatsappNumber, extraction.clarificationQuestion);
    }

    // Handle Daily Report Request
    if (extraction.intent === CONVERSATION_INTENTS.VIEW_DAILY_REPORT) {
      const targetDate = extraction.transactionDate === 'YESTERDAY' ? new Date(Date.now() - 86400000) : new Date();
      const report = await reportService.generateDailyReport(business._id, targetDate);
      const reply = reportService.formatDailyReportMessage(report, responseStyle);
      session.currentIntent = 'IDLE';
      await session.save();
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    // Handle Monthly Report Request
    if (extraction.intent === CONVERSATION_INTENTS.VIEW_MONTHLY_REPORT) {
      const report = await reportService.generateMonthlyReport(
        business._id,
        extraction.reportQuery?.year,
        extraction.reportQuery?.month,
      );
      const reply = reportService.formatMonthlyReportMessage(report, responseStyle);
      session.currentIntent = 'IDLE';
      await session.save();
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    // Handle Weekly Report Request
    if (extraction.intent === CONVERSATION_INTENTS.VIEW_WEEKLY_REPORT) {
      const report = await reportService.generateWeeklyReport(
        business._id,
        new Date(),
        business.timezone || 'Asia/Kolkata',
      );
      const reply =
        `📅 *Weekly Report (${report.startDate} to ${report.endDate})*\n\n` +
        `💰 Total Sales: *${this.formatCurrency(report.totalSales)}*\n` +
        `  • Cash: ${this.formatCurrency(report.cashSales)} | UPI: ${this.formatCurrency(report.upiSales)}\n` +
        `📉 Total Expenses: *${this.formatCurrency(report.totalExpenses)}*\n` +
        `🚚 Supplier Purchases: ${this.formatCurrency(report.supplierPurchases)}\n` +
        `💵 Payments Received: ${this.formatCurrency(report.paymentsReceived)} | Paid: ${this.formatCurrency(report.paymentsMade)}\n` +
        `📊 Recorded Operating Surplus: *${this.formatCurrency(report.recordedOperatingSurplus)}*`;
      session.currentIntent = 'IDLE';
      await session.save();
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    // Handle Cash Flow Report Request
    if (extraction.intent === CONVERSATION_INTENTS.VIEW_CASH_FLOW) {
      const cf = await reportService.generateCashFlowReport(business._id, {
        timezone: business.timezone || 'Asia/Kolkata',
      });
      const reply =
        `💵 *Cash Flow Summary*\n\n` +
        `Cash Inflows: ${this.formatCurrency(cf.cash.inflows)} | Outflows: ${this.formatCurrency(cf.cash.outflows)}\n` +
        `Bank/UPI Inflows: ${this.formatCurrency(cf.bankAndUpi.inflows)} | Outflows: ${this.formatCurrency(cf.bankAndUpi.outflows)}\n` +
        `Closing Balance: *${this.formatCurrency(cf.totalClosingBalance)}*`;
      session.currentIntent = 'IDLE';
      await session.save();
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    // Handle Receivables / Payables / Inventory Reports
    if (extraction.intent === CONVERSATION_INTENTS.VIEW_RECEIVABLES) {
      const rec = await reportService.generateReceivablesReport(business._id);
      const reply = `📋 *Accounts Receivable*\nTotal Receivable: *${this.formatCurrency(rec.totalReceivables)}* (${rec.customerCount} customers)`;
      session.currentIntent = 'IDLE';
      await session.save();
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    if (extraction.intent === CONVERSATION_INTENTS.VIEW_PAYABLES) {
      const pay = await reportService.generatePayablesReport(business._id);
      const reply = `📋 *Accounts Payable*\nTotal Payable: *${this.formatCurrency(pay.totalPayables)}* (${pay.supplierCount} suppliers)`;
      session.currentIntent = 'IDLE';
      await session.save();
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    if (extraction.intent === CONVERSATION_INTENTS.VIEW_INVENTORY_REPORT) {
      const inv = await reportService.generateInventoryReport(business._id);
      const reply =
        `📦 *Inventory Report*\n\n` +
        `Active Products: ${inv.currentStock.length}\n` +
        `Low-Stock Alerts: ${inv.lowStockCount}\n` +
        `Total Valuation: *${this.formatCurrency(inv.valuation.totalValue)}*`;
      session.currentIntent = 'IDLE';
      await session.save();
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    if (this.shouldRequireTextConfirmation() && this.isWriteConfirmationIntent(extraction.intent)) {
      return this.promptTextActionConfirmation(session, extraction, cleanText, responseStyle);
    }

    return this.executeExtractedIntent(session, user, business, extraction, responseStyle);
  }

  /**
   * Execute a validated/confirmed text extraction intent
   */
  async executeExtractedIntent(session, user, business, extraction, responseStyle) {
    // Handle Inventory Intents
    if (
      [
        CONVERSATION_INTENTS.ADD_PRODUCT,
        CONVERSATION_INTENTS.STOCK_IN,
        CONVERSATION_INTENTS.STOCK_OUT,
        CONVERSATION_INTENTS.RECORD_WASTAGE,
        CONVERSATION_INTENTS.STOCK_ADJUSTMENT,
        CONVERSATION_INTENTS.CHECK_STOCK,
        CONVERSATION_INTENTS.VIEW_LOW_STOCK,
        CONVERSATION_INTENTS.VIEW_INVENTORY_VALUATION,
      ].includes(extraction.intent)
    ) {
      return this.handleInventoryIntent(session, user, business, extraction, responseStyle);
    }

    // Handle Customer Management Intents
    if (
      [
        CONVERSATION_INTENTS.ADD_CREDIT_SALE,
        CONVERSATION_INTENTS.RECORD_CUSTOMER_PAYMENT,
        CONVERSATION_INTENTS.VIEW_CUSTOMER_BALANCE,
      ].includes(extraction.intent)
    ) {
      return this.handleCustomerIntent(session, user, business, extraction, responseStyle);
    }

    // Handle Supplier Balance Request
    if (extraction.intent === CONVERSATION_INTENTS.VIEW_SUPPLIER_BALANCE) {
      return this.handleSupplierBalanceQuery(session, business, extraction.merchantOrSupplier, responseStyle);
    }

    // Handle Delete / Void Last Transaction
    if (extraction.intent === CONVERSATION_INTENTS.DELETE_TRANSACTION) {
      return this.handleDeleteTransaction(session, user, business, responseStyle);
    }

    // Handle Edit Last Transaction
    if (extraction.intent === CONVERSATION_INTENTS.EDIT_TRANSACTION) {
      return this.handleEditTransaction(session, user, business, extraction, responseStyle);
    }

    // Handle Sales Recording
    if (extraction.intent === CONVERSATION_INTENTS.ADD_SALE) {
      const res = await transactionService.recordSale({
        businessId: business._id,
        amount: extraction.amount,
        paymentMethod: extraction.paymentMethod,
        paymentBreakdown: extraction.paymentBreakdown,
        salePeriod: extraction.salePeriod,
        transactionDate: extraction.transactionDate,
        description: extraction.description,
        source: 'TEXT',
        createdBy: user._id,
      });

      if (res.duplicate) {
        const dupMsg =
          responseStyle === 'ml'
            ? '⚠️ ഈ വിൽപ്പന ഇതിനകം രേഖപ്പെടുത്തിയിട്ടുണ്ട്.'
            : responseStyle === 'manglish'
              ? '⚠️ Ee sales already record cheythittundu.'
              : '⚠️ This sale has already been recorded.';
        return whatsappService.sendTextMessage(session.whatsappNumber, dupMsg);
      }

      session.lastReferencedTransactionId = res.transaction._id;
      session.pendingTransaction = null;
      session.currentIntent = 'IDLE';
      await session.save();

      const reply = this.formatSaleRecordedMessage(res.transaction, responseStyle);
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    // Handle Expense Recording
    if (extraction.intent === CONVERSATION_INTENTS.ADD_EXPENSE) {
      const res = await transactionService.recordExpense({
        businessId: business._id,
        amount: extraction.amount,
        category: extraction.category,
        paymentMethod: extraction.paymentMethod,
        transactionDate: extraction.transactionDate,
        merchantOrSupplier: extraction.merchantOrSupplier,
        description: extraction.description,
        source: 'TEXT',
        createdBy: user._id,
      });

      if (res.duplicate) {
        const dupMsg =
          responseStyle === 'ml'
            ? '⚠️ ഈ ചിലവ് ഇതിനകം രേഖപ്പെടുത്തിയിട്ടുണ്ട്.'
            : responseStyle === 'manglish'
              ? '⚠️ Ee expense already record cheythittundu.'
              : '⚠️ This expense has already been recorded.';
        return whatsappService.sendTextMessage(session.whatsappNumber, dupMsg);
      }

      session.lastReferencedTransactionId = res.transaction._id;
      session.pendingTransaction = null;
      session.currentIntent = 'IDLE';
      await session.save();

      const reply = this.formatExpenseRecordedMessage(res.transaction, responseStyle);
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    // Handle Supplier Purchase (Credit)
    if (extraction.intent === CONVERSATION_INTENTS.ADD_PURCHASE) {
      const res = await transactionService.recordPurchase({
        businessId: business._id,
        amount: extraction.amount,
        category: extraction.category,
        paymentMethod: extraction.paymentMethod || 'CREDIT',
        merchantOrSupplier: extraction.merchantOrSupplier,
        transactionDate: extraction.transactionDate,
        description: extraction.description,
        source: 'TEXT',
        createdBy: user._id,
      });

      session.lastReferencedTransactionId = res.transaction._id;
      session.pendingTransaction = null;
      session.currentIntent = 'IDLE';
      await session.save();

      const reply = this.formatPurchaseRecordedMessage(res.transaction, res.supplier, responseStyle);
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    // Handle Supplier Payment
    if (extraction.intent === CONVERSATION_INTENTS.RECORD_PAYMENT) {
      const res = await transactionService.recordSupplierPayment({
        businessId: business._id,
        amount: extraction.amount,
        paymentMethod: extraction.paymentMethod || 'CASH',
        merchantOrSupplier: extraction.merchantOrSupplier,
        referenceId: extraction.referenceId,
        transactionDate: extraction.transactionDate,
        source: 'TEXT',
        createdBy: user._id,
      });

      session.lastReferencedTransactionId = res.transaction._id;
      session.pendingTransaction = null;
      session.currentIntent = 'IDLE';
      await session.save();

      const reply = this.formatSupplierPaymentRecordedMessage(res.transaction, res.supplier, responseStyle);
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    // Fallback for unclear intent
    const fallbackText =
      responseStyle === 'ml'
        ? 'ക്ഷമിക്കണം, എനിക്ക് മനസ്സിലായില്ല. വിൽപ്പനയോ ചിലവോ രേഖപ്പെടുത്താൻ അയക്കുക, അല്ലെങ്കിൽ "കണക്ക്" എന്ന് അയക്കുക.'
        : responseStyle === 'manglish'
          ? 'Kshamikkuka, manassilayilla. Sales or expense record cheyyan message ayakkuka, allenkil "Today report" ennu parayuka.'
          : 'I did not understand that. You can record sales, expenses, or ask for "Today\'s report".';

    return whatsappService.sendTextMessage(session.whatsappNumber, fallbackText);
  }

  /**
   * Process Financial Screenshot Upload
   */
  async handleScreenshotMessage(session, user, business, media, caption = '', authContext = null) {
    if (authContext && !this.hasPermission(authContext, 'RECORD_TRANSACTIONS')) {
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        '⛔ Authorization denied: RECORD_TRANSACTIONS permission required.',
      );
    }
    const responseStyle = languageDetectionService.getResponseStyle(
      session.detectedLanguage,
      user.preferredLanguage,
    );

    let mediaBuffer;
    let contentType;

    try {
      if (media.buffer) {
        mediaBuffer = media.buffer;
        contentType = media.contentType || 'image/jpeg';
      } else {
        const dl = await whatsappMediaService.downloadWhatsAppMedia(media.id);
        mediaBuffer = dl.buffer;
        contentType = dl.contentType;
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to download WhatsApp screenshot');
      const errReply =
        responseStyle === 'ml'
          ? 'ഫോട്ടോ ഡൗൺലോഡ് ചെയ്യാൻ കഴിഞ്ഞില്ല. ദയവായി വീണ്ടും അയക്കുക.'
          : 'Could not download the screenshot. Please try again.';
      return whatsappService.sendTextMessage(session.whatsappNumber, errReply);
    }

    // Validate image binary signature & size
    const validation = validateImageBuffer(mediaBuffer, contentType);
    if (!validation.valid) {
      logger.warn({ error: validation.error }, 'Invalid screenshot image rejected');
      const invalidReply =
        responseStyle === 'ml'
          ? 'ഇതൊരു സാധുവായ ഇമേജ് ഫയലല്ല. ദയവായി വ്യക്തമായ സ്ക്രീൻഷോട്ട് അയക്കുക.'
          : 'Invalid image file. Please send a clear screenshot.';
      return whatsappService.sendTextMessage(session.whatsappNumber, invalidReply);
    }

    // Check for duplicate screenshot
    const dup = await transactionService.checkDuplicate({
      businessId: business._id,
      imageHash: validation.hash,
    });

    if (dup.isDuplicate) {
      const dupReply =
        responseStyle === 'ml'
          ? '⚠️ ഈ സ്ക്രീൻഷോട്ട് ഇതിനകം രേഖപ്പെടുത്തിയിട്ടുണ്ട്.'
          : responseStyle === 'manglish'
            ? '⚠️ Ee screenshot already record cheythittundu.'
            : '⚠️ This payment screenshot has already been recorded.';
      return whatsappService.sendTextMessage(session.whatsappNumber, dupReply);
    }

    // Vision-based AI Extraction
    const extraction = await aiService.extractScreenshotData({
      imageBuffer: mediaBuffer,
      mimeType: validation.mimeType,
      caption,
      mockData: media.mockData || null,
    });

    // Safeguard 1: Do not record failed payments as completed!
    if (extraction.transactionStatus === 'FAILED') {
      const failMsg =
        responseStyle === 'ml'
          ? `❌ *പേയ്മെന്റ് പരാജയപ്പെട്ടു (FAILED)*\n\nഈ പേയ്മെന്റ് അക്കൗണ്ടിൽ പരാജയപ്പെട്ടതായി കാണുന്നു (${this.formatCurrency(extraction.amount || 0)}). ഇത് റെക്കോർഡ് ചെയ്തിട്ടില്ല.`
          : `❌ *Payment Failed*\n\nThis transaction is marked as failed (${this.formatCurrency(extraction.amount || 0)}). It has not been recorded.`;
      return whatsappService.sendTextMessage(session.whatsappNumber, failMsg);
    }

    // Safeguard 2: Warn if payment is pending
    if (extraction.transactionStatus === 'PENDING') {
      const pendMsg =
        responseStyle === 'ml'
          ? `⏳ *പേയ്മെന്റ് പ്രോസസ്സിംഗിലാണ് (PENDING)*\n\nതുക: ${this.formatCurrency(extraction.amount || 0)}\nബാങ്ക് സ്ഥിരീകരിച്ച ശേഷം മാത്രം അക്കൗണ്ടിൽ ചേർക്കുക.`
          : `⏳ *Payment Pending*\n\nAmount: ${this.formatCurrency(extraction.amount || 0)}\nPlease confirm once the bank settles the transaction.`;
      return whatsappService.sendTextMessage(session.whatsappNumber, pendMsg);
    }

    // Prepare pending transaction for user confirmation
    const isIncoming = extraction.transactionDirection === 'INCOMING';
    const suggestedType = isIncoming ? 'SALE' : 'EXPENSE';
    const suggestedCategory = isIncoming ? 'UPI_SALES' : extraction.suggestedCategory || 'OTHER_EXPENSE';

    session.pendingTransaction = {
      type: suggestedType,
      category: suggestedCategory,
      amount: extraction.amount,
      paymentMethod: 'UPI',
      referenceId: extraction.referenceId,
      imageHash: validation.hash,
      merchantOrRecipient: extraction.merchantOrRecipient,
      source: 'SCREENSHOT',
    };
    session.currentIntent = 'CONFIRM_SCREENSHOT';
    await session.save();

    // Confirmation message with interactive buttons
    const directionLabel = isIncoming
      ? responseStyle === 'ml'
        ? 'വരുമാനം (വിൽപ്പന)'
        : 'Incoming Sale'
      : responseStyle === 'ml'
        ? 'ചിലവ് (Expense)'
        : 'Outgoing Expense';

    const confirmBody =
      `📸 *സ്ക്രീൻഷോട്ട് വിവരങ്ങൾ കണ്ടെത്തി*\n\n` +
      `തുക: *${this.formatCurrency(extraction.amount || 0)}*\n` +
      `ഇനം: ${directionLabel}\n` +
      (extraction.referenceId ? `Ref ID: ${extraction.referenceId}\n` : '') +
      (extraction.merchantOrRecipient ? `പേര്: ${extraction.merchantOrRecipient}\n` : '') +
      `\nഇത് രേഖപ്പെടുത്തണമോ?`;

    const buttons = [
      { id: 'confirm_screenshot', title: '✅ സ്ഥിരീകരിക്കുക' },
      { id: 'cancel_screenshot', title: '❌ വേണ്ട' },
    ];

    try {
      return await whatsappService.sendButtonMessage(session.whatsappNumber, confirmBody, buttons);
    } catch {
      // Fallback to text prompt
      return await whatsappService.sendTextMessage(
        session.whatsappNumber,
        `${confirmBody}\n\n("Confirm" അല്ലെങ്കിൽ "Cancel" എന്ന് മറുപടി അയക്കുക)`,
      );
    }
  }

  /**
   * Process Voice Note Message
   */
  async handleVoiceMessage(session, user, business, media, businessConfig = null, authContext = null) {
    const responseStyle = languageDetectionService.getResponseStyle(
      session.detectedLanguage,
      user.preferredLanguage,
    );

    let audioBuffer;
    let contentType;

    try {
      if (media.buffer) {
        audioBuffer = media.buffer;
        contentType = media.contentType || 'audio/ogg';
      } else {
        const dl = await whatsappMediaService.downloadWhatsAppMedia(media.id);
        audioBuffer = dl.buffer;
        contentType = dl.contentType;
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to download WhatsApp voice note');
      return whatsappService.sendTextMessage(session.whatsappNumber, 'Could not download voice note.');
    }

    // Validate audio buffer size and MIME type
    const audioValidation = validateAudioBuffer(audioBuffer, contentType);
    if (!audioValidation.valid) {
      logger.warn({ error: audioValidation.error }, 'Invalid voice media rejected');
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        'Invalid or unsupported voice note format/size.',
      );
    }

    // Transcribe speech to text
    const { transcript } = await aiService.transcribeVoice({
      audioBuffer,
      mimeType: audioValidation.mimeType,
      mockTranscript: media.mockTranscript,
      preferredLanguage: user.preferredLanguage,
    });

    logger.info({ phone: session.whatsappNumber, transcript }, 'Voice note transcribed');

    // Route transcribed text through the conversation pipeline
    return this.handleTextMessage(session, user, business, transcript, businessConfig, authContext);
  }

  /**
   * Handle Interactive Button Replies
   */
  async handleButtonClick(session, user, business, buttonId, authContext = null) {
    const responseStyle = languageDetectionService.getResponseStyle(
      session.detectedLanguage,
      user.preferredLanguage,
    );

    if (buttonId === 'confirm_text_action' && session.pendingConfirmation?.type === 'TEXT_ACTION') {
      return this.confirmPendingTextAction(session, user, business, responseStyle, authContext);
    }

    if (buttonId === 'cancel_text_action') {
      session.pendingConfirmation = null;
      session.currentIntent = 'IDLE';
      await session.save();
      const msg =
        responseStyle === 'ml'
          ? 'രേഖപ്പെടുത്തുന്നത് റദ്ദാക്കി 👍'
          : 'Entry cancelled 👍';
      return whatsappService.sendTextMessage(session.whatsappNumber, msg);
    }

    if (buttonId === 'confirm_stock_adjustment' && session.pendingConfirmation?.type === 'STOCK_ADJUSTMENT') {
      if (authContext && !this.hasPermission(authContext, 'ADJUST_STOCK')) {
        return whatsappService.sendTextMessage(
          session.whatsappNumber,
          '⛔ Authorization denied: ADJUST_STOCK permission required.',
        );
      }
      return this.confirmStockAdjustment(session, user, business, responseStyle);
    }

    if (buttonId === 'confirm_screenshot' || buttonId === 'confirm_transaction') {
      return this.confirmPendingTransaction(session, user, business, responseStyle);
    }

    if (buttonId === 'cancel_screenshot' || buttonId === 'cancel_transaction') {
      session.pendingTransaction = null;
      session.currentIntent = 'IDLE';
      await session.save();
      return whatsappService.sendTextMessage(session.whatsappNumber, 'Cancelled 👍');
    }

    if (buttonId === 'view_daily_report') {
      const report = await reportService.generateDailyReport(business._id, new Date());
      const reply = reportService.formatDailyReportMessage(report, responseStyle);
      return whatsappService.sendTextMessage(session.whatsappNumber, reply);
    }

    return whatsappService.sendTextMessage(session.whatsappNumber, 'Action received.');
  }

  /**
   * Commit Pending Confirmed Transaction to Database
   */
  async confirmPendingTransaction(session, user, business, responseStyle) {
    const pending = session.pendingTransaction;
    if (!pending || !pending.amount) {
      session.pendingTransaction = null;
      session.currentIntent = 'IDLE';
      await session.save();
      return whatsappService.sendTextMessage(session.whatsappNumber, 'No pending transaction to confirm.');
    }

    let result;
    if (pending.type === 'SALE') {
      result = await transactionService.recordSale({
        businessId: business._id,
        amount: pending.amount,
        paymentMethod: pending.paymentMethod || 'UPI',
        paymentBreakdown: pending.paymentBreakdown || { upi: pending.amount },
        referenceId: pending.referenceId,
        imageHash: pending.imageHash,
        source: pending.source || 'SCREENSHOT',
        createdBy: user._id,
      });
    } else {
      result = await transactionService.recordExpense({
        businessId: business._id,
        amount: pending.amount,
        category: pending.category || 'OTHER_EXPENSE',
        paymentMethod: pending.paymentMethod || 'UPI',
        referenceId: pending.referenceId,
        imageHash: pending.imageHash,
        merchantOrSupplier: pending.merchantOrRecipient,
        source: pending.source || 'SCREENSHOT',
        createdBy: user._id,
      });
    }

    session.lastReferencedTransactionId = result.transaction._id;
    session.pendingTransaction = null;
    session.currentIntent = 'IDLE';
    await session.save();

    const okMsg =
      responseStyle === 'ml'
        ? `✅ ഇടപാട് വിജയകരമായി രേഖപ്പെടുത്തി!\n\nതുക: ${this.formatCurrency(result.transaction.amount)}\nഇനം: ${result.transaction.category}`
        : `✅ Transaction saved successfully!\n\nAmount: ${this.formatCurrency(result.transaction.amount)}\nCategory: ${result.transaction.category}`;

    return whatsappService.sendTextMessage(session.whatsappNumber, okMsg);
  }

  /**
   * Handle Supplier Balance Query
   */
  async handleSupplierBalanceQuery(session, business, supplierName, responseStyle) {
    if (supplierName) {
      const sup = await supplierService.getSupplierByNameOrId(business._id, supplierName);
      if (!sup) {
        const notFound =
          responseStyle === 'ml'
            ? `"${supplierName}" എന്ന സപ്ലയറെ കണ്ടെത്തിയില്ല.`
            : `Supplier "${supplierName}" not found.`;
        return whatsappService.sendTextMessage(session.whatsappNumber, notFound);
      }

      const msg =
        responseStyle === 'ml'
          ? `🚚 *സപ്ലയർ വിവരങ്ങൾ*\n\nപേര്: *${sup.name}*\nബാക്കി നൽകാനുള്ളത്: *${this.formatCurrency(sup.outstandingBalance)}*\nആകെ പർച്ചേസ്: ${this.formatCurrency(sup.totalPurchases)}\nആകെ നൽകിയത്: ${this.formatCurrency(sup.totalPayments)}`
          : `🚚 *Supplier Balance*\n\nName: *${sup.name}*\nOutstanding Balance: *${this.formatCurrency(sup.outstandingBalance)}*\nTotal Purchases: ${this.formatCurrency(sup.totalPurchases)}\nTotal Paid: ${this.formatCurrency(sup.totalPayments)}`;

      return whatsappService.sendTextMessage(session.whatsappNumber, msg);
    }

    // List all suppliers with outstanding balances
    const suppliers = await supplierService.getSuppliersWithBalances(business._id);
    if (!suppliers || suppliers.length === 0) {
      const emptyMsg =
        responseStyle === 'ml' ? 'സപ്ലയർ ബാലൻസുകൾ ഒന്നും രേഖപ്പെടുത്തിയിട്ടില്ല.' : 'No supplier balances found.';
      return whatsappService.sendTextMessage(session.whatsappNumber, emptyMsg);
    }

    const lines = suppliers
      .map((s) => `• *${s.name}*: ${this.formatCurrency(s.outstandingBalance)}`)
      .join('\n');

    const listMsg =
      responseStyle === 'ml'
        ? `🚚 *സപ്ലയർ ബാക്കി തുകകൾ (Outstanding)*\n\n${lines}`
        : `🚚 *Supplier Outstanding Balances*\n\n${lines}`;

    return whatsappService.sendTextMessage(session.whatsappNumber, listMsg);
  }

  /**
   * Handle Edit Last Transaction
   */
  async handleEditTransaction(session, user, business, extraction, responseStyle) {
    const lastTx = await transactionService.getLastTransaction(business._id);
    if (!lastTx) {
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        'No recent transaction found to edit.',
      );
    }

    const updates = {};
    if (extraction.editAction?.newAmount) {
      updates.amount = extraction.editAction.newAmount;
    } else if (extraction.amount) {
      updates.amount = extraction.amount;
    }
    if (extraction.editAction?.newPaymentMethod) {
      updates.paymentMethod = extraction.editAction.newPaymentMethod;
    }

    const res = await transactionService.editTransaction({
      businessId: business._id,
      transactionId: lastTx._id,
      updates,
      changedBy: user._id,
      reason: 'User voice/text edit',
    });

    const reply =
      responseStyle === 'ml'
        ? `✏️ *ഇടപാട് തിരുത്തി!*\n\nപുതിയ തുക: ${this.formatCurrency(res.transaction.amount)}\nഇനം: ${res.transaction.category}`
        : `✏️ *Transaction updated!*\n\nNew Amount: ${this.formatCurrency(res.transaction.amount)}\nCategory: ${res.transaction.category}`;

    return whatsappService.sendTextMessage(session.whatsappNumber, reply);
  }

  /**
   * Handle Delete / Void Last Transaction
   */
  async handleDeleteTransaction(session, user, business, responseStyle) {
    const lastTx = await transactionService.getLastTransaction(business._id);
    if (!lastTx) {
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        'No recent transaction found to delete.',
      );
    }

    await transactionService.voidTransaction({
      businessId: business._id,
      transactionId: lastTx._id,
      changedBy: user._id,
      reason: 'User WhatsApp void request',
    });

    const reply =
      responseStyle === 'ml'
        ? `🗑️ *അവസാന ഇടപാട് റദ്ദാക്കി (Voided)!*\n\nതുക: ${this.formatCurrency(lastTx.amount)}\nഇനം: ${lastTx.category}`
        : `🗑️ *Last transaction voided!*\n\nAmount: ${this.formatCurrency(lastTx.amount)}\nCategory: ${lastTx.category}`;

    return whatsappService.sendTextMessage(session.whatsappNumber, reply);
  }

  formatSaleRecordedMessage(tx, responseStyle = 'en') {
    const b = tx.paymentBreakdown || {};
    const hasBreakdown = (b.cash || 0) > 0 || (b.upi || 0) > 0;

    if (responseStyle === 'ml') {
      let breakdownText = '';
      if (hasBreakdown) {
        breakdownText = `  • ക്യാഷ്: ${this.formatCurrency(b.cash || 0)}\n  • യുപിഐ: ${this.formatCurrency(b.upi || 0)}\n`;
      }
      return (
        `✅ *ഇന്നത്തെ വിൽപ്പന രേഖപ്പെടുത്തി*\n\n` +
        `മൊത്തം വിൽപ്പന: *${this.formatCurrency(tx.amount)}*\n` +
        breakdownText +
        (tx.salePeriod && tx.salePeriod !== 'FULL_DAY' ? `സമയം: ${tx.salePeriod}\n` : '')
      );
    }

    if (responseStyle === 'manglish' || responseStyle === 'mixed') {
      let breakdownText = '';
      if (hasBreakdown) {
        breakdownText = `  • Cash: ${this.formatCurrency(b.cash || 0)}\n  • UPI: ${this.formatCurrency(b.upi || 0)}\n`;
      }
      return (
        `✅ *Today's sales recorded*\n\n` +
        `Total Sales: *${this.formatCurrency(tx.amount)}*\n` +
        breakdownText
      );
    }

    let breakdownText = '';
    if (hasBreakdown) {
      breakdownText = `  • Cash: ${this.formatCurrency(b.cash || 0)}\n  • UPI: ${this.formatCurrency(b.upi || 0)}\n`;
    }
    return (
      `✅ *Today's sales recorded*\n\n` +
      `Total Sales: *${this.formatCurrency(tx.amount)}*\n` +
      breakdownText
    );
  }

  formatExpenseRecordedMessage(tx, responseStyle = 'en') {
    if (responseStyle === 'ml') {
      return (
        `📉 *ചിലവ് രേഖപ്പെടുത്തി*\n\n` +
        `തുക: *${this.formatCurrency(tx.amount)}*\n` +
        `ഇനം: ${tx.category}\n` +
        `പേയ്മെന്റ്: ${tx.paymentMethod}\n` +
        (tx.supplierName ? `സപ്ലയർ: ${tx.supplierName}\n` : '')
      );
    }
    return (
      `📉 *Expense recorded*\n\n` +
      `Amount: *${this.formatCurrency(tx.amount)}*\n` +
      `Category: ${tx.category}\n` +
      `Method: ${tx.paymentMethod}\n` +
      (tx.supplierName ? `Supplier: ${tx.supplierName}\n` : '')
    );
  }

  formatPurchaseRecordedMessage(tx, supplier, responseStyle = 'en') {
    if (responseStyle === 'ml') {
      return (
        `📦 *പർച്ചേസ് രേഖപ്പെടുത്തി (Credit/പറ്റ്)*\n\n` +
        `സപ്ലയർ: *${supplier.name}*\n` +
        `തുക: *${this.formatCurrency(tx.amount)}*\n` +
        `സപ്ലയർക്ക് ആകെ നൽകാനുള്ള തുക (Balance): *${this.formatCurrency(supplier.outstandingBalance)}*`
      );
    }
    return (
      `📦 *Supplier purchase recorded (Credit)*\n\n` +
      `Supplier: *${supplier.name}*\n` +
      `Amount: *${this.formatCurrency(tx.amount)}*\n` +
      `Updated Balance Due: *${this.formatCurrency(supplier.outstandingBalance)}*`
    );
  }

  formatSupplierPaymentRecordedMessage(tx, supplier, responseStyle = 'en') {
    if (responseStyle === 'ml') {
      return (
        `🚚 *സപ്ലയർ പേയ്മെന്റ് രേഖപ്പെടുത്തി*\n\n` +
        `സപ്ലയർ: *${supplier.name}*\n` +
        `നൽകിയ തുക: *${this.formatCurrency(tx.amount)}* (${tx.paymentMethod})\n` +
        `ബാക്കി നൽകാനുള്ള തുക: *${this.formatCurrency(supplier.outstandingBalance)}*`
      );
    }
    return (
      `🚚 *Supplier payment recorded*\n\n` +
      `Supplier: *${supplier.name}*\n` +
      `Paid: *${this.formatCurrency(tx.amount)}* (${tx.paymentMethod})\n` +
      `Remaining Balance: *${this.formatCurrency(supplier.outstandingBalance)}*`
    );
  }

  /**
   * Route Inventory Intents (ADD_PRODUCT, STOCK_IN, STOCK_OUT, RECORD_WASTAGE, STOCK_ADJUSTMENT, CHECK_STOCK, VIEW_LOW_STOCK, VIEW_INVENTORY_VALUATION)
   */
  async handleInventoryIntent(session, user, business, extraction, responseStyle) {
    const inv = extraction.inventoryAction || {};

    if (extraction.intent === CONVERSATION_INTENTS.VIEW_LOW_STOCK) {
      const alerts = await inventoryService.getLowStockAlerts(business._id);
      session.currentIntent = 'IDLE';
      session.pendingTransaction = null;
      await session.save();

      if (alerts.length === 0) {
        return whatsappService.sendTextMessage(
          session.whatsappNumber,
          responseStyle === 'ml'
            ? '✅ കുറവുള്ള സ്റ്റോക്ക് ഉൽപ്പന്നങ്ങൾ ഒന്നുമില്ല.'
            : '✅ No low-stock alerts right now.',
        );
      }

      const lines = alerts
        .map((p) => `• *${p.name}*: ${p.currentStock} ${p.unit} (Min: ${p.minStockLevel})`)
        .join('\n');
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        `⚠️ *Low Stock Alerts*\n\n${lines}`,
      );
    }

    if (extraction.intent === CONVERSATION_INTENTS.VIEW_INVENTORY_VALUATION) {
      const val = await inventoryService.getInventoryValuation(business._id);
      session.currentIntent = 'IDLE';
      session.pendingTransaction = null;
      await session.save();
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        `💰 *Inventory Valuation*\n\nProducts: ${val.productCount}\nTotal Units: ${val.totalUnits}\nTotal Value: *${this.formatCurrency(val.totalValue)}*`,
      );
    }

    if (extraction.intent === CONVERSATION_INTENTS.CHECK_STOCK) {
      const product = await Product.findOne({
        businessId: business._id,
        normalizedName: String(inv.productName || '').trim().toLowerCase(),
        status: 'ACTIVE',
      });
      session.currentIntent = 'IDLE';
      session.pendingTransaction = null;
      await session.save();

      if (!product) {
        return whatsappService.sendTextMessage(
          session.whatsappNumber,
          `Product "${inv.productName}" not found in inventory.`,
        );
      }
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        `📦 *${product.name}*\nCurrent Stock: *${product.currentStock} ${product.unit}*\nMin Alert Level: ${product.minStockLevel} ${product.unit}`,
      );
    }

    if (extraction.intent === CONVERSATION_INTENTS.ADD_PRODUCT) {
      let product;
      try {
        product = await subscriptionService.withBusinessLimitLock(
          `prod:${business._id}`,
          async () => {
            await subscriptionService.checkProductLimit(business._id);
            return inventoryService.createOrUpdateProduct({
              businessId: business._id,
              name: inv.productName,
              unit: inv.unit || 'pcs',
              minStockLevel: inv.minStockLevel || 0,
              costPrice: inv.unitCost || 0,
              sellingPrice: inv.sellingPrice || 0,
              initialStock: inv.quantity || 0,
              createdBy: user._id,
            });
          },
        );
      } catch (limitErr) {
        if (limitErr?.code === 'PLAN_LIMIT_EXCEEDED') {
          return whatsappService.sendTextMessage(
            session.whatsappNumber,
            `⚠️ ${limitErr.message}`,
          );
        }
        throw limitErr;
      }
      session.currentIntent = 'IDLE';
      session.pendingTransaction = null;
      await session.save();
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        `✅ Product saved: *${product.name}* (${product.currentStock} ${product.unit})`,
      );
    }

    if (extraction.intent === CONVERSATION_INTENTS.STOCK_ADJUSTMENT) {
      // Require confirmation for potentially destructive stock adjustments
      const product = await Product.findOne({
        businessId: business._id,
        normalizedName: String(inv.productName || '').trim().toLowerCase(),
        status: 'ACTIVE',
      });

      if (!product) {
        return whatsappService.sendTextMessage(
          session.whatsappNumber,
          `Product "${inv.productName}" not found in inventory.`,
        );
      }

      session.pendingConfirmation = {
        type: 'STOCK_ADJUSTMENT',
        productId: product._id,
        productName: product.name,
        previousStock: product.currentStock,
        newStockCount: inv.newStockCount,
        unit: product.unit,
        reason: inv.reason || 'WhatsApp stock adjustment',
      };
      session.currentIntent = 'CONFIRM_STOCK_ADJUSTMENT';
      await session.save();

      const confirmText =
        `⚠️ *Confirm Stock Adjustment*\n\n` +
        `Product: *${product.name}*\n` +
        `Current Stock: ${product.currentStock} ${product.unit}\n` +
        `New Stock: *${inv.newStockCount} ${product.unit}*\n\n` +
        `Reply "Confirm" to apply or "Cancel" to abort.`;

      try {
        return await whatsappService.sendButtonMessage(session.whatsappNumber, confirmText, [
          { id: 'confirm_stock_adjustment', title: '✅ Confirm' },
          { id: 'cancel_transaction', title: '❌ Cancel' },
        ]);
      } catch {
        return whatsappService.sendTextMessage(session.whatsappNumber, confirmText);
      }
    }

    if (extraction.intent === CONVERSATION_INTENTS.RECORD_WASTAGE) {
      try {
        const res = await inventoryService.recordWastageOrDamage({
          businessId: business._id,
          productName: inv.productName,
          quantity: inv.quantity,
          type: 'WASTAGE',
          reason: inv.reason || 'Recorded via WhatsApp',
          createdBy: user._id,
        });
        session.currentIntent = 'IDLE';
        session.pendingTransaction = null;
        await session.save();
        return whatsappService.sendTextMessage(
          session.whatsappNumber,
          `🗑️ *Wastage Recorded*\n\nProduct: *${res.product.name}*\nWasted: ${inv.quantity} ${res.product.unit}\nRemaining Stock: *${res.product.currentStock} ${res.product.unit}*`,
        );
      } catch (err) {
        return whatsappService.sendTextMessage(
          session.whatsappNumber,
          `Could not record wastage: ${err.message}`,
        );
      }
    }

    // STOCK_IN or STOCK_OUT
    const movementType = extraction.intent === CONVERSATION_INTENTS.STOCK_IN ? 'STOCK_IN' : 'STOCK_OUT';
    try {
      const res = await inventoryService.recordStockMovement({
        businessId: business._id,
        productName: inv.productName,
        type: movementType,
        quantity: inv.quantity,
        unit: inv.unit || 'pcs',
        reason: inv.reason || `WhatsApp ${movementType}`,
        createdBy: user._id,
      });
      session.currentIntent = 'IDLE';
      session.pendingTransaction = null;
      await session.save();

      const label = movementType === 'STOCK_IN' ? 'Stock Added' : 'Stock Deducted';
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        `📦 *${label}*\n\nProduct: *${res.product.name}*\nQuantity: ${inv.quantity} ${res.product.unit}\nCurrent Stock: *${res.product.currentStock} ${res.product.unit}*`,
      );
    } catch (err) {
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        `Could not update stock: ${err.message}`,
      );
    }
  }

  /**
   * Execute confirmed Stock Adjustment
   */
  async confirmStockAdjustment(session, user, business, responseStyle) {
    const pending = session.pendingConfirmation;
    if (!pending || pending.type !== 'STOCK_ADJUSTMENT') {
      return whatsappService.sendTextMessage(session.whatsappNumber, 'No pending adjustment to confirm.');
    }

    const res = await inventoryService.adjustStock({
      businessId: business._id,
      productId: pending.productId,
      newStockCount: pending.newStockCount,
      reason: pending.reason,
      createdBy: user._id,
    });

    session.pendingConfirmation = null;
    session.currentIntent = 'IDLE';
    await session.save();

    return whatsappService.sendTextMessage(
      session.whatsappNumber,
      `✅ *Stock Adjusted*\n\nProduct: *${res.product.name}*\nUpdated Stock: *${res.product.currentStock} ${res.product.unit}*`,
    );
  }

  /**
   * Route Customer Receivable Intents (ADD_CREDIT_SALE, RECORD_CUSTOMER_PAYMENT, VIEW_CUSTOMER_BALANCE)
   */
  async handleCustomerIntent(session, user, business, extraction, responseStyle) {
    if (extraction.intent === CONVERSATION_INTENTS.ADD_CREDIT_SALE) {
      const res = await transactionService.recordSale({
        businessId: business._id,
        amount: extraction.amount,
        paymentMethod: 'CREDIT',
        customerName: extraction.customerName,
        description: extraction.description,
        source: 'TEXT',
        createdBy: user._id,
      });

      session.lastReferencedTransactionId = res.transaction._id;
      session.pendingTransaction = null;
      session.currentIntent = 'IDLE';
      await session.save();

      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        `🧾 *Credit Sale Recorded*\n\nCustomer: *${res.customer.name}*\nAmount: *${this.formatCurrency(res.transaction.amount)}*\nOutstanding Receivable: *${this.formatCurrency(res.customer.outstandingBalance)}*`,
      );
    }

    if (extraction.intent === CONVERSATION_INTENTS.RECORD_CUSTOMER_PAYMENT) {
      const res = await customerService.recordCustomerPayment({
        businessId: business._id,
        customerName: extraction.customerName,
        amount: extraction.amount,
        paymentMethod: extraction.paymentMethod || 'CASH',
        createdBy: user._id,
      });

      session.lastReferencedTransactionId = res.transaction._id;
      session.pendingTransaction = null;
      session.currentIntent = 'IDLE';
      await session.save();

      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        `💵 *Customer Payment Received*\n\nCustomer: *${res.customer.name}*\nReceived: *${this.formatCurrency(res.transaction.amount)}* (${res.transaction.paymentMethod})\nRemaining Balance: *${this.formatCurrency(res.customer.outstandingBalance)}*`,
      );
    }

    // VIEW_CUSTOMER_BALANCE
    if (extraction.customerName) {
      const customers = await customerService.listCustomers(business._id, {
        search: extraction.customerName,
      });
      if (customers.length === 0) {
        return whatsappService.sendTextMessage(
          session.whatsappNumber,
          `Customer "${extraction.customerName}" not found.`,
        );
      }
      const c = customers[0];
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        `👤 *Customer Balance*\n\nName: *${c.name}*\nOutstanding Balance: *${this.formatCurrency(c.outstandingBalance)}*`,
      );
    }

    const all = await customerService.getCustomersWithBalances(business._id);
    if (all.length === 0) {
      return whatsappService.sendTextMessage(session.whatsappNumber, 'No customer balances found.');
    }
    const lines = all.map((c) => `• *${c.name}*: ${this.formatCurrency(c.outstandingBalance)}`).join('\n');
    return whatsappService.sendTextMessage(
      session.whatsappNumber,
      `👥 *Customer Receivable Balances*\n\n${lines}`,
    );
  }

  shouldRequireTextConfirmation() {
    if (process.env.NODE_ENV === 'test') {
      return process.env.REQUIRE_WHATSAPP_CONFIRMATION === 'true';
    }
    return process.env.REQUIRE_WHATSAPP_CONFIRMATION !== 'false';
  }

  isWriteConfirmationIntent(intent) {
    return [
      CONVERSATION_INTENTS.ADD_SALE,
      CONVERSATION_INTENTS.ADD_EXPENSE,
      CONVERSATION_INTENTS.ADD_PURCHASE,
      CONVERSATION_INTENTS.RECORD_PAYMENT,
      CONVERSATION_INTENTS.ADD_CREDIT_SALE,
      CONVERSATION_INTENTS.RECORD_CUSTOMER_PAYMENT,
      CONVERSATION_INTENTS.ADD_PRODUCT,
      CONVERSATION_INTENTS.STOCK_IN,
      CONVERSATION_INTENTS.STOCK_OUT,
      CONVERSATION_INTENTS.RECORD_WASTAGE,
      CONVERSATION_INTENTS.DELETE_TRANSACTION,
      CONVERSATION_INTENTS.EDIT_TRANSACTION,
    ].includes(intent);
  }

  formatTextConfirmationPrompt(extraction, rawText, responseStyle = 'en') {
    const intentLabels = {
      [CONVERSATION_INTENTS.ADD_SALE]: responseStyle === 'ml' ? 'വിൽപ്പന (Sale)' : 'Sale',
      [CONVERSATION_INTENTS.ADD_EXPENSE]: responseStyle === 'ml' ? 'ചിലവ് (Expense)' : 'Expense',
      [CONVERSATION_INTENTS.ADD_PURCHASE]: responseStyle === 'ml' ? 'സപ്ലയർ പർച്ചേസ്' : 'Supplier Purchase',
      [CONVERSATION_INTENTS.RECORD_PAYMENT]: responseStyle === 'ml' ? 'സപ്ലയർ പേയ്‌മെന്റ്' : 'Supplier Payment',
      [CONVERSATION_INTENTS.ADD_CREDIT_SALE]: responseStyle === 'ml' ? 'ക്രെഡിറ്റ് വിൽപ്പന' : 'Credit Sale',
      [CONVERSATION_INTENTS.RECORD_CUSTOMER_PAYMENT]: responseStyle === 'ml' ? 'കസ്റ്റമർ പേയ്‌മെന്റ്' : 'Customer Payment',
      [CONVERSATION_INTENTS.ADD_PRODUCT]: responseStyle === 'ml' ? 'പുതിയ ഉൽപ്പന്നം' : 'Add Product',
      [CONVERSATION_INTENTS.STOCK_IN]: responseStyle === 'ml' ? 'സ്റ്റോക്ക് ചേർക്കൽ' : 'Stock In',
      [CONVERSATION_INTENTS.STOCK_OUT]: responseStyle === 'ml' ? 'സ്റ്റോക്ക് കുറയ്ക്കൽ' : 'Stock Out',
      [CONVERSATION_INTENTS.RECORD_WASTAGE]: responseStyle === 'ml' ? 'വേസ്റ്റേജ്' : 'Record Wastage',
      [CONVERSATION_INTENTS.DELETE_TRANSACTION]: responseStyle === 'ml' ? 'അവസാന എൻട്രി നീക്കം ചെയ്യൽ' : 'Delete Last Entry',
      [CONVERSATION_INTENTS.EDIT_TRANSACTION]: responseStyle === 'ml' ? 'അവസാന എൻട്രി തിരുത്തൽ' : 'Edit Last Entry',
    };

    const lines = [
      responseStyle === 'ml' ? '📝 *ദയവായി സ്ഥിരീകരിക്കുക:*' : '📝 *Please confirm this entry:*',
      '',
    ];

    if (rawText) {
      lines.push(responseStyle === 'ml' ? `നിങ്ങൾ അയച്ചത്: "${rawText}"` : `You typed: "${rawText}"`);
    }

    lines.push(
      responseStyle === 'ml'
        ? `ഇനം: *${intentLabels[extraction.intent] || extraction.intent}*`
        : `Action: *${intentLabels[extraction.intent] || extraction.intent}*`,
    );

    if (extraction.amount !== null && extraction.amount !== undefined) {
      lines.push(
        responseStyle === 'ml'
          ? `തുക: *${this.formatCurrency(extraction.amount)}*`
          : `Amount: *${this.formatCurrency(extraction.amount)}*`,
      );
    }
    if (extraction.category) {
      lines.push(`Category: ${extraction.category}`);
    }
    if (extraction.paymentMethod) {
      lines.push(`Payment: ${extraction.paymentMethod}`);
    }
    if (extraction.merchantOrSupplier) {
      lines.push(`Supplier: ${extraction.merchantOrSupplier}`);
    }
    if (extraction.customerName) {
      lines.push(`Customer: ${extraction.customerName}`);
    }
    if (extraction.inventoryAction?.productName) {
      const inv = extraction.inventoryAction;
      const qtyPart = inv.quantity ? ` (${inv.quantity} ${inv.unit || 'units'})` : '';
      lines.push(`Product: *${inv.productName}*${qtyPart}`);
    }

    lines.push('');
    lines.push(responseStyle === 'ml' ? 'ഇത് സേവ് ചെയ്യണോ?' : 'Is this correct? Should I save it?');
    return lines.join('\n');
  }

  async promptTextActionConfirmation(session, extraction, rawText, responseStyle = 'en') {
    session.pendingConfirmation = {
      type: 'TEXT_ACTION',
      extraction,
      rawText,
    };
    session.currentIntent = 'CONFIRM_TEXT_ACTION';
    await session.save();

    const promptBody = this.formatTextConfirmationPrompt(extraction, rawText, responseStyle);
    const buttons = [
      { id: 'confirm_text_action', title: responseStyle === 'ml' ? '✅ ശരി' : '✅ Confirm' },
      { id: 'cancel_text_action', title: responseStyle === 'ml' ? '❌ വേണ്ട' : '❌ Cancel' },
    ];

    try {
      return await whatsappService.sendButtonMessage(session.whatsappNumber, promptBody, buttons);
    } catch {
      const fallbackSuffix =
        responseStyle === 'ml'
          ? '\n\n("Confirm" അല്ലെങ്കിൽ "Cancel" എന്ന് മറുപടി അയക്കുക)'
          : '\n\n(Reply "Confirm" or "Cancel")';
      return whatsappService.sendTextMessage(session.whatsappNumber, `${promptBody}${fallbackSuffix}`);
    }
  }

  async confirmPendingTextAction(session, user, business, responseStyle, authContext = null) {
    const pending = session.pendingConfirmation;
    if (!pending || pending.type !== 'TEXT_ACTION' || !pending.extraction) {
      session.pendingConfirmation = null;
      session.currentIntent = 'IDLE';
      await session.save();
      return whatsappService.sendTextMessage(session.whatsappNumber, 'No pending entry to confirm.');
    }

    const extraction = pending.extraction;
    const requiredPermission = this.getRequiredPermissionForIntent(extraction.intent);
    if (requiredPermission && authContext && !this.hasPermission(authContext, requiredPermission)) {
      session.pendingConfirmation = null;
      session.currentIntent = 'IDLE';
      await session.save();
      return whatsappService.sendTextMessage(
        session.whatsappNumber,
        `⛔ Authorization denied: You do not have permission (${requiredPermission}) to perform this action.`,
      );
    }

    session.pendingConfirmation = null;
    session.currentIntent = 'IDLE';
    await session.save();

    return this.executeExtractedIntent(session, user, business, extraction, responseStyle);
  }

  getGreetingMessage(businessName, style = 'en') {
    if (style === 'ml') {
      return (
        `നമസ്കാരം! 🙏 *${businessName}* അക്കൗണ്ട് അസിസ്റ്റന്റിലേക്ക് സ്വാഗതം.\n\n` +
        `നിങ്ങൾക്ക് ദിവസേനയുള്ള വിൽപ്പനയോ ചിലവുകളോ സാധാരണ മലയാളത്തിലോ മംഗ്ലീഷിലോ ഇംഗ്ലീഷിലോ അയക്കാവുന്നതാണ്.\n\n` +
        `ഉദാഹരണങ്ങൾ:\n` +
        `• "ഇന്ന് മൊത്തം വിൽപ്പന 12500, കാഷ് 7500, UPI 5000"\n` +
        `• "ഇന്ന് 850 രൂപ പച്ചക്കറി വാങ്ങി"\n` +
        `• "ഇന്നത്തെ കണക്ക്"\n` +
        `• ഗൂഗിൾ പേ സ്ക്രീൻഷോട്ടുകളോ വോയിസ് നോട്ടുകളോ അയക്കാം.`
      );
    }
    return (
      `Namaskaram! 🙏 Welcome to *${businessName}* Financial Assistant.\n\n` +
      `You can record daily sales and expenses in Malayalam, Manglish, or English.\n\n` +
      `Examples:\n` +
      `• "Today's sales 12500. Cash 7500 and UPI 5000."\n` +
      `• "Innu vegetables vangiyathu 850 rupa."\n` +
      `• "Today's report"\n` +
      `• Send GPay/PhonePe screenshots or WhatsApp voice notes.`
    );
  }

  getHelpMessage(style = 'en') {
    if (style === 'ml') {
      return (
        `📖 *സഹായം - നിർദ്ദേശങ്ങൾ*\n\n` +
        `1. *വിൽപ്പന രേഖപ്പെടുത്താൻ:*\n` +
        `"ഇന്ന് വിൽപ്പന 8000" അല്ലെങ്കിൽ "Ravile sales 3500"\n\n` +
        `2. *ചിലവ് രേഖപ്പെടുത്താൻ:*\n` +
        `"മീൻ വാങ്ങി 1200" അല്ലെങ്കിൽ "Gas cylinder 950 cash"\n\n` +
        `3. *സപ്ലയർ ഇടപാടുകൾ:*\n` +
        `"Majeed കടയിൽ നിന്ന് 4000 രൂപ ഇറച്ചി വാങ്ങി പറ്റ്"\n` +
        `"Majeed inu 2000 koduthu UPI"\n\n` +
        `4. *റിപ്പോർട്ടുകൾ കാണാൻ:*\n` +
        `"ഇന്നത്തെ കണക്ക്" അല്ലെങ്കിൽ "Monthly report"\n\n` +
        `5. *മാറ്റങ്ങൾ വരുത്താൻ:*\n` +
        `"അവസാന എൻട്രി മാറ്റുക 950 ലേക്ക്" അല്ലെങ്കിൽ "Delete last"`
      );
    }
    return (
      `📖 *Help & Commands*\n\n` +
      `1. *Record Sales:*\n` +
      `"Today's sales 12500. Cash 7500 and UPI 5000"\n\n` +
      `2. *Record Expenses:*\n` +
      `"Innu vegetables vangiyathu 850 rupa"\n\n` +
      `3. *Supplier Purchases & Payments:*\n` +
      `"Bought meat from Majeed on credit 4500"\n` +
      `"Paid 2000 to supplier Majeed via UPI"\n\n` +
      `4. *Reports & Balances:*\n` +
      `"Today's report", "Monthly report", "Supplier balance"\n\n` +
      `5. *Screenshots & Voice:*\n` +
      `Simply send GPay/PhonePe screenshots or audio voice notes!`
    );
  }
}

export const conversationService = new ConversationService();
