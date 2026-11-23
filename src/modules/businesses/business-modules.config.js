export const CORE_MODULES = ['finance'];
export const OPTIONAL_MODULES = ['inventory', 'purchases', 'customers'];
export const ALL_MODULES = [...CORE_MODULES, ...OPTIONAL_MODULES];

const MODULE_RECOMMENDATIONS = {
  SERVICE: { finance: true, inventory: false, purchases: false, customers: true },
  FREELANCER: { finance: true, inventory: false, purchases: false, customers: true },
  RESTAURANT: { finance: true, inventory: true, purchases: true, customers: true },
  CAFE: { finance: true, inventory: true, purchases: true, customers: true },
  BAKERY: { finance: true, inventory: true, purchases: true, customers: true },
  CLOUD_KITCHEN: { finance: true, inventory: true, purchases: true, customers: true },
  CATERING: { finance: true, inventory: true, purchases: true, customers: true },
  GROCERY: { finance: true, inventory: true, purchases: true, customers: true },
  RETAIL: { finance: true, inventory: true, purchases: true, customers: true },
  WHOLESALE: { finance: true, inventory: true, purchases: true, customers: true },
  ELECTRONICS: { finance: true, inventory: true, purchases: true, customers: true },
  CLOTHING: { finance: true, inventory: true, purchases: true, customers: true },
  PHARMACY: { finance: true, inventory: true, purchases: true, customers: true },
  GENERAL: { finance: true, inventory: true, purchases: true, customers: true },
};

function moduleConfigError(message, code = 'INVALID_MODULE_CONFIG') {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = code;
  return err;
}

/**
 * Return recommended module configuration for a business type (for onboarding suggestions only).
 * Business type never restricts which modules can be enabled or disabled.
 */
export function getRecommendedModulesForType(businessType = 'GENERAL') {
  const normalized = String(businessType || 'GENERAL').toUpperCase();
  const preset = MODULE_RECOMMENDATIONS[normalized] || MODULE_RECOMMENDATIONS.GENERAL;
  return {
    finance: { enabled: true },
    inventory: { enabled: Boolean(preset.inventory) },
    purchases: { enabled: Boolean(preset.purchases) },
    customers: { enabled: Boolean(preset.customers) },
  };
}

/**
 * Centralized backward-compatible business module resolver.
 * - `finance` is ALWAYS enabled.
 * - Uses `business.settings.modules` when present.
 * - Falls back safely for legacy businesses without `settings.modules` (preserving
 *   inventoryManagement from `settings.enabledModules` and keeping existing restaurant
 *   capabilities active).
 */
export function resolveBusinessModules(business) {
  const modulesObj = business?.settings?.modules || {};
  const legacyObj = business?.settings?.enabledModules || {};

  const resolveOptional = (key, legacyFallback) => {
    const entry = modulesObj[key];
    if (entry && typeof entry.enabled === 'boolean') {
      return entry.enabled;
    }
    return Boolean(legacyFallback);
  };

  const legacyInventory =
    typeof legacyObj.inventoryManagement === 'boolean' ? legacyObj.inventoryManagement : true;

  return {
    finance: { enabled: true },
    inventory: { enabled: resolveOptional('inventory', legacyInventory) },
    purchases: { enabled: resolveOptional('purchases', true) },
    customers: { enabled: resolveOptional('customers', true) },
  };
}

export function isModuleEnabled(business, moduleKey) {
  if (moduleKey === 'finance') return true;
  if (!OPTIONAL_MODULES.includes(moduleKey)) return false;
  const resolved = resolveBusinessModules(business);
  return Boolean(resolved[moduleKey]?.enabled);
}

/**
 * Validate and normalize module configuration payloads for onboarding and settings updates.
 * Accepts `{ inventory: true }` or `{ inventory: { enabled: true } }`.
 * Rejects unknown module keys, non-boolean enabled values, and attempts to disable `finance`.
 */
export function validateAndNormalizeModulesInput(input, baseModules = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw moduleConfigError('Modules configuration must be an object.');
  }

  const current = baseModules || {
    finance: { enabled: true },
    inventory: { enabled: false },
    purchases: { enabled: false },
    customers: { enabled: false },
  };

  const next = {
    finance: { enabled: true },
    inventory: { enabled: Boolean(current.inventory?.enabled) },
    purchases: { enabled: Boolean(current.purchases?.enabled) },
    customers: { enabled: Boolean(current.customers?.enabled) },
  };

  for (const [key, rawVal] of Object.entries(input)) {
    if (!ALL_MODULES.includes(key)) {
      throw moduleConfigError(`Unknown module key: ${key}`, 'INVALID_MODULE_KEY');
    }

    const enabledVal =
      typeof rawVal === 'boolean'
        ? rawVal
        : rawVal && typeof rawVal === 'object' && typeof rawVal.enabled === 'boolean'
          ? rawVal.enabled
          : null;

    if (enabledVal === null) {
      throw moduleConfigError(`Invalid enabled flag for module "${key}"; boolean required.`);
    }

    if (key === 'finance' && enabledVal === false) {
      throw moduleConfigError('Core finance module cannot be disabled.', 'CORE_MODULE_REQUIRED');
    }

    if (key !== 'finance') {
      next[key] = { enabled: enabledVal };
    }
  }

  return next;
}
