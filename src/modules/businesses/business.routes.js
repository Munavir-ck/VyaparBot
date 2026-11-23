import express from 'express';
import { Business } from './business.model.js';
import { BusinessMember, ROLE_DEFAULT_PERMISSIONS, MEMBER_PERMISSIONS } from '../business-members/business-member.model.js';
import { User } from '../users/user.model.js';
import { Subscription } from '../subscriptions/subscription.model.js';
import { getBusinessTypeConfig, BUSINESS_TYPE_CONFIGS } from './business-types.config.js';
import {
  getRecommendedModulesForType,
  resolveBusinessModules,
  validateAndNormalizeModulesInput,
} from './business-modules.config.js';
import { businessService } from './business.service.js';
import {
  resolveUserOnly,
  resolveBusinessContext,
  requirePermission,
  requireWriteSubscription,
} from '../../middleware/auth.middleware.js';
import { subscriptionService } from '../subscriptions/subscription.service.js';

const router = express.Router();

// GET /api/business/types - List supported business type configurations with recommended modules
router.get('/types', (_req, res) => {
  const data = Object.values(BUSINESS_TYPE_CONFIGS).map((cfg) => ({
    ...cfg,
    recommendedModules: getRecommendedModulesForType(cfg.type),
  }));
  res.json({ status: 'success', data });
});

// POST /api/business/onboard - Create a business for an authenticated user who doesn't have one
router.post('/onboard', resolveUserOnly, async (req, res, next) => {
  try {
    const existingMembership = await BusinessMember.findOne({
      userId: req.user._id,
      status: 'ACTIVE',
    });
    if (existingMembership) {
      return res.status(409).json({
        status: 'fail',
        code: 'BUSINESS_ALREADY_EXISTS',
        message: 'User already belongs to an active business workspace.',
      });
    }

    const {
      name,
      businessType = 'RESTAURANT',
      currency = 'INR',
      timezone = 'Asia/Kolkata',
      address = '',
      inventorySettings = {},
      modules: requestedModules,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ status: 'fail', message: 'Business name is required' });
    }

    const config = getBusinessTypeConfig(businessType);
    const recommended = getRecommendedModulesForType(config.type);
    const initialModules = requestedModules
      ? validateAndNormalizeModulesInput(requestedModules, recommended)
      : recommended;

    const business = await Business.create({
      name: String(name).trim(),
      businessType: config.type,
      businessCategory: config.defaultCategory,
      ownerId: req.user._id,
      currency: String(currency || 'INR').toUpperCase(),
      timezone: timezone || 'Asia/Kolkata',
      address: String(address || '').trim(),
      settings: {
        modules: initialModules,
        enabledModules: {
          moneyManagement: true,
          inventoryManagement: Boolean(initialModules.inventory?.enabled),
        },
        inventory: {
          ...config.inventoryDefaults,
          ...inventorySettings,
        },
      },
      status: 'ACTIVE',
    });

    const member = await BusinessMember.create({
      businessId: business._id,
      userId: req.user._id,
      role: 'OWNER',
      permissions: [...ROLE_DEFAULT_PERMISSIONS.OWNER],
      status: 'ACTIVE',
    });

    await Subscription.create({
      businessId: business._id,
      plan: 'TRIAL',
      status: 'ACTIVE',
    });

    res.status(201).json({
      status: 'success',
      data: {
        business,
        businessConfig: config,
        modules: resolveBusinessModules(business),
        memberRole: member.role,
        permissions: member.permissions,
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ status: 'fail', code: err.code, message: err.message });
    }
    next(err);
  }
});

// Protected business routes
router.use(resolveBusinessContext, requireWriteSubscription);

// GET /api/business - Current business details & configuration
router.get('/', (req, res) => {
  res.json({
    status: 'success',
    data: {
      business: req.business,
      businessConfig: req.businessConfig,
      modules: resolveBusinessModules(req.business),
      memberRole: req.memberRole,
      permissions: req.permissions,
    },
  });
});

// PATCH /api/business - Update business settings (OWNER or MANAGER only)
router.patch('/', async (req, res, next) => {
  try {
    if (!['OWNER', 'MANAGER'].includes(req.memberRole)) {
      return res.status(403).json({
        status: 'fail',
        code: 'FORBIDDEN',
        message: 'Only Owners or Managers can update business settings.',
      });
    }

    const { name, address, timezone, currency, businessType, settings } = req.body;
    const updates = {};

    if (name && String(name).trim()) updates.name = String(name).trim();
    if (address !== undefined) updates.address = String(address).trim();
    if (timezone) updates.timezone = String(timezone).trim();
    if (currency) updates.currency = String(currency).trim().toUpperCase();

    if (businessType) {
      const cfg = getBusinessTypeConfig(businessType);
      updates.businessType = cfg.type;
      updates.businessCategory = cfg.defaultCategory;
    }

    if (settings?.inventory) {
      if (settings.inventory.autoDeductOnItemizedSale !== undefined) {
        updates['settings.inventory.autoDeductOnItemizedSale'] = Boolean(
          settings.inventory.autoDeductOnItemizedSale,
        );
      }
      if (settings.inventory.autoDeductOnLumpSumSale !== undefined) {
        updates['settings.inventory.autoDeductOnLumpSumSale'] = Boolean(
          settings.inventory.autoDeductOnLumpSumSale,
        );
      }
      if (settings.inventory.allowNegativeStock !== undefined) {
        updates['settings.inventory.allowNegativeStock'] = Boolean(
          settings.inventory.allowNegativeStock,
        );
      }
    }

    if (Array.isArray(settings?.customExpenseCategories)) {
      updates['settings.customExpenseCategories'] = settings.customExpenseCategories.map((c) =>
        String(c).trim().toUpperCase(),
      );
    }

    if (settings?.modules !== undefined) {
      await businessService.updateBusinessModules({
        businessId: req.business._id,
        userId: req.user._id,
        modulesInput: settings.modules,
        reason: req.body.reason || 'Business settings update',
      });
    }

    const business =
      Object.keys(updates).length > 0
        ? await Business.findByIdAndUpdate(req.business._id, { $set: updates }, { new: true })
        : await Business.findById(req.business._id);

    res.json({
      status: 'success',
      data: {
        business,
        businessConfig: getBusinessTypeConfig(business.businessType),
        modules: resolveBusinessModules(business),
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ status: 'fail', code: err.code, message: err.message });
    }
    next(err);
  }
});

// PATCH /api/business/modules - Update enabled optional modules with audit trail
router.patch('/modules', async (req, res, next) => {
  try {
    if (!['OWNER', 'MANAGER'].includes(req.memberRole)) {
      return res.status(403).json({
        status: 'fail',
        code: 'FORBIDDEN',
        message: 'Only Owners or Managers can update business modules.',
      });
    }

    const modulesInput = req.body?.modules ?? req.body;
    const result = await businessService.updateBusinessModules({
      businessId: req.business._id,
      userId: req.user._id,
      modulesInput,
      reason: req.body?.reason || 'Module settings update',
    });

    res.json({
      status: 'success',
      data: {
        business: result.business,
        modules: result.modules,
        changes: result.changes,
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ status: 'fail', code: err.code, message: err.message });
    }
    next(err);
  }
});

// GET /api/business/usage - Current monthly usage summary & warnings
router.get('/usage', async (req, res, next) => {
  try {
    const usage = await subscriptionService.getUsageSummary(req.business._id);
    res.json({ status: 'success', data: usage });
  } catch (err) {
    next(err);
  }
});

// GET /api/business/members - List team members
router.get('/members', requirePermission('MANAGE_MEMBERS'), async (req, res, next) => {
  try {
    const members = await BusinessMember.find({
      businessId: req.business._id,
      status: { $ne: 'REVOKED' },
    })
      .populate('userId', 'name whatsappNumber status lastActiveAt')
      .sort({ createdAt: 1 });

    res.json({
      status: 'success',
      count: members.length,
      availablePermissions: MEMBER_PERMISSIONS,
      data: members,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/business/members - Add or invite a team member by WhatsApp number
router.post('/members', requirePermission('MANAGE_MEMBERS'), async (req, res, next) => {
  try {
    const { whatsappNumber, name = 'Team Member', role = 'CASHIER', permissions = null } = req.body;
    const cleanPhone = String(whatsappNumber || '').replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ status: 'fail', message: 'Valid WhatsApp number is required' });
    }

    const validRoles = ['MANAGER', 'ACCOUNTANT', 'CASHIER', 'STAFF'];
    const targetRole = validRoles.includes(role) ? role : 'CASHIER';

    const populated = await subscriptionService.withBusinessLimitLock(
      `mem:${req.business._id}`,
      async () => {
        await subscriptionService.checkTeamMemberLimit(req.business._id);

        let targetUser = await User.findOne({ whatsappNumber: cleanPhone });
        if (!targetUser) {
          targetUser = await User.create({
            whatsappNumber: cleanPhone,
            name: String(name).trim() || 'Team Member',
            role: 'STAFF',
            status: 'ACTIVE',
          });
        }

        const targetPermissions = Array.isArray(permissions)
          ? permissions.filter((p) => MEMBER_PERMISSIONS.includes(p))
          : [...(ROLE_DEFAULT_PERMISSIONS[targetRole] || [])];

        let member = await BusinessMember.findOne({
          businessId: req.business._id,
          userId: targetUser._id,
        });

        if (!member) {
          member = await BusinessMember.create({
            businessId: req.business._id,
            userId: targetUser._id,
            role: targetRole,
            permissions: targetPermissions,
            status: 'ACTIVE',
          });
        } else {
          member.role = targetRole;
          member.permissions = targetPermissions;
          member.status = 'ACTIVE';
          await member.save();
        }

        return BusinessMember.findById(member._id).populate(
          'userId',
          'name whatsappNumber status',
        );
      },
    );

    res.status(201).json({ status: 'success', data: populated });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ status: 'fail', code: err.code, message: err.message });
    }
    next(err);
  }
});

// PATCH /api/business/members/:id - Update member role or permissions
router.patch('/members/:id', requirePermission('MANAGE_MEMBERS'), async (req, res, next) => {
  try {
    const member = await BusinessMember.findOne({
      _id: req.params.id,
      businessId: req.business._id,
    });
    if (!member) {
      return res.status(404).json({ status: 'fail', message: 'Team member not found' });
    }

    if (member.role === 'OWNER' && req.memberRole !== 'OWNER') {
      return res.status(403).json({
        status: 'fail',
        code: 'FORBIDDEN',
        message: 'Only an Owner can manage an Owner record.',
      });
    }

    if (member.role === 'OWNER' && req.body.role && req.body.role !== 'OWNER') {
      return res.status(400).json({
        status: 'fail',
        message: 'Cannot demote the business owner.',
      });
    }

    if (member.role === 'OWNER' && req.body.status && req.body.status !== 'ACTIVE') {
      return res.status(400).json({
        status: 'fail',
        message: 'Cannot deactivate or revoke the business owner.',
      });
    }

    if (
      String(member.userId) === String(req.user._id) &&
      (req.body.role !== undefined || req.body.permissions !== undefined || req.body.status !== undefined)
    ) {
      return res.status(403).json({
        status: 'fail',
        code: 'FORBIDDEN',
        message: 'You cannot modify your own role, permissions, or status.',
      });
    }

    if (req.body.role && ['MANAGER', 'ACCOUNTANT', 'CASHIER', 'STAFF'].includes(req.body.role)) {
      member.role = req.body.role;
      if (!req.body.permissions) {
        member.permissions = [...(ROLE_DEFAULT_PERMISSIONS[member.role] || [])];
      }
    }

    if (Array.isArray(req.body.permissions)) {
      member.permissions = req.body.permissions.filter((p) => MEMBER_PERMISSIONS.includes(p));
    }

    if (req.body.status && ['ACTIVE', 'INVITED', 'REVOKED'].includes(req.body.status)) {
      member.status = req.body.status;
    }

    await member.save();
    const populated = await BusinessMember.findById(member._id).populate(
      'userId',
      'name whatsappNumber status',
    );
    res.json({ status: 'success', data: populated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/business/members/:id - Revoke member access
router.delete('/members/:id', requirePermission('MANAGE_MEMBERS'), async (req, res, next) => {
  try {
    const member = await BusinessMember.findOne({
      _id: req.params.id,
      businessId: req.business._id,
    });
    if (!member) {
      return res.status(404).json({ status: 'fail', message: 'Team member not found' });
    }
    if (member.role === 'OWNER') {
      return res.status(400).json({ status: 'fail', message: 'Cannot revoke business owner' });
    }

    member.status = 'REVOKED';
    await member.save();
    res.json({ status: 'success', message: 'Member access revoked' });
  } catch (err) {
    next(err);
  }
});

export default router;

