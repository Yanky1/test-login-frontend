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
