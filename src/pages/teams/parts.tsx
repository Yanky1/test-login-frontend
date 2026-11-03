import type { Role } from '../../api'
import { normalizeStatus } from '../../lib/status'

export const STATUS_LABEL: Record<string, string> = {
  Draft: 'Draft', PendingReview: 'Awaiting approval', NeedsInfo: 'Needs info', Approved: 'Approved', Rejected: 'Not approved', Suspended: 'Suspended',
}

export function RoleBadge({ role }: { role: Role | string | null | undefined }) {
  if (!role) return null
  return <span className={`chip role role-${role.toLowerCase()}`}>{role}</span>
}

export function StatusChip({ status: raw }: { status: string }) {
  const status = normalizeStatus(raw)
  return <span className={`chip ${status === 'Approved' ? 'ok' : status === 'Rejected' || status === 'Suspended' ? 'bad' : 'muted'}`}>{STATUS_LABEL[status] ?? status}</span>
}
