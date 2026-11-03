import type { EditorApi } from '../useProductEditor'
export type SectionProps = { ed: EditorApi }
export const SECTIONS = [
  { id: 'basics', label: 'Basics' }, { id: 'media', label: 'Photos' }, { id: 'description', label: 'Description' }, { id: 'price', label: 'Price & stock' },
  { id: 'identifiers', label: 'Identifiers' }, { id: 'variations', label: 'Variations' }, { id: 'details', label: 'Product details' }, { id: 'shipping', label: 'Shipping' },
  { id: 'faq', label: 'Q&A' }, { id: 'policies', label: 'Policies' }, { id: 'seo', label: 'Search & SEO' },
] as const
export type SectionId = (typeof SECTIONS)[number]['id']
