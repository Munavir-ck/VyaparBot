# VyaparBot – Render Staging Deployment Guide

## 1. Deployment Order
1. **MongoDB Atlas Staging Cluster**
2. **Render Backend Web Service** (`root: .`)
3. **Render Frontend Web Service** (`root: web`)
4. **Update Backend `CORS_ORIGIN`** with Frontend Render URL
5. **Bootstrap `PLATFORM_ADMIN` & Run Pre-SaaS Grandfathering (if existing data)**
6. **Configure Meta WhatsApp Webhook**
7. **Run Smoke Tests**

---

## 2. MongoDB Atlas Setup
1. Create a dedicated **Staging** cluster (M0 Free or M10 — 3-node replica set is built-in, required by `src/utils/db-transaction.js` when `NODE_ENV=production`).
2. Create database `vyaparbot_staging` and a dedicated user with `readWrite` scoped to `vyaparbot_staging`.
3. Connection string format:
   ```text
   mongodb+srv://<user>:<password>@<staging-cluster>.mongodb.net/vyaparbot_staging?retryWrites=true&w=majority
   ```
4. Network Access: For Render Free (dynamic outbound IPs), allow `0.0.0.0/0` for staging only with strong rotated credentials (restrict to VPC CIDR in AWS production).

---

## 3. Render Backend Service Configuration
- **Service Type**: Web Service (`Node.js >= 20`)
- **Branch**: `main`
- **Root Directory**: `.`
- **Build Command**: `npm install`
- **Start Command**: `npm start` (`node src/server.js`)
- **Health Check Path**: `/health`

---

## 4. Render Frontend Service Configuration
- **Service Type**: Web Service (`Node.js >= 20`)
- **Branch**: `main`
- **Root Directory**: `web`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start` (`next start -p ${PORT:-3001}`)
- **Health Check Path**: `/login`

---

## 5. Complete Environment Variable Checklist

### Backend (`.`)
- `NODE_ENV=production`
- `SESSION_SECRET` (64-char random hex; >= 32 chars required)
- `CORS_ORIGIN=https://<frontend-service>.onrender.com`
- `TRUST_PROXY=1`
- `MONGODB_URI=mongodb+srv://...`
- `RATE_LIMIT_STORE=mongo`
- `WHATSAPP_APP_SECRET` (required in production; enforces `X-Hub-Signature-256`)
- `WHATSAPP_VERIFY_TOKEN` (custom non-default random string)
- `WHATSAPP_ACCESS_TOKEN` (Meta Cloud API token)
- `WHATSAPP_PHONE_NUMBER_ID` (Meta phone number ID)
- `OPENAI_API_KEY` (OpenAI API key; 20s timeout configured)
- Optional: `RATE_LIMIT_*`, `STORAGE_*` (S3/R2), `DEFAULT_TIMEZONE=Asia/Kolkata`, `DEFAULT_CURRENCY=INR`

### Frontend (`web/`)
- `NODE_ENV=production`
- `NEXT_PUBLIC_BACKEND_URL=https://<backend-service>.onrender.com` *(must be set **before** `npm run build`)*

---

## 6. WhatsApp & OpenAI Configuration
1. In Meta Developer Portal -> WhatsApp -> Configuration:
   - Callback URL: `https://<backend-service>.onrender.com/webhook/whatsapp`
   - Verify Token: exact value of `WHATSAPP_VERIFY_TOKEN`
2. Subscribe to `messages` webhook field.
3. Verify `OPENAI_API_KEY` has active billing/quota for GPT-4o-mini and Whisper.

---

## 7. Health-Check Verification
- `GET https://<backend-service>.onrender.com/health` must return HTTP `200` with `{ "status": "healthy", "database": { "isConnected": true } }`.
- `GET https://<frontend-service>.onrender.com/api/auth/me` (unauthenticated) must return HTTP `401` (verifying Next.js `/api/*` rewrite reaches Backend).

---

## 8. Smoke-Testing Checklist
- [ ] OTP login on `/login` (`auth_session` + `csrf_token` cookies set as `Secure`, `SameSite=Lax`).
- [ ] Business onboarding on `/onboarding` (creates `OWNER`).
- [ ] Record a sale on `/money`, create a product on `/products`, view `/reports/financial`.
- [ ] Log in as `PLATFORM_ADMIN`, open `/admin`, `/admin/pilot`, `/admin/businesses`, `/admin/usage`, `/admin/billing`.
- [ ] Grant 30-day pilot access to 1 test shop and verify `GET /api/admin/pilot/summary`.
- [ ] Send a signed WhatsApp test message and verify it appears in the dashboard.

---

## 9. Rollback Procedure
1. In Render Dashboard -> Events/Deploys on the affected service, click **Rollback to previous deploy**.
2. If a database migration or pilot grant caused issues, inspect `Subscription.statusHistory` and restore via `/api/admin/*` or Atlas point-in-time snapshot (no destructive automated down-migrations are run at startup).

---

## 10. Known Render Free-Tier Limitations
- **15-minute inactivity sleep & 30–60s cold starts**: First request or webhook after sleep may lag; `MessageLog` deduplicates Meta retries.
- **Shared Next.js proxy IP**: Dashboard `/api/*` rewrites originate from the Frontend service IP; monitor `RATE_LIMIT_API_MAX` (`300`/15m) during multi-user testing.
- **Ephemeral filesystem**: Verified safe (`src/` performs no local disk writes).
- **No in-process cron**: Sleeping instances cannot run scheduled background jobs.
