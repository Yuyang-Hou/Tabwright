export const RELAY_RECOVERY_COMMAND = 'npm install -g tabwright@latest\ntabwright session list'

export type RelayConnectionIssue = 'offline' | 'outdated' | 'unavailable'
export type RelayReviewIssue = 'outdated' | 'unavailable'

export function getRelayReviewIssue(options: { statuses: number[] }): RelayReviewIssue | undefined {
  if (options.statuses.some((status) => status === 404)) {
    return 'outdated'
  }
  if (options.statuses.some((status) => status < 200 || status >= 400)) {
    return 'unavailable'
  }
  return undefined
}

export function relayReviewIssueText(options: { issue: RelayReviewIssue }): string {
  if (options.issue === 'outdated') {
    return `Browser control is connected, but this Tabwright local service cannot list saved recordings or capabilities. Your files were not deleted. Restart or update the Tabwright CLI.\n\nRun:\n${RELAY_RECOVERY_COMMAND}`
  }
  return `Browser control is connected, but saved recordings and capabilities are temporarily unavailable. Your files were not deleted. Restart the Tabwright CLI.\n\nRun:\n${RELAY_RECOVERY_COMMAND}`
}

export function relayIssueText(options: { issue: RelayConnectionIssue }): string {
  if (options.issue === 'outdated') {
    return `Tabwright local service is outdated. Restart or update the Tabwright CLI.\n\nRun:\n${RELAY_RECOVERY_COMMAND}`
  }
  if (options.issue === 'unavailable') {
    return `Tabwright local service is not responding correctly. Restart or update the Tabwright CLI.\n\nRun:\n${RELAY_RECOVERY_COMMAND}`
  }
  return `Tabwright local service is not running. Start or update the Tabwright CLI.\n\nRun:\n${RELAY_RECOVERY_COMMAND}`
}

export class RelayConnectionProblemError extends Error {
  issue: RelayConnectionIssue

  constructor(options: { issue: RelayConnectionIssue; cause?: unknown }) {
    const errorOptions = options.cause instanceof Error ? { cause: options.cause } : undefined
    super(relayIssueText({ issue: options.issue }), errorOptions)
    this.name = 'RelayConnectionProblemError'
    this.issue = options.issue
  }
}
