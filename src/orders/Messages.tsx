import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { ConfirmDialog } from './Dialogs'
import { TabList, tabPanelProps } from './tabs'
import { useBrands } from '../pages/teams/BrandContext'
import { AuthImage } from '../products/AuthImage'
import { fetchBlob, saveBlob } from '../products/api'
import { AreaField, Dialog, PIcon, SelectField, TextField } from '../products/ui'
import { useCanWrite } from '../products/usePermissions'
import { messagesApi, type Attachment, type ConversationDetail, type ConversationItem, type MessageTemplate } from './api'
import { dt, money, statusLabel } from './format'
import { useLiveReload } from './live'
import './orders.css'

const FILTERS: [string, string][] = [['all', 'All'], ['unread', 'Unread'], ['needs_reply', 'Needs reply'], ['overdue', 'Overdue']]
const draftKey = (id: string) => `solvelt-draft:${id}`
const readDraft = (id: string) => { try { return sessionStorage.getItem(draftKey(id)) ?? '' } catch { return '' } }
const writeDraft = (id: string, v: string) => { try { if (v) sessionStorage.setItem(draftKey(id), v); else sessionStorage.removeItem(draftKey(id)) } catch { /* private mode: the draft just isn't kept */ } }

const MAX_BYTES = 5 * 1024 * 1024; const MAX_FILES = 5
const INLINE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
function AttachmentChip({ convId, a }: { convId: string; a: Attachment }) {
  const path = messagesApi.attachmentPath(convId, a.id)
  const open = async () => {
    try {
      const b = await fetchBlob(path)
      // Only real images (the declared type AND the downloaded blob agree) open in a tab; everything else is saved as a file, never rendered.
      if (INLINE_TYPES.includes(a.contentType) && b.type === a.contentType) {
        const url = URL.createObjectURL(b); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } else saveBlob(b, a.fileName)
    } catch { /* the thread shows the file name either way */ }
  }
  return (
    <li>
      {a.contentType.startsWith('image/') ? <button type="button" className="btn link" onClick={() => void open()}><AuthImage src={path} alt={a.fileName} className="pthumb" /></button>
        : <Button onClick={() => void open()}><PIcon name="download" /> {a.fileName}<span className="sr-only"> (PDF, {Math.round(a.size / 1024)} KB)</span></Button>}
    </li>
  )
}

function Templates({ onPick, onClose }: { onPick: (b: string) => void; onClose: () => void }) {
  const [list, setList] = useState<MessageTemplate[]>([]); const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [error, setError] = useState('')
  const [del, setDel] = useState<MessageTemplate | null>(null)
  const load = useCallback(() => messagesApi.templates().then(setList).catch(() => setError('Could not load your saved replies.')), [])
  useEffect(() => { void load() }, [load])
  return (
    <Dialog title="Saved replies" onClose={onClose} wide>
      {list.length === 0 && <p>You have no saved replies yet. Add one below for the answers you give often.</p>}
      <ul className="plain">{list.map((t) => <li key={t.id}><strong>{t.title}</strong><p className="sub">{t.body}</p><div className="actions"><Button variant="primary" onClick={() => { onPick(t.body); onClose() }}>Use<span className="sr-only"> {t.title}</span></Button><Button variant="destructive" onClick={() => setDel(t)}>Delete<span className="sr-only"> {t.title}</span></Button></div></li>)}</ul>
      <form onSubmit={async (e) => { e.preventDefault(); try { await messagesApi.addTemplate(title.trim(), body.trim()); setTitle(''); setBody(''); setError(''); await load() } catch (x) { setError(x instanceof ApiError ? (Object.values(x.fieldErrors())[0] ?? x.message2) : 'Could not save.') } }}>
        <TextField label="Title" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        <AreaField label="Reply text" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
        <Alert>{error}</Alert>
        <div className="actions"><Button type="submit" variant="primary" disabled={!title.trim() || !body.trim()}>Save reply</Button><Button type="button" variant="ghost" onClick={onClose}>Close</Button></div>
      </form>
      {del && <ConfirmDialog title="Delete this saved reply?" confirm="Delete reply" destructive onClose={() => setDel(null)} body={<p>“{del.title}” will be removed for everyone on your team.</p>}
        onConfirm={async () => { await messagesApi.deleteTemplate(del.id); setDel(null); setError(''); await load() }} />}
    </Dialog>
  )
}

function Conversation({ id, onChanged }: { id: string; onChanged: () => void }) {
  const canWriteRole = useCanWrite()
  const [d, setD] = useState<ConversationDetail | null>(null); const [error, setError] = useState(''); const [gone, setGone] = useState(false)
  const [text, setText] = useState(() => readDraft(id)); const [atts, setAtts] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false); const [sendErr, setSendErr] = useState(''); const [warn, setWarn] = useState<string[] | null>(null); const [tpl, setTpl] = useState(false)
  const [note, setNote] = useState(''); const [actionErr, setActionErr] = useState(''); const [announce, setAnnounce] = useState(''); const seen = useRef<{ id: string; n: number } | null>(null); const file = useRef<HTMLInputElement>(null); const end = useRef<HTMLLIElement>(null)
  const load = useCallback(async () => {
    try {
      const r = await messagesApi.get(id); setD(r); setError('')
      const buyer = r.messages.filter((m) => m.direction === 'buyer').length
      if (seen.current && seen.current.id === id && buyer > seen.current.n) setAnnounce(`New message from ${r.conversation.buyerName}`)
      seen.current = { id, n: buyer }
 if (r.conversation.unread) { void messagesApi.read(id).then(onChanged).catch(() => undefined) } }
    catch (e) { if (e instanceof ApiError && e.status === 404) setGone(true); else setError(e instanceof ApiError ? e.message2 : 'Could not load this conversation.') }
  }, [id, onChanged])
  useEffect(() => { setD(null); setGone(false); setText(readDraft(id)); setAtts([]); setWarn(null); setActionErr(''); setAnnounce(''); seen.current = null; void load() }, [id, load])
  useLiveReload(['message.new', 'message.status'], () => void load())
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }) }, [d?.messages.length])
  const edit = (v: string) => { setText(v); writeDraft(id, v); setWarn(null) }

  if (gone) return <section className="pcard"><h2>Conversation not found</h2><p>It doesn’t exist, or you don’t have access to it.</p></section>
  if (!d) return <section className="pcard" aria-busy="true" aria-label="Loading conversation"><Alert>{error}</Alert></section>
  const c = d.conversation; const canWrite = canWriteRole && d.canWrite && !c.redacted
  const send = async (ack: boolean) => {
    setBusy(true); setSendErr('')
    try {
      await messagesApi.reply(id, text.trim(), atts.map((a) => a.id), ack)
      setText(''); writeDraft(id, ''); setAtts([]); setWarn(null); await load(); onChanged()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'contact_details_warning') setWarn(e.body?.warnings ?? [])
      else if (e instanceof ApiError && e.code === 'contact_details_blocked') setSendErr('Messages can’t include contact details, links or payment instructions. Keep the conversation on Solvelt.')
      else setSendErr(e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message2) : 'Could not send. Your message is still here.')
    } finally { setBusy(false) }
  }
  const upload = async (files: FileList | null) => {
    if (!files) return
    let count = atts.length                       // already attached + the ones added in this pick (state doesn't update inside the loop)
    for (const f of Array.from(files)) {
      if (f.size > MAX_BYTES) { setSendErr(`${f.name} is larger than 5 MB.`); continue }
      if (count >= MAX_FILES) { setSendErr('You can attach up to 5 files to a reply.'); break }
      try { const a = await messagesApi.upload(id, f); count++; setAtts((x) => [...x, a]) } catch (e) { setSendErr(e instanceof ApiError ? (e.status === 415 ? 'Only JPEG, PNG, WebP images and PDF files can be attached.' : e.message2) : 'Could not attach that file.') }
    }
    if (file.current) file.current.value = ''
  }
  const act = async (fn: () => Promise<unknown>, fail: string) => {
    setActionErr('')
    try { await fn(); await load(); onChanged() } catch (e) { setActionErr(e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message2) : fail) }
  }
  const me = d.me
  return (
    <div className="conv-pane">
      <section className="pcard" aria-labelledby="conv-h">
        <header className="plist-head">
          <div><h2 id="conv-h">{c.subject}</h2><p className="sub">{c.buyerName} · {c.kind === 'order' ? 'About an order' : 'Question about a product'} · {c.brandName}</p></div>
          <div className="chips-row">{c.flagged && <span className="chip bad">Reported by the buyer</span>}{c.overdue && <span className="chip bad">Reply overdue</span>}{c.needsReply && !c.overdue && <span className="chip warn">Needs reply</span>}{c.noReplyNeeded && <span className="chip">No reply needed</span>}</div>
        </header>
        <Alert>{error}</Alert>
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
        <ul className="thread" aria-label="Messages">
          {d.messages.map((m) => (
            <li key={m.id} className={`bubble ${m.direction}`}>
              <strong className="sr-only">{m.direction === 'seller' ? 'You' : c.buyerName}: </strong>{m.text}
              {m.attachments.length > 0 && <ul className="attach-list">{m.attachments.map((a) => <AttachmentChip key={a.id} convId={id} a={a} />)}</ul>}
              <span className="meta">{m.direction === 'seller' ? `${m.author ?? 'Your team'} · ` : ''}{dt(m.createdAt)}{m.direction === 'seller' && <> · {m.delivery === 'read' ? 'Read' : m.delivery === 'delivered' ? 'Delivered' : m.delivery === 'failed' ? 'Not delivered' : 'Sending'}</>}{m.contactWarning && ' · contained contact details'}</span>
            </li>
          ))}
          <li ref={end} aria-hidden="true" />
        </ul>
        {canWrite ? (
          <form className="composer" onSubmit={(e) => { e.preventDefault(); if (text.trim() || atts.length) void send(false) }}>
            <AreaField label="Your reply" rows={4} maxLength={4000} value={text} onChange={(e) => edit(e.target.value)} hint="Keep the conversation on Solvelt: don’t share emails, phone numbers or payment links. Reply within 24 hours. Attach up to 5 files, 5 MB each." />
            {atts.length > 0 && <ul className="attach-list" aria-label="Attached files">{atts.map((a) => <li key={a.id}><span className="chip">{a.fileName}</span> <button type="button" className="btn link" onClick={() => void messagesApi.removeAttachment(id, a.id).then(() => setAtts((x) => x.filter((y) => y.id !== a.id))).catch(() => setSendErr('Could not remove that file.'))}>Remove<span className="sr-only"> {a.fileName}</span></button></li>)}</ul>}
            {warn && <Alert kind="info">This message looks like it shares {warn.includes('payment') ? 'payment details' : 'contact details or a link'}. Sharing them outside Solvelt is against marketplace rules, and we keep a record. <Button type="button" onClick={() => void send(true)}>Send anyway</Button></Alert>}
            <Alert>{sendErr}</Alert>
            <div className="actions">
              <Button variant="primary" type="submit" loading={busy} disabled={!text.trim() && atts.length === 0}>Send reply</Button>
              <Button type="button" onClick={() => file.current?.click()}><PIcon name="image" /> Attach a photo or PDF</Button>
              <input ref={file} type="file" className="sr-only" tabIndex={-1} aria-label="Choose files to attach" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => void upload(e.target.files)} />
              <Button type="button" variant="ghost" onClick={() => setTpl(true)}>Saved replies</Button>
            </div>
          </form>
        ) : <p className="sub">{c.redacted ? 'This conversation was archived after the retention period.' : 'You can read this conversation but not reply.'}</p>}
      </section>

      <aside className="conv-side" aria-label="Conversation details">
        {d.order && <section className="pcard"><h3>Order</h3><p><Link to={`/orders/${d.order.id}`}>{d.order.number}</Link> · {statusLabel(d.order.status)}</p><p className="sub">{money(d.order.totalCents, d.order.currency)} · placed {dt(d.order.placedAt)}</p>
          <div className="actions"><Link className="btn" to={`/orders/${d.order.id}`}>Ship or refund</Link></div></section>}
        {d.product && <section className="pcard"><h3>Product</h3><p><Link to={`/products/${d.product.id}`}>{d.product.title}</Link></p><p className="sub">{d.product.sku ?? 'No SKU'} · {d.product.status}</p></section>}
        {canWrite && (
          <section className="pcard">
            <h3>Team</h3>
            <p className="sub">Assigned to: {c.assignedTo ?? 'nobody'}</p>
            <div className="actions">
              {d.assignees.length > 0 ? <SelectField label="Assign to" value={c.assignedUserId ?? ''} onChange={(e) => void act(() => messagesApi.assign(id, e.target.value || null), 'Could not assign this conversation.')}><option value="">Nobody</option>{d.assignees.map((m) => <option key={m.userId} value={m.userId}>{m.isMe ? 'Me' : m.name}</option>)}</SelectField>
                : <p className="sub">Ask an Admin to assign this conversation.</p>}
              {me && c.assignedUserId !== me && <Button onClick={() => void act(() => messagesApi.assign(id, me), 'Could not assign this conversation.')}>Assign to me</Button>}
            </div>
            <div className="field check"><label><input type="checkbox" checked={c.noReplyNeeded} onChange={(e) => void act(() => messagesApi.noReply(id, e.target.checked), 'Could not update this conversation.')} /> No reply needed</label></div>
            <Alert>{actionErr}</Alert>
          </section>
        )}
        <section className="pcard">
          <h3>Internal notes</h3><p className="sub">Only your team sees these. The buyer never does.</p>
          <ul className="plain">{d.notes.map((n) => <li key={n.id}><p>{n.text}</p><p className="sub">{n.author} · {dt(n.createdAt)}</p></li>)}</ul>
          {canWrite && <form onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await act(async () => { await messagesApi.note(id, note.trim()); setNote('') }, 'Could not add the note.') }}>
            <AreaField label="Add a note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /><Button type="submit" disabled={!note.trim()}>Add note</Button></form>}
        </section>
      </aside>
      {tpl && <Templates onPick={(b) => edit(text ? `${text}\n${b}` : b)} onClose={() => setTpl(false)} />}
    </div>
  )
}

export default function MessagesPage() {
  const { id } = useParams(); const nav = useNavigate()
  const { selected } = useBrands(); const brandId = selected === 'all' ? '' : selected
  const [sp, setSp] = useSearchParams()
  const filter = sp.get('filter') ?? 'all'; const kind = sp.get('kind') ?? ''; const mine = sp.get('mine') === '1'; const q = sp.get('q') ?? ''
  const [search, setSearch] = useState(q)
  const page = Math.max(1, Number(sp.get('page')) || 1); const [total, setTotal] = useState(0); const PAGE = 50
  const [items, setItems] = useState<ConversationItem[] | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const set = (o: Record<string, string>) => { const n = new URLSearchParams(sp); if (!('page' in o)) n.delete('page'); for (const [k, v] of Object.entries(o)) { if (v) n.set(k, v); else n.delete(k) } setSp(n, { replace: true }) }
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const r = await messagesApi.list({ filter, kind, brandId, assignedToMe: mine, q, page, pageSize: PAGE }); setItems(r.items); setTotal(r.total) } catch (e) { setError(e instanceof ApiError ? e.message2 : 'Could not load your messages.') } finally { setLoading(false) }
  }, [filter, kind, brandId, mine, q, page])
  useEffect(() => { void load() }, [load])
  useLiveReload(['message.new', 'message.status', 'message.overdue'], () => void load())
  useEffect(() => { const t = setTimeout(() => { if (search !== q) set({ q: search }) }, 350); return () => clearTimeout(t) }, [search]) // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => void load(), [load])
  return (
    <main className="pwrap" aria-labelledby="page-title">
      <h1 id="page-title" tabIndex={-1}>Messages</h1>
      <p className="lead">Questions from buyers about their orders and your products. Replying within 24 hours keeps your response rating high.</p>
      <div className={`msg-layout${id ? ' has-open' : ''}`}>
        <section className="conv-list-pane" aria-label="Conversations">
          <TabList label="Filter conversations" idPrefix="mtab" value={filter} onChange={(k) => set({ filter: k === 'all' ? '' : k })} tabs={FILTERS.map(([id, label]) => ({ id, label }))} />
          <div className="filters">
            <div className="field search"><label className="sr-only" htmlFor="msg-search">Search messages</label><PIcon name="search" /><input id="msg-search" type="search" role="searchbox" aria-label="Search messages" placeholder="Buyer, order or words" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <SelectField label="About" value={kind} onChange={(e) => set({ kind: e.target.value })}><option value="">Orders and products</option><option value="order">Orders</option><option value="product">Products (before buying)</option></SelectField>
            <div className="field check"><label><input type="checkbox" checked={mine} onChange={(e) => set({ mine: e.target.checked ? '1' : '' })} /> Assigned to me</label></div>
          </div>
          <Alert>{error}</Alert>
          <div {...tabPanelProps('mtab', filter)}>
          {loading && !items && <div className="skel-table" aria-busy="true" aria-label="Loading conversations">{[0, 1, 2].map((i) => <div key={i} className="skeleton row-sk" />)}</div>}
          {items && items.length === 0 && !loading && <div className="pempty"><PIcon name="msg" /><h2>{filter === 'all' && !q ? 'No messages yet' : "You're all caught up"}</h2><p>Messages from buyers will appear here.</p></div>}
          <ul className="conv-list">
            {items?.map((c) => (
              <li key={c.id}>
                <Link to={`/messages/${c.id}${sp.toString() ? `?${sp}` : ''}`} className={`conv-item${c.unread ? ' unread' : ''}`} aria-current={id === c.id ? 'true' : undefined}>
                  <span className="row"><strong>{c.unread && <span className="dot-unread" aria-hidden="true" />}{c.buyerName}{c.unread && <span className="sr-only"> (unread)</span>}</strong><span className="sub">{dt(c.lastMessageAt)}</span></span>
                  <span className="sub">{c.kind === 'order' ? `Order ${c.orderNumber ?? ''}` : c.subject} · {c.brandName}</span>
                  <span className="prev">{c.preview}</span>
                  <span className="chips-row">{c.overdue && <span className="chip bad">Overdue</span>}{c.needsReply && !c.overdue && <span className="chip warn">Needs reply</span>}{c.flagged && <span className="chip bad">Reported</span>}{c.assignedTo && <span className="chip">{c.assignedTo}</span>}</span>
                </Link>
              </li>
            ))}
          </ul>
          {total > PAGE && <nav className="pager" aria-label="Pages"><Button disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Previous</Button><span>Page {page} of {Math.ceil(total / PAGE)}</span><Button disabled={page >= Math.ceil(total / PAGE)} onClick={() => set({ page: String(page + 1) })}>Next</Button></nav>}
          </div>
        </section>
        {id ? <div>{<p className="crumb sub"><button type="button" className="btn link" onClick={() => nav(`/messages${sp.toString() ? `?${sp}` : ''}`)}>← All conversations</button></p>}<Conversation id={id} onChanged={reload} /></div>
          : <section className="conv-pane pempty" aria-label="No conversation selected"><PIcon name="msg" /><h2>Choose a conversation</h2><p>Pick one from the list to read it and reply.</p></section>}
      </div>
    </main>
  )
}
