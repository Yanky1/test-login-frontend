import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Markdown } from '../products/lib/markdown'
import { Spinner } from '../components/ui'
import { ActionCardView } from './ActionCardView'
import { linkFor } from './routes'
import { useAssistant } from './context'
import type { ChatMessage } from './types'

/** Defence in depth: the server already strips links and images; Markdown here never renders raw HTML and never links to model-supplied URLs. */
export const withoutLinks = (t: string) => t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')

export function MessageView({ m, last }: { m: ChatMessage; last: boolean }) {
  const { retry, busy } = useAssistant()
  const [copied, setCopied] = useState(false)
  if (m.role === 'user') return <div className="as-msg as-user"><p>{m.text}</p></div>
  if (m.role === 'note') return <p className="as-note" role="status">{m.text}</p>
  const copy = async () => {
    try { await navigator.clipboard.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard unavailable */ }
  }
  const running = (m.steps ?? []).filter((s) => s.status === 'running')
  const failed = m.status === 'error' || m.status === 'timeout'
  return (
    <div className="as-msg as-bot" aria-busy={m.streaming || undefined}>
      {(m.steps?.length ?? 0) > 0 && (
        <ul className="as-steps" aria-label="What I looked at">
          {m.steps!.map((s) => (
            <li key={s.id} className={`as-step as-step-${s.status}`}>
              {s.status === 'running' ? <Spinner /> : <span aria-hidden="true">{s.status === 'done' ? '✓' : '!'}</span>}
              <span>{s.label.replace(/…$/, s.status === 'running' ? '…' : '')}{s.status === 'error' ? ' (failed)' : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {m.text ? <Markdown source={withoutLinks(m.text)} /> : m.streaming && running.length === 0 ? <p className="as-muted"><Spinner /> Thinking…</p> : null}
      {(m.links?.length ?? 0) > 0 && (
        <ul className="as-links" aria-label="Mentioned">
          {m.links!.map((l) => { const to = linkFor(l); return <li key={l.id}>{to ? <Link to={to}>{l.label}</Link> : <span>{l.label}</span>}</li> })}
        </ul>
      )}
      {(m.actions ?? []).map((a) => <ActionCardView key={a.id} card={a} />)}
      {m.status === 'limit' && <p className="as-muted">I stopped after the maximum number of steps. Ask me to continue.</p>}
      {m.status === 'truncated' && <p className="as-muted">My answer was cut short. Ask me to continue.</p>}
      {m.status === 'stopped' && <p className="as-muted">Stopped.</p>}
      {!m.streaming && m.text && (
        <div className="as-tools">
          <button type="button" className="btn link" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}{' '}<span className="sr-only">answer</span></button>
          {last && failed && <button type="button" className="btn link" disabled={busy} onClick={retry}>Try again</button>}
        </div>
      )}
    </div>
  )
}
