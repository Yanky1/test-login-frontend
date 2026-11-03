/**
 * "Live" used to be a separate seller status after "Approved". It was removed: Approved is now the final, selling state.
 * An older backend may still send "Live"; treat it as Approved wherever a status enters the app.
 */
export const normalizeStatus = <T extends string | null | undefined>(s: T): T | 'Approved' => (s === 'Live' ? 'Approved' : s)
