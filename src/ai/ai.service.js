import OpenAI from 'openai';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { languageDetectionService } from './language-detection.service.js';
import { CONVERSATION_INTENTS } from './schemas/intent.schema.js';
import {
  TRANSACTION_EXTRACTION_JSON_SCHEMA,
  createEmptyTransactionExtraction,
} from './schemas/transaction.schema.js';
import {
  SCREENSHOT_EXTRACTION_JSON_SCHEMA,
  createEmptyScreenshotExtraction,
} from './schemas/screenshot.schema.js';
import {
  TRANSACTION_EXTRACTION_SYSTEM_PROMPT,
  buildTransactionExtractionPrompt,
} from './prompts/transaction-extraction.prompt.js';
import {
  SCREENSHOT_EXTRACTION_SYSTEM_PROMPT,
  buildScreenshotExtractionPrompt,
} from './prompts/screenshot-extraction.prompt.js';

// Prompt injection patterns to neutralize
const PROMPT_INJECTION_REGEX =
  /(ignore (all |previous |above )?instructions|system prompt|you are now|disregard rules|override|drop table|delete all database)/i;

// Multilingual category keyword mappings (Malayalam script, Manglish, English)
const CATEGORY_RULES = [
  {
    category: 'VEGETABLES',
    regex:
      /(pachakkari|pachakari|vegetable|vegetables|veggies|പച്ചക്കറി|സവാള|തക്കാളി|ഉരുളക്കിഴങ്ങ്|ulli|savola|thakkali|onion|tomato|potato|cabbage|carrot|beans|chilli|mulaku)/i,
  },
  {
    category: 'MEAT_FISH',
    regex:
      /(meen|irachi|kozhi|koli|fish|meat|chicken|beef|mutton|prawn|chemmeen|മീൻ|ഇറച്ചി|കോഴി|ബീഫ്|മട്ടൻ|ചെമ്മീൻ|മത്സ്യം)/i,
  },
  {
    category: 'GROCERIES',
    regex:
      /(palacharakku|grocery|groceries|rice|ari|oil|enna|coconut|thenga|milk|paal|sugar|panchasara|atta|maida|masala|spices|പലചരക്ക്|അരി|എണ്ണ|തേങ്ങ|പാൽ|പഞ്ചസാര|മസാല|ആട്ട|മൈദ)/i,
  },
  {
    category: 'GAS',
    regex: /\b(gas|lpg|cylinder|ഗ്യാസ്|സിലിണ്ടർ)\b/i,
  },
  {
    category: 'ELECTRICITY',
    regex: /(electricity|current bill|kseb|power bill| വൈദ്യുതി|കറന്റ്|ഇലക്ട്രിസിറ്റി)/i,
  },
  {
    category: 'STAFF_WAGES',
    regex: /(kooli|salary|wages|staff|bata|shambalam|കൂലി|ശമ്പളം|സ്റ്റാഫ്|ജോലിക്കാർ)/i,
  },
  {
    category: 'RENT',
    regex: /\b(vadaka|rent|shop rent|വാടക|കട വാടക)\b/i,
  },
  {
    category: 'MAINTENANCE',
    regex: /(maintenance|repair|plumbing|service|cleaning|അറ്റകുറ്റപ്പണി|റിപ്പയർ)/i,
  },
  {
    category: 'TRANSPORTATION',
    regex: /(transport|transportation|auto|tempo|delivery|petrol|diesel|vandi|വണ്ടി|ഓട്ടോ|പെട്രോൾ|ഡീസൽ)/i,
  },
];

class AIService {
  constructor() {
    this._client = null;
  }

  isConfigured() {
    return Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'test_openai_key');
  }

  getClient() {
    if (!this._client && this.isConfigured()) {
      this._client = new OpenAI({
        apiKey: env.OPENAI_API_KEY,
        timeout: 20000,
        maxRetries: 1,
      });
    }
    return this._client;
  }

  /**
   * Generic structured extraction using OpenAI JSON Schema
   */
  async extractWithSchema({ systemPrompt, userPrompt, jsonSchema, fallbackFn }) {
    if (!this.isConfigured() || env.NODE_ENV === 'test') {
      return fallbackFn();
    }

    try {
      const client = this.getClient();
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: jsonSchema,
        },
        temperature: 0.1,
      });

      const raw = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (err) {
      logger.error({ err: err.message }, 'OpenAI structured extraction failed; using deterministic fallback');
      return fallbackFn();
    }
  }

  /**
   * Extract structured financial transaction or intent from text (Malayalam, Manglish, English, Mixed)
   */
  async extractTransactionData({ message, sessionContext = {}, businessConfig = null }) {
    const startTime = Date.now();
    const cleanMessage = String(message || '').trim();
    const detectedLanguage = languageDetectionService.detectLanguage(cleanMessage);

    // Check for prompt injection
    if (PROMPT_INJECTION_REGEX.test(cleanMessage)) {
      logger.warn({ message: cleanMessage }, 'Potential prompt injection neutralized');
      const safeResult = createEmptyTransactionExtraction(detectedLanguage);
      safeResult.intent = CONVERSATION_INTENTS.UNKNOWN;
      safeResult.needsClarification = true;
      safeResult.clarificationQuestion =
        'Please send a valid business sale, expense, inventory, or report message.';
      return safeResult;
    }

    const result = await this.extractWithSchema({
      systemPrompt: TRANSACTION_EXTRACTION_SYSTEM_PROMPT,
      userPrompt: buildTransactionExtractionPrompt({
        message: cleanMessage,
        sessionContext,
        businessConfig,
      }),
      jsonSchema: TRANSACTION_EXTRACTION_JSON_SCHEMA,
      fallbackFn: () =>
        this.localMultilingualTransactionExtractor(
          cleanMessage,
          detectedLanguage,
          sessionContext,
          businessConfig,
        ),
    });

    const sanitized = this.sanitizeTransactionExtraction(result, detectedLanguage);
    logger.info(
      {
        durationMs: Date.now() - startTime,
        intent: sanitized.intent,
        type: sanitized.transactionType,
        amount: sanitized.amount,
        language: sanitized.detectedLanguage,
      },
      'Completed financial text extraction',
    );
    return sanitized;
  }

  /**
   * Extract transaction details from payment screenshot buffer
   */
  async extractScreenshotData({ imageBuffer, mimeType = 'image/jpeg', caption = '', mockData = null }) {
    const cleanCaption = String(caption || '').trim();
    const detectedLanguage = languageDetectionService.detectLanguage(cleanCaption);

    if (mockData) {
      return this.sanitizeScreenshotExtraction({
        ...createEmptyScreenshotExtraction(),
        ...mockData,
        detectedLanguage: mockData.detectedLanguage || detectedLanguage,
      });
    }

    if (!this.isConfigured() || env.NODE_ENV === 'test') {
      return this.localScreenshotExtractor(cleanCaption, imageBuffer, detectedLanguage);
    }

    try {
      const client = this.getClient();
      const base64Image = imageBuffer.toString('base64');
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SCREENSHOT_EXTRACTION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: buildScreenshotExtractionPrompt(cleanCaption) },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Image}` },
              },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: SCREENSHOT_EXTRACTION_JSON_SCHEMA,
        },
        temperature: 0.1,
      });

      const raw = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw);
      return this.sanitizeScreenshotExtraction(parsed);
    } catch (err) {
      logger.error({ err: err.message }, 'OpenAI vision extraction failed; using fallback screenshot parser');
      return this.localScreenshotExtractor(cleanCaption, imageBuffer, detectedLanguage);
    }
  }

  /**
   * Transcribe voice note buffer (Malayalam, Manglish, English, Mixed)
   */
  async transcribeVoice({ audioBuffer, mimeType = 'audio/ogg', mockTranscript = null }) {
    if (mockTranscript !== null && mockTranscript !== undefined) {
      return {
        transcript: String(mockTranscript).trim(),
        provider: 'mock',
      };
    }

    // Check if audioBuffer actually contains UTF-8 text transcript (used in simulation/testing)
    if (!this.isConfigured() || env.NODE_ENV === 'test') {
      const asText = audioBuffer ? audioBuffer.toString('utf8').trim() : '';
      const isPrintableText = asText.length > 0 && !/[\x00-\x08\x0E-\x1F]/.test(asText.slice(0, 50));
      return {
        transcript: isPrintableText ? asText : 'Innu 500 rupa pachakkari vangichu',
        provider: 'local_fallback',
      };
    }

    try {
      const client = this.getClient();
      const file = new File([audioBuffer], 'voice.ogg', { type: mimeType });
      const transcription = await client.audio.transcriptions.create({
        file,
        model: 'whisper-1',
      });
      return {
        transcript: (transcription.text || '').trim(),
        provider: 'openai_whisper',
      };
    } catch (err) {
      logger.error({ err: err.message }, 'Voice transcription failed');
      throw new Error('VOICE_TRANSCRIPTION_FAILED');
    }
  }

  /**
   * Sanitize and normalize AI transaction extraction output
   */
  sanitizeTransactionExtraction(data, fallbackLanguage = 'en') {
    const base = createEmptyTransactionExtraction(fallbackLanguage);
    if (!data || typeof data !== 'object') return base;

    const breakdown = {
      cash: typeof data.paymentBreakdown?.cash === 'number' ? data.paymentBreakdown.cash : null,
      upi: typeof data.paymentBreakdown?.upi === 'number' ? data.paymentBreakdown.upi : null,
      card: typeof data.paymentBreakdown?.card === 'number' ? data.paymentBreakdown.card : null,
      bankTransfer:
        typeof data.paymentBreakdown?.bankTransfer === 'number' ? data.paymentBreakdown.bankTransfer : null,
      credit: typeof data.paymentBreakdown?.credit === 'number' ? data.paymentBreakdown.credit : null,
    };

    let amount = typeof data.amount === 'number' && !Number.isNaN(data.amount) ? data.amount : null;
    const sumBreakdown =
      (breakdown.cash || 0) +
      (breakdown.upi || 0) +
      (breakdown.card || 0) +
      (breakdown.bankTransfer || 0) +
      (breakdown.credit || 0);

    // Prevent double-counting: if breakdown exists and no explicit total was given, total = sum of breakdown
    if (amount === null && sumBreakdown > 0) {
      amount = sumBreakdown;
    }

    return {
      ...base,
      ...data,
      detectedLanguage: data.detectedLanguage || fallbackLanguage,
      amount,
      paymentBreakdown: breakdown,
      items: Array.isArray(data.items) ? data.items : [],
      inventoryAction: {
        ...base.inventoryAction,
        ...(data.inventoryAction || {}),
      },
      reportQuery: {
        ...base.reportQuery,
        ...(data.reportQuery || {}),
      },
      editAction: {
        ...base.editAction,
        ...(data.editAction || {}),
      },
      missingInformation: Array.isArray(data.missingInformation) ? data.missingInformation : [],
      needsClarification: Boolean(data.needsClarification),
    };
  }

  /**
   * Sanitize screenshot extraction output
   */
  sanitizeScreenshotExtraction(data) {
    const base = createEmptyScreenshotExtraction();
    if (!data || typeof data !== 'object') return base;
    return {
      ...base,
      ...data,
      amount: typeof data.amount === 'number' ? data.amount : null,
      needsConfirmation: data.needsConfirmation !== undefined ? Boolean(data.needsConfirmation) : true,
    };
  }

  /**
   * Deterministic Multilingual Natural Language Extractor
   * Handles Malayalam script, Manglish, English, and Mixed code-switching accurately
   */
  localMultilingualTransactionExtractor(
    text,
    detectedLanguage = 'en',
    sessionContext = {},
    businessConfig = null,
  ) {
    const res = createEmptyTransactionExtraction(detectedLanguage);
    const clean = text.trim();
    const lower = clean.toLowerCase();
    const numbers = this.extractNumbers(clean);

    if (!clean) return res;

    // 1. Check Confirmation / Cancellation Intents
    if (
      /^(yes|confirm|ok|okay|save|correct|sheri|sheriya|athe|ഉവ്വ്|അതെ|ശരി|സേവ്)$/i.test(clean) ||
      /^confirm_/i.test(clean)
    ) {
      res.intent = CONVERSATION_INTENTS.CONFIRM;
      res.confidence = 0.99;
      return res;
    }

    if (
      /^(no|cancel|discard|stop|venda|വേണ്ട|റദ്ദാക്കുക|അല്ല)$/i.test(clean) ||
      /^cancel_/i.test(clean)
    ) {
      res.intent = CONVERSATION_INTENTS.CANCEL;
      res.confidence = 0.99;
      return res;
    }

    // 2. Check Greeting / Help
    if (/^(hi|hello|hey|namaskaram|start|നമസ്കാരം|ഹായ്|ഹലോ)$/i.test(clean)) {
      res.intent = CONVERSATION_INTENTS.GREETING;
      res.confidence = 0.98;
      return res;
    }

    if (/^(help|menu|commands|സഹായം|എന്തൊക്കെ ചെയ്യാം)$/i.test(clean)) {
      res.intent = CONVERSATION_INTENTS.HELP;
      res.confidence = 0.98;
      return res;
    }

    // 3. Check Delete / Void Transaction Intent
    if (
      /(delete|void|remove|cancel last|kalayu|maachu|ഒഴിവാക്കുക|ഡിലീറ്റ്|റദ്ദാക്കു)/i.test(clean) &&
      !/(report|balance)/i.test(clean)
    ) {
      res.intent = CONVERSATION_INTENTS.DELETE_TRANSACTION;
      res.confidence = 0.92;
      res.description = clean;
      return res;
    }

    // 4. Check Edit / Correction Intent
    // e.g., "Change amount to 950", "Edit last expense to 950", "850 alla 950 aanu", "Update last transaction to 1200"
    const allaMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:alla|അല്ല|not)\s*(\d+(?:\.\d+)?)/i);
    if (allaMatch || /\b(edit|change|update|correct|maattu|തിരുത്തുക|മാറ്റുക)\b/i.test(clean)) {
      res.intent = CONVERSATION_INTENTS.EDIT_TRANSACTION;
      res.confidence = 0.9;
      if (allaMatch) {
        res.editAction.field = 'amount';
        res.editAction.newAmount = parseFloat(allaMatch[2]);
        res.amount = res.editAction.newAmount;
      } else {
        const nums = this.extractNumbers(clean);
        if (nums.length > 0) {
          res.editAction.field = 'amount';
          res.editAction.newAmount = nums[nums.length - 1];
          res.amount = res.editAction.newAmount;
        }
      }
      if (/\bupi\b/i.test(clean)) res.editAction.newPaymentMethod = 'UPI';
      else if (/\bcash\b/i.test(clean)) res.editAction.newPaymentMethod = 'CASH';
      res.description = clean;
      return res;
    }

    // 5. Check Report / Query Intents
    // Questions in Malayalam ("എത്രയാണ്", "എത്ര", "റിപ്പോർട്ട്"), Manglish ("ethra", "ethrayanu", "kanakku"), English ("how much", "report", "summary", "total sales?")
    const isQuestionOrReport =
      /(\?|ethra|ethrayanu|എത്രയാണ്|എത്ര|report|summary|റിപ്പോർട്ട്|കണക്ക്|kanakku|show|view|what is|check)/i.test(
        clean,
      );

    // 5a. Low Stock & Inventory Valuation & Inventory Report
    if (
      /(low stock|low-stock|kuravulla stock|stock theeran|കുറവുള്ള സ്റ്റോക്ക്|സ്റ്റോക്ക് കുറവ്)/i.test(clean)
    ) {
      res.intent = CONVERSATION_INTENTS.VIEW_LOW_STOCK;
      res.confidence = 0.95;
      return res;
    }

    if (
      /(inventory valuation|stock value|inventory value|സ്റ്റോക്ക് മൂല്യം|സ്റ്റോക്കിന്റെ വില)/i.test(clean)
    ) {
      res.intent = CONVERSATION_INTENTS.VIEW_INVENTORY_VALUATION;
      res.confidence = 0.95;
      return res;
    }

    if (
      /(inventory report|stock report|stock summary|സ്റ്റോക്ക് റിപ്പോർട്ട്|ഇൻവെന്ററി റിപ്പോർട്ട്)/i.test(clean)
    ) {
      res.intent = CONVERSATION_INTENTS.VIEW_INVENTORY_REPORT;
      res.reportQuery.metric = 'INVENTORY';
      res.confidence = 0.95;
      return res;
    }

    // 5b. Cash Flow, Receivables, Payables, Weekly Reports
    if (/(cash flow|cashflow|ക്യാഷ് ഫ്ലോ)/i.test(clean)) {
      res.intent = CONVERSATION_INTENTS.VIEW_CASH_FLOW;
      res.reportQuery.metric = 'CASH_FLOW';
      res.confidence = 0.95;
      return res;
    }

    if (/(receivable|receivables|kittanullathu|കിട്ടാനുള്ളത്|കസ്റ്റമർ ബാക്കി)/i.test(clean)) {
      res.intent = CONVERSATION_INTENTS.VIEW_RECEIVABLES;
      res.reportQuery.metric = 'RECEIVABLES';
      res.confidence = 0.95;
      return res;
    }

    if (/(payable|payables|kodukkanullathu|കൊടുക്കാനുള്ളത്|സപ്ലയർ ബാക്കി)/i.test(clean)) {
      res.intent = CONVERSATION_INTENTS.VIEW_PAYABLES;
      res.reportQuery.metric = 'PAYABLES';
      res.confidence = 0.95;
      return res;
    }

    if (/(weekly report|this week|week report|ആഴ്ചത്തെ റിപ്പോർട്ട്|ആഴ്ച കണക്ക്|ee azhcha)/i.test(clean)) {
      res.intent = CONVERSATION_INTENTS.VIEW_WEEKLY_REPORT;
      res.reportQuery.period = 'WEEKLY';
      res.reportQuery.metric = 'ALL';
      res.confidence = 0.95;
      return res;
    }

    // 5c. Check Stock for a specific product (e.g., "Sugar stock ethra und?", "Check stock Rice", "പഞ്ചസാര സ്റ്റോക്ക് എത്രയുണ്ട്?")
    if (
      /(stock|സ്റ്റോക്ക്)/i.test(clean) &&
      isQuestionOrReport &&
      !/(vannu|received|added|in|out|adjust|waste|wasted|damaged|വന്നു|നശിച്ചു|കുറവ്|മൂല്യം|റിപ്പോർട്ട്)/i.test(clean)
    ) {
      res.intent = CONVERSATION_INTENTS.CHECK_STOCK;
      const inv = this.extractInventoryDetails(clean);
      res.inventoryAction.productName = inv.productName;
      if (!inv.productName) {
        res.needsClarification = true;
        res.missingInformation = ['productName'];
        res.clarificationQuestion = this.getLocalizedClarification('MISSING_PRODUCT', detectedLanguage);
        res.confidence = 0.55;
      } else {
        res.confidence = 0.92;
      }
      return res;
    }

    // 5d. Customer Balance Check (must check before generic supplier balance if "customer" is mentioned)
    if (/(customer balance|customer.*balance|കസ്റ്റമർ ബാക്കി)/i.test(clean)) {
      res.intent = CONVERSATION_INTENTS.VIEW_CUSTOMER_BALANCE;
      res.customerName = this.extractCustomerName(clean);
      res.confidence = 0.92;
      return res;
    }

    // 5e. Supplier balance check
    if (
      /(supplier balance|baki ethra|baaki ethra|balance of|kadam ethra|ബാക്കി എത്ര|സപ്ലയർ ബാലൻസ്|outstanding)/i.test(
        clean,
      ) ||
      (isQuestionOrReport && /(supplier|baki|baaki|kadam|ബാക്കി|കടം)/i.test(clean))
    ) {
      res.intent = CONVERSATION_INTENTS.VIEW_SUPPLIER_BALANCE;
      res.merchantOrSupplier = this.extractSupplierName(clean);
      res.confidence = 0.92;
      return res;
    }

    // 5f. Monthly report check
    if (
      /(monthly report|this month|month report|മാസത്തെ കണക്ക്|മാസ റിപ്പോർട്ട്|masathe kanakku|monthly sales|monthly expense)/i.test(
        clean,
      )
    ) {
      res.intent = CONVERSATION_INTENTS.VIEW_MONTHLY_REPORT;
      res.reportQuery.period = 'MONTHLY';
      res.reportQuery.metric = this.detectReportMetric(clean);
      res.confidence = 0.95;
      return res;
    }

    // 5g. Daily report check (only when no numbers are being recorded, or when clearly asking a question)
    if (
      (isQuestionOrReport && numbers.length === 0) ||
      /^(today'?s? report|daily report|innathe report|innathe kanakku|ഇന്നത്തെ റിപ്പോർട്ട്|ഇന്നത്തെ കണക്ക്)$/i.test(
        clean,
      )
    ) {
      res.intent = CONVERSATION_INTENTS.VIEW_DAILY_REPORT;
      res.reportQuery.period = 'DAILY';
      res.reportQuery.metric = this.detectReportMetric(clean);
      res.confidence = 0.95;
      return res;
    }

    // 6. Check Date Reference (Today vs Yesterday)
    if (/(yesterday|innale|ഇന്നലെ)/i.test(clean)) {
      res.transactionDate = 'YESTERDAY';
    } else {
      res.transactionDate = 'TODAY';
    }

    // 6b. Inventory Operations (ADD_PRODUCT, RECORD_WASTAGE, STOCK_ADJUSTMENT, STOCK_IN, STOCK_OUT)
    // Wastage / Damage
    if (/(waste|wasted|wastage|spoiled|damaged|damage|nashichu|waste aayi|നശിച്ചു|കേടായി)/i.test(clean)) {
      res.intent = CONVERSATION_INTENTS.RECORD_WASTAGE;
      const inv = this.extractInventoryDetails(clean);
      res.inventoryAction = { ...res.inventoryAction, ...inv, reason: clean };
      if (!inv.productName || !inv.quantity) {
        res.needsClarification = true;
        res.missingInformation = [
          ...(!inv.productName ? ['productName'] : []),
          ...(!inv.quantity ? ['quantity'] : []),
        ];
        res.clarificationQuestion = this.getLocalizedClarification(
          !inv.productName ? 'MISSING_PRODUCT' : 'MISSING_QUANTITY',
          detectedLanguage,
        );
        res.confidence = 0.55;
      } else {
        res.confidence = 0.93;
      }
      return res;
    }

    // Stock Adjustment
    if (/(adjust stock|stock adjust|adjust|reconcile stock|സ്റ്റോക്ക് തിരുത്തുക|തിരുത്തുക)/i.test(clean)) {
      res.intent = CONVERSATION_INTENTS.STOCK_ADJUSTMENT;
      const inv = this.extractInventoryDetails(clean);
      res.inventoryAction = {
        ...res.inventoryAction,
        ...inv,
        newStockCount: inv.quantity,
        reason: clean,
      };
      if (!inv.productName || inv.quantity === null) {
        res.needsClarification = true;
        res.missingInformation = [
          ...(!inv.productName ? ['productName'] : []),
          ...(inv.quantity === null ? ['newStockCount'] : []),
        ];
        res.clarificationQuestion = this.getLocalizedClarification(
          !inv.productName ? 'MISSING_PRODUCT' : 'MISSING_QUANTITY',
          detectedLanguage,
        );
        res.confidence = 0.55;
      } else {
        res.confidence = 0.92;
      }
      return res;
    }

    // Add Product
    if (/(add product|new product|create product|പുതിയ ഉൽപ്പന്നം|പുതിയ പ്രോഡക്റ്റ്)/i.test(clean)) {
      res.intent = CONVERSATION_INTENTS.ADD_PRODUCT;
      const minMatch = clean.match(/(?:min|minimum|alert)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i);
      const priceMatch = clean.match(/(?:price|cost|rate)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i);
      const strippedForProd = clean
        .replace(/(?:min|minimum|alert)\s*[:=-]?\s*\d+(?:\.\d+)?/gi, '')
        .replace(/(?:price|cost|rate)\s*[:=-]?\s*\d+(?:\.\d+)?/gi, '');
      const inv = this.extractInventoryDetails(strippedForProd);
      res.inventoryAction = {
        ...res.inventoryAction,
        ...inv,
        minStockLevel: minMatch ? parseFloat(minMatch[1]) : 0,
        unitCost: priceMatch ? parseFloat(priceMatch[1]) : 0,
      };
      if (!inv.productName) {
        res.needsClarification = true;
        res.missingInformation = ['productName'];
        res.clarificationQuestion = this.getLocalizedClarification('MISSING_PRODUCT', detectedLanguage);
        res.confidence = 0.55;
      } else {
        res.confidence = 0.93;
      }
      return res;
    }

    // Stock In / Stock Out
    const isStockIn = /(stock in|stock vannu|stock received|add stock|restock|സ്റ്റോക്ക് വന്നു|സ്റ്റോക്ക് ചേർക്കുക)/i.test(
      clean,
    );
    const isStockOut = /(stock out|deduct stock|used from stock|sold.*from stock|സ്റ്റോക്ക് കുറച്ചു|സ്റ്റോക്ക് ഔട്ട്)/i.test(
      clean,
    );

    if (isStockIn || isStockOut) {
      res.intent = isStockIn ? CONVERSATION_INTENTS.STOCK_IN : CONVERSATION_INTENTS.STOCK_OUT;
      const inv = this.extractInventoryDetails(clean);
      res.inventoryAction = { ...res.inventoryAction, ...inv, reason: clean };
      if (!inv.productName || !inv.quantity) {
        res.needsClarification = true;
        res.missingInformation = [
          ...(!inv.productName ? ['productName'] : []),
          ...(!inv.quantity ? ['quantity'] : []),
        ];
        res.clarificationQuestion = this.getLocalizedClarification(
          !inv.productName ? 'MISSING_PRODUCT' : 'MISSING_QUANTITY',
          detectedLanguage,
        );
        res.confidence = 0.55;
      } else {
        res.confidence = 0.93;
      }
      return res;
    }

    // 6c. Customer Credit Sales & Customer Payments
    const isCreditSale =
      /(credit sale|sold.*on credit|kadam koduthu|കടം കൊടുത്തു|ക്രെഡിറ്റ് സെയിൽ)/i.test(clean) &&
      !/(supplier|bought|purchase)/i.test(clean);

    if (isCreditSale) {
      res.intent = CONVERSATION_INTENTS.ADD_CREDIT_SALE;
      res.transactionType = 'SALE';
      res.paymentMethod = 'CREDIT';
      res.amount = numbers.length > 0 ? numbers[0] : null;
      res.customerName = this.extractCustomerName(clean);
      res.description = clean;
      if (res.amount === null || !res.customerName) {
        res.needsClarification = true;
        res.missingInformation = [
          ...(res.amount === null ? ['amount'] : []),
          ...(!res.customerName ? ['customerName'] : []),
        ];
        res.clarificationQuestion = this.getLocalizedClarification(
          res.amount === null ? 'MISSING_AMOUNT' : 'MISSING_CUSTOMER',
          detectedLanguage,
        );
        res.confidence = 0.55;
      } else {
        res.confidence = 0.92;
      }
      return res;
    }

    const isCustomerPayment =
      /(customer.*paid|received from|paid by customer|തന്നു|കസ്റ്റമർ.*തന്നു)/i.test(clean) ||
      (/(customer)/i.test(clean) && /(paid|gave|payment|തന്നു)/i.test(clean)) ||
      (/^[A-Z][a-zA-Z0-9\s]{1,20}\s+(?:paid|gave)\s+\d+/i.test(clean) &&
        !/(supplier|rent|gas|electricity|salary|wages)/i.test(clean) &&
        !this.detectExpenseCategory(clean));

    if (isCustomerPayment) {
      res.intent = CONVERSATION_INTENTS.RECORD_CUSTOMER_PAYMENT;
      res.transactionType = 'CUSTOMER_PAYMENT';
      res.paymentMethod = this.detectPaymentMethod(clean);
      if (res.paymentMethod === 'UNKNOWN') res.paymentMethod = 'CASH';
      res.amount = numbers.length > 0 ? numbers[0] : null;
      res.customerName = this.extractCustomerName(clean);
      res.description = clean;
      if (res.amount === null || !res.customerName) {
        res.needsClarification = true;
        res.missingInformation = [
          ...(res.amount === null ? ['amount'] : []),
          ...(!res.customerName ? ['customerName'] : []),
        ];
        res.clarificationQuestion = this.getLocalizedClarification(
          res.amount === null ? 'MISSING_AMOUNT' : 'MISSING_CUSTOMER',
          detectedLanguage,
        );
        res.confidence = 0.55;
      } else {
        res.confidence = 0.92;
      }
      return res;
    }

    // 7. Check Create Supplier Intent (when no transaction amount is provided)
    if (
      /(add supplier|new supplier|create supplier|പുതിയ സപ്ലയർ)/i.test(clean) &&
      numbers.length === 0
    ) {
      res.intent = CONVERSATION_INTENTS.CREATE_SUPPLIER;
      res.merchantOrSupplier = this.extractSupplierName(clean);
      res.confidence = 0.9;
      return res;
    }

    // 8. Check Sales Recording (ADD_SALE)
    const hasSaleKeyword =
      /(sales|sale|vilpana|kachavadam|വിൽപ്പന|കച്ചവടം|കളക്ഷൻ|collection)/i.test(clean);

    if (hasSaleKeyword) {
      res.intent = CONVERSATION_INTENTS.ADD_SALE;
      res.transactionType = 'SALE';
      res.description = clean;

      // Sale period detection
      if (/(morning|ravile|രാവിലെ)/i.test(clean)) {
        res.salePeriod = 'MORNING';
        res.category = 'MORNING_SALES';
      } else if (/(afternoon|lunch|uchakku|ഉച്ചയ്ക്ക്|ഉച്ച)/i.test(clean)) {
        res.salePeriod = 'AFTERNOON';
        res.category = 'AFTERNOON_SALES';
      } else if (/(evening|night|dinner|vaikunneram|rathri|വൈകുന്നേരം|രാത്രി)/i.test(clean)) {
        res.salePeriod = 'EVENING';
        res.category = 'EVENING_SALES';
      } else {
        res.salePeriod = 'FULL_DAY';
        res.category = 'DAILY_SALES';
      }

      // Parse breakdown (Cash / UPI / Card)
      const cashMatch =
        clean.match(/(?:cash|ക്യാഷ്|കാശ്)\s*(?:sales|vilpana|വിൽപ്പന)?\s*[:=-]?\s*₹?\s*(\d+(?:\.\d+)?)/i) ||
        clean.match(/₹?\s*(\d+(?:\.\d+)?)\s*(?:rupa|roopa|രൂപ)?\s*(?:cash|ക്യാഷ്)/i);

      const upiMatch =
        clean.match(/(?:upi|gpay|phonepe|paytm|യുപിഐ)\s*(?:sales|vilpana|വിൽപ്പന)?\s*[:=-]?\s*₹?\s*(\d+(?:\.\d+)?)/i) ||
        clean.match(/₹?\s*(\d+(?:\.\d+)?)\s*(?:rupa|roopa|രൂപ)?\s*(?:upi|gpay|phonepe|യുപിഐ)/i);

      const totalMatch =
        clean.match(
          /(?:total\s*sales|today'?s?\s*sales|motham\s*vilpana|sales|വിൽപ്പന|മൊത്തം)\s*[:=-]?\s*₹?\s*(\d+(?:\.\d+)?)/i,
        );

      const cashVal = cashMatch ? parseFloat(cashMatch[1]) : null;
      const upiVal = upiMatch ? parseFloat(upiMatch[1]) : null;

      res.paymentBreakdown.cash = cashVal;
      res.paymentBreakdown.upi = upiVal;

      if (cashVal !== null && upiVal !== null) {
        res.paymentMethod = 'SPLIT';
        // Avoid double counting if user gave both total and breakdown
        if (totalMatch) {
          const explicitTotal = parseFloat(totalMatch[1]);
          // Ensure totalMatch wasn't just matching "cash sales 2500"
          if (explicitTotal >= cashVal + upiVal) {
            res.amount = explicitTotal;
          } else {
            res.amount = cashVal + upiVal;
          }
        } else {
          res.amount = cashVal + upiVal;
        }
      } else if (cashVal !== null && upiVal === null && !totalMatch) {
        res.paymentMethod = 'CASH';
        res.category = 'CASH_SALES';
        res.amount = cashVal;
      } else if (upiVal !== null && cashVal === null && !totalMatch) {
        res.paymentMethod = 'UPI';
        res.category = 'UPI_SALES';
        res.amount = upiVal;
      } else if (numbers.length > 0) {
        res.amount = numbers[0];
        if (/\bupi\b/i.test(clean)) {
          res.paymentMethod = 'UPI';
          res.paymentBreakdown.upi = res.amount;
        } else if (/\bcash\b/i.test(clean)) {
          res.paymentMethod = 'CASH';
          res.paymentBreakdown.cash = res.amount;
        } else {
          res.paymentMethod = 'UNKNOWN';
        }
      }

      if (res.amount === null) {
        res.needsClarification = true;
        res.missingInformation = ['amount'];
        res.clarificationQuestion = this.getLocalizedClarification('MISSING_AMOUNT', detectedLanguage);
        res.confidence = 0.5;
      } else {
        res.confidence = 0.95;
      }
      return res;
    }

    // 9. Check Supplier Purchase vs Supplier Payment
    const isCreditPurchase =
      /(on credit|credit purchase|kadam|pattu|കടം|പറ്റ്|കടമായി)/i.test(clean) ||
      (/supplier/i.test(clean) && /(bought|purchase|purchased|vangi|vangichu|വാങ്ങി)/i.test(clean));

    const isSupplierPayment =
      (/(supplier|kadam|baki|baaki|balance|സപ്ലയർ|കടം|ബാക്കി)/i.test(clean) &&
        /(paid|payment|settled|koduthu|adachu|theerthu|കൊടുത്തു|അടച്ചു|തീർത്തു)/i.test(clean)) ||
      /(paid to supplier|paid supplier)/i.test(clean);

    if (isCreditPurchase) {
      res.intent = CONVERSATION_INTENTS.ADD_PURCHASE;
      res.transactionType = 'PURCHASE';
      res.paymentMethod = 'CREDIT';
      res.category = this.detectExpenseCategory(clean) || 'SUPPLIER_PURCHASE';
      res.merchantOrSupplier = this.extractSupplierName(clean);
      res.amount = numbers.length > 0 ? numbers[0] : null;
      if (res.amount !== null) {
        res.paymentBreakdown.credit = res.amount;
      }
      res.description = clean;
      res.confidence = res.amount !== null ? 0.92 : 0.5;
      if (res.amount === null) {
        res.needsClarification = true;
        res.missingInformation.push('amount');
        res.clarificationQuestion = this.getLocalizedClarification('MISSING_AMOUNT', detectedLanguage);
      }
      return res;
    }

    if (isSupplierPayment) {
      res.intent = CONVERSATION_INTENTS.RECORD_PAYMENT;
      res.transactionType = 'SUPPLIER_PAYMENT';
      res.category = 'SUPPLIER_PAYMENT';
      res.paymentMethod = this.detectPaymentMethod(clean);
      res.merchantOrSupplier = this.extractSupplierName(clean);
      res.amount = numbers.length > 0 ? numbers[0] : null;
      res.description = clean;
      res.confidence = res.amount !== null ? 0.92 : 0.5;
      if (res.amount === null) {
        res.needsClarification = true;
        res.missingInformation.push('amount');
        res.clarificationQuestion = this.getLocalizedClarification('MISSING_AMOUNT', detectedLanguage);
      }
      return res;
    }

    // 10. Check Expense Recording (ADD_EXPENSE)
    const detectedCategory = this.detectExpenseCategory(clean);
    const hasExpenseVerb =
      /(bought|paid|spent|expense|vangichu|vangiyathu|vangi|koduthu|chilavu|chelavu|വാങ്ങി|കൊടുത്തു|ചിലവ്|ചെലവ്)/i.test(
        clean,
      );

    if (detectedCategory || hasExpenseVerb) {
      res.intent = CONVERSATION_INTENTS.ADD_EXPENSE;
      res.transactionType = 'EXPENSE';
      res.category = detectedCategory || 'OTHER_EXPENSE';
      res.paymentMethod = this.detectPaymentMethod(clean);
      res.amount = numbers.length > 0 ? numbers[0] : null;
      res.merchantOrSupplier = this.extractSupplierName(clean);
      res.description = clean;

      if (res.amount === null) {
        res.needsClarification = true;
        res.missingInformation = ['amount'];
        res.clarificationQuestion = this.getLocalizedClarification('MISSING_AMOUNT', detectedLanguage);
        res.confidence = 0.55;
      } else {
        res.confidence = 0.94;
      }
      return res;
    }

    // 11. Contextual follow-up (e.g., user sends just a number or product name when session was waiting)
    if (sessionContext?.pendingTransaction) {
      const pending = sessionContext.pendingTransaction;
      const isInventoryIntent = [
        CONVERSATION_INTENTS.STOCK_IN,
        CONVERSATION_INTENTS.STOCK_OUT,
        CONVERSATION_INTENTS.RECORD_WASTAGE,
        CONVERSATION_INTENTS.STOCK_ADJUSTMENT,
        CONVERSATION_INTENTS.ADD_PRODUCT,
        CONVERSATION_INTENTS.CHECK_STOCK,
      ].includes(pending.intent);

      if (isInventoryIntent) {
        const inv = this.extractInventoryDetails(clean);
        res.intent = pending.intent;
        res.inventoryAction = {
          ...(pending.inventoryAction || {}),
          productName: pending.inventoryAction?.productName || inv.productName || (numbers.length === 0 ? clean : null),
          quantity: pending.inventoryAction?.quantity ?? inv.quantity ?? (numbers.length === 1 ? numbers[0] : null),
          unit: pending.inventoryAction?.unit || inv.unit || 'pcs',
        };
        if (pending.intent === CONVERSATION_INTENTS.STOCK_ADJUSTMENT) {
          res.inventoryAction.newStockCount = res.inventoryAction.quantity;
        }
        res.confidence = 0.9;
        return res;
      }

      if (numbers.length === 1) {
        res.intent = pending.intent || CONVERSATION_INTENTS.ADD_EXPENSE;
        res.transactionType = pending.transactionType || 'EXPENSE';
        res.category = pending.category || 'OTHER_EXPENSE';
        res.paymentMethod = pending.paymentMethod || this.detectPaymentMethod(clean);
        res.customerName = pending.customerName || null;
        res.amount = numbers[0];
        res.description = pending.description || clean;
        res.confidence = 0.9;
        return res;
      }
    }

    // 12. Unknown / Unclear intent
    res.intent = CONVERSATION_INTENTS.UNKNOWN;
    res.needsClarification = true;
    res.confidence = 0.2;
    res.clarificationQuestion = this.getLocalizedClarification('UNKNOWN_INTENT', detectedLanguage);
    return res;
  }

  /**
   * Local fallback parser for screenshots (when offline or in automated tests without mock override)
   */
  localScreenshotExtractor(caption = '', imageBuffer = null, detectedLanguage = 'en') {
    const res = createEmptyScreenshotExtraction();
    res.detectedLanguage = detectedLanguage;
    const text = String(caption || '').trim();

    // Also inspect if test buffer contains embedded metadata text
    const bufferStr = imageBuffer ? imageBuffer.toString('utf8') : '';
    const combined = `${text} ${bufferStr}`;

    res.isFinancialScreenshot = true;
    res.paymentMethod = 'UPI';

    if (/gpay|google pay/i.test(combined)) res.appType = 'GPAY';
    else if (/phonepe/i.test(combined)) res.appType = 'PHONEPE';
    else if (/paytm/i.test(combined)) res.appType = 'PAYTM';
    else if (/bank|neft|imps/i.test(combined)) {
      res.appType = 'BANK_RECEIPT';
      res.paymentMethod = 'BANK_TRANSFER';
    } else {
      res.appType = 'UPI_RECEIPT';
    }

    // Status detection
    if (/(failed|declined|error|പരാജയപ്പെട്ടു)/i.test(combined)) {
      res.transactionStatus = 'FAILED';
    } else if (/(pending|processing|waiting)/i.test(combined)) {
      res.transactionStatus = 'PENDING';
    } else {
      res.transactionStatus = 'SUCCESS';
    }

    // Direction detection
    if (/(received from|credited|incoming|customer paid)/i.test(combined)) {
      res.transactionDirection = 'INCOMING';
      res.suggestedTransactionType = 'SALE';
      res.suggestedCategory = 'UPI_SALES';
    } else if (/(paid to|sent to|debited|outgoing)/i.test(combined)) {
      res.transactionDirection = 'OUTGOING';
      res.suggestedTransactionType = 'EXPENSE';
      res.suggestedCategory = this.detectExpenseCategory(combined) || 'OTHER_EXPENSE';
    } else {
      res.transactionDirection = 'UNKNOWN';
      res.suggestedTransactionType = null;
    }

    // Reference ID detection (12-digit UPI ref or UTR)
    const refMatch =
      combined.match(/(?:upi\s*ref|ref\s*no|utr|txn\s*id)\s*[:#-]?\s*([A-Za-z0-9]{8,22})/i) ||
      combined.match(/\b(\d{12})\b/);
    if (refMatch) {
      res.referenceId = refMatch[1];
    }

    // Amount detection
    const withoutRef = refMatch ? combined.replace(refMatch[0], '') : combined;
    const nums = this.extractNumbers(withoutRef);
    if (nums.length > 0) {
      res.amount = nums[0];
    }

    // Merchant detection
    const toMatch = combined.match(/(?:paid to|sent to|received from|merchant|to)\s+([A-Za-z0-9\s]{2,25})/i);
    if (toMatch) {
      res.merchantOrRecipient = toMatch[1].trim();
    }

    res.confidence = res.amount ? 0.85 : 0.4;
    res.needsConfirmation = true;
    return res;
  }

  extractNumbers(text) {
    // Strip commas inside numbers (e.g. 12,500 -> 12500)
    const normalized = String(text || '').replace(/(\d),(\d{3})\b/g, '$1$2');
    const matches = normalized.match(/\d+(?:\.\d+)?/g);
    if (!matches) return [];
    return matches.map((n) => parseFloat(n)).filter((n) => !Number.isNaN(n) && n > 0);
  }

  detectExpenseCategory(text) {
    for (const rule of CATEGORY_RULES) {
      if (rule.regex.test(text)) {
        return rule.category;
      }
    }
    return null;
  }

  detectPaymentMethod(text) {
    if (/\b(upi|gpay|google pay|phonepe|paytm|യുപിഐ|ജിപേ)\b/i.test(text)) {
      return 'UPI';
    }
    if (/\b(cash|kassu|kaashu|ക്യാഷ്|കാശ്|പണം)\b/i.test(text)) {
      return 'CASH';
    }
    if (/\b(bank|transfer|neft|imps|ബാങ്ക്)\b/i.test(text)) {
      return 'BANK_TRANSFER';
    }
    if (/\b(card|swipe|കാർഡ്)\b/i.test(text)) {
      return 'CARD';
    }
    if (/\b(credit|kadam|pattu|കടം|പറ്റ്)\b/i.test(text)) {
      return 'CREDIT';
    }
    return 'UNKNOWN';
  }

  detectReportMetric(text) {
    if (/(cash sales|cash collection|ക്യാഷ് വിൽപ്പന)/i.test(text)) return 'CASH_SALES';
    if (/(upi sales|upi collection|യുപിഐ വിൽപ്പന)/i.test(text)) return 'UPI_SALES';
    if (/(total sales|sales|vilpana|വിൽപ്പന|കച്ചവടം)/i.test(text) && !/(expense|chilavu)/i.test(text)) {
      return 'TOTAL_SALES';
    }
    if (/(expense|expenses|chilavu|chelavu|ചിലവ്|ചെലവ്)/i.test(text)) return 'EXPENSES';
    if (/(supplier|സപ്ലയർ)/i.test(text)) return 'SUPPLIER_PAYMENTS';
    return 'ALL';
  }

  extractSupplierName(text) {
    const patterns = [
      /(?:to\s+supplier|from\s+supplier|supplier|from|to)\s+([A-Z][a-zA-Z0-9\s]{1,25}?)(?:\s+(?:on credit|for|via|upi|cash|₹|\d|$))/i,
      /([A-Z][a-zA-Z]+)\s+(?:inte kadayil|inu|kadayil|stores|traders|suppliers|agencies)/i,
      /(?:supplier|balance of)\s+([a-zA-Z0-9\s]{2,20})/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const candidate = match[1]
          .replace(/\b(supplier|സപ്ലയർ|on|credit|cash|upi|for|rs|rupa|roopa|paid|bought|balance|ethra)\b/gi, '')
          .trim();
        if (candidate.length >= 2) {
          return candidate;
        }
      }
    }
    return null;
  }

  extractCustomerName(text) {
    const patterns = [
      /(?:customer|to|from)\s+([A-Z][a-zA-Z0-9\s]{1,25}?)(?:\s+(?:on credit|for|via|upi|cash|paid|gave|balance|ethra|₹|\d)|$)/i,
      /^([A-Z][a-zA-Z0-9\s]{1,25}?)\s+(?:paid|gave|balance|തന്നു|ബാക്കി)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const candidate = match[1]
          .replace(/\b(customer|കസ്റ്റമർ|on|credit|cash|upi|for|rs|paid|gave|balance|ethra)\b/gi, '')
          .trim();
        if (candidate.length >= 2) {
          return candidate;
        }
      }
    }
    return null;
  }

  extractInventoryDetails(text) {
    // Match quantity + optional unit (e.g. "50 kg", "2.5 litre", "10 pcs", "50 കിലോ")
    const unitPattern =
      /(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|grams|litre|litres|liter|ltr|l|ml|pcs|pc|pieces|pack|packs|box|boxes|sack|sacks|carton|cartons|bottle|bottles|കിലോ|ഗ്രാം|ലിറ്റർ|പീസ്)?(?=\s|$|[?.,!])/i;

    const unitNormalization = {
      kgs: 'kg',
      gm: 'g',
      grams: 'g',
      litres: 'litre',
      liter: 'litre',
      ltr: 'litre',
      l: 'litre',
      pc: 'pcs',
      pieces: 'pcs',
      packs: 'pack',
      boxes: 'box',
      sacks: 'sack',
      cartons: 'carton',
      bottles: 'bottle',
      കിലോ: 'kg',
      ഗ്രാം: 'g',
      ലിറ്റർ: 'litre',
      പീസ്: 'pcs',
    };

    const qtyMatch = text.match(unitPattern);
    const quantity = qtyMatch ? parseFloat(qtyMatch[1]) : null;
    const rawUnit = qtyMatch?.[2] ? qtyMatch[2].toLowerCase() : null;
    const unit = rawUnit ? unitNormalization[rawUnit] || rawUnit : 'pcs';

    // Strip command keywords, numbers, and units to isolate productName
    let cleaned = String(text || '')
      .replace(
        /\b(add product|new product|create product|stock in|stock out|stock adjust|adjust stock|adjust|restock|add stock|deduct stock|used from stock|sold|from stock|check stock|stock of|stock|waste|wasted|wastage|spoiled|damaged|damage|min|minimum|alert|price|cost|rate|unit|innu|innale|to|of|for|ethra|und|undu|aanu|vannu|aayi|nashichu|kurachu|kg|kgs|g|gm|grams|litre|litres|liter|ltr|l|ml|pcs|pc|pieces|pack|packs|box|boxes|sack|sacks|carton|cartons|bottle|bottles)\b/gi,
        ' ',
      )
      .replace(/(ഇന്ന്|ഇന്നലെ|സ്റ്റോക്ക്|വന്നു|കുറച്ചു|നശിച്ചു|കേടായി|തിരുത്തുക|പുതിയ|ഉൽപ്പന്നം|പ്രോഡക്റ്റ്|എത്രയുണ്ട്|എത്ര|ആയി|കിലോ|ഗ്രാം|ലിറ്റർ|പീസ്)/g, ' ')
      .replace(/\d+(?:\.\d+)?/g, ' ')
      .replace(/[?.,!₹:-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Common Malayalam/Manglish product aliases -> normalized readable names
    const aliases = {
      ari: 'Rice',
      അരി: 'Rice',
      pachakkari: 'Vegetables',
      പച്ചക്കറി: 'Vegetables',
      thakkali: 'Tomato',
      തക്കാളി: 'Tomato',
      പഞ്ചസാര: 'Sugar',
      meen: 'Fish',
      മീൻ: 'Fish',
      irachi: 'Meat',
      ഇറച്ചി: 'Meat',
      kozhi: 'Chicken',
      കോഴി: 'Chicken',
      enna: 'Oil',
      എണ്ണ: 'Oil',
      paal: 'Milk',
      പാൽ: 'Milk',
    };

    const lowerClean = cleaned.toLowerCase();
    if (aliases[lowerClean]) {
      cleaned = aliases[lowerClean];
    }

    const productName = cleaned.length >= 2 ? cleaned : null;

    return { productName, quantity, unit };
  }

  getLocalizedClarification(code, lang = 'en') {
    if (code === 'MISSING_AMOUNT') {
      if (lang === 'ml') return 'തുക എത്രയാണെന്ന് ദയവായി പറയാമോ? (ഉദാഹരണത്തിന്: ₹850)';
      if (lang === 'manglish' || lang === 'mixed') return 'Ethra rupa aanu ennu parayamo? (e.g., 850)';
      return 'Could you please specify the amount? (e.g., ₹850)';
    }
    if (code === 'MISSING_PRODUCT') {
      if (lang === 'ml') return 'ഏത് ഉൽപ്പന്നത്തിന്റെ (Product) സ്റ്റോക്ക് ആണെന്ന് ദയവായി പറയാമോ?';
      if (lang === 'manglish' || lang === 'mixed') return 'Ethu product inte stock aanu ennu parayamo? (e.g., Rice, Sugar)';
      return 'Which product are you referring to? (e.g., Rice, Sugar)';
    }
    if (code === 'MISSING_QUANTITY') {
      if (lang === 'ml') return 'അളവ് (Quantity) എത്രയാണെന്ന് ദയവായി പറയാമോ? (ഉദാഹരണത്തിന്: 10 kg)';
      if (lang === 'manglish' || lang === 'mixed') return 'Ethra quantity aanu ennu parayamo? (e.g., 10 kg)';
      return 'Could you please specify the quantity and unit? (e.g., 10 kg)';
    }
    if (code === 'MISSING_CUSTOMER') {
      if (lang === 'ml') return 'കസ്റ്റമറുടെ പേര് ദയവായി പറയാമോ?';
      if (lang === 'manglish' || lang === 'mixed') return 'Customer inte peru parayamo?';
      return 'Could you please specify the customer name?';
    }
    if (lang === 'ml') {
      return 'ക്ഷമിക്കണം, വ്യക്തമായില്ല. വിൽപ്പന, ചിലവ്, സ്റ്റോക്ക്, അല്ലെങ്കിൽ കണക്ക് റിപ്പോർട്ട് അയക്കുക.';
    }
    if (lang === 'manglish' || lang === 'mixed') {
      return 'Kshamikkuka, vyakthamayilla. Sales, expense, stock, allenkil report message ayakkuka.';
    }
    return 'Sorry, I did not catch that. You can record sales, expenses, stock movements, or request reports.';
  }
}

export const aiService = new AIService();
