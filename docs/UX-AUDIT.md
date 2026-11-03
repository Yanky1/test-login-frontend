# UX audit — Solvelt seller portal (sign-in / sign-up)

Method: screenshots at 390px and 1440px of the screens listed below (mocked API, `npm run test:ui`), plus axe-core (WCAG 2.2 AA tags) on each screen in light and dark.
Status legend: ✅ fixed · ⏳ deferred (reason given).

## High
| # | Area | Finding | Status |
|---|------|---------|--------|
| 1 | Hierarchy | Passkey / Google were afterthoughts below the form; the email path had no clear separation | ✅ Social/passkey first, "or continue with email" divider |
| 2 | Error handling | Lockout showed only a text line; no countdown, no way forward | ✅ Live m:ss countdown + "reset your password now" CTA |
| 3 | Accessibility | Wizard progress bar had no accessible name (axe `aria-progressbar-name`, serious) | ✅ `aria-label` added; axe clean on all screens |
| 4 | Visual bug | Empty alert rendered as an empty red bar on login | ✅ `Alert` only renders as a box when it has content |
| 5 | Dark mode | None; `color-scheme` forced to light | ✅ Tokens for light+dark, system default, manual toggle, no flash on load |
| 6 | Friction | Verify code was a plain text box | ✅ 6-cell OTP over ONE real input (paste/autofill/SMS work), `one-time-code` |
## Medium
| # | Finding | Status |
|---|---------|--------|
| 7 | No brand presence / trust signals on auth screens | ✅ Brand panel (desktop), logo, security & saved-progress copy |
| 8 | Password rules were a plain checklist | ✅ Strength meter + checklist (checklist remains the accessible source) |
| 9 | Wizard gave no reassurance about saved progress | ✅ "Your progress is saved" note on steps 2–5 |
| 10 | Wizard steps cramped on mobile | ✅ Only the current step label shows ≤559px; steps remain in DOM |
| 11 | Idle modal was abrupt | ✅ Calmer copy, reassurance, larger countdown |
| 12 | Inconsistent controls (heights ~34px, hard-coded colours, no hover/active states) | ✅ Tokens; 44px controls; hover/active/focus/busy states |
| 13 | Duplicate headers on signed-in pages | ✅ Single header; theme toggle lives in it |
| 14 | Settings loading state was bare text | ✅ Skeleton |
## Low / deferred
| # | Finding | Status |
|---|---------|--------|
| 15 | Field errors lacked an icon (colour-only cue) | ✅ ⚠ prefix |
| 16 | Reduced-motion not respected | ✅ global `prefers-reduced-motion` rule |
| 17 | Settings as cards with QR + recovery-code UX | ✅ `SettingCard` per area (icon, description, status chip), account header, QR code generated locally (`uqr`, secret never leaves the browser) with manual-key fallback, recovery codes with copy / download / "I have saved them" gate, device chip in sessions, empty states. Verified with the real-backend E2E |
| 18 | Review step edit links, wizard markup | ✅ Review sections are summary cards with pill "Edit" links (accessible name unchanged, described by the section heading). Business/kosher steps keep their markup: they were already clear and passed axe. **Email-first login: not done by design.** Passkey autofill (`webauthn`) and password managers work best with one visible form; splitting it adds a step for every sign-in |
| 19 | Email templates (backend `Templates.cs`) | ⏳ Out of scope by request (UI/UX only) |
| 20 | Real-backend Playwright E2E re-run + axe in E2E | ✅ 12/12 pass on the redesigned UI; axe (serious/critical) now also asserted in the E2E on signup, verify, business, kosher, review, pending, login and settings |
| 21 | Before screenshots | ✅ `docs/screenshots/before/` (pre-redesign commit `29fd0c8`, light, mobile + desktop) vs `docs/screenshots/` (after) |
| 22 | Auth screens did not read as a marketplace seller portal (generic brand copy, no seller value, no cross-link between sign-in and sign-up) | ✅ Seller panel (storefront mock-up, listing / payouts / buyer benefits, security line), "New to Solvelt? Start selling" / "Already selling? Sign in" top-bar CTA, benefits strip above the signup wizard, larger primary CTA |
| 23 | Pending screen was a plain paragraph | ✅ Calm hero icon, tracker, "What happens next" list |
