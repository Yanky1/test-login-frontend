import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import { API } from '../products/testkit'
import type { ConversationDetail, ConversationItem, OrderDetail, OrderListItem } from './api'

export { API, mount } from '../products/testkit'

export const item = (o: Partial<OrderListItem> = {}): OrderListItem => ({
  id: 'o1', number: 'SO-2026-000001', marketplaceOrderId: 'MP-1', brandId: 'b1', brandName: 'Acme', placedAt: '2026-11-01T10:00:00Z', status: 'New', buyerName: 'Jane Buyer', currency: 'USD',
  totalCents: 4000, netCents: 3500, refundedCents: 0, itemCount: 2, itemsSummary: 'Blue mug', thumbnailLineId: null, shipByAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  deliverByAt: new Date(Date.now() + 8 * 86_400_000).toISOString(), late: false, oversold: false, cancelRequested: false, returnOpen: false, shippingSpeed: 'standard', version: 1, redacted: false, needsAction: true, ...o,
})

export const ACTIONS = { accept: false, hold: false, resume: false, ship: false, editTracking: false, markDelivered: false, cancel: false, cancelRemainder: false, refund: false, refundLimitCents: null, note: true, decideCancellation: false, decideReturn: false, receiveReturn: false }

export function order(o: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'o1', number: 'SO-2026-000001', marketplaceOrderId: 'MP-1', brandId: 'b1', brandName: 'Acme', placedAt: '2026-11-01T10:00:00Z', status: 'New', heldFrom: null, currency: 'USD', version: 3,
    late: false, oversold: false, cancelRequested: false, returnOpen: false, redacted: false, shipByAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), deliverByAt: new Date(Date.now() + 8 * 86_400_000).toISOString(),
    shippingMethod: 'Standard', shippingSpeed: 'standard', giftMessage: null, cancelReason: null, cancelledBy: null, shippedLate: false, stockMismatch: false,
    buyer: { name: 'Jane Buyer', relayEmail: 'relay-1@relay.example', phone: '+1 555 000 1111' },
    shippingAddress: { name: 'Jane Buyer', line1: '1 Main St', line2: 'Apt 2', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US' },
    money: { itemsCents: 4000, discountCents: 0, shippingCents: 500, taxCents: 320, totalCents: 4820, feeCents: 400, netCents: 4100, refundedCents: 0, refundableCents: 4820 },
    lines: [
      { id: 'l1', productId: 'p1', variantId: null, title: 'Blue mug', sku: 'MUG-1', options: null, hasImage: false, unitPriceCents: 1000, quantity: 3, discountCents: 0, taxCents: 240, lineTotalCents: 3240, shippedQty: 0, cancelledQty: 0, refundedQty: 0, returnedQty: 0, unshippedQty: 3, reservedQty: 3, stockShort: false },
      { id: 'l2', productId: 'p2', variantId: null, title: 'Linen napkin', sku: 'NAP-1', options: 'Colour: Red', hasImage: false, unitPriceCents: 1000, quantity: 1, discountCents: 0, taxCents: 80, lineTotalCents: 1080, shippedQty: 0, cancelledQty: 0, refundedQty: 0, returnedQty: 0, unshippedQty: 1, reservedQty: 1, stockShort: false },
    ],
    shipments: [], cancellations: [], returns: [], refunds: [], timeline: [{ id: 'e1', type: 'order.placed', actor: 'Buyer', text: 'Order placed', at: '2026-11-01T10:00:00Z' }], notes: [],
    conversationId: null, actions: { ...ACTIONS, accept: true, hold: true, cancel: true }, reasons: { cancel: ['out_of_stock', 'other'], refund: ['goodwill', 'returned_item'], rejectReturn: ['item_used', 'other'], carriers: ['UPS', 'USPS', 'FedEx', 'DHL', 'Other'] }, ...o,
  }
}

export const conv = (o: Partial<ConversationItem> = {}): ConversationItem => ({
  id: 'c1', kind: 'order', subject: 'Order SO-2026-000001', buyerName: 'Jane B.', brandId: 'b1', brandName: 'Acme', orderId: 'o1', orderNumber: 'SO-2026-000001', productId: null, productTitle: null,
  assignedUserId: null, assignedTo: null, noReplyNeeded: false, flagged: false, flagReason: null, unread: true, needsReply: true, awaitingReplySince: '2026-11-01T10:00:00Z', overdue: false, dueAt: null,
  lastMessageAt: '2026-11-01T10:00:00Z', messageCount: 1, redacted: false, preview: 'Where is my order?', ...o,
})

export const convDetail = (o: Partial<ConversationDetail> = {}, c: Partial<ConversationItem> = {}): ConversationDetail => ({
  conversation: conv(c), order: { id: 'o1', number: 'SO-2026-000001', status: 'Accepted', totalCents: 4820, currency: 'USD', shipByAt: '2026-11-05T00:00:00Z', placedAt: '2026-11-01T10:00:00Z' }, product: null,
  messages: [{ id: 'm1', direction: 'buyer', text: 'Where is my order?', createdAt: '2026-11-01T10:00:00Z', delivery: 'delivered', author: null, authorId: null, contactWarning: false, reported: false, respondedAt: null, attachments: [] }],
  notes: [], canWrite: true, me: 'u1', assignees: [{ userId: 'u1', name: 'me@x.com', isMe: true }], ...o,
})

/** Mocks the order endpoints; returns the recorded POST/PUT bodies. */
export function mockOrder(initial: OrderDetail) {
  let current = initial
  const calls: { path: string; body: any }[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  server.use(
    http.get(`${API}/seller/orders/:id`, () => HttpResponse.json(current)),
    http.get(`${API}/seller/message-templates`, () => HttpResponse.json([{ id: 't1', title: 'Delay', body: 'Your order is a day late.' }])),
    http.post(`${API}/seller/orders/:id/*`, async ({ request }) => {
      const body = await request.json().catch(() => ({}))
      calls.push({ path: new URL(request.url).pathname.replace(/^.*\/seller\/orders\/[^/]+\//, ''), body })
      return HttpResponse.json(current)
    }),
    http.put(`${API}/seller/orders/:id/shipments/:sid`, async ({ request }) => { calls.push({ path: 'tracking', body: await request.json() }); return HttpResponse.json(current) }),
  )
  return { calls, set: (o: OrderDetail) => { current = o } }
}
