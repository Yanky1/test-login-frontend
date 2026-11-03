import { api, refreshSession, tokenStore } from '../api'
import type { Brand, Category, CsvValidation, Faq, ImageDto, ListResult, OptionDto, ProductDetail, ProductForm, Question, QuestionList, VariantDto, AttrConfig, Issue } from './types'

const P = '/seller/products'
const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const productsApi = {
  list: (o: Record<string, string | number | undefined | null>) => api<ListResult>(`${P}${qs(o)}`),
  create: (b: { title: string; categoryId?: string | null; brandId?: string | null; type?: 'product' | 'service' }) => api<ProductDetail>(P, { body: b }),
  get: (id: string) => api<ProductDetail>(`${P}/${id}`),
  save: (id: string, f: ProductForm) => api<ProductDetail>(`${P}/${id}`, { method: 'PUT', body: f }),
  quick: (id: string, b: { price?: number; quantity?: number; version?: number }) => api<ProductDetail>(`${P}/${id}/quick`, { method: 'PATCH', body: b }),
  setStatus: (id: string, status: string) => api<ProductDetail>(`${P}/${id}/status`, { body: { status } }),
  bulkStatus: (ids: string[], status: string) => api<{ updated: number; ids: string[]; failed: { id: string; title?: string; message: string }[] }>(`${P}/bulk-status`, { body: { ids, status } }),
  remove: (id: string) => api<null>(`${P}/${id}`, { method: 'DELETE' }),
  duplicate: (id: string) => api<ProductDetail>(`${P}/${id}/duplicate`, { body: {} }),
  setVariants: (id: string, b: { hasVariants: boolean; options: OptionDto[]; variants: VariantDto[] }) => api<ProductDetail>(`${P}/${id}/variants`, { method: 'PUT', body: b }),
  setFaqs: (id: string, faqs: Faq[]) => api<{ faqs: Faq[] }>(`${P}/${id}/faqs`, { method: 'PUT', body: faqs.map(({ question, answer }) => ({ question, answer })) }),
  upload: (id: string, file: File, alt: string, variantId?: string) => {
    const form = new FormData(); form.append('file', file)
    return api<{ image: ImageDto; qualityScore: number; canPublish: boolean }>(`${P}/${id}/images${qs({ alt, variantId })}`, { form })
  },
  reorderImages: (id: string, ids: string[], variantId?: string | null) => api<{ images: ImageDto[] }>(`${P}/${id}/images/order`, { method: 'PUT', body: { ids, variantId } }),
  patchImage: (id: string, imageId: string, b: { alt?: string; isMain?: boolean }) => api<{ images: ImageDto[] }>(`${P}/${id}/images/${imageId}`, { method: 'PUT', body: b }),
  deleteImage: (id: string, imageId: string) => api<{ images: ImageDto[] }>(`${P}/${id}/images/${imageId}`, { method: 'DELETE' }),
  categories: () => api<Category[]>('/categories'),
  categoryAttributes: (id: string) => api<AttrConfig[]>(`/categories/${id}/attributes`),
  brands: () => api<Brand[]>('/brands'),
  readiness: (id: string) => api<{ score: number; canPublish: boolean; issues: Issue[] }>(`${P}/${id}/readiness`),
  questions: (o: Record<string, string | number | undefined | null>) => api<QuestionList>(`/seller/questions${qs(o)}`),
  answer: (id: string, answer: string, publish = true) => api<Question>(`/seller/questions/${id}/answer`, { method: 'PUT', body: { answer, publish } }),
  hideQuestion: (id: string) => api<Question>(`/seller/questions/${id}/hide`, { body: {} }),
  publishQuestion: (id: string) => api<Question>(`/seller/questions/${id}/publish`, { body: {} }),
  csvValidate: (file: File) => { const f = new FormData(); f.append('file', file); return api<CsvValidation>(`${P}/csv/validate`, { form: f }) },
  csvImport: (file: File) => { const f = new FormData(); f.append('file', file); return api<{ imported: number; skipped: number; created: { id: string; row: number; title: string }[] }>(`${P}/csv/import`, { form: f }) },
}

/** Fetches a protected file (CSV, image) with the bearer token and returns a blob. Images can't use <img src> directly because the API needs the Authorization header. */
export async function fetchBlob(path: string, retried = false): Promise<Blob> {
  const res = await fetch(path.startsWith('/api/') ? path : '/api/v1' + path, { headers: { Authorization: `Bearer ${tokenStore.get() ?? ''}` }, credentials: 'same-origin' })
  if (res.status === 401 && !retried && (await refreshSession())) return fetchBlob(path, true) // expired token: refresh once, like api() and uploadImage()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
