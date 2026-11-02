import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './server'
import { tokenStore } from '../api'
import { resetPublicConfigCache } from '../lib/publicConfig'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' } as Parameters<typeof server.listen>[0] & { onUnhandledRequest: string }))
afterEach(() => { cleanup(); server.resetHandlers(); tokenStore.set(null); resetPublicConfigCache(); document.cookie = 'sl_csrf=; Max-Age=0'; sessionStorage.clear() })
afterAll(() => server.close())
