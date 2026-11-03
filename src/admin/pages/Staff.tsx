import { useState } from 'react'
import { Alert, Button, Field } from '../../components/ui'
import { STAFF_ROLES, ROLE_LABEL, adminApi, fmtDate, type StaffRole } from '../api'
import { Badge, Can, ErrorNote, Loading, PageHeader, Panel, ReasonAction, ReasonDialog, RoleBadge, Table, useLoad } from '../components'
import { useAdmin } from '../AdminAuth'

interface Member { userId: string; email: string; role: StaffRole; active: boolean; twoFactorEnabled: boolean; createdAt: string; lastLoginAt: string | null }
interface Invite { id: string; email: string; role: StaffRole; createdAt: string; expiresAt: string }

function InviteAction({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false); const [email, setEmail] = useState(''); const [role, setRole] = useState<StaffRole>('Support')
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Invite staff member</Button>
      {open && <ReasonDialog title="Invite a staff member" confirm="Send invitation" lead="They get a single-use link that expires in a few days. Two-factor authentication is required at their first sign-in. You will be asked for your authenticator code."
        extra={<><Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <div className="field"><label htmlFor="inv-role">Role</label><select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div></>}
        onSubmit={async (reason) => { await adminApi('/staff/invitations', { body: { email: email.trim(), role, reason } }); onDone() }} onClose={() => setOpen(false)} />}
    </>
  )
}

function RoleAction({ m, onDone }: { m: Member; onDone: () => void }) {
  const [open, setOpen] = useState(false); const [role, setRole] = useState<StaffRole>(m.role)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Change role{' '}<span className="sr-only">of {m.email}</span></Button>
      {open && <ReasonDialog title={`Change the role of ${m.email}`} confirm="Change role" lead="Takes effect on their next request. You will be asked for your authenticator code."
        extra={<div className="field"><label htmlFor="chg-role">New role</label><select id="chg-role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>}
        onSubmit={async (reason) => { await adminApi(`/staff/${m.userId}/role`, { method: 'PUT', body: { role, reason } }); onDone() }} onClose={() => setOpen(false)} />}
    </>
  )
}

export default function Staff() {
  const { me } = useAdmin()
  const { data, error, loading, reload } = useLoad(() => adminApi<{ members: Member[]; invitations: Invite[] }>('/staff'), [])
  const [msg, setMsg] = useState<string | null>(null)
  const done = (m: string) => () => { setMsg(m); reload() }
  return (
    <>
      <PageHeader title="Staff" lead="Who can use this area, and with which role. At least one Super admin always remains." actions={<Can permission="StaffManage"><InviteAction onDone={done('Invitation sent.')} /></Can>} />
      <Alert kind="success">{msg ?? ''}</Alert>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Panel title="Members">
            <Table caption="Staff members" head={['Email', 'Role', 'Two-factor', 'Status', 'Last sign-in', 'Actions']} empty="No staff.">
              {data.members.map((m) => (
                <tr key={m.userId}>
                  <th scope="row">{m.email}{m.userId === me?.userId ? ' (you)' : ''}</th><td><RoleBadge role={m.role} /></td><td>{m.twoFactorEnabled ? 'On' : <Badge value="Off" tone="warn" />}</td>
                  <td>{m.active ? <Badge value="Active" /> : <Badge value="Inactive" tone="muted" />}</td><td>{fmtDate(m.lastLoginAt)}</td>
                  <td className="adm-rowactions">
                    {m.userId === me?.userId ? <span className="adm-muted">You can’t change your own access</span> : (
                      <Can permission="StaffManage">
                        <RoleAction m={m} onDone={done('Role changed.')} />
                        {m.active
                          ? <ReasonAction label={`Deactivate`} variant="destructive" onDone={done('Staff member deactivated.')} dialog={{ title: `Deactivate ${m.email}`, lead: 'They are signed out at once and cannot sign in again until reactivated. You will be asked for your authenticator code.', confirm: 'Deactivate', danger: true, onSubmit: (reason) => adminApi(`/staff/${m.userId}/deactivate`, { body: { reason } }) }} />
                          : <ReasonAction label="Reactivate" onDone={done('Staff member reactivated.')} dialog={{ title: `Reactivate ${m.email}`, confirm: 'Reactivate', onSubmit: (reason) => adminApi(`/staff/${m.userId}/reactivate`, { body: { reason } }) }} />}
                      </Can>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Pending invitations">
            <Table caption="Pending invitations" head={['Email', 'Role', 'Sent', 'Expires', '']} empty="No pending invitations.">
              {data.invitations.map((i) => (
                <tr key={i.id}><th scope="row">{i.email}</th><td><RoleBadge role={i.role} /></td><td>{fmtDate(i.createdAt)}</td><td>{fmtDate(i.expiresAt)}</td>
                  <td><Can permission="StaffManage"><ReasonAction label="Revoke" onDone={done('Invitation revoked.')} dialog={{ title: `Revoke the invitation for ${i.email}`, confirm: 'Revoke', onSubmit: (reason) => adminApi(`/staff/invitations/${i.id}/revoke`, { body: { reason } }) }} /></Can></td></tr>
              ))}
            </Table>
          </Panel>
        </>
      )}
    </>
  )
}
