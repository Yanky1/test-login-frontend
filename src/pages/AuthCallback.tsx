import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { api, ApiError, type LoginResponse } from '../api'
import { useAuth } from '../auth'
import { safeNext } from '../lib/safeNext'
import { Alert, Card, Field, Spinner } from '../components/ui'

/** Landing page after Google/Apple: exchanges the one-time code for a session (asking for a 2FA code when the account has one). */
export default function AuthCallback() {
  const [params] = useSearchParams()
  const { applyLogin } = useAuth()
  const nav = useNavigate()
  const [failed, setFailed] = useState(false)
  const [needSecond, setNeedSecond] = useState(false)
  const [useRecovery, setUseRecovery] = useState(false)
  const [second, setSecond] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const ran = useRef(false)

  const exchange = async (extra: Record<string, string> = {}) => {
    const code = params.get('code')
    if (!code) { setFailed(true); return }
    try {
      const r = await api<LoginResponse>('/auth/external/exchange', { auth: false, body: { code, ...extra } })
      applyLogin(r, 'other')
      nav(safeNext(params.get('next')) ?? '/', { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && e.body?.twoFactorRequired) {
        setNeedSecond(true)
        setMsg(Object.keys(extra).length ? 'That code is not right. Try again.' : 'Enter the code from your authenticator app to finish signing in.')
      } else setFailed(true)
    }
  }

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    void exchange()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void exchange(useRecovery ? { recoveryCode: second } : { totpCode: second })
  }

  return (
    <Card title={needSecond ? 'Two-step verification' : 'Signing you in…'}>
      {failed ? <Alert>Sign-in failed. <Link to="/login">Back to sign in</Link></Alert>
        : needSecond ? (
          <form onSubmit={submit} noValidate>
            <Field label={useRecovery ? 'Recovery code' : 'Authentication code'} autoComplete="one-time-code" inputMode={useRecovery ? 'text' : 'numeric'}
              value={second} onChange={(e) => setSecond(e.target.value)}
              hint={<button type="button" className="btn link" onClick={() => { setUseRecovery(!useRecovery); setSecond('') }}>{useRecovery ? 'Use authenticator code' : 'Use a recovery code'}</button>} />
            <Alert>{msg}</Alert>
            <button className="btn primary block">Continue</button>
          </form>
        ) : <Spinner />}
    </Card>
  )
}
