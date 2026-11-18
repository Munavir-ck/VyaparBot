# Render Frontend Setup (Staging)

## 1. Service Configuration

- **Service Type**: Web Service
- **Runtime**: Node.js (`>=20.0.0`)
- **Branch**: `main` (or dedicated `staging` branch)
- **Root Directory**: `web`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start` (runs `next start -p ${PORT:-3001}`)
- **Health Check Path**: `/login` (or `/`)
- **Plan**: Free (Staging only)

## 2. Backend API Communication

- `web/next.config.ts` rewrites `/api/:path*` to `${NEXT_PUBLIC_BACKEND_URL}/api/:path*`.
- Set `NEXT_PUBLIC_BACKEND_URL=https://<backend-service>.onrender.com` (no trailing slash) in the Render Frontend environment variables **before** triggering a build.
- Because all dashboard requests use relative `/api/...` paths via `web/src/lib/api-client.ts`, browser sessions (`auth_session` and `csrf_token` cookies) remain same-origin on `https://<frontend-service>.onrender.com`.

## 3. Port Binding

- Render injects `PORT` (typically `10000`) at runtime.
- `web/package.json` uses `next start -p ${PORT:-3001}`, which binds to Render's `$PORT` in cloud environments while defaulting to `3001` for local development.

## 4. Verification After Deploy

1. Open `https://<frontend-service>.onrender.com/login`.
2. Confirm `/api/auth/me` returns `401` (not `404` or `502`), verifying the Next.js rewrite reaches the Render Backend.
3. Complete OTP login, onboarding, and a mutation (e.g., add product) to confirm `auth_session` (`HttpOnly`, `Secure`, `SameSite=Lax`) and `x-csrf-token` work end-to-end.
