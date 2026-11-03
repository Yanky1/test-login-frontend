/** Unsent message drafts live in sessionStorage per conversation; they must not outlive the sign-in (shared computers). */
export const DRAFT_PREFIX = 'solvelt-draft:'
export function clearDrafts() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k?.startsWith(DRAFT_PREFIX)) sessionStorage.removeItem(k) }
  } catch { /* storage unavailable: nothing to clear */ }
}
