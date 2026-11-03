import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import SettingsPage from './Settings'
import { RequireAuth } from '../components/RequireAuth'
import { API, server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'

const routes = <Routes><Route element={<RequireAuth />}><Route path="/settings/:tab?" element={<SettingsPage />} /></Route></Routes>
const me = (sellerStatus: string | null) => ({ email: 'seller@example.com', emailConfirmed: true, hasPassword: true, twoFactorEnabled: false, passkeyCount: 0, logins: [], sellerStatus, vendorName: 'Acme Co' })

describe('Settings → Profile: application status', () => {
  it('shows an Approved status as Approved', async () => {
    signedIn()
    server.use(http.get(`${API}/account/me`, () => HttpResponse.json(me('Approved'))))
    renderAt(routes, '/settings/profile')
    const card = (await screen.findByRole('heading', { name: 'Profile' })).closest('section')!
    expect(within(card).getAllByText('Approved').length).toBeGreaterThan(0)
  })

  it('a stale "Live" from an older backend is shown as Approved (chip and row), never as Live', async () => {
    signedIn()
    server.use(http.get(`${API}/account/me`, () => HttpResponse.json(me('Live'))))
    renderAt(routes, '/settings/profile')
    const card = (await screen.findByRole('heading', { name: 'Profile' })).closest('section')!
    expect(within(card).getAllByText('Approved')).toHaveLength(2) // status chip + "Application status" row
    expect(within(card).queryByText('Live')).not.toBeInTheDocument()
  })

  it('no application: "No application" / dash', async () => {
    signedIn()
    server.use(http.get(`${API}/account/me`, () => HttpResponse.json(me(null))))
    renderAt(routes, '/settings/profile')
    const card = (await screen.findByRole('heading', { name: 'Profile' })).closest('section')!
    expect(within(card).getByText('No application')).toBeInTheDocument()
  })
})
