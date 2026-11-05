import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Skeleton } from '../components/ui'
import { useAuth } from '../auth'
import { countsSummary, demoApi, demoChanged, isPendingStatus, type DemoStatus } from './api'
import { ApproveAccountButton, ConfirmAction, describe } from './TestMode'
import './demo.css'

const LABELS: [keyof DemoStatus['counts'], string][] = [['products', 'Products'], ['services', 'Services'], ['orders', 'Orders'], ['bookings', 'Bookings'], ['quotes', 'Quote requests'], ['conversations', 'Conversations'], ['notifications', 'Notifications']]

/** Settings -> Test tools (Owner, test mode only; the caller checks both). */
export default function TestTools() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [st, setSt] = useState<DemoStatus | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)
  const pending = isPendingStatus(user?.accountStatus)
  const load = useCallback(async () => { try { setSt(await demoApi.status()); setError('') } catch (e) { setError(describe(e)) } }, [])
  useEffect(() => { void load() }, [load])
  const fill = async () => {
    setBusy(true); setError(''); setNotice('')
    try { const r = await demoApi.fill(); setNotice(`Demo data added: ${countsSummary(r.counts)}.${pending ? ' It will appear in your lists once the account is approved.' : ''}`); demoChanged() } catch (e) { setError(describe(e)) } finally { setBusy(false) }
    await load()
  }
  return (
    <section aria-labelledby="tt-h" className="set-card">
      <header className="set-head"><div className="set-title"><h2 id="tt-h">Test tools</h2><p className="set-desc">Only available while the server is in test mode. These tools never exist in production.</p></div><span className="chip test-mode">TEST MODE</span></header>
      <div className="set-body">
        <Alert>{error}</Alert>
        {notice && <p role="status" className="alert success">{notice}</p>}
        {!st ? <Skeleton lines={3} /> : (
          <>
            <h3>Demo data</h3>
            {st.exists
              ? <ul className="demo-counts" aria-label="Demo records in this account">{LABELS.map(([k, l]) => <li key={k}><strong>{st.counts[k]}</strong> {l}</li>)}</ul>
              : <p>This account has no demo data.</p>}
            <div className="demo-actions">
              <Button variant="primary" type="button" loading={busy} disabled={st.exists} onClick={() => void fill()}>Fill with demo data</Button>
              <Button variant="destructive" type="button" disabled={!st.exists || busy} onClick={() => setRemoving(true)}>Remove demo data</Button>
            </div>
            {st.exists && <p className="demo-note">Demo data already exists. Remove it to add a fresh set.</p>}
            {pending && (
              <>
                <h3>Approval</h3>
                <p>This account is waiting for staff approval. In test mode you can approve it yourself.</p>
                <ApproveAccountButton onApproved={() => nav('/products')} />
              </>
            )}
          </>
        )}
      </div>
      {removing && <ConfirmAction title="Remove demo data?" confirm="Yes, remove demo data" destructive onClose={() => setRemoving(false)} onConfirm={async () => { const r = await demoApi.remove(); setRemoving(false); setNotice(`Removed ${countsSummary(r.removed) || 'nothing'}. Your own records were not touched.`); demoChanged(); await load() }}>
        <p>This removes every record that was created by &ldquo;Fill with demo data&rdquo;. Records you created yourself are not touched.</p>
      </ConfirmAction>}
    </section>
  )
}
