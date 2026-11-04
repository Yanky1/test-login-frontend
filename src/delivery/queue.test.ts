import { describe, expect, it } from 'vitest'
import { ApiError } from '../api'
import { DriverQueue, MemoryBlobs, type Sender } from './queue'

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } }
type Call = { op: string; stop?: string; body?: Record<string, unknown>; clientId?: string }

function sender(opts: { failWith?: (c: Call) => unknown } = {}) {
  const calls: Call[] = []
  const s: Sender = {
    start: async (routeId) => { const c = { op: 'start', stop: routeId }; calls.push(c); const e = opts.failWith?.(c); if (e) throw e },
    upload: async (stop, clientId, kind) => { const c = { op: 'upload:' + kind, stop, clientId }; calls.push(c); const e = opts.failWith?.(c); if (e) throw e; return { id: 'srv-' + clientId } },
    event: async (stop, body) => { const c = { op: 'event', stop, body: body as unknown as Record<string, unknown> }; calls.push(c); const e = opts.failWith?.(c); if (e) throw e },
  }
  return { s, calls }
}
const offline = () => new TypeError('Failed to fetch')

describe('driver offline queue', () => {
  it('stores first and sends everything in order: start, photos, then the event with the server proof ids', async () => {
    const { s, calls } = sender()
    const q = new DriverQueue(mem(), new MemoryBlobs(), s)
    q.enqueueStart('r1')
    const photo = await q.enqueueProof('s1', 'photo', new Blob(['p']))
    const sig = await q.enqueueProof('s1', 'signature', new Blob(['s']))
    q.enqueueEvent('s1', { type: 'delivered', placement: 'handed_to', recipientName: 'Jane' }, [photo, sig])
    expect(q.pending()).toBe(4); expect(q.pendingFor('s1')).toBe(3)
    const r = await q.flush()
    expect(r).toEqual({ sent: 4, offline: false, paused: false })
    expect(calls.map((c) => c.op)).toEqual(['start', 'upload:photo', 'upload:signature', 'event'])
    expect(calls[3].body).toMatchObject({ type: 'delivered', proofIds: ['srv-' + photo, 'srv-' + sig], placement: 'handed_to' })
    expect(typeof calls[3].body?.clientEventId).toBe('string'); expect(typeof calls[3].body?.clientAt).toBe('string')
    expect(q.pending()).toBe(0)
  })

  it('keeps everything while offline, resumes where it stopped, and resends the SAME client event id', async () => {
    let down = true
    const { s, calls } = sender({ failWith: () => (down ? offline() : null) })
    const q = new DriverQueue(mem(), new MemoryBlobs(), s)
    q.enqueueEvent('s1', { type: 'out_for_delivery' }); q.enqueueEvent('s2', { type: 'failed', reason: 'refused' })
    expect(await q.flush()).toEqual({ sent: 0, offline: true, paused: false })
    expect(q.pending()).toBe(2)
    down = false
    expect((await q.flush()).sent).toBe(2)
    const first = calls.filter((c) => c.stop === 's1')
    expect(first).toHaveLength(2)                                              // one failed attempt, one success
    expect(first[0].body?.clientEventId).toBe(first[1].body?.clientEventId)    // idempotent replay: the server applies this id once
  })

  it('survives a reload: the queue and the proof id map come from storage', async () => {
    const kv = mem(); const blobs = new MemoryBlobs()
    let down = false
    const { s, calls } = sender({ failWith: (c) => (down && c.op === 'event' ? offline() : null) })
    const a = new DriverQueue(kv, blobs, s, 'me')
    const p = await a.enqueueProof('s1', 'photo', new Blob(['p']))
    a.enqueueEvent('s1', { type: 'delivered', placement: 'left_at_door' }, [p])
    down = true; await a.flush()                                              // photo uploaded, event stuck
    const b = new DriverQueue(kv, blobs, s, 'me')                              // "app reopened"
    expect(b.pending()).toBe(1)
    down = false; await b.flush()
    expect(calls.at(-1)?.body?.proofIds).toEqual(['srv-' + p])                 // not re-uploaded, mapping remembered
    expect(calls.filter((c) => c.op.startsWith('upload'))).toHaveLength(1)
  })

  it('treats server 5xx and 429 as "try later" but a final 4xx as a failure that does not block the rest', async () => {
    let n = 0
    const { s, calls } = sender({ failWith: (c) => (c.stop === 's1' ? new ApiError(422, { code: 'proof_required', title: 'A photo is required as proof of delivery.' }) : c.stop === 's2' && n++ < 1 ? new ApiError(503, {}) : null) })
    const q = new DriverQueue(mem(), new MemoryBlobs(), s)
    q.enqueueEvent('s1', { type: 'delivered', placement: 'left_at_door' }); q.enqueueEvent('s2', { type: 'out_for_delivery' })
    expect((await q.flush()).offline).toBe(true)                               // s1 rejected for good, s2 hit a 503 and waits
    expect(q.failures()).toHaveLength(1); expect(q.failures()[0]).toMatchObject({ stopId: 's1', code: 'proof_required' })
    expect(q.pending()).toBe(1)
    expect((await q.flush()).sent).toBe(1)
    expect(q.pending()).toBe(0); expect(calls.filter((c) => c.stop === 's2')).toHaveLength(2)
    q.dismissFailures(); expect(q.failures()).toHaveLength(0)
  })

  it('never sends two flushes at once and notifies subscribers', async () => {
    const { s, calls } = sender(); const q = new DriverQueue(mem(), new MemoryBlobs(), s)
    let changes = 0; q.subscribe(() => changes++)
    q.enqueueEvent('s1', { type: 'out_for_delivery' })
    const [a, b] = await Promise.all([q.flush(), q.flush()])
    expect(a).toBe(b); expect(calls).toHaveLength(1); expect(changes).toBeGreaterThan(1)
  })
})
