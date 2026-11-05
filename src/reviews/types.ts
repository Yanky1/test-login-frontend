export type ReviewReply = { id: string; text: string; createdAt: string; editedAt: string | null }
export type ReviewState = 'visible' | 'hidden' | 'removed'
export type Review = {
  id: string; reviewId: string; productId: string; productTitle: string; rating: number; text: string | null; buyerDisplayName: string | null
  createdAt: string; editedAt: string | null; state: ReviewState; reply: ReviewReply | null
  /** Only in the "Hidden by marketplace" view. */
  stateReason?: string | null; stateChangedAt?: string | null
  /** Added by the test-mode filter for records created by "Fill with demo data". */
  demo?: boolean
}
export type StarCounts = Record<'1' | '2' | '3' | '4' | '5', number>
export type ReviewSummary = { count: number; average: number | null; counts: StarCounts }
export type ReviewList = { items: Review[]; total: number; page: number; pageSize: number; summary: ReviewSummary; hiddenCount: number | null }
