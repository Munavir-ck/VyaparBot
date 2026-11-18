# Staging Environment Variables

All environment variable names below are verified against `src/config/env.js`, `src/middleware/rate-limiter.js`, and `web/next.config.ts`. Never reuse production secrets in staging, and never commit actual secret values.

## 1. Render Backend Service (`root: .`)

| Variable | Purpose | Required? | Secret? | Staging Value / Example |
|---|---|---|---|---|
| `NODE_ENV` | Enables production security & transaction guards | Yes | No | `production` |
| `PORT` | HTTP port bound by `src/server.js` | Provided by Render | No | Render auto-injects (e.g. `10000`) |
| `SESSION_SECRET` | Signs `auth_session` cookies & hashes OTPs (>= 32 chars) | Yes | **Yes** | 64-char random hex string |
| `CORS_ORIGIN` | Allowed frontend origin(s) for CORS | Yes | No | `https://<frontend-service>.onrender.com` |
| `TRUST_PROXY` | Express proxy hop trust for `req.ip` | Yes | No | `1` |
| `MONGODB_URI` | MongoDB Atlas staging replica-set URI | Yes | **Yes** | `mongodb+srv://...` |
| `WHATSAPP_ACCESS_TOKEN` | Meta Cloud API bearer token | Yes (for live WA) | **Yes** | Staging Meta system token |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp sender phone ID | Yes (for live WA) | No | Staging phone number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta WABA ID | Optional | No | Staging WABA ID |
| `WHATSAPP_VERIFY_TOKEN` | Webhook GET verification token (non-default) | Yes | **Yes** | Random staging verify string |
| `WHATSAPP_APP_SECRET` | Verifies `X-Hub-Signature-256` on webhooks | Yes | **Yes** | Staging Meta app secret |
| `WHATSAPP_API_VERSION` | Meta Graph API version | Optional | No | `v21.0` |
| `WHATSAPP_API_BASE_URL` | Meta Graph API base URL | Optional | No | `https://graph.facebook.com` |
| `OPENAI_API_KEY` | GPT-4o-mini & Whisper extraction key | Yes (for live AI) | **Yes** | Staging OpenAI API key |
| `RATE_LIMIT_STORE` | Shared rate-limit backend (`mongo`) | Yes | No | `mongo` |
| `RATE_LIMIT_API_WINDOW_MS` | Global `/api` rate-limit window (ms) | Optional | No | `900000` |
| `RATE_LIMIT_API_MAX` | Global `/api` max requests per window | Optional | No | `300` |
| `RATE_LIMIT_OTP_REQUEST_WINDOW_MS` | OTP request window (ms) | Optional | No | `900000` |
| `RATE_LIMIT_OTP_REQUEST_MAX` | Max OTP requests per IP per window | Optional | No | `10` |
| `RATE_LIMIT_OTP_VERIFY_WINDOW_MS` | OTP verify window (ms) | Optional | No | `900000` |
| `RATE_LIMIT_OTP_VERIFY_MAX` | Max OTP verify attempts per IP per window | Optional | No | `15` |
| `RATE_LIMIT_MUTATION_WINDOW_MS` | Sensitive mutation window (ms) | Optional | No | `60000` |
| `RATE_LIMIT_MUTATION_MAX` | Max sensitive writes per client/user per window | Optional | No | `60` |
| `RATE_LIMIT_WEBHOOK_WINDOW_MS` | Webhook rate-limit window (ms) | Optional | No | `60000` |
| `RATE_LIMIT_WEBHOOK_MAX` | Max webhook POSTs per minute | Optional | No | `600` |
| `STORAGE_BUCKET` | S3/R2 bucket for receipt media | Optional | No | Staging bucket name |
| `STORAGE_REGION` | S3/R2 region | Optional | No | `ap-south-1` |
| `STORAGE_ACCESS_KEY` | S3/R2 access key | Optional | **Yes** | Staging access key |
| `STORAGE_SECRET_KEY` | S3/R2 secret key | Optional | **Yes** | Staging secret key |
| `STORAGE_ENDPOINT` | Custom S3-compatible endpoint (R2/MinIO) | Optional | No | Blank for AWS S3, or R2 URL |
| `DEFAULT_TIMEZONE` | Default business timezone | Optional | No | `Asia/Kolkata` |
| `DEFAULT_CURRENCY` | Default business currency | Optional | No | `INR` |

## 2. Render Frontend Service (`root: web`)

| Variable | Purpose | Required? | Secret? | Staging Value / Example |
|---|---|---|---|---|
| `NODE_ENV` | Next.js production build & runtime | Yes | No | `production` |
| `PORT` | Port bound by `next start -p ${PORT:-3001}` | Provided by Render | No | Render auto-injects (e.g. `10000`) |
| `NEXT_PUBLIC_BACKEND_URL` | Backend base URL used by `web/next.config.ts` `/api/:path*` rewrite (must be set before build) | Yes | No | `https://<backend-service>.onrender.com` |
