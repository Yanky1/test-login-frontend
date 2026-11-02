import { useEffect, useState } from 'react'
import { api } from '../api'
import { createCredential, passkeysSupported } from '../lib/passkeys'
import { Alert } from '../components/ui'

/** After a password sign-in, offer to add a passkey (once per session, only if none exists). */
export function PasskeyOffer() {
  const [show, setShow] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let flag = false
    try { flag = sessionStorage.getItem('offerPasskey') === '1' } catch { /* ignore */ }
    if (!flag || !passkeysSupported()) return
    api<{ passkeyCount: number }>('/account/me').then((me) => { if (me.passkeyCount === 0) setShow(true) }).catch(() => undefined)
    try { sessionStorage.removeItem('offerPasskey') } catch { /* ignore */ }
  }, [])
  if (!show) return null
  const add = async () => {
    try {
      const opts = await api('/account/passkeys/options', { body: {} })
      const credential = await createCredential(opts)
      await api('/account/passkeys', { body: { credential, name: 'This device' } })
      setMsg('Passkey added. Next time you can sign in without a password.')
      setTimeout(() => setShow(false), 2500)
    } catch { setMsg('Could not add a passkey. You can try again in Settings → Security.') }
  }
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="pk-title" className="modal">
        <h2 id="pk-title">Add a passkey?</h2>
        <p>Sign in faster and more securely with your fingerprint, face or device PIN.</p>
        <Alert kind="info">{msg}</Alert>
        <div className="row">
          <button className="btn primary" autoFocus onClick={() => void add()}>Add a passkey</button>
          <button className="btn" onClick={() => setShow(false)}>Not now</button>
        </div>
      </div>
    </div>
  )
}
