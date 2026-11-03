# Solvelt design system

## Principles
1. Calm and trustworthy: auth screens do one thing; the primary action is always the strongest element.
2. Never lose input; say what to do next in plain words.
3. Accessible by construction: 44px targets, visible focus, labels, errors with icon+text+`aria-live`, reduced motion.
4. Small footprint: no UI framework, system font stack (no webfont, no layout shift), inline SVG icons.

## Tokens (`src/styles.css`, `:root`)
- Colour: `--bg --surface --surface-2 --fg --muted --border --primary --accent --err --ok …` Light by default; dark via `prefers-color-scheme` and `[data-theme=dark]`. A manual toggle persists to `localStorage` (`solvelt-theme`); an inline script in `index.html` applies it before paint.
- Type: fluid `--fs-sm … --fs-2xl` using `clamp()`.
- Spacing: 8-pt grid `--s1…--s8` (plus a 4px half-step). Radius `--r-*`, shadow `--shadow-*`, motion `--t-*`/`--ease`.

## Components (`src/components/ui.tsx`)
Button (primary/secondary/ghost/destructive, loading), Field (label, hint, error), PasswordField (show/hide) + StrengthMeter, OtpInput, Checkbox/Select (styled natively), Card, Shell (brand panel + top bar), Alert (aria-live), Modal (idle/passkey dialogs), Stepper (`ProgressBar`, tracker), Skeleton, Spinner, Icon set, ThemeToggle, SettingCard (account page cards + status chips).

## Decisions
- Class names (`btn`, `field`, `alert`…) were kept so existing behaviour and 76 unit tests stay valid; styling and structure were redesigned underneath.
- OTP is one real `<input>` with a visual 6-cell overlay: paste, SMS autofill and screen readers work with no focus juggling.
- Marketplace look: seller panel (storefront mock-up + benefits) on desktop, "Start selling" / "Sign in" cross-link in the top bar, benefits strip above the wizard. Copy is placeholder, with no invented fees or numbers.
- Dependencies added: `@axe-core/playwright` (dev) and `uqr` (~tiny, no deps) so the 2FA QR is drawn locally. Icons are hand-inlined lucide-style paths rather than a package.
- Security behaviour untouched: token handling, CSRF, multi-tab coordination, 2FA prompts, step-up, redirect safety.
- Tests: `npm test` (Vitest), `npm run test:ui` (mocked-API Playwright + axe, light/dark, 390/1440), `npm run e2e` (real backend).
- Route-level code splitting: Settings and the authed wizard steps (business, kosher, review, pending) and Guest are `React.lazy` chunks behind one `Suspense` spinner.
- Theme bootstrap lives in `public/theme.js` (external script) so it works under a strict `script-src 'self'` CSP; `ThemeToggle` also reads the saved choice itself. Covered by a Vitest test and a CSP-header UI test against the production build.
- `ErrorBoundary` wraps the lazy routes: a chunk-load failure after a deploy shows a "Reload" card instead of a blank page.
- Signed-in pages render a single header (`AppHeaderContext` tells `Shell` not to add its own logo + theme toggle).

## Phone number, Phone PIN and texted links
- Settings → Security has a **Phone number** card (add or change with a texted code, remove) and a **Phone PIN** card (set or change, with the same strength rules as the server: 6 digits, no repeated digit, no sequence, no repeating pattern; `src/lib/pin.ts`). Both use `SettingCard`, `Field`, `PasswordField`, `Alert`; code in `src/pages/PhoneSettings.tsx`.
- Step-up is the server's: password for password accounts; otherwise a code (emailed while there is no number yet, texted to the current number afterwards). Field labels are unique on the page (`Password to confirm`, `Password to confirm PIN change`) so assistive tech and tests can tell the cards apart.
- `/l/<token>` (`src/pages/PhoneLink.tsx`) is the landing page of the links we text. A reset link redeems once (shared in-flight request, StrictMode-safe) and continues to `/reset-password`; a phone sign-up link shows "Finish creating your account" (email, password, Terms) and continues to email verification; anything else explains that the link is invalid, expired or used.
- Tests: `src/pages/phone.test.tsx` (Vitest), mocked-UI Playwright screens with axe in light/dark and mobile/desktop (`settings-phone-add`, `settings-phone-set`, `phone-link-finish`, `phone-link-expired`), and real-backend `e2e/phone.spec.ts` (signed SMS webhooks against the Testing backend; needs `Phone__Enabled=true`, set in `playwright.config.ts`).

## Teams, roles & brands (feature D)
- **Account model in the UI:** `useAuth()` exposes `user.accounts`, `user.activeAccountId`, `user.role`, `switchAccount()` and `refreshAccounts()`. `accounts === null` means an old server without accounts (no gate is shown). The access token carries the active account; the server re-validates the membership on every request.
- **Account picker / empty state** (`pages/teams/ChooseAccount.tsx`): shown by `RequireAuth` whenever the user has no active account (several accounts, or none); exactly one account is opened automatically. Also at `/accounts` (reached from the switcher's "All accounts" / "Create a new seller account"). Pending invitations (Accept/Decline) and "Create a new seller account" (terms checkbox) live on the same screen. A `403 no_active_account` from any call (membership removed) triggers `refreshAccounts()`, which brings the user back here.
- **Switchers** (header): `AccountSwitcher` (current account + role badge, list, create, all accounts) and `BrandSwitcher` (a "Brand" filter, only when ≥ 2 brands; remembered per account in `sessionStorage`; read it with `useBrands()` in product screens later). The page tree is keyed by the active account, so every screen reloads after a switch.
- **Settings → Team / Brands** are tabs in the existing Settings page (lazy chunks). Team: Owner/Admin only; members table that becomes cards below 720px (explicit ARIA table roles keep it a table for assistive tech), invite / change role+scope / remove / leave / transfer ownership dialogs, pending invitations with resend/revoke. Brands: everyone can look, Owner/Admin manage (add/edit with logo preview and client-side type/size checks, archive/restore; the last active brand can't be archived). Actions the role can't do are **hidden**; the server remains the authority (`lib/teams.ts` mirrors the permission matrix for hints only).
- **Dialogs:** `components/Dialog.tsx`: labelled, focus moves in and returns, Tab is trapped, Escape closes. Role descriptions are plain-language (`ROLE_DESC`).
- **Invite pages** (`/invite/:token`, public): states pending / expired / revoked / used / declined / unknown; signed out → join form with the email pre-filled and locked (no seller wizard; the link proves the mailbox) or "I already have a login"; signed in → Accept / Decline, and a clear "wrong email" screen with sign-out. Non-owner members land on Settings → Brands (they don't fill in the seller application).
- **Buttons with context** use a visible short label plus an `sr-only` suffix (e.g. "Remove" + " dov@example.com") so the accessible name contains the visible text (WCAG 2.5.3).
- **Tests:** Vitest `pages/teams/teams.test.tsx` (picker, switchers, Team, Brands, invite states), mocked Playwright + axe `e2e-ui/teams.ui.spec.ts` (9 screens × 390/1440 × light/dark, screenshots with `SHOTS_DIR=docs/screenshots`), real-backend `e2e/teams.spec.ts` (invite → join → scoped view, two accounts → picker → switch, removal denied on the next action, 320px dark mode), each with axe.
