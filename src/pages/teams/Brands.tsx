import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, tokenStore } from '../../api'
import { useAuth } from '../../auth'
import { Dialog } from '../../components/Dialog'
import { Alert, Field, SettingCard, Skeleton } from '../../components/ui'
import { can, type Brand } from '../../lib/teams'
import { useBrands } from './BrandContext'

const MAX_LOGO = 1024 * 1024
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Logos are served to authenticated members only, so they are fetched with the bearer token and shown from an object URL. */
export function BrandLogo({ brand, size = 48 }: { brand: Pick<Brand, 'id' | 'name' | 'hasLogo' | 'logoUrl'>; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!brand.hasLogo || !brand.logoUrl || typeof URL.createObjectURL !== 'function') { setSrc(null); return }
    let alive = true; let url: string | null = null
    fetch(brand.logoUrl, { headers: { Authorization: `Bearer ${tokenStore.get() ?? ''}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b && alive) { url = URL.createObjectURL(b); setSrc(url) } })
      .catch(() => undefined)
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [brand.id, brand.hasLogo, brand.logoUrl])
  return src
    ? <img className="brand-logo" src={src} alt={`${brand.name} logo`} width={size} height={size} />
    : <span className="brand-logo brand-logo-ph" style={{ width: size, height: size }} aria-hidden="true">{brand.name.trim().charAt(0).toUpperCase()}</span>
}

export default function BrandsPage() {
  const { user } = useAuth()
  const { reload: reloadCtx, selected, setSelected } = useBrands()
  const manage = can(user?.role, 'brands.manage')
  const [brands, setBrands] = useState<Brand[] | null>(null)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [edit, setEdit] = useState<Brand | 'new' | null>(null)
  const load = useCallback(async () => {
    try { setBrands(await api<Brand[]>('/brands?includeArchived=true')) } catch (e) { setBrands([]); setMsg({ kind: 'error', text: e instanceof ApiError ? e.message2 : 'Could not load brands.' }) }
    await reloadCtx()
  }, [reloadCtx])
  useEffect(() => { void load() }, [load])

  const setArchived = async (b: Brand, archive: boolean) => {
    setMsg(null)
    try { await api(`/brands/${b.id}/${archive ? 'archive' : 'restore'}`, { method: 'POST', body: {} }); setMsg({ kind: 'success', text: `${b.name} ${archive ? 'archived' : 'restored'}.` }); await load() }
    catch (e) { setMsg({ kind: 'error', text: e instanceof ApiError ? e.message2 : 'Something went wrong.' }) }
  }
  const active = (brands ?? []).filter((b) => b.status === 'Active')
  const archived = (brands ?? []).filter((b) => b.status === 'Archived')
  const row = (b: Brand) => (
    <li key={b.id} className="brand-row">
      <BrandLogo brand={b} />
      <div className="brand-info">
        <strong>{b.name}</strong>{selected === b.id && <span className="chip ok">Selected</span>}
        {b.description && <span className="muted">{b.description}</span>}
        {b.website && <a href={b.website} target="_blank" rel="noopener noreferrer">{b.website.replace(/^https?:\/\//, '')}</a>}
      </div>
      <div className="row">
        {b.status === 'Active' && active.length > 1 && <button type="button" className="btn link" aria-pressed={selected === b.id} aria-label={`Filter by ${b.name}`} onClick={() => setSelected(selected === b.id ? 'all' : b.id)}>{selected === b.id ? 'Show all' : 'Filter'}</button>}
        {manage && b.status === 'Active' && <button type="button" className="btn link" aria-label={`Edit ${b.name}`} onClick={() => setEdit(b)}>Edit</button>}
        {manage && b.status === 'Active' && active.length > 1 && <button type="button" className="btn link danger-link" aria-label={`Archive ${b.name}`} onClick={() => void setArchived(b, true)}>Archive</button>}
        {manage && b.status === 'Archived' && <button type="button" className="btn link" aria-label={`Restore ${b.name}`} onClick={() => void setArchived(b, false)}>Restore</button>}
      </div>
    </li>
  )
  return (
    <>
      <Alert kind={msg?.kind === 'success' ? 'success' : 'error'}>{msg?.text}</Alert>
      <SettingCard id="brands" icon="store" title="Brands" desc="A seller account can sell under several brands. Products belong to exactly one brand.">
        {manage && <div className="row"><button type="button" className="btn primary" onClick={() => setEdit('new')}>Add a brand</button></div>}
        {!brands ? <Skeleton lines={3} /> : <ul className="brand-list" aria-label="Brands">{active.map(row)}</ul>}
        {archived.length > 0 && <><h3>Archived</h3><ul className="brand-list" aria-label="Archived brands">{archived.map(row)}</ul></>}
        {manage && active.length === 1 && <p className="hint">You can't archive your last active brand.</p>}
      </SettingCard>
      {edit && <BrandDialog brand={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={(t) => { setEdit(null); setMsg({ kind: 'success', text: t }); void load() }} />}
    </>
  )
}

function BrandDialog({ brand, onClose, onDone }: { brand: Brand | null; onClose: () => void; onDone: (t: string) => void }) {
  const [name, setName] = useState(brand?.name ?? '')
  const [description, setDescription] = useState(brand?.description ?? '')
  const [contactEmail, setContactEmail] = useState(brand?.contactEmail ?? '')
  const [website, setWebsite] = useState(brand?.website ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [removeLogo, setRemoveLogo] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const pick = (f: File | undefined) => {
    setErrors((e) => ({ ...e, file: '' }))
    if (!f) return
    if (!LOGO_TYPES.includes(f.type)) { setErrors((e) => ({ ...e, file: 'Use a JPEG, PNG or WebP image.' })); return }
    if (f.size > MAX_LOGO) { setErrors((e) => ({ ...e, file: 'The logo must be 1 MB or smaller.' })); return }
    setFile(f); setRemoveLogo(false)
    if (typeof URL.createObjectURL === 'function') setPreview(URL.createObjectURL(f))
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) { setErrors({ name: 'Enter a name for the brand.' }); return }
    setBusy(true); setErrors({})
    try {
      const body = { name: name.trim(), description: description.trim() || null, contactEmail: contactEmail.trim() || null, website: website.trim() || null }
      const saved = brand ? await api<Brand>(`/brands/${brand.id}`, { method: 'PUT', body }) : await api<Brand>('/brands', { body })
      if (file) { const form = new FormData(); form.append('file', file); await api(`/brands/${saved.id}/logo`, { form }) }
      else if (removeLogo && brand?.hasLogo) await api(`/brands/${saved.id}/logo`, { method: 'DELETE' })
      onDone(brand ? `${saved.name} updated.` : `${saved.name} added.`)
    } catch (e2) {
      if (e2 instanceof ApiError) { const fe = e2.fieldErrors(); if (Object.keys(fe).length) setErrors(fe); else setErr(e2.message2) } else setErr('Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }
  return (
    <Dialog id="brand-title" title={brand ? `Edit ${brand.name}` : 'Add a brand'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Brand name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={80} data-autofocus />
        <div className="field">
          <label htmlFor="b-desc">Short description</label>
          <textarea id="b-desc" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} aria-describedby={errors.description ? 'b-desc-err' : undefined} />
          <div id="b-desc-err" className="field-error" aria-live="polite">{errors.description}</div>
        </div>
        <Field label="Contact email (optional)" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} error={errors.contactEmail} />
        <Field label="Website (optional)" type="url" inputMode="url" value={website} onChange={(e) => setWebsite(e.target.value)} error={errors.website} hint="Start with https://" />
        <div className="field">
          <label htmlFor="b-logo">Logo (JPEG, PNG or WebP, up to 1 MB)</label>
          <div className="logo-pick">
            {preview ? <img className="brand-logo" src={preview} alt="Logo preview" width={64} height={64} />
              : brand && brand.hasLogo && !removeLogo ? <BrandLogo brand={brand} size={64} /> : <span className="brand-logo brand-logo-ph" style={{ width: 64, height: 64 }} aria-hidden="true">{(name || '?').trim().charAt(0).toUpperCase()}</span>}
            <input id="b-logo" type="file" accept={LOGO_TYPES.join(',')} onChange={(e) => pick(e.target.files?.[0])} aria-describedby="b-logo-err" />
          </div>
          {brand?.hasLogo && !file && !removeLogo && <button type="button" className="btn link" onClick={() => setRemoveLogo(true)}>Remove current logo</button>}
          <div id="b-logo-err" className="field-error" aria-live="polite">{errors.file}</div>
        </div>
        <Alert>{err}</Alert>
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy} aria-busy={busy || undefined}>{brand ? 'Save changes' : 'Add brand'}</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  )
}
