export interface FieldConfig {
  key: string
  label: string
  type: 'yesno' | 'text' | 'select' | 'file'
  parentKey: string | null
  parentValue: string | null
  required: boolean
  sortOrder: number
  options: string[] | null
}

/** Same rule as the server: a field shows when it has no parent, or its (visible) parent equals the expected value. */
export function visibleKeys(cfg: FieldConfig[], answers: Record<string, string>): Set<string> {
  const vis = new Set<string>()
  for (const f of [...cfg].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!f.parentKey) vis.add(f.key)
    else if (vis.has(f.parentKey) && answers[f.parentKey] === f.parentValue) vis.add(f.key)
  }
  return vis
}

/** Drops answers of hidden fields (the server clears them too). */
export function pruneAnswers(cfg: FieldConfig[], answers: Record<string, string>): Record<string, string> {
  const vis = visibleKeys(cfg, answers)
  return Object.fromEntries(Object.entries(answers).filter(([k]) => vis.has(k)))
}
