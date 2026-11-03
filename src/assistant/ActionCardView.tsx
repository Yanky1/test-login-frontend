import { useEffect, useState } from 'react'
import { Button } from '../components/ui'
import { useAssistant } from './context'
import type { ActionCard } from './types'

const RISK: Record<string, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' }

function minutesLeft(expiresAt: string, now: number) { return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000)) }

/** The "Do this?" card. Nothing happens until Confirm is pressed; the summary and before/after come from the server, not from the model's prose. */
export function ActionCardView({ card }: { card: ActionCard }) {
  const { confirm, cancel, acting, config } = useAssistant()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (card.status !== 'pending') return; const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t) }, [card.status])
  const busy = acting.has(card.id)
  const expired = card.status === 'expired' || (card.status === 'pending' && new Date(card.expiresAt).getTime() <= now)
  const status = expired && card.status === 'pending' ? 'expired' : card.status
  const left = minutesLeft(card.expiresAt, now)
  const stopped = config?.stopped
  return (
    <section className={`as-card as-card-${status} as-risk-${card.risk}`} aria-label={`Proposed action: ${card.summary}`}>
      <header className="as-card-head">
        <h3>{status === 'pending' ? 'Do this?' : status === 'confirmed' ? 'Done' : status === 'cancelled' ? 'Cancelled' : status === 'expired' ? 'Expired' : status === 'superseded' ? 'Replaced' : 'Couldn\u2019t do this'}</h3>
        <span className={`as-badge as-badge-${card.risk}`}>{RISK[card.risk] ?? card.risk}</span>
      </header>
      <p className="as-card-summary">{card.summary}</p>
      <table className="as-diff">
        <caption className="sr-only">What will change</caption>
        <thead><tr><th scope="col">What</th><th scope="col">Now</th><th scope="col">After</th></tr></thead>
        <tbody>
          {card.diff.map((d) => (
            <tr key={d.field}>
              <th scope="row">{d.field}</th>
              <td>{d.before ?? <span className="as-none">—{' '}<span className="sr-only">nothing</span></span>}</td>
              <td className="as-after">{d.after ?? <span className="as-none">—{' '}<span className="sr-only">removed</span></span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {status === 'pending' && (
        <>
          <p className="as-muted" aria-live="off">{left > 0 ? `Expires in ${left} min.` : 'Expires now.'} Nothing has changed yet.</p>
          <div className="as-actions">
            <Button variant="primary" loading={busy} disabled={busy || !!stopped} onClick={() => void confirm(card)}>Confirm{' '}<span className="sr-only">{card.target.label}</span></Button>
            <Button variant="secondary" disabled={busy} onClick={() => void cancel(card)}>Cancel{' '}<span className="sr-only">{card.target.label}</span></Button>
          </div>
          {stopped && <p className="as-muted">The assistant is switched off right now, so this can\u2019t be confirmed.</p>}
        </>
      )}
      {status === 'confirmed' && <p className="as-result" role="status">{card.result?.message ?? 'Done.'}</p>}
      {status === 'cancelled' && <p className="as-muted" role="status">Cancelled. Nothing was changed.</p>}
      {status === 'expired' && <p className="as-muted" role="status">This proposal expired. Ask me to prepare it again.</p>}
      {status === 'superseded' && <p className="as-muted" role="status">This changed after I prepared it. See the newer proposal below. Nothing was changed.</p>}
      {status === 'failed' && <p className="as-error" role="alert">{card.result?.message ?? 'Something went wrong. Nothing further was changed.'}</p>}
    </section>
  )
}
