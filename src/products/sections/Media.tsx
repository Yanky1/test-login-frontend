import { useRef, useState } from 'react'
import { Button } from '../../components/ui'
import { productsApi } from '../api'
import { AuthImage } from '../AuthImage'
import { ApiError } from '../../api'
import { MAX_IMAGES, precheck, uploadImage } from '../uploadImage'
import { useCanWrite } from '../usePermissions'
import { PIcon } from '../ui'
import type { ImageDto } from '../types'
import type { SectionProps } from './types'

interface Pending { key: string; name: string; pct: number; error?: string }

export function ImageManager({ ed, variantId, compact }: { ed: SectionProps['ed']; variantId?: string; compact?: boolean }) {
  const { detail } = ed
  const canWrite = useCanWrite()
  const all = ed.images.filter((i) => (i.variantId ?? undefined) === variantId)
  const [pending, setPending] = useState<Pending[]>([])
  const [msg, setMsg] = useState('')
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const dragId = useRef<string | null>(null)
  const room = !canWrite ? 0 : MAX_IMAGES - all.length - pending.filter((p) => !p.error).length

  const upload = async (files: File[]) => {
    if (!canWrite) return
    setMsg('')
    const ok: File[] = []; const problems: string[] = []
    for (const f of files) { const e = precheck(f); if (e) problems.push(e); else ok.push(f) }
    if (ok.length > room) { problems.push(`You can add ${Math.max(room, 0)} more image${room === 1 ? '' : 's'} (maximum ${MAX_IMAGES}).`); ok.length = Math.max(room, 0) }
    if (problems.length) setMsg(problems.join(' '))
    for (const f of ok) {
      const key = `${f.name}-${f.size}-${Math.random()}`
      setPending((p) => [...p, { key, name: f.name, pct: 0 }])
      try {
        const r = await ed.enqueue(() => uploadImage(detail.id, f, '', variantId, (pct) => setPending((p) => p.map((x) => (x.key === key ? { ...x, pct } : x)))))
        ed.setImages((prev) => [...prev.filter((i) => i.id !== r.image.id), r.image], r)
        setPending((p) => p.filter((x) => x.key !== key))
        void ed.refreshReadiness()
      } catch (e) {
        const text = e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message2) : 'The upload failed.'
        setPending((p) => p.map((x) => (x.key === key ? { ...x, error: text } : x)))
      }
    }
  }
  const apply = (r: { images: ImageDto[] }) => { ed.setImages(r.images); void ed.refreshReadiness() }
  const move = async (i: number, dir: -1 | 1) => {
    const ids = all.map((x) => x.id); const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    apply(await ed.enqueue(() => productsApi.reorderImages(detail.id, ids, variantId ?? null)))
  }
  const dropOn = async (target: string) => {
    const from = dragId.current; dragId.current = null
    if (!from || from === target) return
    const ids = all.map((x) => x.id); ids.splice(ids.indexOf(target), 0, ids.splice(ids.indexOf(from), 1)[0])
    apply(await ed.enqueue(() => productsApi.reorderImages(detail.id, ids, variantId ?? null)))
  }

  return (
    <div className={compact ? 'media compact' : 'media'}>
      {room > 0 && (
        <div className={`dropzone${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void upload([...e.dataTransfer.files]) }}>
          <PIcon name="upload" />
          <div>
            <strong>Drag photos here</strong> or <Button variant="ghost" type="button" onClick={() => input.current?.click()}>choose files</Button>
            {!compact && <div className="hint">JPEG, PNG or WebP, up to 10 MB each, {all.length}/{MAX_IMAGES} added.</div>}
          </div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label={compact ? 'Upload photo' : 'Upload photos'} tabIndex={-1}
            onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = '' }} />
        </div>
      )}
      {!compact && <p className="hint">Use a plain white background, show the whole product, and make photos at least 1000 px on the shortest side so shoppers can zoom. Add alt text to describe each photo.</p>}
      <div role="status" aria-live="polite" className={msg ? 'field-error' : 'sr-only'}>{msg}</div>
      <ul className="thumbs" aria-label="Photos">
        {all.map((im, i) => (
          <li key={im.id} className={im.isMain ? 'main' : ''} draggable={canWrite || undefined} onDragStart={canWrite ? () => { dragId.current = im.id } : undefined} onDragOver={canWrite ? (e) => e.preventDefault() : undefined} onDrop={canWrite ? () => void dropOn(im.id) : undefined}>
            <AuthImage src={im.url} alt={im.alt || `Photo ${i + 1}`} className="thumb" />
            {im.isMain && <span className="chip ok main-chip">Main</span>}
            {im.lowResolution && <span className="lowres" title="Under 1000 px: shoppers won't be able to zoom">Low resolution</span>}
            {!compact && canWrite && <input aria-label={`Alt text for photo ${i + 1}`} className="alt" placeholder="Describe this photo" defaultValue={im.alt ?? ''} maxLength={200}
              onBlur={async (e) => { if ((e.target.value || '') !== (im.alt ?? '')) apply(await ed.enqueue(() => productsApi.patchImage(detail.id, im.id, { alt: e.target.value }))) }} />}
            {canWrite && <div className="thumb-actions">
              <button type="button" className="btn link" aria-label={`Move photo ${i + 1} earlier`} disabled={i === 0} onClick={() => void move(i, -1)}>←</button>
              <button type="button" className="btn link" aria-label={`Move photo ${i + 1} later`} disabled={i === all.length - 1} onClick={() => void move(i, 1)}>→</button>
              {!im.isMain && <button type="button" className="btn link" onClick={async () => apply(await ed.enqueue(() => productsApi.patchImage(detail.id, im.id, { isMain: true })))}>Set as main<span className="sr-only"> (photo {i + 1})</span></button>}
              <button type="button" className="btn link danger-text" aria-label={`Delete photo ${i + 1}`} onClick={async () => {
                try { apply(await ed.enqueue(() => productsApi.deleteImage(detail.id, im.id))) } catch (e) { setMsg(e instanceof ApiError ? e.message2 : 'Could not delete the photo.') }
              }}><PIcon name="trash" /></button>
            </div>}
          </li>
        ))}
        {pending.map((p) => (
          <li key={p.key} className="pending">
            <span className="name">{p.name}</span>
            {p.error ? <span className="field-error">{p.error} <button type="button" className="btn link" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>Dismiss</button></span>
              : <progress max={100} value={p.pct} aria-label={`Uploading ${p.name}`} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Media({ ed }: SectionProps) {
  return <ImageManager ed={ed} />
}
