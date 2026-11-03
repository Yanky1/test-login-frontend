import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '../auth'
import { server } from '../test/server'
import { DRAFT_PREFIX } from '../lib/drafts'
import MessagesPage from './Messages'
import OrderDetailPage from './OrderDetail'
import OrdersListPage from './OrdersList'
import { emitLiveForTest } from './live'
import { localDate } from './format'
import { ACTIONS, API, conv, convDetail, item, mount, mockOrder, order } from './testkit'

const delivered = (actions = {}) => order({ status: 'Delivered', actions: { ...ACTIONS, refund: true, ...actions }, lines: order().lines.map((l) => ({ ...l, shippedQty: l.quantity, unshippedQty: 0 })) })
const manager = { activeAccountId: 'a1', role: 'Manager', accounts: [{ sellerId: 'a1', vendorName: 'Acme', role: 'Manager', accountStatus: 'Approved', brandCount: 1 }] }

describe('review: refund preview and confirmation', () => {
  it('ignores a stale preview that arrives late: the total shown and the amount sent are the latest quantity', async () => {
    const m = mockOrder(delivered())
    server.use(http.post(`${API}/seller/orders/:id/refunds/preview`, async ({ request }) => {
      const b = (await request.json()) as { lines: { quantity: number }[]; shippingCents: number }; const qty = b.lines.reduce((n, l) => n + l.quantity, 0)
      if (qty === 1) await new Promise((r) => setTimeout(r, 400))        // the older request is the slowest
      return HttpResponse.json({ amountCents: qty * 1080 + b.shippingCents, shippingCents: b.shippingCents, maxCents: 4820, lines: [] })
    }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Issue a refund…' }))
    const dlg = await screen.findByRole('dialog', { name: /Refund order/ })
    const q = within(dlg).getByLabelText('Refund quantity of Blue mug')
    await userEvent.clear(q); await userEvent.type(q, '1')
    await new Promise((r) => setTimeout(r, 350))                           // the quantity-1 preview request is now in flight (and slow)
    await userEvent.clear(q); await userEvent.type(q, '3')
    await userEvent.selectOptions(within(dlg).getByLabelText('Reason'), 'goodwill')
    expect(await within(dlg).findByText('$32.40')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 600))                           // the stale $10.80 response has now arrived
    expect(within(dlg).queryByText('$10.80')).toBeNull(); expect(within(dlg).getByText('$32.40')).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Review refund' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, refund $32.40' }))
    await waitFor(() => expect(m.calls[0].body).toMatchObject({ lines: [{ lineId: 'l1', quantity: 3 }] }))
  })

  it('re-checks the amount when you confirm: the Manager limit cannot be bypassed with an old preview', async () => {
    mockOrder(delivered({ refundLimitCents: 1500 }))
    let armed = false
    server.use(http.post(`${API}/seller/orders/:id/refunds/preview`, () => HttpResponse.json({ amountCents: armed ? 3240 : 1080, shippingCents: 0, maxCents: 4820, lines: [] })))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1', manager)
    await userEvent.click(await screen.findByRole('button', { name: 'Issue a refund…' }))
    const dlg = await screen.findByRole('dialog', { name: /Refund order/ })
    const q = within(dlg).getByLabelText('Refund quantity of Blue mug'); await userEvent.clear(q); await userEvent.type(q, '1')
    await userEvent.selectOptions(within(dlg).getByLabelText('Reason'), 'goodwill')
    expect(await within(dlg).findByText('$10.80')).toBeInTheDocument()
    armed = true                                                            // the server now prices the same request higher
    await userEvent.click(within(dlg).getByRole('button', { name: 'Review refund' }))
    expect(await within(dlg).findByText(/up to \$15\.00 at a time/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Refund this amount?' })).toBeNull()
  })
})

describe('review: live reloads and conflicts', () => {
  it('queues a live reload while a dialog is open and runs it when the dialog closes', async () => {
    const o = order(); mockOrder(o)
    let gets = 0; server.use(http.get(`${API}/seller/orders/:id`, () => { gets++; return HttpResponse.json(o) }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel order…' }))
    const dlg = await screen.findByRole('dialog', { name: /Cancel order/ }); const before = gets
    act(() => emitLiveForTest('order.changed'))
    await new Promise((r) => setTimeout(r, 700)); expect(gets).toBe(before)       // not while the dialog is open
    await userEvent.click(within(dlg).getByRole('button', { name: 'Keep order' }))
    await waitFor(() => expect(gets).toBeGreaterThan(before))
  })

  it('a version conflict offers a Reload order button that keeps the dialog open', async () => {
    const o = order(); mockOrder(o)
    server.use(http.post(`${API}/seller/orders/:id/cancel`, () => HttpResponse.json({ code: 'version_conflict', title: 'Changed' }, { status: 409 })))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel order…' }))
    const dlg = await screen.findByRole('dialog', { name: /Cancel order/ })
    await userEvent.selectOptions(within(dlg).getByLabelText('Reason'), 'other'); await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel order' }))
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Reload order' }))
    await waitFor(() => expect(within(dlg).queryByRole('button', { name: 'Reload order' })).toBeNull())
    expect(screen.getByRole('dialog', { name: /Cancel order/ })).toBeInTheDocument()
  })

  it('defaults the ship date to the local date, not UTC', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 3, 23, 30))   // 23:30 local on 3 Nov
    try { expect(localDate()).toBe('2026-11-03') } finally { vi.useRealTimers() }
  })
})

describe('review: messages', () => {
  const inbox = (detail = convDetail(), extra: () => void = () => undefined) => {
    server.use(
      http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme' }])),
      http.get(`${API}/seller/messages`, ({ request }) => { extra(); const p = Number(new URL(request.url).searchParams.get('page') ?? 1); return HttpResponse.json({ items: [conv({ id: `c${p}`, buyerName: `Buyer page ${p}` })], total: 120, page: p, pageSize: 50 }) }),
      http.get(`${API}/seller/messages/:id`, () => HttpResponse.json(detail)),
      http.get(`${API}/seller/message-templates`, () => HttpResponse.json([{ id: 't1', title: 'Delay', body: 'Late.' }])),
      http.post(`${API}/seller/messages/:id/read`, () => new HttpResponse(null, { status: 204 })),
    )
  }

  it('announces a new buyer message in a polite live region', async () => {
    let d = convDetail(); inbox(d)
    server.use(http.get(`${API}/seller/messages/:id`, () => HttpResponse.json(d)))
    mount(<MessagesPage />, '/messages/:id?', '/messages/c1')
    await screen.findByRole('list', { name: 'Messages' })
    const live = document.querySelector('[role="status"][aria-live="polite"]')!; expect(live).toBeTruthy(); expect(live.textContent).toBe('')
    d = convDetail({ messages: [...d.messages, { ...d.messages[0], id: 'm2', text: 'Hello?' }] })
    act(() => emitLiveForTest('message.new'))
    await waitFor(() => expect(live.textContent).toBe('New message from Jane B.'))
  })

  it('shows an error when assigning fails, instead of failing silently', async () => {
    inbox(); server.use(http.post(`${API}/seller/messages/:id/assign`, () => HttpResponse.json({ title: 'That person can’t be assigned.' }, { status: 422 })))
    mount(<MessagesPage />, '/messages/:id?', '/messages/c1')
    await userEvent.click(await screen.findByRole('button', { name: 'Assign to me' }))
    expect(await screen.findByText(/can’t be assigned|Could not/)).toBeInTheDocument()
  })

  it('a Manager can assign to themselves (the server supplies who they are)', async () => {
    inbox(convDetail({ me: 'u9', assignees: [{ userId: 'u9', name: 'mgr@x.com', isMe: true }] })); let body: unknown
    server.use(http.post(`${API}/seller/messages/:id/assign`, async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }) }))
    mount(<MessagesPage />, '/messages/:id?', '/messages/c1', manager)
    await userEvent.click(await screen.findByRole('button', { name: 'Assign to me' }))
    await waitFor(() => expect(body).toEqual({ userId: 'u9' }))
  })

  it('deleting a saved reply asks first and shows a failure', async () => {
    inbox(); let deleted = 0
    server.use(http.delete(`${API}/seller/message-templates/:id`, () => { deleted++; return HttpResponse.json({ title: 'x' }, { status: 500 }) }))
    mount(<MessagesPage />, '/messages/:id?', '/messages/c1')
    await userEvent.click(await screen.findByRole('button', { name: 'Saved replies' }))
    const dlg = await screen.findByRole('dialog', { name: 'Saved replies' })
    await userEvent.click(await within(dlg).findByRole('button', { name: /^Delete/ })); expect(deleted).toBe(0)
    const confirm = await screen.findByRole('dialog', { name: 'Delete this saved reply?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete reply' }))
    await waitFor(() => expect(deleted).toBe(1)); expect(await within(confirm).findByRole('alert')).toBeInTheDocument()
  })

  it('opens only real images inline; anything else is downloaded; object URLs are revoked', async () => {
    const att = (id: string, contentType: string, fileName: string) => ({ id, fileName, contentType, size: 100 })
    inbox(convDetail({ messages: [{ ...convDetail().messages[0], attachments: [att('a1', 'image/png', 'real.png'), att('a2', 'image/png', 'fake.png'), att('a3', 'application/pdf', 'doc.pdf')] }] }))
    server.use(http.get(`${API}/seller/messages/:id/attachments/:aid`, ({ params }) => new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': params.aid === 'a2' ? 'text/html' : params.aid === 'a3' ? 'application/pdf' : 'image/png' } })))
    const open = vi.spyOn(window, 'open').mockReturnValue(null); const revoke = vi.fn(); let n = 0; URL.createObjectURL = vi.fn(() => `blob:u${++n}`); URL.revokeObjectURL = revoke
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount(<MessagesPage />, '/messages/:id?', '/messages/c1')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await user.click(await screen.findByRole('button', { name: 'real.png' })); await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
      await user.click(screen.getByRole('button', { name: 'fake.png' })); await user.click(screen.getByRole('button', { name: /doc\.pdf/ }))
      await act(async () => { await vi.advanceTimersByTimeAsync(100) }); expect(open).toHaveBeenCalledTimes(1)   // spoofed type + PDF never open in a tab
      await act(async () => { await vi.advanceTimersByTimeAsync(61_000) }); expect(revoke).toHaveBeenCalledWith(open.mock.calls[0][0])
    } finally { vi.useRealTimers(); open.mockRestore() }
  })

  it('warns client-side about files over 5 MB', async () => {
    inbox(); mount(<MessagesPage />, '/messages/:id?', '/messages/c1')
    const input = await screen.findByLabelText('Choose files to attach')
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' })] } })
    expect(await screen.findByText(/big\.png is larger than 5 MB/)).toBeInTheDocument()
  })

  it('paginates the inbox', async () => {
    inbox(); mount(<MessagesPage />, '/messages/:id?', '/messages')
    expect(await screen.findByText('Buyer page 1')).toBeInTheDocument(); expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Buyer page 2')).toBeInTheDocument()
  })
})

describe('review: tabs, badge and drafts', () => {
  it('order and message tabs follow the ARIA tabs pattern: arrow keys move, aria-controls points at the panel', async () => {
    server.use(
      http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme' }])),
      http.get(`${API}/seller/orders/counts`, () => HttpResponse.json({ needsAction: 3, pending: 2, shipped: 1, delivered: 4, cancelled: 0, returns: 1, late: 1, all: 11 })),
      http.get(`${API}/seller/orders/dashboard`, () => HttpResponse.json({ todayOrders: 0, toShip: 0, late: 0, returnsOpen: 0, sales30Cents: 0, orders30: 0, daily: [], lateShipmentRate: 0, cancellationRate: 0 })),
      http.get(`${API}/seller/orders`, () => HttpResponse.json({ items: [item()], total: 1, page: 1, pageSize: 25 })),
    )
    mount(<OrdersListPage />, '/orders', '/orders')
    const tabs = await screen.findAllByRole('tab'); const first = tabs[0]
    expect(first).toHaveAttribute('aria-selected', 'true'); expect(first).toHaveAttribute('tabindex', '0'); expect(tabs[1]).toHaveAttribute('tabindex', '-1')
    const panel = screen.getByRole('tabpanel'); expect(first.getAttribute('aria-controls')).toBe(panel.id); expect(panel).toHaveAttribute('aria-labelledby', first.id)
    first.focus(); await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true')); expect(screen.getAllByRole('tab')[1]).toHaveFocus()
    await userEvent.keyboard('{End}'); expect(screen.getAllByRole('tab').at(-1)).toHaveAttribute('aria-selected', 'true')
  })

  it('clears message drafts on logout', async () => {
    sessionStorage.setItem(`${DRAFT_PREFIX}c1`, 'secret draft'); sessionStorage.setItem('keep', '1')
    server.use(http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })))
    function Out() { const { logout, status } = useAuth(); useEffect(() => { if (status === 'authed') void logout() }, [status, logout]); return null }
    mount(<Out />, '/')
    await waitFor(() => expect(sessionStorage.getItem(`${DRAFT_PREFIX}c1`)).toBeNull()); expect(sessionStorage.getItem('keep')).toBe('1')
  })
})
