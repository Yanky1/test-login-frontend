import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api'
import { useAuth } from '../../auth'
import { Alert, Card, Skeleton } from '../../components/ui'
import { fmtDate, type PendingInvite } from '../../lib/teams'
import { RoleBadge, StatusChip } from './parts'

/** "Choose an account" (also the empty state when the user is not part of any account). Used as the gate after sign-in and at /accounts. */
export default function ChooseAccount() {
  const { user, switchAccount, refreshAccounts } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const accounts = user?.accounts ?? []
  const [invites, setInvites] = useState<PendingInvite[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(params.get('new') === '1')
  const [terms, setTerms] = useState(false)
  const gate = !user?.activeAccountId

  const loadInvites = useCallback(async () => {
    try { setInvites(await api<PendingInvite[]>('/account/invitations')) } catch { setInvites([]) }
  }, [])
  useEffect(() => { void loadInvites() }, [loadInvites])

  const open = useCallback(async (id: string) => {
    setBusy(id); setMsg(null)
    try { await switchAccount(id); nav('/', { replace: true }) } catch { setMsg('Could not open that account. Please try again.') } finally { setBusy(null) }
  }, [switchAccount, nav])

  // exactly one account and nothing to decide: go straight in
  const auto = useRef(false)
  useEffect(() => {
    if (gate && accounts.length === 1 && invites !== null && !auto.current && params.get('new') !== '1') { auto.current = true; void open(accounts[0].sellerId) }
  }, [gate, accounts, invites, open, params])

  const answer = async (inv: PendingInvite, accept: boolean) => {
    setBusy(inv.id); setMsg(null)
    try {
      await api(`/account/invitations/${inv.id}/${accept ? 'accept' : 'decline'}`, { method: 'POST', body: {} })
      await Promise.all([loadInvites(), refreshAccounts()])
    } catch (e) { setMsg(e instanceof ApiError ? e.message2 : 'Something went wrong. Please try again.') } finally { setBusy(null) }
  }

  const create = async () => {
    if (!terms) { setMsg('You must accept the Terms to create an account.'); return }
    setBusy('new'); setMsg(null)
    try {
      const r = await api<{ sellerId: string }>('/account/seller-accounts', { body: { acceptTerms: true } })
      await refreshAccounts()
      await switchAccount(r.sellerId)
      nav('/', { replace: true })
    } catch (e) { setMsg(e instanceof ApiError ? e.message2 : 'Could not create the account.') } finally { setBusy(null) }
  }

  const empty = accounts.length === 0
  return (
    <Card wide title={empty ? "You're not part of any seller account" : 'Choose an account'}
      lead={empty ? 'Accept an invitation you received, or create your own seller account.' : 'Pick the seller account you want to work in. You can switch any time from the top bar.'}>
      <Alert>{msg}</Alert>
      {user?.accounts === null ? <Skeleton lines={2} /> : null}
      {!empty && (
        <ul className="acct-list" aria-label="Your accounts">
          {accounts.map((a) => (
            <li key={a.sellerId} className="acct-item">
              <div className="acct-info">
                <strong>{a.vendorName || 'New seller account'}</strong>
                <span className="acct-meta"><RoleBadge role={a.role} /> <StatusChip status={a.accountStatus} /> <span className="muted">{a.brandCount} {a.brandCount === 1 ? 'brand' : 'brands'}</span></span>
              </div>
              <button type="button" className="btn primary" disabled={busy !== null} aria-busy={busy === a.sellerId || undefined}
                onClick={() => void open(a.sellerId)}>
                Continue{' '}<span className="sr-only">to {a.vendorName || 'New seller account'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="inv-h">
        <h2 id="inv-h">Pending invitations</h2>
        {invites === null ? <Skeleton lines={2} /> : invites.length === 0 ? <p className="empty">No pending invitations.</p> : (
          <ul className="acct-list">
            {invites.map((i) => (
              <li key={i.id} className="acct-item">
                <div className="acct-info"><strong>{i.accountName || 'A seller account'}</strong>
                  <span className="acct-meta">Invited as <RoleBadge role={i.role} /> <span className="muted">· expires {fmtDate(i.expiresAt)}</span></span></div>
                <div className="row">
                  <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void answer(i, true)}>Accept{' '}<span className="sr-only">invitation to {i.accountName}</span></button>
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => void answer(i, false)}>Decline{' '}<span className="sr-only">invitation to {i.accountName}</span></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="new-h">
        <h2 id="new-h">Create a new seller account</h2>
        {!creating ? (
          <button type="button" className="btn" onClick={() => setCreating(true)}>Create a new seller account</button>
        ) : (
          <div>
            <p className="hint">A new seller account goes through the normal application and approval steps. Your login, passkeys and 2-step verification stay the same.</p>
            <div className="field check"><label><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> I agree to the Terms</label></div>
            <button type="button" className="btn primary" disabled={busy !== null} aria-busy={busy === 'new' || undefined} onClick={() => void create()}>Create account</button>
          </div>
        )}
      </section>
    </Card>
  )
}
