import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui'
import { Dialog } from './ui'

/**
 * Unsaved-changes guard. While `active`, (1) the browser asks before closing/reloading the tab and (2) clicks on in-app links
 * (header, sidebar, breadcrumbs - including ones we don't own) open a "Save and leave / Leave anyway / Stay" dialog instead of navigating.
 * BrowserRouter has no navigation blocker API, so links are intercepted at the document level.
 */
export function useLeaveGuard(active: boolean, flush: () => Promise<void>) {
  const navigate = useNavigate()
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      setTarget(to)
    }
    window.addEventListener('beforeunload', before)
    document.addEventListener('click', click, true)
    return () => { window.removeEventListener('beforeunload', before); document.removeEventListener('click', click, true) }
  }, [active])

  const dialog = target ? (
    <Dialog title="You have unsaved changes" onClose={() => setTarget(null)}>
      <p>Your latest edits haven't been saved yet. Save them before leaving?</p>
      <div className="dialog-actions">
        <Button variant="primary" loading={busy} onClick={async () => {
          setBusy(true)
          try { await flush(); const t = target; setTarget(null); navigate(t) } catch { setTarget(null) } finally { setBusy(false) }
        }}>Save and leave</Button>
        <Button variant="destructive" onClick={() => { const t = target; setTarget(null); navigate(t) }}>Leave without saving</Button>
        <Button variant="ghost" onClick={() => setTarget(null)}>Stay on this page</Button>
      </div>
    </Dialog>
  ) : null
  return dialog
}
