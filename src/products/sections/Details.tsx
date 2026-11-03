import { Toggle } from '../ui'
import { AreaField, SelectField, TextField } from '../ui'
import type { AttrConfig, AttrValue } from '../types'
import type { SectionProps } from './types'

/** Renders the category's attributes from server config (nothing is hard-coded per category). */
export function AttributeField({ a, value, onChange, error }: { a: AttrConfig; value: AttrValue | undefined; onChange: (v: AttrValue | undefined) => void; error?: string }) {
  const id = `f-attr-${a.key}`
  const label = a.label + (a.unit ? ` (${a.unit})` : '')
  const hint = a.help ?? undefined
  const opt = !a.required
  switch (a.type) {
    case 'longtext': return <AreaField id={id} label={label} optional={opt} rows={3} maxLength={2000} hint={hint} error={error} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />
    case 'number': return <TextField id={id} label={label} optional={opt} inputMode="decimal" hint={hint} error={error} value={value == null ? '' : String(value)} onChange={(e) => { const t = e.target.value.trim(); onChange(t === '' ? undefined : Number.isFinite(Number(t)) ? Number(t) : (t as AttrValue)) }} />
    case 'bool': return <Toggle id={id} label={label} hint={hint} checked={value === true} onChange={(v) => onChange(v)} />
    case 'select': return (
      <SelectField id={id} label={label} optional={opt} hint={hint} error={error} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Choose…</option>{a.options.map((o) => <option key={o}>{o}</option>)}
      </SelectField>
    )
    case 'multiselect': {
      const cur = (value as string[] | undefined) ?? []
      return (
        <fieldset className="multi" id={id} tabIndex={-1}>
          <legend>{label}{opt && <span className="opt"> (optional)</span>}</legend>
          {hint && <div className="hint">{hint}</div>}
          <div className="pchecks">{a.options.map((o) => (
            <label key={o} className="chk"><input type="checkbox" checked={cur.includes(o)} onChange={(e) => { const n = e.target.checked ? [...cur, o] : cur.filter((x) => x !== o); onChange(n.length ? n : undefined) }} /> {o}</label>
          ))}</div>
          <div className="field-error" aria-live="polite">{error}</div>
        </fieldset>
      )
    }
    default: return <TextField id={id} label={label} optional={opt} hint={hint} error={error} maxLength={200} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />
  }
}

export default function Details({ ed }: SectionProps) {
  const { form, set, attrConfig, errors } = ed
  if (!form.categoryId) return <p className="hint">Choose a category in Basics and we'll ask for the details that matter for it (for example allergens for food, or model and warranty for electronics).</p>
  if (attrConfig.length === 0) return <p className="hint">This category has no extra details to fill in.</p>
  const groups = [...new Set(attrConfig.map((a) => a.group ?? 'Details'))]
  const change = (key: string, v: AttrValue | undefined) => {
    const next = { ...form.attributes }
    if (v === undefined) delete next[key]; else next[key] = v
    set({ attributes: next })
  }
  return (
    <>
      {groups.map((g) => (
        <fieldset key={g} className="attr-group">
          <legend>{g}</legend>
          {attrConfig.filter((a) => (a.group ?? 'Details') === g).map((a) => (
            <AttributeField key={a.key} a={a} value={form.attributes[a.key]} error={errors[`attributes.${a.key}`]} onChange={(v) => change(a.key, v)} />
          ))}
        </fieldset>
      ))}
    </>
  )
}
