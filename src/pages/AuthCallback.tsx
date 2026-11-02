import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { api, type LoginResponse } from '../api'
import { useAuth } from '../auth'
import { safeNext } from '../lib/safeNext'
import { Alert, Card, Spinner } from '../components/ui'

/** Landing page after Google/Apple: exchanges the one-time code for a session. */
export default function AuthCallback() {
  const [params] = useSearchParams()
  const { applyLogin } = useAuth()
  const nav = useNavigate()
  const [failed, setFailed] = useState(false)
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const code = params.get('code')
    if (!code) { setFailed(true); return }
    api<LoginResponse>('/auth/external/exchange', { auth: false, body: { code } })
      .then((r) => { applyLogin(r, 'other'); nav(safeNext(params.get('next')) ?? '/', { replace: true }) })
      .catch(() => setFailed(true))
  }, [params, applyLogin, nav])
  return (
    <Card title="Signing you in…">
      {failed ? <Alert>Sign-in failed. <Link to="/login">Back to sign in</Link></Alert> : <Spinner />}
    </Card>
  )
}
