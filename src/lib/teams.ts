import type { Role } from '../api'

export const ROLES: Role[] = ['Owner', 'Admin', 'Manager', 'Viewer', 'Driver']
export const ROLE_RANK: Record<Role, number> = { Driver: -1, Viewer: 0, Manager: 1, Admin: 2, Owner: 3 }

/** Plain-language role descriptions (shown in the invite and role dialogs). */
export const ROLE_DESC: Record<Role, string> = {
  Owner: 'Everything, including business and legal details, the seller agreement, transferring ownership and closing the account.',
  Admin: 'Everything except Owner-only actions. Invites and manages members (but not Owners) and brands.',
  Manager: 'Works on the brands they are given: products and questions. Cannot manage members or account details.',
  Viewer: 'Can look but not change anything, for the brands they are given.',
  Driver: 'Delivers local orders with the driver app: sees only the stops of their own route, nothing else in the account.',
}

export type Perm = 'members.read' | 'members.manage' | 'brands.manage' | 'business.edit' | 'ownership.transfer' | 'account.close'
const MATRIX: Record<Role, Perm[]> = {
  Owner: ['members.read', 'members.manage', 'brands.manage', 'business.edit', 'ownership.transfer', 'account.close'],
  Admin: ['members.read', 'members.manage', 'brands.manage'],
  Manager: [],
  Viewer: [],
  Driver: [],
}
/** UI hint only: the server is the authority and re-checks every request. */
export const can = (role: Role | null | undefined, p: Perm) => !!role && MATRIX[role].includes(p)

export interface Brand {
  id: string; name: string; slug: string; description: string | null; contactEmail: string | null; website: string | null
  status: 'Active' | 'Archived'; isDefault: boolean; hasLogo: boolean; logoUrl: string | null
}
export interface Member {
  id: string; userId: string; email: string; role: Role; status: 'Active' | 'Suspended'; allBrands: boolean
  brands: { id: string; name: string }[]; createdAt: string; lastActiveAt: string | null; isMe: boolean
}
export interface Invite {
  id: string; email: string; role: Role; allBrands: boolean; brands: { id: string; name: string }[]
  status: 'Pending' | 'Expired' | 'Accepted' | 'Declined' | 'Revoked'; expiresAt: string; lastSentAt: string; sendCount: number
}
export interface InvitePreview { state: 'pending' | 'expired' | 'revoked' | 'accepted' | 'declined'; email: string; accountName: string; role: Role; allBrands: boolean; brands: string[]; expiresAt: string }
export interface PendingInvite { id: string; accountName: string; role: Role; expiresAt: string }

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never')
export const brandAccess = (m: { allBrands: boolean; brands: { name: string }[] }) => (m.allBrands ? 'All brands' : m.brands.map((b) => b.name).join(', ') || 'No brands')
