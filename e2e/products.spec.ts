import { expect, test, expectNoSeriousA11y, createSeller, dismissPasskeyOffer, setStatus, uiLogin, PASSWORD } from './helpers'
import type { APIRequestContext, Page } from '@playwright/test'
import { makePng } from './png'

const business = { vendorName: 'Acme Co', contactName: 'Dana Seller', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false }

/** Seller through the API; `approved` runs the application wizard and the admin approval. */
async function seller(request: APIRequestContext, approved: boolean) {
  const s = await createSeller(request)
  if (approved) {
    const login = await request.post('/api/v1/auth/login', { data: { email: s.email, password: PASSWORD } })
    const h = { Authorization: `Bearer ${(await login.json()).accessToken}` }
    expect((await request.put('/api/v1/seller/application/business', { data: business, headers: h })).ok()).toBeTruthy()
    expect((await request.put('/api/v1/seller/application/kosher', { data: { answers: { sells_food: 'no' } }, headers: h })).ok()).toBeTruthy()
    expect((await request.post('/api/v1/seller/application/submit', { data: { acceptSellerAgreement: true }, headers: h })).ok()).toBeTruthy()
    await setStatus(request, s.sellerId, 'Approved')
  }
  return s
}

async function signIn(page: Page, email: string) {
  await page.goto('/login'); await uiLogin(page, email); await dismissPasskeyOffer(page)
  await page.goto('/products')
}

/** Starts a draft through the UI: title + category, then lands in the editor. */
async function startDraft(page: Page, title: string) {
  await page.getByRole('link', { name: /add (your first )?product/i }).first().click()
  await expect(page.getByRole('heading', { name: 'What are you selling?' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByLabel('Product title').fill(title)
  await page.getByRole('combobox', { name: 'Category' }).fill('kitchen')
  await page.getByRole('option', { name: /Kitchen & Dining/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/)
  return page.url().split('/').pop()!
}

async function waitSaved(page: Page) { await expect(page.getByTestId('save-indicator')).toHaveText('All changes saved', { timeout: 15_000 }) }

test('approved seller: create with photos, bullets, variation and specs, preview, activate, list, inline price edit', async ({ page, request }) => {
  const s = await seller(request, true)
  await signIn(page, s.email)
  await expect(page.getByRole('heading', { name: 'Add your first product' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Products', level: 1 })).toBeVisible()
  await expectNoSeriousA11y(page)

  await startDraft(page, 'Speckled stoneware coffee mug 350 ml - handmade')
  await expect(page.getByRole('heading', { name: /Speckled stoneware/, level: 1 })).toBeVisible()

  // photos
  await page.getByLabel('Upload photos').setInputFiles([{ name: 'front.png', mimeType: 'image/png', buffer: makePng() }, { name: 'side.png', mimeType: 'image/png', buffer: makePng(1100, 1100) }])
  await expect(page.getByRole('list', { name: 'Photos' }).getByRole('listitem')).toHaveCount(2)
  await page.getByLabel('Alt text for photo 1').fill('Blue speckled mug, front view'); await page.getByLabel('Alt text for photo 1').blur()
  await expect(page.getByText('Main', { exact: true })).toBeVisible()

  // description, price, stock, identifiers
  await page.getByLabel('Feature 1', { exact: true }).fill('350 ml capacity'); await page.getByRole('button', { name: 'Add a feature' }).click()
  await page.getByLabel('Feature 2', { exact: true }).fill('Dishwasher safe')
  await page.getByRole('textbox', { name: 'Description' }).fill('## Hand glazed\nA **sturdy** stoneware mug made in small batches. Each piece has its own speckle pattern, so no two are the same. Microwave and dishwasher safe, with a comfortable handle.')
  await page.getByLabel('Price (USD)', { exact: true }).fill('19.99')
  await page.getByLabel('Quantity in stock').fill('12')
  await page.getByLabel('SKU (optional)', { exact: true }).fill('MUG-E2E-1')
  await page.getByLabel('This product has no barcode').check()

  // variations
  await page.getByLabel('This product comes in different options').check()
  await page.getByLabel('Option name', { exact: true }).fill('Size')
  await page.getByLabel(/Add Size values/).fill('S, M, L'); await page.getByLabel(/Add Size values/).press('Enter')
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(4) // header + 3
  await page.getByLabel('Stock for S').fill('5'); await page.getByLabel('Stock for M').fill('5'); await page.getByLabel('Stock for L').fill('2')
  await page.getByLabel('SKU for S').fill('MUG-S')

  // specifications (data-driven)
  await page.getByLabel(/^Material/).fill('Stoneware')
  await page.getByLabel('Package weight (grams)').fill('420'); await page.getByLabel('Handling time (days)').fill('2')
  await page.getByLabel('Returns window').selectOption('30')
  await waitSaved(page)
  await expectNoSeriousA11y(page)

  // preview as buyer
  await page.getByRole('button', { name: 'Preview as buyer' }).click()
  const dlg = page.getByRole('dialog', { name: 'Preview as buyer' })
  await expect(dlg.getByRole('heading', { name: /Speckled stoneware/ })).toBeVisible()
  await expect(dlg.getByText('$19.99')).toBeVisible(); await expect(dlg.getByText('350 ml capacity')).toBeVisible(); await expect(dlg.getByRole('cell', { name: 'Stoneware', exact: true })).toBeVisible()
  await dlg.getByLabel('Size').selectOption('M')
  await expectNoSeriousA11y(page)
  await page.keyboard.press('Escape'); await expect(dlg).toBeHidden()

  // activate
  await expect(page.getByText('All required items are done')).toBeVisible()
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.getByText('Your listing is live.')).toBeVisible()
  await expect(page.locator('.ed-title .chip')).toHaveText('Active')

  // list + inline edit
  await page.getByRole('link', { name: '← Products' }).click()
  await expect(page.locator('a.ptitle:visible', { hasText: 'Speckled stoneware' })).toBeVisible()
  await expectNoSeriousA11y(page)
  const price = page.getByLabel(/^Price for Speckled/)
  await price.fill('24.5'); await price.blur()
  await expect(async () => { await page.reload(); await expect(page.getByLabel(/^Price for Speckled/)).toHaveValue('24.5') }).toPass({ timeout: 10_000 })
  await page.getByRole('tab', { name: /Active/ }).click()
  await expect(page.locator('a.ptitle:visible', { hasText: 'Speckled stoneware' })).toBeVisible()
})

test('seller that is not approved can save a draft but cannot activate', async ({ page, request }) => {
  const s = await seller(request, false)
  await signIn(page, s.email)
  await startDraft(page, 'Pending seller travel tumbler 500 ml')
  await page.getByLabel('Price (USD)', { exact: true }).fill('12'); await page.getByLabel('Quantity in stock').fill('3'); await page.getByLabel('This product has no barcode').check()
  await page.getByLabel('Upload photos').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: makePng() })
  await expect(page.getByRole('list', { name: 'Photos' }).getByRole('listitem')).toHaveCount(1)
  await waitSaved(page)
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.getByText(/still being reviewed/)).toBeVisible()
  await expect(page.locator('.ed-title .chip')).toHaveText('Draft')
  await page.reload()
  await expect(page.getByLabel('Price (USD)', { exact: true })).toHaveValue('12')
})

test('answer a customer question', async ({ page, request }) => {
  const s = await seller(request, false)
  await signIn(page, s.email)
  const id = await startDraft(page, 'Question magnet mug')
  const r = await request.post('/api/dev/questions', { data: { productId: id, askerName: 'Sam', text: 'Is the handle big enough for two fingers?' } })
  expect(r.status()).toBe(201)
  await page.getByRole('link', { name: 'Questions' }).first().click()
  await expect(page.getByRole('heading', { name: 'Questions', level: 1 })).toBeVisible()
  await expect(page.getByText('Is the handle big enough for two fingers?')).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByLabel('Your answer').fill('Yes - it fits two fingers comfortably.')
  await page.getByRole('button', { name: 'Publish answer' }).click()
  await expect(page.getByText('Is the handle big enough')).toBeHidden() // moves out of "Unanswered"
  await page.getByRole('tab', { name: /^Answered/ }).click()
  await expect(page.getByText('Is the handle big enough for two fingers?')).toBeVisible()
  await expect(page.getByLabel('Your answer')).toHaveValue('Yes - it fits two fingers comfortably.')
})

test('CSV import: template, validation preview with row errors, import as drafts', async ({ page, request }) => {
  const s = await seller(request, false)
  await signIn(page, s.email)
  await page.getByRole('link', { name: 'Bulk upload' }).first().click()
  await expect(page.getByRole('heading', { name: 'Bulk upload', level: 1 })).toBeVisible()
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download template' }).click()
  expect((await dl).suggestedFilename()).toBe('solvelt-products-template.csv')
  const csv = 'sku,title,price,quantity,barcode\nCSV-1,Imported ceramic bowl,9.5,4,\nCSV-2,Bad barcode bowl,9.5,4,036000291453\nCSV-1,Duplicate sku bowl,5,1,\n'
  await page.getByLabel('CSV file').setInputFiles({ name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByText(/1 of 3 rows ready to import/)).toBeVisible()
  await expect(page.getByText(/invalid check digit/)).toBeVisible(); await expect(page.getByText(/appears twice/)).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Import 1 product as drafts' }).click()
  await expect(page.getByText(/Imported 1 product as drafts/)).toBeVisible()
  await page.getByRole('link', { name: 'View your drafts' }).click()
  await expect(page.getByRole('link', { name: 'Imported ceramic bowl', exact: true })).toBeVisible()
  await expect(page.getByLabel(/^Price for Imported/)).toHaveValue('9.5')
})
