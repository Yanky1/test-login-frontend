import { expect, test, type Page, type TestInfo } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { axeIssues, keyboardIssues, layoutIssues, settle, tagDynamic, type Issue } from './checks'
import { setTheme, signInContext } from './auth'
import { OUT, readState, slug, type Check, type Finding, type Role, type Stat } from './kit'

const ROLES: Role[] = ['anon', 'owner', 'admin', 'manager', 'viewer', 'driver', 'pending', 'superadmin', 'support', 'moderator', 'readonly']
const THEMES = ['light', 'dark'] as const
const only = process.env.SWEEP_ROLES?.split(',')
const MAX_CLICKS = Number(process.env.SWEEP_MAX_CLICKS ?? 80)
const MAX_ROUTES = Number(process.env.SWEEP_MAX_ROUTES ?? 1000)

/** Destructive actions are never clicked (listed in the report instead). Sign-out ends the session, "Approve this account"/"Fill with demo data" change the seeded state the next page relies on. */
const DESTRUCTIVE = /\b(delete|close (my |this |the )?account|void|refund|suspend|remove|deactivate|revoke|reject|ban|terminate|erase|purge|disable|cancel (the |this )?(order|booking|subscription|invitation)|reset (my )?(password|two-factor)|sign out|log ?out|approve this account|fill with demo|demo data)\b/i
/** Visual baseline: Chromium at the two viewports every browser runs (mobile 375, desktop 1280); see docs/DESIGN.md "UI sweep" for why not all of them. */
const VISUAL = new Set(['chromium-375', 'chromium-1280'])
/** 4xx that are the product answering a bad input on purpose (validation / conflict); everything else, and every 5xx, is a finding. */
const EXPECTED_4XX = new Set([400, 409, 422])
const STAFF = new Set<Role>(['superadmin', 'support', 'moderator', 'readonly'])

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h }

for (const role of ROLES) for (const theme of THEMES) {
  if (only && !only.includes(role)) continue
  test(`${role} · ${theme}`, async ({ page, context, browserName }, info) => {
    const project = info.project.name
    const vp = page.viewportSize()!.width * (project.endsWith('zoom200') ? 2 : 1)
    const state = readState()
    const filter = process.env.SWEEP_ROUTE_FILTER ? new RegExp(process.env.SWEEP_ROUTE_FILTER) : null   // local debugging only
    const routes = (state.routes[role] ?? []).filter((r) => !filter || filter.test(r)).slice(0, MAX_ROUTES)
    test.skip(routes.length === 0, `no pages found for ${role}`)
    await setTheme(context, theme); await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await context.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'))   // fixed "now": dates in the UI do not move between runs (seeded rows keep their own timestamps, which are masked in the visual compare)
    await signInContext(context, role, state.accounts[role])
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])   // "Copy ..." buttons need it to show their confirmation

    const findings: Finding[] = [], stats = new Map<string, Stat>(), gallery: { route: string; shot: string }[] = [], skipped: { route: string; label: string }[] = []
    const stat = (check: Check, route: string, items = 0) => { const s = stats.get(check) ?? { check, role, project, theme, pages: 0, items: 0 }; s.pages++; s.items += items; stats.set(check, s) }
    let route = ''
    const add = (check: Check, i: Issue, shot?: string) => findings.push({ check, rule: i.rule, message: i.message, role, route, project, browser: browserName, viewport: vp, theme, shot })

    // console / network collection (reset around each action)
    let log: Issue[] = [], apiCalls = 0
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) log.push({ rule: 'console-error', message: m.text().slice(0, 300) }) })   // "Failed to load resource" is the browser's echo of a failed request, which the network check below reports with its URL
    page.on('pageerror', (e) => log.push({ rule: 'page-error', message: String(e.message).slice(0, 300) }))
    page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls++ })
    page.on('response', (r) => {
      const s = r.status(), u = new URL(r.url())
      if (!u.pathname.startsWith('/api/') || s < 400) return
      if (s >= 500) log.push({ rule: 'http-5xx', message: `${r.request().method()} ${u.pathname} -> ${s}` })
      else if (!EXPECTED_4XX.has(s) && !(s === 401 && (/\/auth\/refresh$/.test(u.pathname) && (role === 'anon' || STAFF.has(role))) ) && !(s === 401 && /\/auth\/login$/.test(u.pathname))) log.push({ rule: 'http-4xx', message: `${r.request().method()} ${u.pathname} -> ${s}` })   // signed out: the refresh probe answers 401 by design
    })
    const flush = (check: Check = 'network') => { for (const l of log) add(/console|page-error/.test(l.rule) ? 'console' : check, l); log = [] }

    const shotPath = (kind: string) => path.join(OUT, 'shots', project, theme, role, `${slug(route)}${kind}.jpg`)
    for (const r of routes) {
      route = r; log = []
      await page.goto(r, { waitUntil: 'load' }); await settle(page)
      flush()
      // ---- screenshots (gallery) — JPEG keeps the artifact small; the pixel-exact baseline is the PNG of toHaveScreenshot below
      const sp = shotPath(''); fs.mkdirSync(path.dirname(sp), { recursive: true })
      await page.screenshot({ path: sp, fullPage: true, type: 'jpeg', quality: 55, animations: 'disabled' })
      gallery.push({ route: r, shot: path.relative(OUT, sp) })
      const rel = path.relative(OUT, sp)

      for (const i of await layoutIssues(page)) add('layout', i, rel); stat('layout', r)
      for (const i of await axeIssues(page)) add('a11y', i, rel); stat('a11y', r)
      for (const i of await keyboardIssues(page, browserName !== 'chromium')) add('keyboard', i, rel); stat('keyboard', r)
      await page.goto(r, { waitUntil: 'load' }); await settle(page)   // the Tab pass moved focus/scroll: start the next checks clean

      if (VISUAL.has(project) && (theme === 'light' || process.env.SWEEP_VISUAL_DARK !== '0')) {
        await tagDynamic(page)
        try {
          await expect(page).toHaveScreenshot([theme, role, `${slug(r)}.png`], { mask: [page.locator('[data-sweep-mask]')], maskColor: '#808080', fullPage: false, timeout: 15_000 })
        } catch (e) {
          const msg = String((e as Error).message)
          if (!/A snapshot doesn't exist/.test(msg)) add('visual', { rule: 'visual-diff', message: msg.split('\n').slice(0, 3).join(' ').slice(0, 300) }, rel)   // a missing baseline is not a finding: the first run creates it
        }
        stat('visual', r)
      }

      // ---- clickables (light theme only: behaviour does not depend on the theme)
      if (theme === 'light') await clickAll(page, r, (c, i, shot) => add(c, i, shot), (l) => skipped.push({ route: r, label: l }), () => { const l = log; log = []; return l }, () => apiCalls, () => stat('clickables', r, 1), context)
    }
    fs.mkdirSync(path.join(OUT, 'data'), { recursive: true })
    const tag = `${project}__${role}__${theme}`
    fs.writeFileSync(path.join(OUT, 'data', `${tag}.json`), JSON.stringify({ project, role, theme, findings, stats: [...stats.values()], gallery, skipped }, null, 1))
    for (const f of findings.slice(0, 40)) info.annotations.push({ type: f.check, description: `${f.route} — ${f.rule}: ${f.message}`.slice(0, 400) })
    expect(findings.length, `${findings.length} sweep finding(s) for ${role} · ${theme} at ${project}; see the gallery / summary`).toBe(0)
  })
}

interface Cand { i: number; label: string; href: string | null; tag: string; active: boolean }

/** Click every visible, enabled button and link once; restore the page (reload) between clicks. */
async function clickAll(page: Page, route: string, add: (c: Check, i: Issue, shot?: string) => void, skip: (label: string) => void, takeLog: () => Issue[], api: () => number, count: () => void, context: import('@playwright/test').BrowserContext) {
  const list = async (): Promise<Cand[]> => page.evaluate(() => {
    document.querySelectorAll('[data-sweep-click]').forEach((e) => e.removeAttribute('data-sweep-click'))
    const out: { i: number; label: string; href: string | null; tag: string; active: boolean }[] = []
    document.querySelectorAll('a[href], button, [role=button], [role=tab], summary').forEach((e) => {
      const el = e as HTMLElement, r = el.getBoundingClientRect()
      let hid = false; for (let p: Element | null = el; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || p.hasAttribute('inert') || p.getAttribute('aria-hidden') === 'true') hid = true }
      if (hid || r.width === 0 || r.height === 0 || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('skip')) return
      const i = out.length; el.setAttribute('data-sweep-click', String(i))
      out.push({ i, label: (el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('title') ?? '').trim().replace(/\s+/g, ' ').slice(0, 80), href: el.getAttribute('href'), tag: el.tagName.toLowerCase(), active: ['aria-pressed', 'aria-selected', 'aria-current'].some((a) => { const v = el.getAttribute(a); return v !== null && v !== 'false' }) })
    })
    return out
  })
  const first = (await list()).slice(0, MAX_CLICKS)
  const dialogSel = '[role=dialog], [role=alertdialog], dialog[open]'
  const dom = () => page.evaluate(() => { const t = document.body.outerHTML; return t.length + ':' + t.split('').reduce((h, c) => ((h << 5) + h + c.charCodeAt(0)) | 0, 5381) })
  void hash
  for (const c of first) {
    if (DESTRUCTIVE.test(c.label)) { skip(c.label || `(${c.tag})`); continue }
    if (c.href && (/^(mailto|tel|sms):/.test(c.href) || /^https?:\/\//.test(c.href) && new URL(c.href).origin !== new URL(page.url()).origin)) continue   // leaves the app: not ours to click
    const cur = await list()
    const target = cur[c.i]
    if (!target || target.label !== c.label) { continue }   // the page changed under us (live data): nothing to compare, nothing to claim
    const loc = page.locator(`[data-sweep-click="${c.i}"]`)
    const before = { url: page.url(), dom: await dom(), api: api(), dialogs: await page.locator(dialogSel).count() }
    takeLog()
    let popup = false, download = false
    const onPopup = () => { popup = true }, onDl = () => { download = true }
    context.on('page', onPopup); page.on('download', onDl)
    let clicked = true
    try { await loc.click({ timeout: 5000 }) } catch (e) { clicked = false; add('clickables', { rule: 'not-clickable', message: `"${c.label}" (${c.tag}) is visible and enabled but cannot be clicked: ${String((e as Error).message).split('\n')[0].slice(0, 200)}` }) }
    if (clicked) {
      await settle(page)
      context.off('page', onPopup); page.off('download', onDl)
      const after = { url: page.url(), dom: await dom(), api: api(), dialogs: await page.locator(dialogSel).count() }
      const happened = popup || download || after.url !== before.url || after.dom !== before.dom || after.api > before.api || after.dialogs !== before.dialogs
      const samePage = c.tag === 'a' && !!c.href && new URL(c.href, before.url).pathname === new URL(before.url).pathname   // a link to the page you are on, or an already-selected tab/filter: nothing is supposed to change
      if (!happened && !samePage && !c.active) add('clickables', { rule: 'click-no-effect', message: `"${c.label}" (${c.tag}) did nothing: no navigation, dialog, state change or request` })
      for (const l of takeLog()) add(/console|page-error/.test(l.rule) ? 'console' : 'network', { rule: l.rule, message: `after clicking "${c.label}": ${l.message}` })
      count()
      if (after.dialogs > before.dialogs) {
        const dlg = page.locator(dialogSel).last()
        await page.keyboard.press('Escape')
        const closedByEsc = await dlg.waitFor({ state: 'hidden', timeout: 2500 }).then(() => true, () => false)
        if (!closedByEsc) {
          add('clickables', { rule: 'dialog-esc', message: `dialog opened by "${c.label}" does not close with Esc` })
        }
        // second pass: the close / cancel button
        await page.goto(route, { waitUntil: 'load' }); await settle(page)
        const again = await list()
        if (again[c.i]?.label === c.label) {
          await page.locator(`[data-sweep-click="${c.i}"]`).click({ timeout: 5000 }).catch(() => undefined); await settle(page)
          const d2 = page.locator(dialogSel).last()
          const close = d2.getByRole('button', { name: /close|cancel|dismiss|not now|no, keep|back|×/i }).first()
          if (await close.count()) { await close.click().catch(() => undefined); if (!(await d2.waitFor({ state: 'hidden', timeout: 2500 }).then(() => true, () => false))) add('clickables', { rule: 'dialog-close-button', message: `dialog opened by "${c.label}": its close button does not close it` }) }
          else add('clickables', { rule: 'dialog-close-button', message: `dialog opened by "${c.label}" has no Close/Cancel button` })
        }
      }
    }
    context.off('page', onPopup); page.off('download', onDl)
    for (const p of context.pages()) if (p !== page) await p.close().catch(() => undefined)
    // restore: a fresh load of the same page (state, dialogs, filters reset)
    await page.goto(route, { waitUntil: 'load' }); await settle(page); takeLog()
  }
}
