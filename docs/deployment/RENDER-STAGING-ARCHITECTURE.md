# Render Staging Architecture

This document describes the staging deployment architecture on **Render Free** services prior to AWS production deployment.

## 1. Topology

```text
Browser / Dashboard User
   │  HTTPS (same-origin cookies: auth_session, csrf_token)
   ▼
Render Web Service: Frontend (Next.js App Router, root: web/)
   │  Server-side rewrite: /api/:path* -> ${NEXT_PUBLIC_BACKEND_URL}/api/:path*
   ▼
Render Web Service: Backend (Node.js / Express, root: .)
   │  Mongoose ODM (ACID transactions + MongoRateLimitStore)
   ▼
MongoDB Atlas (M0 / Staging Cluster, Replica Set enabled)

Meta WhatsApp Cloud API ──POST /webhook/whatsapp──▶ Render Backend (X-Hub-Signature-256 verified)
OpenAI API ◀──────────────────────────────────────── Render Backend (Text/Vision/Whisper)
S3 / Cloudflare R2 (Optional) ◀───────────────────── Render Backend (Receipt media storage)
```

## 2. Why Same-Origin Next.js Rewrites Matter on Render

- `web/next.config.ts` proxies `/api/:path*` to `${NEXT_PUBLIC_BACKEND_URL}/api/:path*`.
- Because `web/src/lib/api-client.ts` calls relative `/api/...` paths, the browser communicates with a single origin (`https://<frontend>.onrender.com`).
- As a result, `auth_session` (`HttpOnly`, `SameSite=Lax`, `Secure`) and `csrf_token` (`SameSite=Lax`, `Secure`) cookies work without cross-site third-party cookie blocking.
- **Note on `NEXT_PUBLIC_BACKEND_URL`**: Because `next.config.ts` evaluates rewrites during `next build`, `NEXT_PUBLIC_BACKEND_URL` must be configured on the Render Frontend service **before** building.

## 3. Reverse Proxy & Rate Limiting

- Render terminates TLS and forwards requests to the Express backend through its load balancer.
- Set `TRUST_PROXY=1` on the Render Backend so Express `req.ip` resolves the client IP appended by Render's proxy without trusting client-spoofed `X-Forwarded-For` headers.
- `RATE_LIMIT_STORE=mongo` uses the shared `RateLimitBucket` TTL collection in MongoDB Atlas.
- **Proxy Nuance**: Dashboard requests proxied through Next.js `rewrites()` originate from the Frontend service's outbound IP(s). Monitor `RATE_LIMIT_API_MAX` (default `300` / 15 min) and `RATE_LIMIT_MUTATION_MAX` (default `60` / min) during staging QA so shared Next.js proxy traffic is not throttled.

## 4. Blueprint (`render.yaml`) Assessment

- A root `render.yaml` Blueprint is **optional and not required** for staging. Setting up the two Render Web Services manually via the Render Dashboard avoids committing service-specific URLs or coupling staging Render config to the repository before the AWS production infrastructure is provisioned.

## 5. Free-Tier Limitations & Risks

| Limitation | Impact on Staging | Mitigation |
|---|---|---|
| **Inactivity Sleep (15 min)** | Cold starts of 30–60s after idle periods. | First dashboard load or webhook after sleep may time out or lag. |
| **Meta Webhook Timeouts** | `whatsapp.controller.js` responds `200 OK` immediately, but if Render is asleep during cold start, Meta may retry. | `MessageLog` (`messageId` uniqueness) prevents duplicate processing of Meta retries. |
| **Ephemeral Filesystem** | Local files are wiped on redeploy/restart. | Verified: `src/` performs **no** local file writes; media uses memory buffers and optional S3/R2, and state lives in MongoDB. |
| **MongoDB Atlas M0 Limits** | Connection limits (500) and slower cold queries. | Mongoose `serverSelectionTimeoutMS: 5000` is configured in `src/config/database.js`. |
| **Background Jobs / Cron** | `src/jobs/` is empty; sleeping free services cannot run reliable in-process cron jobs. | Use external triggers or AWS EventBridge/ECS in production if scheduled jobs are added later. |
| **SMTP Restrictions** | Free tiers often restrict outbound SMTP ports. | Not impacted: OTP and notifications use WhatsApp Cloud API (HTTPS), not SMTP. |
