import type { OptionDto, VariantDto } from '../types'

export const MAX_OPTIONS = 3, MAX_VALUES = 20, MAX_VARIANTS = 100
export const comboKey = (values: string[]) => values.map((v) => v.trim().toLowerCase()).join('|')

export function combos(options: OptionDto[]): string[][] {
  const lists = options.map((o) => o.values.map((v) => v.trim()).filter(Boolean))
  if (lists.length === 0 || lists.some((l) => l.length === 0)) return []
  return lists.reduce<string[][]>((acc, vals) => acc.flatMap((a) => vals.map((v) => [...a, v])), [[]])
}

/** Rebuilds the grid for the current options, keeping what the seller already typed for combinations that still exist. */
export function syncVariants(options: OptionDto[], existing: VariantDto[]): VariantDto[] {
  const byKey = new Map(existing.map((v) => [comboKey(v.values), v]))
  return combos(options).map((values) => byKey.get(comboKey(values)) ?? { values, sku: null, price: null, quantity: 0, barcode: null, enabled: true })
}

export const variantCount = (options: OptionDto[]) => combos(options).length
