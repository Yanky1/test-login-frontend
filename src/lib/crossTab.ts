/** Messages shared between browser tabs of the same signed-in user. */
export type TabMessage =
  | { type: 'activity'; at: number }
  | { type: 'logout'; reason: 'idle' | 'manual' }

export interface CrossTab {
  post(m: TabMessage): void
  subscribe(fn: (m: TabMessage) => void): () => void
}

const CHANNEL = 'solvelt-auth'
const STORAGE_KEY = 'solvelt-auth-msg'

/** BroadcastChannel when available, otherwise `storage` events (which fire in the *other* tabs only). */
export function createCrossTab(): CrossTab {
  if (typeof BroadcastChannel !== 'undefined') {
    const ch = new BroadcastChannel(CHANNEL)
    return {
      post: (m) => { try { ch.postMessage(m) } catch { /* ignore */ } },
      subscribe: (fn) => {
        const h = (e: MessageEvent) => fn(e.data as TabMessage)
        ch.addEventListener('message', h)
        return () => ch.removeEventListener('message', h)
      },
    }
  }
  return {
    post: (m) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ m, n: Math.random() })) } catch { /* ignore */ } },
    subscribe: (fn) => {
      const h = (e: StorageEvent) => {
        if (e.key !== STORAGE_KEY || !e.newValue) return
        try { fn((JSON.parse(e.newValue) as { m: TabMessage }).m) } catch { /* ignore */ }
      }
      window.addEventListener('storage', h)
      return () => window.removeEventListener('storage', h)
    },
  }
}

let instance: CrossTab | null = null
export const crossTab = (): CrossTab => (instance ??= createCrossTab())
export const setCrossTabForTests = (c: CrossTab | null) => { instance = c }

/** Runs `fn` only if no other tab currently holds the named lock (so one tab performs a coordinated action). Falls back to running. */
export async function runExclusively(name: string, fn: () => Promise<void>): Promise<void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks) { await fn(); return }
  await locks.request(name, { ifAvailable: true }, async (lock) => { if (lock) await fn() })
}
