# Staging Deployment Checklist

## Pre-Deployment
- [ ] Create isolated MongoDB Atlas staging database (`vyaparbot_staging`) with least-privilege `readWrite` user.
- [ ] Generate staging-only `SESSION_SECRET` (64-char hex) and `WHATSAPP_VERIFY_TOKEN` (never reuse production secrets).
- [ ] Confirm `NODE_ENV=production`, `TRUST_PROXY=1`, `RATE_LIMIT_STORE=mongo` are configured on Render Backend.
- [ ] Confirm `WHATSAPP_APP_SECRET` is configured (required for `POST /webhook/whatsapp` in `NODE_ENV=production`).

## Deploy Backend First
- [ ] Create Render Web Service (`root: .`, build: `npm install`, start: `npm start`, health check: `/health`).
- [ ] Set all Backend environment variables from `STAGING-ENVIRONMENT-VARIABLES.md`.
- [ ] Verify `GET https://<backend-service>.onrender.com/health` returns `200` with `database.isConnected: true`.

## Deploy Frontend Second
- [ ] Create Render Web Service (`root: web`, build: `npm install && npm run build`, start: `npm start`, health check: `/login`).
- [ ] Set `NEXT_PUBLIC_BACKEND_URL=https://<backend-service>.onrender.com` **before** the initial build.
- [ ] Update `CORS_ORIGIN=https://<frontend-service>.onrender.com` on the Render Backend if the frontend URL was not known beforehand.

## Post-Deployment Smoke Tests
- [ ] Open `https://<frontend-service>.onrender.com/login` and verify WhatsApp OTP login + `auth_session` + `csrf_token` cookies.
- [ ] Complete business onboarding (`OWNER` role assigned) and verify `/money`, `/products`, `/customers`, `/suppliers`, `/reports/financial`, `/settings/team`.
- [ ] Configure Meta WhatsApp Developer Webhook URL (`https://<backend-service>.onrender.com/webhook/whatsapp`) and verify GET challenge + signed POST message.
- [ ] Verify logout invalidates the session token (`GET /api/auth/me` returns `401`).
