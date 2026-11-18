# VyaparBot – Platform Administration Requirements (`PLATFORM_ADMIN`)

## 1. Role Separation & Security Boundary

- **Tenant Roles (`BusinessMember.role`)**: `OWNER`, `MANAGER`, `ACCOUNTANT`, `CASHIER`, `STAFF` — scoped strictly to a single `businessId`.
- **Platform Role (`User.role`)**: `PLATFORM_ADMIN` — global platform operator role stored on `User`, **never** on `BusinessMember`.
- **Mutual Isolation**:
  - A business `OWNER` cannot access `/api/admin/*` or `/admin/*`.
  - A `PLATFORM_ADMIN` does **not** automatically become a `BusinessMember` of tenant shops and should not mutate a shop's operational sales/expenses/inventory.
- **Backend Middleware**:
  - `requirePlatformAdmin`: uses `resolveUserOnly` (signed `auth_session` + `tokenVersion` + CSRF) and verifies `req.user.role === 'PLATFORM_ADMIN'` (returning `403 FORBIDDEN` otherwise).

---

## 2. Required Platform Admin Capabilities

### A. Business Tenant Management
- `GET /api/admin/businesses`: List all registered businesses with search, `businessType`, `status`, and current `Subscription` status.
- `GET /api/admin/businesses/:id`: View business profile, owner contact, active member count, subscription details, and monthly `UsageRecord`.
- `PATCH /api/admin/businesses/:id/status`: Activate (`ACTIVE`) or suspend (`SUSPENDED`) a business with mandatory `reason` (logged in audit trail).

### B. 30-Day Pilot Programme & Subscription Management (Phase A1)
- `GET /api/admin/pilot/summary`: View pilot slot usage (`used / 3`), list of pilot participant businesses, `trialStartedAt`, `trialEndsAt` (UTC), and computed remaining trial days.
- `POST /api/admin/subscriptions/:businessId/grant-pilot`:
  - Manually grant **30 days of complimentary `TRIALING` access** (`activationSource: 'MANUAL_PILOT'`, `trialStartedAt = nowUTC`, `trialEndsAt = nowUTC + 30 days`, `grantedBy = req.user._id`, `grantReason`, `subscriptionPlanId` or approved pilot entitlement config).
  - Enforces the **3-business pilot cap atomically** inside a MongoDB transaction (never hardcoded by ID) and rejects duplicate pilot grants to a business that already received pilot access.
  - Does **not** create any fake `SaasPayment` or `Invoice` record.
- `POST /api/admin/subscriptions/:businessId/activate-paid`:
  - Convert a `TRIALING`, `PENDING`, or `EXPIRED` business to `ACTIVE` only with a verified payment or an explicitly audited manual paid activation (`SaasPayment` + paid `Invoice`; no automatic charges).
- `POST /api/admin/subscriptions/:businessId/extend-trial`:
  - Exceptional trial extension only — requires `PLATFORM_ADMIN` authorization and a mandatory `reason` recorded in `statusHistory`. Expired trials are never silently extended.
- `POST /api/admin/subscriptions/:businessId/suspend`: Revoke or suspend access (`status: 'SUSPENDED'`) with a mandatory recorded `reason` (preserves all business data).

### C. Subscription Plan Catalog
- `GET /api/admin/plans`, `POST /api/admin/plans`, `PATCH /api/admin/plans/:id`:
  - Create and update `SubscriptionPlan` limits, feature flags, trial days, grace period days, and INR pricing.

### D. Platform Payments, Invoices, Usage Monitoring & Pre-SaaS Migration
- `GET /api/admin/payments`: View all `SaasPayment` records across tenants (filtered by status/method/date).
- `GET /api/admin/invoices`: View all `Invoice` records.
- `GET /api/admin/usage`: View per-business monthly `UsageRecord` metrics vs. plan limits (AI requests, WhatsApp messages, transactions, active products, team members) and approaching-limit warnings (`>= 80%`).
- `POST /api/admin/businesses/:businessId/grandfather`: Explicit admin-controlled action to mark an existing pre-SaaS business as `billingExempt: true`, `migrationSource: 'PRE_SAAS'` (audited, never consumes pilot slots, never alters tenant roles/transactions).

---

## 3. Admin Dashboard UI (`/admin/*` in `web/`)

- Route group `/admin` gated on `user.role === 'PLATFORM_ADMIN'`:
  - `/admin` — Platform KPIs (Total Businesses, Active Subscriptions, Trialing, Past Due/Suspended, Monthly SaaS Collections).
  - `/admin/businesses` — Tenant directory with Activate / Suspend / Extend / Assign Plan actions (for onboarding the 3 initial pilot shops).
  - `/admin/plans` — Manage `SubscriptionPlan` limits & feature flags.
  - `/admin/billing` — View `SaasPayment` and `Invoice` records.
