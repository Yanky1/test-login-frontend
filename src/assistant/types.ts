export type Risk = 'low' | 'medium' | 'high'
export type ActionStatus = 'pending' | 'executing' | 'confirmed' | 'cancelled' | 'expired' | 'failed' | 'superseded'
export interface DiffRow { field: string; before: string | null; after: string | null }
export interface ActionCard {
  id: string; conversationId: string; type: string
  target: { kind: string; id: string | null; label: string }
  summary: string; diff: DiffRow[]; risk: Risk; status: ActionStatus
  createdAt: string; expiresAt: string
  result?: { code: string; message: string } | null
  supersededBy?: string | null
}
export interface EntityLink { kind: string; id: string; label: string }
export interface ToolStep { id: string; name: string; label: string; status: 'running' | 'done' | 'error' }
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'note'
  text: string
  /** ok | limit | timeout | error | refused | truncated | stopped */
  status?: string
  links?: EntityLink[]
  actions?: ActionCard[]
  steps?: ToolStep[]
  streaming?: boolean
  createdAt?: string
}
export interface AssistantConfig {
  enabled: boolean; stopped: boolean; role: string; canPropose: boolean; readOnlyReason: string | null
  maxMessageChars: number; actionExpiryMinutes: number; retentionDays: number
  usage?: { messages: number; messageLimit: number }
}
export interface ConversationSummary { id: string; title: string; createdAt: string; updatedAt: string }
export interface PageContext { kind: 'product' | 'service' | 'order' | 'booking' | 'conversation' | 'quote'; id: string }

export type StreamEvent =
  | { type: 'conversation'; data: { conversationId: string; title: string } }
  | { type: 'text'; data: { delta: string } }
  | { type: 'tool'; data: { id: string; name: string; label: string; status: ToolStep['status'] } }
  | { type: 'action'; data: ActionCard }
  | { type: 'error'; data: { code: string; message: string } }
  | { type: 'done'; data: { messageId: string; conversationId: string; text: string; status: string; links: EntityLink[]; usage?: { input: number; output: number } } }
