import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router-dom'
import SettingsPage from './Settings'
import PhoneLinkPage from './PhoneLink'
import { RequireAuth } from '../components/RequireAuth'
import { pinChecks, pinValid } from '../lib/pin'
import { API, server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'

const me = (over: Record<string, unknown> = {}) => ({ email: 'seller@example.com', emailConfirmed: true, hasPassword: true, twoFactorEnabled: false, passkeyCount: 0, logins: [], sellerStatus: 'Draft', vendorName: null, ...over })
const settings = (<Routes><Route element={<RequireAuth />}><Route path="/settings/:tab?" element={<SettingsPage />} /></Route></Routes>)

function mockAccount(opts: { me?: Record<string, unknown>; phone?: { hasNumber: boolean; numberEnding: string | null; hasPin: boolean } } = {}) {
  const state = { phone: opts.phone ?? { hasNumber: false, numberEnding: null, hasPin: false } }
  server.use(
    http.get(`${API}/account/me`, () => HttpResponse.json(me(opts.me))),
    http.get(`${API}/account/passkeys`, () => HttpResponse.json([])),
    http.get(`${API}/account/sessions`, () => HttpResponse.json([])),
    http.get(`${API}/account/phone`, () => HttpResponse.json(state.phone)),
  )
  return state
}

describe('pin rules (mirror of the backend)', () => {
  it('accepts a good PIN and rejects trivial ones', () => {
    expect(pinValid('739204')).toBe(true)
    for (const bad of ['111111', '123456', '654321', '121212', '123123', '12345', '1234567', 'abcdef', '']) expect(pinValid(bad)).toBe(false)
    expect(pinChecks('111111').find((c) => c.label.startsWith('Not one digit'))!.ok).toBe(false)
  })
})

describe('Settings → Security: phone number card', () => {
  it('adds a number with the current password and a texted code', async () => {
    const user = userEvent.setup(); signedIn()
    const st = mockAccount()
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.post(`${API}/account/phone/start`, async ({ request }) => { bodies.push((await request.json()) as Record<string, unknown>); return HttpResponse.json({ message: 'sent' }, { status: 202 }) }),
      http.post(`${API}/account/phone/verify`, async ({ request }) => {
        const b = (await request.json()) as { code: string }
        if (b.code !== '123456') return HttpResponse.json({ title: 'That code isn\'t right or has expired.', status: 400 }, { status: 400 })
        st.phone = { hasNumber: true, numberEnding: '0123', hasPin: false }
        return HttpResponse.json({ numberEnding: '0123' })
      }),
    )
    renderAt(settings, '/settings/security')
    expect(await screen.findByRole('heading', { name: 'Phone number' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Add a mobile number' }))
    await user.type(screen.getByLabelText('Mobile number'), '(415) 555-0123')
    await user.type(screen.getByLabelText('Password to confirm'), 'Tr1cky-Horse-Battery!')
    await user.click(screen.getByRole('button', { name: 'Text me a code' }))
    await user.type(await screen.findByLabelText('Verification code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Verify number' }))
    expect(await screen.findByText(/isn't right or has expired/)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Verification code'))
    await user.type(screen.getByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify number' }))
    expect(await screen.findByText(/ending 0123 is verified/)).toBeInTheDocument()
    expect(bodies[0]).toMatchObject({ phoneNumber: '(415) 555-0123', currentPassword: 'Tr1cky-Horse-Battery!' })
    expect(await screen.findByText('Ends 0123')).toBeInTheDocument()
  })

  it('a passwordless account first confirms with a code, then the number is texted', async () => {
    const user = userEvent.setup(); signedIn()
    mockAccount({ me: { hasPassword: false } })
    const bodies: Record<string, unknown>[] = []
    server.use(http.post(`${API}/account/phone/start`, async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>; bodies.push(b)
      return b.stepUpCode ? HttpResponse.json({ message: 'sent' }, { status: 202 }) : HttpResponse.json({ stepUpRequired: true, message: 'We emailed a confirmation code to your address.' }, { status: 202 })
    }))
    renderAt(settings, '/settings/security')
    await user.click(await screen.findByRole('button', { name: 'Add a mobile number' }))
    expect(screen.queryByLabelText('Password to confirm')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Mobile number'), '4155550123')
    await user.click(screen.getByRole('button', { name: 'Text me a code' }))
    expect(await screen.findByText(/We emailed a confirmation code/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email confirmation code'), '654321')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByLabelText('Verification code')).toBeInTheDocument()
    expect(bodies[0].stepUpCode).toBeUndefined()
    expect(bodies[1]).toMatchObject({ phoneNumber: '4155550123', stepUpCode: '654321' })
  })

  it('shows a wrong password and a server validation message', async () => {
    const user = userEvent.setup(); signedIn(); mockAccount()
    server.use(http.post(`${API}/account/phone/start`, async ({ request }) => {
      const b = (await request.json()) as { phoneNumber: string }
      return b.phoneNumber === '123' ? HttpResponse.json({ errors: { phoneNumber: ['Enter a valid mobile number.'] }, status: 400 }, { status: 400 })
        : HttpResponse.json({ title: 'Your current password isn\'t correct.', status: 400, code: 'wrong_password' }, { status: 400 })
    }))
    renderAt(settings, '/settings/security')
    await user.click(await screen.findByRole('button', { name: 'Add a mobile number' }))
    await user.type(screen.getByLabelText('Mobile number'), '123')
    await user.type(screen.getByLabelText('Password to confirm'), 'x')
    await user.click(screen.getByRole('button', { name: 'Text me a code' }))
    expect(await screen.findByText('Enter a valid mobile number.')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Mobile number')); await user.type(screen.getByLabelText('Mobile number'), '4155550123')
    await user.click(screen.getByRole('button', { name: 'Text me a code' }))
    expect(await screen.findByText(/current password isn't correct/)).toBeInTheDocument()
  })

  it('removes the number with step-up', async () => {
    const user = userEvent.setup(); signedIn()
    const st = mockAccount({ phone: { hasNumber: true, numberEnding: '0123', hasPin: true } })
    const bodies: Record<string, unknown>[] = []
    server.use(http.post(`${API}/account/phone/remove`, async ({ request }) => { bodies.push((await request.json()) as Record<string, unknown>); st.phone = { hasNumber: false, numberEnding: null, hasPin: false }; return new HttpResponse(null, { status: 204 }) }))
    renderAt(settings, '/settings/security')
    await user.click(await screen.findByRole('button', { name: 'Remove number' }))
    expect(screen.getByText(/also removes your phone PIN/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Password to confirm'), 'Tr1cky-Horse-Battery!')
    await user.click(screen.getByRole('button', { name: 'Remove number' }))
    expect(await screen.findByText(/Mobile number and phone PIN removed/)).toBeInTheDocument()
    expect(bodies[0]).toMatchObject({ currentPassword: 'Tr1cky-Horse-Battery!' })
    expect(await screen.findByText('Not added')).toBeInTheDocument()
  })
})

describe('Settings → Security: phone PIN card', () => {
  it('needs a number first', async () => {
    signedIn(); mockAccount()
    renderAt(settings, '/settings/security')
    expect(await screen.findByText('Add and verify a mobile number first.')).toBeInTheDocument()
  })

  it('enforces the strength rules and the confirmation, then saves', async () => {
    const user = userEvent.setup(); signedIn()
    mockAccount({ phone: { hasNumber: true, numberEnding: '0123', hasPin: false } })
    const bodies: Record<string, unknown>[] = []
    server.use(http.put(`${API}/account/phone/pin`, async ({ request }) => { bodies.push((await request.json()) as Record<string, unknown>); return new HttpResponse(null, { status: 204 }) }))
    renderAt(settings, '/settings/security')
    const pin = await screen.findByLabelText('PIN'); const again = screen.getByLabelText('Confirm PIN')
    await user.type(screen.getByLabelText('Password to confirm PIN change'), 'Tr1cky-Horse-Battery!')
    await user.type(pin, '123456'); await user.type(again, '123456')
    await user.click(screen.getByRole('button', { name: 'Set PIN' }))
    expect(await screen.findByText(/meets the rules/)).toBeInTheDocument()
    expect(screen.getByText(/Not a sequence like 123456/).textContent).toMatch(/○/)
    expect(bodies).toHaveLength(0)
    await user.clear(pin); await user.clear(again)
    await user.type(pin, '739204'); await user.type(again, '739205')
    await user.click(screen.getByRole('button', { name: 'Set PIN' }))
    expect(await screen.findByText(/do not match/)).toBeInTheDocument()
    await user.clear(again); await user.type(again, '739204')
    await user.click(screen.getByRole('button', { name: 'Set PIN' }))
    expect(await screen.findByText(/Phone PIN saved/)).toBeInTheDocument()
    expect(bodies[0]).toMatchObject({ pin: '739204', currentPassword: 'Tr1cky-Horse-Battery!' })
  })

  it('passwordless accounts confirm with a texted code', async () => {
    const user = userEvent.setup(); signedIn()
    mockAccount({ me: { hasPassword: false }, phone: { hasNumber: true, numberEnding: '0123', hasPin: true } })
    const bodies: Record<string, unknown>[] = []
    server.use(http.put(`${API}/account/phone/pin`, async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>; bodies.push(b)
      return b.stepUpCode ? new HttpResponse(null, { status: 204 }) : HttpResponse.json({ stepUpRequired: true, message: 'We texted a confirmation code to your current number.' }, { status: 202 })
    }))
    renderAt(settings, '/settings/security')
    await user.type(await screen.findByLabelText('New PIN'), '739204'); await user.type(screen.getByLabelText('Confirm PIN'), '739204')
    await user.click(screen.getByRole('button', { name: 'Change PIN' }))
    expect(await screen.findByText(/texted a confirmation code/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Texted confirmation code'), '111222')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/Phone PIN saved/)).toBeInTheDocument()
    expect(bodies[1]).toMatchObject({ pin: '739204', stepUpCode: '111222' })
  })
})

describe('/l/<token> texted links', () => {
  const ui = (<Routes><Route path="/l/:token" element={<PhoneLinkPage />} /><Route path="/l" element={<PhoneLinkPage />} /><Route path="/reset-password" element={<div>reset page</div>} /><Route path="/signup/verify" element={<div>verify page</div>} /></Routes>)

  it('a reset link goes to the reset page with the email and token, redeeming once', async () => {
    let calls = 0
    server.use(http.post(`${API}/channels/links/redeem`, () => { calls++; return HttpResponse.json({ purpose: 'reset', email: 'a@example.com', token: 'abc_DEF-123' }) }))
    renderAt(ui, '/l/tok1')
    expect(await screen.findByText('reset page')).toBeInTheDocument()
    expect(screen.getByTestId('loc').textContent).toBe('/reset-password?email=a%40example.com&token=abc_DEF-123')
    expect(calls).toBe(1)
  })

  it('an invalid, expired or used link explains itself', async () => {
    server.use(http.post(`${API}/channels/links/redeem`, () => HttpResponse.json({ title: 'This link is invalid or has expired.', code: 'invalid_link' }, { status: 400 })))
    renderAt(ui, '/l/dead')
    expect(await screen.findByText(/invalid, has expired or was already used/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reset your password' })).toHaveAttribute('href', '/forgot-password')
  })

  it('a sign-up link finishes the account with email, password and Terms, then goes to email verification', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.post(`${API}/channels/links/redeem`, () => HttpResponse.json({ purpose: 'signup', phoneEnding: '0123' })),
      http.post(`${API}/channels/links/complete-signup`, async ({ request }) => { bodies.push((await request.json()) as Record<string, unknown>); return HttpResponse.json({ message: 'ok' }, { status: 202 }) }),
    )
    renderAt(ui, '/l/signup1')
    expect(await screen.findByText(/number ending 0123 is already verified/)).toBeInTheDocument()
    // the secret token is gone from the address (and from history: the entry was replaced) while the form is open
    expect(screen.getByTestId('loc').textContent).toBe('/l')
    expect(screen.getByTestId('loc').textContent).not.toContain('signup1')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByText('You must accept the Terms.')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.type(screen.getByLabelText('Password'), 'Tr1cky-Horse-Battery!')
    await user.click(screen.getByLabelText(/I accept the Terms/))
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(screen.getByText('verify page')).toBeInTheDocument())
    expect(screen.getByTestId('loc').textContent).toBe('/signup/verify')
    expect(bodies[0]).toEqual({ token: 'signup1', email: 'new@example.com', password: 'Tr1cky-Horse-Battery!', acceptTerms: true })
    expect(sessionStorage.length).toBeGreaterThan(0) // the pending email is remembered for the verify step
  })

  it('replaces history entries: going back from the verify page does not return to the token URL', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(`${API}/channels/links/redeem`, () => HttpResponse.json({ purpose: 'signup', phoneEnding: '0123' })),
      http.post(`${API}/channels/links/complete-signup`, () => HttpResponse.json({ message: 'ok' }, { status: 202 })),
    )
    const seen: string[] = []
    const Probe = () => { const l = useLocation(); seen.push(l.pathname); return null }
    renderAt(<><Probe />{ui}</>, '/l/signup9')
    await screen.findByText(/already verified/)
    await user.type(screen.getByLabelText('Email'), 'a@example.com'); await user.type(screen.getByLabelText('Password'), 'Tr1cky-Horse-Battery!')
    await user.click(screen.getByLabelText(/I accept the Terms/)); await user.click(screen.getByRole('button', { name: 'Create account' }))
    await screen.findByText('verify page')
    expect(seen.at(-1)).toBe('/signup/verify')
    expect(seen.filter((x) => x.includes('signup9')).length).toBeGreaterThan(0) // the token URL was only ever the entry point
    expect(screen.getByTestId('loc').textContent).not.toContain('signup9')
  })

  it('opening /l directly (no token, no state) explains instead of showing a form', async () => {
    renderAt(ui, '/l')
    expect(await screen.findByText(/invalid, has expired or was already used/)).toBeInTheDocument()
  })

  it('PIN fields never invite the password manager', async () => {
    signedIn(); mockAccount({ phone: { hasNumber: true, numberEnding: '0123', hasPin: true } })
    renderAt(settings, '/settings/security')
    expect(await screen.findByLabelText('New PIN')).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByLabelText('Confirm PIN')).toHaveAttribute('autocomplete', 'off')
  })
})
