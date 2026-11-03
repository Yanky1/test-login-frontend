import { useEffect, useState } from 'react'
import { fetchBlob } from './api'

const cache = new Map<string, Promise<string>>()
/** Shows a protected product image (the API needs the bearer token, so <img src> can't be used directly). */
export function AuthImage({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (!src) return
    if (src.startsWith('blob:') || src.startsWith('data:')) { setUrl(src); return }
    let p = cache.get(src)
    if (!p) { p = fetchBlob(src).then((b) => URL.createObjectURL(b)); cache.set(src, p); p.catch(() => cache.delete(src)) }
    p.then((u) => { if (alive) setUrl(u) }).catch(() => undefined)
    return () => { alive = false }
  }, [src])
  return url ? <img className={className} src={url} alt={alt} /> : <span className={`${className ?? ''} img-ph`} {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })} />
}
