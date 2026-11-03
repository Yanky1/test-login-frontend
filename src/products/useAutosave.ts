import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/**
 * Debounced, serialised autosave. `touch()` after every change; `save` should read the LATEST state (via a ref) when it runs.
 * Changes made while a save is running trigger exactly one more save. A failing save keeps the status `error` (input is never discarded)
 * and the next change retries. `flush()` saves immediately (used before leaving the page / before activation).
 */
export function useAutosave(save: () => Promise<void>, delay = 1200, manual = false) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<unknown>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const running = useRef<Promise<void> | null>(null)
  const again = useRef(false)
  const dirty = useRef(false)
  const saveRef = useRef(save)
  const manualRef = useRef(manual); manualRef.current = manual
  saveRef.current = save

  const run = useCallback((): Promise<void> => {
    if (running.current) { again.current = true; return running.current }
    setStatus('saving')
    running.current = (async () => {
      try {
        do { again.current = false; dirty.current = false; await saveRef.current() } while (again.current)
        setError(null); setStatus('saved')
      } catch (e) {
        dirty.current = true; setError(e); setStatus('error')
      } finally { running.current = null }
    })()
    return running.current
  }, [])

  const touch = useCallback(() => {
    dirty.current = true
    setStatus((s) => (s === 'saving' ? s : 'dirty'))
    clearTimeout(timer.current)
    if (!manual) timer.current = setTimeout(() => void run(), delay)
  }, [run, delay, manual])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    if (running.current) await running.current
    if (dirty.current) await run()
  }, [run])

  // leaving the page (unmount) with edits pending: send them now instead of dropping them with the timer.
  // Never for manual-save mode (live listings): those change only when the seller presses Save.
  useEffect(() => () => { clearTimeout(timer.current); if (!manualRef.current && dirty.current && !running.current) void run() }, [run])
  /** True while there is anything not yet safely on the server. */
  const unsaved = status === 'dirty' || status === 'saving' || status === 'error'
  return { status, error, touch, flush, unsaved, retry: run }
}
