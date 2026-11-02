import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { Card, Spinner } from '../components/ui'
import { stepPath, type Application } from './wizard/shared'

/** Entry after sign-in: routes the seller to the right wizard step / pending screen. */
export default function Home() {
  const { user, logout } = useAuth()
  const [app, setApp] = useState<Application | null>(null)
  const [noSeller, setNoSeller] = useState(false)
  useEffect(() => {
    api<Application>('/seller/application').then(setApp).catch((e) => { if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setNoSeller(true) })
  }, [])
  if (noSeller) {
    return (
      <Card title="Welcome">
        <p>You are signed in as {user?.email}. This account has no seller application.</p>
        <button className="btn" onClick={() => void logout()}>Log out</button>
      </Card>
    )
  }
  if (!app) return <div className="center"><Spinner /></div>
  return (<Navigate to={user?.accountStatus === 'PendingEmailVerification' ? '/signup/verify' : stepPath(app)} replace />)
}
