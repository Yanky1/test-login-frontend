import { useState } from 'react'
import { Alert, Button } from '../components/ui'
import { Dialog, SelectField, TextField, Toggle } from '../products/ui'
import { servicesApi } from './api'
import { errText, toIso } from './ActionDialogs'
import { addDays, localDate } from './time'
import type { BlockDto } from './types'

/** Create a manual "busy" block or time off (all-day by local date, or a time range) for one provider. */
export function BlockDialog({ providers, defaultProvider, tz, defaultDate, onClose, onSaved }: { providers: { membershipId: string; email: string; timeZone?: string }[]; defaultProvider: string; tz: string; defaultDate?: string; onClose: () => void; onSaved: (affected: number) => void }) {
  const today = defaultDate ?? localDate(new Date(), tz)
  const [provider, setProvider] = useState(defaultProvider)
  const [kind, setKind] = useState<'busy' | 'timeoff'>('busy')
  const [allDay, setAllDay] = useState(false)
  const [date, setDate] = useState(today); const [endDate, setEndDate] = useState(today)
  const [start, setStart] = useState('09:00'); const [end, setEnd] = useState('10:00')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const zone = providers.find((p) => p.membershipId === provider)?.timeZone ?? tz
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (allDay && endDate < date) { setErr('The last day must be on or after the first day.'); return }
    let body
    if (allDay) body = { kind, allDay: true, date, endDate, note: note || undefined }
    else {
      const s = toIso(date, start, zone); const en = toIso(date, end, zone)
      if (!s || !en || en <= s) { setErr('The end time must be after the start time.'); return }
      body = { kind, start: s, end: en, note: note || undefined }
    }
    setBusy(true)
    try { const r = await servicesApi.addBlock(provider, body); onSaved(r.affectedBookings); onClose() } catch (x) { setErr(errText(x)); setBusy(false) }
  }
  return (
    <Dialog title="Block time" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {providers.length > 1 && <SelectField id="bk-prov" label="Team member" value={provider} onChange={(e) => setProvider(e.target.value)}>{providers.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.email}</option>)}</SelectField>}
        <SelectField id="bk-kind" label="What is it?" value={kind} onChange={(e) => setKind(e.target.value as 'busy' | 'timeoff')}><option value="busy">Busy (a one-off block)</option><option value="timeoff">Time off / holiday</option></SelectField>
        <Toggle id="bk-all" label="All day" checked={allDay} onChange={setAllDay} />
        <p className="tz-note">Time zone: {zone}</p>
        <div className="grid2">
          <TextField id="bk-date" label={allDay ? 'First day' : 'Date'} type="date" value={date} onChange={(e) => { setDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value) }} />
          {allDay ? <TextField id="bk-end-date" label="Last day" type="date" value={endDate} min={date} max={addDays(date, 365)} onChange={(e) => setEndDate(e.target.value)} />
            : <><TextField id="bk-start" label="From" type="time" value={start} onChange={(e) => setStart(e.target.value)} /><TextField id="bk-end" label="Until" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></>}
        </div>
        <TextField id="bk-note" label="Note" optional maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <Alert>{err}</Alert>
        <div className="dialog-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Block this time</Button></div>
      </form>
    </Dialog>
  )
}

export function BlockDetail({ block, tz, canDelete, onClose, onDeleted }: { block: BlockDto; tz: string; canDelete: boolean; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [sure, setSure] = useState(false)
  const del = async () => { setBusy(true); try { await servicesApi.deleteBlock(block.providerId, block.id); onDeleted(); onClose() } catch (x) { setErr(errText(x)); setBusy(false) } }
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: block.allDay ? undefined : 'short' }).format(new Date(iso))
  return (
    <Dialog title={block.kind === 'timeoff' ? 'Time off' : 'Busy'} onClose={onClose}>
      <p>{fmt(block.startAt)} – {fmt(block.endAt)}{block.note ? ` · ${block.note}` : ''}</p>
      <Alert>{err}</Alert>
      <div className="dialog-actions">
        <Button onClick={onClose}>Close</Button>
        {canDelete && (sure ? <Button variant="destructive" loading={busy} onClick={() => void del()}>Yes, remove it</Button> : <Button variant="destructive" onClick={() => setSure(true)}>Remove this block</Button>)}
      </div>
    </Dialog>
  )
}
