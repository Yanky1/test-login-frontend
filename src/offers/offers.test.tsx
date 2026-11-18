import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { API, CATS, mount } from '../products/testkit'
import OffersPage, { tiersText } from './Offers'
import OfferEditor, { toWrite } from './OfferEditor'
import type { OfferDetail, OfferListItem, Preview } from './types'

const acct = (role: string) => ({ activeAccountId: 'a1', role, accounts: [{ sellerId: 'a1', vendorName: 'Blitz Cards', role, accountStatus: 'Approved', brandCount: 1 }] })
const item = (o: Partial<OfferListItem> = {}): OfferListItem => ({
  id: 'o1', name: 'Blitz cards bundle', brandId: 'b1', brandName: 'Blitz', status: 'active', state: 'active', version: 2, scope: 'products',
  tiers: [{ minQuantity: 20, unitPriceCents: 90 }], giftCount: 2, activeFrom: null, activeTo: null, updatedAt: '2026-11-18T10:00:00Z', demo: false, ...o,
})
const detailOf = (o: Partial<OfferDetail> = {}): OfferDetail => ({
  id: 'o1', brandId: 'b1', brandName: 'Blitz', name: 'Blitz cards bundle', status: 'active', state: 'active', version: 2, createdAt: '2026-11-18T10:00:00Z', updatedAt: '2026-11-18T10:00:00Z', endedAt: null, demo: false,
  scope: 'products', categoryIds: [], categories: [], productIds: ['p1', 'p2'], products: [{ id: 'p1', title: 'Blue card' }, { id: 'p2', title: 'Gold card' }],
  tiers: [{ minQuantity: 20, unitPriceCents: 90 }], gifts: [{ minQuantity: 10, productId: 'p3', quantity: 1, title: 'Wallet' }], activeFrom: null, activeTo: null,
  versions: [{ version: 2, status: 'active', createdAt: '2026-11-18T11:00:00Z', supersededAt: null }, { version: 1, status: 'active', createdAt: '2026-11-18T10:00:00Z', supersededAt: '2026-11-18T11:00:00Z' }], ...o,
})
const PRODUCTS = [
  { id: 'p1', title: 'Blue card', status: 'Active', hasVariants: false }, { id: 'p2', title: 'Gold card', status: 'Active', hasVariants: false },
  { id: 'p3', title: 'Wallet', status: 'Active', hasVariants: false }, { id: 'p4', title: 'Sized sleeve', status: 'Active', hasVariants: true }, { id: 'p5', title: 'Old pack', status: 'Inactive', hasVariants: false },
]
const PREVIEW: Preview = {
  sample: { productId: 'p1', title: 'Blue card', unitPriceCents: 100 }, eligibleProducts: 2, currency: 'USD', summary: '',
  rows: [
    { quantity: 10, unitPriceCents: 100, totalCents: 1000, tierMinQuantity: null, discountCents: 0, gifts: [{ productId: 'p3', title: 'Wallet', quantity: 1 }] },
    { quantity: 20, unitPriceCents: 90, totalCents: 1800, tierMinQuantity: 20, discountCents: 200, gifts: [{ productId: 'p3', title: 'Wallet', quantity: 1 }] },
    { quantity: 25, unitPriceCents: 90, totalCents: 2250, tierMinQuantity: 20, discountCents: 250, gifts: [{ productId: 'p3', title: 'Wallet', quantity: 1 }] },
  ],
}

function mockEditor(d: OfferDetail | null = detailOf(), preview: Preview = PREVIEW) {
  const calls: { method: string; path: string; body: unknown }[] = []
  server.use(
    http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Blitz', isDefault: true }])),
    http.get(`${API}/categories`, () => HttpResponse.json(CATS)),
    http.get(`${API}/seller/products`, () => HttpResponse.json({ items: PRODUCTS, total: PRODUCTS.length, page: 1, pageSize: 100, counts: {} })),
    http.get(`${API}/seller/offers/:id`, () => (d ? HttpResponse.json(d) : HttpResponse.json({ title: 'Not found' }, { status: 404 }))),
    http.post(`${API}/seller/offers/preview`, async ({ request }) => { calls.push({ method: 'POST', path: 'preview', body: await request.json() }); return HttpResponse.json(preview) }),
    http.post(`${API}/seller/offers`, async ({ request }) => { const body = await request.json(); calls.push({ method: 'POST', path: 'create', body }); return HttpResponse.json(detailOf({ id: 'o9', version: 1 }), { status: 201 }) }),
    http.put(`${API}/seller/offers/:id`, async ({ request }) => { const body = await request.json(); calls.push({ method: 'PUT', path: 'update', body }); return HttpResponse.json(detailOf({ version: 3 })) }),
    http.post(`${API}/seller/offers/:id/end`, async ({ request }) => { const body = await request.json(); calls.push({ method: 'POST', path: 'end', body }); return HttpResponse.json(detailOf({ status: 'ended', state: 'ended', version: 3, endedAt: '2026-11-18T12:00:00Z' })) }),
  )
  return calls
}

describe('offers list', () => {
  it('lists offers with their state, steps, gifts and a Demo pill, and links to the editor', async () => {
    server.use(http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Blitz' }])),
      http.get(`${API}/seller/offers`, () => HttpResponse.json({ items: [item(), item({ id: 'o2', name: 'Demo: candles', demo: true, state: 'ended', status: 'ended' })] })))
    mount(<OffersPage />, '/offers', '/offers', acct('Owner'))
    const list = await screen.findByRole('list', { name: 'Offers' })
    const first = within(list).getByRole('link', { name: 'Blitz cards bundle' }).closest('li')!
    expect(within(first).getByText('Active')).toBeInTheDocument()
    expect(within(first).getByText(/from 20: \$0\.90 each/)).toBeInTheDocument()
    expect(within(first).getByText(/2 free gifts/)).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: 'Blitz cards bundle' })).toHaveAttribute('href', '/offers/o1')
    const demo = within(list).getByRole('link', { name: 'Demo: candles' }).closest('li')!
    expect(within(demo).getByText('Demo')).toBeInTheDocument(); expect(within(demo).getByText('Ended')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /New offer/ })).toHaveAttribute('href', '/offers/new')
  })

  it('has an empty state, and viewers get no New offer button', async () => {
    server.use(http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Blitz' }])), http.get(`${API}/seller/offers`, () => HttpResponse.json({ items: [] })))
    mount(<OffersPage />, '/offers', '/offers', acct('Viewer'))
    expect(await screen.findByRole('heading', { name: 'No offers yet' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /New offer/ })).toBeNull()
  })

  it('formats steps without doing any money maths', () => {
    expect(tiersText([{ minQuantity: 20, unitPriceCents: 90 }, { minQuantity: 50, unitPriceCents: 80 }])).toBe('from 20: $0.90 each · from 50: $0.80 each')
    expect(tiersText([])).toBe('No price steps')
  })
})

describe('tier editor', () => {
  it('sends the steps as whole quantities and integer cents, and the gifts from the picker', async () => {
    const calls = mockEditor(null)
    const user = userEvent.setup()
    mount(<OfferEditor />, '/offers/:id', '/offers/new', acct('Owner'))
    await user.type(await screen.findByLabelText('Name'), 'Blitz cards bundle')
    await user.click(await screen.findByRole('checkbox', { name: 'Blue card' }))
    await user.click(screen.getByRole('checkbox', { name: 'Gold card' }))
    await user.type(screen.getByLabelText('Step 1: from quantity'), '20')
    await user.type(screen.getByLabelText('Step 1: price each in dollars'), '0.90')
    await user.click(screen.getByRole('button', { name: 'Add price step' }))
    await user.type(screen.getByLabelText('Step 2: from quantity'), '50')
    await user.type(screen.getByLabelText('Step 2: price each in dollars'), '0.80')
    await user.click(screen.getByRole('button', { name: 'Add gift' }))
    const pick = screen.getByLabelText('Gift 1: product')
    // only active products without variations can be gifts
    expect(within(pick).queryByRole('option', { name: 'Sized sleeve' })).toBeNull()
    expect(within(pick).queryByRole('option', { name: 'Old pack' })).toBeNull()
    await user.selectOptions(pick, 'p3')
    await user.click(screen.getByRole('button', { name: 'Create offer' }))
    await waitFor(() => expect(calls.some((c) => c.path === 'create')).toBe(true))
    const body = calls.find((c) => c.path === 'create')!.body as Record<string, unknown>
    expect(body).toMatchObject({
      name: 'Blitz cards bundle', status: 'active', scope: 'products', productIds: ['p1', 'p2'], categoryIds: [],
      tiers: [{ minQuantity: 20, unitPriceCents: 90 }, { minQuantity: 50, unitPriceCents: 80 }], gifts: [{ productId: 'p3', minQuantity: 10, quantity: 1 }],
    })
  })

  it('removes a step, stops at ten steps, and shows the server\'s field errors', async () => {
    mockEditor(null)
    server.use(http.post(`${API}/seller/offers`, () => HttpResponse.json({ title: 'One or more validation errors occurred.', errors: { tiers: ['A step with a higher minimum quantity must have a lower price each.'] } }, { status: 400 })))
    const user = userEvent.setup()
    mount(<OfferEditor />, '/offers/:id', '/offers/new', acct('Owner'))
    const add = await screen.findByRole('button', { name: 'Add price step' })
    for (let i = 0; i < 9; i++) await user.click(add)
    expect(screen.getByLabelText('Step 10: from quantity')).toBeInTheDocument()
    expect(add).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Remove step 10' }))
    expect(screen.queryByLabelText('Step 10: from quantity')).toBeNull()
    expect(add).toBeEnabled()
    await user.type(screen.getByLabelText('Step 1: from quantity'), '10'); await user.type(screen.getByLabelText('Step 1: price each in dollars'), '0.90')
    await user.click(screen.getByRole('button', { name: 'Create offer' }))
    expect(await screen.findAllByText('A step with a higher minimum quantity must have a lower price each.')).not.toHaveLength(0)
  })

  it('parses input only: dollars to cents, blank rows dropped, dates to ISO', () => {
    const w = toWrite({ name: ' X ', status: 'draft', scope: 'category', categoryIds: ['c1'], productIds: ['p1'], tiers: [{ min: '20', price: '$0.90' }, { min: '', price: '' }], gifts: [{ productId: '', min: '10', qty: '1' }], from: '', to: '' })
    expect(w).toEqual({ name: 'X', status: 'draft', scope: 'category', categoryIds: ['c1'], productIds: [], tiers: [{ minQuantity: 20, unitPriceCents: 90 }], gifts: [], activeFrom: null, activeTo: null })
  })

  it('is read-only for viewers', async () => {
    mockEditor()
    mount(<OfferEditor />, '/offers/:id', '/offers/o1', acct('Viewer'))
    expect(await screen.findByDisplayValue('Blitz cards bundle')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'End offer' })).toBeNull()
  })
})

describe('preview', () => {
  it('shows exactly what the server computed (no client-side money maths) and sends the editor state', async () => {
    // deliberately "wrong" figures: the UI must print the server's numbers, not recompute them
    const calls = mockEditor(detailOf(), { ...PREVIEW, rows: [{ quantity: 20, unitPriceCents: 90, totalCents: 1799, tierMinQuantity: 20, discountCents: 201, gifts: [] }] })
    mount(<OfferEditor />, '/offers/:id', '/offers/o1', acct('Owner'))
    const pv = await screen.findByTestId('offer-preview', {}, { timeout: 3000 })
    expect(pv).toHaveTextContent('20 items: $17.99')
    const sent = calls.find((c) => c.path === 'preview')!.body as Record<string, unknown>
    expect(sent).toMatchObject({ scope: 'products', productIds: ['p1', 'p2'], tiers: [{ minQuantity: 20, unitPriceCents: 90 }], gifts: [{ productId: 'p3', minQuantity: 10, quantity: 1 }], sampleProductId: 'p1' })
  })

  it('lists each quantity with its total and the free gifts', async () => {
    mockEditor()
    mount(<OfferEditor />, '/offers/:id', '/offers/o1', acct('Owner'))
    const pv = await screen.findByTestId('offer-preview', {}, { timeout: 3000 })
    const rows = within(pv).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toEqual(['10 items: $10.00 + free Wallet', '20 items: $18.00 + free Wallet', '25 items: $22.50 + free Wallet'])
  })

  it('asks for complete steps instead of previewing half-typed ones', async () => {
    const calls = mockEditor(null)
    const user = userEvent.setup()
    mount(<OfferEditor />, '/offers/:id', '/offers/new', acct('Owner'))
    await user.type(await screen.findByLabelText('Step 1: from quantity'), '2x')
    expect(await screen.findByText('Fill in each step with a whole number and a price to see the preview.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === 'preview')).toBe(false)
  })
})

describe('end offer', () => {
  it('asks for confirmation; keeping it sends nothing, ending sends the current version', async () => {
    const calls = mockEditor()
    const user = userEvent.setup()
    mount(<OfferEditor />, '/offers/:id', '/offers/o1', acct('Owner'))
    await user.click(await screen.findByRole('button', { name: 'End offer' }))
    let dlg = screen.getByRole('dialog', { name: 'End this offer?' })
    expect(within(dlg).getByRole('button', { name: 'End offer' })).toHaveFocus()
    await user.click(within(dlg).getByRole('button', { name: 'Keep offer' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.some((c) => c.path === 'end')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'End offer' }))
    dlg = screen.getByRole('dialog', { name: 'End this offer?' })
    await user.click(within(dlg).getByRole('button', { name: 'End offer' }))
    await waitFor(() => expect(calls.find((c) => c.path === 'end')?.body).toEqual({ version: 2 }))
    expect(await screen.findByText(/Ended offers can't be changed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('closes the confirm with Escape', async () => {
    mockEditor()
    const user = userEvent.setup()
    mount(<OfferEditor />, '/offers/:id', '/offers/o1', acct('Owner'))
    await user.click(await screen.findByRole('button', { name: 'End offer' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
