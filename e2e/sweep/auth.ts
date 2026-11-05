import type { BrowserContext } from '@playwright/test'
import { baseConfig } from '../helpers'
import { totp } from '../totp'
import { STAFF_ROLES, type Account, type Role } from './kit'

export const sweepConfig = { ...baseConfig, idleTimeoutMinutes: 600 }   // a sweep test is long; the idle guard must not sign the account out mid-run

/** A context signed in as `role` (cookies only: the access token lives in memory and is renewed from the refresh cookie on every page load). */
export async function signInContext(context: BrowserContext, role: Role, acc?: Account): Promise<void> {
  await context.route('**/config.json', (r) => r.fulfill({ json: sweepConfig }))
  if (role === 'anon' || !acc) return
  const staff = STAFF_ROLES.includes(role)
  const res = await context.request.post(staff ? '/api/v1/admin/auth/login' : '/api/v1/auth/login', {
    data: staff ? { email: acc.email, password: acc.password, totpCode: totp(acc.secret!) } : { email: acc.email, password: acc.password },
  })
  if (!res.ok()) throw new Error(`sweep sign-in as ${role} failed: ${res.status()} ${await res.text()}`)
}

/** Theme: the app reads localStorage "solvelt-theme" (set before any script runs) and the OS colour scheme. */
export async function setTheme(context: BrowserContext, theme: 'light' | 'dark'): Promise<void> {
  await context.addInitScript((t) => { try { localStorage.setItem('solvelt-theme', t) } catch { /* storage blocked */ } }, theme)
}
