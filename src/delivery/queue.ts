import { api, ApiError } from '../api'
import { newId, type DriverEventBody } from './api'

/**
 * Offline queue of the driver app. Everything a driver does (start route, photos, events) is written here FIRST and sent in order when the network is
 * there: a flaky connection never loses a delivery. Events carry a client event id (the server applies each id once) and the time they happened;
 * the server orders by those times. Photos are uploaded first (idempotent on their client id) and the event then references the server ids.
 */
export type QueueItem =
  | { id: string; kind: 'start'; routeId: string }
  | { id: string; kind: 'proof'; stopId: string; clientId: string; proofKind: 'photo' | 'signature'; blobKey: string }
  | { id: string; kind: 'event'; stopId: string; body: Omit<DriverEventBody, 'proofIds'>; proofClientIds: string[] }

export interface QueueFailure { id: string; kind: QueueItem['kind']; stopId?: string; message: string; code?: string }

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
}

/** IndexedDB-backed blobs (photos survive a reload / a killed tab); falls back to memory when IndexedDB is unavailable. */
export function browserBlobs(): BlobStore {
  if (typeof indexedDB === 'undefined') return new MemoryBlobs()
  const open = () => new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('solvelt-driver', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('blobs')
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open()
    return new Promise<T>((res, rej) => { const r = f(db.transaction('blobs', mode).objectStore('blobs')); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
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

/** Network trouble or a busy server: keep the item and try later. Anything else the server answered is final for that item. */
export const isRetryable = (e: unknown) => !(e instanceof ApiError) || e.status >= 500 || e.status === 429 || e.status === 408

export class DriverQueue {
  private listeners = new Set<() => void>()
  private flushing: Promise<{ sent: number; offline: boolean }> | null = null
  private kv: KeyValue
  private blobs: BlobStore
  private send: Sender
  private name: string
  constructor(kv: KeyValue, blobs: BlobStore, send: Sender = httpSender, name = 'default') { this.kv = kv; this.blobs = blobs; this.send = send; this.name = name }

  private get qKey() { return `solvelt.driver.queue.${this.name}` }
  private get mKey() { return `solvelt.driver.proofmap.${this.name}` }
  private get fKey() { return `solvelt.driver.failures.${this.name}` }
  private read<T>(k: string, d: T): T { try { const v = this.kv.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } }
  private write(k: string, v: unknown) { this.kv.setItem(k, JSON.stringify(v)); this.listeners.forEach((l) => l()) }

  items = (): QueueItem[] => this.read<QueueItem[]>(this.qKey, [])
  failures = (): QueueFailure[] => this.read<QueueFailure[]>(this.fKey, [])
  pending = () => this.items().length
  /** Number of queued things for one stop (to show "waiting to send" on it). */
  pendingFor = (stopId: string) => this.items().filter((i) => 'stopId' in i && i.stopId === stopId).length
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  dismissFailures = () => this.write(this.fKey, [])

  private push(i: QueueItem) { this.write(this.qKey, [...this.items(), i]) }
  private drop(id: string) { this.write(this.qKey, this.items().filter((i) => i.id !== id)) }

  enqueueStart(routeId: string) { this.push({ id: newId(), kind: 'start', routeId }) }

  /** Stores the photo/signature and returns its client id (use it in the event). */
  async enqueueProof(stopId: string, proofKind: 'photo' | 'signature', blob: Blob): Promise<string> {
    const clientId = newId(); const blobKey = newId()
    await this.blobs.put(blobKey, blob)
    this.push({ id: newId(), kind: 'proof', stopId, clientId, proofKind, blobKey })
    return clientId
  }

  enqueueEvent(stopId: string, body: Omit<DriverEventBody, 'clientEventId' | 'clientAt'> & { clientAt?: string }, proofClientIds: string[] = []) {
    const clientEventId = newId()
    this.push({ id: newId(), kind: 'event', stopId, body: { ...body, clientEventId, clientAt: body.clientAt ?? new Date().toISOString() }, proofClientIds })
    return clientEventId
  }

  /** Sends everything in order. Stops at the first retryable error (offline); a final rejection is moved to the failures list and the rest goes on. */
  flush() {
    if (!this.flushing) this.flushing = this.run().finally(() => { this.flushing = null })
    return this.flushing
  }

  private async run() {
    let sent = 0
    for (;;) {
      const item = this.items()[0]
      if (!item) return { sent, offline: false }
      try {
        if (item.kind === 'start') await this.send.start(item.routeId)
        else if (item.kind === 'proof') {
          const blob = await this.blobs.get(item.blobKey)
          if (blob) {
            const r = await this.send.upload(item.stopId, item.clientId, item.proofKind, blob)
            this.write(this.mKey, { ...this.read<Record<string, string>>(this.mKey, {}), [item.clientId]: r.id })
          }
          await this.blobs.del(item.blobKey)
        } else {
          const map = this.read<Record<string, string>>(this.mKey, {})
          await this.send.event(item.stopId, { ...item.body, proofIds: item.proofClientIds.map((c) => map[c]).filter(Boolean) })
        }
        this.drop(item.id); sent++
      } catch (e) {
        if (isRetryable(e)) return { sent, offline: true }
        const err = e as ApiError
        this.write(this.fKey, [...this.failures(), { id: item.id, kind: item.kind, stopId: 'stopId' in item ? item.stopId : undefined, message: err.message2, code: err.code }])
        if (item.kind === 'proof') await this.blobs.del(item.blobKey)
        this.drop(item.id)
      }
    }
  }
}
