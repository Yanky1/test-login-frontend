import { useRef, useState } from 'react'
import { Markdown } from '../lib/markdown'
import { TextField } from '../ui'
import type { SectionProps } from './types'

export default function Description({ ed }: SectionProps) {
  const { form, set, errors } = ed
  const area = useRef<HTMLTextAreaElement>(null)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const wrap = (l: string, r = l, placeholder = 'text') => {
    const el = area.current!; const v = form.description ?? ''
    const a = el.selectionStart; const b = el.selectionEnd
    const sel = v.slice(a, b) || placeholder
    set({ description: v.slice(0, a) + l + sel + r + v.slice(b) })
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + l.length, a + l.length + sel.length) })
  }
  const bullets = form.bullets.length ? form.bullets : ['']
  const setB = (i: number, v: string) => set({ bullets: bullets.map((b, j) => (j === i ? v : b)) })
  return (
    <>
      <fieldset className="bullets">
        <legend>Key features <span className="opt">(up to 5)</span></legend>
        <p className="hint">Short, scannable points shoppers see first. Lead with the benefit, e.g. "Keeps drinks hot for 12 hours".</p>
        {bullets.map((b, i) => (
          <div className="row" key={i}>
            <TextField label={`Feature ${i + 1}`} id={`f-bullet-${i}`} value={b} maxLength={500} onChange={(e) => setB(i, e.target.value)} error={i === 0 ? errors.bullets : undefined} />
            <button type="button" className="btn link" aria-label={`Remove feature ${i + 1}`} onClick={() => set({ bullets: bullets.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        {bullets.length < 5 && <button type="button" className="btn" onClick={() => set({ bullets: [...bullets, ''] })}>Add a feature</button>}
      </fieldset>
      <div className="md-editor">
        <div className="md-head">
          <label htmlFor="f-description">Description</label>
          <div className="md-tools" role="toolbar" aria-label="Formatting">
            <button type="button" className="btn link" onClick={() => wrap('**')}><b>Bold</b></button>
            <button type="button" className="btn link" onClick={() => wrap('*')}><i>Italic</i></button>
            <button type="button" className="btn link" onClick={() => wrap('\n- ', '', 'List item')}>Bullet list</button>
            <button type="button" className="btn link" onClick={() => wrap('[', '](https://)', 'link text')}>Link</button>
          </div>
          <div className="md-tabs" role="group" aria-label="Editor view">
            <button type="button" className="btn link" aria-pressed={tab === 'write'} onClick={() => setTab('write')}>Write</button>
            <button type="button" className="btn link" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button>
          </div>
        </div>
        <div className={`md-panes ${tab}`}>
          <textarea ref={area} id="f-description" rows={10} maxLength={10000} value={form.description ?? ''} onChange={(e) => set({ description: e.target.value })}
            aria-invalid={errors.description ? true : undefined} aria-describedby="f-description-hint" />
          <div className="md-preview" aria-label="Description preview" role="region"><Markdown source={form.description} />{!form.description?.trim() && <p className="hint">Nothing to preview yet.</p>}</div>
        </div>
        <div id="f-description-hint" className="hint">Markdown: **bold**, *italic*, - lists, [links](https://...). Raw HTML isn't allowed. {(form.description ?? '').length}/10,000</div>
        <div className="field-error" aria-live="polite">{errors.description}</div>
      </div>
    </>
  )
}
