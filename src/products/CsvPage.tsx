import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { fetchBlob, productsApi, saveBlob } from './api'
import { ProductsFrame } from './ProductsFrame'
import { useBrands } from '../pages/teams/BrandContext'
import { useCanWrite } from './usePermissions'
import { PIcon } from './ui'
import type { CsvValidation } from './types'
import './products.css'

export default function CsvPage() {
  const canWrite = useCanWrite()
  const { selected } = useBrands()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<CsvValidation | null>(null)
  const [done, setDone] = useState<{ imported: number; skipped: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const pick = async (f: File | undefined) => {
    if (!f) return
    setFile(f); setResult(null); setDone(null); setError('')
    if (!/\.csv$/i.test(f.name)) { setError('Choose a .csv file.'); return }
    if (f.size > 1024 * 1024) { setError('The file is larger than 1 MB. Split it into smaller files.'); return }
    setBusy('validate')
    try { setResult(await productsApi.csvValidate(f)) } catch (e) { setError(e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message2) : 'Could not read the file.') } finally { setBusy('') }
  }
  const download = (path: string, name: string) => async () => { setError(''); try { saveBlob(await fetchBlob(path), name) } catch { setError('The download failed. Try again.') } }
  const doImport = async () => {
    if (!file) return
    setBusy('import'); setError('')
    try { const r = await productsApi.csvImport(file); setDone({ imported: r.imported, skipped: r.skipped }); setResult(null); setFile(null) } catch (e) { setError(e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message2) : 'The import failed.') } finally { setBusy('') }
  }
  const bad = result?.rows.filter((r) => !r.ok) ?? []

  return (
    <ProductsFrame>
      <main className="pwrap" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>Bulk upload</h1>
        <p className="lead">Add many products at once from a spreadsheet. Imported products arrive as drafts so you can add photos and review them before publishing.</p>
        <section className="pcard" aria-labelledby="csv-1"><h2 id="csv-1">1. Get the template</h2>
          <p>Download the CSV template with an example row. Photos can't be imported - add them in the product editor afterwards.</p>
          <div className="actions"><Button onClick={download('/seller/products/csv/template', 'solvelt-products-template.csv')}><PIcon name="download" /> Download template</Button>
            <Button variant="ghost" onClick={download(`/seller/products/csv/export${selected === 'all' ? '' : `?brandId=${selected}`}`, 'solvelt-products.csv')}>Export my catalog</Button></div>
        </section>
        {!canWrite ? <Alert kind="info">You have view-only access, so you can download the template and export the catalog but not import.</Alert> : <section className="pcard" aria-labelledby="csv-2"><h2 id="csv-2">2. Upload and check</h2>
          <div className={`dropzone${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void pick(e.dataTransfer.files[0]) }}>
            <PIcon name="upload" /><div><strong>Drop your CSV here</strong> or <Button variant="ghost" type="button" onClick={() => input.current?.click()}>choose a file</Button><div className="hint">Up to 500 rows and 1 MB.</div></div>
            <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" tabIndex={-1} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          {file && <p className="hint">File: {file.name}</p>}
          <Alert>{error}</Alert>
          {busy === 'validate' && <p role="status">Checking your file…</p>}
          {result && (
            <div className="csv-result">
              <p role="status"><strong>{result.valid}</strong> of {result.total} row{result.total === 1 ? '' : 's'} ready to import{result.invalid > 0 && <>, <strong className="warn-text">{result.invalid}</strong> with problems</>}.</p>
              {result.ignoredColumns.length > 0 && <Alert kind="info">Ignored columns: {result.ignoredColumns.join(', ')}.</Alert>}
              {bad.length > 0 && (
                <div className="tablewrap"><table className="ptable csv-errors"><caption>Rows with problems (these will be skipped)</caption>
                  <thead><tr><th scope="col">Row</th><th scope="col">Product</th><th scope="col">Problem</th></tr></thead>
                  <tbody>{bad.map((r) => <tr key={r.row}><th scope="row">{r.row}</th><td>{r.title || r.sku || '-'}</td><td><ul>{r.errors.map((e, i) => <li key={i}><strong>{e.field}:</strong> {e.message}</li>)}</ul></td></tr>)}</tbody></table></div>
              )}
              <div className="actions"><Button variant="primary" loading={busy === 'import'} disabled={result.valid === 0} onClick={() => void doImport()}>Import {result.valid} product{result.valid === 1 ? '' : 's'} as drafts</Button></div>
            </div>
          )}
          {done && <Alert kind="success">Imported {done.imported} product{done.imported === 1 ? '' : 's'} as drafts{done.skipped ? ` (${done.skipped} skipped)` : ''}. <Link to="/products?tab=Draft">View your drafts</Link></Alert>}
        </section>}
      </main>
    </ProductsFrame>
  )
}
