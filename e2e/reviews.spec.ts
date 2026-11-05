import { expect, expectNoSeriousA11y, test } from './helpers'
import type { APIRequestContext, Page } from '@playwright/test'
import { signedPost } from './adminKit'
import { ingest, REVIEWS } from './reviewsKit'
import { product, seller, signIn } from './ordersKit'

/** Events of one review that reached the marketplace (the dev sink), in delivery order. */
async function sent(request: APIRequestContext, reviewId: string) {
  let out: { type: string; data: Record<string, unknown> }[] = []
  await expect.poll(async () => {
    await request.post('/api/dev/outbox/dispatch')
    const all = (await (await request.get('/api/dev/outbox')).json()) as { type?: string; Type?: string; body?: string; Body?: string }[]
    out = all.map((e) => JSON.parse(e.body ?? e.Body ?? '{}') as { type: string; data: Record<string, unknown> }).filter((e) => e.type?.startsWith('review.') && e.data?.reviewId === reviewId)
    return out.length
  }).toBeGreaterThan(0)
  return out
}

const eventsAre = async (request: APIRequestContext, reviewId: string, types: string[]) => {
  await expect.poll(async () => { await request.post('/api/dev/outbox/dispatch'); return (await sent(request, reviewId)).map((e) => e.type) }).toEqual(types)
}

async function bothThemes(page: Page, check: () => Promise<void>) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.evaluate((x) => { document.documentElement.dataset.theme = x }, scheme)
    await check()
  }
  await page.emulateMedia({ colorScheme: 'light' }); await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
}

test('a signed review is ingested, appears, and the seller replies, edits and deletes the reply (axe in light and dark)', async ({ page, request }) => {
  const s = await seller(request)
  const p = await product(request, s.token, 'Speckled stoneware mug')
  const r = await ingest(request, s, p, { rating: 4, text: 'Lovely mug, arrived quickly.', name: 'Jane B.' })
  expect(r.status, r.body).toBe(201)
  // an unsigned call is refused, so this really is the signed path
  expect((await request.post(REVIEWS, { data: { reviewId: 'x' } })).status()).toBe(401)

  await signIn(page, s.email, '/reviews')
  await expect(page.getByRole('heading', { name: 'Reviews', level: 1 })).toBeVisible()
  const card = page.getByRole('listitem').filter({ hasText: 'Lovely mug, arrived quickly.' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('img', { name: '4 out of 5 stars' })).toBeVisible()
  await expect(card.getByText('Jane B.', { exact: true })).toBeVisible()
  await expect(card.getByRole('link', { name: 'Speckled stoneware mug' })).toBeVisible()
  await expect(page.getByLabel('Average rating 4.0 out of 5')).toBeVisible()
  await bothThemes(page, () => expectNoSeriousA11y(page))

  // reply: the character counter, then the reply shows on the card
  await card.getByRole('button', { name: /^Reply/ }).click()
  const box = page.getByLabel('Your reply')
  await expect(box).toBeFocused()
  await expect(page.getByRole('button', { name: 'Post reply' })).toBeDisabled()
  await box.fill('Thank you, Jane!')
  await expect(page.getByTestId('reply-count')).toHaveText('16 / 2000')
  await bothThemes(page, () => expectNoSeriousA11y(page))                                // with the editor open
  await page.getByRole('button', { name: 'Post reply' }).click()
  await expect(card.getByRole('region', { name: 'Your public reply' }).getByText('Thank you, Jane!')).toBeVisible()
  await eventsAre(request, r.reviewId, ['review.reply_posted'])

  // contact details are refused with a friendly message and nothing changes
  await card.getByRole('button', { name: /^Edit reply/ }).click()
  await page.getByLabel('Your reply').fill('Write to me at jane@example.com')
  await page.getByRole('button', { name: 'Save reply' }).click()
  await expect(page.getByText(/can't include email addresses, phone numbers or links/).first()).toBeVisible()
  await expectNoSeriousA11y(page)

  // edit
  await page.getByLabel('Your reply').fill('Thank you, Jane! Enjoy.')
  await page.getByRole('button', { name: 'Save reply' }).click()
  await expect(card.getByText('Thank you, Jane! Enjoy.')).toBeVisible()
  await expect(card.getByText(/\(edited\)/)).toBeVisible()
  await eventsAre(request, r.reviewId, ['review.reply_posted', 'review.reply_posted'])
  const edited = (await sent(request, r.reviewId))[1]
  expect(edited.data.text).toBe('Thank you, Jane! Enjoy.'); expect(edited.data.editedAt).toBeTruthy()

  // delete, with a confirmation dialog
  await card.getByRole('button', { name: /^Delete reply/ }).click()
  const dlg = page.getByRole('dialog', { name: 'Delete your reply?' })
  await expect(dlg).toBeVisible()
  await bothThemes(page, () => expectNoSeriousA11y(page))
  await dlg.getByRole('button', { name: 'Keep reply' }).click()
  await expect(card.getByText('Thank you, Jane! Enjoy.')).toBeVisible()
  await card.getByRole('button', { name: /^Delete reply/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete reply' }).click()
  await expect(card.getByText('Thank you, Jane! Enjoy.')).toHaveCount(0)
  await expect(card.getByRole('button', { name: /^Reply/ })).toBeVisible()
  await eventsAre(request, r.reviewId, ['review.reply_posted', 'review.reply_posted', 'review.reply_removed'])
  expect((await sent(request, r.reviewId))[2].data.reason).toBe('seller_deleted')
})

test('filters, the hidden-by-marketplace view and an empty account (axe in light and dark)', async ({ page, request }) => {
  const s = await seller(request)
  await signIn(page, s.email, '/reviews')
  await expect(page.getByRole('heading', { name: 'No reviews yet' })).toBeVisible()
  await bothThemes(page, () => expectNoSeriousA11y(page))

  const p = await product(request, s.token, 'Linen napkin set')
  const five = await ingest(request, s, p, { rating: 5, text: 'Perfect, five stars.', name: 'Ana K.' })
  await ingest(request, s, p, { rating: 2, text: 'Not what I expected.', name: 'Ben L.' })
  const bad = await ingest(request, s, p, { rating: 1, text: 'Arrived damaged.', name: 'Cy M.' })
  await page.reload()
  await expect(page.getByText('Perfect, five stars.')).toBeVisible()
  await expect(page.getByText('3 reviews')).toBeVisible()

  // filter by star with the keyboard-operable rows, and by "needs a reply"
  await page.getByRole('button', { name: /^5 stars 1 review/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Not what I expected.')).toHaveCount(0)
  await expect(page.getByText('Perfect, five stars.')).toBeVisible()
  await page.getByRole('button', { name: /^5 stars 1 review/ }).press('Enter')
  await page.getByLabel('Replies').selectOption('true')
  await expect(page.getByRole('heading', { name: 'No reviews match these filters' })).toBeVisible()
  await page.getByLabel('Replies').selectOption('')
  await expect(page.getByText('Arrived damaged.')).toBeVisible()

  // the marketplace hides a review: it leaves the list, and the Owner finds it under "Hidden by marketplace"
  expect((await signedPost(request, `${REVIEWS}/${bad.reviewId}/state`, { state: 'hidden', reason: 'Under review' })).status()).toBe(200)
  await page.reload()
  await expect(page.getByText('Arrived damaged.')).toHaveCount(0)
  await page.getByRole('tab', { name: /Hidden by marketplace/ }).click()
  const hidden = page.getByRole('listitem').filter({ hasText: 'Arrived damaged.' })
  await expect(hidden).toBeVisible()
  await expect(hidden.getByText('Hidden by marketplace', { exact: true })).toBeVisible()
  await expect(hidden.getByRole('button', { name: /^Reply/ })).toHaveCount(0)             // replying is blocked while hidden
  await bothThemes(page, () => expectNoSeriousA11y(page))
  expect(five.status).toBe(201)
})
