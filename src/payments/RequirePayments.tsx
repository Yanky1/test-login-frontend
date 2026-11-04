import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Spinner } from '../components/ui'

/** Payments are for Owners and Admins only; everyone else (and an unknown role) is sent home instead of seeing a page shell and an API error. The server enforces it too. */
export function RequirePayments({ children }: { children: ReactNode }) {
  const { user, status } = useAuth()
  if (status === 'loading') return <div className="center"><Spinner /></div>
  return user?.role === 'Owner' || user?.role === 'Admin' ? <>{children}</> : <Navigate to="/" replace />
}
