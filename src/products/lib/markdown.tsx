import type { ReactNode } from 'react'

/**
 * Safe Markdown preview: renders to React elements (never innerHTML), so raw HTML in the text is shown as text.
 * Same subset as the server renderer: headings (#), **bold**, *italic*, `code`, - / 1. lists, [text](http(s)/mailto link).
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|((?<![*\w])\*[^*\n]+\*(?!\*))|(\[[^\]\n]+\]\([^)\s]+\))/g
  let last = 0; let m: RegExpExecArray | null; let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]; const k = `${keyBase}-${i++}`
    if (m[1]) out.push(<code key={k}>{t.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={k}>{t.slice(2, -2)}</strong>)
    else if (m[3]) out.push(<em key={k}>{t.slice(1, -1)}</em>)
    else {
      const [, label, url] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!
      let ok = false
      try { ok = ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol) } catch { /* not a URL */ }
      out.push(ok ? <a key={k} href={url} rel="noopener nofollow ugc" target="_blank">{label}</a> : label)
    }
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ source }: { source: string | null | undefined }) {
  if (!source?.trim()) return null
  const blocks: ReactNode[] = []
  const st: { list: { tag: 'ul' | 'ol'; items: string[] } | null } = { list: null }
  let para: string[] = []
  let n = 0
  const flushPara = () => { if (para.length) { blocks.push(<p key={n++}>{inline(para.join(' '), `p${n}`)}</p>); para = [] } }
  const flushList = () => {
    const L = st.list
    if (!L) return
    const Tag = L.tag
    blocks.push(<Tag key={n++}>{L.items.map((it, i) => <li key={i}>{inline(it, `l${n}-${i}`)}</li>)}</Tag>)
    st.list = null
  }
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { flushPara(); flushList(); continue }
    const h = /^(#{1,3})\s+(.+)$/.exec(line)
    if (h) {
      flushPara(); flushList()
      const Tag = (`h${Math.min(h[1].length + 2, 6)}`) as 'h3' | 'h4' | 'h5'
      blocks.push(<Tag key={n++}>{inline(h[2], `h${n}`)}</Tag>); continue
    }
    const ul = /^\s*[-*]\s+(.+)$/.exec(line); const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (ul || ol) {
      flushPara()
      const tag = ul ? 'ul' : 'ol'
      if (st.list?.tag !== tag) { flushList(); st.list = { tag, items: [] } }
      st.list!.items.push((ul ?? ol)![1]); continue
    }
    flushList(); para.push(line.trim())
  }
  flushPara(); flushList()
  return <div className="md">{blocks}</div>
}
