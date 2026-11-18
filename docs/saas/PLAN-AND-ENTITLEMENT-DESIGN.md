# VyaparBot – Plan & Entitlement Design

## 1. `SubscriptionPlan` Data Model

Pricing is intentionally **not hardcoded**; plans are stored in MongoDB and managed by `PLATFORM_ADMIN`.

```js
{
  code: String,              // unique uppercase, e.g. 'TRIAL', 'STARTER', 'GROWTH', 'PRO'
  name: String,              // display name
  description: String,
  currency: 'INR',           // default 'INR'
  monthlyPriceInPaise: Number, // integer paise (e.g. 0 for trial/complimentary, set by admin)
  billingInterval: 'MONTHLY',
  trialDays: Number,         // e.g. 14 or 30
  gracePeriodDays: Number,   // e.g. 7
  limits: {
    maxTeamMembers: Number,        // -1 = unlimited
    maxProducts: Number,           // -1 = unlimited
    monthlyAiRequests: Number,     // text/voice/screenshot AI calls per billing period
    monthlyWhatsappMessages: Number,
    monthlyTransactions: Number,
  },
  features: {
    whatsappAssistant: Boolean,
    voiceAndScreenshotAi: Boolean,
    inventoryManagement: Boolean,
    customerManagement: Boolean,
    supplierManagement: Boolean,
    financialReports: Boolean,
    advancedReports: Boolean,      // cash-flow, weekly, monthly, receivables/payables reports
    csvExport: Boolean,
  },
  isActive: Boolean,         // visible for new onboarding
  sortOrder: Number,
}
```
- **Indexes**: `{ code: 1 }` (unique), `{ isActive: 1, sortOrder: 1 }`.

### Proposed Pilot Plan Defaults (Configurable in `SubscriptionPlan`)

| Entitlement | Pilot Default | Notes |
|---|---|---|
| `limits.maxTeamMembers` | `5` | Includes the business `OWNER` |
| `limits.maxProducts` | `500` | Active products (`status: 'ACTIVE'`) |
| `limits.monthlyAiRequests` | `500` | Per calendar/billing month (`YYYY-MM`) |
| `limits.monthlyWhatsappMessages` | `1000` | Per calendar/billing month (`YYYY-MM`) |
| `features.customerManagement` | `true` | Customer directory & receivables |
| `features.supplierManagement` | `true` | Supplier directory & payables |
| `features.inventoryManagement` | `true` | Products, stock ops & movements |
| `features.financialReports` | `true` | Daily/summary financial reports |
| `features.advancedReports` | `true` | Weekly, monthly, cash-flow, receivables/payables |

All limits remain configurable per plan; active subscriptions snapshot their limits so limits are **never silently changed** during an active subscription period.

---

## 2. `UsageRecord` Data Model (Monthly Metering)

Tracks per-business consumption per billing period (`YYYY-MM`):

```js
{
  businessId: ObjectId,      // ref Business, required
  periodKey: String,         // e.g. '2026-11'
  aiRequestsCount: Number,   // default 0
  whatsappMessagesCount: Number, // default 0
  transactionsCount: Number, // default 0
  screenshotsCount: Number,  // default 0
  voiceNotesCount: Number,   // default 0
  lastUpdatedAt: Date,
}
```
- **Indexes**: `{ businessId: 1, periodKey: 1 }` (unique).
- **Atomic Increment**: `UsageRecord.findOneAndUpdate({ businessId, periodKey }, { $inc: { aiRequestsCount: 1 } }, { upsert: true, new: true })`.

### Exact Metering & Anti-Double-Counting Rules
1. **WhatsApp Messages (`whatsappMessagesCount`)**:
   - Counted **only after** `MessageLog` (`whatsappMessageId` unique index) deduplication succeeds.
   - Meta webhook retries (`DUPLICATE`), delivery status callbacks (`statuses[]`), and `IGNORED` events are **never** counted.
   - Counted once per unique inbound WhatsApp message processed for the business.
2. **AI Requests (`aiRequestsCount`)**:
   - Counted **1** per actual `aiExtractor` invocation (GPT text/vision extraction or Whisper audio transcription) after `MessageLog` deduplication.
   - Deterministic button clicks (`handleButtonClick`), duplicate webhook retries, and non-AI fallback messages are **not** counted.
3. **Usage Monitoring & Limit Warnings**:
   - Expose current `UsageRecord` counts vs. `limits` and warning flags (e.g., `>= 80%` threshold) in `/api/business` / dashboard banner so owners see approaching limits before hitting a hard block.

---

## 3. Backend Entitlement Enforcement

All limits must be enforced by **backend middleware/services**, never only in the Next.js UI:

| Resource / Feature | Enforcement Point | Limit Check | Error Response |
|---|---|---|---|
| **Active / Read-Only Subscription** | `requireActiveSubscription` (`requireWriteSubscription`) middleware + WhatsApp handler | `billingExempt === true` OR `status` in `['TRIALING', 'ACTIVE', 'PAST_DUE']` (and `nowUTC < trialEndsAt` for `TRIALING`). When `EXPIRED`: `GET` read/export endpoints remain **allowed**; `POST`/`PATCH`/`DELETE` write endpoints and WhatsApp business operations are **blocked** (`402/403 SUBSCRIPTION_EXPIRED`). | `402 / 403 SUBSCRIPTION_INACTIVE` |
| **Team Members** | `POST /api/business/members` | Count `BusinessMember` (`status !== 'REVOKED'`) `< plan.limits.maxTeamMembers` | `403 PLAN_LIMIT_EXCEEDED` |
| **Products** | `POST /api/inventory/products` & WhatsApp `ADD_PRODUCT` | Count `Product` (`status === 'ACTIVE'`) `< plan.limits.maxProducts` | `403 PLAN_LIMIT_EXCEEDED` |
| **Monthly AI Requests** | `aiExtractor` / `conversation.service.js` | `UsageRecord.aiRequestsCount < plan.limits.monthlyAiRequests` | Graceful WhatsApp quota message + `429/403` |
| **WhatsApp Usage** | `whatsapp.controller.js` / `conversation.service.js` | `UsageRecord.whatsappMessagesCount < plan.limits.monthlyWhatsappMessages` + `features.whatsappAssistant` | Graceful WhatsApp notice |
| **Advanced Reports** | `GET /api/reports/weekly`, `monthly`, `cash-flow`, `summary`, `inventory` | `plan.features.advancedReports === true` | `403 FEATURE_NOT_IN_PLAN` |

- **Snapshot vs. Plan Reference**: `Subscription` stores `subscriptionPlanId` (ref `SubscriptionPlan`) AND an `entitlementOverride` / snapshot (`usageLimits`) so the 3 approved 30-day pilot shops receive the exact approved pilot entitlement configuration even if public plan defaults change later.
- **Trial Expiry Policy**: When a 30-day `TRIALING` subscription reaches `trialEndsAt` (UTC) without conversion, paid business operations are restricted while read-only access and all historical business records remain intact for future reactivation.
