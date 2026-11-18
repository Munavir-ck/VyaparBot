# Render Backend Setup (Staging)

## 1. Service Configuration

- **Service Type**: Web Service
- **Runtime**: Node.js (`>=20.0.0`, per `package.json` `engines.node`)
- **Branch**: `main` (or dedicated `staging` branch)
- **Root Directory**: `.` (repository root)
- **Build Command**: `npm install`
- **Start Command**: `npm start` (runs `node src/server.js`)
- **Health Check Path**: `/health`
- **Plan**: Free (Staging only)

## 2. Startup & Runtime Verification

- `src/server.js` calls `validateProductionEnv()` before connecting to MongoDB or binding `env.PORT` (`process.env.PORT || 3000`).
- If `NODE_ENV=production` is set on Render staging, **all** mandatory production environment variables (`SESSION_SECRET` >= 32 chars, `WHATSAPP_APP_SECRET`, non-default `WHATSAPP_VERIFY_TOKEN`, `MONGODB_URI`, `CORS_ORIGIN`, `RATE_LIMIT_STORE != memory`) must be present or the process will exit safely.
- `src/utils/db-transaction.js` requires a MongoDB replica set (such as MongoDB Atlas) when `NODE_ENV=production` and disables standalone non-transactional fallbacks.
- `GET /health` returns HTTP `200` (`{ status: 'healthy', database: { isConnected: true } }`) once MongoDB is connected, or `503` if disconnected.

## 3. Meta WhatsApp Webhook Configuration

1. After deploying the backend, note its Render URL: `https://<backend-service>.onrender.com`.
2. In the Meta Developer Portal (WhatsApp -> Configuration):
   - **Callback URL**: `https://<backend-service>.onrender.com/webhook/whatsapp`
   - **Verify Token**: Must match `WHATSAPP_VERIFY_TOKEN` set on Render.
3. `POST /webhook/whatsapp` enforces `X-Hub-Signature-256` verification using `WHATSAPP_APP_SECRET` in `NODE_ENV=production` (returns `503` if unset, `401` if invalid).

## 4. Security Notes

- Never use `x-user-phone` header authentication in staging (`NODE_ENV=production` disables it automatically in `src/middleware/auth.middleware.js`).
- Set `TRUST_PROXY=1` so Express `req.ip` accurately reads the client IP behind Render's reverse proxy.
