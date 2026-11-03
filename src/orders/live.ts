import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { messagesApi, ordersApi, readEvents, type MessageCounts, type OrderCounts } from './api'

type Listener = (type: string) => void
const listeners = new Set<Listener>()
let abort: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let failures = 0

/** One shared event stream for the whole seller area. On errors it backs off and the 30 s count polling in useBadgeCounts keeps the numbers fresh. */
function connect() {
  if (abort || listeners.size === 0) return
  const ctl = new AbortController(); abort = ctl
  readEvents(ctl.signal, (t) => listeners.forEach((l) => l(t)), () => { failures = 0 })
    .catch(() => undefined)
    .finally(() => {
      if (abort === ctl) abort = null
      if (ctl.signal.aborted || listeners.size === 0) return
      failures++
      timer = setTimeout(connect, Math.min(60_000, 2_000 * 2 ** Math.min(failures, 5)))
    })
}

export function subscribeLive(l: Listener) {
  listeners.add(l)
  connect()
  return () => {
    listeners.delete(l)
    if (listeners.size === 0) { abort?.abort(); abort = null; if (timer) clearTimeout(timer) }
  }
}

/** Runs `reload` when the server announces one of `types` (debounced), so open pages stay current without losing the user's input. */
export function useLiveReload(types: string[], reload: () => void) {
  const fn = useRef(reload); fn.current = reload
  const key = types.join(',')
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const off = subscribeLive((type) => {
      if (!key.split(',').includes(type)) return
      if (t) clearTimeout(t)
      t = setTimeout(() => fn.current(), 400)
    })
    return () => { off(); if (t) clearTimeout(t) }
  }, [key])
}

/** Sidebar badges: orders needing action, unread conversations. Refreshed by live events and every 30 s (the fallback when the stream is unavailable). */
export function useBadgeCounts(): { orders: OrderCounts | null; messages: MessageCounts | null } {
  const { user } = useAuth()
  const account = user?.activeAccountId ?? 'x'
  const [orders, setOrders] = useState<OrderCounts | null>(null)
  const [messages, setMessages] = useState<MessageCounts | null>(null)
  const load = useRef(() => undefined as void)
  load.current = () => {
    ordersApi.counts().then(setOrders).catch(() => undefined)
    messagesApi.counts().then(setMessages).catch(() => undefined)
  }
  useEffect(() => { load.current() }, [account])
  useEffect(() => { const i = setInterval(() => load.current(), 30_000); return () => clearInterval(i) }, [])
  useLiveReload(['order.new', 'order.changed', 'order.cancel_requested', 'order.return_requested', 'message.new', 'message.status', 'message.overdue'], () => load.current())
  return { orders, messages }
}
