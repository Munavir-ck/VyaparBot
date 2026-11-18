export const SCREENSHOT_EXTRACTION_JSON_SCHEMA = {
  name: 'payment_screenshot_extraction',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      isFinancialScreenshot: {
        type: 'boolean',
      },
      appType: {
        type: 'string',
        enum: ['GPAY', 'PHONEPE', 'PAYTM', 'UPI_RECEIPT', 'BANK_RECEIPT', 'SUPPLIER_INVOICE', 'OTHER', 'UNKNOWN'],
      },
      amount: {
        type: ['number', 'null'],
      },
      currency: {
        type: 'string',
      },
      transactionDate: {
        type: ['string', 'null'],
      },
      merchantOrRecipient: {
        type: ['string', 'null'],
      },
      senderName: {
        type: ['string', 'null'],
      },
      paymentMethod: {
        type: 'string',
        enum: ['UPI', 'BANK_TRANSFER', 'CARD', 'CASH', 'OTHER', 'UNKNOWN'],
      },
      referenceId: {
        type: ['string', 'null'],
      },
      transactionStatus: {
        type: 'string',
        enum: ['SUCCESS', 'PENDING', 'FAILED', 'UNKNOWN'],
      },
      transactionDirection: {
        type: 'string',
        enum: ['INCOMING', 'OUTGOING', 'UNKNOWN'],
      },
      suggestedTransactionType: {
        type: ['string', 'null'],
        enum: ['SALE', 'EXPENSE', 'PURCHASE', 'SUPPLIER_PAYMENT', null],
      },
      suggestedCategory: {
        type: ['string', 'null'],
      },
      detectedLanguage: {
        type: 'string',
        enum: ['en', 'ml', 'manglish', 'mixed'],
      },
      confidence: {
        type: 'number',
      },
      needsConfirmation: {
        type: 'boolean',
      },
      clarificationReason: {
        type: ['string', 'null'],
      },
    },
    required: [
      'isFinancialScreenshot',
      'appType',
      'amount',
      'currency',
      'transactionDate',
      'merchantOrRecipient',
      'senderName',
      'paymentMethod',
      'referenceId',
      'transactionStatus',
      'transactionDirection',
      'suggestedTransactionType',
      'suggestedCategory',
      'detectedLanguage',
      'confidence',
      'needsConfirmation',
      'clarificationReason',
    ],
    additionalProperties: false,
  },
};

export function createEmptyScreenshotExtraction() {
  return {
    isFinancialScreenshot: false,
    appType: 'UNKNOWN',
    amount: null,
    currency: 'INR',
    transactionDate: null,
    merchantOrRecipient: null,
    senderName: null,
    paymentMethod: 'UPI',
    referenceId: null,
    transactionStatus: 'UNKNOWN',
    transactionDirection: 'UNKNOWN',
    suggestedTransactionType: null,
    suggestedCategory: null,
    detectedLanguage: 'en',
    confidence: 0,
    needsConfirmation: true,
    clarificationReason: null,
  };
}

