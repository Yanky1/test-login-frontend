import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Field } from '../../components/ui'
import { adminApi, fmtDate } from '../api'
import { Badge, Can, ErrorNote, KV, Loading, PageHeader, Panel, ReasonAction, Table, useLoad } from '../components'

interface Hit { id: string; email: string; phone: string | null; emailConfirmed: boolean; createdAt: string; isStaff: boolean }
interface Detail {
  id: string; email: string; emailConfirmed: boolean; phone: string | null; phoneConfirmed: boolean; createdAt: string; hasPassword: boolean
  staff: { role: string; active: boolean } | null
  memberships: { sellerId: string; vendorName: string | null; role: string; status: string; accountStatus: string }[]
  sessions: { id: string; kind: string; method: string | null; ipAddress: string | null; userAgent: string | null; createdAt: string; lastActivityAt: string }[]
  security: { twoFactorEnabled: boolean; passkeys: number; externalLogins: number; hasPhonePin: boolean }
  lockout: { locked: boolean; failures: number; lockedUntil: string | null }
  recentSecurityEvents: { type: string; at: string; ipAddress: string | null; detail: string | null }[]
}

export default function Users() {
  const { id } = useParams()
  return id ? <UserDetail id={id} /> : <UserSearch />
}

function UserSearch() {
  const nav = useNavigate()
  const [q, setQ] = useState(''); const [hits, setHits] = useState<Hit[] | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const search = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { const r = await adminApi<{ items: Hit[] }>(`/users?q=${encodeURIComponent(q.trim())}`); setHits(r.items); if (r.items.length === 1) nav(`/admin/users/${r.items[0].id}`) }
    catch { setErr('The search failed. Try again.') } finally { setBusy(false) }
  }
  return (
    <>
      <PageHeader title="Users" lead="Look up a person by email, phone number or user id (at least 3 characters). Phone numbers are shown masked." />
      <Panel>
        <form className="adm-filters" role="search" aria-label="Find a user" onSubmit={search}>
          <Field label="Email, phone or user id" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" variant="primary" loading={busy} disabled={q.trim().length < 3}>Search</Button>
        </form>
        <Alert>{err}</Alert>
        {hits && <Table caption="Search results" head={['Email', 'Phone', 'Verified', 'Created', 'Staff']} empty="No user found.">
          {hits.map((h) => <tr key={h.id}><th scope="row"><Link to={`/admin/users/${h.id}`}>{h.email}</Link></th><td>{h.phone ?? '—'}</td><td>{h.emailConfirmed ? 'Yes' : 'No'}</td><td>{fmtDate(h.createdAt)}</td><td>{h.isStaff ? 'Staff' : ''}</td></tr>)}
        </Table>}
      </Panel>
    </>
  )
}

function UserDetail({ id }: { id: string }) {
  const { data: d, error, loading, reload } = useLoad(() => adminApi<Detail>(`/users/${id}`), [id])
  const [msg, setMsg] = useState<string | null>(null)
  if (loading && !d) return <Loading />
  if (error || !d) return <><PageHeader title="User" /><ErrorNote error={error ?? 'Not found'} retry={reload} /><Link to="/admin/users">Back to search</Link></>
  const post = (path: string) => (reason: string) => adminApi(`/users/${id}/${path}`, { body: { reason } })
  const done = (m: string) => () => { setMsg(m); reload() }
  return (
    <>
      <PageHeader title={d.email} lead={d.staff ? `Staff member (${d.staff.role}${d.staff.active ? '' : ', inactive'})` : undefined} actions={<Link className="btn" to="/admin/users">Back to search</Link>} />
      <Alert kind="success">{msg ?? ''}</Alert>
      <Panel title="Actions">
        <p className="adm-muted">Every action needs a reason and is recorded in the audit log. Passwords, codes, tokens and PINs are never shown.</p>
        <div className="adm-actionrow">
          <Can permission="UsersAct">
            <ReasonAction label="Sign out everywhere" onDone={done('Signed out everywhere.')} dialog={{ title: 'Sign this user out everywhere', confirm: 'Sign out', onSubmit: post('sign-out-everywhere') }} />
            <ReasonAction label="Clear lockout" disabled={!d.lockout.locked && d.lockout.failures === 0} onDone={done('Lockout cleared.')} dialog={{ title: 'Clear the sign-in lockout', confirm: 'Clear lockout', onSubmit: post('clear-lockout') }} />
            <ReasonAction label="Send password reset" onDone={done('A password reset email was sent.')} dialog={{ title: 'Send a password reset email', confirm: 'Send email', onSubmit: post('send-password-reset') }} />
            <ReasonAction label="Remove phone number" disabled={!d.phone} onDone={done('Phone number removed.')} dialog={{ title: 'Remove the phone number', lead: 'The number and the phone PIN are deleted and the user is emailed.', confirm: 'Remove phone', danger: true, onSubmit: post('remove-phone') }} />
          </Can>
          <Can permission="UsersDisable2fa">
            <ReasonAction label="Disable 2FA (last resort)" variant="destructive" disabled={!d.security.twoFactorEnabled} onDone={done('Two-factor authentication disabled and the user emailed.')}
              dialog={{ title: 'Disable two-factor authentication', lead: 'Last resort for a lost device. The user is signed out everywhere and emailed. Verify their identity first. You will be asked for your authenticator code.', confirm: 'Disable 2FA', danger: true, onSubmit: post('disable-2fa') }} />
          </Can>
        </div>
      </Panel>
      <div className="adm-cols">
        <Panel title="Account"><KV items={[['Email verified', d.emailConfirmed ? 'Yes' : 'No'], ['Phone', d.phone ? `${d.phone}${d.phoneConfirmed ? '' : ' (unconfirmed)'}` : '—'], ['Created', fmtDate(d.createdAt)], ['Has a password', d.hasPassword ? 'Yes' : 'No']]} /></Panel>
        <Panel title="Security"><KV items={[['Two-factor', d.security.twoFactorEnabled ? 'On' : 'Off'], ['Passkeys', d.security.passkeys], ['Linked logins', d.security.externalLogins], ['Phone PIN', d.security.hasPhonePin ? 'Set' : 'Not set'],
          ['Lockout', d.lockout.locked ? `Locked until ${fmtDate(d.lockout.lockedUntil)}` : `Not locked (${d.lockout.failures} recent failures)`]]} /></Panel>
      </div>
      <Panel title="Seller memberships">
        <Table caption="Memberships" head={['Business', 'Role', 'Membership', 'Account']} empty="Not a member of any seller account.">
          {d.memberships.map((m) => <tr key={m.sellerId}><th scope="row"><Link to={`/admin/sellers/${m.sellerId}`}>{m.vendorName ?? '(no name)'}</Link></th><td>{m.role}</td><td>{m.status}</td><td><Badge value={m.accountStatus} /></td></tr>)}
        </Table>
      </Panel>
      <Panel title="Active sessions and devices">
        <Table caption="Sessions" head={['Kind', 'Method', 'IP', 'Device', 'Started', 'Last active']} empty="No active sessions.">
          {d.sessions.map((s) => <tr key={s.id}><td>{s.kind}</td><td>{s.method ?? '—'}</td><td>{s.ipAddress ?? '—'}</td><td className="adm-clip">{s.userAgent ?? '—'}</td><td>{fmtDate(s.createdAt)}</td><td>{fmtDate(s.lastActivityAt)}</td></tr>)}
        </Table>
      </Panel>
      <Panel title="Recent security events">
        <Table caption="Security events" head={['When', 'Event', 'IP', 'Detail']} empty="No events.">
          {d.recentSecurityEvents.map((e, i) => <tr key={i}><td>{fmtDate(e.at)}</td><td>{e.type}</td><td>{e.ipAddress ?? '—'}</td><td className="adm-clip">{e.detail ?? ''}</td></tr>)}
        </Table>
      </Panel>
    </>
  )
}
