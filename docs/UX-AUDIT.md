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
| 17 | Settings as sections/cards with QR + recovery-code UX redesign | ⏳ Restyled with tokens only; a structural redesign needs the real 2FA/passkey flows exercised against the backend (not attachable in this session) |
| 18 | Review step edit links, email-first login, wizard business/kosher markup | ⏳ Restyled only; markup left unchanged to avoid breaking the 76 unit tests without a backend E2E run |
| 19 | Email templates (backend `Templates.cs`) | ⏳ Backend repo could not be attached (permission denied for `add_repo`) |
| 20 | Real-backend Playwright E2E re-run + axe in E2E | ⏳ Same reason. Axe runs in the mocked UI suite instead |
| 21 | Before screenshots | ⏳ Not captured; only "after" are in `docs/screenshots/` |
