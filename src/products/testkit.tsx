import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import type { ReactElement } from 'react'
import { server } from '../test/server'
import { BrandProvider } from '../pages/teams/BrandContext'
import { renderAt, signedIn } from '../test/utils'
import type { AttrConfig, Category, ProductDetail } from './types'

export const API = '*/api/v1'
export const FOOD: AttrConfig[] = [
  { key: 'ingredients', label: 'Ingredients', type: 'longtext', options: [], required: true, group: 'Food information', help: null, unit: null },
  { key: 'allergens', label: 'Allergens', type: 'multiselect', options: ['Milk', 'Wheat', 'Soy'], required: true, group: 'Food information', help: null, unit: null },
  { key: 'shelf_life_days', label: 'Shelf life', type: 'number', options: [], required: false, group: 'Storage', help: null, unit: 'days' },
]
export const KITCHEN: AttrConfig[] = [{ key: 'material', label: 'Material', type: 'text', options: [], required: false, group: 'Basics', help: null, unit: null }]
export const CATS: Category[] = [
  { id: 'c-bakery', parentId: 'c-food', name: 'Bakery', slug: 'bakery', path: 'Grocery & Food › Bakery', leaf: true },
  { id: 'c-kitchen', parentId: 'c-home', name: 'Kitchen & Dining', slug: 'kitchen-dining', path: 'Home & Kitchen › Kitchen & Dining', leaf: true },
]

export function detail(over: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 'p1', status: 'Draft', brandId: 'b1', brandName: 'Acme', categoryId: 'c-bakery', version: 1,
    title: 'Sourdough loaf', handle: null, condition: 'New', conditionNote: null, sku: null, price: null, compareAtPrice: null, salePrice: null, saleStart: null, saleEnd: null, cost: null,
    quantity: 0, lowStockAlert: null, allowBackorder: false, maxPerOrder: null, barcode: null, noBarcode: false, bullets: [], description: null,
    weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, handlingDays: null, shipping: { standardEnabled: true, standardPrice: null, expressEnabled: false, expressPrice: null, freeOver: null },
    localPickup: false, returnsDays: null, returnsCondition: null, warrantyMonths: null, warrantyNote: null, searchTerms: null, metaTitle: null, metaDescription: null, hasVariants: false, attributes: {},
    margin: null, currentPrice: null, onSale: false, available: 0, barcodeCheck: null, descriptionHtml: '', options: [], variants: [], images: [], faqs: [], attributeConfig: FOOD,
    qualityScore: 20, canPublish: false,
    issues: [{ key: 'price', section: 'price', severity: 'required', message: 'Set a price.' }, { key: 'images', section: 'media', severity: 'required', message: 'Add at least one photo.' },
      { key: 'attr:allergens', section: 'details', severity: 'required', message: 'Allergens is required for this category.' }, { key: 'bullets', section: 'description', severity: 'recommended', message: 'Add 3-5 key feature bullets.' }],
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', publishedAt: null, ...over,
  }
}

/** Mounts a component at a route with the usual catalog endpoints mocked. Returns the list of PUT/PATCH/POST bodies seen. */
export function mockCatalog(d: ProductDetail = detail()) {
  const calls: { method: string; url: string; body: unknown; auth?: string | null }[] = []
  let current = d
  server.use(
    http.get(`${API}/categories`, () => HttpResponse.json(CATS)),
    http.get(`${API}/categories/:id/attributes`, ({ params }) => HttpResponse.json(params.id === 'c-bakery' ? FOOD : KITCHEN)),
    http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme', isDefault: true }])),
    http.get(`${API}/seller/products/:id`, () => HttpResponse.json(current)),
    http.put(`${API}/seller/products/:id`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'PUT', url: new URL(request.url).pathname, body, auth: request.headers.get('authorization') })
      current = { ...current, ...(body as Partial<ProductDetail>), version: current.version + 1 }
      return HttpResponse.json(current)
    }),
    http.put(`${API}/seller/products/:id/variants`, async ({ request }) => {
      const body = (await request.json()) as { options: ProductDetail['options']; variants: ProductDetail['variants'] }
      calls.push({ method: 'PUT', url: new URL(request.url).pathname, body })
      current = { ...current, ...body, variants: body.variants.map((v, i) => ({ ...v, id: `v${i}` })), version: current.version + 1 }
      return HttpResponse.json(current)
    }),
    http.put(`${API}/seller/products/:id/faqs`, async ({ request }) => { const b = await request.json(); calls.push({ method: 'PUT', url: new URL(request.url).pathname, body: b }); return HttpResponse.json({ faqs: b }) }),
    http.get(`${API}/seller/products/:id/readiness`, () => HttpResponse.json({ score: current.qualityScore, canPublish: current.canPublish, issues: current.issues })),
    http.get(`${API}/seller/products/:id/images/:img/file`, () => new HttpResponse(new Blob(['x'], { type: 'image/png' }))),
  )
  return { calls, set: (n: ProductDetail) => { current = n } }
}

export function mount(ui: ReactElement, path: string, route = path, login: Record<string, unknown> = {}) {
  signedIn(login)
  return renderAt(<BrandProvider><Routes><Route path={path} element={ui} /><Route path="*" element={<div>elsewhere</div>} /></Routes></BrandProvider>, route)
}
