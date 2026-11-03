import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui'
import { setUnsavedHandler } from '../lib/unsaved'
import { Dialog } from './ui'

/**
 * Unsaved-changes guard. While `active`:
 *  1. the browser asks before closing/reloading the tab;
 *  2. clicks on in-app links (header, sidebar, breadcrumbs - also ones we don't own) open a "Save and leave / Leave anyway / Stay" dialog
 *     (BrowserRouter has no blocker API, so links are intercepted at the document level);
 *  3. non-link exits (switching account, manual log-out) ask through the app-wide registry in lib/unsaved.ts, same dialog.
 */
export function useLeaveGuard(active: boolean, flush: () => Promise<void>, discard: () => void) {
  const navigate = useNavigate()
  const [ask, setAsk] = useState<{ target: string | null; resolve: (leave: boolean) => void } | null>(null)
  const [busy, setBusy] = useState(false)
  const flushRef = useRef(flush); flushRef.current = flush
  const discardRef = useRef(discard); discardRef.current = discard
  const askRef = useRef(ask); askRef.current = ask

  useEffect(() => {
    if (!active) return
    const before = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      const url = new URL(a.href, location.href)
      if (url.origin !== location.origin) return
      const to = url.pathname + url.search + url.hash
      if (to === location.pathname + location.search + location.hash) return
      e.preventDefault(); e.stopPropagation()
      setAsk({ target: to, resolve: (leave) => { if (leave) navigate(to) } })
    }
    window.addEventListener('beforeunload', before)
    document.addEventListener('click', click, true)
    const off = setUnsavedHandler(() => new Promise<boolean>((resolve) => { askRef.current?.resolve(false); setAsk({ target: null, resolve }) }))
    return () => { window.removeEventListener('beforeunload', before); document.removeEventListener('click', click, true); off() }
  }, [active, navigate])

  const close = (leave: boolean) => { const a = askRef.current; setAsk(null); a?.resolve(leave) }
  const dialog = ask ? (
    <Dialog title="You have unsaved changes" onClose={() => close(false)}>
      <p>Your latest edits haven't been saved yet. Save them before leaving?</p>
      <div className="dialog-actions">
        <Button variant="primary" loading={busy} onClick={async () => {
          setBusy(true)
          try { await flushRef.current(); close(true) } catch { close(false) } finally { setBusy(false) }
        }}>Save and leave</Button>
        <Button variant="destructive" onClick={() => { discardRef.current(); close(true) }}>Leave without saving</Button>
        <Button variant="ghost" onClick={() => close(false)}>Stay on this page</Button>
      </div>
    </Dialog>
  ) : null
  return dialog
}
