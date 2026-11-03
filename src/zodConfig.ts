import { z } from 'zod'

// Skip zod's runtime code generation: it probes `new Function`, which a strict CSP (no 'unsafe-eval') reports as a violation.
// This must run before any module that builds a schema at import time, so main.tsx imports it first.
z.config({ jitless: true })
