import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import OrderDetailPage from './OrderDetail'
import OrdersListPage from './OrdersList'
import { trackingValid, toCents, shipByText, statusLabel } from './format'
import { ACTIONS, API, item, mount, mockOrder, order } from './testkit'

const counts = { needsAction: 3, pending: 2, shipped: 1, delivered: 4, cancelled: 0, returns: 1, late: 1, all: 11 }
const dash = { todayOrders: 2, toShip: 3, late: 1, returnsOpen: 1, sales30Cents: 123400, orders30: 9, daily: [{ date: '2026-11-01', orders: 1, salesCents: 5000 }], lateShipmentRate: 5, cancellationRate: 2, messages: { unread: 1, needsReply: 1, overdue: 0, avgResponseHours: 3, repliedInTimePct: 100 } }

function mockList(items = [item()], extra: (u: URL) => void = () => undefined) {
  const urls: URL[] = []
  server.use(
    http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme' }, { id: 'b2', name: 'Beta' }])),
    http.get(`${API}/seller/orders/counts`, () => HttpResponse.json(counts)),
    http.get(`${API}/seller/orders/dashboard`, () => HttpResponse.json(dash)),
    http.get(`${API}/seller/orders`, ({ request }) => { const u = new URL(request.url); urls.push(u); extra(u); return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 20 }) }),
  )
  return urls
}

describe('helpers', () => {
  it('validates tracking numbers per carrier and parses money', () => {
    expect(trackingValid('UPS', '1z999aa10123456784')).toBe(true); expect(trackingValid('UPS', '1Z99')).toBe(false)
    expect(trackingValid('FedEx', '123456789012')).toBe(true); expect(trackingValid('USPS', 'EA123456789US')).toBe(true); expect(trackingValid('Other', 'no way!')).toBe(false)
    expect(toCents('12.5')).toBe(1250); expect(toCents('$3')).toBe(300); expect(toCents('1.234')).toBeNull(); expect(toCents('-1')).toBeNull(); expect(toCents('')).toBeNull()
  })
  it('counts down to the ship-by date and flags late orders; only while something is left to ship', () => {
    const now = Date.parse('2026-11-10T12:00:00Z')
    expect(shipByText({ status: 'Accepted', shipByAt: '2026-11-08T12:00:00Z' }, now)).toEqual({ text: 'Late by 2 days', tone: 'bad' })
    expect(shipByText({ status: 'New', shipByAt: '2026-11-10T18:00:00Z' }, now).tone).toBe('warn')
    expect(shipByText({ status: 'New', shipByAt: '2026-11-14T12:00:00Z' }, now).text).toContain('Ship by')
    expect(shipByText({ status: 'Shipped', shipByAt: '2026-11-01T00:00:00Z' }, now).tone).toBe('none')
    expect(statusLabel('Refunded', { refundedCents: 100, totalCents: 500 })).toBe('Refunded (partial)')
  })
})

describe('orders list', () => {
  it('shows a skeleton, then rows with order number, buyer, total, ship-by countdown and status chips; plus the at-a-glance tiles', async () => {
    mockList([item(), item({ id: 'o2', number: 'SO-2026-000002', late: true, oversold: true, status: 'Accepted', shipByAt: new Date(Date.now() - 2 * 86_400_000).toISOString() })])
    mount(<OrdersListPage />, '/orders')
    expect(screen.getByLabelText('Loading orders')).toBeInTheDocument()
    const rows = await screen.findAllByRole('row')
    expect(rows.length).toBe(3)
    expect(within(rows[1]).getByRole('link', { name: 'SO-2026-000001' })).toHaveAttribute('href', '/orders/o1')
    expect(within(rows[1]).getByText('Pending acceptance')).toBeInTheDocument(); expect(within(rows[1]).getByText('$40.00')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Late')).toBeInTheDocument(); expect(within(rows[2]).getByText('Oversold')).toBeInTheDocument(); expect(within(rows[2]).getByText(/Late by 2 days/)).toBeInTheDocument()
    expect(await screen.findByText("Today's orders")).toBeInTheDocument(); expect(screen.getByText('$1,234.00')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Daily sales for the last 30 days/ })).toBeInTheDocument()
  })

  it('has the tabs with counts and each tab, the search box and the sort/filters go to the API', async () => {
    const urls = mockList()
    mount(<OrdersListPage />, '/orders')
    await screen.findAllByRole('link', { name: 'SO-2026-000001' })
    expect(await screen.findByRole('tab', { name: /Needs action 3/ })).toHaveAttribute('aria-selected', 'true')
    const last = () => urls.at(-1)!.searchParams
    expect(last().get('tab')).toBe('needs_action')
    await userEvent.click(screen.getByRole('tab', { name: /Pending acceptance/ })); await waitFor(() => expect(last().get('tab')).toBe('pending'))
    await userEvent.click(screen.getByRole('tab', { name: /Returns/ })); await waitFor(() => expect(last().get('tab')).toBe('returns'))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search orders' }), 'zebra'); await waitFor(() => expect(last().get('q')).toBe('zebra'))
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'shipby_asc'); await waitFor(() => expect(last().get('sort')).toBe('shipby_asc'))
    await userEvent.click(screen.getByText('More filters'))
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Shipped'); await waitFor(() => expect(last().get('status')).toBe('Shipped'))
    await userEvent.selectOptions(screen.getByLabelText('Shipping speed'), 'overnight'); await waitFor(() => expect(last().get('speed')).toBe('overnight'))
    await userEvent.click(screen.getByLabelText('Late only')); await waitFor(() => expect(last().get('late')).toBe('true'))
    await userEvent.click(screen.getByLabelText('Oversold only')); await waitFor(() => expect(last().get('oversold')).toBe('true'))
    fireEvent.change(screen.getByLabelText('Placed from'), { target: { value: '2026-11-01' } }); await waitFor(() => expect(last().get('from')).toBe('2026-11-01'))
  })

  it('friendly empty states, with a way to clear filters', async () => {
    mockList([])
    mount(<OrdersListPage />, '/orders')
    expect(await screen.findByRole('heading', { name: 'Nothing needs your attention' })).toBeInTheDocument()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search orders' }), 'nope')
    expect(await screen.findByRole('heading', { name: 'No orders match' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('bulk accept sends the selected ids and reports per-order problems', async () => {
    mockList([item(), item({ id: 'o2', number: 'SO-2026-000002' })])
    let ids: string[] = []
    server.use(http.post(`${API}/seller/orders/bulk/accept`, async ({ request }) => { ids = ((await request.json()) as { ids: string[] }).ids; return HttpResponse.json({ results: [{ id: 'o1', number: 'SO-2026-000001', ok: true, code: 'ok', message: '' }, { id: 'o2', number: 'SO-2026-000002', ok: false, code: 'invalid_state', message: 'Already cancelled.' }] }) }))
    mount(<OrdersListPage />, '/orders')
    await userEvent.click(await screen.findByLabelText('Select order SO-2026-000001', { selector: 'table input' }))
    await userEvent.click(screen.getAllByLabelText('Select order SO-2026-000002')[0])
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(ids.sort()).toEqual(['o1', 'o2']))
    expect(await screen.findByText(/1 accepted\. SO-2026-000002: Already cancelled\./)).toBeInTheDocument()
  })

  it('prints packing slips for the selected orders (no external resources, a print button)', async () => {
    mockList()
    server.use(http.post(`${API}/seller/orders/bulk/packing-slips`, () => HttpResponse.json({ slips: [{ id: 'o1', number: 'SO-2026-000001', brandName: 'Acme', placedAt: '2026-11-01T10:00:00Z', shippingMethod: 'Standard', shipTo: { name: 'Jane Buyer', line1: '1 Main St', line2: null, city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', phone: null }, giftMessage: 'Happy birthday', isGift: true, showPrices: false, currency: 'USD', lines: [{ title: 'Blue mug', sku: 'MUG-1', options: null, quantity: 2, unshipped: 2, unitPriceCents: 1000 }] }] })))
    mount(<OrdersListPage />, '/orders')
    await userEvent.click(await screen.findByLabelText('Select order SO-2026-000001', { selector: 'table input' }))
    await userEvent.click(screen.getByRole('button', { name: 'Print packing slips' }))
    const slip = await screen.findByRole('article', { name: 'Packing slip SO-2026-000001' })
    expect(within(slip).getByText('Happy birthday')).toBeInTheDocument(); expect(within(slip).queryByText('Price')).toBeNull()   // gift: no prices
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument(); expect(slip.querySelector('img')).toBeNull()
  })

  it('a Viewer can read and print but cannot upload tracking or bulk accept', async () => {
    mockList()
    mount(<OrdersListPage />, '/orders', '/orders', { activeAccountId: 'a1', role: 'Viewer', accounts: [{ sellerId: 'a1', vendorName: 'Acme', role: 'Viewer', accountStatus: 'Approved', brandCount: 1 }] })
    await screen.findAllByRole('link', { name: 'SO-2026-000001' })
    expect(screen.queryByRole('button', { name: /Upload tracking CSV/ })).toBeNull()
    await userEvent.click(screen.getByLabelText('Select order SO-2026-000001', { selector: 'table input' }))
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull(); expect(screen.getByRole('button', { name: 'Print packing slips' })).toBeInTheDocument()
  })

  it('CSV tracking upload: shows a row-by-row check with errors before anything is shipped, then ships the valid rows', async () => {
    mockList()
    const applied: boolean[] = []
    server.use(http.post(`${API}/seller/orders/import-tracking`, ({ request }) => {
      const apply = new URL(request.url).searchParams.get('apply') === 'true'; applied.push(apply)
      const results = [{ row: 2, orderNumber: 'SO-2026-000001', orderId: 'o1', ok: true, error: null, applied: apply }, { row: 3, orderNumber: 'SO-2026-000002', orderId: 'o2', ok: false, error: "That doesn't look like a UPS tracking number.", applied: false }]
      return HttpResponse.json({ applied: apply, total: 2, valid: 1, results })
    }))
    mount(<OrdersListPage />, '/orders')
    await userEvent.click(await screen.findByRole('button', { name: /Upload tracking CSV/ }))
    await userEvent.upload(screen.getByLabelText('CSV file'), new File(['order_number,carrier,tracking_number\n'], 'trk.csv', { type: 'text/csv' }))
    expect(await screen.findByText(/1 of 2 rows are ready/)).toBeInTheDocument(); expect(screen.getByText(/1 need fixing/)).toBeInTheDocument()
    expect(screen.getByText("That doesn't look like a UPS tracking number.")).toBeInTheDocument(); expect(applied).toEqual([false])
    await userEvent.click(screen.getByRole('button', { name: /Ship 1 order/ }))
    expect(await screen.findByText(/1 order\(s\) shipped/)).toBeInTheDocument(); expect(applied).toEqual([false, true])
  })
})

describe('order detail', () => {
  it('shows items, payment summary, address with a copy button, timeline and the next best action (accept a new order)', async () => {
    const m = mockOrder(order())
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    expect(await screen.findByRole('heading', { name: 'Order SO-2026-000001', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Pending acceptance')).toBeInTheDocument()
    expect(screen.getByText('Blue mug')).toBeInTheDocument(); expect(screen.getByText('Colour: Red')).toBeInTheDocument(); expect(screen.getByText('SKU NAP-1')).toBeInTheDocument()
    const pay = screen.getByRole('region', { name: 'Payment summary' })
    expect(within(pay).getByText('$48.20')).toBeInTheDocument(); expect(within(pay).getByText('$41.00')).toBeInTheDocument(); expect(within(pay).getByText('Your earnings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument(); expect(screen.getByText(/1 Main St/)).toBeInTheDocument()
    expect(screen.getByText('Order placed')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Accept order' })[0])
    await waitFor(() => expect(m.calls.some((c) => c.path === 'accept' && c.body.version === 3)).toBe(true))
  })

  it('ship dialog supports a partial shipment: quantity limits, tracking format check, carrier, and sends only the chosen lines', async () => {
    const m = mockOrder(order({ status: 'Accepted', actions: { ...ACTIONS, ship: true, cancel: true, hold: true } }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click((await screen.findAllByRole('button', { name: /^Ship/ }))[0])
    const dlg = await screen.findByRole('dialog', { name: 'Ship order SO-2026-000001' })
    // too many, then fix; second line to zero (not in this parcel)
    const mug = within(dlg).getByLabelText('Quantity of Blue mug'); const nap = within(dlg).getByLabelText('Quantity of Linen napkin')
    await userEvent.clear(mug); await userEvent.type(mug, '4'); expect(within(dlg).getByText('Between 0 and 3')).toBeInTheDocument()
    await userEvent.clear(mug); await userEvent.type(mug, '2'); await userEvent.clear(nap); await userEvent.type(nap, '0')
    expect(within(dlg).getByText(/partial shipment/)).toBeInTheDocument()
    await userEvent.type(within(dlg).getByLabelText('Tracking number'), '12345')
    expect(within(dlg).getByText("That doesn't look like a UPS tracking number.")).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Ship these items' }))
    expect(m.calls.length).toBe(0)                                                                   // invalid: nothing was sent
    await userEvent.clear(within(dlg).getByLabelText('Tracking number')); await userEvent.type(within(dlg).getByLabelText('Tracking number'), '1z 999aa1 0123456784')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Ship these items' }))
    await waitFor(() => expect(m.calls.length).toBe(1))
    expect(m.calls[0].path).toBe('ship')
    expect(m.calls[0].body).toMatchObject({ carrier: 'UPS', trackingNumber: '1Z999AA10123456784', version: 3, lines: [{ lineId: 'l1', quantity: 2 }] })
  })

  it('shows what already shipped and lets you edit tracking', async () => {
    const m = mockOrder(order({ status: 'PartiallyShipped', actions: { ...ACTIONS, ship: true, editTracking: true }, shipments: [{ id: 's1', carrier: 'UPS', service: null, trackingNumber: '1Z999AA10123456784', trackingUrl: 'https://www.ups.com/track?tracknum=1Z999AA10123456784', shippedAt: '2026-11-02T10:00:00Z', deliveredAt: null, lines: [{ lineId: 'l1', quantity: 2 }] }] }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    const link = await screen.findByRole('link', { name: /1Z999AA10123456784/ })
    expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    await userEvent.click(screen.getByRole('button', { name: /Edit tracking/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Edit tracking' })
    const t = within(dlg).getByLabelText('Tracking number'); await userEvent.clear(t); await userEvent.type(t, '123456789012'); await userEvent.selectOptions(within(dlg).getByLabelText('Carrier'), 'FedEx')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save tracking' }))
    await waitFor(() => expect(m.calls.find((c) => c.path === 'tracking')?.body).toMatchObject({ carrier: 'FedEx', trackingNumber: '123456789012' }))
  })

  it('cancel needs a reason, offers the restock switch and confirms what happens', async () => {
    const m = mockOrder(order({ status: 'Accepted' }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel order…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Cancel order SO-2026-000001' })
    expect(within(dlg).getByText(/full refund/)).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel order' }))
    expect(await within(dlg).findByText('Choose a reason.')).toBeInTheDocument(); expect(m.calls.length).toBe(0)
    await userEvent.selectOptions(within(dlg).getByLabelText('Reason'), 'out_of_stock'); await userEvent.click(within(dlg).getByLabelText('Put the items back in stock'))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel order' }))
    await waitFor(() => expect(m.calls[0]).toMatchObject({ path: 'cancel', body: { reason: 'out_of_stock', restock: false, version: 3 } }))
  })

  it('a partly shipped order offers to cancel the unshipped items instead', async () => {
    mockOrder(order({ status: 'PartiallyShipped', actions: { ...ACTIONS, cancel: true, cancelRemainder: true, ship: true } }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel unshipped items…' }))
    expect(await screen.findByRole('dialog', { name: "Cancel the items that haven't shipped" })).toBeInTheDocument()
  })

  it('refund dialog: per-line quantity and shipping limits, live total from the server, a Manager limit, and a confirmation before anything is sent', async () => {
    const o = order({ status: 'Delivered', actions: { ...ACTIONS, refund: true }, lines: order().lines.map((l) => ({ ...l, shippedQty: l.quantity, unshippedQty: 0 })) })
    const m = mockOrder(o)
    let previews = 0
    server.use(http.post(`${API}/seller/orders/:id/refunds/preview`, async ({ request }) => { previews++; const b = (await request.json()) as { lines: { quantity: number }[]; shippingCents: number }; return HttpResponse.json({ amountCents: b.lines.reduce((n, l) => n + l.quantity * 1080, 0) + b.shippingCents, shippingCents: b.shippingCents, maxCents: 4820, lines: [] }) }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Issue a refund…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Refund order SO-2026-000001' })
    expect(within(dlg).getByText('Choose what to refund to see the total.')).toBeInTheDocument()
    const q = within(dlg).getByLabelText('Refund quantity of Blue mug')
    await userEvent.clear(q); await userEvent.type(q, '9'); expect(within(dlg).getByText('Between 0 and 3')).toBeInTheDocument()
    await userEvent.clear(q); await userEvent.type(q, '2')
    const ship = within(dlg).getByLabelText(/Shipping to refund/); await userEvent.clear(ship); await userEvent.type(ship, '6'); expect(within(dlg).getByText(/At most \$5\.00 of shipping/)).toBeInTheDocument()
    await userEvent.clear(ship); await userEvent.type(ship, '5')
    expect(await within(dlg).findByText('$26.60')).toBeInTheDocument(); expect(previews).toBeGreaterThan(0)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Review refund' }))
    expect(await within(dlg).findByText('Choose a reason.')).toBeInTheDocument()
    await userEvent.selectOptions(within(dlg).getByLabelText('Reason'), 'goodwill'); await userEvent.click(within(dlg).getByRole('button', { name: 'Review refund' }))
    const confirm = await screen.findByRole('dialog', { name: 'Refund this amount?' })
    expect(within(confirm).getByText(/can’t undo a refund/)).toBeInTheDocument(); expect(m.calls.length).toBe(0)
    await userEvent.click(within(confirm).getByRole('button', { name: 'Yes, refund $26.60' }))
    await waitFor(() => expect(m.calls[0]).toMatchObject({ path: 'refunds', body: { reason: 'goodwill', shippingCents: 500, lines: [{ lineId: 'l1', quantity: 2 }] } }))
  })

  it('a Manager with a refund limit cannot go over it', async () => {
    mockOrder(order({ status: 'Delivered', actions: { ...ACTIONS, refund: true, refundLimitCents: 1500 }, lines: order().lines.map((l) => ({ ...l, shippedQty: l.quantity, unshippedQty: 0 })) }))
    server.use(http.post(`${API}/seller/orders/:id/refunds/preview`, () => HttpResponse.json({ amountCents: 3240, shippingCents: 0, maxCents: 4820, lines: [] })))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1', { activeAccountId: 'a1', role: 'Manager', accounts: [{ sellerId: 'a1', vendorName: 'Acme', role: 'Manager', accountStatus: 'Approved', brandCount: 1 }] })
    await userEvent.click(await screen.findByRole('button', { name: 'Issue a refund…' }))
    const dlg = await screen.findByRole('dialog', { name: /Refund order/ })
    const q = within(dlg).getByLabelText('Refund quantity of Blue mug'); await userEvent.clear(q); await userEvent.type(q, '3')
    await userEvent.selectOptions(within(dlg).getByLabelText('Reason'), 'goodwill')
    expect(await within(dlg).findByText('$32.40')).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Review refund' }))
    expect(await within(dlg).findByText(/up to \$15\.00 at a time/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Refund this amount?' })).toBeNull()
  })

  it('return handling: approve, reject needs an allowed reason, receive with the restock switch, then refund that return', async () => {
    const base = order({ status: 'ReturnRequested', actions: { ...ACTIONS, refund: true, decideReturn: true, receiveReturn: true }, lines: order().lines.map((l) => ({ ...l, shippedQty: l.quantity, unshippedQty: 0 })), returns: [{ id: 'r1', status: 'Requested', reason: 'damaged', buyerComment: 'Arrived broken', decisionReason: null, restock: false, refundCents: 0, createdAt: '2026-11-03T10:00:00Z', decidedAt: null, receivedAt: null, lines: [{ lineId: 'l1', quantity: 1 }] }] })
    const m = mockOrder(base)
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    expect(await screen.findByText(/Arrived broken/)).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Review the return request' })).toHaveAttribute('href', '#ret-h')
    await userEvent.click(screen.getByRole('button', { name: 'Reject return' }))
    const rej = await screen.findByRole('dialog', { name: 'Reject this return' })
    await userEvent.click(within(rej).getByRole('button', { name: 'Reject return' })); expect(await within(rej).findByText('Choose a reason.')).toBeInTheDocument()
    await userEvent.selectOptions(within(rej).getByLabelText('Reason'), 'item_used'); await userEvent.click(within(rej).getByRole('button', { name: 'Reject return' }))
    await waitFor(() => expect(m.calls[0]).toMatchObject({ path: 'returns/r1/reject', body: { reason: 'item_used' } }))
    await userEvent.click(screen.getByRole('button', { name: 'Approve return' }))
    await waitFor(() => expect(m.calls.some((c) => c.path === 'returns/r1/approve')).toBe(true))
    m.set({ ...base, status: 'ReturnApproved', returns: [{ ...base.returns[0], status: 'Approved' }] })
    await userEvent.click(screen.getByRole('button', { name: 'Approve return' }))   // reload returns the approved state
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as received' }))
    const rec = await screen.findByRole('dialog', { name: 'Mark the return as received' })
    await userEvent.click(within(rec).getByLabelText('Put the returned items back in stock')); await userEvent.click(within(rec).getByRole('button', { name: 'Items received' }))
    await waitFor(() => expect(m.calls.some((c) => c.path === 'returns/r1/receive' && c.body.restock === false)).toBe(true))
  })

  it('buyer cancellation request: approve with restock or decline with a note', async () => {
    const m = mockOrder(order({ status: 'Accepted', cancelRequested: true, actions: { ...ACTIONS, cancel: true, decideCancellation: true }, cancellations: [{ id: 'c1', requestedBy: 'Buyer', status: 'Requested', reason: 'changed_mind', note: 'Too slow', decisionNote: null, createdAt: '2026-11-03T10:00:00Z', resolvedAt: null }] }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    expect(await screen.findByText('Cancellation requested')).toBeInTheDocument(); expect(screen.getByText(/Too slow/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Decline/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Decline the cancellation' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Decline request' })); expect(await within(dlg).findByText(/Explain why/)).toBeInTheDocument()
    await userEvent.type(within(dlg).getByLabelText('Tell the buyer why'), 'Already packed'); await userEvent.click(within(dlg).getByRole('button', { name: 'Decline request' }))
    await waitFor(() => expect(m.calls[0]).toMatchObject({ path: 'cancellation-requests/c1/reject', body: { note: 'Already packed' } }))
  })

  it('role-based visibility: with no permitted actions (Viewer) there are no action buttons and no note form', async () => {
    mockOrder(order({ actions: { ...ACTIONS, note: false } }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1', { activeAccountId: 'a1', role: 'Viewer', accounts: [{ sellerId: 'a1', vendorName: 'Acme', role: 'Viewer', accountStatus: 'Approved', brandCount: 1 }] })
    await screen.findByRole('heading', { name: 'Order SO-2026-000001', level: 1 })
    for (const n of ['Accept order', 'Ship items…', 'Cancel order…', 'Issue a refund…', 'Put on hold…', 'Add note']) expect(screen.queryByRole('button', { name: n })).toBeNull()
    expect(screen.getByRole('button', { name: 'Packing slip' })).toBeInTheDocument()
  })

  it('internal notes, buyer message with saved replies and the contact-details warning', async () => {
    const m = mockOrder(order())
    let tries = 0
    server.use(http.post(`${API}/seller/orders/o1/messages`, async ({ request }) => { const b = (await request.json()) as { acknowledgeWarning: boolean }; tries++; if (!b.acknowledgeWarning) return HttpResponse.json({ code: 'contact_details_warning', title: 'x', warnings: ['email'] }, { status: 409 }); return HttpResponse.json({ conversationId: 'c9' }, { status: 201 }) }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.type(await screen.findByLabelText('Add a note'), 'Call the carrier'); await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(m.calls.some((c) => c.path === 'notes' && c.body.text === 'Call the carrier')).toBe(true))
    await userEvent.selectOptions(await screen.findByLabelText('Saved reply'), 't1')
    expect(screen.getByLabelText('Message to the buyer')).toHaveValue('Your order is a day late.')
    await userEvent.type(screen.getByLabelText('Message to the buyer'), ' mail me at a@b.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText(/shares contact details or a payment link/)).toBeInTheDocument(); expect(tries).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: 'Send anyway' }))
    expect(await screen.findByText('Message sent.')).toBeInTheDocument(); expect(await screen.findByRole('link', { name: 'Open the conversation' })).toHaveAttribute('href', '/messages/c9')
  })

  it('a missing or foreign order shows a friendly not-found page', async () => {
    server.use(http.get(`${API}/seller/orders/:id`, () => HttpResponse.json({ title: 'Not Found' }, { status: 404 })))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/zzz')
    expect(await screen.findByRole('heading', { name: 'Order not found' })).toBeInTheDocument()
  })
})
