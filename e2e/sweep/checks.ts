import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

export interface Issue { rule: string; message: string }

/**
 * A page is ready when the network is quiet (or only the app's own live-update stream is still open: capped at 2 s, because some pages
 * keep a connection open for ever), no spinner is showing and no animation is running. No fixed sleeps.
 */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => undefined)
  await page.locator('.spinner, [aria-busy=true]').first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity)).catch(() => undefined)
}

/**
 * Layout checks, run in the page. Allow-lists (each with its reason):
 *  - scroll containers (overflow auto/scroll) may be wider than the viewport inside: that is how tables and carousels work;
 *  - .sr-only / .skip / aria-hidden / inert / visibility:hidden elements are not visible content;
 *  - boxes of 2px or less are the visually-hidden (1x1 clip) pattern, not clipped text;
 *  - ellipsis (text-overflow) truncation is intentional, and the full text is in the title/aria-label or the page.
 */
export async function layoutIssues(page: Page): Promise<Issue[]> {
  return page.evaluate(() => {
    const out: { rule: string; message: string }[] = []
    const vw = document.documentElement.clientWidth
    const name = (e: Element) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`
    const hidden = (e: Element) => {
      for (let n: Element | null = e; n; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if (cs.display === 'none' || cs.visibility === 'hidden' || n.getAttribute('aria-hidden') === 'true' || n.hasAttribute('inert') || n.classList.contains('sr-only') || n.classList.contains('skip')) return true
      }
      return false
    }
    const inScroller = (e: Element) => { for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true } return false }
    const all = [...document.body.querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'PATH', 'USE', 'DEFS', 'LINE', 'CIRCLE', 'RECT', 'G'].includes(e.tagName.toUpperCase()) && !hidden(e))
    const cap = <T,>(list: T[], n = 6) => list.slice(0, n)

    if (document.documentElement.scrollWidth > vw + 1) out.push({ rule: 'horizontal-scroll', message: `page scrolls horizontally: scrollWidth ${document.documentElement.scrollWidth} > viewport ${vw}` })

    const wide: string[] = [], off: string[] = []
    for (const e of all) {
      const r = e.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || inScroller(e)) continue
      const pos = getComputedStyle(e).position
      if (r.right > vw + 1 || r.left < -1) (r.left >= vw || r.right <= 0 ? off : wide).push(`${name(e)} [${Math.round(r.left)}..${Math.round(r.right)}] vs viewport ${vw}`)
      else if (r.width > vw + 1 && pos !== 'fixed') wide.push(`${name(e)} is ${Math.round(r.width)}px wide`)
    }
    for (const w of cap(wide)) out.push({ rule: 'element-wider-than-viewport', message: w })
    for (const w of cap(off)) out.push({ rule: 'off-screen', message: `visible element positioned off-screen: ${w}` })

    // text clipped by its own box (overflow hidden/clip without an ellipsis) or spilling out of it
    const clipped: string[] = []
    for (const e of all) {
      const cs = getComputedStyle(e)
      if (!(e.textContent ?? '').trim() || e.children.length > 3) continue
      const hiddenX = cs.overflowX === 'hidden' || cs.overflowX === 'clip', hiddenY = cs.overflowY === 'hidden' || cs.overflowY === 'clip'
      const ellipsis = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== ''
      if (((hiddenX && e.scrollWidth > e.clientWidth + 1) || (hiddenY && e.scrollHeight > e.clientHeight + 1)) && !ellipsis && e.clientWidth > 2 && e.clientHeight > 2) clipped.push(`${name(e)} content ${e.scrollWidth}x${e.scrollHeight} in box ${e.clientWidth}x${e.clientHeight}`)
    }
    for (const c of cap(clipped)) out.push({ rule: 'text-clipped', message: c })

    const spill: string[] = []
    for (const e of all) {
      const own = [...e.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim())
      if (!own.length || inScroller(e)) continue
      const rg = document.createRange(); rg.selectNodeContents(own[0])
      const tr = rg.getBoundingClientRect(), br = e.getBoundingClientRect(), cs = getComputedStyle(e)
      if (tr.width === 0 || cs.display === 'inline' || cs.overflowX !== 'visible') continue
      if (tr.right > br.right + 2 || tr.left < br.left - 2) spill.push(`${name(e)} text ${Math.round(tr.left)}..${Math.round(tr.right)} spills out of box ${Math.round(br.left)}..${Math.round(br.right)}`)
    }
    for (const s of cap(spill)) out.push({ rule: 'text-overflows-box', message: s })

    // overlap between sibling text blocks (absolute/fixed/transformed elements overlap on purpose: badges, menus)
    const over: string[] = []
    for (const p of all) {
      const kids = [...p.children].filter((k) => all.includes(k) && (k.textContent ?? '').trim() && ['static', 'relative'].includes(getComputedStyle(k).position) && getComputedStyle(k).transform === 'none')
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect()
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (a.width && b.width && w > 2 && h > 2) over.push(`${name(kids[i])} overlaps ${name(kids[j])} by ${Math.round(w)}x${Math.round(h)}`)
      }
    }
    for (const s of cap(over)) out.push({ rule: 'overlap', message: s })

    // WCAG 2.2 AA 2.5.8 target size: 24x24 CSS px, except inline links in text and targets whose 24px circle does not touch another target
    const targets = all.filter((e) => e.matches('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=checkbox], [role=switch], [role=menuitem]') && !(e as HTMLButtonElement).disabled)
    const rects = targets.map((e) => e.getBoundingClientRect())
    const small: string[] = []
    targets.forEach((e, i) => {
      const r = rects[i]
      if (r.width === 0 || r.height === 0 || (r.width >= 24 && r.height >= 24)) return
      if (e.matches('input[type=checkbox], input[type=radio]') && e.closest('label')) return          // the label is the target
      if (getComputedStyle(e).display === 'inline' && e.closest('p, li, td, dd, span.hint, .hint') && [...(e.parentElement?.childNodes ?? [])].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) return
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const touches = rects.some((o, j) => j !== i && o.width && !targets[j].contains(e) && !e.contains(targets[j]) && o.left < cx + 12 && o.right > cx - 12 && o.top < cy + 12 && o.bottom > cy - 12)
      if (touches) small.push(`${name(e)} is ${Math.round(r.width)}x${Math.round(r.height)}`)
    })
    for (const s of cap(small, 8)) out.push({ rule: 'tap-target-size', message: s })
    return out
  })
}

export async function axeIssues(page: Page): Promise<Issue[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  return violations.map((v) => ({ rule: v.id, message: `[${v.impact}] ${v.help}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}${v.nodes.length > 3 ? ` (+${v.nodes.length - 3})` : ''}` }))
}

/** Tab through the page: every interactive element must receive focus, and every focused element must show it (outline or box-shadow). */
export async function keyboardIssues(page: Page, firefoxLike: boolean): Promise<Issue[]> {
  const ids = await page.evaluate(() => {
    const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [role=button], [role=tab], [role=link]'
    let n = 0; const list: { id: string; label: string }[] = []
    const seenRadio = new Set<string>()
    document.querySelectorAll(sel).forEach((e) => {
      const el = e as HTMLElement
      const cs = getComputedStyle(el), r = el.getBoundingClientRect()
      let hid = false; for (let p: Element | null = el; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || p.hasAttribute('inert') || p.getAttribute('aria-hidden') === 'true') hid = true }
      if (hid || r.width === 0 || r.height === 0 || (el as HTMLButtonElement).disabled || el.tabIndex < 0 || cs.pointerEvents === 'none' || el.classList.contains('skip')) return
      if (el instanceof HTMLInputElement && el.type === 'radio') { if (seenRadio.has(el.name)) return; seenRadio.add(el.name) }
      const id = `sw${n++}`; el.setAttribute('data-sweep-id', id)
      list.push({ id, label: `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('name') ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"` })
    })
    return list
  })
  const reached = new Set<string>(), noRing = new Set<string>(), radioNames = new Map<string, string>()
  void radioNames
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0) })
  for (let i = 0; i < Math.min(ids.length + 15, 400); i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const cs = getComputedStyle(el)
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' || el.matches(':focus-visible') && cs.outlineStyle !== 'none'
      const grp = el instanceof HTMLInputElement && el.type === 'radio' ? el.name : null
      return { id: el.getAttribute('data-sweep-id') ?? (grp ? `radio:${grp}` : null), ring }
    })
    if (!info?.id) continue
    reached.add(info.id); if (!info.ring) noRing.add(info.id)
  }
  const label = (id: string) => ids.find((x) => x.id === id)?.label ?? id
  const out: Issue[] = []
  const radioGroups = await page.evaluate(() => [...document.querySelectorAll('input[type=radio]')].map((r) => ({ id: r.getAttribute('data-sweep-id'), name: (r as HTMLInputElement).name })).filter((r) => r.id))
  const missed = ids.filter((x) => !reached.has(x.id) && !radioGroups.some((g) => g.id === x.id && reached.has(`radio:${g.name}`)))
  if (missed.length) out.push({ rule: 'keyboard-unreachable', message: `${missed.length} interactive element(s) not reached with Tab: ${missed.slice(0, 5).map((m) => m.label).join('; ')}` })
  if (noRing.size) out.push({ rule: 'focus-not-visible', message: `${noRing.size} element(s) show no focus indicator: ${[...noRing].slice(0, 5).map(label).join('; ')}` })
  void firefoxLike
  return out
}

/** Tag text that changes between runs (dates, times, ids, order numbers, "x ago") so toHaveScreenshot can mask it. */
export async function tagDynamic(page: Page): Promise<void> {
  await page.evaluate(() => {
    const re = /(\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b)|(\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b)|(\b\d{1,2}:\d{2}\b)|(\b\d+\s*(s|sec|min|minutes?|hours?|h|days?|d|weeks?|months?)\s+ago\b)|(\bin \d+)|(\b(today|yesterday|tomorrow|just now)\b)|([0-9a-f]{8}-[0-9a-f]{4}-)|(#?\b[A-Z]{2,4}-[A-Z0-9]{5,}\b)|(\b\d{4}-\d{2}-\d{2}T)|(\b\d{6,}\b)|(\bseller-\d+|@example\.com)/i
    document.querySelectorAll('time, [data-sweep-mask]').forEach((e) => e.setAttribute('data-sweep-mask', ''))
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.parentElement && re.test(n.textContent ?? '') && !['SCRIPT', 'STYLE'].includes(n.parentElement.tagName)) n.parentElement.setAttribute('data-sweep-mask', '')
    }
    document.querySelectorAll('input').forEach((i) => { if (re.test((i as HTMLInputElement).value)) i.setAttribute('data-sweep-mask', '') })
  })
}
