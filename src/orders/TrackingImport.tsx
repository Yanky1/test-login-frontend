import { useRef, useState } from 'react'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { Dialog } from '../products/ui'
import { fetchBlob, saveBlob } from '../products/api'
import { ordersApi, type TrackingPreview } from './api'

/** Mark many orders as shipped from a CSV: download the template, upload, read the row-by-row check, then confirm. Nothing changes until the last step. */
export function TrackingImport({ onClose, onDone }: { onClose: () => void; onDone: (shipped: number) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [res, setRes] = useState<TrackingPreview | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const check = async (f: File) => {
    setFile(f); setRes(null); setError(''); setBusy(true)
    try { setRes(await ordersApi.importTracking(f, false)) } catch (e) { setError(e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message2) : 'Could not read that file.') } finally { setBusy(false) }
  }
  const apply = async () => {
    if (!file) return
    setBusy(true); setError('')
    try { const r = await ordersApi.importTracking(file, true); setRes(r); onDone(r.results.filter((x) => x.applied).length) } catch (e) { setError(e instanceof ApiError ? e.message2 : 'Could not ship these orders.') } finally { setBusy(false) }
  }
  const bad = res ? res.total - res.valid : 0
  return (
    <Dialog title="Mark orders as shipped from a CSV" onClose={onClose} wide>
      <p>Upload a CSV with <code>order_number</code>, <code>carrier</code> and <code>tracking_number</code> (and optionally <code>ship_date</code>, <code>sku</code>, <code>quantity</code> to ship part of an order).</p>
      <p><Button onClick={() => void fetchBlob('/seller/orders/tracking-template.csv').then((b) => saveBlob(b, 'tracking-template.csv'))}>Download the template</Button></p>
      <div className="field">
        <label htmlFor="trk-file">CSV file</label>
        <input id="trk-file" ref={input} type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void check(f) }} />
      </div>
      <Alert>{error}</Alert>
      <div aria-live="polite">
        {busy && <p>Checking…</p>}
        {res && !res.applied && (
          <>
            <p><strong>{`${res.valid} of ${res.total} rows are ready`}</strong>{bad > 0 ? `; ${bad} need fixing` : ''}. Nothing has been changed yet.</p>
            <div className="tablewrap csv-rows">
              <table className="ptable"><caption className="sr-only">Check of each CSV row</caption>
                <thead><tr><th scope="col">Row</th><th scope="col">Order</th><th scope="col">Result</th></tr></thead>
                <tbody>{res.results.map((r) => <tr key={r.row}><td>{r.row}</td><td>{r.orderNumber}</td><td>{r.ok ? <span className="chip ok">Ready to ship</span> : <span className="chip bad">{r.error}</span>}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="actions dlg-actions"><Button variant="primary" disabled={res.valid === 0 || busy} onClick={() => void apply()}>Ship {res.valid} order{res.valid === 1 ? '' : 's'}{bad > 0 ? ' (skip the rest)' : ''}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
          </>
        )}
        {res?.applied && (
          <>
            <Alert kind="success">{res.results.filter((r) => r.applied).length} order(s) shipped.{res.results.some((r) => !r.ok) ? ' Some rows were skipped, see below.' : ''}</Alert>
            {res.results.filter((r) => !r.ok).length > 0 && <ul>{res.results.filter((r) => !r.ok).map((r) => <li key={r.row}>Row {r.row} ({r.orderNumber}): {r.error}</li>)}</ul>}
            <div className="actions dlg-actions"><Button variant="primary" onClick={onClose}>Done</Button></div>
          </>
        )}
      </div>
    </Dialog>
  )
}
