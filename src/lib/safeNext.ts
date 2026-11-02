/** Same-origin relative paths only (mirrors the backend SafeRedirect). Returns null for anything else. */
export function safeNext(path: string | null | undefined): string | null {
  if (!path || path.length > 2000) return null
  if (path[0] !== '/') return null
  if (path.length > 1 && (path[1] === '/' || path[1] === '\\')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return null
  if (path.includes('://')) return null
  return path
}
