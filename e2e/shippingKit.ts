import type { APIRequestContext } from '@playwright/test'
import { expect } from './helpers'
import { bearer, orderAction, simulate } from './ordersKit'

/** A ship-from address and a default package preset, created through the API (the Settings UI is covered by its own test). */
export async function shippingSetup(request: APIRequestContext, token: string) {
  const a = await request.post('/api/v1/seller/shipping/addresses', { headers: bearer(token), data: { label: 'Warehouse', name: 'Acme Shop', line1: '10 Warehouse Rd', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US' } })
  expect(a.status(), await a.text()).toBe(201)
  const p = await request.post('/api/v1/seller/shipping/packages', { headers: bearer(token), data: { name: 'Medium box', kind: 'box', lengthMm: 300, widthMm: 200, heightMm: 150, emptyWeightGrams: 100 } })
  expect(p.status(), await p.text()).toBe(201)
  return { addressId: (await a.json()).id as string, packageId: (await p.json()).id as string }
}

/** An accepted simulator order (one product). */
export async function acceptedOrder(request: APIRequestContext, token: string) {
  const [o] = await simulate(request, token, 'single')
  await orderAction(request, token, o.id, 'accept')
  return o
}

/** Quotes and buys the recommended (else cheapest) label through the API; returns the label. */
export async function buyLabel(request: APIRequestContext, token: string, orderId: string, packageId: string, weightGrams = 500) {
  const q = await request.post(`/api/v1/seller/shipping/orders/${orderId}/rates`, { headers: bearer(token), data: { package: { presetId: packageId, weightGrams } } })
  expect(q.ok(), await q.text()).toBeTruthy()
  const quote = await q.json()
  const rate = quote.rates.find((r: { recommended: boolean }) => r.recommended) ?? quote.rates[0]
  const b = await request.post(`/api/v1/seller/shipping/orders/${orderId}/labels`, { headers: bearer(token), data: { quoteId: quote.quoteId, rateId: rate.rateId, idempotencyKey: `e2e-${orderId}` } })
  expect(b.status(), await b.text()).toBe(201)
  return (await b.json()).label as { id: string; trackingNumber: string; carrier: string; costCents: number }
}

/** Pushes a tracking update through the real, signed webhook pipeline (development helper). */
export async function track(request: APIRequestContext, trackingNumber: string, status: string, detail?: string) {
  const r = await request.post('/api/dev/shipping/tracking', { data: { trackingNumber, status, detail } })
  expect(r.ok(), await r.text()).toBeTruthy()
  return (await r.json()).outcome as string
}
export const runMaintenance = async (request: APIRequestContext) => expect((await request.post('/api/dev/shipping/run-maintenance')).ok()).toBeTruthy()
