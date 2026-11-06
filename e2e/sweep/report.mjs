// Builds sweep-out/gallery/index.html and sweep-out/summary.md from sweep-out/data/*.json (+ lighthouse.json).
// Usage: node e2e/sweep/report.mjs [outDir]   (CI merges the artifacts of all matrix jobs into one folder first)
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2] ?? 'sweep-out'
const dir = path.join(out, 'data')
const runs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'lighthouse.json').map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : []
const lh = fs.existsSync(path.join(dir, 'lighthouse.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'lighthouse.json'), 'utf8')) : []
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const findings = runs.flatMap((r) => r.findings)
const CHECKS = ['clickables', 'layout', 'a11y', 'keyboard', 'visual', 'console', 'network', 'speed']

// ---- gallery: one thumbnail per page x viewport x theme x role
const cards = runs.flatMap((r) => r.gallery.map((g) => {
  const n = r.findings.filter((f) => f.route === g.route).length
  return `<figure data-project="${esc(r.project)}" data-theme="${r.theme}" data-role="${r.role}" data-bad="${n ? 1 : 0}"><a href="../${esc(g.shot)}"><img loading="lazy" src="../${esc(g.shot)}" alt="${esc(`${r.role} ${g.route} ${r.project} ${r.theme}`)}"></a><figcaption><b>${esc(g.route)}</b><br>${esc(r.role)} · ${esc(r.project)} · ${r.theme}${n ? ` · <span class="bad">${n} finding(s)</span>` : ''}</figcaption></figure>`
}))
fs.mkdirSync(path.join(out, 'gallery'), { recursive: true })
const opts = (k) => [...new Set(runs.map((r) => r[k]))].sort().map((v) => `<option>${esc(v)}</option>`).join('')
fs.writeFileSync(path.join(out, 'gallery', 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI sweep gallery</title>
<style>body{font:14px system-ui;margin:16px}header{position:sticky;top:0;background:#fff;padding:8px 0}select,input{margin-right:8px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}figure{margin:0;border:1px solid #ccc;padding:6px;border-radius:6px}img{width:100%;height:240px;object-fit:cover;object-position:top;display:block}figcaption{font-size:12px;word-break:break-all}.bad{color:#b00020;font-weight:700}</style>
<header><h1>UI sweep gallery (${cards.length} screenshots)</h1>
<label>Viewport/browser <select id="p"><option value="">all</option>${opts('project')}</select></label><label>Theme <select id="t"><option value="">all</option>${opts('theme')}</select></label><label>Role <select id="r"><option value="">all</option>${opts('role')}</select></label><label><input type="checkbox" id="b"> only pages with findings</label></header>
<main id="m">${cards.join('')}</main>
<script>const f=()=>{const p=document.getElementById('p').value,t=document.getElementById('t').value,r=document.getElementById('r').value,b=document.getElementById('b').checked;document.querySelectorAll('figure').forEach(e=>{e.hidden=(p&&e.dataset.project!==p)||(t&&e.dataset.theme!==t)||(r&&e.dataset.role!==r)||(b&&e.dataset.bad!=='1')})};document.querySelectorAll('select,input').forEach(e=>e.onchange=f)</script></html>`)

// ---- summary (markdown, for the workflow run summary)
const lines = ['# UI sweep summary', '']
lines.push(`${runs.length} role x theme runs, ${runs.reduce((n, r) => n + r.gallery.length, 0)} page screenshots, **${findings.length} findings**.`, '')
lines.push('## Counts per check', '', '| check | pages/actions checked | findings |', '|---|---:|---:|')
for (const c of CHECKS) {
  const checked = runs.flatMap((r) => r.stats).filter((s) => s.check === c).reduce((n, s) => n + s.pages, 0) + (c === 'speed' ? lh.length : 0)
  lines.push(`| ${c} | ${checked} | ${findings.filter((f) => f.check === c).length + (c === 'speed' ? lh.reduce((n, l) => n + (l.findings?.length ?? 0), 0) : 0)} |`)
}
const groups = new Map()
for (const f0 of findings) { const f = { ...f0, route: f0.route.replace(UUID, ':id'), message: f0.message.replace(UUID, ':id') }; const k = `${f.check}|${f.rule}|${f.route}|${f.role}|${f.message.replace(/\d+/g, 'N').slice(0, 90)}`; const g = groups.get(k) ?? { f, n: 0, at: new Set() }; g.n++; g.at.add(`${f.project}/${f.theme}`); groups.set(k, g) }
const top = [...groups.values()].sort((a, b) => b.n - a.n).slice(0, 40)
lines.push('', '## Top failures (grouped; duplicates across viewports/themes collapsed)', '', '| # | check | rule | page | role | seen at | error | screenshot |', '|--:|---|---|---|---|---|---|---|')
top.forEach((g, i) => lines.push(`| ${i + 1} | ${g.f.check} | ${g.f.rule} | \`${g.f.route}\` | ${g.f.role} | ${[...g.at].slice(0, 3).join(', ')}${g.at.size > 3 ? ` +${g.at.size - 3}` : ''} | ${g.f.message.replace(/\|/g, '/').slice(0, 160)} | ${g.f.shot ? `\`${g.f.shot}\` (artifact)` : ''} |`))
lines.push('', `Distinct groups: ${groups.size}.`)
const skipped = new Map(); for (const r of runs) for (const s of r.skipped) skipped.set(`${s.route}|${s.label}`, s)
lines.push('', '## Destructive / session-changing actions NOT clicked', '', ...[...skipped.values()].slice(0, 60).map((s) => `- \`${s.route}\`: ${s.label}`))
if (lh.length) { lines.push('', '## Lighthouse (desktop preset)', '', '| page | role | LCP (s) | CLS | perf score |', '|---|---|--:|--:|--:|'); for (const l of lh) lines.push(`| ${l.name} (\`${l.route}\`) | ${l.role} | ${l.lcp} | ${l.cls} | ${l.score} |`) }
fs.writeFileSync(path.join(out, 'summary.md'), lines.join('\n') + '\n')
fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify([...groups.values()].map((g) => ({ ...g.f, occurrences: g.n, at: [...g.at] })), null, 1))
console.log(lines.slice(0, 16).join('\n'))
console.log('=== FINDING GROUPS (check|rule|route|role|occurrences|seen at|message) ===')
for (const g of [...groups.values()].sort((a, b) => b.n - a.n).slice(0, 120)) console.log([g.f.check, g.f.rule, g.f.route, g.f.role, g.n, [...g.at].slice(0, 2).join(','), g.f.message.slice(0, 110)].join('|'))
console.log('=== END FINDINGS ===')
