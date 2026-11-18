import { CONVERSATION_INTENTS } from './intent.schema.js';
import {
  TRANSACTION_TYPES,
  PAYMENT_METHODS,
} from '../../modules/transactions/transaction.model.js';

export const TRANSACTION_EXTRACTION_JSON_SCHEMA = {
  name: 'business_transaction_and_inventory_extraction',
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
      transactionType: {
        type: ['string', 'null'],
        enum: [...TRANSACTION_TYPES, null],
      },
      amount: {
        type: ['number', 'null'],
      },
      currency: {
        type: 'string',
      },
      category: {
        type: ['string', 'null'],
      },
      paymentMethod: {
        type: 'string',
        enum: PAYMENT_METHODS,
      },
      paymentBreakdown: {
        type: 'object',
        properties: {
          cash: { type: ['number', 'null'] },
          upi: { type: ['number', 'null'] },
          card: { type: ['number', 'null'] },
          bankTransfer: { type: ['number', 'null'] },
          credit: { type: ['number', 'null'] },
        },
        required: ['cash', 'upi', 'card', 'bankTransfer', 'credit'],
        additionalProperties: false,
      },
      salePeriod: {
        type: ['string', 'null'],
        enum: ['FULL_DAY', 'MORNING', 'AFTERNOON', 'EVENING', 'SINGLE', null],
      },
      transactionDate: {
        type: ['string', 'null'],
      },
      merchantOrSupplier: {
        type: ['string', 'null'],
      },
      supplierPhone: {
        type: ['string', 'null'],
      },
      customerName: {
        type: ['string', 'null'],
      },
      referenceId: {
        type: ['string', 'null'],
      },
      description: {
        type: 'string',
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            productName: { type: 'string' },
            quantity: { type: 'number' },
            unit: { type: ['string', 'null'] },
            unitPrice: { type: ['number', 'null'] },
          },
          required: ['productName', 'quantity', 'unit', 'unitPrice'],
          additionalProperties: false,
        },
      },
      inventoryAction: {
        type: 'object',
        properties: {
          productName: { type: ['string', 'null'] },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          unitCost: { type: ['number', 'null'] },
          sellingPrice: { type: ['number', 'null'] },
          minStockLevel: { type: ['number', 'null'] },
          newStockCount: { type: ['number', 'null'] },
          reason: { type: ['string', 'null'] },
        },
        required: [
          'productName',
          'quantity',
          'unit',
          'unitCost',
          'sellingPrice',
          'minStockLevel',
          'newStockCount',
          'reason',
        ],
        additionalProperties: false,
      },
      reportQuery: {
        type: 'object',
        properties: {
          period: { type: ['string', 'null'], enum: ['DAILY', 'WEEKLY', 'MONTHLY', null] },
          metric: {
            type: ['string', 'null'],
            enum: [
              'ALL',
              'TOTAL_SALES',
              'CASH_SALES',
              'UPI_SALES',
              'EXPENSES',
              'SUPPLIER_PAYMENTS',
              'SUPPLIER_PURCHASES',
              'CASH_FLOW',
              'RECEIVABLES',
              'PAYABLES',
              'INVENTORY',
              null,
            ],
          },
          dateRef: { type: ['string', 'null'] },
          month: { type: ['number', 'null'] },
          year: { type: ['number', 'null'] },
        },
        required: ['period', 'metric', 'dateRef', 'month', 'year'],
        additionalProperties: false,
      },
      editAction: {
        type: 'object',
        properties: {
          field: { type: ['string', 'null'] },
          newAmount: { type: ['number', 'null'] },
          newCategory: { type: ['string', 'null'] },
          newPaymentMethod: { type: ['string', 'null'] },
          targetReference: { type: ['string', 'null'] },
        },
        required: ['field', 'newAmount', 'newCategory', 'newPaymentMethod', 'targetReference'],
        additionalProperties: false,
      },
      confidence: {
        type: 'number',
      },
      missingInformation: {
        type: 'array',
        items: { type: 'string' },
      },
      needsClarification: {
        type: 'boolean',
      },
      clarificationQuestion: {
        type: ['string', 'null'],
      },
    },
    required: [
      'intent',
      'detectedLanguage',
      'transactionType',
      'amount',
      'currency',
      'category',
      'paymentMethod',
      'paymentBreakdown',
      'salePeriod',
      'transactionDate',
      'merchantOrSupplier',
      'supplierPhone',
      'customerName',
      'referenceId',
      'description',
      'items',
      'inventoryAction',
      'reportQuery',
      'editAction',
      'confidence',
      'missingInformation',
      'needsClarification',
      'clarificationQuestion',
    ],
    additionalProperties: false,
  },
};

export function createEmptyTransactionExtraction(detectedLanguage = 'en') {
  return {
    intent: CONVERSATION_INTENTS.UNKNOWN,
    detectedLanguage,
    transactionType: null,
    amount: null,
    currency: 'INR',
    category: null,
    paymentMethod: 'UNKNOWN',
    paymentBreakdown: {
      cash: null,
      upi: null,
      card: null,
      bankTransfer: null,
      credit: null,
    },
    salePeriod: null,
    transactionDate: 'TODAY',
    merchantOrSupplier: null,
    supplierPhone: null,
    customerName: null,
    referenceId: null,
    description: '',
    items: [],
    inventoryAction: {
      productName: null,
      quantity: null,
      unit: null,
      unitCost: null,
      sellingPrice: null,
      minStockLevel: null,
      newStockCount: null,
      reason: null,
    },
    reportQuery: {
      period: null,
      metric: null,
      dateRef: 'TODAY',
      month: null,
      year: null,
    },
    editAction: {
      field: null,
      newAmount: null,
      newCategory: null,
      newPaymentMethod: null,
      targetReference: null,
    },
    confidence: 0,
    missingInformation: [],
    needsClarification: false,
    clarificationQuestion: null,
  };
}
