import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { productsApi } from './api'
import type { Category } from './types'

let cached: Promise<Category[]> | null = null
export const loadCategories = () => (cached ??= productsApi.categories().catch((e) => { cached = null; throw e }))
export const resetCategoryCache = () => { cached = null }

/** Searchable category combobox (ARIA 1.2 pattern): type to filter, arrows to move, Enter to choose, Esc to close. Only leaf categories can be chosen. */
export function CategoryPicker({ value, onChange, id, error, label = 'Category', hint }: { value: string | null; onChange: (id: string, c: Category) => void; id?: string; error?: string; label?: string; hint?: string }) {
  const auto = useId(); const fid = id ?? auto
  const [cats, setCats] = useState<Category[]>([])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { let a = true; loadCategories().then((c) => a && setCats(c)).catch(() => undefined); return () => { a = false } }, [])
  const selected = cats.find((c) => c.id === value)
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return cats.filter((c) => c.leaf && (!t || c.path.toLowerCase().includes(t))).slice(0, 60)
  }, [cats, q])
  useEffect(() => setHi(0), [q, open])
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', out); return () => document.removeEventListener('mousedown', out)
  }, [open])
  const choose = (c: Category) => { onChange(c.id, c); setQ(''); setOpen(false) }
  return (
    <div className="field cat-picker" ref={box}>
      <label htmlFor={fid}>{label}</label>
      <input id={fid} role="combobox" aria-expanded={open} aria-controls={`${fid}-list`} aria-autocomplete="list" aria-activedescendant={open && shown[hi] ? `${fid}-o-${shown[hi].id}` : undefined}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${fid}-err` : `${fid}-hint`} autoComplete="off"
        placeholder={selected ? selected.path : 'Search, e.g. "headphones" or "snacks"'} value={open ? q : selected && !open ? selected.path : q}
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, shown.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter' && open && shown[hi]) { e.preventDefault(); choose(shown[hi]) }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) }
        }} />
      {open && (
        <ul id={`${fid}-list`} role="listbox" aria-label="Categories" className="cat-list">
          {shown.length === 0 && <li className="cat-empty" role="presentation">No category matches "{q}".</li>}
          {shown.map((c, i) => (
            <li key={c.id} id={`${fid}-o-${c.id}`} role="option" aria-selected={c.id === value} className={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); choose(c) }}>{c.path}</li>
          ))}
        </ul>
      )}
      <div id={`${fid}-hint`} className="hint">{hint ?? 'Pick the most specific category - it decides which product details we ask for.'}</div>
      <div id={`${fid}-err`} className="field-error" aria-live="polite">{error}</div>
    </div>
  )
}
