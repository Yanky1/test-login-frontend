import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import AuthCallback from './AuthCallback'
import SettingsPage from './Settings'
import { RequireAuth } from '../components/RequireAuth'
import { API, loginBody, server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'

describe('provider sign-in with 2FA', () => {
  const ui = (<Routes><Route path="/auth/callback" element={<AuthCallback />} /><Route path="/" element={<div>home</div>} /></Routes>)

  it('asks for the authenticator code instead of signing in, then completes', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    server.use(http.post(`${API}/auth/external/exchange`, async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>; bodies.push(b)
      return b.totpCode === '123456' ? HttpResponse.json(loginBody()) : HttpResponse.json({ error: 'Login failed', twoFactorRequired: true, hint: {} }, { status: 401 })
    }))
    renderAt(ui, '/auth/callback?code=abc')
    expect(await screen.findByText(/Enter the code from your authenticator app/)).toBeInTheDocument()
    expect(screen.queryByText('home')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Authentication code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/That code is not right/)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Authentication code'))
    await user.type(screen.getByLabelText('Authentication code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(bodies[0]).toEqual({ code: 'abc' })
    expect(bodies.at(-1)).toMatchObject({ code: 'abc', totpCode: '123456' })
  })

  it('accepts a recovery code too', async () => {
    const user = userEvent.setup()
    server.use(http.post(`${API}/auth/external/exchange`, async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>
      return b.recoveryCode ? HttpResponse.json(loginBody()) : HttpResponse.json({ error: 'Login failed', twoFactorRequired: true, hint: {} }, { status: 401 })
    }))
    renderAt(ui, '/auth/callback?code=abc')
    await user.click(await screen.findByRole('button', { name: 'Use a recovery code' }))
    await user.type(screen.getByLabelText('Recovery code'), 'ABCDE-12345')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('home')).toBeInTheDocument()
  })
})

describe('change email step-up for passwordless accounts', () => {
  const ui = (<Routes><Route element={<RequireAuth />}><Route path="/settings/:tab?" element={<SettingsPage />} /></Route></Routes>)
  const me = (over: Record<string, unknown> = {}) => ({ email: 'seller@example.com', emailConfirmed: true, hasPassword: false, twoFactorEnabled: false, passkeyCount: 1, logins: ['Google'], sellerStatus: 'Draft', vendorName: null, ...over })

  it('first request only triggers a code to the current address; the second sends it along', async () => {
    const user = userEvent.setup()
    signedIn()
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.get(`${API}/account/me`, () => HttpResponse.json(me())),
      http.get(`${API}/account/passkeys`, () => HttpResponse.json([])),
      http.get(`${API}/account/sessions`, () => HttpResponse.json([])),
      http.post(`${API}/account/email/change`, async ({ request }) => {
        const b = (await request.json()) as Record<string, unknown>; bodies.push(b)
        return b.stepUpCode ? HttpResponse.json({ message: 'sent' }, { status: 202 }) : HttpResponse.json({ stepUpRequired: true }, { status: 202 })
      }),
    )
    renderAt(ui, '/settings/security')
    await user.type(await screen.findByLabelText('New email'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Send verification code' }))
    expect(await screen.findByText(/We sent a confirmation code to/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/Confirmation code/), '654321')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/We sent a code to new@example.com/)).toBeInTheDocument()
    expect(bodies[0].stepUpCode).toBeUndefined()
    expect(bodies[1]).toMatchObject({ newEmail: 'new@example.com', stepUpCode: '654321' })
  })
})
