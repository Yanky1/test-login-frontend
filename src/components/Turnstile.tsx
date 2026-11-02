import { useEffect, useRef } from 'react'

declare global { interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void; reset: (id?: string) => void } } }

export const STUB_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

/** Cloudflare Turnstile widget. siteKey "stub" renders a test button (used by E2E/dev where Cloudflare isn't reachable). */
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (t: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (siteKey === 'stub' || !ref.current) return
    let id: string | undefined
    const mount = () => {
      if (!ref.current || !window.turnstile) return
      id = window.turnstile.render(ref.current, { sitekey: siteKey, callback: (t: string) => onToken(t), 'expired-callback': () => onToken(null), 'error-callback': () => onToken(null) })
    }
    if (window.turnstile) mount()
    else {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true; s.onload = mount
      document.head.appendChild(s)
    }
    return () => { if (id && window.turnstile) window.turnstile.remove(id) }
  }, [siteKey, onToken])
  if (siteKey === 'stub') {
    return <button type="button" className="btn" onClick={() => onToken(STUB_TOKEN)}>Verify you are human (test)</button>
  }
  return <div ref={ref} aria-label="Human verification" />
}
