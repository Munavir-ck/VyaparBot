# VyaparBot – SaaS Billing & Payment Gateway Architecture

## 1. Strict Financial Separation Rule

- Tenant operational collections (`Transaction` and `PaymentRecord`) record **the shop's own business accounting** (sales, expenses, supplier purchases, customer/supplier settlements).
- **VyaparBot SaaS subscription fees MUST NEVER be written to `Transaction` or `PaymentRecord`.**
- **Complimentary 30-day pilot access (`activationSource: 'MANUAL_PILOT'`) MUST NEVER create fake `SaasPayment` or `Invoice` records.** Revenue and payment collections only contain real verified or audited paid transactions.
- All platform subscription billing lives in dedicated collections: `SubscriptionPlan`, `Subscription`, `SaasPayment`, `Invoice`, and `BillingEvent`.

---

## 2. Billing Data Models

### `Subscription` (Extended from `src/modules/subscriptions/subscription.model.js`)
```js
{
  businessId: ObjectId,           // ref Business, unique
  subscriptionPlanId: ObjectId,   // ref SubscriptionPlan
  planCode: String,               // e.g. 'PILOT', 'STARTER', 'PRO'
  status: String,                 // 'PENDING' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED'
  isComplimentary: Boolean,       // true for 30-day pilot / promo grants
  isPilotParticipant: Boolean,    // true for the 3 approved pilot businesses
  billingExempt: Boolean,         // true for grandfathered PRE_SAAS businesses
  migrationSource: String,        // 'PRE_SAAS' | 'PILOT' | 'STANDARD' | null
  activationSource: String,       // 'MANUAL_PILOT' | 'MANUAL_PAID' | 'SELF_SERVE' | 'GATEWAY' | 'PRE_SAAS_GRANDFATHER'
  grantedBy: ObjectId,            // ref User (PLATFORM_ADMIN) who activated pilot/grant
  grantReason: String,            // mandatory audit reason for pilot grant or extension
  trialStartedAt: Date,           // UTC timestamp set when admin activates pilot (NOT registration)
  trialEndsAt: Date,              // UTC timestamp = trialStartedAt + 30 days
  startDate: Date,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  gracePeriodEndsAt: Date,
  cancelAtPeriodEnd: Boolean,
  cancelledAt: Date,
  gatewayProvider: String,        // 'MANUAL' | 'RAZORPAY' | etc.
  gatewayCustomerId: String,
  gatewaySubscriptionId: String,
  usageLimits: { ... },           // approved pilot entitlement config / overrides
  statusHistory: [{ from, to, reason, changedBy, timestamp }], // timestamps in UTC
}
```
- **Indexes**: `{ businessId: 1 }` (unique), `{ status: 1, currentPeriodEnd: 1 }`, `{ isPilotParticipant: 1 }`, `{ billingExempt: 1, migrationSource: 1 }`, `{ gatewaySubscriptionId: 1 }` (sparse).
- **Atomic 3-Pilot Cap**: Pilot grants (`isPilotParticipant: true`, `activationSource: 'MANUAL_PILOT'`) must execute inside `runInTransaction` using a central `PlatformCounter` (`_id: 'pilot_slots'`, `used < 3`) or atomic conditional update so concurrent admin requests cannot exceed 3 pilot businesses and duplicate grants to the same `businessId` are rejected.

### Pre-SaaS Grandfathering & Safe Migration Design
- **Observed Codebase State**: Existing businesses created via `businessService.resolveBusinessForUser()` or `POST /api/business/onboard` currently have `{ plan: 'TRIAL', status: 'ACTIVE', expiryDate: +30d }`, while older or seeded `Business` records may have **no `Subscription` document** at all (and existing `expiryDate` values were never enforced).
- **Grandfathering Rules**:
  - Do **not** assume every existing business has a `Subscription` document or identical `status`/`expiryDate`.
  - Pre-SaaS businesses are grandfathered via an **explicit, admin-controlled migration** that upserts `Subscription` with `billingExempt: true`, `migrationSource: 'PRE_SAAS'`, `status: 'ACTIVE'`, `activationSource: 'PRE_SAAS_GRANDFATHER'` (without starting a 30-day pilot trial, without consuming any of the 3 pilot slots, without suspending them, and without modifying `BusinessMember` roles, permissions, or `Transaction` records).

### `SaasPayment`
```js
{
  businessId: ObjectId,           // ref Business, index
  subscriptionId: ObjectId,       // ref Subscription, index
  invoiceId: ObjectId,            // ref Invoice
  amountInPaise: Number,          // integer INR paise
  currency: 'INR',
  method: String,                 // 'MANUAL_UPI' | 'MANUAL_BANK' | 'COMPLIMENTARY' | 'RAZORPAY'
  status: String,                 // 'PENDING' | 'CAPTURED' | 'FAILED' | 'REFUNDED'
  provider: String,               // 'MANUAL' | 'RAZORPAY'
  providerPaymentId: String,
  providerOrderId: String,
  idempotencyKey: String,         // prevents duplicate manual or webhook recording
  paidAt: Date,
  recordedBy: ObjectId,           // ref User (PLATFORM_ADMIN for manual)
  metadata: Mixed,
}
```
- **Indexes**: `{ businessId: 1, createdAt: -1 }`, `{ provider: 1, providerPaymentId: 1 }` (unique, partial on string), `{ idempotencyKey: 1 }` (unique, partial on string).

### `Invoice`
```js
{
  invoiceNumber: String,          // unique sequential, e.g. 'VB-2026-0001'
  businessId: ObjectId,           // ref Business, index
  subscriptionId: ObjectId,       // ref Subscription
  saasPaymentId: ObjectId,        // ref SaasPayment
  currency: 'INR',
  subtotalInPaise: Number,
  taxInPaise: Number,             // GST-ready field (0 if not applicable)
  totalInPaise: Number,
  periodStart: Date,
  periodEnd: Date,
  status: String,                 // 'ISSUED' | 'PAID' | 'VOID'
  issuedAt: Date,
  paidAt: Date,
}
```
- **Indexes**: `{ invoiceNumber: 1 }` (unique), `{ businessId: 1, issuedAt: -1 }`.

### `BillingEvent` (Webhook & Audit Idempotency Log)
```js
{
  provider: String,               // 'RAZORPAY' | 'MANUAL'
  eventId: String,                // provider webhook event ID
  eventType: String,              // e.g. 'subscription.charged', 'payment.failed'
  subscriptionId: ObjectId,
  businessId: ObjectId,
  payloadHash: String,
  processed: Boolean,
  processedAt: Date,
  error: String,
}
```
- **Indexes**: `{ provider: 1, eventId: 1 }` (unique).

---

## 3. Provider-Independent Payment Gateway Interface

Define `PaymentGatewayAdapter` (`src/modules/billing/gateway.interface.js`) so Razorpay Subscriptions (or another provider) can be plugged in without changing subscription domain logic:

- `createCustomer({ business, owner }) -> { gatewayCustomerId }`
- `createSubscription({ plan, business, gatewayCustomerId }) -> { gatewaySubscriptionId, checkoutUrl / shortUrl }`
- `cancelSubscription({ gatewaySubscriptionId, atCycleEnd })`
- `verifyWebhookSignature({ rawBody, headers }) -> boolean`
- `parseWebhookEvent({ body }) -> { eventId, eventType, gatewaySubscriptionId, paymentId, amountInPaise, status }`
- `issueRefund({ providerPaymentId, amountInPaise, reason })`

### Webhook & Idempotency Flow
1. Verify provider signature using `rawBody` (`req.rawBody` is already captured in `src/app.js`).
2. Insert `BillingEvent` (`{ provider, eventId }`); if duplicate (`E11000`), return `200 OK` immediately without re-processing.
3. Inside a MongoDB ACID transaction (`runInTransaction`), update `SaasPayment`, `Invoice`, and `Subscription` (`ACTIVE` / `PAST_DUE` / `CANCELLED`), then mark `BillingEvent.processed = true`.
