import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface TabDef { id: string; label: ReactNode }

/** WAI-ARIA tabs: roving tabindex, Left/Right/Home/End, ids and aria-controls that point at the matching `tabPanelProps` region. */
export function TabList({ label, idPrefix, tabs, value, onChange }: { label: string; idPrefix: string; tabs: TabDef[]; value: string; onChange: (id: string) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = Math.max(0, tabs.findIndex((t) => t.id === value))
  const go = (i: number) => { const n = (i + tabs.length) % tabs.length; onChange(tabs[n].id); refs.current[n]?.focus() }
  const key = (e: KeyboardEvent) => {
    const m: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }
    if (e.key in m) { e.preventDefault(); go(m[e.key]) }
  }
  return (
    <div className="stabs" role="tablist" aria-label={label} onKeyDown={key}>
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[i] = el }} id={`${idPrefix}-tab-${t.id}`} type="button" role="tab" aria-selected={t.id === value} aria-controls={`${idPrefix}-panel`}
          tabIndex={t.id === value ? 0 : -1} className={t.id === value ? 'on' : ''} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  )
}
export const tabPanelProps = (idPrefix: string, value: string) => ({ role: 'tabpanel' as const, id: `${idPrefix}-panel`, 'aria-labelledby': `${idPrefix}-tab-${value}` })
