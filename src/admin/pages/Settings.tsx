import { useEffect, useState } from 'react'
import { Alert, Button, Field } from '../../components/ui'
import { AdminError, adminApi } from '../api'
import { Can, ErrorNote, KV, Loading, PageHeader, Panel, ReasonAction, useLoad } from '../components'

interface Settings {
  marketplace: { feeBasisPoints: number; feePercent: number; overridden: boolean }
  legal: { termsVersion: string; sellerAgreementVersion: string; sellersOnOlderTerms: number; sellersOnOlderAgreement: number; reacceptance: string }
  featureFlags: Record<string, string | null>
}
interface FieldDef { key: string; label: string; type: 'yesno' | 'text' | 'select' | 'file'; options: string[] | null; parentKey: string | null; parentValue: string | null; required: boolean; sortOrder: number }
interface Draft extends Omit<FieldDef, 'options'> { options: string }

const toDraft = (f: FieldDef): Draft => ({ ...f, options: (f.options ?? []).join(', '), parentKey: f.parentKey ?? '', parentValue: f.parentValue ?? '' } as Draft)
const toDef = (d: Draft, i: number): FieldDef => ({
  key: d.key.trim(), label: d.label.trim(), type: d.type, options: d.type === 'select' ? d.options.split(',').map((x) => x.trim()).filter(Boolean) : null,
  parentKey: d.parentKey || null, parentValue: d.parentKey ? d.parentValue || null : null, required: d.required, sortOrder: i + 1,
})

function FeeCard({ s, reload }: { s: Settings; reload: () => void }) {
  const [bps, setBps] = useState(String(s.marketplace.feeBasisPoints))
  const [msg, setMsg] = useState<string | null>(null)
  const n = Number(bps)
  const valid = Number.isInteger(n) && n >= 0 && n <= 5000
  return (
    <Panel title="Marketplace fee">
      <p>Applies to orders received from now on; existing orders keep their fee. Currently <strong>{s.marketplace.feePercent}%</strong> ({s.marketplace.feeBasisPoints} basis points{s.marketplace.overridden ? ', set here' : ', default from configuration'}).</p>
      <Alert kind="success">{msg ?? ''}</Alert>
      <Can permission="SettingsEdit">
        <div className="adm-filters">
          <Field label="Fee in basis points (100 = 1%)" type="number" min={0} max={5000} value={bps} onChange={(e) => setBps(e.target.value)} error={valid ? undefined : 'Use a whole number from 0 to 5000.'} />
          <ReasonAction label="Save fee" variant="primary" disabled={!valid || n === s.marketplace.feeBasisPoints} onDone={() => { setMsg('Fee saved.'); reload() }}
            dialog={{ title: 'Change the marketplace fee', lead: `From ${s.marketplace.feePercent}% to ${n / 100}% for new orders. You will be asked for your authenticator code.`, confirm: 'Save fee', onSubmit: (reason) => adminApi('/settings/fee', { method: 'PUT', body: { feeBasisPoints: n, reason } }) }} />
        </div>
      </Can>
    </Panel>
  )
}

function LegalCard({ s, reload }: { s: Settings; reload: () => void }) {
  const [terms, setTerms] = useState(s.legal.termsVersion); const [agr, setAgr] = useState(s.legal.sellerAgreementVersion); const [msg, setMsg] = useState<string | null>(null)
  const changed = terms !== s.legal.termsVersion || agr !== s.legal.sellerAgreementVersion
  return (
    <Panel title="Terms and Seller Agreement versions">
      <KV items={[['Terms version', s.legal.termsVersion], ['Seller Agreement version', s.legal.sellerAgreementVersion], ['Sellers on an older Terms version', s.legal.sellersOnOlderTerms], ['Sellers on an older Agreement version', s.legal.sellersOnOlderAgreement]]} />
      <p className="adm-muted">{s.legal.reacceptance}</p>
      <Alert kind="success">{msg ?? ''}</Alert>
      <Can permission="SettingsEdit">
        <div className="adm-filters">
          <Field label="New Terms version" value={terms} onChange={(e) => setTerms(e.target.value)} hint="Letters, digits, dots and dashes, e.g. 2026-07" />
          <Field label="New Seller Agreement version" value={agr} onChange={(e) => setAgr(e.target.value)} />
          <ReasonAction label="Bump versions" variant="primary" disabled={!changed} onDone={() => { setMsg('Versions saved. New sign-ups and submissions use them.'); reload() }}
            dialog={{ title: 'Bump the legal versions', lead: 'Every new acceptance records the new version. You will be asked for your authenticator code.', confirm: 'Save versions',
              onSubmit: (reason) => adminApi('/settings/legal', { method: 'PUT', body: { termsVersion: terms !== s.legal.termsVersion ? terms : undefined, sellerAgreementVersion: agr !== s.legal.sellerAgreementVersion ? agr : undefined, reason } }) }} />
        </div>
      </Can>
    </Panel>
  )
}

function FieldEditor() {
  const { data, error, loading, reload } = useLoad(() => adminApi<{ fields: FieldDef[] }>('/settings/seller-fields'), [])
  const [rows, setRows] = useState<Draft[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<{ key: string; label: string; parentKey: string | null; visible: boolean }[] | null>(null)
  const [perr, setPerr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { if (data) setRows(data.fields.map(toDraft)) }, [data])
  const edit = (i: number, patch: Partial<Draft>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: -1 | 1) => setRows((r) => { const j = i + d; if (j < 0 || j >= r.length) return r; const c = [...r];[c[i], c[j]] = [c[j], c[i]]; return c })
  const defs = rows.map(toDef)
  const runPreview = async () => {
    setPerr(null)
    try { setPreview((await adminApi<{ fields: { key: string; label: string; parentKey: string | null; visible: boolean }[] }>('/settings/seller-fields/preview', { body: { fields: defs, answers } })).fields) }
    catch (e) { setPreview(null); setPerr(e instanceof AdminError ? Object.values(e.body?.errors ?? {}).flat().join(' ') || e.text : 'Preview failed') }
  }
  if (loading && !data) return <Loading />
  return (
    <Panel title="Seller application questions (kosher and business fields)">
      <p className="adm-muted">Order matters: a branch question must come after the question it depends on. The certificate upload field is required by the application and can’t be removed.</p>
      <ErrorNote error={error} retry={reload} />
      <Alert kind="success">{msg ?? ''}</Alert>
      <ol className="adm-fields">
        {rows.map((r, i) => (
          <li key={i} className="adm-fieldrow">
            <div className="adm-fieldgrid">
              <Field label={`Key (field ${i + 1})`} value={r.key} onChange={(e) => edit(i, { key: e.target.value })} disabled={r.key === 'kosher_certificate'} />
              <Field label={`Question text (field ${i + 1})`} value={r.label} onChange={(e) => edit(i, { label: e.target.value })} />
              <div className="field"><label htmlFor={`t-${i}`}>Type</label>
                <select id={`t-${i}`} value={r.type} disabled={r.key === 'kosher_certificate'} onChange={(e) => edit(i, { type: e.target.value as Draft['type'] })}><option value="yesno">Yes / No</option><option value="text">Text</option><option value="select">Choice list</option><option value="file">File upload</option></select></div>
              {r.type === 'select' && <Field label={`Choices (comma separated, field ${i + 1})`} value={r.options} onChange={(e) => edit(i, { options: e.target.value })} />}
              <div className="field"><label htmlFor={`p-${i}`}>Only ask when this question…</label>
                <select id={`p-${i}`} value={r.parentKey ?? ''} onChange={(e) => edit(i, { parentKey: e.target.value, parentValue: '' })}><option value="">Always ask</option>{rows.slice(0, i).filter((x) => x.type === 'yesno' || x.type === 'select').map((x) => <option key={x.key} value={x.key}>{x.key}</option>)}</select></div>
              {r.parentKey ? <Field label={`…is answered (field ${i + 1})`} value={r.parentValue ?? ''} onChange={(e) => edit(i, { parentValue: e.target.value })} hint="yes / no, or one of the choices" /> : <span />}
              <div className="field adm-check"><label><input type="checkbox" checked={r.required} onChange={(e) => edit(i, { required: e.target.checked })} /> Required</label></div>
            </div>
            <div className="adm-rowactions">
              <Button disabled={i === 0} onClick={() => move(i, -1)}>Move up{' '}<span className="sr-only">field {i + 1}</span></Button>
              <Button disabled={i === rows.length - 1} onClick={() => move(i, 1)}>Move down{' '}<span className="sr-only">field {i + 1}</span></Button>
              {r.key !== 'kosher_certificate' && <Button variant="destructive" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove{' '}<span className="sr-only">field {i + 1}</span></Button>}
            </div>
          </li>
        ))}
      </ol>
      <Can permission="SettingsEdit"><Button onClick={() => setRows((r) => [...r, { key: '', label: '', type: 'text', options: '', parentKey: '', parentValue: '', required: true, sortOrder: r.length + 1 }])}>Add a question</Button></Can>

      <h3 className="adm-h3">Branching preview</h3>
      <p className="adm-muted">Pick sample answers to see which questions a seller would be asked.</p>
      <div className="adm-filters">
        {rows.filter((r) => r.key && (r.type === 'yesno' || r.type === 'select')).map((r) => (
          <div className="field" key={r.key}><label htmlFor={`a-${r.key}`}>{r.label || r.key}</label>
            <select id={`a-${r.key}`} value={answers[r.key] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [r.key]: e.target.value }))}>
              <option value="">No answer</option>{(r.type === 'yesno' ? ['yes', 'no'] : r.options.split(',').map((x) => x.trim()).filter(Boolean)).map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
        ))}
        <Button onClick={runPreview}>Show preview</Button>
      </div>
      <Alert>{perr}</Alert>
      {preview && <ol className="adm-preview" aria-label="Preview of the questions">{preview.map((p) => <li key={p.key} className={p.visible ? 'on' : 'off'}>{p.visible ? '✓ Asked' : '— Hidden'}: {p.label}{p.parentKey ? ` (depends on ${p.parentKey})` : ''}</li>)}</ol>}
      <Can permission="SettingsEdit">
        <div className="adm-actionrow">
          <ReasonAction label="Save questions" variant="primary" onDone={() => { setMsg('Questions saved. New applications use them.'); reload() }}
            dialog={{ title: 'Save the application questions', lead: 'Sellers who are already in the wizard see the new questions. Answers to removed questions are dropped. You will be asked for your authenticator code.', confirm: 'Save questions',
              onSubmit: (reason) => adminApi('/settings/seller-fields', { method: 'PUT', body: { fields: defs, reason } }) }} />
        </div>
      </Can>
    </Panel>
  )
}

export default function Settings() {
  const { data, error, loading, reload } = useLoad(() => adminApi<Settings>('/settings'), [])
  return (
    <>
      <PageHeader title="Platform settings" lead="Changes here affect every seller. Each change needs a reason and a fresh authenticator code, and is audited with before and after." />
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <FeeCard s={data} reload={reload} />
          <LegalCard s={data} reload={reload} />
          <FieldEditor />
          <Panel title="Feature flags and switches (read-only)">
            <KV items={Object.entries(data.featureFlags).map(([k, v]) => [k, v ?? '—'])} />
            <p className="adm-muted">These live in server configuration and are changed by deployment, not here.</p>
          </Panel>
        </>
      )}
    </>
  )
}
