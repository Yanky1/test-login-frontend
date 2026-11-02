import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import AccountStep from './wizard/AccountStep'
import { API, loginBody, server } from '../test/server'
import { renderAt } from '../test/utils'
import { tokenStore } from '../api'

const ui = (<Routes><Route path="/signup" element={<AccountStep />} /><Route path="/signup/verify" element={<div>verify page</div>} /></Routes>)

describe('signup account step', () => {
  it('validates inline on blur and shows messages', async () => {
    const user = userEvent.setup()
    renderAt(ui, '/signup')
    const email = await screen.findByLabelText('Email')
    await user.type(email, 'not-an-email')
    expect(screen.queryByText('Enter a valid email address')).not.toBeInTheDocument() // not before blur
    await user.tab()
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Password'), 'weak')
    await user.tab(); await user.tab() // leave password (and the show button)
    expect(await screen.findByText('Password does not meet the requirements')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Password'), 'ABCdef123!-xyz')
    await user.type(screen.getByLabelText('Confirm password'), 'different')
    await user.tab()
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
  })

  it('suggests a corrected email domain and applies it', async () => {
    const user = userEvent.setup()
    renderAt(ui, '/signup')
    await user.type(await screen.findByLabelText('Email'), 'dana@gmial.com')
    await user.tab()
    const btn = await screen.findByRole('button', { name: 'gmail.com' })
    expect(screen.getByText(/Did you mean/)).toBeInTheDocument()
    await user.click(btn)
    expect(screen.getByLabelText('Email')).toHaveValue('dana@gmail.com')
    expect(screen.queryByText(/Did you mean/)).not.toBeInTheDocument()
  })

  it('toggles password visibility and sets autocomplete attributes', async () => {
    const user = userEvent.setup()
    renderAt(ui, '/signup')
    const pw = await screen.findByLabelText('Password')
    expect(pw).toHaveAttribute('type', 'password')
    expect(pw).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username')
    await user.click(screen.getAllByRole('button', { name: /show/i })[0])
    expect(pw).toHaveAttribute('type', 'text')
    await user.click(screen.getAllByRole('button', { name: /hide/i })[0])
    expect(pw).toHaveAttribute('type', 'password')
  })

  it('requires the Terms checkbox, then creates the account and moves to Verify (token kept in memory only)', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(http.post(`${API}/auth/signup`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(loginBody({ accountStatus: 'PendingEmailVerification' }), { status: 201 }) }))
    renderAt(ui, '/signup')
    await user.type(await screen.findByLabelText('Email'), 'dana@example.com')
    await user.type(screen.getByLabelText('Password'), 'Tr1cky-Horse-Battery!')
    await user.type(screen.getByLabelText('Confirm password'), 'Tr1cky-Horse-Battery!')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('You must accept the Terms to continue')).toBeInTheDocument()
    expect(body).toBeNull()
    await user.click(screen.getByLabelText(/I agree to the/))
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('verify page')).toBeInTheDocument()
    expect(body).toMatchObject({ email: 'dana@example.com', acceptTerms: true })
    expect(tokenStore.get()).toBe('tok-1')
    expect(JSON.stringify({ ...localStorage })).not.toContain('tok-1')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('tok-1')
  })

  it('shows server-side field errors (e.g. breached/common password)', async () => {
    const user = userEvent.setup()
    server.use(http.post(`${API}/auth/signup`, () => HttpResponse.json({ title: 'Validation', errors: { password: ['That password is too common.'] } }, { status: 400 })))
    renderAt(ui, '/signup')
    await user.type(await screen.findByLabelText('Email'), 'dana@example.com')
    await user.type(screen.getByLabelText('Password'), 'Tr1cky-Horse-Battery!')
    await user.type(screen.getByLabelText('Confirm password'), 'Tr1cky-Horse-Battery!')
    await user.click(screen.getByLabelText(/I agree to the/))
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(screen.getByText('That password is too common.')).toBeInTheDocument())
  })
})
