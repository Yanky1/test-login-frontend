import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { Alert, Button, Skeleton } from '../components/ui'
import { PIcon } from '../products/ui'
import { MessageView } from './MessageView'
import { suggestionsFor } from './routes'
import { useAssistant } from './context'
import './assistant.css'

const useNarrow = () => {
  const q = typeof matchMedia === 'function' ? matchMedia('(max-width: 700px)') : null
  const [n, setN] = useState(q?.matches ?? false)
  useEffect(() => { if (!q) return; const f = () => setN(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f) }, [q])
  return n
}

/** Header entry point. Hidden while the feature is off (or the server doesn't have it). */
export function AssistantButton() {
  const { config, open, setOpen } = useAssistant()
  if (!config?.enabled) return null
  return (
    <button type="button" className="btn as-open" aria-expanded={open} aria-controls="assistant-panel" onClick={() => setOpen(!open)} id="assistant-button">
      <PIcon name="star" /> Assistant
    </button>
  )
}

export function AssistantPanel() {
  const a = useAssistant()
  const { user } = useAuth()
  const narrow = useNarrow()
  const [draft, setDraft] = useState('')
  const [history, setHistory] = useState(false)
  const root = useRef<HTMLElement>(null); const input = useRef<HTMLTextAreaElement>(null); const log = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)

  // focus: into the composer on open, back to the button on close
  useEffect(() => {
    if (a.open) { requestAnimationFrame(() => input.current?.focus()); wasOpen.current = true }
    else if (wasOpen.current) { wasOpen.current = false; document.getElementById('assistant-button')?.focus() }
  }, [a.open])
  useLayoutEffect(() => { log.current?.scrollTo?.({ top: log.current.scrollHeight }) }, [a.messages, a.open])

  useEffect(() => {
    if (!a.open) return
    const key = (e: KeyboardEvent) => {
      const inside = root.current?.contains(document.activeElement)
      if (e.key === 'Escape' && inside) { e.stopPropagation(); a.setOpen(false); return }
      if (e.key !== 'Tab' || !narrow || !root.current) return // full-screen on mobile behaves like a modal: Tab stays inside
      const f = Array.from(root.current.querySelectorAll<HTMLElement>('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])')).filter((x) => !(x as HTMLButtonElement).disabled)
      if (f.length === 0) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key)
  }, [a, narrow])

  if (!a.config?.enabled || !a.open) return null
  const max = a.config.maxMessageChars
  const suggestions = suggestionsFor(a.pathname, a.config.canPropose)
  const submit = () => { const t = draft.trim(); if (!t || a.busy) return; setDraft(''); void a.send(t) }
  const lastAssistant = [...a.messages].reverse().find((m) => m.role === 'assistant')

  return (
    <aside ref={root} id="assistant-panel" className={`as-panel${narrow ? ' as-full' : ''}`} role="dialog" aria-modal={narrow || undefined} aria-label="Solvelt Assistant">
      <header className="as-head">
        <h2 id="assistant-title">Assistant</h2>
        <span className="spacer" />
        <button type="button" className="btn link" aria-pressed={history} onClick={() => setHistory((h) => !h)}>History</button>
        <button type="button" className="btn link" onClick={() => { a.newChat(); setHistory(false); input.current?.focus() }}>New chat</button>
        <button type="button" className="btn as-close" onClick={() => a.setOpen(false)} aria-label="Close assistant"><PIcon name="x" /></button>
      </header>

      {a.config.stopped && <Alert kind="info">The assistant is switched off right now. Everything else in the portal works as usual.</Alert>}
      {a.config.readOnlyReason && !a.config.stopped && <Alert kind="info">{a.config.readOnlyReason}</Alert>}

      {history ? <History onPick={() => setHistory(false)} /> : (
        <>
          <div className="as-log" ref={log} role="log" aria-live="polite" aria-relevant="additions text" aria-busy={a.busy} aria-label="Conversation" tabIndex={0}>
            {a.loading ? <Skeleton lines={4} /> : a.messages.length === 0 ? (
              <div className="as-empty">
                <h3>How can I help{user?.vendorName ? `, ${user.vendorName}` : ''}?</h3>
                <p className="as-muted">I can look things up and prepare changes. Anything that changes data waits for your Confirm.</p>
                <ul className="as-suggest" aria-label="Suggested questions">
                  {suggestions.map((s) => <li key={s}><button type="button" className="btn" disabled={a.busy || a.config?.stopped} onClick={() => void a.send(s)}>{s}</button></li>)}
                </ul>
              </div>
            ) : a.messages.map((m) => <MessageView key={m.id} m={m} last={m === lastAssistant} />)}
          </div>
          {a.error && <div className="as-err"><Alert>{a.error}</Alert>{!a.busy && <button type="button" className="btn link" onClick={a.retry}>Try again</button>}</div>}
          <form className="as-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
            <label htmlFor="assistant-input" className="sr-only">Message the assistant</label>
            <textarea id="assistant-input" ref={input} rows={2} maxLength={max} value={draft} placeholder="Ask about orders, listings, messages…" disabled={!!a.config.stopped}
              onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} />
            <div className="as-compose-row">
              <span className="as-muted" aria-live="off">{draft.length > max * 0.8 ? `${draft.length}/${max}` : 'AI can make mistakes. Check important details.'}</span>
              {a.busy ? <Button type="button" variant="secondary" onClick={a.stop}>Stop generating</Button>
                : <Button type="submit" variant="primary" disabled={!draft.trim() || !!a.config.stopped}>Send</Button>}
            </div>
          </form>
        </>
      )}
    </aside>
  )
}

function History({ onPick }: { onPick: () => void }) {
  const a = useAssistant()
  const [editing, setEditing] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [armed, setArmed] = useState<string | null>(null)
  return (
    <div className="as-history">
      <h3 className="sr-only">Conversation history</h3>
      {a.conversations.length === 0 ? <p className="as-muted">No conversations yet.</p> : (
        <ul>
          {a.conversations.map((c) => (
            <li key={c.id}>
              {editing === c.id ? (
                <form onSubmit={(e) => { e.preventDefault(); void a.rename(c.id, title).then(() => setEditing(null)) }}>
                  <label className="sr-only" htmlFor={`rn-${c.id}`}>New title</label>
                  <input id={`rn-${c.id}`} data-autofocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus />
                  <button className="btn link" type="submit">Save</button>
                  <button className="btn link" type="button" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <button type="button" className="as-hist-open" aria-current={c.id === a.conversationId || undefined} onClick={() => { void a.select(c.id); onPick() }}>
                    <span>{c.title}</span><small>{new Date(c.updatedAt).toLocaleDateString()}</small>
                  </button>
                  <button type="button" className="btn link" onClick={() => { setEditing(c.id); setTitle(c.title) }}>Rename{' '}<span className="sr-only">{c.title}</span></button>
                  {armed === c.id
                    ? <button type="button" className="btn link danger" onClick={() => { void a.removeConversation(c.id); setArmed(null) }}>Really delete{' '}<span className="sr-only">{c.title}</span></button>
                    : <button type="button" className="btn link" onClick={() => setArmed(c.id)}>Delete{' '}<span className="sr-only">{c.title}</span></button>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {a.conversations.length > 0 && (armed === 'all'
        ? <button type="button" className="btn danger" onClick={() => { void a.removeAll(); setArmed(null) }}>Yes, delete all my history</button>
        : <button type="button" className="btn link" onClick={() => setArmed('all')}>Delete all my history</button>)}
      <p className="as-muted">Conversations are private to you and deleted automatically after {a.config?.retentionDays ?? 90} days.</p>
    </div>
  )
}
