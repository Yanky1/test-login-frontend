import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { ApiError } from '../api'
import { useAuth } from '../auth'
import { assistantApi, streamMessage, type ConfirmResult } from './api'
import { pageContextFor } from './routes'
import type { ActionCard, AssistantConfig, ChatMessage, ConversationSummary, StreamEvent, ToolStep } from './types'

interface Ctx {
  config: AssistantConfig | null
  open: boolean; setOpen: (v: boolean) => void
  messages: ChatMessage[]; conversationId: string | null; conversations: ConversationSummary[]
  busy: boolean; loading: boolean; error: string | null
  send: (text: string) => Promise<void>; stop: () => void; retry: () => void
  newChat: () => void; select: (id: string) => Promise<void>; rename: (id: string, title: string) => Promise<void>
  removeConversation: (id: string) => Promise<void>; removeAll: () => Promise<void>; reloadConversations: () => Promise<void>
  confirm: (card: ActionCard) => Promise<void>; cancel: (card: ActionCard) => Promise<void>
  acting: ReadonlySet<string>
  pathname: string
}
const AssistantCtx = createContext<Ctx | null>(null)
export function useAssistant(): Ctx { const c = useContext(AssistantCtx); if (!c) throw new Error('AssistantProvider missing'); return c }
export const useAssistantOptional = () => useContext(AssistantCtx)

let localId = 0
const lid = () => `local-${++localId}`

/** Server message -> UI message (stored tool summaries become finished steps). */
function fromServer(m: Record<string, unknown>): ChatMessage {
  const tools = (m.tools as { name: string; label: string; ok: boolean }[] | undefined) ?? []
  return {
    id: m.id as string, role: m.role as ChatMessage['role'], text: m.text as string, status: m.status as string | undefined, createdAt: m.createdAt as string | undefined,
    links: (m.links as ChatMessage['links']) ?? [], actions: (m.actions as ActionCard[]) ?? [],
    steps: tools.map((t, i) => ({ id: `${m.id}-${i}`, name: t.name, label: t.label, status: t.ok ? 'done' : 'error' }) as ToolStep),
  }
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const account = user?.activeAccountId ?? 'none'
  const [config, setConfig] = useState<AssistantConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<ReadonlySet<string>>(new Set())
  const abort = useRef<AbortController | null>(null)
  const convRef = useRef<string | null>(null); convRef.current = conversationId
  const pageRef = useRef(pathname); pageRef.current = pathname
  const lastText = useRef('')

  // config: hides the entry point when the feature is off or the server has none
  useEffect(() => {
    let live = true
    if (user?.accounts && !user.activeAccountId) { setConfig(null); return }   // no account picked yet: nothing to ask the server
    assistantApi.config().then((c) => { if (live) setConfig(c) }).catch(() => { if (live) setConfig(null) })
    return () => { live = false; abort.current?.abort() }
  }, [account]) // eslint-disable-line react-hooks/exhaustive-deps

  const reloadConversations = useCallback(async () => {
    try { setConversations((await assistantApi.conversations()).items) } catch { /* the list is a convenience */ }
  }, [])
  useEffect(() => { if (open) void reloadConversations() }, [open, reloadConversations])

  const patchMessage = useCallback((id: string, f: (m: ChatMessage) => ChatMessage) => setMessages((ms) => ms.map((m) => (m.id === id ? f(m) : m))), [])

  const send = useCallback(async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    lastText.current = text; setError(null); setBusy(true)
    const aId = lid()
    setMessages((ms) => [...ms, { id: lid(), role: 'user', text }, { id: aId, role: 'assistant', text: '', streaming: true, steps: [], actions: [], links: [] }])
    const ac = new AbortController(); abort.current = ac
    try {
      const events = await streamMessage({ conversationId: convRef.current, text, page: pageContextFor(pageRef.current) }, ac.signal)
      for await (const e of events as AsyncGenerator<StreamEvent>) {
        if (e.type === 'conversation') { setConversationId(e.data.conversationId); convRef.current = e.data.conversationId }
        else if (e.type === 'text') patchMessage(aId, (m) => ({ ...m, text: m.text + e.data.delta }))
        else if (e.type === 'tool') patchMessage(aId, (m) => {
          const steps = [...(m.steps ?? [])]; const i = steps.findIndex((s) => s.id === e.data.id)
          if (i >= 0) steps[i] = e.data; else steps.push(e.data)
          return { ...m, steps }
        })
        else if (e.type === 'action') patchMessage(aId, (m) => ({ ...m, actions: [...(m.actions ?? []).filter((a) => a.id !== e.data.id), e.data] }))
        else if (e.type === 'error') patchMessage(aId, (m) => ({ ...m, status: 'error', text: m.text || e.data.message }))
        else if (e.type === 'done') patchMessage(aId, (m) => ({ ...m, id: e.data.messageId, text: e.data.text || m.text, status: e.data.status, links: e.data.links, streaming: false }))
      }
      patchMessage(aId, (m) => ({ ...m, streaming: false }))
      void reloadConversations()
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') patchMessage(aId, (m) => ({ ...m, streaming: false, status: 'stopped', text: m.text || 'Stopped.' }))
      else {
        const msg = err instanceof ApiError ? err.message2 : 'Couldn’t reach the assistant. Check your connection and try again.'
        setError(msg); setMessages((ms) => ms.filter((m) => m.id !== aId))
      }
    } finally { setBusy(false); abort.current = null }
  }, [busy, patchMessage, reloadConversations])

  const stop = useCallback(() => abort.current?.abort(), [])
  const retry = useCallback(() => {
    if (busy) return
    // drop the failed answer and ask again
    setMessages((ms) => { const i = ms.map((m) => m.role).lastIndexOf('user'); return i >= 0 ? ms.slice(0, i) : ms })
    void send(lastText.current)
  }, [busy, send])

  const newChat = useCallback(() => { abort.current?.abort(); setMessages([]); setConversationId(null); setError(null) }, [])
  const select = useCallback(async (id: string) => {
    abort.current?.abort(); setLoading(true); setError(null)
    try {
      const d = await assistantApi.conversation(id)
      setMessages(d.messages.map((m) => fromServer(m as unknown as Record<string, unknown>))); setConversationId(id)
    } catch (e) { setError(e instanceof ApiError ? e.message2 : 'Couldn’t open that conversation.') } finally { setLoading(false) }
  }, [])
  const rename = useCallback(async (id: string, title: string) => { await assistantApi.rename(id, title); await reloadConversations() }, [reloadConversations])
  const removeConversation = useCallback(async (id: string) => {
    await assistantApi.remove(id)
    if (convRef.current === id) newChat()
    await reloadConversations()
  }, [newChat, reloadConversations])
  const removeAll = useCallback(async () => { await assistantApi.removeAll(); newChat(); setConversations([]) }, [newChat])

  const replaceCard = useCallback((card: ActionCard, extra?: ActionCard | null) => setMessages((ms) => ms.map((m) => {
    if (!m.actions?.some((a) => a.id === card.id)) return m
    const actions = m.actions.map((a) => (a.id === card.id ? card : a))
    if (extra && !actions.some((a) => a.id === extra.id)) actions.push(extra)
    return { ...m, actions }
  })), [])
  const note = useCallback((text: string) => setMessages((ms) => [...ms, { id: lid(), role: 'note', text }]), [])
  const markActing = (id: string, on: boolean) => setActing((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })

  const resolve = useCallback(async (card: ActionCard, run: (id: string) => Promise<ConfirmResult>, verb: string) => {
    markActing(card.id, true); setError(null)
    try {
      const r = await run(card.id)
      replaceCard(r.action, r.refreshed)
      note(r.refreshed ? 'This changed since I prepared it, so here is a fresh proposal. Nothing was changed.' : verb === 'confirm' ? `Done: ${r.message}` : 'Cancelled. Nothing was changed.')
    } catch (e) {
      if (e instanceof ApiError) {
        const body = e.body as { action?: ActionCard; refreshed?: ActionCard; message?: string } | null
        if (body?.action) { replaceCard(body.action, body.refreshed ?? null); note(body.refreshed ? 'This changed since I prepared it, so here is a fresh proposal. Nothing was changed.' : `I couldn’t do that: ${body.message ?? e.message2}`) }
        else setError(e.status === 403 ? 'You don’t have permission to do this.' : e.message2)
      } else setError('Couldn’t reach the server. Nothing was changed; try again.')
    } finally { markActing(card.id, false) }
  }, [note, replaceCard])
  const confirm = useCallback((c: ActionCard) => resolve(c, assistantApi.confirm, 'confirm'), [resolve])
  const cancel = useCallback((c: ActionCard) => resolve(c, assistantApi.cancel, 'cancel'), [resolve])

  const value = useMemo<Ctx>(() => ({
    config, open, setOpen, messages, conversationId, conversations, busy, loading, error, send, stop, retry, newChat, select, rename, removeConversation, removeAll, reloadConversations,
    confirm, cancel, acting, pathname,
  }), [config, open, messages, conversationId, conversations, busy, loading, error, send, stop, retry, newChat, select, rename, removeConversation, removeAll, reloadConversations, confirm, cancel, acting, pathname])
  return <AssistantCtx.Provider value={value}>{children}</AssistantCtx.Provider>
}
