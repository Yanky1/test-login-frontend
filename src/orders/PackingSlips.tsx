import { Button } from '../components/ui'
import { Dialog } from '../products/ui'
import type { PackingSlip } from './api'
import { day, money } from './format'

/** Printable packing slips. Everything is rendered from data already in the page (no external images or fonts), and the print stylesheet shows only this area. */
export function PackingSlips({ slips, onClose }: { slips: PackingSlip[]; onClose: () => void }) {
  return (
    <Dialog title={slips.length === 1 ? `Packing slip ${slips[0].number}` : `${slips.length} packing slips`} onClose={onClose} wide>
      <div className="actions no-print"><Button variant="primary" onClick={() => window.print()}>Print</Button><Button variant="ghost" onClick={onClose}>Close</Button></div>
      <div className="print-area">
        {slips.map((s) => (
          <article key={s.id} className="slip" aria-label={`Packing slip ${s.number}`}>
            <header><h3>Packing slip</h3><p><strong>{s.number}</strong> · {s.brandName}<br />Ordered {day(s.placedAt)} · {s.shippingMethod}</p></header>
            <section aria-label="Ship to">
              <h4>Ship to</h4>
              <address>{s.shipTo.name}<br />{s.shipTo.line1}<br />{s.shipTo.line2 && <>{s.shipTo.line2}<br /></>}{s.shipTo.city}{s.shipTo.region ? `, ${s.shipTo.region}` : ''} {s.shipTo.postalCode}<br />{s.shipTo.country}{s.shipTo.phone && <><br />Phone: {s.shipTo.phone}</>}</address>
            </section>
            <table>
              <thead><tr><th scope="col">Item</th><th scope="col">SKU</th><th scope="col">Qty</th>{s.showPrices && <th scope="col">Price</th>}</tr></thead>
              <tbody>{s.lines.map((l, i) => <tr key={i}><td>{l.title}{l.options && <div className="sub">{l.options}</div>}</td><td>{l.sku ?? ''}</td><td>{l.unshipped > 0 ? l.unshipped : l.quantity}{l.unshipped > 0 && l.unshipped !== l.quantity ? ` of ${l.quantity}` : ''}</td>{s.showPrices && <td>{money(l.unitPriceCents, s.currency)}</td>}</tr>)}</tbody>
            </table>
            {s.isGift && <section className="gift" aria-label="Gift message"><h4>Gift message</h4><p>{s.giftMessage}</p></section>}
          </article>
        ))}
      </div>
    </Dialog>
  )
}
