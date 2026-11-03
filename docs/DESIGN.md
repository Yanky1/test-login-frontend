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

