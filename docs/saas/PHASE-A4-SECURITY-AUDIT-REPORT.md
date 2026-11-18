# VyaparBot Phase A4 – SaaS Security, Subscription & End-to-End Audit Report

## 1. Executive Summary

An end-to-end security, subscription lifecycle, multi-tenant isolation, concurrency, and billing audit was conducted across the VyaparBot SaaS codebase. Three real defects were identified and fixed during the audit (suspended-business auto-provisioning bypass, concurrent pilot-plan initialization `E11000` race, and raw `req.body` mass assignment on admin plan endpoints). After fixes, **21/21 backend test files (112/112 tests)** and the Next.js TypeScript check and production build (**25 routes**) passed with zero errors.

---

## 2. Security Findings Grouped by Severity

| Severity | Finding | Status | Resolution |
|---|---|---|---|
| **High** | **Suspended Business Auto-Provisioning Bypass**: `businessService.resolveBusinessForUser()` previously checked `membership.businessId.status === 'ACTIVE'`, causing suspended business owners to fall through and auto-provision a brand-new `ACTIVE` workspace. | **Fixed** | `resolveBusinessForUser()` now throws `403 BUSINESS_SUSPENDED` when a member's business is not `ACTIVE`; `resolveBusinessContext` propagates `err.statusCode` and `err.code`. Verified in `tests/phaseA4.audit.test.js`. |
| **Medium** | **Concurrent `ensureDefaultPilotPlan` `E11000` Race**: Simultaneous `grantPilotAccess()` calls before `PILOT` plan creation collided on `SubscriptionPlan.create()`. | **Fixed** | Replaced `SubscriptionPlan.create()` with atomic `findOneAndUpdate(..., { upsert: true })` + `E11000` retry in `subscription.service.js`. Verified with 5-way concurrent `Promise.all` pilot test. |
| **Medium** | **Admin Plan Mass Assignment**: `POST /api/admin/plans` and `PATCH /api/admin/plans/:id` passed raw `req.body` directly to Mongoose. | **Fixed** | Added `pickPlanPayload()` field whitelist and audit logging in `src/modules/admin/admin.routes.js`. |
| **Medium** | **In-Process Limit Mutex (`withBusinessLimitLock`)**: `maxProducts` and `maxMembers` serialization uses an in-memory `Map` per Node.js process. | **Open (Multi-Instance Risk)** | Safe for single-instance Render staging; before horizontal multi-instance AWS scaling, move product/member limit counters into atomic MongoDB conditional updates or distributed locks. |

---

## 3. Subscription Lifecycle Test Results
- **`PENDING`**: Read-only `GET` allowed; writes blocked (`402 SUBSCRIPTION_INACTIVE`).
- **`TRIALING`**: Full access within `trialEndsAt` (UTC); auto-transitions to `EXPIRED` at expiry without deleting data.
- **`ACTIVE`**: Full access within `currentPeriodEnd`; auto-transitions to `EXPIRED` when period elapses.
- **`PAST_DUE`**: Allowed within `gracePeriodEndsAt`; auto-transitions to `SUSPENDED` once grace elapses.
- **`CANCELLED`**: Preserves access until `currentPeriodEnd` when `cancelAtPeriodEnd: true`; transitions to `EXPIRED` thereafter.
- **`EXPIRED` / `SUSPENDED`**: Read-only `GET` & export preserved; all writes and WhatsApp business operations blocked (`402`).
- **`billingExempt: true` (`PRE_SAAS`)**: Full access preserved via dry-run + audited grandfathering migration (`tests/phaseA1.saas.test.js`, `tests/phaseA2.enforcement.test.js`).
- **Plan Snapshot Isolation**: Editing `SubscriptionPlan` defaults does not overwrite existing active subscription `usageLimits` snapshots (`tests/phaseA4.audit.test.js`).

---

## 4. Tenant Isolation Test Results
- Cross-tenant `x-business-id` claims on `/api/business/usage` and all business-scoped routes are rejected (`403 CROSS_TENANT_FORBIDDEN`).
- Business `OWNER`s and `CASHIER`s cannot access `/api/admin/*` (`403 PLATFORM_ADMIN_REQUIRED`).
- Admin APIs return business/owner/subscription metadata without exposing tenant `Transaction`, `PaymentRecord`, `Customer`, or `Supplier` ledgers.

---

## 5. Pilot & Usage Metering Results
- **3-Pilot Cap Under Concurrency**: 5 simultaneous `grant-pilot` requests across 5 businesses yielded exactly 3 `200` grants and 2 `409 PILOT_LIMIT_REACHED` rejections (`tests/phaseA4.audit.test.js`).
- **Duplicate Pilot Grants**: Rejected with `409 DUPLICATE_PILOT_GRANT`.
- **Usage Metering**: `UsageRecord` increments atomically in UTC `YYYY-MM` periods; 80% warnings and 100% quota blocks (`USAGE_LIMIT_REACHED`) are enforced before AI model invocation; `MessageLog` deduplicates WhatsApp webhook retries.
- **Billing Revenue Integrity**: Only `CAPTURED` `SaasPayment` records contribute to `collectedRevenueInPaise` (`PENDING`, `FAILED`, `REFUNDED` excluded); SaaS payments and `VB-YYYY-NNNN` invoices remain isolated from shop `Transaction`/`PaymentRecord`.

---

## 6. Admin Dashboard Browser Test Results
- **Not Executed (Honest Disclosure)**: Live interactive browser automation (clicking through `/admin`, `/admin/businesses`, `/admin/pilot`, `/admin/subscriptions`, `/admin/usage`, `/admin/billing` against a running backend + frontend server) was **not** executed in this audit.
- Frontend pages were verified via TypeScript (`tsc --noEmit`) and Next.js production build (`next build` — **25/25 routes** compiled with 0 errors), and all underlying `/api/admin/*` endpoints were verified via `supertest` integration tests.

---

## 7. Remaining Risks & Production Blockers
1. **Live Browser QA Pending**: Execute manual or Playwright smoke tests across `/admin/*` on Render staging before onboarding pilot shops.
2. **External Integrations Not Live-Tested**: Live Meta WhatsApp Cloud API webhook delivery and live OpenAI API calls were tested via mocked/local harnesses.
3. **Multi-Instance Limit Lock**: Replace in-process `withBusinessLimitLock` with atomic DB counters before scaling beyond 1 backend instance on AWS.
4. **Admin Bootstrap & Pre-SaaS Migration**: Seed the initial `PLATFORM_ADMIN` user and run `POST /api/admin/migrations/grandfather-pre-saas` (`dryRun: true` then `false`) on staging/production databases.

---

## 8. Recommended Fixes in Priority Order
1. **Before Staging Pilot**: Run live browser smoke tests on `/admin/*` and `/login` once deployed to Render staging.
2. **Before AWS Multi-Instance Production**: Replace `withBusinessLimitLock` with atomic MongoDB counters for `maxProducts` and `maxMembers`.
3. **Phase B / Phase C**: Implement multi-business workspace switching (Phase B) and `PaymentGatewayAdapter` (Phase C).
