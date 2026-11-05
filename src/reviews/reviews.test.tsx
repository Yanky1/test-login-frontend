import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { API, mount } from '../products/testkit'
import ReviewsPage from './Reviews'
import { Stars } from './Stars'
import type { Review, ReviewList } from './types'
import { render } from '@testing-library/react'

const acct = (role: string) => ({ activeAccountId: 'a1', role, accounts: [{ sellerId: 'a1', vendorName: 'Acme Co', role, accountStatus: 'Approved', brandCount: 1 }] })
const review = (o: Partial<Review> = {}): Review => ({
  id: 'r1', reviewId: 'rev-1', productId: 'p1', productTitle: 'Blue mug', rating: 4, text: 'Lovely mug, arrived quickly.', buyerDisplayName: 'Jane B.',
  createdAt: '2026-11-01T10:00:00Z', editedAt: null, state: 'visible', reply: null, ...o,
})
const list = (items: Review[], o: Partial<ReviewList> = {}): ReviewList => ({
  items, total: items.length, page: 1, pageSize: 20, hiddenCount: 0,
  summary: { count: 3, average: 4.3, counts: { '1': 0, '2': 0, '3': 1, '4': 0, '5': 2 } }, ...o,
})
const products = () => http.get(`${API}/seller/products`, () => HttpResponse.json({ items: [{ id: 'p1', title: 'Blue mug' }, { id: 'p2', title: 'Red jug' }], total: 2, page: 1, pageSize: 100, counts: {} }))

function mockReviews(items: Review[] = [review()], extra: Partial<ReviewList> = {}) {
  const urls: URL[] = []
  server.use(products(), http.get(`${API}/seller/brands`, () => HttpResponse.json([])), http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme' }])),
    http.get(`${API}/seller/reviews`, ({ request }) => { urls.push(new URL(request.url)); return HttpResponse.json(list(items, extra)) }))
  return urls
}

describe('Stars', () => {
  it('announces the rating as text and hides the drawn stars', () => {
    render(<Stars rating={4} />)
    const img = screen.getByRole('img', { name: '4 out of 5 stars' })
    expect(img.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(5)
  })
})

describe('reviews page', () => {
  it('shows the average, the counts per star, and a card with stars, text, name, product and date', async () => {
    mockReviews()
    mount(<ReviewsPage />, '/reviews', '/reviews', acct('Owner'))
    const card = (await screen.findByText('Lovely mug, arrived quickly.')).closest('li')!
    expect(within(card).getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument()
    expect(within(card).getByText('4 out of 5 stars')).toBeInTheDocument()       // also as visible text
    expect(within(card).getByText('Jane B.')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Blue mug' })).toHaveAttribute('href', '/products/p1')
    expect(within(card).getByText(/Nov 1, 2026/)).toBeInTheDocument()
    expect(screen.getByLabelText('Average rating 4.3 out of 5')).toHaveTextContent('4.3')
    expect(screen.getByText('3 reviews')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^5 stars 2 reviews/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^1 star 0 reviews/ })).toBeInTheDocument()
  })

  it('has a friendly empty state, and a different one when filters hide everything', async () => {
    mockReviews([], { summary: { count: 0, average: null, counts: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } } })
    mount(<ReviewsPage />, '/reviews', '/reviews', acct('Owner'))
    expect(await screen.findByRole('heading', { name: 'No reviews yet' })).toBeInTheDocument()
    expect(screen.getByLabelText('No rating yet')).toBeInTheDocument()
  })

  it('says so when the filters match nothing', async () => {
    mockReviews([])
    mount(<ReviewsPage />, '/reviews', '/reviews?rating=2', acct('Owner'))
    expect(await screen.findByRole('heading', { name: 'No reviews match these filters' })).toBeInTheDocument()
  })

  it('sends the rating, reply, product and star filters to the server and keeps them in the URL', async () => {
    const urls = mockReviews()
    mount(<ReviewsPage />, '/reviews', '/reviews', acct('Owner'))
    await screen.findByText('Lovely mug, arrived quickly.')
    await userEvent.selectOptions(screen.getByLabelText('Rating'), '5'); await waitFor(() => expect(urls.at(-1)!.searchParams.get('rating')).toBe('5'))
    await userEvent.selectOptions(screen.getByLabelText('Replies'), 'false'); await waitFor(() => expect(urls.at(-1)!.searchParams.get('replied')).toBe('false'))
    await userEvent.selectOptions(await screen.findByLabelText('Product'), 'p2'); await waitFor(() => expect(urls.at(-1)!.searchParams.get('productId')).toBe('p2'))
    await userEvent.selectOptions(screen.getByLabelText('Rating'), ''); await waitFor(() => expect(urls.at(-1)!.searchParams.get('rating')).toBeNull())
    // the per-star rows are real buttons: keyboard operable, and they toggle the rating filter
    const star3 = screen.getByRole('button', { name: /^3 stars/ })
    star3.focus(); await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(urls.at(-1)!.searchParams.get('rating')).toBe('3'))
    expect(screen.getByRole('button', { name: /^3 stars/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: /^3 stars/ })); await waitFor(() => expect(urls.at(-1)!.searchParams.get('rating')).toBeNull())
  })

  it('marks demo reviews with the Demo pill', async () => {
    mockReviews([review({ demo: true }), review({ id: 'r2', text: 'Another one' })])
    mount(<ReviewsPage />, '/reviews', '/reviews', acct('Owner'))
    const demo = (await screen.findByText('Lovely mug, arrived quickly.')).closest('li')!
    expect(within(demo).getByText('Demo')).toBeInTheDocument()
    expect(within(screen.getByText('Another one').closest('li')!).queryByText('Demo')).toBeNull()
  })

  it('pages through long lists', async () => {
    const urls = mockReviews([review()], { total: 45, pageSize: 20 })
    mount(<ReviewsPage />, '/reviews', '/reviews', acct('Owner'))
    await screen.findByText('Page 1 of 3')
    await userEvent.click(screen.getByRole('button', { name: 'Next' })); await waitFor(() => expect(urls.at(-1)!.searchParams.get('page')).toBe('2'))
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
  })
})

describe('reply editor', () => {
  it('posts a reply with a live character counter, and the button stays disabled until there is text', async () => {
    let posted: unknown
    mockReviews()
    server.use(http.put(`${API}/seller/reviews/r1/reply`, async ({ request }) => { posted = await request.json(); return HttpResponse.json(review({ reply: { id: 'rp1', text: 'Thank you!', createdAt: '2026-11-02T10:00:00Z', editedAt: null } }), { status: 201 }) }))
    mount(<ReviewsPage />, '/reviews', '/reviews', acct('Manager'))
    await userEvent.click(await screen.findByRole('button', { name: /^Reply/ }))
    const box = screen.getByLabelText('Your reply')
    expect(box).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Post reply' })).toBeDisabled()
    expect(screen.getByTestId('reply-count')).toHaveTextContent('0 / 2000')
    await userEvent.type(box, 'Thank you!')
    expect(screen.getByTestId('reply-count')).toHaveTextContent('10 / 2000')
    expect(box).toHaveAttribute('maxlength', '2000')
    await userEvent.click(screen.getByRole('button', { name: 'Post reply' }))
    await waitFor(() => expect(posted).toEqual({ text: 'Thank you!' }))
  })

  it('edits an existing reply and shows server problems (contact details, rate limit) inline', async () => {
    const problems: { status: number; body: object }[] = [
      { status: 422, body: { code: 'contact_details_not_allowed', title: "Replies can't include email addresses, phone numbers or links. Keep the conversation on Solvelt." } },
      { status: 429, body: { code: 'rate_limited', title: 'Too many replies' } },
    ]
    mockReviews([review({ reply: { id: 'rp1', text: 'Thanks!', createdAt: '2026-11-02T10:00:00Z', editedAt: null } })])
    server.use(http.put(`${API}/seller/reviews/r1/reply`, () => { const p = problems.shift()!; return HttpResponse.json(p.body, { status: p.status }) }))
    mount(<ReviewsPage />, '/reviews', '/reviews', acct('Admin'))
    await userEvent.click(await screen.findByRole('button', { name: /^Edit reply/ }))
    const box = screen.getByLabelText('Your reply')
    expect(box).toHaveValue('Thanks!')
    expect(screen.getByRole('button', { name: 'Save reply' })).toBeDisabled()          // unchanged text
    await userEvent.clear(box); await userEvent.type(box, 'mail me at a@b.co')
    await userEvent.click(screen.getByRole('button', { name: 'Save reply' }))
    expect(await screen.findByText(/can't include email addresses/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save reply' }))
    expect(await screen.findByText(/posted a lot of replies/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Thanks!')).toBeInTheDocument()
  })

  it('a Viewer can read but sees no reply, edit or delete controls', async () => {
    mockReviews([review({ reply: { id: 'rp1', text: 'Thanks!', createdAt: '2026-11-02T10:00:00Z', editedAt: null } }), review({ id: 'r2', text: 'No reply yet' })])
    mount(<ReviewsPage />, '/reviews', '/reviews', acct('Viewer'))
    expect(await screen.findByText('No reply yet')).toBeInTheDocument()
    expect(screen.getByText('Thanks!')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Reply/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit reply/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete reply/ })).toBeNull()
    expect(screen.queryByRole('tab', { name: /Hidden by marketplace/ })).toBeNull()      // the hidden view is for Owner and Admin
  })
})

describe('delete reply', () => {
  const withReply = () => review({ reply: { id: 'rp1', text: 'Thanks!', createdAt: '2026-11-02T10:00:00Z', editedAt: null } })

  it('asks for confirmation first; keeping the reply sends nothing', async () => {
    let deleted = 0
    mockReviews([withReply()])
    server.use(http.delete(`${API}/seller/reviews/r1/reply`, () => { deleted++; return new HttpResponse(null, { status: 204 }) }))
    mount(<ReviewsPage />, '/reviews', '/reviews', acct('Owner'))
    await userEvent.click(await screen.findByRole('button', { name: /^Delete reply/ }))
    const dlg = screen.getByRole('dialog', { name: 'Delete your reply?' })
    expect(dlg).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Keep reply' }))
    expect(screen.queryByRole('dialog')).toBeNull(); expect(deleted).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: /^Delete reply/ })); fireEvent.keyDown(document, { key: 'Escape' })    // Escape closes it too
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(deleted).toBe(0)
  })

  it('deletes the reply after the confirmation and reloads the list', async () => {
    let deleted = 0; let current = [withReply()]
    server.use(products(), http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme' }])),
      http.get(`${API}/seller/reviews`, () => HttpResponse.json(list(current))),
      http.delete(`${API}/seller/reviews/r1/reply`, () => { deleted++; current = [review()]; return new HttpResponse(null, { status: 204 }) }))
    mount(<ReviewsPage />, '/reviews', '/reviews', acct('Owner'))
    await userEvent.click(await screen.findByRole('button', { name: /^Delete reply/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete reply' }))
    await waitFor(() => expect(deleted).toBe(1))
    expect(await screen.findByRole('button', { name: /^Reply/ })).toBeInTheDocument()
    expect(screen.queryByText('Thanks!')).toBeNull()
  })
})

describe('Hidden by marketplace view', () => {
  it('Owner and Admin can open it; hidden and removed reviews have no reply controls and show their state', async () => {
    const urls = mockReviews([review({ state: 'hidden', stateReason: 'Under review' }), review({ id: 'r2', state: 'removed', text: null, buyerDisplayName: null })], { hiddenCount: 2 })
    mount(<ReviewsPage />, '/reviews', '/reviews?view=hidden', acct('Owner'))
    expect(await screen.findByText('Hidden by marketplace', { selector: '.chip' })).toBeInTheDocument()
    expect(screen.getByText('Under review')).toBeInTheDocument()
    expect(screen.getByText('Removed by marketplace')).toBeInTheDocument()
    expect(screen.getByText('The text of this review was removed.')).toBeInTheDocument()
    expect(screen.getByText('Anonymous')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Reply/ })).toBeNull()
    expect(urls.at(-1)!.searchParams.get('view')).toBe('hidden')
    expect(screen.getByRole('tab', { name: /Hidden by marketplace/ })).toHaveTextContent('2')
  })

  it('a Manager asking for the hidden view gets the normal list', async () => {
    const urls = mockReviews()
    mount(<ReviewsPage />, '/reviews', '/reviews?view=hidden', acct('Manager'))
    await screen.findByText('Lovely mug, arrived quickly.')
    expect(urls.at(-1)!.searchParams.get('view')).toBeNull()
  })
})
