import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { Route, Routes, Link } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AccountSwitcher } from '../pages/teams/AccountSwitcher'
import { server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'
import { BrandProvider } from '../pages/teams/BrandContext'
import CsvPage from './CsvPage'
import ProductEditorPage from './ProductEditor'
import QuestionsPage from './Questions'
import SellerLayout from './SellerLayout'
import { fetchBlob } from './api'
import { Dialog } from './ui'
import { useAutosave } from './useAutosave'
import { API, detail, mockCatalog, mount } from './testkit'

const two = (role = 'Owner') => ({ activeAccountId: 'a1', role, accounts: [
  { sellerId: 'a1', vendorName: 'Acme Co', role, accountStatus: 'Approved', brandCount: 2 }, { sellerId: 'a2', vendorName: 'Other Co', role: 'Admin', accountStatus: 'Approved', brandCount: 1 }] })
const img = { id: 'i1', url: '/api/v1/seller/products/p1/images/i1/file', alt: 'A', isMain: true, variantId: null, width: 1400, height: 1400, size: 1, lowResolution: false }

function mountWithSwitcher(d = detail(), login = two()) {
  const m = mockCatalog(d)
  let switched = false
  server.use(http.post(`${API}/session/account`, () => { switched = true; return HttpResponse.json({ accessToken: 'tok-2', body: { activeAccountId: 'a2', vendorName: 'Other Co', accountStatus: 'Approved', role: 'Admin', accounts: two().accounts } }) }))
  signedIn(login)
  renderAt(<BrandProvider><AccountSwitcher /><Routes><Route path="/products/:id" element={<ProductEditorPage />} /><Route path="*" element={<div>elsewhere</div>} /></Routes></BrandProvider>, '/products/p1')
  return { ...m, switched: () => switched }
}
const switchTo = async (name: RegExp) => { await userEvent.click(await screen.findByRole('button', { name: /Acme Co/ })); await userEvent.click(await screen.findByRole('button', { name })) }

describe('B1 unsaved edits survive account switching and log-out', () => {
  it('a draft edit made just before switching account triggers the leave dialog; Save and leave sends the PUT first', async () => {
    const { calls, switched } = mountWithSwitcher()
    await screen.findByRole('heading', { name: 'Sourdough loaf', level: 1 })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited a moment ago' } })
    await switchTo(/Other Co/)
    const dlg = await screen.findByRole('dialog', { name: 'You have unsaved changes' })
    expect(switched()).toBe(false)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save and leave' }))
    await waitFor(() => expect(switched()).toBe(true))
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    expect((calls[0].body as { title: string }).title).toBe('Edited a moment ago')
  })

  it('staying keeps the account and the edit; a live listing is protected the same way', async () => {
    const { calls, switched } = mountWithSwitcher(detail({ status: 'Active', canPublish: true, issues: [] }))
    await screen.findByRole('heading', { name: 'Sourdough loaf', level: 1 })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Live edit' } })
    await switchTo(/Other Co/)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Stay on this page' }))
    expect(switched()).toBe(false); expect(screen.getByLabelText('Title')).toHaveValue('Live edit'); expect(calls).toHaveLength(0)
    expect(screen.queryByText(/Could not switch accounts/)).toBeNull()
    await switchTo(/Other Co/)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave without saving' }))
    await waitFor(() => expect(switched()).toBe(true)); expect(calls).toHaveLength(0)
  })

  it('with nothing unsaved the switch is immediate', async () => {
    const { switched } = mountWithSwitcher()
    await screen.findByRole('heading', { name: 'Sourdough loaf', level: 1 })
    await switchTo(/Other Co/)
    await waitFor(() => expect(switched()).toBe(true)); expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('autosave sends pending edits when the page unmounts', async () => {
    let n = 0
    const { result, unmount } = renderHook(() => useAutosave(async () => { n++ }, 5000))
    act(() => result.current.touch())
    unmount()
    await waitFor(() => expect(n).toBe(1))
  })
})

describe('B2 dialogs keep focus while the editor re-renders', () => {
  it('focus on the second button survives parent re-renders with a new onClose each time', async () => {
    function Host() {
      const [n, setN] = useState(0)
      return <><button onClick={() => setN(n + 1)}>rerender {n}</button><Dialog title="Preview" onClose={() => setN(-1)}><button>First</button><button>Second</button></Dialog></>
    }
    render(<Host />)
    const second = screen.getByRole('button', { name: 'Second' })
    second.focus(); expect(second).toHaveFocus()
    fireEvent.click(screen.getByText(/rerender/))   // inline onClose arrow changes identity here
    await waitFor(() => expect(screen.getByText('rerender 1')).toBeInTheDocument())
    expect(second).toHaveFocus()
  })
})

describe('B3 duplicate saves pending edits first', () => {
  it('one shared call log: PUT happens before POST /duplicate (swapping them would fail this)', async () => {
    const m = mockCatalog(detail())
    server.use(http.post(`${API}/seller/products/p1/duplicate`, () => { m.calls.push({ method: 'POST', url: '/duplicate', body: null }); return HttpResponse.json(detail({ id: 'copy' }), { status: 201 }) }))
    mount(<ProductEditorPage />, '/products/:id', '/products/p1')
    await screen.findByRole('heading', { name: 'Sourdough loaf', level: 1 })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pending edit' } })
    await userEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    await waitFor(() => expect(m.calls.some((c) => c.url === '/duplicate')).toBe(true))
    expect(m.calls.map((c) => c.method)).toEqual(['PUT', 'POST'])
    expect((m.calls[0].body as { title: string }).title).toBe('Pending edit')
  })
})

describe('B4 viewers cannot trigger writes from photos', () => {
  it('no dropzone, no drag handles, no photo actions; nothing is uploaded on a drop', async () => {
    const uploads: string[] = []
    mockCatalog(detail({ images: [img, { ...img, id: 'i2', isMain: false }] }))
    server.use(http.post(`${API}/seller/products/p1/images`, () => { uploads.push('x'); return HttpResponse.json({}, { status: 403 }) }))
    mount(<ProductEditorPage />, '/products/:id', '/products/p1', two('Viewer'))
    await screen.findByRole('heading', { name: 'Sourdough loaf', level: 1 })
    expect(screen.queryByText(/Drag photos here/)).toBeNull()
    const items = screen.getByRole('list', { name: 'Photos' }).querySelectorAll('li')
    expect(items).toHaveLength(2); items.forEach((li) => expect(li).not.toHaveAttribute('draggable', 'true'))
    expect(screen.queryByRole('button', { name: /Delete photo/ })).toBeNull(); expect(screen.queryByLabelText(/Alt text for photo/)).toBeNull()
    fireEvent.drop(screen.getByRole('list', { name: 'Photos' }), { dataTransfer: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    await new Promise((r) => setTimeout(r, 50)); expect(uploads).toEqual([])
  })
})

describe('(a) the header brand filter reaches the questions inbox and the CSV export', () => {
  const brandLogin = two('Admin')
  it('questions are requested for the selected brand only', async () => {
    const urls: URL[] = []; sessionStorage.setItem('solvelt-brand:a1', 'b2')
    server.use(http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme' }, { id: 'b2', name: 'Beta' }])),
      http.get(`${API}/seller/products`, () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 100, counts: {} })),
      http.get(`${API}/seller/questions`, ({ request }) => { urls.push(new URL(request.url)); return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 50, counts: { unanswered: 0, answered: 0, hidden: 0 } }) }))
    mount(<QuestionsPage />, '/questions', '/questions', brandLogin)
    await waitFor(() => expect(urls.some((u) => u.searchParams.get('brandId') === 'b2')).toBe(true))
  })
  it('the CSV export is requested for the selected brand', async () => {
    const urls: URL[] = []; sessionStorage.setItem('solvelt-brand:a1', 'b2')
    server.use(http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme' }, { id: 'b2', name: 'Beta' }])),
      http.get(`${API}/seller/products/csv/export`, ({ request }) => { urls.push(new URL(request.url)); return new HttpResponse('title\n', { headers: { 'content-type': 'text/csv' } }) }))
    mount(<CsvPage />, '/products/import', '/products/import', brandLogin)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export my catalog' })).toBeInTheDocument())
    // the brand list loads asynchronously; the export uses the selection as soon as it is valid
    await waitFor(async () => { await userEvent.click(screen.getByRole('button', { name: 'Export my catalog' })); expect(urls.at(-1)?.searchParams.get('brandId')).toBe('b2') })
  })
})

describe('(b) protected downloads refresh an expired token once', () => {
  it('retries after a 401 and succeeds; gives up after the retry', async () => {
    signedIn(); let hits = 0
    server.use(http.get(`${API}/seller/products/csv/template`, () => (++hits === 1 ? new HttpResponse(null, { status: 401 }) : new HttpResponse('a,b', { headers: { 'content-type': 'text/csv' } }))))
    const blob = await fetchBlob('/seller/products/csv/template')
    expect(hits).toBe(2); expect(await blob.text()).toBe('a,b')
    hits = -5
    server.use(http.get(`${API}/seller/products/csv/template`, () => { hits++; return new HttpResponse(null, { status: 401 }) }))
    await expect(fetchBlob('/seller/products/csv/template')).rejects.toThrow('HTTP 401'); expect(hits).toBe(-3)
  })
})

describe('(c) the drawer hands focus to the new page heading', () => {
  it('using a drawer link closes it and focuses the h1', async () => {
    signedIn(two())
    renderAt(<Routes><Route element={<SellerLayout />}><Route path="/products" element={<h1 id="page-title" tabIndex={-1}>Catalog page</h1>} /><Route path="/questions" element={<><h1 id="page-title" tabIndex={-1}>Questions page</h1><Link to="/products">x</Link></>} /></Route></Routes>, '/products')
    await userEvent.click(await screen.findByRole('button', { name: /Menu/ }))
    await userEvent.click(screen.getByRole('link', { name: 'Questions' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Questions page' })).toHaveFocus())
    expect(screen.getByRole('button', { name: /Menu/ })).toHaveAttribute('aria-expanded', 'false')
  })
})
