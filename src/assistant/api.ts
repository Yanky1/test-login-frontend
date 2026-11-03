import { api, ApiError, csrfToken, refreshSession, tokenStore } from '../api'
import type { ActionCard, AssistantConfig, ChatMessage, ConversationSummary, PageContext, StreamEvent } from './types'

export interface ConfirmResult {
  ok: boolean; code: string; message: string; alreadyDone: boolean
  action: ActionCard; refreshed: ActionCard | null; entity: { kind: string; id: string; label: string } | null
}
export interface ConversationDetail { id: string; title: string; messages: ChatMessage[] }

export const assistantApi = {
  config: () => api<AssistantConfig>('/assistant/config'),
  conversations: () => api<{ items: ConversationSummary[] }>('/assistant/conversations'),
  conversation: (id: string) => api<ConversationDetail>(`/assistant/conversations/${id}`),
  rename: (id: string, title: string) => api<{ id: string; title: string }>(`/assistant/conversations/${id}`, { method: 'PATCH', body: { title } }),
  remove: (id: string) => api<null>(`/assistant/conversations/${id}`, { method: 'DELETE' }),
  removeAll: () => api<{ deleted: number }>('/assistant/conversations', { method: 'DELETE' }),
  /** Confirm needs the CSRF header (the server refuses it without): only a click in this browser can send it. */
  confirm: (id: string) => api<ConfirmResult>(`/assistant/actions/${id}/confirm`, { method: 'POST', body: {}, csrf: true }),
  cancel: (id: string) => api<ConfirmResult>(`/assistant/actions/${id}/cancel`, { method: 'POST', body: {}, csrf: true }),
  action: (id: string) => api<ActionCard>(`/assistant/actions/${id}`),
}

/** Reads a Server-Sent Events body: "event: x\ndata: {json}\n\n" blocks. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader(); const dec = new TextDecoder(); let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2)
        const type = /^event: (.+)$/m.exec(block)?.[1]; const data = /^data: (.*)$/m.exec(block)?.[1]
        if (!type || data === undefined) continue
        try { yield { type, data: JSON.parse(data) } as StreamEvent } catch { /* ignore a malformed block */ }
      }
    }
  } finally { reader.releaseLock() }
}

/** POST /assistant/messages/stream. Pre-flight problems (disabled, budget, validation) come back as plain JSON and throw an ApiError. */
export async function streamMessage(body: { conversationId: string | null; text: string; page?: PageContext | null }, signal: AbortSignal, retried = false): Promise<AsyncGenerator<StreamEvent>> {
  const res = await fetch('/api/v1/assistant/messages/stream', {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenStore.get() ?? ''}`, 'X-CSRF-Token': csrfToken() },
    body: JSON.stringify(body),
  })
  if (res.status === 401 && !retried && (await refreshSession())) return streamMessage(body, signal, true)
  if (!res.ok || !res.body) {
    let b: unknown = null
    try { b = await res.json() } catch { /* not json */ }
    throw new ApiError(res.status, b)
  }
  return parseSse(res.body)
}
