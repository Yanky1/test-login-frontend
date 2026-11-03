/**
 * App-wide "unsaved work" registry. A page that holds edits not yet safely on the server registers a handler; anything that would tear the page
 * down without a link click (switching account, manual log-out) awaits canLeave() first. The handler asks the user (Save and leave / Leave / Stay).
 */
type Handler = () => Promise<boolean>
let handler: Handler | null = null

export function setUnsavedHandler(h: Handler): () => void {
  handler = h
  return () => { if (handler === h) handler = null }
}
export const canLeave = async (): Promise<boolean> => (handler ? handler() : true)
export class LeaveRefused extends Error { constructor() { super('Staying on the page: there are unsaved changes.') } }
