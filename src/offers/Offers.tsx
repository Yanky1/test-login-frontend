import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { DemoPill } from '../demo/DemoPill'
import { money, day } from '../orders/format'
import { ProductsFrame } from '../products/ProductsFrame'
import { useCanWrite } from '../products/usePermissions'
import { PIcon } from '../products/ui'
import { useBrands } from '../pages/teams/BrandContext'
import { offersApi } from './api'
import type { OfferListItem, OfferState, Tier } from './types'
import './offers.css'
import '../products/products.css'

export const STATE_LABEL: Record<OfferState, string> = { draft: 'Draft', scheduled: 'Scheduled', active: 'Active', expired: 'Expired', ended: 'Ended' }
export const STATE_TONE: Record<OfferState, string> = { draft: 'st-draft', scheduled: 'warn', active: 'ok', expired: 'st-archived', ended: 'st-archived' }
export const SCOPE_LABEL = { all: 'All products', category: 'Categories', products: 'Chosen products' } as const

/** "From 20: $0.90 each · from 50: $0.80 each" (formatting only: the amounts come from the server). */
export const tiersText = (t: Tier[] | null | undefined) =>
  !t || t.length === 0 ? 'No price steps' : t.map((x) => `from ${x.minQuantity}: ${money(x.unitPriceCents)} each`).join(' · ')

export default function OffersPage() {
  const canWrite = useCanWrite()
  const { selected } = useBrands(); const brandId = selected === 'all' ? '' : selected
  const [items, setItems] = useState<OfferListItem[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try { setItems((await offersApi.list(brandId)).items) } catch (e) { setError(e instanceof ApiError ? e.message2 : 'Could not load your offers.') }
  }, [brandId])
  useEffect(() => { void load() }, [load])
  return (
    <ProductsFrame>
      <main className="pwrap" aria-labelledby="page-title">
        <div className="of-head">
          <div>
            <h1 id="page-title" tabIndex={-1}>Offers</h1>
            <p className="lead">Quantity offers: a lower price each when buyers order more, and free gifts from a minimum quantity.</p>
          </div>
          {canWrite && <Link className="btn primary" to="/offers/new"><PIcon name="plus" /> New offer</Link>}
        </div>
        <Alert>{error}</Alert>
        {!items && !error && <div className="skel-table" aria-busy="true" aria-label="Loading offers">{[0, 1].map((i) => <div key={i} className="skeleton row-sk" />)}</div>}
        {items && items.length === 0 && (
          <div className="pempty">
            <PIcon name="star" />
            <h2>No offers yet</h2>
            <p>Create an offer such as “from 20 cards, $0.90 each” or “a free wallet from 10 cards”. Buyers see it on your listings and in their cart.</p>
          </div>
        )}
        {items && items.length > 0 && (
          <ul className="of-list" aria-label="Offers">
            {items.map((o) => (
              <li key={o.id} className="of-card">
                <div>
                  <h2><Link to={`/offers/${o.id}`}>{o.name}</Link></h2>
                  <p>{SCOPE_LABEL[o.scope]} · {tiersText(o.tiers)}{o.giftCount > 0 && ` · ${o.giftCount} free ${o.giftCount === 1 ? 'gift' : 'gifts'}`}</p>
                  <p>{o.brandName}{o.activeTo && ` · until ${day(o.activeTo)}`} · version {o.version}</p>
                </div>
                <div className="of-acts">
                  <span className={`chip ${STATE_TONE[o.state]}`}>{STATE_LABEL[o.state]}</span>
                  {o.demo && <DemoPill />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </ProductsFrame>
  )
}
