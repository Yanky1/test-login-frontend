import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import { api, tokenStore } from '../api'
import { API } from './testkit'

const streams: AbortSignal[] = []
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), readEvents: vi.fn((signal: AbortSignal) => { streams.push(signal); return new Promise<void>(() => undefined) }) }))

import { resetLive, subscribeLive } from './live'

afterEach(() => { streams.length = 0 })

describe('the shared event stream', () => {
  it('is restarted on an account switch: the old stream is aborted and a new one opens', () => {
    const off = subscribeLive(() => undefined)
    expect(streams).toHaveLength(1); expect(streams[0].aborted).toBe(false)
    resetLive()
    expect(streams[0].aborted).toBe(true); expect(streams).toHaveLength(2); expect(streams[1].aborted).toBe(false)
    off()
    expect(streams[1].aborted).toBe(true)
  })

  it('is aborted when the session ends, so it never keeps streaming for a signed-out user', async () => {
    const off = subscribeLive(() => undefined)
    expect(streams).toHaveLength(1)
    tokenStore.set('t')
    server.use(http.get(`${API}/anything`, () => HttpResponse.json({}, { status: 401 })), http.post(`${API}/auth/refresh`, () => HttpResponse.json({}, { status: 401 })))
    await api('/anything').catch(() => undefined)
    expect(streams[0].aborted).toBe(true)
    off()
  })
})
