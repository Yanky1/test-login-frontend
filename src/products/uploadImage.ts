import { ApiError, refreshSession, tokenStore } from '../api'
import type { ImageDto } from './types'

export interface UploadResult { image: ImageDto; qualityScore: number; canPublish: boolean }

/** Multipart upload with progress (fetch has no upload progress). Retries once after a token refresh. */
export function uploadImage(productId: string, file: File, alt: string, variantId: string | undefined, onProgress: (pct: number) => void, retried = false): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams(); if (alt) q.set('alt', alt); if (variantId) q.set('variantId', variantId)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/v1/seller/products/${productId}/images${q.size ? `?${q}` : ''}`)
    const t = tokenStore.get(); if (t) xhr.setRequestHeader('Authorization', `Bearer ${t}`)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onerror = () => reject(new ApiError(0, { title: 'The upload failed. Check your connection and try again.' }))
    xhr.onload = async () => {
      let body: unknown = null
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null } catch { body = xhr.responseText }
      if (xhr.status === 401 && !retried && (await refreshSession())) return uploadImage(productId, file, alt, variantId, onProgress, true).then(resolve, reject)
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve(body as UploadResult) } else reject(new ApiError(xhr.status, body))
    }
    const form = new FormData(); form.append('file', file)
    xhr.send(form)
  })
}

export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_BYTES = 10 * 1024 * 1024
export const MAX_IMAGES = 9

/** Client-side pre-check so shoppers of the form get instant, specific messages; the server re-validates everything. */
export function precheck(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return `${file.name}: use a JPEG, PNG or WebP image.`
  if (file.size > MAX_BYTES) return `${file.name}: images can be up to 10 MB.`
  if (file.size === 0) return `${file.name}: the file is empty.`
  return null
}
