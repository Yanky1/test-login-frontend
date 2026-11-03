import { expect, createSeller, dismissPasskeyOffer, lastMail, setStatus, uiLogin, newEmail, PASSWORD } from './helpers'
import type { APIRequestContext, Page } from '@playwright/test'
import { makePng } from './png'

const business = { vendorName: 'Acme Co', contactName: 'Dana Seller', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false }
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

export async function tokenFor(request: APIRequestContext, email: string) {
  const r = await request.post('/api/v1/auth/login', { data: { email, password: PASSWORD } })
  expect(r.ok()).toBeTruthy()
  return (await r.json()).accessToken as string
}

/** An approved seller account (wizard + admin approval) with its API token. */
export async function seller(request: APIRequestContext) {
  const s = await createSeller(request)
  const token = await tokenFor(request, s.email)
  expect((await request.put('/api/v1/seller/application/business', { data: business, headers: bearer(token) })).ok()).toBeTruthy()
  expect((await request.put('/api/v1/seller/application/kosher', { data: { answers: { sells_food: 'no' } }, headers: bearer(token) })).ok()).toBeTruthy()
  expect((await request.post('/api/v1/seller/application/submit', { data: { acceptSellerAgreement: true }, headers: bearer(token) })).ok()).toBeTruthy()
  await setStatus(request, s.sellerId, 'Approved')
  return { ...s, token: await tokenFor(request, s.email) }
}

/** A published product with a photo and stock, created through the API. */
export async function product(request: APIRequestContext, token: string, title: string, stock = 10, brandId?: string) {
  const h = bearer(token)
  const cats = (await (await request.get('/api/v1/categories', { headers: h })).json()) as { id: string; slug: string }[]
  const created = await request.post('/api/v1/seller/products', { headers: h, data: { title, categoryId: cats.find((c) => c.slug === 'kitchen-dining')!.id, brandId } })
  expect(created.status()).toBe(201)
  const id = (await created.json()).id as string
  expect((await request.post(`/api/v1/seller/products/${id}/images?alt=Front`, { headers: h, multipart: { file: { name: 'p.png', mimeType: 'image/png', buffer: makePng(1200, 1200) } } })).status()).toBe(201)
  const doc = await (await request.get(`/api/v1/seller/products/${id}`, { headers: h })).json()
  const put = await request.put(`/api/v1/seller/products/${id}`, { headers: h, data: { ...doc, price: 19.99, quantity: stock, sku: `SKU-${id.slice(0, 8)}`, noBarcode: true } })
  expect(put.ok(), await put.text()).toBeTruthy()
  expect((await request.post(`/api/v1/seller/products/${id}/status`, { headers: h, data: { status: 'active' } })).ok()).toBeTruthy()
  return id
}

export const available = async (request: APIRequestContext, token: string, id: string) => (await (await request.get(`/api/v1/seller/products/${id}`, { headers: bearer(token) })).json()).available as number

export async function simulate(request: APIRequestContext, token: string, scenario: string) {
  const r = await request.post('/api/v1/seller/dev/orders', { headers: bearer(token), data: { scenario } })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()).orders as { id: string; number: string; brandId: string }[]
}
export const orderAction = async (request: APIRequestContext, token: string, id: string, action: string, data: object = {}) => {
  const r = await request.post(`/api/v1/seller/orders/${id}/${action}`, { headers: bearer(token), data })
  expect(r.ok(), await r.text()).toBeTruthy()
}
export const buyerEvent = async (request: APIRequestContext, token: string, id: string, type: string, extra: object = {}) =>
  expect((await request.post(`/api/v1/seller/dev/orders/${id}/events`, { headers: bearer(token), data: { type, ...extra } })).ok()).toBeTruthy()

export async function signIn(page: Page, email: string, path = '/orders') {
  await page.goto('/login'); await uiLogin(page, email); await dismissPasskeyOffer(page)
  await page.goto(path)
}
export const mgr = async (request: APIRequestContext, ownerToken: string, role: string, brandIds?: string[]) => {
  const email = newEmail()
  expect((await request.post('/api/v1/team/invitations', { headers: bearer(ownerToken), data: { email, role, brandIds } })).status()).toBe(202)
  const t = /\/invite\/([A-Za-z0-9_-]+)/.exec(await lastMail(request, email, 'team-invitation'))![1]
  expect((await request.post(`/api/v1/invitations/${t}/join`, { data: { password: PASSWORD, acceptTerms: true } })).ok()).toBeTruthy()
  return email
}

