import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { Card, Spinner } from '../components/ui'
import { stepPath, type Application } from './wizard/shared'

/** Entry after sign-in: routes the seller to the right wizard step / pending screen, or to the catalog once approved. */
export default function Home() {
  const { user, logout } = useAuth()
  const [app, setApp] = useState<Application | null>(null)
  const [noSeller, setNoSeller] = useState(false)
  // Team members who are not the Owner don't fill in the seller application (Owner-only): they land on the product catalog.
  const member = !!user?.role && user.role !== 'Owner'
  useEffect(() => {
    if (member) return
    let alive = true
    api<Application>('/seller/application').then((a) => { if (alive) setApp(a) }).catch((e) => { if (alive && e instanceof ApiError && (e.status === 403 || e.status === 404)) setNoSeller(true) })
    return () => { alive = false }
  }, [member])
  if (member) return <Navigate to="/products" replace />
  if (noSeller) {
    return (
      <Card title="Welcome">
        <p>You are signed in as {user?.email}. This account has no seller application.</p>
        <button className="btn" onClick={() => void logout()}>Log out</button>
      </Card>
    )
  }
  if (!app) return <div className="center"><Spinner /></div>
  // Approved / Live owners have nothing left to fill in: they work in the product catalog.
  if (app.status === 'Approved' || app.status === 'Live') return <Navigate to="/products" replace />
  return <Navigate to={stepPath(app)} replace />
}
