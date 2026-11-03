import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import Home from './Home'
import { RequireAuth } from '../components/RequireAuth'
import { API, server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'

const A = '11111111-1111-1111-1111-111111111111'
const routes = (
  <Routes>
    <Route element={<RequireAuth />}>
      <Route path="/" element={<Home />} />
      <Route path="/products" element={<div>products page</div>} />
      <Route path="/signup/pending" element={<div>application pending page</div>} />
      <Route path="/signup/business" element={<div>business step page</div>} />
    </Route>
  </Routes>
)
const application = (status: string, draftStep = 5) => ({ sellerId: A, status, statusNote: null, draftStep, editable: false })
const asOwner = (status: string, draftStep?: number) => {
  signedIn({ sellerId: A, activeAccountId: A, accounts: [{ sellerId: A, vendorName: 'Acme Co', role: 'Owner', accountStatus: status, brandCount: 1 }] })
  server.use(http.get(`${API}/seller/application`, () => HttpResponse.json(application(status, draftStep))))
}

describe('Home: where each signed-in user lands', () => {
  it.each(['Approved', 'Live'])('an Owner whose application is %s (Live = stale value from an older backend) lands on the product catalog', async (status) => {
    asOwner(status)
    renderAt(routes, '/')
    expect(await screen.findByText('products page')).toBeInTheDocument()
    expect(screen.queryByText('application pending page')).not.toBeInTheDocument()
  })

  it('an Owner still in review lands on the pending screen', async () => {
    asOwner('PendingReview')
    renderAt(routes, '/')
    expect(await screen.findByText('application pending page')).toBeInTheDocument()
    expect(screen.queryByText('products page')).not.toBeInTheDocument()
  })

  it('an Owner whose application needs info goes back to the wizard, not the catalog', async () => {
    asOwner('NeedsInfo')
    renderAt(routes, '/')
    expect(await screen.findByText('business step page')).toBeInTheDocument()
  })

  it('team members (non-Owners) still land on the product catalog without loading the application', async () => {
    signedIn({ sellerId: A, activeAccountId: A, accounts: [{ sellerId: A, vendorName: 'Acme Co', role: 'Manager', accountStatus: 'Approved', brandCount: 1 }] })
    let asked = false
    server.use(http.get(`${API}/seller/application`, () => { asked = true; return HttpResponse.json(application('PendingReview')) }))
    renderAt(routes, '/')
    expect(await screen.findByText('products page')).toBeInTheDocument()
    expect(asked).toBe(false)
  })
})
