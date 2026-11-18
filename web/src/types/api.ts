export type BusinessType = 'RESTAURANT' | 'GROCERY' | 'RETAIL' | 'WHOLESALE' | 'GENERAL';

export type MemberRole = 'OWNER' | 'MANAGER' | 'ACCOUNTANT' | 'CASHIER' | 'STAFF';

export interface User {
  _id: string;
  whatsappNumber: string;
  name: string;
  role: string;
  status: string;
}

export interface BusinessConfig {
  type: BusinessType;
  label: string;
  defaultCategory: string;
  expenseCategories: string[];
  productCategories: string[];
  defaultUnits: string[];
  inventoryDefaults: {
    autoDeductOnItemizedSale: boolean;
    autoDeductOnLumpSumSale: boolean;
    allowNegativeStock: boolean;
  };
}

export interface Business {
  _id: string;
  name: string;
  businessType: BusinessType;
  businessCategory: string;
  currency: string;
  timezone: string;
  address: string;
  settings?: {
    enabledModules?: {
      moneyManagement: boolean;
      inventoryManagement: boolean;
    };
    inventory?: {
      autoDeductOnItemizedSale: boolean;
      autoDeductOnLumpSumSale: boolean;
      allowNegativeStock: boolean;
    };
    customExpenseCategories?: string[];
  };
}

export interface SubscriptionInfo {
  status: string;
  planCode: string;
  isPilotParticipant: boolean;
  billingExempt: boolean;
  trialEndsAt?: string | null;
  remainingDays: number;
  readOnly: boolean;
}

export interface UsageSummaryInfo {
  periodKey: string;
  warnings: Array<{
    resource: string;
    current: number;
    limit: number;
    pct: number;
  }>;
}

export interface AuthSessionData {
  user: User;
  business: Business | null;
  businessConfig: BusinessConfig | null;
  memberRole: MemberRole | null;
  permissions: string[];
  subscription?: SubscriptionInfo | null;
  usage?: UsageSummaryInfo | null;
  needsOnboarding: boolean;
}

export interface TransactionAuditEntry {
  action: 'CREATED' | 'UPDATED' | 'VOIDED' | 'DELETED';
  timestamp: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  reason?: string;
}

export interface TransactionLineItem {
  productId?: string | null;
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

export interface TransactionItem {
  _id: string;
  type: string;
  category: string;
  amount: number;
  currency: string;
  description: string;
  paymentMethod: string;
  paymentBreakdown?: {
    cash: number;
    upi: number;
    card: number;
    bankTransfer: number;
    credit: number;
    unreconciled: number;
  };
  salePeriod?: string | null;
  items?: TransactionLineItem[];
  isLumpSum?: boolean;
  stockSynced?: boolean;
  supplierName?: string | null;
  customerName?: string | null;
  referenceId?: string | null;
  transactionDate: string;
  source: string;
  status: string;
  auditHistory?: TransactionAuditEntry[];
}

export interface CustomerSummaryItem {
  _id: string;
  name: string;
  phone?: string | null;
  notes?: string;
  totalCreditSales?: number;
  totalPaymentsReceived?: number;
  outstandingBalance: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SupplierSummaryItem {
  _id: string;
  name: string;
  phone?: string | null;
  category?: string;
  notes?: string;
  totalPurchases?: number;
  totalPayments?: number;
  outstandingBalance: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaymentRecordItem {
  _id: string;
  direction: 'INCOMING' | 'OUTGOING';
  relatedTransactionId?: string | null;
  customerId?: { _id: string; name: string; phone?: string | null } | string | null;
  supplierId?: { _id: string; name: string; phone?: string | null } | string | null;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  referenceId?: string | null;
  notes?: string;
  status: string;
  createdAt?: string;
}

export interface CustomerLedgerData {
  customer: CustomerSummaryItem;
  summary: {
    totalCreditSales: number;
    totalPaymentsReceived: number;
    outstandingBalance: number;
    creditSaleCount: number;
    paymentCount: number;
  };
  creditSales: TransactionItem[];
  payments: PaymentRecordItem[];
  transactions: TransactionItem[];
}

export interface SupplierLedgerData {
  supplier: SupplierSummaryItem;
  summary: {
    totalPurchases: number;
    totalPayments: number;
    outstandingBalance: number;
    purchaseCount: number;
    paymentCount: number;
    transactionCount: number;
  };
  purchases: TransactionItem[];
  payments: PaymentRecordItem[];
  transactions: TransactionItem[];
}

export interface ProductItem {
  _id: string;
  name: string;
  sku?: string | null;
  category: string;
  unit: string;
  currentStock: number;
  minStockLevel: number;
  costPrice: number;
  sellingPrice: number;
  trackInventory?: boolean;
  status?: string;
}

export interface StockMovementItem {
  _id: string;
  productId: {
    _id: string;
    name: string;
    unit: string;
    category: string;
  } | string;
  type: string;
  quantity: number;
  quantityChange: number;
  previousStock: number;
  newStock: number;
  unitCost: number;
  totalValue: number;
  relatedTransactionId?: string | null;
  reason?: string;
  createdAt: string;
}

export interface DailyReport {
  date: string;
  timezone: string;
  totalRecordedSales: number;
  cashCollections: number;
  upiCollections: number;
  cardCollections: number;
  unreconciledAmount: number;
  totalExpenses: number;
  categoryExpenses: Record<string, number>;
  totalSupplierPayments: number;
  totalCreditPurchases: number;
  totalCustomerPaymentsReceived: number;
  recordedOperatingSurplus: number;
  transactionCount: number;
}

export interface WeeklyReport {
  period: 'WEEKLY';
  timezone: string;
  startDate: string;
  endDate: string;
  totalSales: number;
  cashSales: number;
  upiSales: number;
  creditSales: number;
  totalExpenses: number;
  categoryExpenses: Record<string, number>;
  supplierPurchases: number;
  paymentsReceived: number;
  paymentsMade: number;
  recordedOperatingSurplus: number;
  transactionCount: number;
}

export interface MonthlyReport {
  year: number;
  month: number;
  timezone: string;
  monthlySales: number;
  cashSales: number;
  upiSales: number;
  monthlyExpenses: number;
  categoryExpenses: Record<string, number>;
  supplierPurchases: number;
  supplierPayments: number;
  customerPaymentsReceived: number;
  recordedOperatingSurplus: number;
  previousMonth: {
    sales: number;
    expenses: number;
    salesGrowthPct: number | null;
  };
  transactionCount: number;
}

export interface RangeFinancialReport {
  period: 'CUSTOM';
  timezone: string;
  startDate: string;
  endDate: string;
  totalSales: number;
  cashSales: number;
  upiSales: number;
  creditSales: number;
  totalExpenses: number;
  categoryExpenses: Record<string, number>;
  supplierPurchases: number;
  paymentsReceived: number;
  paymentsMade: number;
  recordedOperatingSurplus: number;
  byType: Record<string, { count: number; amount: number }>;
  transactionCount: number;
}

export interface CashFlowChannel {
  openingBalance: number;
  inflows: number;
  outflows: number;
  netFlow: number;
  closingBalance: number;
}

export interface CashFlowReport {
  startDate: string;
  endDate: string;
  timezone: string;
  cash: CashFlowChannel;
  bankAndUpi: CashFlowChannel;
  totalOpeningBalance: number;
  totalInflows: number;
  totalOutflows: number;
  totalClosingBalance: number;
}

export interface ReceivablesReport {
  totalReceivables: number;
  customerCount: number;
  customers: Array<{
    customerId: string;
    name: string;
    phone?: string | null;
    totalCreditSales: number;
    totalPaymentsReceived: number;
    outstandingBalance: number;
  }>;
  paymentHistory: PaymentRecordItem[];
}

export interface PayablesReport {
  totalPayables: number;
  supplierCount: number;
  suppliers: Array<{
    supplierId: string;
    name: string;
    phone?: string | null;
    totalPurchases: number;
    totalPayments: number;
    outstandingBalance: number;
  }>;
  paymentHistory: PaymentRecordItem[];
}

export interface InventoryReport {
  currentStock: Array<{
    productId: string;
    name: string;
    category: string;
    unit: string;
    currentStock: number;
    minStockLevel: number;
    costPrice: number;
    stockValue: number;
  }>;
  lowStockProducts: ProductItem[];
  lowStockCount: number;
  valuation: {
    productCount: number;
    totalUnits: number;
    totalValue: number;
    outOfStockCount: number;
    byCategory: Record<string, { count: number; value: number }>;
  };
  movementSummaryByType: Record<
    string,
    { count: number; totalQuantity: number; totalValue: number }
  >;
  totalMovements: number;
}

export interface BusinessMemberItem {
  _id: string;
  businessId: string;
  userId: {
    _id: string;
    name: string;
    whatsappNumber: string;
    status: string;
    lastActiveAt?: string;
  };
  role: MemberRole;
  permissions: string[];
  status: 'ACTIVE' | 'INVITED' | 'REVOKED';
  createdAt?: string;
}

