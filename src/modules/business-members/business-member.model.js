import mongoose from 'mongoose';

export const MEMBER_PERMISSIONS = [
  'RECORD_TRANSACTIONS',
  'EDIT_TRANSACTIONS',
  'VOID_TRANSACTIONS',
  'VIEW_REPORTS',
  'MANAGE_SUPPLIERS',
  'MANAGE_CUSTOMERS',
  'MANAGE_INVENTORY',
  'ADJUST_STOCK',
  'VIEW_INVENTORY',
  'MANAGE_MEMBERS',
];

export const ROLE_DEFAULT_PERMISSIONS = {
  OWNER: [...MEMBER_PERMISSIONS],
  MANAGER: [
    'RECORD_TRANSACTIONS',
    'EDIT_TRANSACTIONS',
    'VOID_TRANSACTIONS',
    'VIEW_REPORTS',
    'MANAGE_SUPPLIERS',
    'MANAGE_CUSTOMERS',
    'MANAGE_INVENTORY',
    'ADJUST_STOCK',
    'VIEW_INVENTORY',
  ],
  ACCOUNTANT: [
    'RECORD_TRANSACTIONS',
    'EDIT_TRANSACTIONS',
    'VIEW_REPORTS',
    'MANAGE_SUPPLIERS',
    'MANAGE_CUSTOMERS',
    'VIEW_INVENTORY',
  ],
  CASHIER: [
    'RECORD_TRANSACTIONS',
    'VIEW_INVENTORY',
  ],
  STAFF: [
    'VIEW_INVENTORY',
  ],
};

const businessMemberSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['OWNER', 'MANAGER', 'CASHIER', 'ACCOUNTANT', 'STAFF'],
      default: 'OWNER',
    },
    permissions: {
      type: [String],
      default: function () {
        return ROLE_DEFAULT_PERMISSIONS[this.role] ? [...ROLE_DEFAULT_PERMISSIONS[this.role]] : [];
      },
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INVITED', 'REVOKED'],
      default: 'ACTIVE',
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

businessMemberSchema.index({ businessId: 1, userId: 1 }, { unique: true });

export const BusinessMember =
  mongoose.models.BusinessMember || mongoose.model('BusinessMember', businessMemberSchema);
