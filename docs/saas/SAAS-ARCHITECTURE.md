# VyaparBot – SaaS Architecture & Existing Codebase Audit

## 1. Executive Summary

VyaparBot already has strong multi-tenant isolation at the data and middleware layers (`businessId` scoping on every operational model, `BusinessMember` RBAC, signed `HttpOnly` + CSRF sessions, and MongoDB ACID transactions). To operate as a commercial multi-tenant SaaS with monthly INR subscriptions, the platform needs:

1. A separate **`PLATFORM_ADMIN`** role and `/api/admin/*` control plane.
2. Expanded **`SubscriptionPlan`** and **`Subscription`** lifecycle states (`PENDING`, `TRIALING`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`, `EXPIRED`).
3. **Backend-enforced entitlements & usage metering** (`UsageRecord`).
4. A **completely isolated SaaS billing ledger** (`SaasPayment`, `Invoice`, `BillingEvent`) separate from tenant `Transaction` and `PaymentRecord` collections.
5. **Multi-business workspace switching** for users who own or belong to multiple shops.

---

## 2. Existing Codebase Audit (What Can Be Reused vs. Gaps)

| Component | Current Implementation | Reusable As-Is? | Identified Gaps |
|---|---|---|---|
| `Business` (`src/modules/businesses/business.model.js`) | `name`, `businessType`, `ownerId`, `currency` (`INR`), `timezone`, `settings.enabledModules`, `status` (`ACTIVE`, `SUSPENDED`, `ARCHIVED`). | **Yes** | Add suspension metadata (`suspendedReason`, `suspendedAt`) if needed; `status` already supports `SUSPENDED`. |
| `BusinessMember` (`src/modules/business-members/business-member.model.js`) | `businessId`, `userId`, `role` (`OWNER`, `MANAGER`, `CASHIER`, `ACCOUNTANT`, `STAFF`), `permissions[]`, `status`. | **Yes** | None for tenant RBAC. Keep `PLATFORM_ADMIN` off `BusinessMember`. |
| `User` (`src/modules/users/user.model.js`) | `whatsappNumber`, `name`, `role` (`OWNER`, `MANAGER`, `STAFF`, `USER`, `ADMIN`), `tokenVersion`. | **Partially** | Add `PLATFORM_ADMIN` to `role` enum (or `isPlatformAdmin: Boolean`) so platform admins are distinct from tenant `OWNER`s. |
| `Subscription` (`src/modules/subscriptions/subscription.model.js`) | `businessId` (unique), `plan` (`TRIAL`, `STARTER`, `PRO`, `ENTERPRISE`), `status` (`ACTIVE`, `PAST_DUE`, `EXPIRED`, `CANCELLED`), `startDate`, `expiryDate`, `usageLimits`. | **Extend** | Missing `PENDING`, `TRIALING`, `SUSPENDED`; missing `planId` ref, `gracePeriodEndsAt`, `isComplimentary`, `billingCycle`, and gateway IDs. |
| `auth.middleware.js` (`resolveBusinessContext`) | Verifies `auth_session` + `tokenVersion` + CSRF; resolves `business` via `businessService.resolveBusinessForUser`; blocks cross-tenant `x-business-id` claims. | **Extend** | Currently assumes 1 business per user (`findOne`). Does not check `subscription.status` or allow switching between multiple legitimate memberships. |
| `auth.service.js` (`getUserBusinessContext`) | Returns single active `BusinessMember` or `ownedBusiness`. | **Extend** | Returns only one business; needs `businesses[]` list + `activeBusinessId` for multi-shop owners. |
| `business.routes.js` (`POST /onboard`) | Creates `Business`, `BusinessMember` (`OWNER`), and `Subscription` (`TRIAL`, `ACTIVE`). | **Extend** | Currently returns `409 BUSINESS_ALREADY_EXISTS` if user has any active membership; does not support plan selection or `PENDING` manual-activation state. |
| `Transaction` & `PaymentRecord` | Operational tenant accounting (`SALE`, `EXPENSE`, `PURCHASE`, `CUSTOMER_PAYMENT`, `SUPPLIER_PAYMENT`). | **Keep Isolated** | Must **never** be used for VyaparBot SaaS subscription fees. |
| `web/` Dashboard | Next.js App Router, Tailwind v4, `AuthContext`, `PermissionGate`, `Sidebar`. | **Reuse + Extend** | Needs `/admin/*` routes gated by `PLATFORM_ADMIN`, business switcher UI, and subscription/upgrade banner when `PAST_DUE` or `SUSPENDED`. |

---

## 3. Target Multi-Tenant SaaS Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│                         Control Plane (/api/admin/*)                 │
│  PLATFORM_ADMIN (User.role === 'PLATFORM_ADMIN')                     │
│  • Manage SubscriptionPlans  • Activate/Suspend Businesses           │
│  • Pilot/Complimentary Grants • View SaasPayments, Invoices, Usage   │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Tenant Plane (/api/* & WhatsApp)                │
│  resolveBusinessContext + requireActiveSubscription + requirePerm    │
│  • Tenant Data (businessId-isolated): Transactions, Inventory,       │
│    Customers, Suppliers, Reports                                     │
│  • Entitlement Checks: Products, Members, AI/WhatsApp UsageRecord    │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   SaaS Billing Plane (Provider-Agnostic)             │
│  SubscriptionPlan ─▶ Subscription ─▶ SaasPayment / Invoice           │
│  BillingEvent (idempotent webhook log)                               │
│  * Strictly separated from tenant Transaction / PaymentRecord *      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. 30-Day Complimentary Pilot Programme & Pre-SaaS Grandfathering

- **30-Day Pilot Scope**: Only the first **three (3)** approved pilot businesses are eligible for 30 days of complimentary access (`status: 'TRIALING'`).
- **Dynamic & Atomic Enforcement**: Do not hardcode pilot business IDs. Enforce the 3-business pilot cap centrally inside a MongoDB transaction (`runInTransaction` + atomic pilot slot check/counter) so concurrent admin requests cannot exceed 3 approved pilot grants.
- **No Fake Revenue**: Complimentary pilot access must never create fake `SaasPayment` or `Invoice` entries.
- **Expired Trial Read-Only Policy**: Trial expiry (`EXPIRED`) blocks all write/WhatsApp operations via backend middleware while preserving **read-only** dashboard/report/export access and all historical business data.
- **Pre-SaaS Grandfathering**: Businesses created before SaaS subscription enforcement are marked `billingExempt: true` and `migrationSource: 'PRE_SAAS'` (see `BILLING-ARCHITECTURE.md`), preserving existing access, roles, permissions, and transactions without forcing a 30-day trial or paid plan.

---

## 5. Phased Implementation Recommendation

1. **Phase A1 (Pilot Launch — 30-Day Manual Pilot & Control Plane)**:
   - Add `PLATFORM_ADMIN` role + `requirePlatformAdmin` middleware + `/api/admin/*` endpoints.
   - Extend `Subscription` statuses (`PENDING`, `TRIALING`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`, `EXPIRED`) and pilot audit fields (`trialStartedAt`, `trialEndsAt`, `grantedBy`, `grantReason`, `activationSource: 'MANUAL_PILOT'`, UTC timestamps).
   - Add `SubscriptionPlan`, `SaasPayment`, `Invoice`, `UsageRecord` models.
   - Enforce the atomic 3-business pilot cap, prevent duplicate pilot grants, and enforce `requireActiveSubscription` + backend entitlement limits (with no automatic charges and no fake payment records).
   - Build `/admin` dashboard pages for pilot participant visibility, 30-day pilot activation, remaining trial days, and audited trial-to-paid conversion.
2. **Phase B (Multi-Business & Self-Serve Onboarding)**:
   - Support multiple businesses per user (`activeBusinessId` in session/header validated against `BusinessMember`).
   - Add plan selection during `POST /api/business/onboard`.
3. **Phase C (Automated Payment Gateway)**:
   - Implement `PaymentGatewayAdapter` (e.g., Razorpay Subscriptions), `BillingEvent` webhook idempotency, automated invoicing, and dunning (`PAST_DUE` -> `SUSPENDED`).
