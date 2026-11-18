export const CONVERSATION_INTENTS = {
  // Money Management
  ADD_SALE: 'ADD_SALE',
  ADD_EXPENSE: 'ADD_EXPENSE',
  ADD_PURCHASE: 'ADD_PURCHASE',
  RECORD_PAYMENT: 'RECORD_PAYMENT',
  CREATE_SUPPLIER: 'CREATE_SUPPLIER',
  EDIT_TRANSACTION: 'EDIT_TRANSACTION',
  DELETE_TRANSACTION: 'DELETE_TRANSACTION',

  // Customer Management (Receivables)
  ADD_CREDIT_SALE: 'ADD_CREDIT_SALE',
  RECORD_CUSTOMER_PAYMENT: 'RECORD_CUSTOMER_PAYMENT',
  VIEW_CUSTOMER_BALANCE: 'VIEW_CUSTOMER_BALANCE',

  // Inventory Management
  ADD_PRODUCT: 'ADD_PRODUCT',
  STOCK_IN: 'STOCK_IN',
  STOCK_OUT: 'STOCK_OUT',
  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
  RECORD_WASTAGE: 'RECORD_WASTAGE',
  CHECK_STOCK: 'CHECK_STOCK',
  VIEW_LOW_STOCK: 'VIEW_LOW_STOCK',
  VIEW_INVENTORY_VALUATION: 'VIEW_INVENTORY_VALUATION',

  // Reports
  VIEW_DAILY_REPORT: 'VIEW_DAILY_REPORT',
  VIEW_WEEKLY_REPORT: 'VIEW_WEEKLY_REPORT',
  VIEW_MONTHLY_REPORT: 'VIEW_MONTHLY_REPORT',
  VIEW_SUPPLIER_BALANCE: 'VIEW_SUPPLIER_BALANCE',
  VIEW_CASH_FLOW: 'VIEW_CASH_FLOW',
  VIEW_RECEIVABLES: 'VIEW_RECEIVABLES',
  VIEW_PAYABLES: 'VIEW_PAYABLES',
  VIEW_INVENTORY_REPORT: 'VIEW_INVENTORY_REPORT',

  // Meta / Control
  CONFIRM: 'CONFIRM',
  CANCEL: 'CANCEL',
  HELP: 'HELP',
  GREETING: 'GREETING',
  UNKNOWN: 'UNKNOWN',
};

export const INTENT_JSON_SCHEMA = {
  name: 'business_intent_schema',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: Object.values(CONVERSATION_INTENTS),
      },
      detectedLanguage: {
        type: 'string',
        enum: ['en', 'ml', 'manglish', 'mixed'],
      },
      confidence: {
        type: 'number',
      },
    },
    required: ['intent', 'detectedLanguage', 'confidence'],
    additionalProperties: false,
  },
};
