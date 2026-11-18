import { User } from '../users/user.model.js';
import { Business } from './business.model.js';
import { BusinessMember } from '../business-members/business-member.model.js';
import { Subscription } from '../subscriptions/subscription.model.js';
import { getBusinessTypeConfig } from './business-types.config.js';
import { logger } from '../../config/logger.js';

class BusinessService {
  /**
   * Resolve or auto-provision the business for an incoming WhatsApp phone number.
   * Ensures business-level isolation: NEVER trust a businessId supplied directly by user text.
   */
  async resolveBusinessForUser(senderPhone, senderName = 'Business Owner', options = {}) {
    const cleanPhone = String(senderPhone).replace(/\D/g, '');
    if (!cleanPhone) throw new Error('Valid phone number is required');

    const requestedType = (options.businessType || 'RESTAURANT').toUpperCase();
    const typeConfig = getBusinessTypeConfig(requestedType);

    // 1. Find or create user
    let user = await User.findOne({ whatsappNumber: cleanPhone });
    if (!user) {
      user = await User.create({
        whatsappNumber: cleanPhone,
        name: senderName || 'Business Owner',
        role: 'OWNER',
        status: 'ACTIVE',
        consentGiven: true,
      });
      logger.info({ phone: cleanPhone, userId: user._id }, 'New business owner user created');
    }

    // 2. Check if user is a member of any existing business
    let membership = await BusinessMember.findOne({
      userId: user._id,
      status: 'ACTIVE',
    }).populate('businessId');

    if (membership && membership.businessId) {
      if (membership.businessId.status !== 'ACTIVE') {
        const err = new Error('Business workspace is suspended or inactive.');
        err.statusCode = 403;
        err.code = 'BUSINESS_SUSPENDED';
        throw err;
      }
      return {
        user,
        business: membership.businessId,
        memberRole: membership.role,
        permissions: membership.permissions,
        businessConfig: getBusinessTypeConfig(membership.businessId.businessType),
      };
    }

    // 3. Check if user owns a business directly
    let business = await Business.findOne({ ownerId: user._id, status: 'ACTIVE' });

    if (!business) {
      const defaultName =
        options.businessName ||
        (user.name && user.name !== 'Business Owner' && user.name !== 'Restaurant Owner'
          ? `${user.name} Business`
          : 'My Business');

      business = await Business.create({
        name: defaultName,
        businessType: typeConfig.type,
        businessCategory: typeConfig.defaultCategory,
        ownerId: user._id,
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        address: 'Kerala, India',
        settings: {
          enabledModules: {
            moneyManagement: true,
            inventoryManagement: true,
          },
          inventory: { ...typeConfig.inventoryDefaults },
        },
        status: 'ACTIVE',
      });

      membership = await BusinessMember.create({
        businessId: business._id,
        userId: user._id,
        role: 'OWNER',
        status: 'ACTIVE',
      });

      await Subscription.create({
        businessId: business._id,
        plan: 'TRIAL',
        status: 'ACTIVE',
      });

      logger.info(
        { businessId: business._id, ownerId: user._id, businessType: business.businessType },
        'Auto-provisioned business workspace and membership',
      );
    } else {
      membership = await BusinessMember.findOneAndUpdate(
        { businessId: business._id, userId: user._id },
        {
          businessId: business._id,
          userId: user._id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
        { upsert: true, new: true },
      );
    }

    return {
      user,
      business,
      memberRole: membership.role,
      permissions: membership.permissions,
      businessConfig: getBusinessTypeConfig(business.businessType),
    };
  }

  /**
   * Update business type and apply default settings for that business type
   */
  async updateBusinessType(businessId, businessType) {
    const config = getBusinessTypeConfig(businessType);
    const business = await Business.findByIdAndUpdate(
      businessId,
      {
        $set: {
          businessType: config.type,
          businessCategory: config.defaultCategory,
          'settings.inventory': { ...config.inventoryDefaults },
        },
      },
      { new: true },
    );
    if (!business) throw new Error('BUSINESS_NOT_FOUND');
    return { business, businessConfig: config };
  }

  /**
   * Verify member has permission to perform financial or inventory action
   */
  async verifyPermission(businessId, userId, requiredPermission) {
    const member = await BusinessMember.findOne({
      businessId,
      userId,
      status: 'ACTIVE',
    });
    if (!member) return false;
    if (member.role === 'OWNER') return true;
    return member.permissions.includes(requiredPermission);
  }
}

export const businessService = new BusinessService();
