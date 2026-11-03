import { render, screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import AdminApp from './AdminApp'
import type { Me, Permission, StaffRole } from './api'

export const A = '*/api/v1/admin'

const READ: Permission[] = ['DashboardView', 'ApplicationsView', 'SellersView', 'UsersView', 'ModerationView', 'LookupsView', 'IntegrationsView', 'AuditView', 'SettingsView']
/** Mirrors the backend permission matrix (docs/ADMIN.md); the server stays the authority, the UI only hides what a role cannot use. */
export const PERMS: Record<StaffRole, Permission[]> = {
  ReadOnly: READ,
  Support: [...READ, 'UsersAct', 'SellersResendVerification', 'LookupsReveal', 'IntegrationsAct'],
  Moderator: [...READ, 'ModerationAct', 'ApplicationsDecide', 'ApplicationsAssign', 'SellersSuspend'],
  SuperAdmin: [...READ, 'ApplicationsDecide', 'ApplicationsAssign', 'SellersSuspend', 'SellersClose', 'SellersResendVerification', 'SellersTransferOwnership', 'UsersAct', 'UsersDisable2fa', 'ModerationAct', 'LookupsReveal', 'IntegrationsAct', 'IntegrationsDiscard', 'AuditExport', 'SettingsEdit', 'StaffView', 'StaffManage'],
}

export const emptyDash = {
  generatedAt: '2026-11-03T10:00:00Z',
  applications: { waiting: 3, pendingReview: 2, needsInfo: 1, oldestPendingDays: 5, averagePendingDays: 2.5 },
  sellers: { newLast7Days: 4, newLast30Days: 9, approved: 20, suspended: 1 },
  listings: { active: 120, activeServices: 14, hiddenByStaff: 2 },
  today: { orders: 7, bookings: 3 }, openReports: 2,
  integrations: { deadLetters: 1, retrying: 2, pending: 5, inboundRejectedLast24h: 4 },
  phone: { smsSentLast24h: 11, smsBlockedLast24h: 1, smsFailedLast24h: 0, phoneSignInsLast24h: 6 },
  trend: Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(21 + i).padStart(2, '0')}`, newSellers: i % 3, orders: i, bookings: i % 4 })),
}

/** Server side of a staff sign-in: the password step answers "code needed", the code step issues the token. */
export function mockSignIn(role: StaffRole, extra: Partial<{ twoFactorSetup: boolean; me: Partial<Me> }> = {}) {
  server.use(
    http.post(`${A}/auth/login`, async ({ request }) => {
      const b = (await request.json()) as { totpCode?: string; recoveryCode?: string }
      if (extra.twoFactorSetup) return HttpResponse.json({ code: 'two_factor_setup_required', title: 'Staff accounts need two-factor authentication.' }, { status: 403 })
      if (!b.totpCode && !b.recoveryCode) return HttpResponse.json({ error: 'Login failed', twoFactorRequired: true }, { status: 401 })
      return HttpResponse.json({ tokenType: 'Bearer', accessToken: 'staff-tok', expiresIn: 3600, email: 'staff@example.com', role, permissions: PERMS[role] })
    }),
    http.get(`${A}/auth/me`, () => HttpResponse.json({ userId: 'u-1', email: 'staff@example.com', role, permissions: PERMS[role], sessionExpiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idleMinutes: 15, stepUpUntil: null, ...extra.me })),
    http.post(`${A}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    http.get(`${A}/dashboard`, () => HttpResponse.json(emptyDash)),
  )
}

export function Loc() { const l = useLocation(); return <div data-testid="loc">{l.pathname + l.search}</div> }

export function mount(path = '/admin') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/*" element={<AdminApp />} /></Routes><Loc /></MemoryRouter>)
}

/** Goes through the real sign-in form (password, then the authenticator code). */
export async function signIn(role: StaffRole = 'SuperAdmin', path = '/admin', me?: Partial<Me>) {
  mockSignIn(role, { me })
  const user = userEvent.setup()
  mount(path)
  await user.type(await screen.findByLabelText('Email'), 'staff@example.com')
  await user.type(screen.getByLabelText('Password'), 'Some-Passw0rd!x')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.type(await screen.findByLabelText('Authenticator code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
  await screen.findByRole('navigation', { name: 'Staff areas' })
  return user
}

export async function waitForPath(p: string) { await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent(p)) }
