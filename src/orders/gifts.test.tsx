import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import OrderDetailPage from './OrderDetail'
import { API, mount, mockOrder, order } from './testkit'

/** C18 quantity offers on the order: per-line discounts, "Free gift" lines and the gift-unavailable notice, on the detail and the packing slip. */
const offerOrder = (giftUnavailable = false) => order({
  giftUnavailable,
  money: { itemsCents: 2000, discountCents: 200, shippingCents: 0, taxCents: 0, totalCents: 1800, feeCents: 180, netCents: 1620, refundedCents: 0, refundableCents: 1800 },
  lines: [
    { id: 'l1', productId: 'p1', variantId: null, title: 'Blue card', sku: 'C-1', options: null, hasImage: false, unitPriceCents: 100, quantity: 20, discountCents: 200, taxCents: 0, lineTotalCents: 1800, shippedQty: 0, cancelledQty: 0, refundedQty: 0, returnedQty: 0, unshippedQty: 20, reservedQty: 20, stockShort: false, offerId: 'of1', offerVersion: 1 },
    ...(giftUnavailable ? [] : [{ id: 'l2', productId: 'p3', variantId: null, title: 'Card wallet', sku: 'W-1', options: null, hasImage: false, unitPriceCents: 0, quantity: 1, discountCents: 0, taxCents: 0, lineTotalCents: 0, shippedQty: 0, cancelledQty: 0, refundedQty: 0, returnedQty: 0, unshippedQty: 1, reservedQty: 1, stockShort: false, isGift: true, giftOfOfferId: 'of1', offerVersion: 1 }]),
  ],
})
const slip = (giftUnavailable = false) => ({
  id: 'o1', number: 'SO-2026-000001', brandName: 'Blitz', placedAt: '2026-11-01T10:00:00Z', shippingMethod: 'Standard',
  shipTo: { name: 'Jane Buyer', line1: '1 Main St', line2: null, city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', phone: null },
  giftMessage: null, isGift: false, showPrices: true, currency: 'USD', giftUnavailable,
  lines: [{ title: 'Blue card', sku: 'C-1', options: null, quantity: 20, unshipped: 20, unitPriceCents: 100, discountCents: 200, isGift: false },
    ...(giftUnavailable ? [] : [{ title: 'Card wallet', sku: 'W-1', options: null, quantity: 1, unshipped: 1, unitPriceCents: 0, discountCents: 0, isGift: true }])],
})

describe('quantity offers on an order', () => {
  it('tags the gift line "Free gift", shows the tier discount per line, and the slip tags the gift too', async () => {
    mockOrder(offerOrder())
    server.use(http.get(`${API}/seller/orders/:id/packing-slip`, () => HttpResponse.json(slip())))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    const items = await screen.findByRole('region', { name: 'Items' })
    const gift = within(items).getByText('Card wallet').closest('li')!
    expect(within(gift).getByText('Free gift')).toBeInTheDocument()
    const card = within(items).getByText('Blue card').closest('li')!
    expect(within(card).queryByText('Free gift')).toBeNull()
    expect(within(card).getByText('Discount −$2.00')).toBeInTheDocument()
    expect(within(card).getByText('$18.00')).toBeInTheDocument()
    expect(screen.queryByText(/Free gift unavailable/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Packing slip' }))
    const s = await screen.findByRole('article', { name: 'Packing slip SO-2026-000001' })
    const row = within(s).getByText('Card wallet').closest('tr')!
    expect(within(row).getByText('Free gift')).toBeInTheDocument()
    expect(within(within(s).getByText('Blue card').closest('tr')!).queryByText('Free gift')).toBeNull()
  })

  it('shows a notice when the earned gift was unavailable, on the order and on the slip', async () => {
    mockOrder(offerOrder(true))
    server.use(http.get(`${API}/seller/orders/:id/packing-slip`, () => HttpResponse.json(slip(true))))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    expect(await screen.findByText(/Free gift unavailable: the buyer earned a free gift/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Packing slip' }))
    const s = await screen.findByRole('article', { name: 'Packing slip SO-2026-000001' })
    expect(within(s).getByText(/Free gift unavailable: it was out of stock/)).toBeInTheDocument()
  })
})
