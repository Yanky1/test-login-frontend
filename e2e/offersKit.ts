import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { expect } from './helpers'
import { signedPost } from './adminKit'
import { bearer, product } from './ordersKit'

/** A published product at a given price (dollars) and stock. */
export async function priced(request: APIRequestContext, token: string, title: string, price: number, stock = 100) {
  const id = await product(request, token, title, stock)
  const h = bearer(token)
  const doc = await (await request.get(`/api/v1/seller/products/${id}`, { headers: h })).json()
  const put = await request.put(`/api/v1/seller/products/${id}`, { headers: h, data: { ...doc, price, quantity: stock } })
  expect(put.ok(), await put.text()).toBeTruthy()
  return id
}

export const brandOf = async (request: APIRequestContext, token: string) => ((await (await request.get('/api/v1/brands', { headers: bearer(token) })).json()) as { id: string }[])[0].id

type Line = { productId: string; quantity: number; unitPriceCents: number; discountCents?: number; offerId?: string | null; isGift?: boolean; giftOfOfferId?: string | null }

/** A signed marketplace order (C18 shape: offers[] + per-line offerId / gift lines). */
export async function offerOrder(request: APIRequestContext, sellerId: string, brandId: string, lines: Line[], offers: { offerId: string; offerVersion: number; giftUnavailable?: boolean }[]) {
  return signedPost(request, '/api/internal/v1/orders', {
    marketplaceOrderId: 'MP-' + randomUUID().slice(0, 10).toUpperCase(), placedAt: new Date().toISOString(), currency: 'USD',
    buyer: { displayName: 'Jane Buyer', relayEmail: 'relay-abc@relay.solvelt.example', phone: '+1 555 000 1111' },
    shippingAddress: { name: 'Jane Buyer', line1: '1 Main St', line2: 'Apt 2', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US' },
    shippingMethod: 'Standard', shippingSpeed: 'standard',
    lines: lines.map((l, i) => ({ marketplaceLineId: `L${i + 1}`, sellerId, brandId, variantId: null, discountCents: 0, taxCents: 0, offerId: null, isGift: false, giftOfOfferId: null, ...l })),
    offers,
  })
}
