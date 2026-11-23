export const BUSINESS_TYPES = {
  RESTAURANT: 'RESTAURANT',
  GROCERY: 'GROCERY',
  RETAIL: 'RETAIL',
  WHOLESALE: 'WHOLESALE',
  ELECTRONICS: 'ELECTRONICS',
  CLOTHING: 'CLOTHING',
  PHARMACY: 'PHARMACY',
  SERVICE: 'SERVICE',
  FREELANCER: 'FREELANCER',
  GENERAL: 'GENERAL',
};

export const BUSINESS_TYPE_CONFIGS = {
  RESTAURANT: {
    type: 'RESTAURANT',
    label: 'Restaurant / Cafe',
    defaultCategory: 'FOOD_AND_BEVERAGE',
    expenseCategories: [
      'VEGETABLES',
      'MEAT_FISH',
      'GROCERIES',
      'GAS',
      'ELECTRICITY',
      'STAFF_WAGES',
      'RENT',
      'MAINTENANCE',
      'TRANSPORTATION',
      'OTHER_EXPENSE',
    ],
    productCategories: ['RAW_INGREDIENTS', 'BEVERAGES', 'PACKAGING', 'PREPARED_ITEMS', 'OTHER'],
    defaultUnits: ['kg', 'g', 'litre', 'ml', 'pcs', 'pack'],
    inventoryDefaults: {
      autoDeductOnItemizedSale: true,
      autoDeductOnLumpSumSale: false,
      allowNegativeStock: false,
    },
  },
  GROCERY: {
    type: 'GROCERY',
    label: 'Grocery Shop',
    defaultCategory: 'GROCERY_RETAIL',
    expenseCategories: [
      'STOCK_PURCHASE',
      'PACKAGING',
      'ELECTRICITY',
      'STAFF_WAGES',
      'RENT',
      'MAINTENANCE',
      'TRANSPORTATION',
      'OTHER_EXPENSE',
    ],
    productCategories: ['GRAINS_PULSES', 'VEGETABLES_FRUITS', 'DAIRY', 'SNACKS_BEVERAGES', 'HOUSEHOLD', 'OTHER'],
    defaultUnits: ['kg', 'g', 'litre', 'ml', 'pcs', 'pack', 'box'],
    inventoryDefaults: {
      autoDeductOnItemizedSale: true,
      autoDeductOnLumpSumSale: false,
      allowNegativeStock: false,
    },
  },
  RETAIL: {
    type: 'RETAIL',
    label: 'Retail Store',
    defaultCategory: 'RETAIL_TRADE',
    expenseCategories: [
      'STOCK_PURCHASE',
      'PACKAGING',
      'MARKETING',
      'ELECTRICITY',
      'STAFF_WAGES',
      'RENT',
      'MAINTENANCE',
      'TRANSPORTATION',
      'OTHER_EXPENSE',
    ],
    productCategories: ['APPAREL', 'ELECTRONICS', 'ACCESSORIES', 'HOME_GOODS', 'OTHER'],
    defaultUnits: ['pcs', 'pack', 'box', 'set'],
    inventoryDefaults: {
      autoDeductOnItemizedSale: true,
      autoDeductOnLumpSumSale: false,
      allowNegativeStock: false,
    },
  },
  WHOLESALE: {
    type: 'WHOLESALE',
    label: 'Wholesale Business',
    defaultCategory: 'WHOLESALE_DISTRIBUTION',
    expenseCategories: [
      'STOCK_PURCHASE',
      'WAREHOUSE_RENT',
      'LOADING_UNLOADING',
      'ELECTRICITY',
      'STAFF_WAGES',
      'MAINTENANCE',
      'TRANSPORTATION',
      'OTHER_EXPENSE',
    ],
    productCategories: ['BULK_GOODS', 'PACKAGED_GOODS', 'RAW_MATERIALS', 'OTHER'],
    defaultUnits: ['sack', 'box', 'carton', 'kg', 'litre', 'pcs'],
    inventoryDefaults: {
      autoDeductOnItemizedSale: true,
      autoDeductOnLumpSumSale: false,
      allowNegativeStock: false,
    },
  },
  GENERAL: {
    type: 'GENERAL',
    label: 'General Small Business',
    defaultCategory: 'GENERAL_BUSINESS',
    expenseCategories: [
      'STOCK_PURCHASE',
      'SUPPLIES',
      'ELECTRICITY',
      'STAFF_WAGES',
      'RENT',
      'MAINTENANCE',
      'TRANSPORTATION',
      'OTHER_EXPENSE',
    ],
    productCategories: ['GOODS', 'SUPPLIES', 'SERVICES', 'OTHER'],
    defaultUnits: ['pcs', 'kg', 'litre', 'pack', 'box'],
    inventoryDefaults: {
      autoDeductOnItemizedSale: true,
      autoDeductOnLumpSumSale: false,
      allowNegativeStock: false,
    },
  },
  ELECTRONICS: {
    type: 'ELECTRONICS',
    label: 'Electronics & Appliances',
    defaultCategory: 'ELECTRONICS_RETAIL',
    expenseCategories: [
      'STOCK_PURCHASE',
      'PACKAGING',
      'MARKETING',
      'ELECTRICITY',
      'STAFF_WAGES',
      'RENT',
      'MAINTENANCE',
      'TRANSPORTATION',
      'OTHER_EXPENSE',
    ],
    productCategories: ['MOBILE_DEVICES', 'APPLIANCES', 'ACCESSORIES', 'SPARES', 'OTHER'],
    defaultUnits: ['pcs', 'box', 'set', 'unit'],
    inventoryDefaults: {
      autoDeductOnItemizedSale: true,
      autoDeductOnLumpSumSale: false,
      allowNegativeStock: false,
    },
  },
  CLOTHING: {
    type: 'CLOTHING',
    label: 'Clothing & Apparel',
    defaultCategory: 'APPAREL_RETAIL',
    expenseCategories: [
      'STOCK_PURCHASE',
      'PACKAGING',
      'MARKETING',
      'ELECTRICITY',
      'STAFF_WAGES',
      'RENT',
      'MAINTENANCE',
      'TRANSPORTATION',
      'OTHER_EXPENSE',
    ],
    productCategories: ['MENSWEAR', 'WOMENSWEAR', 'KIDSWEAR', 'ACCESSORIES', 'OTHER'],
    defaultUnits: ['pcs', 'set', 'pair', 'pack'],
    inventoryDefaults: {
      autoDeductOnItemizedSale: true,
      autoDeductOnLumpSumSale: false,
      allowNegativeStock: false,
    },
  },
  PHARMACY: {
    type: 'PHARMACY',
    label: 'Pharmacy & Medical Store',
    defaultCategory: 'HEALTHCARE_RETAIL',
    expenseCategories: [
      'STOCK_PURCHASE',
      'PACKAGING',
      'ELECTRICITY',
      'STAFF_WAGES',
      'RENT',
      'MAINTENANCE',
      'TRANSPORTATION',
      'OTHER_EXPENSE',
    ],
    productCategories: ['MEDICINES', 'SUPPLEMENTS', 'PERSONAL_CARE', 'MEDICAL_DEVICES', 'OTHER'],
    defaultUnits: ['strip', 'bottle', 'box', 'pcs', 'pack'],
    inventoryDefaults: {
      autoDeductOnItemizedSale: true,
      autoDeductOnLumpSumSale: false,
      allowNegativeStock: false,
    },
  },
  SERVICE: {
    type: 'SERVICE',
    label: 'Service Business',
    defaultCategory: 'SERVICES',
    expenseCategories: [
      'SUPPLIES',
      'MARKETING',
      'ELECTRICITY',
      'STAFF_WAGES',
      'RENT',
      'MAINTENANCE',
      'TRANSPORTATION',
      'OTHER_EXPENSE',
    ],
    productCategories: ['SERVICES', 'SUPPLIES', 'OTHER'],
    defaultUnits: ['service', 'hour', 'visit', 'pcs'],
    inventoryDefaults: {
      autoDeductOnItemizedSale: false,
      autoDeductOnLumpSumSale: false,
      allowNegativeStock: false,
    },
  },
  FREELANCER: {
    type: 'FREELANCER',
    label: 'Freelancer / Consultant',
    defaultCategory: 'PROFESSIONAL_SERVICES',
    expenseCategories: [
      'SUPPLIES',
      'MARKETING',
      'ELECTRICITY',
      'RENT',
      'TRANSPORTATION',
      'OTHER_EXPENSE',
    ],
    productCategories: ['SERVICES', 'OTHER'],
    defaultUnits: ['hour', 'project', 'session'],
    inventoryDefaults: {
      autoDeductOnItemizedSale: false,
      autoDeductOnLumpSumSale: false,
      allowNegativeStock: false,
    },
  },
};

export function getBusinessTypeConfig(businessType = 'GENERAL') {
  const normalized = String(businessType || 'GENERAL').toUpperCase();
  if (BUSINESS_TYPE_CONFIGS[normalized]) {
    return BUSINESS_TYPE_CONFIGS[normalized];
  }
  if (['CAFE', 'BAKERY', 'CLOUD_KITCHEN', 'CATERING'].includes(normalized)) {
    return BUSINESS_TYPE_CONFIGS.RESTAURANT;
  }
  return BUSINESS_TYPE_CONFIGS.GENERAL;
}

export function isValidBusinessType(businessType) {
  const normalized = String(businessType || '').toUpperCase();
  return Object.keys(BUSINESS_TYPE_CONFIGS).includes(normalized);
}

