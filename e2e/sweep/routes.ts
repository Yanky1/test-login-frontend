import fs from 'node:fs'

/**
 * Routes come from the router configs, not from a hand list: every <Route path="..."> in src/App.tsx and src/admin/AdminApp.tsx.
 * A page added to the router is therefore swept automatically.
 */
export interface RouteDef { pattern: string; params: string[] }

function parse(file: string, prefix: string, wizardPrefix?: string): string[] {
  const out: string[] = []
  const src = fs.readFileSync(file, 'utf8')
  for (const line of src.split('\n')) {
    if (/<Route\s+index\b/.test(line)) { out.push(prefix || '/'); continue }
    const m = /<Route\s[^>]*?path="([^"]+)"/.exec(line)
    if (!m || m[1] === '*') continue
    let p = m[1]
    if (!p.startsWith('/')) p = `${(wizardPrefix && /Step/.test(line)) ? wizardPrefix : prefix}/${p}`
    out.push(p.replace(/\/+/g, '/'))
  }
  return out
}

export function routeDefs(): RouteDef[] {
  const all = [...parse('src/App.tsx', '', '/signup'), ...parse('src/admin/AdminApp.tsx', '/admin')]
  const unique = [...new Set(all)].filter((p) => !p.startsWith('/dev/') /* dev-only simulator: not a product page */ && !p.startsWith('/admin/*'))
  return unique.map((pattern) => ({ pattern, params: [...pattern.matchAll(/:(\w+)\??/g)].map((m) => m[1]) }))
}

/** Concrete seed URLs: optional params dropped, token params given a dummy value (the "invalid link" state is a page too), id params left to the link crawl. */
export function seeds(defs = routeDefs()): string[] {
  const out = new Set<string>()
  for (const d of defs) {
    const base = d.pattern.replace(/\/:\w+\?/g, '')
    if (/:\w+/.test(base)) {
      if (/:token\b/.test(base)) out.add(base.replace(':token', 'sweep-invalid-token'))
      continue
    }
    out.add(base)
  }
  return [...out]
}

/** Does a pathname match any router pattern? Returns the pattern and its first param name (to cap crawling per pattern). */
export function matchRoute(pathname: string, defs = routeDefs()): { pattern: string; param?: string } | null {
  for (const d of defs) {
    const re = new RegExp('^' + d.pattern.replace(/\/:\w+\?/g, '(?:/[^/]+)?').replace(/:\w+/g, '[^/]+') + '/?$')
    if (re.test(pathname)) return { pattern: d.pattern, param: d.params.at(-1) }
  }
  return null
}
