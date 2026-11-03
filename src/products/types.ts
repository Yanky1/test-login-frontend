export type Status = 'Draft' | 'Active' | 'Inactive' | 'Archived'
export interface Issue { key: string; section: string; severity: 'required' | 'recommended'; message: string }
export interface AttrConfig { key: string; label: string; type: 'text' | 'longtext' | 'number' | 'select' | 'multiselect' | 'bool'; options: string[]; required: boolean; group: string | null; help: string | null; unit: string | null }
export interface Category { id: string; parentId: string | null; name: string; slug: string; path: string; leaf: boolean }
export interface Brand { id: string; name: string; status?: string; isDefault?: boolean }
export interface ImageDto { id: string; url: string; alt: string | null; isMain: boolean; variantId: string | null; width: number; height: number; size: number; lowResolution: boolean }
export interface OptionDto { id?: string; name: string; values: string[] }
export interface VariantDto { id?: string; values: string[]; sku: string | null; price: number | null; quantity: number; barcode: string | null; enabled: boolean }
export interface Faq { id?: string; question: string; answer: string }
export interface Shipping { standardEnabled: boolean; standardPrice: number | null; expressEnabled: boolean; expressPrice: number | null; freeOver: number | null }
export type AttrValue = string | number | boolean | string[]

/** The editable main document (what PUT /seller/products/{id} replaces). */
export interface ProductForm {
  version: number; brandId: string; categoryId: string | null
  title: string; handle: string | null; condition: 'New' | 'Used' | 'Refurbished'; conditionNote: string | null; sku: string | null
  price: number | null; compareAtPrice: number | null; salePrice: number | null; saleStart: string | null; saleEnd: string | null; cost: number | null
  quantity: number | null; lowStockAlert: number | null; allowBackorder: boolean; maxPerOrder: number | null
  barcode: string | null; noBarcode: boolean
  bullets: string[]; description: string | null
  weightGrams: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null; handlingDays: number | null
  shipping: Shipping; localPickup: boolean
  returnsDays: number | null; returnsCondition: string | null; warrantyMonths: number | null; warrantyNote: string | null
  searchTerms: string | null; metaTitle: string | null; metaDescription: string | null
  hasVariants: boolean
  attributes: Record<string, AttrValue>
}

export interface ProductDetail extends ProductForm {
  id: string; status: Status; type?: 'Product' | 'Service'; service?: import('../services/types').ServiceDetails | null; brandName: string | null
  margin: number | null; currentPrice: number | null; onSale: boolean; available: number
  barcodeCheck: { valid: boolean; type: string | null; error: string | null } | null
  descriptionHtml: string
  options: OptionDto[]; variants: VariantDto[]; images: ImageDto[]; faqs: Faq[]
  attributeConfig: AttrConfig[] | null
  qualityScore: number; canPublish: boolean; issues: Issue[]
  createdAt: string; updatedAt: string; publishedAt: string | null
}

export interface ListItem {
  id: string; title: string; sku: string | null; status: Status; brandId: string; brandName: string | null; categoryId: string | null
  price: number | null; currentPrice: number | null; onSale: boolean; quantity: number; hasVariants: boolean; variantCount: number
  type?: 'Product' | 'Service'; priceModel?: string | null; durationMinutes?: number | null; qualityScore: number; canPublish: boolean; needsAttention: boolean; lowStock: boolean; version: number; updatedAt: string; thumbnailUrl: string | null
}
export interface ListResult { items: ListItem[]; total: number; page: number; pageSize: number; counts: { all: number; draft: number; active: number; inactive: number; archived: number; outOfStock: number; attention: number } }

export interface Question { id: string; productId: string; productTitle: string; askerName: string; text: string; answer: string | null; state: 'Pending' | 'Published' | 'Hidden'; answered: boolean; askedAt: string; answeredAt: string | null }
export interface QuestionList { items: Question[]; total: number; page: number; pageSize: number; counts: { unanswered: number; answered: number; hidden: number } }

export interface CsvRow { row: number; ok: boolean; title: string | null; sku: string | null; errors: { field: string; message: string }[] }
export interface CsvValidation { total: number; valid: number; invalid: number; ignoredColumns: string[]; rows: CsvRow[] }
