import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { server } from '../test/server'
import OrderDetailPage from '../orders/OrderDetail'
import OrdersListPage from '../orders/OrdersList'
import { ACTIONS, API, item, mockOrder, mount, order } from '../orders/testkit'
import ShippingSettings from './ShippingSettings'
import { BulkLabelsDialog, ReturnLabelDialog } from './OrderShipping'
import { dayZ, dtZ, summaryLabel, summaryTone, trackLabel, trackTone } from './format'
import { errDetail, labelExt, printLabel, shippingApi, type Label, type OrderTracking, type Quote, type ShippingConfig } from './api'

const addr = { id: 'a1', brandId: null, label: 'Warehouse', name: 'Acme Shop', company: null, line1: '10 Warehouse Rd', line2: null, city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', phone: null, email: null, isDefault: true, validation: 'valid' as const, validationMessage: null, validatedAt: null }
const cfg = (o: Partial<ShippingConfig> = {}): ShippingConfig => ({
  addresses: [addr], packages: [{ id: 'p1', name: 'Medium box', kind: 'box', lengthMm: 300, widthMm: 200, heightMm: 150, emptyWeightGrams: 100, isDefault: true }],
  profiles: [{ id: 'f1', brandId: null, name: 'Standard shipping', isDefault: true, currency: 'USD', freeShippingThresholdCents: 7500, zones: [{ name: 'Domestic', kind: 'domestic', countries: ['US'], speeds: [{ speed: 'standard', enabled: true, method: 'flat', flatCents: 500, baseCents: null, perKgCents: null }] }] }],
  settings: [{ brandId: null, handlingDays: 3, labelFormat: null, returnAddressId: null }], labelFormats: ['PDF_4x6', 'PNG', 'ZPLII'], defaultLabelFormat: 'PDF_4x6', speeds: ['standard', 'expedited', 'overnight'], provider: 'fake',
  spend: { limitCents: 0, spentCents: 0 }, canManage: true, ...o,
})
const viewer = { activeAccountId: 'a1', role: 'Viewer', accounts: [{ sellerId: 'a1', vendorName: 'Acme', role: 'Viewer', accountStatus: 'Approved', brandCount: 1 }] }

const label = (o: Partial<Label> = {}): Label => ({
  id: 'lb1', orderId: 'o1', kind: 'outbound', status: 'active', shipmentId: 's1', returnId: null, carrier: 'USPS', service: 'Ground Advantage', trackingNumber: '9400111899223100001', costCents: 460, currency: 'USD',
  format: 'PDF_4x6', purchasedAt: '2026-11-02T10:00:00Z', printedAt: null, estimatedDelivery: '2026-11-07T00:00:00Z', refundStatus: 'none', refundError: null, hasFile: true, canVoid: true, fileUrl: '/api/v1/seller/shipping/labels/lb1/file', ...o,
})
const quote = (o: Partial<Quote> = {}): Quote => ({
  quoteId: 'q1', expiresAt: new Date(Date.now() + 900_000).toISOString(), addressStatus: 'valid', addressMessage: null, international: false, deliverBy: new Date(Date.now() + 8 * 86_400_000).toISOString(),
  parcel: { lengthMm: 300, widthMm: 200, heightMm: 150, weightGrams: 600 }, lines: [{ lineId: 'l1', quantity: 3 }, { lineId: 'l2', quantity: 1 }],
  rates: [
    { rateId: 'r1', carrier: 'USPS', service: 'Ground Advantage', amountCents: 460, currency: 'USD', estimatedDays: 5, estimatedDelivery: '2026-11-07T00:00:00Z', meetsDeliverBy: true, recommended: true },
    { rateId: 'r2', carrier: 'USPS', service: 'Priority Mail', amountCents: 880, currency: 'USD', estimatedDays: 3, estimatedDelivery: '2026-11-05T00:00:00Z', meetsDeliverBy: true, recommended: false },
    { rateId: 'r3', carrier: 'FedEx', service: 'Overnight', amountCents: 3120, currency: 'USD', estimatedDays: 1, estimatedDelivery: '2026-11-04T00:00:00Z', meetsDeliverBy: true, recommended: false },
  ], ...o,
})
const tracking = (o: Partial<OrderTracking> = {}): OrderTracking => ({ needsAttention: false, attentionReason: null, shipments: [], returns: [], labels: [], ...o })
const accepted = () => order({ status: 'Accepted', actions: { ...ACTIONS, ship: true, buyLabel: true, hold: true, cancel: true, editTracking: false } })

function mockShipping(o: { cfg?: ShippingConfig; q?: Quote; rates?: (b: any) => Response | undefined; buy?: (b: any) => Response | undefined } = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const calls: { rates: any[]; buy: any[] } = { rates: [], buy: [] } // eslint-disable-line @typescript-eslint/no-explicit-any
  server.use(
    http.get(`${API}/seller/shipping/settings`, () => HttpResponse.json(o.cfg ?? cfg())),
    http.post(`${API}/seller/shipping/orders/:id/rates`, async ({ request }) => { const b = await request.json(); calls.rates.push(b); return o.rates?.(b) ?? HttpResponse.json(o.q ?? quote()) }),
    http.post(`${API}/seller/shipping/orders/:id/labels`, async ({ request }) => { const b = await request.json(); calls.buy.push(b); return o.buy?.(b) ?? HttpResponse.json({ label: label(), replayed: false }, { status: 201 }) }),
    http.get(`${API}/seller/shipping/orders/:id/tracking`, () => HttpResponse.json(tracking())),
  )
  return calls
}

describe('helpers', () => {
  it('maps tracking statuses to plain words and tones', () => {
    expect(trackLabel('out_for_delivery')).toBe('Out for delivery'); expect(trackLabel('weird')).toBe('No updates yet')
    expect(trackTone('delivered')).toBe('ok'); expect(trackTone('failure')).toBe('bad'); expect(trackTone('in_transit')).toBe('')
    expect(summaryLabel('exception')).toBe('Delivery problem'); expect(summaryTone('exception')).toBe('bad'); expect(summaryLabel(null)).toBe('')
    expect(labelExt('ZPLII')).toBe('zpl'); expect(labelExt('PNG')).toBe('png'); expect(labelExt('PDF_4x6')).toBe('pdf')
  })
  it('reads structured error details only when they are an object', () => {
    expect(errDetail({ body: { errors: { requote: true } } })).toEqual({ requote: true }); expect(errDetail({ body: { errors: ['x'] } })).toEqual({}); expect(errDetail(new Error('x'))).toEqual({})
  })
})

describe('Settings → Shipping', () => {
  it('shows addresses, packages, rates and handling for everyone, and lets an Owner add an address', async () => {
    const posted: any[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
    server.use(http.get(`${API}/seller/shipping/settings`, () => HttpResponse.json(cfg())), http.post(`${API}/seller/shipping/addresses`, async ({ request }) => { posted.push(await request.json()); return HttpResponse.json({ ...addr, id: 'a2' }, { status: 201 }) }))
    mount(<ShippingSettings />, '/s')
    expect(await screen.findByRole('heading', { name: 'Ship-from addresses' })).toBeInTheDocument()
    expect(screen.getByText('Address verified')).toBeInTheDocument(); expect(screen.getByText('Medium box', { selector: 'strong' })).toBeInTheDocument(); expect(screen.getByText('Standard shipping', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText(/Free shipping from \$75\.00/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add an address' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save address' }))                                  // nothing typed: says what is missing, sends nothing
    expect(await within(dlg).findByText('Enter a contact name.')).toBeInTheDocument(); expect(posted).toHaveLength(0)
    await userEvent.type(within(dlg).getByLabelText('Contact name'), 'Dana'); await userEvent.type(within(dlg).getByLabelText('Address line 1'), '5 Dock St')
    await userEvent.type(within(dlg).getByLabelText('City'), 'Queens'); await userEvent.type(within(dlg).getByLabelText('State or region'), 'NY'); await userEvent.type(within(dlg).getByLabelText('ZIP or postal code'), '11101')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save address' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ name: 'Dana', line1: '5 Dock St', city: 'Queens', region: 'NY', postalCode: '11101', country: 'US', isDefault: false })
    expect(await screen.findByText('Address saved.')).toBeInTheDocument()
  })

  it('warns when an address could not be verified', async () => {
    server.use(http.get(`${API}/seller/shipping/settings`, () => HttpResponse.json(cfg({ addresses: [{ ...addr, validation: 'unverified', validationMessage: 'The address could not be fully verified.' }] }))))
    mount(<ShippingSettings />, '/s')
    expect(await screen.findByText('Not verified')).toBeInTheDocument(); expect(screen.getByText('The address could not be fully verified.')).toBeInTheDocument()
  })

  it('a read-only role sees the settings but no edit controls', async () => {
    server.use(http.get(`${API}/seller/shipping/settings`, () => HttpResponse.json(cfg({ canManage: false }))))
    mount(<ShippingSettings />, '/s', '/s', viewer)
    expect(await screen.findByText(/Only Owners and Admins can change shipping settings/)).toBeInTheDocument()
    expect(screen.getByText('Warehouse', { selector: 'strong' })).toBeInTheDocument()
    for (const n of ['Add an address', 'Add a package', 'Add a rate profile', 'Save']) expect(screen.queryByRole('button', { name: n })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull(); expect(screen.getByRole('spinbutton', { name: /Handling time/ })).toBeDisabled()
  })

  it('saves handling time, label format and the return address', async () => {
    let body: any // eslint-disable-line @typescript-eslint/no-explicit-any
    server.use(http.get(`${API}/seller/shipping/settings`, () => HttpResponse.json(cfg())), http.put(`${API}/seller/shipping/settings`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}) }))
    mount(<ShippingSettings />, '/s')
    const days = await screen.findByRole('spinbutton', { name: /Handling time/ })
    await userEvent.clear(days); await userEvent.type(days, '40'); expect(await screen.findByText('Use a whole number from 0 to 30.')).toBeInTheDocument()
    await userEvent.clear(days); await userEvent.type(days, '5')
    await userEvent.selectOptions(screen.getByLabelText('Label format'), 'ZPLII'); await userEvent.selectOptions(screen.getByLabelText('Return address'), 'a1')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toMatchObject({ handlingDays: 5, labelFormat: 'ZPLII', returnAddressId: 'a1' }))
    expect(await screen.findByText('Handling and returns saved.')).toBeInTheDocument()
  })

  it('a rate profile turns dollars into cents, flat or by weight, and refuses nonsense', async () => {
    let body: any // eslint-disable-line @typescript-eslint/no-explicit-any
    server.use(http.get(`${API}/seller/shipping/settings`, () => HttpResponse.json(cfg({ profiles: [] }))), http.post(`${API}/seller/shipping/profiles`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}, { status: 201 }) }))
    mount(<ShippingSettings />, '/s')
    await userEvent.click(await screen.findByRole('button', { name: 'Add a rate profile' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText(/Free shipping from/), 'abc')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save profile' }))
    expect(await within(dlg).findAllByText('Enter an amount like 75.00.')).not.toHaveLength(0); expect(body).toBeUndefined()
    await userEvent.clear(within(dlg).getByLabelText(/Free shipping from/)); await userEvent.type(within(dlg).getByLabelText(/Free shipping from/), '75')
    await userEvent.clear(within(dlg).getByLabelText('Standard flat rate (USD, zone 1)')); await userEvent.type(within(dlg).getByLabelText('Standard flat rate (USD, zone 1)'), '4.95')
    await userEvent.click(within(dlg).getByLabelText(/Overnight in zone 1/))
    await userEvent.selectOptions(within(dlg).getByLabelText('Overnight price type (zone 1)'), 'weight')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(body).toBeDefined())
    expect(body.freeShippingThresholdCents).toBe(7500)
    expect(body.zones[0].speeds).toEqual([{ speed: 'standard', enabled: true, method: 'flat', flatCents: 495 }, { speed: 'overnight', enabled: true, method: 'weight', baseCents: 1500, perKgCents: 400 }])
  })
})

describe('Buy label in the ship dialog', () => {
  const open = async (o = accepted()) => {
    mockOrder(o)
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Ship order' }))
    return screen.findByRole('dialog')
  }

  it('offers Buy label and Enter tracking manually as tabs, and the manual way still works', async () => {
    mockShipping()
    const dlg = await open()
    expect(within(dlg).getByRole('tab', { name: 'Buy label', selected: true })).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('tab', { name: 'Enter tracking manually' }))
    expect(within(dlg).getByLabelText('Tracking number')).toBeInTheDocument(); expect(within(dlg).getByLabelText('Carrier')).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Mark as shipped' })).toBeInTheDocument()
  })

  it('gets rates for the chosen package, marks the recommended one and buys the selected service once', async () => {
    const calls = mockShipping()
    const dlg = await open()
    await userEvent.type(await within(dlg).findByLabelText(/Weight of the items/), '500')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Get shipping rates' }))
    expect(await within(dlg).findByText('Recommended')).toBeInTheDocument()
    expect(calls.rates[0]).toMatchObject({ fromAddressId: 'a1', package: { presetId: 'p1', weightGrams: 500 } })
    expect(calls.rates[0].lines).toHaveLength(2)
    const radios = within(dlg).getAllByRole('radio'); expect(radios).toHaveLength(3); expect(radios[0]).toBeChecked()            // recommended is preselected
    await userEvent.click(within(dlg).getByRole('radio', { name: /Priority Mail/ }))
    const buy = within(dlg).getByRole('button', { name: 'Buy label · $8.80' })
    await userEvent.dblClick(buy)                                                                                              // a double click must not buy twice
    await waitFor(() => expect(calls.buy.length).toBeGreaterThan(0))
    expect(calls.buy[0]).toMatchObject({ quoteId: 'q1', rateId: 'r2' }); expect(typeof calls.buy[0].idempotencyKey).toBe('string')
    expect(new Set(calls.buy.map((b) => b.idempotencyKey)).size).toBe(1)                                                       // every attempt carries the same key
    expect(await within(dlg).findByText(/Label bought for \$4\.60/)).toBeInTheDocument()
    expect(within(dlg).getByText('9400111899223100001')).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Print label' })).toBeInTheDocument(); expect(within(dlg).getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(within(dlg).getByLabelText(/Print the packing slip together/)).toBeInTheDocument()
  })

  it('keeps showing the bought label (and Print) when the page reloads the order as fully shipped', async () => {
    const m = mockOrder(accepted())
    mockShipping({ buy: () => { m.set(order({ status: 'Shipped', actions: { ...ACTIONS }, lines: accepted().lines.map((l) => ({ ...l, shippedQty: l.quantity, unshippedQty: 0 })) })); return undefined } })
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Ship order' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Get shipping rates' }))
    await userEvent.click(await within(dlg).findByRole('button', { name: /Buy label/ }))
    expect(await within(dlg).findByText(/Label bought for/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Shipped', { exact: true })).toBeInTheDocument())      // the page behind has reloaded
    expect(within(screen.getByRole('dialog')).getByText(/Label bought for/)).toBeInTheDocument(); expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Print label' })).toBeInTheDocument()
  })

  it('says none is recommended when nothing arrives in time', async () => {
    mockShipping({ q: quote({ rates: quote().rates.map((r) => ({ ...r, recommended: false, meetsDeliverBy: false })) }) })
    const dlg = await open()
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Get shipping rates' }))
    expect(await within(dlg).findByText(/None of these arrives by the deliver-by date/)).toBeInTheDocument(); expect(within(dlg).queryByText('Recommended')).toBeNull()
  })

  it('an expired rate is explained, nothing is charged, and new rates can be fetched', async () => {
    mockShipping({ buy: () => HttpResponse.json({ type: 'about:blank', title: 'expired', status: 409, code: 'rate_expired', errors: { requote: true } }, { status: 409 }) })
    const dlg = await open()
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Get shipping rates' }))
    await userEvent.click(await within(dlg).findByRole('button', { name: /Buy label/ }))
    expect(await within(dlg).findByText(/These rates expired\. We are not charging you/)).toBeInTheDocument()
    expect(within(dlg).queryAllByRole('radio')).toHaveLength(0); expect(within(dlg).getByRole('button', { name: 'Get shipping rates' })).toBeInTheDocument()
  })

  it('an unverified buyer address needs "Ship anyway" and a reason, which is sent with the purchase', async () => {
    const calls = mockShipping({ q: quote({ addressStatus: 'unverified', addressMessage: 'The address could not be fully verified.' }) })
    const dlg = await open()
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Get shipping rates' }))
    expect(await within(dlg).findByText(/We couldn’t fully verify this address/)).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: /Buy label/ }))
    expect(await within(dlg).findByText(/tick "Ship anyway" and say why/)).toBeInTheDocument(); expect(calls.buy).toHaveLength(0)
    await userEvent.click(within(dlg).getByLabelText('Ship anyway'))
    await userEvent.type(within(dlg).getByLabelText('Why are you shipping to this address?'), 'Buyer confirmed by message')
    await userEvent.click(within(dlg).getByRole('button', { name: /Buy label/ }))
    await waitFor(() => expect(calls.buy).toHaveLength(1)); expect(calls.buy[0].shipAnyway).toEqual({ reason: 'Buyer confirmed by message' })
  })

  it('an international order asks for customs and sends them with the rate request', async () => {
    const calls = mockShipping({ cfg: cfg({ addresses: [{ ...addr, country: 'US' }] }) })
    const dlg = await open(order({ ...accepted(), shippingAddress: { ...order().shippingAddress, country: 'CA', region: 'ON', postalCode: 'M5V 2T6' } }))
    await within(dlg).findByRole('button', { name: 'Get shipping rates' })
    expect(within(dlg).getByRole('group', { name: 'Customs information' })).toBeInTheDocument()
    await userEvent.selectOptions(within(dlg).getByLabelText('What is in the parcel?'), 'gift'); await userEvent.type(within(dlg).getByLabelText(/HS code/), '6912.00')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Get shipping rates' }))
    await waitFor(() => expect(calls.rates).toHaveLength(1)); expect(calls.rates[0].customs).toEqual({ contentsType: 'gift', nonDeliveryOption: 'return', hsCode: '6912.00' })
  })

  it('without a ship-from address the dialog opens the manual form and points to settings', async () => {
    mockShipping({ cfg: cfg({ addresses: [] }) })
    const dlg = await open()
    expect(await within(dlg).findByLabelText('Tracking number')).toBeInTheDocument()                                          // the established manual flow is right there
    expect(within(dlg).getByRole('link', { name: /Settings → Shipping/ })).toHaveAttribute('href', '/settings/shipping')
    expect(within(dlg).getByRole('button', { name: 'Mark as shipped' })).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('tab', { name: 'Buy label' }))                                                // going back to the label tab explains what is missing
    expect(await within(dlg).findByRole('button', { name: 'Enter a tracking number yourself' })).toBeInTheDocument()
  })

  it('asks for the weight when the products have none', async () => {
    mockShipping({ rates: () => HttpResponse.json({ type: 'about:blank', title: 'Enter the package weight (Blue mug has no weight).', status: 422, code: 'weight_required' }, { status: 422 }) })
    const dlg = await open()
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Get shipping rates' }))
    expect(await within(dlg).findByText(/Enter the package weight/)).toBeInTheDocument()
  })
})

describe('Tracking on the order page', () => {
  const shipped = (o: Partial<ReturnType<typeof order>> = {}) => order({ status: 'Shipped', actions: { ...ACTIONS, editTracking: true, note: true }, shipments: [{ id: 's1', carrier: 'USPS', service: 'Ground Advantage', trackingNumber: '9400111899223100001', trackingUrl: null, shippedAt: '2026-11-02T10:00:00Z', deliveredAt: null, lines: [], trackingStatus: 'in_transit', labelId: 'lb1', labelCostCents: 460, labelCurrency: 'USD' }], ...o })
  const track = (o: Partial<OrderTracking> = {}) => tracking({
    labels: [label()], shipments: [{ id: 's1', method: 'carrier', carrier: 'USPS', service: 'Ground Advantage', trackingNumber: '9400111899223100001', trackingUrl: null, status: 'in_transit', statusLabel: 'In transit', statusDetail: 'Departed', eta: '2026-11-07T00:00:00Z', deliveredAt: null, live: true, labelId: 'lb1',
      events: [{ status: 'pre_transit', label: 'Label created', detail: null, location: null, at: '2026-11-02T10:00:00Z' }, { status: 'in_transit', label: 'In transit', detail: 'Departed facility', location: 'Brooklyn, NY', at: '2026-11-03T09:00:00Z' }] }], ...o })

  it('shows the timeline newest first with status, estimate, label cost and the label actions', async () => {
    mockOrder(shipped()); server.use(http.get(`${API}/seller/shipping/orders/:id/tracking`, () => HttpResponse.json(track())))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    const panel = (await screen.findByRole('heading', { name: 'Tracking and labels' })).closest('section')!
    const tl = await within(panel).findByRole('list', { name: 'Tracking history of 9400111899223100001' })
    const items = within(tl).getAllByRole('listitem'); expect(items[0]).toHaveTextContent('In transit'); expect(items[0]).toHaveTextContent('Departed facility'); expect(items[1]).toHaveTextContent('Label created')
    expect(within(panel).getByText(/Estimated delivery/)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Print label' })).toBeInTheDocument(); expect(within(panel).getByRole('button', { name: /Void label/ })).toBeInTheDocument()
    expect(screen.getAllByText(/Label \$4\.60/).length).toBeGreaterThan(0)
  })

  it('voiding explains that the money returns only when the carrier confirms', async () => {
    mockOrder(shipped()); let voided = false
    server.use(http.get(`${API}/seller/shipping/orders/:id/tracking`, () => HttpResponse.json(voided ? track({ labels: [label({ status: 'voiding', canVoid: false })] }) : track())),
      http.post(`${API}/seller/shipping/labels/lb1/void`, () => { voided = true; return HttpResponse.json({ label: label({ status: 'voiding' }), pending: true }) }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: /Void label/ }))
    const dlg = await screen.findByRole('dialog'); expect(within(dlg).getByText(/only when the carrier confirms the refund/)).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Yes, void the label' }))
    expect((await screen.findAllByText(/Refund requested\. We credit your balance when the carrier confirms\./)).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByText('Refund pending')).toBeInTheDocument()); expect(screen.queryByRole('button', { name: /Void label/ })).toBeNull()
  })

  it('a delivery problem shows a banner and can be marked as handled', async () => {
    mockOrder(shipped({ needsAttention: true, attentionReason: 'Address not found' })); let dismissed = false
    server.use(http.get(`${API}/seller/shipping/orders/:id/tracking`, () => HttpResponse.json(track({ needsAttention: !dismissed, attentionReason: 'Address not found' }))), http.post(`${API}/seller/shipping/orders/:id/attention/dismiss`, () => { dismissed = true; return HttpResponse.json({ needsAttention: false }) }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    expect(await screen.findByText('Delivery problem – needs attention')).toBeInTheDocument()
    const banner = (await screen.findByText(/This order needs attention\./)).closest('div')!; expect(banner).toHaveTextContent('Address not found')
    await userEvent.click(within(banner).getByRole('button', { name: 'Mark as handled' }))
    await waitFor(() => expect(dismissed).toBe(true))
  })

  it('a Viewer sees the tracking but has no void or handle buttons', async () => {
    mockOrder(shipped({ needsAttention: true, attentionReason: 'Damaged', actions: { ...ACTIONS } })); server.use(http.get(`${API}/seller/shipping/orders/:id/tracking`, () => HttpResponse.json(track({ needsAttention: true, attentionReason: 'Damaged' }))))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1', viewer)
    await screen.findByRole('list', { name: 'Tracking history of 9400111899223100001' })
    expect(screen.queryByRole('button', { name: /Void label/ })).toBeNull(); expect(screen.queryByRole('button', { name: 'Mark as handled' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Ship order' })).toBeNull()
  })

  it('an approved return offers a prepaid label; once sent it shows the parcel and announces arrival', async () => {
    const base = order({ status: 'ReturnApproved', actions: { ...ACTIONS, receiveReturn: true, note: true }, returns: [{ id: 'r1', status: 'Approved', reason: 'damaged', buyerComment: null, decisionReason: null, restock: false, refundCents: 0, createdAt: '2026-11-03T10:00:00Z', decidedAt: '2026-11-03T11:00:00Z', receivedAt: null, lines: [{ lineId: 'l1', quantity: 1 }] }] })
    mockOrder(base); const sent: any[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
    server.use(http.get(`${API}/seller/shipping/settings`, () => HttpResponse.json(cfg())),
      http.post(`${API}/seller/shipping/orders/:id/returns/:rid/label`, async ({ request }) => { sent.push(await request.json()); return HttpResponse.json({ label: label({ kind: 'return', id: 'lb2', returnId: 'r1' }), labelUrl: 'https://api.test/x' }, { status: 201 }) }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Send a prepaid return label' }))
    const dlg = await screen.findByRole('dialog'); expect(within(dlg).getByText(/You pay for this label/)).toBeInTheDocument()
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Buy and send the return label' }))
    expect(await within(dlg).findByText(/Return label bought for \$4\.60\. Solvelt emails it to the buyer\./)).toBeInTheDocument()
    expect(sent[0].package.presetId).toBe('p1'); expect(typeof sent[0].idempotencyKey).toBe('string')
  })

  it('shows that the return arrived next to the receive button, never receives it by itself', async () => {
    mockOrder(order({ status: 'ReturnApproved', actions: { ...ACTIONS, receiveReturn: true }, returns: [{ id: 'r1', status: 'Approved', reason: 'damaged', buyerComment: null, decisionReason: null, restock: false, refundCents: 0, createdAt: '2026-11-03T10:00:00Z', decidedAt: null, receivedAt: null, lines: [{ lineId: 'l1', quantity: 1 }] }],
      returnShipments: [{ id: 'rs1', returnId: 'r1', carrier: 'USPS', service: null, trackingNumber: '9400111899223100009', trackingUrl: null, trackingStatus: 'delivered', eta: null, deliveredAt: '2026-11-05T10:00:00Z', labelId: 'lb2' }] }))
    server.use(http.get(`${API}/seller/shipping/orders/:id/tracking`, () => HttpResponse.json(tracking({ returns: [{ id: 'rs1', returnId: 'r1', carrier: 'USPS', service: null, trackingNumber: '9400111899223100009', trackingUrl: null, status: 'delivered', statusLabel: 'Delivered', eta: null, deliveredAt: '2026-11-05T10:00:00Z', labelId: 'lb2', events: [] }] }))))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    expect((await screen.findAllByText(/Return arrived – inspect the items and mark the return/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Mark as received' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Send a prepaid return label' })).toBeNull()
  })
})

describe('Orders list', () => {
  const counts = { needsAction: 1, pending: 0, shipped: 1, delivered: 0, cancelled: 0, returns: 0, late: 0, all: 3, exceptions: 1 }
  const dash = { todayOrders: 0, toShip: 1, late: 0, returnsOpen: 0, sales30Cents: 0, orders30: 0, daily: [], lateShipmentRate: 0, cancellationRate: 0, shipping: { labelsToPrint: 2, exceptions: 1 }, messages: { unread: 0, needsReply: 0, overdue: 0, avgResponseHours: null, repliedInTimePct: null } }
  const list = (items = [item({ status: 'Shipped', trackingStatus: 'in_transit' }), item({ id: 'o2', number: 'SO-2026-000002', status: 'Shipped', trackingStatus: 'exception', needsAttention: true })]) => {
    const urls: URL[] = []
    server.use(http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme' }])), http.get(`${API}/seller/orders/counts`, () => HttpResponse.json(counts)), http.get(`${API}/seller/orders/dashboard`, () => HttpResponse.json(dash)),
      http.get(`${API}/seller/orders`, ({ request }) => { urls.push(new URL(request.url)); return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 20 }) }))
    return urls
  }

  it('shows a tracking chip per order, the dashboard tiles, and filters by delivery progress', async () => {
    const urls = list()
    mount(<OrdersListPage />, '/orders')
    expect((await screen.findAllByText('In transit')).length).toBeGreaterThan(0); expect(screen.getAllByText('Delivery problem').length).toBeGreaterThan(0)
    const glance = screen.getByRole('region', { name: 'Orders at a glance' })
    expect(within(glance).getByText('Labels to print').previousSibling).toHaveTextContent('2'); expect(within(glance).getByText('Delivery problems').previousSibling).toHaveTextContent('1')
    await userEvent.click(screen.getByText('More filters'))
    await userEvent.selectOptions(screen.getByLabelText('Delivery progress'), 'exception')
    await waitFor(() => expect(urls.at(-1)!.searchParams.get('tracking')).toBe('exception'))
  })

  it('bulk "Buy labels" shows what was bought and what was not', async () => {
    list(); let body: any // eslint-disable-line @typescript-eslint/no-explicit-any
    server.use(http.get(`${API}/seller/shipping/settings`, () => HttpResponse.json(cfg())), http.post(`${API}/seller/shipping/labels/bulk`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ bought: 1, total: 2, results: [{ orderId: 'o1', number: 'SO-2026-000001', ok: true, code: 'ok', message: '' }, { orderId: 'o2', number: 'SO-2026-000002', ok: false, code: 'address_unverified', message: 'The buyer’s address could not be verified.' }] }) }))
    mount(<OrdersListPage />, '/orders')
    await userEvent.click(await screen.findByLabelText('Select order SO-2026-000001', { selector: 'table input' })); await userEvent.click(screen.getAllByLabelText('Select order SO-2026-000002')[0])
    await userEvent.click(screen.getByRole('button', { name: 'Buy labels' }))
    const dlg = await screen.findByRole('dialog'); await userEvent.click(await within(dlg).findByRole('button', { name: 'Buy 2 labels' }))
    expect(await within(dlg).findByText('1 of 2 labels bought.')).toBeInTheDocument(); expect(within(dlg).getByText(/address could not be verified/)).toBeInTheDocument()
    expect(body).toMatchObject({ orderIds: ['o1', 'o2'], packageId: 'p1', strategy: 'recommended' }); expect(typeof body.idempotencyKey).toBe('string')
  })

  it('a Viewer has no Buy labels button', async () => {
    list(); mount(<OrdersListPage />, '/orders', '/orders', viewer)
    await screen.findAllByRole('link', { name: 'SO-2026-000001' })
    await userEvent.click(screen.getAllByLabelText('Select order SO-2026-000001')[0])
    expect(screen.queryByRole('button', { name: 'Buy labels' })).toBeNull()
  })
})
void fireEvent

describe('Review fixes', () => {
  afterEach(() => { vi.restoreAllMocks() })
  const approvedReturn = { id: 'r1', status: 'Approved' as const, reason: 'damaged', buyerComment: null, decisionReason: null, restock: false, refundCents: 0, createdAt: '2026-11-03T10:00:00Z', decidedAt: '2026-11-03T11:00:00Z', receivedAt: null, lines: [{ lineId: 'l1', quantity: 1 }] }
  const rship = (o: object = {}) => ({ id: 'rs1', returnId: 'r1', carrier: 'USPS', service: null, trackingNumber: '9400111899223100009', trackingUrl: null, trackingStatus: 'pre_transit', eta: null, deliveredAt: null, labelId: 'lb2', voided: false, ...o })

  it('after a return label is voided the page offers a new one, and says the old one was voided', async () => {
    mockOrder(order({ status: 'ReturnApproved', actions: { ...ACTIONS, receiveReturn: true }, returns: [approvedReturn], returnShipments: [rship({ voided: true, trackingStatus: 'unknown' })] }))
    server.use(http.get(`${API}/seller/shipping/orders/:id/tracking`, () => HttpResponse.json(tracking())))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    expect(await screen.findByRole('button', { name: 'Send a prepaid return label' })).toBeInTheDocument()
    expect(screen.getByText(/Return label voided/)).toBeInTheDocument(); expect(screen.queryByText(/Return label sent/)).toBeNull()
  })

  it('a live return label hides the button, and the button is only offered while the order is "Return approved"', async () => {
    mockOrder(order({ status: 'ReturnApproved', actions: { ...ACTIONS, receiveReturn: true }, returns: [approvedReturn], returnShipments: [rship()] }))
    server.use(http.get(`${API}/seller/shipping/orders/:id/tracking`, () => HttpResponse.json(tracking())))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    expect(await screen.findByText(/Return label sent/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Send a prepaid return label' })).toBeNull()
  })

  it('no return label is offered once the order has moved on from "Return approved"', async () => {
    mockOrder(order({ status: 'ReturnReceived', actions: { ...ACTIONS }, returns: [approvedReturn] }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    expect(await screen.findByText(/damaged/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Send a prepaid return label' })).toBeNull()
  })

  it('printing opens the window inside the click (before the file arrives), cuts the opener and only then records the print', async () => {
    let release!: (b: Blob) => void
    vi.spyOn(shippingApi, 'fileBlob').mockReturnValue(new Promise<Blob>((r) => { release = r }))
    const printed = vi.spyOn(shippingApi, 'printed').mockResolvedValue(undefined as never)
    const w = { opener: 'x' as unknown, location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(w as unknown as Window)
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:label'), revokeObjectURL: vi.fn() })
    const p = printLabel(label())
    expect(open).toHaveBeenCalledTimes(1); expect(open.mock.calls[0][0]).toBe('about:blank')   // synchronously: nothing has been awaited yet
    expect(w.opener).toBeNull(); expect(printed).not.toHaveBeenCalled()
    release(new Blob(['x'])); await p
    expect(w.location.href).toBe('blob:label'); expect(printed).toHaveBeenCalledTimes(1)
  })

  it('a blocked window is an error and the label is not recorded as printed', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const fetchFile = vi.spyOn(shippingApi, 'fileBlob'); const printed = vi.spyOn(shippingApi, 'printed')
    await expect(printLabel(label())).rejects.toThrow()
    expect(printed).not.toHaveBeenCalled(); expect(fetchFile).not.toHaveBeenCalled()
  })

  it('a failed download closes the blank window instead of leaving it open', async () => {
    const w = { opener: 'x' as unknown, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(w as unknown as Window); vi.spyOn(shippingApi, 'fileBlob').mockRejectedValue(new Error('nope'))
    await expect(printLabel(label())).rejects.toThrow(); expect(w.close).toHaveBeenCalled()
  })

  it('shipping dates use the account time zone, not the browser zone', () => {
    expect(dayZ('2026-11-04T03:00:00Z', 'America/Los_Angeles')).toMatch(/Nov 3, 2026/); expect(dayZ('2026-11-04T03:00:00Z', 'Asia/Tokyo')).toMatch(/Nov 4, 2026/)
    expect(dtZ('2026-11-04T03:00:00Z', 'America/Los_Angeles')).toMatch(/Nov 3, 2026/); expect(dayZ('2026-11-04T03:00:00Z', 'Not/AZone')).not.toBe('')   // a bad zone never breaks the page
    expect(dayZ(null, 'UTC')).toBe('')
  })

  it('the order page shows shipment times in the account zone', async () => {
    mockOrder(order({ status: 'Shipped', accountTimeZone: 'Asia/Tokyo', shipments: [{ id: 's1', carrier: 'USPS', service: null, trackingNumber: '9400111899223100001', trackingUrl: null, shippedAt: '2026-11-04T20:30:00Z', deliveredAt: null, lines: [{ lineId: 'l1', quantity: 1 }], trackingStatus: undefined, eta: undefined }] }))
    server.use(http.get(`${API}/seller/shipping/orders/:id/tracking`, () => HttpResponse.json(tracking())))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    expect(await screen.findByText(/Shipped Nov 5, 2026/)).toBeInTheDocument()   // 20:30 UTC is already the 5th in Tokyo
  })

  it('after buying a label focus moves to the confirmation inside the dialog', async () => {
    mockShipping({})
    mockOrder(accepted())
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Ship order' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Get shipping rates' }))
    await userEvent.click(await within(dlg).findByRole('button', { name: /Buy label/ }))
    const done = (await within(dlg).findByText(/Label bought for/)).closest('.label-done') as HTMLElement
    await waitFor(() => expect(done).toHaveFocus()); expect(dlg).toContainElement(document.activeElement as HTMLElement)
  })

  it('the "ship anyway" reason is required and its error appears on the field', async () => {
    const calls = mockShipping({ q: quote({ addressStatus: 'unverified', addressMessage: 'The address could not be fully verified.' }) })
    mockOrder(accepted()); mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Ship order' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Get shipping rates' }))
    await userEvent.click(await within(dlg).findByLabelText('Ship anyway'))
    const reason = within(dlg).getByLabelText('Why are you shipping to this address?'); expect(reason).toBeRequired()
    await userEvent.click(within(dlg).getByRole('button', { name: /Buy label/ }))
    expect(await within(dlg).findByText(/at least 5 characters/)).toBeInTheDocument(); expect(reason).toHaveAttribute('aria-invalid', 'true'); expect(calls.buy).toHaveLength(0)
  })

  it('Refresh rates is disabled while a label is being bought (it would rotate the idempotency key)', async () => {
    let finish!: () => void
    const calls = mockShipping({})
    server.use(http.post(`${API}/seller/shipping/orders/:id/labels`, async () => { await new Promise<void>((r) => { finish = r }); return HttpResponse.json({ label: label() }, { status: 201 }) }))
    mockOrder(accepted()); mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Ship order' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Get shipping rates' }))
    await userEvent.click(await within(dlg).findByRole('button', { name: /Buy label/ }))
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Refresh rates' })).toBeDisabled()); expect(calls.buy).toHaveLength(0)
    finish()
  })

  it('removing an address asks first, and nothing is deleted until it is confirmed', async () => {
    const removed: string[] = []
    server.use(http.get(`${API}/seller/shipping/settings`, () => HttpResponse.json(cfg())), http.delete(`${API}/seller/shipping/addresses/:id`, ({ params }) => { removed.push(String(params.id)); return new HttpResponse(null, { status: 204 }) }))
    mount(<ShippingSettings />, '/s')
    await screen.findByRole('heading', { name: 'Ship-from addresses' })
        await userEvent.click(await screen.findByRole('button', { name: /Remove\s*Warehouse/ }))
    const dlg = await screen.findByRole('dialog'); expect(within(dlg).getByRole('heading', { name: 'Remove this address?' })).toBeInTheDocument(); expect(removed).toHaveLength(0)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Keep as it is' })); expect(removed).toHaveLength(0)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(await screen.findByRole('button', { name: /Remove\s*Warehouse/ })); await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Yes, remove it' }))
    await waitFor(() => expect(removed).toEqual(['a1']))
  })

  it('"Clear filters" is offered when only the delivery-progress filter is active', async () => {
    const dash = { todayOrders: 0, toShip: 0, late: 0, returnsOpen: 0, sales30Cents: 0, orders30: 0, daily: [], lateShipmentRate: 0, cancellationRate: 0, shipping: { labelsToPrint: 0, exceptions: 0 } }
    server.use(http.get(`${API}/seller/orders`, () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 25, counts: { needsAction: 0, pending: 0, shipped: 0, delivered: 0, cancelled: 0, returns: 0, late: 0, all: 0, exceptions: 0 } })),
      http.get(`${API}/seller/orders/dashboard`, () => HttpResponse.json(dash)))
    mount(<OrdersListPage />, '/orders', '/orders?tab=all&tracking=exception')
    expect(await screen.findByRole('heading', { name: 'No orders match' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })
})

describe('Review fixes, round 2', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('placed, refund, timeline, deliver-by and note times on the order page use the account zone', async () => {
    const at = '2026-11-04T20:30:00Z'                                              // 20:30 UTC is already the 5th in Tokyo
    mockOrder(order({
      accountTimeZone: 'Asia/Tokyo', placedAt: at, deliverByAt: '2026-11-06T20:30:00Z',
      refunds: [{ id: 'rf1', returnId: null, amountCents: 500, shippingCents: 0, reason: 'goodwill', note: null, createdAt: at, lines: [] }],
      timeline: [{ id: 'e1', type: 'order.placed', actor: 'Buyer', text: 'Order placed', at }],
      notes: [{ id: 'n1', text: 'Call the buyer', author: 'me@x.com', createdAt: at }],
    }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    expect(await screen.findByText(/Placed Nov 5, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/deliver by Nov 7, 2026/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Refunds' }).closest('section')).toHaveTextContent(/Nov 5, 2026/)      // the refund date
    expect(screen.getByText(/Nov 5, 2026, .* · Buyer/)).toBeInTheDocument()                                          // the timeline entry
    expect(screen.getByText(/me@x\.com · Nov 5, 2026/)).toBeInTheDocument()                                          // the note
  })

  it('the return label dialog moves focus to its confirmation after buying', async () => {
    server.use(http.get(`${API}/seller/shipping/settings`, () => HttpResponse.json(cfg())),
      http.post(`${API}/seller/shipping/orders/:id/returns/:rid/label`, () => HttpResponse.json({ label: label({ kind: 'return', id: 'lb2', returnId: 'r1', costCents: 460 }) }, { status: 201 })))
    mount(<ReturnLabelDialog order={order({ status: 'ReturnApproved' })} returnId="r1" onClose={() => undefined} onDone={() => undefined} />, '/x')
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Buy and send the return label' }))
    const done = (await within(dlg).findByText(/Return label bought for/)).closest('[tabindex="-1"]') as HTMLElement
    await waitFor(() => expect(done).toHaveFocus())
  })

  it('the bulk dialog moves focus to its results after buying', async () => {
    server.use(http.get(`${API}/seller/shipping/settings`, () => HttpResponse.json(cfg())),
      http.post(`${API}/seller/shipping/labels/bulk`, () => HttpResponse.json({ bought: 1, total: 1, results: [{ orderId: 'o1', number: 'SO-2026-000001', ok: true, code: 'ok', message: '' }] })))
    mount(<BulkLabelsDialog orderIds={['o1']} onClose={() => undefined} onDone={() => undefined} />, '/x')
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Buy 1 label' }))
    const done = (await within(dlg).findByText('1 of 1 label bought.')).closest('[tabindex="-1"]') as HTMLElement
    await waitFor(() => expect(done).toHaveFocus())
  })

  it('the void confirmation is a destructive action', async () => {
    mockOrder(order({ status: 'Shipped', actions: { ...ACTIONS, editTracking: true }, shipments: [{ id: 's1', carrier: 'USPS', service: null, trackingNumber: '9400111899223100001', trackingUrl: null, shippedAt: '2026-11-02T10:00:00Z', deliveredAt: null, lines: [{ lineId: 'l1', quantity: 1 }] }] }))
    server.use(http.get(`${API}/seller/shipping/orders/:id/tracking`, () => HttpResponse.json(tracking({ labels: [label()], shipments: [{ id: 's1', method: 'carrier', carrier: 'USPS', service: null, trackingNumber: '9400111899223100001', trackingUrl: null, status: 'in_transit', statusLabel: 'In transit', statusDetail: null, eta: null, deliveredAt: null, live: true, labelId: 'lb1', events: [] }] }))))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: /Void label/ }))
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Yes, void the label' })).toHaveClass('danger')
  })

  it('a blocked print window shows the "Try Download instead" message on screen', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    mockOrder(order({ status: 'Shipped', actions: { ...ACTIONS, editTracking: true }, shipments: [{ id: 's1', carrier: 'USPS', service: null, trackingNumber: '9400111899223100001', trackingUrl: null, shippedAt: '2026-11-02T10:00:00Z', deliveredAt: null, lines: [{ lineId: 'l1', quantity: 1 }] }] }))
    server.use(http.get(`${API}/seller/shipping/orders/:id/tracking`, () => HttpResponse.json(tracking({ labels: [label()], shipments: [{ id: 's1', method: 'carrier', carrier: 'USPS', service: null, trackingNumber: '9400111899223100001', trackingUrl: null, status: 'in_transit', statusLabel: 'In transit', statusDetail: null, eta: null, deliveredAt: null, live: true, labelId: 'lb1', events: [] }] }))))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Print label' }))
    expect(await screen.findByText('Could not open the label. Try Download instead.')).toBeInTheDocument()
  })
})
