import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type Role } from '../../api'
import { useAuth } from '../../auth'
import { Dialog } from '../../components/Dialog'
import { Alert, Field, PasswordField, SettingCard, Skeleton } from '../../components/ui'
import { brandAccess, can, fmtDate, ROLE_DESC, ROLE_RANK, ROLES, type Brand, type Invite, type Member } from '../../lib/teams'
import { RoleBadge } from './parts'

interface Props { hasPassword: boolean; twoFactorEnabled: boolean }

export default function TeamPage({ hasPassword, twoFactorEnabled }: Props) {
  const { user } = useAuth()
  const nav = useNavigate()
  const role = user?.role ?? null
  const manage = can(role, 'members.manage')
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [dlg, setDlg] = useState<null | { type: 'invite' } | { type: 'edit'; m: Member } | { type: 'remove'; m: Member } | { type: 'leave' } | { type: 'transfer' } | { type: 'close' }>(null)

  const load = useCallback(async () => {
    try {
      const [m, i, b] = await Promise.all([api<Member[]>('/team/members'), api<Invite[]>('/team/invitations'), api<Brand[]>('/brands')])
      setMembers(m); setInvites(i); setBrands(b)
    } catch (e) { setMsg({ kind: 'error', text: e instanceof ApiError ? e.message2 : 'Could not load the team.' }); setMembers((m) => m ?? []) }
  }, [])
  useEffect(() => { void load() }, [load])

  const done = async (text: string) => { setDlg(null); setMsg({ kind: 'success', text }); await load() }
  const canTouch = (m: Member) => manage && !m.isMe && (role === 'Owner' || m.role !== 'Owner')
  const resend = async (i: Invite) => {
    try { await api(`/team/invitations/${i.id}/resend`, { method: 'POST', body: {} }); await done(`Invitation sent again to ${i.email}.`) }
    catch (e) { setMsg({ kind: 'error', text: e instanceof ApiError ? e.message2 : 'Could not resend.' }) }
  }
  const revoke = async (i: Invite) => {
    try { await api(`/team/invitations/${i.id}`, { method: 'DELETE' }); await done(`Invitation for ${i.email} revoked.`) }
    catch (e) { setMsg({ kind: 'error', text: e instanceof ApiError ? e.message2 : 'Could not revoke.' }) }
  }

  return (
    <>
      <Alert kind={msg?.kind === 'success' ? 'success' : 'error'}>{msg?.text}</Alert>
      <SettingCard id="team-members" icon="users" title="Team members" desc="People who can work in this seller account, with their role and brand access.">
        {manage && <div className="row"><button type="button" className="btn primary" onClick={() => setDlg({ type: 'invite' })}>Invite a team member</button></div>}
        {!members ? <Skeleton lines={3} /> : (
          <table className="tbl" role="table">
            <caption className="sr-only">Team members</caption>
            <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Member</th><th scope="col" role="columnheader">Role</th><th scope="col" role="columnheader">Brand access</th><th scope="col" role="columnheader">Status</th><th scope="col" role="columnheader">Last active</th><th scope="col" role="columnheader"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody role="rowgroup">
              {members.map((m) => (
                <tr key={m.id} role="row">
                  <td role="cell" data-label="Member"><strong>{m.email}</strong>{m.isMe && <span className="muted"> (you)</span>}</td>
                  <td role="cell" data-label="Role"><RoleBadge role={m.role} /></td>
                  <td role="cell" data-label="Brand access">{brandAccess(m)}</td>
                  <td role="cell" data-label="Status">{m.status}</td>
                  <td role="cell" data-label="Last active">{fmtDate(m.lastActiveAt)}</td>
                  <td role="cell" data-label="Actions" className="tbl-actions">
                    {canTouch(m) && <>
                      <button type="button" className="btn link" onClick={() => setDlg({ type: 'edit', m })}>Change{' '}<span className="sr-only">role or access for {m.email}</span></button>
                      <button type="button" className="btn link danger-link" onClick={() => setDlg({ type: 'remove', m })}>Remove{' '}<span className="sr-only">{m.email}</span></button>
                    </>}
                    {m.isMe && <button type="button" className="btn link" onClick={() => setDlg({ type: 'leave' })}>Leave account</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SettingCard>

      {manage && (
        <SettingCard id="team-invites" icon="mail" title="Pending invitations" desc="Invitations expire after 7 days. Resending sends a fresh link and the old one stops working.">
          {invites.length === 0 ? <p className="empty">No pending invitations.</p> : (
            <ul className="list">
              {invites.map((i) => (
                <li key={i.id}>
                  <span><strong>{i.email}</strong> <RoleBadge role={i.role} /> <span className="muted">· {i.allBrands ? 'All brands' : i.brands.map((b) => b.name).join(', ')} · {i.status === 'Expired' ? 'expired' : `expires ${fmtDate(i.expiresAt)}`}</span></span>
                  <span className="row">
                    <button type="button" className="btn link" onClick={() => void resend(i)}>Resend{' '}<span className="sr-only">invitation to {i.email}</span></button>
                    <button type="button" className="btn link danger-link" onClick={() => void revoke(i)}>Revoke{' '}<span className="sr-only">invitation to {i.email}</span></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SettingCard>
      )}

      {can(role, 'ownership.transfer') && (
        <SettingCard id="team-transfer" icon="shield" title="Transfer ownership" desc="Make another member the Owner. You become an Admin. You will be asked to confirm it's you.">
          <button type="button" className="btn" onClick={() => setDlg({ type: 'transfer' })}>Transfer ownership…</button>
        </SettingCard>
      )}

      {can(role, 'account.close') && (
        <SettingCard id="team-close" icon="lock" title="Close this account" desc="Permanently locks everyone out of this seller account. Your data is kept, your login is not affected.">
          <button type="button" className="btn danger" onClick={() => setDlg({ type: 'close' })}>Close account…</button>
        </SettingCard>
      )}

      {dlg?.type === 'invite' && <InviteDialog role={role!} brands={brands.filter((b) => b.status === 'Active')} onClose={() => setDlg(null)} onDone={(t) => void done(t)} />}
      {dlg?.type === 'edit' && <EditDialog actor={role!} member={dlg.m} brands={brands.filter((b) => b.status === 'Active')} onClose={() => setDlg(null)} onDone={(t) => void done(t)} />}
      {dlg?.type === 'remove' && <ConfirmDialog id="rm" title={`Remove ${dlg.m.email}?`} confirm="Remove member"
        body="They lose access to this seller account right away. Their own login and any other accounts are not affected."
        run={async () => { await api(`/team/members/${dlg.m.id}`, { method: 'DELETE' }) }} onClose={() => setDlg(null)} onDone={() => void done(`${dlg.m.email} was removed.`)} />}
      {dlg?.type === 'leave' && <ConfirmDialog id="lv" title="Leave this account?" confirm="Leave account"
        body="You will lose access to this seller account. An account always keeps at least one Owner."
        run={async () => { await api('/team/leave', { method: 'POST', body: {} }) }} onClose={() => setDlg(null)} onDone={() => { nav('/accounts', { replace: true }) }} onAfter={true} />}
      {dlg?.type === 'close' && <CloseAccountDialog name={user?.vendorName ?? ''} hasPassword={hasPassword} twoFactor={twoFactorEnabled} onClose={() => setDlg(null)} onDone={() => { setDlg(null); nav('/accounts', { replace: true }) }} />}
      {dlg?.type === 'transfer' && <TransferDialog members={(members ?? []).filter((m) => !m.isMe && m.status === 'Active')} hasPassword={hasPassword} twoFactor={twoFactorEnabled} onClose={() => setDlg(null)} onDone={() => void done('Ownership transferred. You are now an Admin.')} />}
    </>
  )
}

function useSubmit() {
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setErr(null); setBusy(true)
    try { await fn() } catch (e) {
      if (e instanceof ApiError) { const fe = Object.values(e.fieldErrors())[0]; setErr(fe ?? e.message2) } else setErr('Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }
  return { err, busy, run, setErr }
}

function ScopePicker({ role, all, setAll, picked, setPicked, brands }: { role: Role; all: boolean; setAll: (v: boolean) => void; picked: string[]; setPicked: (v: string[]) => void; brands: Brand[] }) {
  if (role === 'Owner' || role === 'Admin') return <p className="hint">{role}s always have access to all brands.</p>
  return (
    <fieldset className="field">
      <legend>Brand access</legend>
      <label className="radio"><input type="radio" name="scope" checked={all} onChange={() => setAll(true)} /> All brands</label>
      <label className="radio"><input type="radio" name="scope" checked={!all} onChange={() => setAll(false)} /> Only selected brands</label>
      {!all && (
        <div className="scope-list" role="group" aria-label="Brands">
          {brands.map((b) => (
            <label key={b.id} className="field check"><input type="checkbox" checked={picked.includes(b.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, b.id] : picked.filter((x) => x !== b.id))} /> {b.name}</label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

function RolePicker({ value, onChange, roles }: { value: Role; onChange: (r: Role) => void; roles: Role[] }) {
  return (
    <div className="field">
      <label htmlFor="role-sel">Role</label>
      <select id="role-sel" value={value} onChange={(e) => onChange(e.target.value as Role)} aria-describedby="role-desc">
        {roles.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <div id="role-desc" className="hint">{ROLE_DESC[value]}</div>
    </div>
  )
}

function InviteDialog({ role: actor, brands, onClose, onDone }: { role: Role; brands: Brand[]; onClose: () => void; onDone: (t: string) => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('Viewer')
  const [all, setAll] = useState(true)
  const [picked, setPicked] = useState<string[]>([])
  const [fieldErr, setFieldErr] = useState<string | undefined>()
  const { err, busy, run } = useSubmit()
  const roles = ROLES.filter((r) => r !== 'Owner' && ROLE_RANK[r] <= ROLE_RANK[actor])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setFieldErr(undefined)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setFieldErr('Enter a valid email address.'); return }
    if ((role === 'Manager' || role === 'Viewer') && !all && picked.length === 0) { setFieldErr(undefined); void run(async () => { throw new ApiError(400, { title: 'Choose at least one brand, or give access to all brands.' }) }); return }
    void run(async () => {
      await api('/team/invitations', { body: { email: email.trim(), role, allBrands: role === 'Manager' || role === 'Viewer' ? all : true, brandIds: all ? [] : picked } })
      onDone(`Invitation sent to ${email.trim()}.`)
    })
  }
  return (
    <Dialog id="inv-title" title="Invite a team member" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field label="Email address" type="email" autoComplete="off" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErr} data-autofocus />
        <RolePicker value={role} onChange={setRole} roles={roles} />
        <ScopePicker role={role} all={all} setAll={setAll} picked={picked} setPicked={setPicked} brands={brands} />
        <Alert>{err}</Alert>
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy} aria-busy={busy || undefined}>Send invitation</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  )
}

function EditDialog({ actor, member, brands, onClose, onDone }: { actor: Role; member: Member; brands: Brand[]; onClose: () => void; onDone: (t: string) => void }) {
  const [role, setRole] = useState<Role>(member.role)
  const [all, setAll] = useState(member.allBrands)
  const [picked, setPicked] = useState<string[]>(member.brands.map((b) => b.id))
  const { err, busy, run } = useSubmit()
  const roles = ROLES.filter((r) => ROLE_RANK[r] <= ROLE_RANK[actor])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      if ((role === 'Manager' || role === 'Viewer') && !all && picked.length === 0) throw new ApiError(400, { title: 'Choose at least one brand, or give access to all brands.' })
      await api(`/team/members/${member.id}`, { method: 'PATCH', body: { role, allBrands: role === 'Manager' || role === 'Viewer' ? all : true, brandIds: all ? [] : picked } })
      onDone(`Updated ${member.email}.`)
    })
  }
  return (
    <Dialog id="edit-title" title={`Change access for ${member.email}`} onClose={onClose}>
      <form onSubmit={submit}>
        <RolePicker value={role} onChange={setRole} roles={roles} />
        <ScopePicker role={role} all={all} setAll={setAll} picked={picked} setPicked={setPicked} brands={brands} />
        <Alert>{err}</Alert>
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy} aria-busy={busy || undefined}>Save changes</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  )
}

function ConfirmDialog({ id, title, body, confirm, run, onClose, onDone, onAfter }: { id: string; title: string; body: string; confirm: string; run: () => Promise<void>; onClose: () => void; onDone: () => void; onAfter?: boolean }) {
  const { err, busy, run: go } = useSubmit()
  const { refreshAccounts } = useAuth()
  return (
    <Dialog id={`${id}-title`} title={title} onClose={onClose}>
      <p>{body}</p>
      <Alert>{err}</Alert>
      <div className="row">
        <button className="btn danger" data-autofocus type="button" disabled={busy} aria-busy={busy || undefined}
          onClick={() => void go(async () => { await run(); if (onAfter) await refreshAccounts(); onDone() })}>{confirm}</button>
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  )
}

/** Step-up fields shared by the destructive owner dialogs: password (+ authenticator code), or an emailed code for passwordless accounts. */
function useStepUp(hasPassword: boolean, twoFactor: boolean) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [totp, setTotp] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const body = () => ({ currentPassword: hasPassword ? password : undefined, stepUpCode: !hasPassword ? code || undefined : undefined, totpCode: twoFactor ? totp : undefined })
  const fields = (
    <>
      {hasPassword
        ? <PasswordField label="Confirm with your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        : needCode && <Field label="Code from your email" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />}
      {twoFactor && <Field label="Authentication code" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} />}
    </>
  )
  return { body, fields, needCode, setNeedCode, emailFirst: !hasPassword && !needCode }
}

function TransferDialog({ members, hasPassword, twoFactor, onClose, onDone }: { members: Member[]; hasPassword: boolean; twoFactor: boolean; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState(members[0]?.id ?? '')
  const step = useStepUp(hasPassword, twoFactor)
  const { refreshAccounts } = useAuth()
  const { err, busy, run } = useSubmit()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const r = await api<{ stepUpRequired?: boolean } | null>('/team/transfer-ownership', { body: { memberId: to, ...step.body() } })
      if (r?.stepUpRequired) { step.setNeedCode(true); return } // passwordless account: a code was emailed to the current address
      await refreshAccounts() // the former Owner is an Admin now: the header badge, the Transfer card and row actions must follow
      onDone()
    })
  }
  return (
    <Dialog id="tr-title" title="Transfer ownership" onClose={onClose}>
      {members.length === 0 ? <><p>Invite another member first. Ownership can only be given to an existing member.</p><button className="btn" onClick={onClose}>Close</button></> : (
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="tr-to">New Owner</label>
            <select id="tr-to" value={to} onChange={(e) => setTo(e.target.value)}>{members.map((m) => <option key={m.id} value={m.id}>{m.email} ({m.role})</option>)}</select>
          </div>
          <p className="hint">You will become an Admin. Both of you get an email.</p>
          {step.fields}
          <Alert>{err}</Alert>
          <div className="row">
            <button className="btn danger" type="submit" disabled={busy} aria-busy={busy || undefined}>{step.emailFirst ? 'Email me a code' : 'Transfer ownership'}</button>
            <button className="btn" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

function CloseAccountDialog({ name, hasPassword, twoFactor, onClose, onDone }: { name: string; hasPassword: boolean; twoFactor: boolean; onClose: () => void; onDone: () => void }) {
  const [sure, setSure] = useState(false)
  const [sureErr, setSureErr] = useState<string | undefined>()
  const step = useStepUp(hasPassword, twoFactor)
  const { refreshAccounts } = useAuth()
  const { err, busy, run } = useSubmit()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!sure) { setSureErr('Tick the box to confirm you understand.'); return }
    setSureErr(undefined)
    void run(async () => {
      const r = await api<{ stepUpRequired?: boolean } | null>('/team/close-account', { body: step.body() })
      if (r?.stepUpRequired) { step.setNeedCode(true); return }
      await refreshAccounts() // the account is gone for everyone: the app falls back to the account chooser
      onDone()
    })
  }
  return (
    <Dialog id="close-title" title={`Close ${name || 'this account'}?`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Alert kind="info">Closing the account locks everyone out of it, including you. Nobody can sign in to it or change it again. Your data is kept. Your own login and your other accounts are not affected.</Alert>
        <div className="field check">
          <label><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} aria-invalid={sureErr ? true : undefined} data-autofocus /> I understand that nobody will be able to use this account</label>
          <div className="field-error" aria-live="polite">{sureErr}</div>
        </div>
        {step.fields}
        <Alert>{err}</Alert>
        <div className="row">
          <button className="btn danger" type="submit" disabled={busy} aria-busy={busy || undefined}>{step.emailFirst ? 'Email me a code' : 'Close account'}</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  )
}
