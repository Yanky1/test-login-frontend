import { useEffect, useState } from 'react'
import { ApiError } from '../api'
import { Alert } from '../components/ui'
import { Toggle } from '../products/ui'
import { messagesApi, type NotificationPrefs } from './api'

const ROWS: [keyof NotificationPrefs, string, string][] = [
  ['newOrder', 'New orders', 'An email when a buyer places an order.'], ['cancelRequest', 'Cancellation requests', 'When a buyer asks to cancel an order.'],
  ['returnRequest', 'Return requests', 'When a buyer asks to return items.'], ['buyerMessage', 'Buyer messages', 'When a buyer writes to you.'], ['overdueReply', 'Overdue replies', 'When a buyer has waited more than 24 hours.'],
  ['shippingEmails', 'Delivery problems', 'When a carrier reports a problem with a parcel. Owners always get these; others can opt in.'],
]

/** Per-person email preferences. Owners and Admins start with everything on; Managers and Viewers start with everything off. Saved as soon as you change a switch. */
export default function NotificationSettings() {
  const [p, setP] = useState<NotificationPrefs | null>(null); const [error, setError] = useState(''); const [saved, setSaved] = useState('')
  useEffect(() => { messagesApi.prefs().then(setP).catch(() => setError('Could not load your notification settings.')) }, [])
  const change = async (k: keyof NotificationPrefs, v: boolean) => {
    if (!p) return
    const before = p; setP({ ...p, [k]: v }); setError(''); setSaved('')
    try { setP(await messagesApi.savePrefs({ [k]: v })); setSaved('Saved.') } catch (e) { setP(before); setError(e instanceof ApiError ? e.message2 : 'Could not save. Try again.') }
  }
  return (
    <section className="setting-card" aria-labelledby="notif-h">
      <h2 id="notif-h">Email notifications</h2>
      <p>Choose which emails you get for this seller account. Badges in the menu always show what needs your attention.</p>
      {p ? ROWS.map(([k, l, h]) => <Toggle key={k} label={l} hint={h} checked={!!p[k]} onChange={(v) => void change(k, v)} />) : !error && <p>Loading…</p>}
      <Alert>{error}</Alert><div aria-live="polite">{saved && <p className="ok-text">{saved}</p>}</div>
    </section>
  )
}
