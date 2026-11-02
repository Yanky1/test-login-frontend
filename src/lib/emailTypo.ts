const DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'protonmail.com',
  'live.com', 'msn.com', 'comcast.net', 'verizon.net', 'att.net', 'googlemail.com', 'yahoo.co.uk',
]

/** Optimal-string-alignment distance (insert, delete, substitute, adjacent transposition). */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** Returns a corrected full address ("a@gmail.com") when the domain looks like a typo of a popular one. */
export function suggestEmail(email: string): { domain: string; email: string } | null {
  const at = email.lastIndexOf('@')
  if (at < 1) return null
  const local = email.slice(0, at)
  const domain = email.slice(at + 1).trim().toLowerCase()
  if (domain.length < 5 || DOMAINS.includes(domain)) return null
  const maxDist = domain.length >= 8 ? 2 : 1 // short domains (me.com) would otherwise match everything
  let best: string | null = null
  let bestD = maxDist + 1
  for (const d of DOMAINS) {
    const dist = distance(domain, d)
    if (dist < bestD) { bestD = dist; best = d }
  }
  return best && bestD <= maxDist ? { domain: best, email: `${local}@${best}` } : null
}
