# VyaparBot – Tenant Onboarding Design

## 1. Current Onboarding Flow (Verified in Code)

- **Auth**: `POST /api/auth/request-otp` -> WhatsApp 6-digit OTP (5-min expiry, max 5 attempts) -> `POST /api/auth/verify-otp` creates `User` (if new) and sets `auth_session` + `csrf_token` cookies.
- **Dashboard Onboarding**: `POST /api/business/onboard` (`src/modules/businesses/business.routes.js`) creates:
  1. `Business` (`name`, `businessType`, `currency`, `timezone`, `address`, `settings`)
  2. `BusinessMember` (`role: 'OWNER'`, `ROLE_DEFAULT_PERMISSIONS.OWNER`)
  3. `Subscription` (`plan: 'TRIAL'`, `status: 'ACTIVE'`)
- **WhatsApp Auto-Provisioning**: `businessService.resolveBusinessForUser()` (`src/modules/businesses/business.service.js`) auto-provisions a `Business` + `OWNER` + `TRIAL` subscription when an unknown phone messages WhatsApp.

---

## 2. Target SaaS Onboarding Flow

### Step 1: User Registration & OTP Verification
- Unchanged: WhatsApp OTP login via `/api/auth/request-otp` and `/api/auth/verify-otp`.

### Step 2: Business Creation & Business Type Selection
- User submits `POST /api/business/onboard` with:
  - `name`, `businessType` (`RESTAURANT`, `GROCERY`, `RETAIL`, `WHOLESALE`, `GENERAL`, etc.), `currency` (default `INR`), `timezone` (default `Asia/Kolkata`), `address`.
  - `planCode` (selected from `GET /api/plans` — public active `SubscriptionPlan` catalog).

### Step 3: Subscription Activation Modes
1. **30-Day Complimentary Pilot Activation (Phase A1)**:
   - Newly registered businesses start in `status: 'PENDING'` (trial clock does **not** start at registration).
   - `PLATFORM_ADMIN` manually approves and activates pilot access via `POST /api/admin/subscriptions/:businessId/grant-pilot`.
   - Eligibility is capped at the **first three (3)** approved pilot businesses, enforced centrally and atomically in a MongoDB transaction (never hardcoded by business ID).
   - Duplicate pilot grants to the same business are rejected.
   - Activation sets `status: 'TRIALING'`, `activationSource: 'MANUAL_PILOT'`, `trialStartedAt` (UTC at admin activation time), `trialEndsAt = trialStartedAt + 30 days` (UTC), `grantedBy` (`PLATFORM_ADMIN` user ID), `grantReason`, and `subscriptionPlanId` (or approved pilot entitlement config).
   - **No fake `SaasPayment` or `Invoice` record** is created for complimentary pilot access.
2. **Manual Paid Activation (Phase A1 Conversion)**:
   - Before or after trial expiry, a business converts to `ACTIVE` only after a verified payment or an explicitly audited manual paid activation (`PLATFORM_ADMIN` records real `SaasPayment` details; no automatic charge).
3. **Automated Gateway Activation (Phase C)**:
   - Checkout creates gateway subscription; webhook `subscription.activated` / `payment.captured` transitions `PENDING`/`TRIALING` -> `ACTIVE` idempotently.

### Step 4: WhatsApp Onboarding Guard & Pre-SaaS Businesses
- For commercial SaaS, `businessService.resolveBusinessForUser()` should **not** silently grant unlimited `ACTIVE` subscriptions to arbitrary new WhatsApp senders without a valid `TRIALING`, `ACTIVE`, or `billingExempt` subscription record.
- Existing businesses created before SaaS enforcement (`migrationSource: 'PRE_SAAS'`, `billingExempt: true`) remain unaffected and are never placed into `PENDING` or forced onto a 30-day trial.

---

## 3. Multi-Business User Support

### Current Gap
- `authService.getUserBusinessContext()` and `businessService.resolveBusinessForUser()` use `BusinessMember.findOne({ userId, status: 'ACTIVE' })`, returning only the first business.
- `POST /api/business/onboard` blocks creating a second business (`409 BUSINESS_ALREADY_EXISTS`).

### Target Design
1. `GET /api/auth/me` returns `businesses: [{ business, memberRole, permissions, subscriptionStatus }]` plus `activeBusinessId`.
2. Client sends `x-business-id` header (or selects workspace in `AuthContext` persisted in session/cookie).
3. `resolveBusinessContext` verifies:
   ```text
   BusinessMember.findOne({ userId: req.user._id, businessId: targetBusinessId, status: 'ACTIVE' })
   ```
   - Never trusts `x-business-id` without verifying an `ACTIVE` `BusinessMember` record for that `req.user._id`.
   - Returns `403 CROSS_TENANT_FORBIDDEN` if the user has no active membership in `targetBusinessId`.
4. `POST /api/business/onboard` allows creating additional businesses (subject to optional per-owner limits).
