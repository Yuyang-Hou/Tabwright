import type { RelayReviewIssue } from './relay-warning'

export type ConnectionState = 'idle' | 'connected' | 'extension-replaced' | 'relay-warning'
export type TabState = 'connecting' | 'connected' | 'error'

export type RelayReviewState =
  | { status: 'unknown' }
  | { status: 'ready' }
  | { status: 'degraded'; issue: RelayReviewIssue; errorText: string }

export interface TabInfo {
  sessionId?: string
  targetId?: string
  state: TabState
  errorText?: string
  attachOrder?: number
}

export interface ExtensionState {
  tabs: Map<number, TabInfo>
  connectionState: ConnectionState
  relayReviewState: RelayReviewState
  currentTabId: number | undefined
  preferredWindowId: number | undefined
  errorText: string | undefined
}
