import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { useAuth } from '../auth'
import { AccountSwitcher } from '../pages/teams/AccountSwitcher'
import { BrandProvider, BrandSwitcher } from '../pages/teams/BrandContext'
import { server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'
import ProductEditorPage from './ProductEditor'
import ProductsListPage from './ProductsList'
import QuestionsPage from './Questions'
import { API, detail, mockCatalog } from './testkit'

const accounts = (role = 'Owner') => ({ activeAccountId: 'a1', role, accounts: [
  { sellerId: 'a1', vendorName: 'Acme Co', role, accountStatus: 'Approved', brandCount: 2 }, { sellerId: 'a2', vendorName: 'Other Co', role: 'Admin', accountStatus: 'Approved', brandCount: 1 }] })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function setup(login = accounts()) {
  const m = mockCatalog(detail())
  server.use(http.post(`${API}/session/account`, async ({ request }) => {
    m.calls.push({ method: 'SWITCH', url: '/session/account', body: await request.json(), auth: request.headers.get('authorization') })
    return HttpResponse.json({ accessToken: 'tok-2', body: { activeAccountId: 'a2', vendorName: 'Other Co', accountStatus: 'Approved', role: 'Admin', accounts: accounts().accounts } })
  }))
  signedIn(login)
  renderAt(<BrandProvider><AccountSwitcher /><Routes><Route path="/products/:id" element={<ProductEditorPage />} /><Route path="*" element={<div>elsewhere</div>} /></Routes></BrandProvider>, '/products/p1')
  return m
}
const edit = async () => { await screen.findByRole('heading', { name: 'Sourdough loaf', level: 1 }); fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Typed just now' } }) }
const switchTo = async () => { await userEvent.click(await screen.findByRole('button', { name: /Acme Co/ })); await userEvent.click(await screen.findByRole('button', { name: /Other Co/ })) }
const choose = async (name: string) => userEvent.click(within(await screen.findByRole('dialog', { name: 'You have unsaved changes' })).getByRole('button', { name }))

describe('"Leave without saving" really discards', () => {
  it('via an in-app link: no PUT is ever sent', async () => {
    const m = setup(); await edit()
    await userEvent.click(screen.getByRole('link', { name: '← Products' })); await choose('Leave without saving')
    expect(await screen.findByText('elsewhere')).toBeInTheDocument()
    await wait(1600)   // longer than the 1.2 s autosave debounce, plus the moment the editor unmounts
    expect(m.calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
  })

  it('via an account switch: the switch happens and no PUT is sent (not even with the new account\'s token)', async () => {
    const m = setup(); await edit()
    await switchTo(); await choose('Leave without saving')
    await waitFor(() => expect(m.calls.some((c) => c.method === 'SWITCH')).toBe(true))
    await wait(1600)
    expect(m.calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
  })

  it('Save and switch: the PUT goes out BEFORE the switch, with the old account\'s token', async () => {
    const m = setup(); await edit()
    await switchTo(); await choose('Save and leave')
    await waitFor(() => expect(m.calls.some((c) => c.method === 'SWITCH')).toBe(true))
    expect(m.calls.map((c) => c.method)).toEqual(['PUT', 'SWITCH'])
    expect(m.calls[0].auth).toBe('Bearer tok-1'); expect(m.calls[1].auth).toBe('Bearer tok-1')
    await wait(300); expect(m.calls.filter((c) => c.method === 'PUT')).toHaveLength(1)   // and nothing is sent after the account changed
  })

  it('Stay keeps the edit and the pending autosave still runs for the right account', async () => {
    const m = setup(); await edit()
    await switchTo(); await choose('Stay on this page')
    await waitFor(() => expect(m.calls.filter((c) => c.method === 'PUT')).toHaveLength(1), { timeout: 4000 })
    expect(m.calls.some((c) => c.method === 'SWITCH')).toBe(false); expect(m.calls[0].auth).toBe('Bearer tok-1')
  })
})

describe('manual log-out is guarded too', () => {
  function LogoutButton() { const { logout } = useAuth(); return <button onClick={() => void logout()}>Log out now</button> }
  it('with unsaved edits the dialog appears and no logout request is made until the user decides', async () => {
    const m = mockCatalog(detail()); let loggedOut = false
    server.use(http.post(`${API}/auth/logout`, () => { loggedOut = true; return new HttpResponse(null, { status: 204 }) }))
    signedIn(accounts())
    renderAt(<BrandProvider><LogoutButton /><Routes><Route path="/products/:id" element={<ProductEditorPage />} /></Routes></BrandProvider>, '/products/p1')
    await edit()
    await userEvent.click(screen.getByRole('button', { name: 'Log out now' }))
    await choose('Stay on this page')
    expect(loggedOut).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Log out now' }))
    await choose('Save and leave')
    await waitFor(() => expect(loggedOut).toBe(true))
    expect(m.calls.filter((c) => c.method === 'PUT').length).toBeGreaterThanOrEqual(1)
  })
})

describe('Viewer list has no selection checkboxes', () => {
  it('neither per-row nor select-all', async () => {
    const item = { id: 'p1', title: 'Blue mug', sku: 'M', status: 'Active', brandId: 'b1', brandName: 'Acme', categoryId: 'c', price: 10, currentPrice: 10, onSale: false, quantity: 5, hasVariants: false, variantCount: 0, qualityScore: 80, canPublish: true, needsAttention: false, lowStock: false, version: 1, updatedAt: '2026-11-01T00:00:00Z', thumbnailUrl: null }
    server.use(http.get(`${API}/brands`, () => HttpResponse.json([])), http.get(`${API}/seller/products`, () => HttpResponse.json({ items: [item], total: 1, page: 1, pageSize: 20, counts: { all: 1, draft: 0, active: 1, inactive: 0, archived: 0, outOfStock: 0, attention: 0 } })))
    signedIn(accounts('Viewer'))
    renderAt(<BrandProvider><Routes><Route path="/products" element={<ProductsListPage />} /></Routes></BrandProvider>, '/products')
    await screen.findAllByRole('link', { name: 'Blue mug' })
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })
  it('an Admin does get them (the test above is not vacuous)', async () => {
    const item = { id: 'p1', title: 'Blue mug', sku: 'M', status: 'Active', brandId: 'b1', brandName: 'Acme', categoryId: 'c', price: 10, currentPrice: 10, onSale: false, quantity: 5, hasVariants: false, variantCount: 0, qualityScore: 80, canPublish: true, needsAttention: false, lowStock: false, version: 1, updatedAt: '2026-11-01T00:00:00Z', thumbnailUrl: null }
    server.use(http.get(`${API}/brands`, () => HttpResponse.json([])), http.get(`${API}/seller/products`, () => HttpResponse.json({ items: [item], total: 1, page: 1, pageSize: 20, counts: { all: 1, draft: 0, active: 1, inactive: 0, archived: 0, outOfStock: 0, attention: 0 } })))
    signedIn(accounts('Admin'))
    renderAt(<BrandProvider><Routes><Route path="/products" element={<ProductsListPage />} /></Routes></BrandProvider>, '/products')
    await screen.findAllByRole('link', { name: 'Blue mug' })
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
  })
})

describe('Questions product filter follows the header brand', () => {
  it('the product dropdown is re-fetched for the newly selected brand', async () => {
    const urls: URL[] = []
    server.use(http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme' }, { id: 'b2', name: 'Beta' }])),
      http.get(`${API}/seller/products`, ({ request }) => { urls.push(new URL(request.url)); return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 100, counts: {} }) }),
      http.get(`${API}/seller/questions`, () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 50, counts: { unanswered: 0, answered: 0, hidden: 0 } })))
    signedIn(accounts('Admin'))
    renderAt(<BrandProvider><BrandSwitcher /><Routes><Route path="/questions" element={<QuestionsPage />} /></Routes></BrandProvider>, '/questions')
    await waitFor(() => expect(urls.length).toBeGreaterThan(0))
    await userEvent.selectOptions(await screen.findByLabelText('Brand'), 'b2')
    await waitFor(() => expect(urls.at(-1)?.searchParams.get('brandId')).toBe('b2'))
  })
})
