import { test, expect } from './helpers'
import type { Page } from '@playwright/test'
import { signedPost } from './adminKit'
import { product, seller, signIn } from './ordersKit'
import { ingest } from './reviewsKit'

const SHOTS = process.env.SHOTS_DIR // e.g. SHOTS_DIR=docs/screenshots/reviews
const DARK = process.env.SHOT_THEME === 'dark' // SHOT_THEME=dark captures the dark variants (files get a -dark suffix)
const VIEWS = [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const

test('screenshots of the reviews page (desktop + mobile)', async ({ page, request }) => {
  test.skip(!SHOTS, 'set SHOTS_DIR to capture screenshots')
  test.setTimeout(180_000)
  if (DARK) { await page.emulateMedia({ colorScheme: 'dark' }) }
  const s = await seller(request)
  const empty = await seller(request)
  const mug = await product(request, s.token, 'Speckled stoneware mug')
  const napkins = await product(request, s.token, 'Linen napkin set')
  const day = 86_400_000
  const a = await ingest(request, s, mug, { rating: 5, text: 'Beautifully made and it arrived wrapped with care. I use it every day.', name: 'Morgan P.', createdAt: new Date(Date.now() - 5 * day).toISOString() })
  await ingest(request, s, mug, { rating: 4, text: 'Lovely glaze. A touch smaller than I expected.', name: 'Alex R.', createdAt: new Date(Date.now() - 4 * day).toISOString() })
  await ingest(request, s, napkins, { rating: 3, text: 'Soft linen but the colour is lighter than the photo.', name: 'Jamie W.', createdAt: new Date(Date.now() - 3 * day).toISOString() })
  const damaged = await ingest(request, s, napkins, { rating: 1, text: 'One napkin had a hole.', name: 'Sam T.', createdAt: new Date(Date.now() - 1 * day).toISOString() })
  await ingest(request, s, mug, { rating: 5, text: null, name: 'Riley C.', createdAt: new Date(Date.now() - 2 * day).toISOString() })
  const hidden = await ingest(request, s, napkins, { rating: 2, text: 'Reported by the marketplace.', name: 'Pat Q.' })
  expect((await signedPost(request, `/api/internal/v1/reviews/${hidden.reviewId}/state`, { state: 'hidden', reason: 'Under review' })).status()).toBe(200)

  const shot = async (p: Page, name: string, view: string) => { await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/${name}-${view}${DARK ? '-dark' : ''}.png`, fullPage: false }) }
  // one reply, posted through the UI so the card shows a real reply
  await signIn(page, s.email, '/reviews')
  const card = page.getByRole('listitem').filter({ hasText: 'Beautifully made' })
  await card.getByRole('button', { name: /^Reply/ }).click()
  await page.getByLabel('Your reply').fill('Thank you, Morgan! We are so glad it found a good home.')
  await page.getByRole('button', { name: 'Post reply' }).click()
  await expect(card.getByText('We are so glad it found a good home.')).toBeVisible()
  expect(a.status).toBe(201); expect(damaged.status).toBe(201)

  for (const [view, size] of VIEWS) {
    await page.setViewportSize(size)
    await page.goto('/reviews'); await expect(page.getByText('Soft linen but the colour')).toBeVisible(); await shot(page, 'reviews-list', view)
    await page.getByRole('listitem').filter({ hasText: 'One napkin had a hole.' }).getByRole('button', { name: /^Reply/ }).click()
    await page.getByLabel('Your reply').fill('We are sorry about that, Sam. A replacement is on its way.'); await shot(page, 'reviews-reply-editor', view)
    await page.goto('/reviews'); await expect(page.getByText('Soft linen but the colour')).toBeVisible()
    await page.getByRole('listitem').filter({ hasText: 'Beautifully made' }).getByRole('button', { name: /^Delete reply/ }).click()
    await expect(page.getByRole('dialog', { name: 'Delete your reply?' })).toBeVisible(); await shot(page, 'reviews-delete-confirm', view)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^5 stars/ }).click(); await expect(page.getByText('Soft linen but the colour')).toHaveCount(0); await shot(page, 'reviews-filtered', view)
    await page.goto('/reviews?view=hidden'); await expect(page.getByText('Reported by the marketplace.')).toBeVisible(); await shot(page, 'reviews-hidden', view)
  }
  // an account without reviews
  await page.context().clearCookies(); await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await signIn(page, empty.email, '/reviews')
  for (const [view, size] of VIEWS) { await page.setViewportSize(size); await page.goto('/reviews'); await expect(page.getByRole('heading', { name: 'No reviews yet' })).toBeVisible(); await shot(page, 'reviews-empty', view) }
})
