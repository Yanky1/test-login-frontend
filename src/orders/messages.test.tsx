import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import SellerLayout from '../products/SellerLayout'
import { renderAt, signedIn } from '../test/utils'
import { server } from '../test/server'
import MessagesPage from './Messages'
import NotificationSettings from './NotificationSettings'
import { API, conv, convDetail, mount } from './testkit'

function mockInbox(items = [conv(), conv({ id: 'c2', kind: 'product', orderId: null, orderNumber: null, productId: 'p1', productTitle: 'Blue mug', subject: 'Blue mug', buyerName: 'Sam', unread: false, needsReply: false, preview: 'Is it dishwasher safe?' })], detail = convDetail()) {
  const urls: URL[] = []; const posts: { path: string; body: any }[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  server.use(
    http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme' }])),
    http.get(`${API}/team/members`, () => HttpResponse.json([{ id: 'm1', userId: 'u1', email: 'me@x.com', role: 'Owner', status: 'Active', allBrands: true, brands: [], createdAt: '', lastActiveAt: null, isMe: true }])),
    http.get(`${API}/seller/messages`, ({ request }) => { urls.push(new URL(request.url)); return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 }) }),
    http.get(`${API}/seller/messages/:id`, () => HttpResponse.json(detail)),
    http.get(`${API}/seller/message-templates`, () => HttpResponse.json([{ id: 't1', title: 'Shipping delay', body: 'Your order ships tomorrow.' }])),
    http.post(`${API}/seller/messages/:id/read`, () => new HttpResponse(null, { status: 204 })),
    http.post(`${API}/seller/messages/:id/messages`, async ({ request }) => { const body = await request.json() as any; posts.push({ path: 'reply', body }); return HttpResponse.json({ message: { id: 'm9' } }, { status: 201 }) }), // eslint-disable-line @typescript-eslint/no-explicit-any
    http.post(`${API}/seller/messages/:id/attachments`, () => HttpResponse.json({ id: 'a1', fileName: 'photo.png', contentType: 'image/png', size: 1000 }, { status: 201 })),
    http.post(`${API}/seller/messages/:id/assign`, async ({ request }) => { posts.push({ path: 'assign', body: await request.json() }); return new HttpResponse(null, { status: 204 }) }),
    http.post(`${API}/seller/messages/:id/no-reply-needed`, async ({ request }) => { posts.push({ path: 'noreply', body: await request.json() }); return new HttpResponse(null, { status: 204 }) }),
    http.post(`${API}/seller/messages/:id/notes`, async ({ request }) => { posts.push({ path: 'note', body: await request.json() }); return new HttpResponse(null, { status: 204 }) }),
  )
  return { urls, posts }
}
const open = () => mount(<MessagesPage />, '/messages/:id?', '/messages/c1')

beforeEach(() => { try { sessionStorage.clear() } catch { /* ignore */ } })

describe('messages inbox', () => {
  it('lists order and product conversations with unread and needs-reply markers, and filters hit the API', async () => {
    const { urls } = mockInbox()
    mount(<MessagesPage />, '/messages/:id?', '/messages')
    expect(await screen.findByText('Jane B.')).toBeInTheDocument(); expect(screen.getByText('(unread)', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Order SO-2026-000001 · Acme')).toBeInTheDocument(); expect(screen.getByText('Blue mug · Acme')).toBeInTheDocument()
    expect(screen.getAllByText('Needs reply').length).toBeGreaterThan(1)   // the tab and the chip of the conversation
    expect(screen.getByRole('heading', { name: 'Choose a conversation' })).toBeInTheDocument()
    const last = () => urls.at(-1)!.searchParams
    await userEvent.click(screen.getByRole('tab', { name: 'Unread' })); await waitFor(() => expect(last().get('filter')).toBe('unread'))
    await userEvent.click(screen.getByRole('tab', { name: 'Needs reply' })); await waitFor(() => expect(last().get('filter')).toBe('needs_reply'))
    await userEvent.selectOptions(screen.getByLabelText('About'), 'product'); await waitFor(() => expect(last().get('kind')).toBe('product'))
    await userEvent.click(screen.getByLabelText('Assigned to me')); await waitFor(() => expect(last().get('assignedToMe')).toBe('true'))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search messages' }), 'teapot'); await waitFor(() => expect(last().get('q')).toBe('teapot'))
  })

  it('shows an empty state', async () => {
    mockInbox([])
    mount(<MessagesPage />, '/messages/:id?', '/messages')
    expect(await screen.findByRole('heading', { name: 'No messages yet' })).toBeInTheDocument()
  })
})

describe('conversation', () => {
  it('shows the thread with timestamps, the order card with quick actions, and marks it read', async () => {
    const { posts } = mockInbox(); let read = 0
    server.use(http.post(`${API}/seller/messages/:id/read`, () => { read++; return new HttpResponse(null, { status: 204 }) }))
    open()
    expect(await screen.findByRole('heading', { name: 'Order SO-2026-000001', level: 2 })).toBeInTheDocument()
    const thread = screen.getByRole('list', { name: 'Messages' }); expect(within(thread).getByText('Where is my order?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'SO-2026-000001' })).toHaveAttribute('href', '/orders/o1'); expect(screen.getByRole('link', { name: 'Ship or refund' })).toHaveAttribute('href', '/orders/o1')
    await waitFor(() => expect(read).toBe(1)); expect(posts.length).toBe(0)
  })

  it('sends a reply with a saved template and an image attachment; the draft survives a reload until sent', async () => {
    const { posts } = mockInbox()
    const first = open()
    const box = await screen.findByLabelText('Your reply')
    await userEvent.type(box, 'Hello'); expect(sessionStorage.getItem('solvelt-draft:c1')).toBe('Hello')
    first.unmount()
    open()
    expect(await screen.findByLabelText('Your reply')).toHaveValue('Hello')                       // no lost drafts
    await userEvent.click(screen.getByRole('button', { name: 'Saved replies' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Use/ }))
    expect(screen.getByLabelText('Your reply')).toHaveValue('Hello\nYour order ships tomorrow.')
    await userEvent.upload(screen.getByLabelText('Choose files to attach'), new File([new Uint8Array(10)], 'photo.png', { type: 'image/png' }))
    expect(await screen.findByText('photo.png', { selector: '.chip' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(posts[0]).toMatchObject({ path: 'reply', body: { text: 'Hello\nYour order ships tomorrow.', attachmentIds: ['a1'], acknowledgeWarning: false } }))
    await waitFor(() => expect(sessionStorage.getItem('solvelt-draft:c1')).toBeNull())
  })

  it('warns before sharing contact details and only sends after "Send anyway"; a blocked message explains why and keeps the text', async () => {
    mockInbox(); let mode: 'warn' | 'block' = 'warn'; const acks: boolean[] = []
    server.use(http.post(`${API}/seller/messages/:id/messages`, async ({ request }) => { const b = (await request.json()) as { acknowledgeWarning: boolean }; acks.push(b.acknowledgeWarning)
      if (mode === 'block') return HttpResponse.json({ code: 'contact_details_blocked', title: 'x' }, { status: 422 })
      return b.acknowledgeWarning ? HttpResponse.json({ message: { id: 'm9' } }, { status: 201 }) : HttpResponse.json({ code: 'contact_details_warning', title: 'x', warnings: ['email'] }, { status: 409 }) }))
    open()
    const box = await screen.findByLabelText('Your reply'); await userEvent.type(box, 'mail me a@b.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(await screen.findByText(/shares contact details or a link/)).toBeInTheDocument(); expect(acks).toEqual([false])
    await userEvent.click(screen.getByRole('button', { name: 'Send anyway' })); await waitFor(() => expect(acks).toEqual([false, true]))
    acks.length = 0
    mode = 'block'; await userEvent.type(await screen.findByLabelText('Your reply'), 'call 555-123-4567')
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(await screen.findByText(/can’t include contact details/)).toBeInTheDocument(); expect(screen.getByLabelText('Your reply')).toHaveValue('call 555-123-4567')
  })

  it('rejects an attachment the server refuses with a plain explanation', async () => {
    mockInbox(); server.use(http.post(`${API}/seller/messages/:id/attachments`, () => HttpResponse.json({ code: 'unsupported_type', title: 'x' }, { status: 415 })))
    open()
    await userEvent.upload(await screen.findByLabelText('Choose files to attach'), new File(['<script>'], 'x.png', { type: 'image/png' }))
    expect(await screen.findByText(/Only JPEG, PNG, WebP images and PDF files/)).toBeInTheDocument()
  })

  it('team tools: assign to me, no reply needed, internal notes', async () => {
    const { posts } = mockInbox()
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Assign to me' })); await waitFor(() => expect(posts.find((p) => p.path === 'assign')?.body).toEqual({ userId: 'u1' }))
    await userEvent.click(screen.getByLabelText('No reply needed')); await waitFor(() => expect(posts.find((p) => p.path === 'noreply')?.body).toEqual({ value: true }))
    await userEvent.type(screen.getByLabelText('Add a note'), 'Buyer called'); await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(posts.find((p) => p.path === 'note')?.body).toEqual({ text: 'Buyer called' }))
  })

  it('shows overdue and reported flags, delivery status of my replies, and a product card for pre-sale questions', async () => {
    const d = convDetail({ order: null, product: { id: 'p1', title: 'Blue mug', sku: 'MUG-1', priceCents: 1000, status: 'Active' }, messages: [
      { id: 'm1', direction: 'buyer', text: 'Is it dishwasher safe?', createdAt: '2026-11-01T10:00:00Z', delivery: 'delivered', author: null, authorId: null, contactWarning: false, reported: false, respondedAt: null, attachments: [] },
      { id: 'm2', direction: 'seller', text: 'Yes!', createdAt: '2026-11-01T11:00:00Z', delivery: 'read', author: 'me@x.com', authorId: 'u1', contactWarning: false, reported: false, respondedAt: null, attachments: [{ id: 'a1', fileName: 'care.pdf', contentType: 'application/pdf', size: 2048 }] }] },
    { kind: 'product', overdue: true, flagged: true, subject: 'Blue mug' })
    mockInbox(undefined, d)
    open()
    expect(await screen.findByText('Reply overdue')).toBeInTheDocument(); expect(screen.getByText('Reported by the buyer')).toBeInTheDocument()
    expect(screen.getByText(/· Read/)).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Blue mug', exact: true })).toHaveAttribute('href', '/products/p1')
    expect(screen.getByRole('button', { name: /care\.pdf/ })).toBeInTheDocument()
  })

  it('a Viewer can read but not reply, assign or annotate', async () => {
    mockInbox(undefined, convDetail({ canWrite: false }))
    mount(<MessagesPage />, '/messages/:id?', '/messages/c1', { activeAccountId: 'a1', role: 'Viewer', accounts: [{ sellerId: 'a1', vendorName: 'Acme', role: 'Viewer', accountStatus: 'Approved', brandCount: 1 }] })
    expect(await screen.findByText('You can read this conversation but not reply.')).toBeInTheDocument()
    for (const n of ['Send reply', 'Assign to me', 'Add note']) expect(screen.queryByRole('button', { name: n })).toBeNull()
  })

  it('a conversation the member cannot see shows a plain not-found card', async () => {
    mockInbox(); server.use(http.get(`${API}/seller/messages/:id`, () => HttpResponse.json({ title: 'Not Found' }, { status: 404 })))
    open()
    expect(await screen.findByRole('heading', { name: 'Conversation not found' })).toBeInTheDocument()
  })
})

describe('sidebar badges and notification settings', () => {
  it('Orders and Messages are in the seller sidebar with badges for what needs attention', async () => {
    server.use(http.get(`${API}/seller/orders/counts`, () => HttpResponse.json({ needsAction: 5, pending: 2, shipped: 0, delivered: 0, cancelled: 0, returns: 0, late: 0, all: 5 })),
      http.get(`${API}/seller/messages/counts`, () => HttpResponse.json({ unread: 2, needsReply: 2, overdue: 0, all: 3 })))
    signedIn()
    renderAt(<Routes><Route element={<SellerLayout />}><Route path="/orders" element={<h1>Orders page</h1>} /></Route></Routes>, '/orders')
    expect(await screen.findByRole('link', { name: 'Orders, 5 need action' })).toHaveAttribute('href', '/orders')
    expect(screen.getByRole('link', { name: 'Messages, 2 unread' })).toHaveAttribute('href', '/messages')
    expect(screen.getByRole('link', { name: /^Orders/ })).toHaveAttribute('aria-current', 'page')
  })

  it('notification preferences load, save on change and roll back with a message if saving fails', async () => {
    let saved: unknown = null; let fail = false
    server.use(http.get(`${API}/seller/notification-preferences`, () => HttpResponse.json({ newOrder: true, cancelRequest: true, returnRequest: true, buyerMessage: true, overdueReply: false })),
      http.put(`${API}/seller/notification-preferences`, async ({ request }) => { if (fail) return HttpResponse.json({ title: 'Server error' }, { status: 500 }); saved = await request.json(); return HttpResponse.json({ newOrder: true, cancelRequest: true, returnRequest: true, buyerMessage: false, overdueReply: false }) }))
    mount(<NotificationSettings />, '/settings/notifications')
    const sw = await screen.findByRole('switch', { name: 'Buyer messages' }); expect(sw).toBeChecked(); expect(screen.getByRole('switch', { name: 'Overdue replies' })).not.toBeChecked()
    await userEvent.click(sw); await waitFor(() => expect(saved).toEqual({ buyerMessage: false })); expect(await screen.findByText('Saved.')).toBeInTheDocument()
    fail = true; await userEvent.click(screen.getByRole('switch', { name: 'New orders' }))
    expect(await screen.findByText('Server error')).toBeInTheDocument(); expect(screen.getByRole('switch', { name: 'New orders' })).toBeChecked()
  })
})
