import { api, ApiError } from '../api'
import { newId, type DriverEventBody } from './api'
import { DRIVER_DB, DRIVER_PREFIX, touchDriverQueue } from './storage'

/**
 * Offline queue of the driver app. Everything a driver does (start route, photos, events) is written here FIRST and sent in order when the network is
 * there: a flaky connection never loses a delivery. Events carry a client event id (the server applies each id once) and the time they happened;
 * the server orders by those times. Photos are uploaded first (idempotent on their client id) and the event then references the server ids.
 *
 * What counts as "try again later" matters: losing a queued delivery because of a transient problem is the worst outcome. See `classify`.
 */
export type QueueItem =
  | { id: string; kind: 'start'; routeId: string; attempts?: number; notBefore?: number }
  | { id: string; kind: 'proof'; stopId: string; clientId: string; proofKind: 'photo' | 'signature'; blobKey: string; attempts?: number; notBefore?: number }
  | { id: string; kind: 'event'; stopId: string; body: Omit<DriverEventBody, 'proofIds'>; proofClientIds: string[]; attempts?: number; notBefore?: number }

export interface QueueFailure { id: string; kind: QueueItem['kind']; stopId?: string; message: string; code?: string }
export interface QueueNotice { stopId: string; message: string }

export interface BlobStore {
  put(key: string, blob: Blob): Promise<void>
  get(key: string): Promise<Blob | null>
  del(key: string): Promise<void>
}

export class MemoryBlobs implements BlobStore {
  private m = new Map<string, Blob>()
  async put(k: string, b: Blob) { this.m.set(k, b) }
  async get(k: string) { return this.m.get(k) ?? null }
  async del(k: string) { this.m.delete(k) }
  get size() { return this.m.size }
}

/** IndexedDB-backed blobs (photos survive a reload / a killed tab); falls back to memory when IndexedDB is unavailable. Connections are closed after every operation so the database can be deleted at log-out. */
export function browserBlobs(): BlobStore {
  if (typeof indexedDB === 'undefined') return new MemoryBlobs()
  const open = () => new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DRIVER_DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('blobs')
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open()
    try { return await new Promise<T>((res, rej) => { const r = f(db.transaction('blobs', mode).objectStore('blobs')); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) }
    finally { db.close() }
  }
  return {
    put: async (k, b) => { await run('readwrite', (s) => s.put(b, k)) },
    get: async (k) => ((await run('readonly', (s) => s.get(k) as IDBRequest<Blob | undefined>)) ?? null),
    del: async (k) => { await run('readwrite', (s) => s.delete(k)) },
  }
}

export interface KeyValue { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export type Sender = {
  start(routeId: string): Promise<unknown>
  upload(stopId: string, clientId: string, kind: string, blob: Blob): Promise<{ id: string }>
  event(stopId: string, body: DriverEventBody): Promise<unknown>
}

export const httpSender: Sender = {
  start: (routeId) => api(`/driver/routes/${routeId}/start`, { method: 'POST' }),
  upload: (stopId, clientId, kind, blob) => {
    const form = new FormData(); form.append('file', blob, kind === 'signature' ? 'signature.png' : 'photo.jpg'); form.append('kind', kind); form.append('clientId', clientId)
    return api<{ id: string }>(`/driver/stops/${stopId}/proofs`, { form })
  },
  event: (stopId, body) => api(`/driver/stops/${stopId}/events`, { body }),
}

/**
 * - `retry`: no answer / busy server (network error, 5xx, 408, 429): keep everything and try again later.
 * - `pause`: the SESSION is the problem, not the item (401, or 403 no_active_account / driver_forbidden): stop flushing and keep every item until the driver is signed in again.
 * - `backoff`: a concurrent change (409 version_conflict): keep the item, resend the SAME client event id after a growing delay.
 * - `final`: the server understood and refused (validation, invalid_state, stop_finished, missing stop): the item can never succeed, tell the driver.
 */
export type Outcome = 'retry' | 'pause' | 'backoff' | 'final'
export function classify(e: unknown): Outcome {
  if (!(e instanceof ApiError)) return 'retry'
  if (e.status >= 500 || e.status === 408 || e.status === 429) return 'retry'
  if (e.status === 401) return 'pause'
  if (e.status === 403 && (e.code === 'no_active_account' || e.code === 'driver_forbidden')) return 'pause'
  if (e.status === 409 && e.code === 'version_conflict') return 'backoff'
  return 'final'
}
/** A 409 that never clears (about 8 tries, minutes apart) must not block every later stop forever: after that it is moved to the failures list, where the driver sees it. */
export const MAX_CONFLICT_ATTEMPTS = 8
export const backoffMs = (attempts: number) => Math.min(5 * 60_000, 2_000 * 2 ** Math.max(0, attempts - 1))

const NOTICE_TEXT: Record<string, string> = {
  ignored_stale: 'A newer update for this stop was already saved, so an older one was skipped.',
  ignored_state: 'This stop was already finished, so that update was skipped.',
}

export class DriverQueue {
  private listeners = new Set<() => void>()
  private flushing: Promise<{ sent: number; offline: boolean; paused: boolean }> | null = null
  private kv: KeyValue
  private blobs: BlobStore
  private send: Sender
  private name: string
  constructor(kv: KeyValue, blobs: BlobStore, send: Sender = httpSender, name = 'default') { this.kv = kv; this.blobs = blobs; this.send = send; this.name = name }

  private key(part: string) { return `${DRIVER_PREFIX}${part}.${this.name}` }
  private read<T>(k: string, d: T): T { try { const v = this.kv.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } }
  private write(k: string, v: unknown) { this.kv.setItem(k, JSON.stringify(v)); if (k === this.key('queue') && this.name !== 'default') touchDriverQueue(this.name); this.listeners.forEach((l) => l()) }

  items = (): QueueItem[] => this.read<QueueItem[]>(this.key('queue'), [])
  failures = (): QueueFailure[] => this.read<QueueFailure[]>(this.key('failures'), [])
  notices = (): QueueNotice[] => this.read<QueueNotice[]>(this.key('notices'), [])
  pending = () => this.items().length
  /** Number of queued things for one stop (to show "waiting to send" on it). */
  pendingFor = (stopId: string) => this.items().filter((i) => 'stopId' in i && i.stopId === stopId).length
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  dismissFailures = () => this.write(this.key('failures'), [])
  dismissNotices = () => this.write(this.key('notices'), [])

  private push(i: QueueItem) { this.write(this.key('queue'), [...this.items(), i]) }
  private drop(id: string) { this.write(this.key('queue'), this.items().filter((i) => i.id !== id)) }
  private patch(id: string, p: Partial<QueueItem>) { this.write(this.key('queue'), this.items().map((i) => (i.id === id ? ({ ...i, ...p } as QueueItem) : i))) }

  enqueueStart(routeId: string) { this.push({ id: newId(), kind: 'start', routeId }) }

  /** Stores the photo/signature and returns its client id (use it in the event). The blob stays on the device until the EVENT that uses it has settled. */
  async enqueueProof(stopId: string, proofKind: 'photo' | 'signature', blob: Blob): Promise<string> {
    const clientId = newId(); const blobKey = newId()
    await this.blobs.put(blobKey, blob)
    this.write(this.key('blobkeys'), { ...this.read<Record<string, string>>(this.key('blobkeys'), {}), [clientId]: blobKey })
    this.push({ id: newId(), kind: 'proof', stopId, clientId, proofKind, blobKey })
    return clientId
  }

  enqueueEvent(stopId: string, body: Omit<DriverEventBody, 'clientEventId' | 'clientAt'> & { clientAt?: string }, proofClientIds: string[] = []) {
    const clientEventId = newId()
    this.push({ id: newId(), kind: 'event', stopId, body: { ...body, clientEventId, clientAt: body.clientAt ?? new Date().toISOString() }, proofClientIds })
    return clientEventId
  }

  /** The event has been sent or finally refused: now (and only now) its photos and their bookkeeping can go. */
  private async settleProofs(clientIds: string[]) {
    const keys = this.read<Record<string, string>>(this.key('blobkeys'), {})
    const map = this.read<Record<string, string>>(this.key('proofmap'), {})
    for (const c of clientIds) { if (keys[c]) { try { await this.blobs.del(keys[c]) } catch { /* ignore */ } } delete keys[c]; delete map[c] }
    this.write(this.key('blobkeys'), keys); this.write(this.key('proofmap'), map)
  }

  /** Sends everything in order. Stops at the first item that must wait (offline, paused session, backing off); a final rejection is moved to the failures list and the rest goes on. */
  flush() {
    if (!this.flushing) this.flushing = this.run().finally(() => { this.flushing = null })
    return this.flushing
  }

  private async run() {
    let sent = 0
    for (;;) {
      const item = this.items()[0]
      if (!item) return { sent, offline: false, paused: false }
      if (item.notBefore && item.notBefore > Date.now()) return { sent, offline: true, paused: false }
      try {
        if (item.kind === 'start') await this.send.start(item.routeId)
        else if (item.kind === 'proof') {
          const blob = await this.blobs.get(item.blobKey)
          if (blob) {
            const r = await this.send.upload(item.stopId, item.clientId, item.proofKind, blob)
            this.write(this.key('proofmap'), { ...this.read<Record<string, string>>(this.key('proofmap'), {}), [item.clientId]: r.id })
          }
        } else {
          const map = this.read<Record<string, string>>(this.key('proofmap'), {})
          const res = await this.send.event(item.stopId, { ...item.body, proofIds: item.proofClientIds.map((c) => map[c]).filter(Boolean) }) as { applied?: boolean; replayed?: boolean; reason?: string; result?: string } | null
          const why = res?.reason ?? res?.result      // a replay (the first answer got lost) reports the stored result instead of a reason: the driver still has to be told
          if (res && res.applied === false && why && NOTICE_TEXT[why]) this.write(this.key('notices'), [...this.notices(), { stopId: item.stopId, message: NOTICE_TEXT[why] }])
          await this.settleProofs(item.proofClientIds)
        }
        this.drop(item.id); sent++
      } catch (e) {
        const o = classify(e)
        if (o === 'retry') return { sent, offline: true, paused: false }
        if (o === 'pause') return { sent, offline: false, paused: true }
        if (o === 'backoff' && (item.attempts ?? 0) + 1 < MAX_CONFLICT_ATTEMPTS) {
          const attempts = (item.attempts ?? 0) + 1
          this.patch(item.id, { attempts, notBefore: Date.now() + backoffMs(attempts) })
          return { sent, offline: true, paused: false }
        }
        const err = e as ApiError
        this.write(this.key('failures'), [...this.failures(), { id: item.id, kind: item.kind, stopId: 'stopId' in item ? item.stopId : undefined, message: err.message2, code: err.code }])
        if (item.kind === 'event') await this.settleProofs(item.proofClientIds)    // a refused proof upload keeps its blob until the event that needed it is refused too
        this.drop(item.id)
      }
    }
  }
}
