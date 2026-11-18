# VyaparBot – Subscription Lifecycle Design

## 1. Subscription Statuses

Extend `Subscription.status` (`src/modules/subscriptions/subscription.model.js`) from `['ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED']` to:

| Status | Meaning | Tenant Access |
|---|---|---|
| `PENDING` | Business created; awaiting pilot approval or paid activation (trial clock has not started). | Read-only onboarding/billing view; operational writes blocked. |
| `TRIALING` | Active 30-day complimentary pilot (`trialStartedAt` to `trialEndsAt` in UTC, granted manually by `PLATFORM_ADMIN`). | Full access per approved pilot entitlements. |
| `ACTIVE` | Paid subscription within `currentPeriodEnd` (activated only via verified payment or audited manual paid activation). | Full access per plan entitlements. |
| `PAST_DUE` | Renewal payment failed; within configurable grace period (`now < gracePeriodEndsAt`). | Full or read-only warning banner (configurable grace policy) + payment retry. |
| `SUSPENDED` | Grace period elapsed or manually suspended by `PLATFORM_ADMIN`. | Operational APIs & WhatsApp mutations blocked (`402/403 SUBSCRIPTION_SUSPENDED`); billing/export/settings read allowed. |
| `CANCELLED` | Cancelled by `OWNER` or `PLATFORM_ADMIN`; remains accessible until `currentPeriodEnd` if `cancelAtPeriodEnd: true`, else immediate stop. | Transitions to `EXPIRED` at `currentPeriodEnd`. |
| `EXPIRED` | Trial or paid period ended without renewal. | **Read-only** dashboard/report/export access; all write APIs & WhatsApp business operations blocked (`402/403 SUBSCRIPTION_EXPIRED`). |

---

## 2. State Transition Diagram

```text
          ┌──(trial)──▶ TRIALING ──(trial ends, no payment)──▶ EXPIRED
          │                 │                                      ▲
          │           (paid / admin activate)                      │
          ▼                 ▼                                      │
       PENDING ────────▶ ACTIVE ◀──(renewal paid / reactivated)────┤
                            │                                      │
                   (renewal failed)                                │
                            ▼                                      │
                        PAST_DUE ──(grace elapsed)──▶ SUSPENDED ───┘
                            │                              ▲
                   (admin cancel / owner cancel)           │
                            ▼                              │
                        CANCELLED ─────────────────────────┘
```

---

## 3. Lifecycle Rules

1. **30-Day Pilot Trial & Conversion (Phase A1)**:
   - `trialStartedAt` is recorded in **UTC** when the `PLATFORM_ADMIN` activates the pilot (`activationSource: 'MANUAL_PILOT'`), not at initial business registration.
   - `trialEndsAt` is set to exactly `trialStartedAt + 30 days` (UTC).
   - Before expiry, the business may select a paid monthly plan; `status` transitions to `ACTIVE` **only** after a verified payment or an explicitly audited manual paid activation (never automatic charge).
   - If the 30-day trial expires without conversion (`now >= trialEndsAt`), `status` transitions to `EXPIRED`:
     - **Allowed (Read-Only)**: View dashboard & historical data, sales/expenses, customers/suppliers, inventory & stock movements, financial & inventory reports, and export historical business records.
     - **Blocked (Backend Enforced)**: Create/edit/void transactions, record payments, modify inventory/products, create/modify customers/suppliers, perform business operations via WhatsApp, or perform other write operations.
     - Dashboard displays a clear subscription renewal banner; **all historical business data is preserved** for future reactivation.
   - Trials are **never** silently extended; any exceptional extension requires `PLATFORM_ADMIN` authorization and a recorded audit reason.
2. **Monthly Renewal**:
   - Billing cycle is monthly in `INR` (`currentPeriodStart` -> `currentPeriodEnd`).
   - On successful renewal (`SaasPayment` `CAPTURED`), `currentPeriodStart` and `currentPeriodEnd` advance by 1 billing month, `status` -> `ACTIVE`, and `Invoice` is issued.
3. **Failed Payments & Grace Period**:
   - When a renewal charge fails, `status` -> `PAST_DUE` and `gracePeriodEndsAt` is set (e.g., `+5` or `+7` days from due date, configurable per plan/platform).
   - If payment succeeds before `gracePeriodEndsAt`, `status` returns to `ACTIVE`.
   - If `now > gracePeriodEndsAt`, a scheduled sweep (or lazy check in `requireActiveSubscription`) transitions `PAST_DUE` -> `SUSPENDED`.
4. **Cancellation**:
   - `OWNER` can request cancellation (`cancelAtPeriodEnd: true`); access continues until `currentPeriodEnd`, then transitions to `EXPIRED`.
   - `PLATFORM_ADMIN` can cancel or revoke/suspend immediately with a recorded reason.
5. **Reactivation**:
   - `EXPIRED`, `CANCELLED`, or `SUSPENDED` businesses can be reactivated by `PLATFORM_ADMIN` (audited manual paid activation) or by completing a new `SaasPayment` (automated gateway), preserving all historical tenant data and resetting `currentPeriodStart` to `now` and `currentPeriodEnd` to `now + 1 month`.
6. **Auditability**:
   - Every status transition appends an entry to `Subscription.statusHistory` (`from`, `to`, `reason`, `changedBy`, `timestamp` in UTC).
