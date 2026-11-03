import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../../api'
import { useAuth } from '../../auth'
import type { Brand } from '../../lib/teams'

interface Ctx { brands: Brand[]; selected: string; setSelected: (id: string) => void; reload: () => Promise<void> }
const BrandCtx = createContext<Ctx>({ brands: [], selected: 'all', setSelected: () => undefined, reload: async () => undefined })
export const useBrands = () => useContext(BrandCtx)

const key = (account: string) => `solvelt-brand:${account}`

/** The brands the signed-in member may see in the active account, plus the "current brand" filter (remembered per account, per tab). */
export function BrandProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const account = user?.activeAccountId ?? null
  const [brands, setBrands] = useState<Brand[]>([])
  const [selected, setSel] = useState('all')
  const reload = useCallback(async () => {
    if (!account) { setBrands([]); return }
    try { setBrands(await api<Brand[]>('/brands')) } catch { setBrands([]) }
  }, [account])
  useEffect(() => {
    void reload()
    try { setSel(sessionStorage.getItem(key(account ?? '')) ?? 'all') } catch { setSel('all') }
  }, [account, reload])
  const setSelected = useCallback((id: string) => {
    setSel(id)
    try { if (account) sessionStorage.setItem(key(account), id) } catch { /* ignore */ }
  }, [account])
  const value = useMemo(() => ({ brands, selected: selected === 'all' || brands.some((b) => b.id === selected) ? selected : 'all', setSelected, reload }), [brands, selected, setSelected, reload])
  return <BrandCtx.Provider value={value}>{children}</BrandCtx.Provider>
}

export function BrandSwitcher() {
  const { brands, selected, setSelected } = useBrands()
  if (brands.length < 2) return null
  return (
    <label className="brand-switch">
      <span className="sr-only">Brand</span>
      <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Brand">
        <option value="all">All brands</option>
        {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  )
}
