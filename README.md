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
npm run e2e            # Playwright against the REAL backend (Testing env, SQLite, email sink, Turnstile stub) + real frontend; includes the phone number/PIN cards and texted links (signed SMS webhooks, `Phone__Enabled=true`)
```
E2E needs the backend repo next to this one (`../Yanky1-test-login-backend`) or `BACKEND_DIR=/path`. Chromium: `npx playwright install chromium`, or set
`PW_CHROMIUM_PATH=/path/to/chrome` to use an existing binary. The suite covers signup wizard → pending, admin approval via API, login/logout/redirect-back,
lockout (2 tries left → last try + captcha → locked), forgot/reset, passkey register + sign-in (CDP virtual authenticator, incl. conditional UI), passkey signup, inactivity logout.

## Seller orders and messages
Sidebar entries **Orders** and **Messages** (with badges): `/orders` (tabs, search, filters, bulk accept / packing slips / CSV tracking upload / export, at-a-glance tiles), `/orders/:id` (ship in full or part, tracking, cancel, refund, returns, notes, buyer messages), `/messages` (one inbox for order and pre-sale questions, saved replies, attachments, assignment, internal notes), Settings → Notifications, and `/dev/simulator` (dev server only: creates test orders and simulates buyer events). Live updates use one fetch-based event stream with a 30 s polling fallback. Backend contract: `docs/ORDERS.md` in the backend repo; design notes: `docs/DESIGN.md`. E2E needs the backend checkout (`BACKEND_DIR`, default `../Yanky1-test-login-backend`) and runs it in the Testing environment, where the simulator and the dev sink exist.

## Seller products
Sidebar area for the catalog: `/products` (list, inline edit, bulk actions), `/products/new` and `/products/:id` (one-page editor with autosave, buyer preview and a publish checklist), `/questions` and `/products/import` (CSV). Design notes in `docs/DESIGN.md`; API in the backend's `docs/PRODUCTS.md`. The real-backend E2E (`npm run e2e`) needs the backend `main` (it uses the Testing-only `/api/dev/questions`).

## Seller assistant
A chat assistant in the header ("Assistant"): a drawer on desktop, full screen on a phone. It streams answers (SSE), shows what it is looking up, links to the listings/orders it mentions, and **prepares changes as "Do this?" cards that only happen when you press Confirm** (Viewers see no action buttons and an explanation). Code: `src/assistant/**`; backend and safety model: `docs/ASSISTANT.md` in the backend repository; UI decisions: `docs/DESIGN.md` ("Seller assistant"). Tests: `src/assistant/assistant.test.tsx` (Vitest + MSW) and `e2e/assistant.spec.ts` (real backend with the scripted fake model, axe; needs `Orders__InboundSecret` etc. from `playwright.config.ts`). Screenshots: `docs/screenshots/assistant-*.png`.

## Staff admin area
`/admin` is a separate, code-split back-office for Solvelt staff (own shell and sign-in; it does not share the seller session): staff sign-in with two-factor, dashboard, seller applications queue and review (with the kosher certificate), seller accounts, users, moderation, support lookups (personal data masked, reveal with a reason), integration health (dead letters), audit log (filters, CSV export), platform settings (fee, legal versions, application questions with a branching preview) and staff management. Every action asks for a reason; sensitive ones ask for the authenticator code again. What each role sees mirrors the backend's permission matrix (`docs/ADMIN.md` in the backend repository), which remains the authority. Design notes: `docs/DESIGN.md` ("Staff admin area"); screenshots `docs/screenshots/admin-*`.
The staff token lives in memory only and is not refreshed, so reloading the page signs staff out on purpose.

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

## Teams, roles and brands
One login can belong to several seller accounts (Owner / Admin / Manager / Viewer) and each account can have several brands.
After sign-in you choose an account (or are taken straight in when there is only one); switch accounts and filter by brand from the top bar.
Settings → **Team** (invite by email, change role/brand access, remove, transfer ownership) and Settings → **Brands**; invitation links open `/invite/<token>`.
Design notes: `docs/DESIGN.md`; backend model, permission matrix and API: `docs/TEAMS.md` in the backend repository. Screenshots: `docs/screenshots/` (`choose-account`, `no-accounts`, `team`, `team-invite-modal`, `brands`, `brand-edit-modal`, `account-switcher`, `invite-new-user`, `invite-expired`, desktop and mobile).
