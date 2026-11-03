import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const SHOTS = process.env.SHOTS_DIR
const viewports = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } }
const login = { tokenType: 'Bearer', accessToken: 'tok', expiresIn: 900, refreshToken: '', sellerId: 's1', email: 'rivka@example.com', vendorName: 'Rivka Bakes', accountStatus: 'Active', roles: ['Seller'] }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const food = [
  { key: 'ingredients', label: 'Ingredients', type: 'longtext', options: [], required: true, group: 'Food information', help: null, unit: null },
  { key: 'allergens', label: 'Allergens', type: 'multiselect', options: ['Milk', 'Eggs', 'Wheat', 'Soy', 'None'], required: true, group: 'Food information', help: 'Select every allergen present or may be present.', unit: null },
  { key: 'certifications', label: 'Certifications', type: 'multiselect', options: ['Organic', 'Kosher', 'Vegan'], required: false, group: 'Food information', help: null, unit: null },
  { key: 'shelf_life_days', label: 'Shelf life', type: 'number', options: [], required: false, group: 'Storage', help: null, unit: 'days' },
]
const img = (i: number) => ({ id: `i${i}`, url: `/api/v1/seller/products/p1/images/i${i}/file`, alt: i === 1 ? 'Round sourdough loaf on a board' : null, isMain: i === 1, variantId: null, width: 1400, height: 1400, size: 90000, lowResolution: false })
const product = (over: object = {}) => ({
  id: 'p1', status: 'Draft', brandId: 'b1', brandName: 'Rivka Bakes', categoryId: 'c1', version: 3, title: 'Rivka sourdough loaf, 800 g, slow-fermented rye and wheat', handle: null, condition: 'New', conditionNote: null, sku: 'LOAF-800',
  price: 8.5, compareAtPrice: 10, salePrice: null, saleStart: null, saleEnd: null, cost: 3, quantity: 24, lowStockAlert: 5, allowBackorder: false, maxPerOrder: null, barcode: null, noBarcode: true,
  bullets: ['Slow-fermented for 36 hours', 'Baked fresh to order', 'No preservatives'], description: '## Baked with patience\nA **crusty** loaf with an open crumb.\n\n- Rye and wheat\n- Stone-baked', weightGrams: 800, lengthCm: 30, widthCm: 14, heightCm: 12, handlingDays: 1,
  shipping: { standardEnabled: true, standardPrice: 5, expressEnabled: false, expressPrice: null, freeOver: 40 }, localPickup: true, returnsDays: 0, returnsCondition: null, warrantyMonths: null, warrantyNote: null,
  searchTerms: 'bread rye sourdough', metaTitle: null, metaDescription: null, hasVariants: false, attributes: { ingredients: 'Rye flour, wheat flour, water, salt', allergens: ['Wheat'], certifications: ['Kosher'] },
  margin: 64.7, currentPrice: 8.5, onSale: false, available: 24, barcodeCheck: null, descriptionHtml: '', options: [], variants: [], images: [img(1), img(2)], faqs: [{ id: 'f1', question: 'Is it kosher?', answer: 'Yes, certified.' }],
  attributeConfig: food, qualityScore: 86, canPublish: true, issues: [{ key: 'bullets_more', section: 'description', severity: 'recommended', message: 'Add 5 key feature bullets.' }],
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', publishedAt: null, ...over,
})
const row = (i: number, o: object = {}) => ({ id: `p${i}`, title: ['Rivka sourdough loaf, 800 g', 'Honey challah, braided, 500 g', 'Rye crackers, sesame, 200 g', 'Olive oil cake (draft)'][i - 1], sku: `SKU-${i}`, status: ['Active', 'Active', 'Inactive', 'Draft'][i - 1], brandId: 'b1', brandName: 'Rivka Bakes', categoryId: 'c1',
  price: [8.5, 9, 4.25, 12][i - 1], currentPrice: [8.5, 9, 4.25, 12][i - 1], onSale: false, quantity: [24, 0, 60, 0][i - 1], hasVariants: false, variantCount: 0, qualityScore: [86, 64, 90, 28][i - 1], canPublish: i < 4, needsAttention: i === 4, lowStock: i === 2, version: 1, updatedAt: '2026-11-02T00:00:00Z', thumbnailUrl: i < 3 ? `/api/v1/seller/products/p${i}/images/i1/file` : null, ...o })
const counts = { all: 4, draft: 1, active: 2, inactive: 1, archived: 0, outOfStock: 2, attention: 1 }
const questions = [
  { id: 'q1', productId: 'p1', productTitle: 'Rivka sourdough loaf, 800 g', askerName: 'Miriam', text: 'Does the loaf contain any dairy?', answer: null, state: 'Pending', answered: false, askedAt: '2026-11-02T10:00:00Z', answeredAt: null },
  { id: 'q2', productId: 'p2', productTitle: 'Honey challah, braided, 500 g', askerName: 'Dov', text: 'Can I order 3 for Friday delivery?', answer: null, state: 'Pending', answered: false, askedAt: '2026-11-01T10:00:00Z', answeredAt: null },
]

async function mock(page: Page, o: { empty?: boolean; detail?: object; csv?: boolean } = {}) {
  await page.route('**/config.json', (r) => r.fulfill({ json: { idleTimeoutMinutes: 60, warningSeconds: 60, refreshIntervalMinutes: 5, features: { apple: false }, turnstileSiteKey: 'stub' } }))
  await page.route('**/api/v1/**', (r) => {
    const u = new URL(r.request().url()); const p = u.pathname.replace('/api/v1', ''); const m = r.request().method()
    if (p === '/auth/refresh') return r.fulfill({ json: login })
    if (/\/images\/.+\/file$/.test(p)) return r.fulfill({ body: PNG, contentType: 'image/png' })
    if (p === '/brands') return r.fulfill({ json: [{ id: 'b1', name: 'Rivka Bakes', isDefault: true }, { id: 'b2', name: 'Rivka Cakes' }] })
    if (p === '/categories') return r.fulfill({ json: [{ id: 'c1', parentId: null, name: 'Bakery', slug: 'bakery', path: 'Grocery & Food › Bakery', leaf: true }, { id: 'c2', parentId: null, name: 'Snacks & Sweets', slug: 'snacks', path: 'Grocery & Food › Snacks & Sweets', leaf: true }] })
    if (/^\/categories\/.+\/attributes$/.test(p)) return r.fulfill({ json: food })
    if (p === '/seller/products' && m === 'GET') return r.fulfill({ json: o.empty ? { items: [], total: 0, page: 1, pageSize: 20, counts: { all: 0, draft: 0, active: 0, inactive: 0, archived: 0, outOfStock: 0, attention: 0 } } : { items: [1, 2, 3, 4].map((i) => row(i)), total: 4, page: 1, pageSize: 20, counts } })
    if (/^\/seller\/products\/p1(\/variants)?$/.test(p)) return r.fulfill({ json: product(o.detail) })
    if (/^\/seller\/products\/p1\/faqs$/.test(p)) return r.fulfill({ json: { faqs: [] } })
    if (p === '/seller/questions') return r.fulfill({ json: { items: questions, total: 2, page: 1, pageSize: 50, counts: { unanswered: 2, answered: 7, hidden: 0 } } })
    if (p === '/seller/products/csv/validate') return r.fulfill({ json: { total: 4, valid: 2, invalid: 2, ignoredColumns: [], rows: [{ row: 2, ok: true, title: 'Rye crackers', sku: 'RC-1', errors: [] }, { row: 3, ok: true, title: 'Honey cake', sku: 'HC-1', errors: [] },
      { row: 4, ok: false, title: 'Bad barcode loaf', sku: 'BL-1', errors: [{ field: 'barcode', message: 'This UPC-A has an invalid check digit - please re-check the number.' }] }, { row: 5, ok: false, title: null, sku: 'X-1', errors: [{ field: 'title', message: 'Title is required.' }, { field: 'price', message: 'Enter a number like 19.99.' }] }] } })
    return r.fulfill({ json: {} })
  })
}

const screens: { name: string; path: string; heading: RegExp; opts?: Parameters<typeof mock>[1]; act?: (p: Page) => Promise<void> }[] = [
  { name: 'products-list', path: '/products', heading: /^products$/i, act: async (p) => { await expect(p.locator('a.ptitle:visible').first()).toBeVisible() } },
  { name: 'products-empty', path: '/products', heading: /^products$/i, opts: { empty: true }, act: async (p) => { await expect(p.getByRole('heading', { name: 'Add your first product' })).toBeVisible() } },
  { name: 'product-new', path: '/products/new', heading: /what are you selling/i },
  { name: 'product-edit', path: '/products/p1', heading: /rivka sourdough loaf/i, act: async (p) => { await expect(p.getByRole('heading', { name: 'Ready to publish?' })).toBeVisible() } },
  { name: 'product-edit-variations', path: '/products/p1', heading: /rivka sourdough loaf/i, act: async (p) => {
    await p.getByLabel('This product comes in different options').check(); await p.getByLabel('Add Size values').fill('S, M'); await p.getByLabel('Add Size values').press('Enter')
    await expect(p.getByRole('table')).toBeVisible() } },
  { name: 'product-preview', path: '/products/p1', heading: /rivka sourdough loaf/i, act: async (p) => { await p.getByRole('button', { name: 'Preview as buyer' }).click(); await expect(p.getByRole('dialog', { name: 'Preview as buyer' })).toBeVisible() } },
  { name: 'questions', path: '/questions', heading: /^questions$/i, act: async (p) => { await expect(p.getByText('Does the loaf contain any dairy?')).toBeVisible() } },
  { name: 'bulk-upload', path: '/products/import', heading: /bulk upload/i, act: async (p) => {
    await p.getByLabel('CSV file').setInputFiles({ name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from('title\nx\n') }); await expect(p.getByText(/2 of 4 rows ready/)).toBeVisible() } },
]

for (const [vp, size] of Object.entries(viewports)) {
  for (const theme of ['light', 'dark'] as const) {
    for (const s of screens) {
      test(`${s.name} @${vp} ${theme}: renders, fits the width and has no serious a11y violations`, async ({ page }) => {
        await page.setViewportSize(size)
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await mock(page, s.opts)
        await page.goto(s.path)
        await expect(page.getByRole('heading', { name: s.heading }).first()).toBeVisible()
        await s.act?.(page)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
        const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
        if (SHOTS && (theme === 'light' || s.name === 'product-edit')) await page.screenshot({ path: `${SHOTS}/${s.name}-${vp}${theme === 'dark' ? '-dark' : ''}.png`, fullPage: s.name !== 'product-preview' })
      })
    }
  }
}

test('320px wide: the catalog, the editor and the buyer preview do not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await mock(page)
  await page.goto('/products/p1'); await page.getByRole('button', { name: 'Preview as buyer' }).click()
  const dlg = page.getByRole('dialog', { name: 'Preview as buyer' }); await expect(dlg).toBeVisible()
  expect(await dlg.evaluate((el) => el.scrollWidth <= el.clientWidth), 'preview dialog').toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'preview page').toBe(true)
  for (const path of ['/products', '/products/p1', '/questions', '/products/import']) {
    await page.goto(path); await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true)
  }
})
