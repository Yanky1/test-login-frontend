# Solvelt seller portal – frontend

React + TypeScript + Vite SPA for seller sign-up / sign-in. Backend: <https://github.com/Yanky1/Yanky1-test-login-backend> (ASP.NET Core 10).

## Prerequisites
Node 22+. A running backend (see its README) for local use; the .NET 10 SDK for E2E tests.

## Run locally
```bash
npm ci
# backend (other terminal): in the backend repo
#   App__UseHttpsRedirection=false dotnet run --project src/Solvelt.Api --urls http://localhost:5080
npm run dev            # http://localhost:5173, proxies /api -> http://localhost:5080 (VITE_API_TARGET to change)
```
Same-origin proxying matters: the refresh token cookie is `SameSite=Strict`, scoped to `/api/v1/auth`.

## Tests
```bash
npm run lint && npm run typecheck
npm test               # Vitest + React Testing Library + MSW (wizard, branching, validation, idle logout, refresh gating, redirect-back, guards)
npm run e2e            # Playwright against the REAL backend (Testing env, SQLite, email sink, Turnstile stub) + real frontend
```
E2E needs the backend repo next to this one (`../Yanky1-test-login-backend`) or `BACKEND_DIR=/path`. Chromium: `npx playwright install chromium`, or set
`PW_CHROMIUM_PATH=/path/to/chrome` to use an existing binary. The suite covers signup wizard → pending, admin approval via API, login/logout/redirect-back,
lockout (2 tries left → last try + captcha → locked), forgot/reset, passkey register + sign-in (CDP virtual authenticator, incl. conditional UI), passkey signup, inactivity logout.

## Configuration (`public/config.json`, loaded at runtime – edit without rebuilding)
| key | meaning |
|---|---|
| `idleTimeoutMinutes` | idle time before auto-logout (default 15; keep below the backend `Session:IdleTimeoutMinutes`, default 20) |
| `warningSeconds` | how long before logout the countdown warning shows (default 60) |
| `refreshIntervalMinutes` | background token refresh cadence – only runs if the user was active (default 5) |
| `turnstileSiteKey` | optional override of the key served by the backend; `"stub"` renders a test button (E2E only) |
| `features.apple` | show "Continue with Apple" (also needs the backend flag) |

## Security notes
Sign-up gives no session until the emailed code is verified (step 2 is public). Activity, logout and token refresh are coordinated across tabs (BroadcastChannel + Web Locks), so an idle background tab cannot sign out an active one.
Access token is kept in memory only. The refresh token is an HttpOnly cookie; the SPA sends the `X-CSRF-Token` double-submit header on refresh/logout.
Redirect-after-login accepts same-origin relative paths only (`src/lib/safeNext.ts`).

## Deploy
`npm run build` → static files in `dist/`. Serve them from the same site as the API (reverse proxy `/api` to the backend), with a CSP such as
`default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; frame-ancestors 'none'`,
and ship `config.json` with production timings and `no-store` caching.
