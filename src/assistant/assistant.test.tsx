import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'
import { parseSse } from './api'
import { AssistantProvider } from './context'
import { AssistantButton, AssistantPanel } from './AssistantPanel'
import { pageContextFor, suggestionsFor, linkFor } from './routes'
import type { ActionCard, AssistantConfig } from './types'

const API = '*/api/v1'
const ORDER = '3f2c1a10-1111-4222-8333-444455556666'
const PRODUCT = '9a8b7c60-1111-4222-8333-444455556666'
const enc = new TextEncoder()
const sse = (events: [string, unknown][], keepOpen = false) => new HttpResponse(new ReadableStream({
  start(c) { for (const [t, d] of events) c.enqueue(enc.encode(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`)); if (!keepOpen) c.close() },
}), { headers: { 'Content-Type': 'text/event-stream' } })

const cfg = (over: Partial<AssistantConfig> = {}): AssistantConfig => ({ enabled: true, stopped: false, role: 'Owner', canPropose: true, readOnlyReason: null, maxMessageChars: 4000, actionExpiryMinutes: 10, retentionDays: 90, ...over })
const card = (over: Partial<ActionCard> = {}): ActionCard => ({
  id: 'act-1', conversationId: 'c1', type: 'propose_create_product', target: { kind: 'product', id: null, label: 'Challah board' },
  summary: 'Create a draft listing "Challah board" in Acme at $25.00 with 10 in stock.', risk: 'low', status: 'pending',
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
  diff: [{ field: 'Listing', before: null, after: 'Challah board' }, { field: 'Price', before: null, after: '$25.00' }, { field: 'Status', before: null, after: 'Draft (not visible to buyers)' }], ...over,
})
const acct = (role = 'Owner') => ({ activeAccountId: 'a1', role, accounts: [{ sellerId: 'a1', vendorName: 'Acme Co', role, accountStatus: 'Approved', brandCount: 1 }] })

function mount(opts: { config?: Partial<AssistantConfig>; role?: string; route?: string } = {}) {
  signedIn(acct(opts.role ?? 'Owner'))
  const seen: { stream: unknown[]; confirm: Headers[] } = { stream: [], confirm: [] }
  server.use(
    http.get(`${API}/assistant/config`, () => HttpResponse.json(cfg(opts.config))),
    http.get(`${API}/assistant/conversations`, () => HttpResponse.json({ items: [] })),
  )
  renderAt(<AssistantProvider><AssistantButton /><AssistantPanel /><Routes><Route path="*" element={<h1>Page</h1>} /></Routes></AssistantProvider>, opts.route ?? '/products')
  return seen
}
const openPanel = async () => { await userEvent.click(await screen.findByRole('button', { name: /Assistant/ })); return screen.findByRole('dialog', { name: 'Solvelt Assistant' }) }

describe('assistant entry point and panel', () => {
  it('is hidden when the feature is off or the server has no assistant', async () => {
    mount({ config: { enabled: false } })
    await screen.findByRole('heading', { name: 'Page' }); await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: /Assistant/ })).toBeNull()
  })

  it('opens with focus in the composer, shows suggestions, closes with Escape and returns focus to the button', async () => {
    mount()
    const btn = await screen.findByRole('button', { name: /Assistant/ })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    const panel = await openPanel()
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(screen.getByLabelText('Message the assistant')).toHaveFocus())
    expect(within(panel).getByRole('heading', { name: /How can I help/ })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /Add a draft product/ })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull(); expect(btn).toHaveFocus()
  })

  it('streams an answer: tool step, text, links built by the app from kind + id, page context sent, live region marked busy', async () => {
    mount({ route: `/products/${PRODUCT}` })
    let body: { text: string; page: { kind: string; id: string } | null; conversationId: string | null } | null = null
    server.use(http.post(`${API}/assistant/messages/stream`, async ({ request }) => {
      body = (await request.json()) as typeof body
      return sse([
        ['conversation', { conversationId: 'c1', title: 'Which orders are late?' }],
        ['tool', { id: 't1', name: 'list_orders', label: 'Looking up your orders…', status: 'running' }],
        ['tool', { id: 't1', name: 'list_orders', label: 'Looking up your orders…', status: 'done' }],
        ['text', { delta: '1 order is late: Order SO-1001. ' }],
        ['text', { delta: '[click](https://evil.example) <b>x</b>' }],
        ['done', { messageId: 'm1', conversationId: 'c1', text: '1 order is late: Order SO-1001. [click](https://evil.example) <b>x</b>', status: 'ok', links: [{ kind: 'order', id: ORDER, label: 'Order SO-1001' }, { kind: 'order', id: 'javascript:alert(1)', label: 'Bad' }] }],
      ])
    }))
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Improve this listing' }))
    expect(await screen.findByText(/1 order is late/)).toBeInTheDocument()
    expect(body).toMatchObject({ text: 'Improve this listing', page: { kind: 'product', id: PRODUCT }, conversationId: null })
    expect(screen.getByText(/Looking up your orders/)).toBeInTheDocument()
    expect(screen.getByRole('log', { name: 'Conversation' })).toHaveAttribute('aria-live', 'polite')
    const link = screen.getByRole('link', { name: 'Order SO-1001' })
    expect(link).toHaveAttribute('href', `/orders/${ORDER}`)
    expect(screen.queryByRole('link', { name: 'Bad' })).toBeNull()      // unsafe ids never become links
    expect(document.querySelector('a[href^="http"]')).toBeNull()        // model-supplied URLs never become links
    expect(document.querySelector('.as-bot b')).toBeNull()              // raw HTML is text, not markup
  })

  it('shows an action card with summary, before/after and expiry; Confirm sends the CSRF header and shows the result', async () => {
    mount(); document.cookie = 'sl_csrf=csrf-abc'
    const headers: Headers[] = []
    server.use(
      http.post(`${API}/assistant/messages/stream`, () => sse([['conversation', { conversationId: 'c1', title: 't' }], ['action', card()], ['text', { delta: 'Prepared.' }], ['done', { messageId: 'm1', conversationId: 'c1', text: 'Prepared.', status: 'ok', links: [] }]])),
      http.post(`${API}/assistant/actions/act-1/confirm`, ({ request }) => { headers.push(request.headers); return HttpResponse.json({ ok: true, code: 'ok', message: 'Draft listing "Challah board" created.', alreadyDone: false, action: card({ status: 'confirmed', result: { code: 'ok', message: 'Draft listing "Challah board" created.' } }), refreshed: null, entity: null }) }),
    )
    await openPanel()
    await userEvent.type(screen.getByLabelText('Message the assistant'), 'Add a draft product for a challah board, $25, 10 in stock{Enter}')
    const c = await screen.findByRole('region', { name: /Proposed action/ })
    expect(within(c).getByRole('heading', { name: 'Do this?' })).toBeInTheDocument()
    expect(within(c).getByText('$25.00')).toBeInTheDocument(); expect(within(c).getByText('Low risk')).toBeInTheDocument()
    expect(within(c).getByText(/Expires in \d+ min/)).toBeInTheDocument(); expect(within(c).getByText(/Nothing has changed yet/)).toBeInTheDocument()
    await userEvent.click(within(c).getByRole('button', { name: /Confirm/ }))
    expect(await screen.findByText('Draft listing "Challah board" created.', { selector: '.as-result' })).toBeInTheDocument()
    expect(headers[0].get('x-csrf-token')).toBe('csrf-abc'); expect(headers[0].get('authorization')).toMatch(/^Bearer /)
    expect(within(screen.getByRole('region', { name: /Proposed action/ })).queryByRole('button', { name: /Confirm/ })).toBeNull()
  })

  it('Cancel changes nothing and says so', async () => {
    mount()
    let cancelled = 0
    server.use(
      http.post(`${API}/assistant/messages/stream`, () => sse([['conversation', { conversationId: 'c1', title: 't' }], ['action', card()], ['done', { messageId: 'm1', conversationId: 'c1', text: 'Prepared.', status: 'ok', links: [] }]])),
      http.post(`${API}/assistant/actions/act-1/cancel`, () => { cancelled++; return HttpResponse.json({ ok: true, code: 'cancelled', message: 'Cancelled.', alreadyDone: false, action: card({ status: 'cancelled' }), refreshed: null, entity: null }) }),
    )
    await openPanel(); await userEvent.type(screen.getByLabelText('Message the assistant'), 'go{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: /^Cancel/ }))
    expect(await screen.findByRole('heading', { name: 'Cancelled' })).toBeInTheDocument(); expect(cancelled).toBe(1)
    expect(screen.getAllByText(/Nothing was changed/).length).toBeGreaterThan(0)
  })

  it('a target that changed shows the refreshed proposal and marks the old card as replaced', async () => {
    mount()
    server.use(
      http.post(`${API}/assistant/messages/stream`, () => sse([['conversation', { conversationId: 'c1', title: 't' }], ['action', card()], ['done', { messageId: 'm1', conversationId: 'c1', text: 'Prepared.', status: 'ok', links: [] }]])),
      http.post(`${API}/assistant/actions/act-1/confirm`, () => HttpResponse.json({ ok: false, code: 'target_changed', message: 'This changed since it was proposed.', alreadyDone: false, action: card({ status: 'superseded' }), refreshed: card({ id: 'act-2', summary: 'Change the price to $44.00 (was $12.50).' }), entity: null }, { status: 409 })),
    )
    await openPanel(); await userEvent.type(screen.getByLabelText('Message the assistant'), 'go{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: /Confirm/ }))
    expect(await screen.findByRole('heading', { name: 'Replaced' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Change the price to \$44/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Confirm/ })).toHaveLength(1)
  })

  it('an expired proposal can no longer be confirmed', async () => {
    mount()
    server.use(http.post(`${API}/assistant/messages/stream`, () => sse([['conversation', { conversationId: 'c1', title: 't' }], ['action', card({ expiresAt: new Date(Date.now() - 1000).toISOString() })], ['done', { messageId: 'm1', conversationId: 'c1', text: 'Prepared.', status: 'ok', links: [] }]])))
    await openPanel(); await userEvent.type(screen.getByLabelText('Message the assistant'), 'go{Enter}')
    expect(await screen.findByRole('heading', { name: 'Expired' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull()
  })

  it('a failed confirmation (permission gone) shows the server reason and no success', async () => {
    mount()
    server.use(
      http.post(`${API}/assistant/messages/stream`, () => sse([['conversation', { conversationId: 'c1', title: 't' }], ['action', card()], ['done', { messageId: 'm1', conversationId: 'c1', text: 'Prepared.', status: 'ok', links: [] }]])),
      http.post(`${API}/assistant/actions/act-1/confirm`, () => HttpResponse.json({ type: 'about:blank', title: 'You don’t have permission to do this', status: 403, code: 'forbidden' }, { status: 403 })),
    )
    await openPanel(); await userEvent.type(screen.getByLabelText('Message the assistant'), 'go{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: /Confirm/ }))
    expect(await screen.findByText(/don.t have permission/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Done' })).toBeNull()
  })

  it('a Viewer sees the read-only explanation, no change suggestions and no Confirm', async () => {
    mount({ role: 'Viewer', config: { role: 'Viewer', canPropose: false, readOnlyReason: 'Your role (Viewer) can look things up but can’t make changes. Ask an Owner, Admin or Manager.' } })
    const panel = await openPanel()
    expect(within(panel).getByText(/can look things up but can.t make changes/)).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /Add a draft product/ })).toBeNull()
    expect(within(panel).queryByRole('button', { name: /Confirm/ })).toBeNull()
  })

  it('kill switch: banner, composer disabled, confirm disabled', async () => {
    mount({ config: { stopped: true } })
    const panel = await openPanel()
    expect(within(panel).getByText(/switched off right now/)).toBeInTheDocument()
    expect(screen.getByLabelText('Message the assistant')).toBeDisabled()
  })

  it('Stop generating aborts the stream and keeps what was written', async () => {
    mount()
    server.use(http.post(`${API}/assistant/messages/stream`, () => sse([['conversation', { conversationId: 'c1', title: 't' }], ['text', { delta: 'Working on it' }]], true)))
    await openPanel(); await userEvent.type(screen.getByLabelText('Message the assistant'), 'go{Enter}')
    await screen.findByText(/Working on it/)
    await userEvent.click(screen.getByRole('button', { name: 'Stop generating' }))
    expect(await screen.findByText('Stopped.')).toBeInTheDocument()
    expect(screen.getByText(/Working on it/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('a budget error is shown with the server message and Try again re-sends', async () => {
    mount()
    let n = 0
    server.use(http.post(`${API}/assistant/messages/stream`, () => {
      if (n++ === 0) return HttpResponse.json({ type: 'about:blank', title: 'You’ve reached today’s assistant message limit.', status: 429, code: 'budget_user_messages' }, { status: 429 })
      return sse([['conversation', { conversationId: 'c1', title: 't' }], ['text', { delta: 'Back again.' }], ['done', { messageId: 'm1', conversationId: 'c1', text: 'Back again.', status: 'ok', links: [] }]])
    }))
    await openPanel(); await userEvent.type(screen.getByLabelText('Message the assistant'), 'hello{Enter}')
    expect(await screen.findByText(/reached today.s assistant message limit/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Back again.')).toBeInTheDocument()
  })

  it('history: lists conversations, opens one with its cards, renames and deletes', async () => {
    mount()
    let items = [{ id: 'c1', title: 'Late orders', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' }]
    server.use(
      http.get(`${API}/assistant/conversations`, () => HttpResponse.json({ items })),
      http.get(`${API}/assistant/conversations/c1`, () => HttpResponse.json({ id: 'c1', title: 'Late orders', messages: [
        { id: 'u1', role: 'user', text: 'Which orders are late?', status: 'ok', tools: [], links: [], actions: [] },
        { id: 'a1', role: 'assistant', text: 'One order is late.', status: 'ok', tools: [{ name: 'list_orders', label: 'Looking up your orders…', ok: true }], links: [{ kind: 'order', id: ORDER, label: 'Order SO-1001' }], actions: [card({ status: 'confirmed', result: { code: 'ok', message: 'Done.' } })] },
      ] })),
      http.patch(`${API}/assistant/conversations/c1`, async ({ request }) => { const b = (await request.json()) as { title: string }; items = [{ ...items[0], title: b.title }]; return HttpResponse.json({ id: 'c1', title: b.title }) }),
      http.delete(`${API}/assistant/conversations/c1`, () => { items = []; return new HttpResponse(null, { status: 204 }) }),
    )
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Late orders/ }))
    expect(await screen.findByText('One order is late.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Order SO-1001' })).toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Done' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    await userEvent.click(await screen.findByRole('button', { name: /Rename/ }))
    const input = screen.getByLabelText('New title'); await userEvent.clear(input); await userEvent.type(input, 'Shipping{Enter}')
    expect(await screen.findByRole('button', { name: /^Shipping/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Delete Shipping/ })); await userEvent.click(await screen.findByRole('button', { name: /Really delete/ }))
    expect(await screen.findByText('No conversations yet.')).toBeInTheDocument()
  })
})

describe('assistant helpers', () => {
  it('parses SSE blocks across chunk boundaries and ignores malformed ones', async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode('event: text\ndata: {"delta":"he')); c.enqueue(enc.encode('llo"}\n\nevent: x\ndata: not-json\n\nevent: done\ndata: {"messageId":"m"}\n\n')); c.close() } })
    const out = []; for await (const e of parseSse(body)) out.push(e)
    expect(out.map((e) => e.type)).toEqual(['text', 'done']); expect(out[0].data).toEqual({ delta: 'hello' })
  })
  it('derives page context, links and suggestions from the route', () => {
    expect(pageContextFor(`/products/${PRODUCT}`)).toEqual({ kind: 'product', id: PRODUCT }); expect(pageContextFor('/products')).toBeNull(); expect(pageContextFor('/products/new')).toBeNull()
    expect(linkFor({ kind: 'product', id: PRODUCT, label: 'x' })).toBe(`/products/${PRODUCT}`); expect(linkFor({ kind: 'weird', id: PRODUCT, label: 'x' })).toBeNull(); expect(linkFor({ kind: 'order', id: '../x', label: 'x' })).toBeNull()
    expect(suggestionsFor(`/products/${PRODUCT}`, true)).toContain('Improve this listing'); expect(suggestionsFor('/', false).some((s) => /draft product/.test(s))).toBe(false)
  })
})
