export const RELAY_RECOVERY_COMMAND = 'npm install -g playwriter@latest\nplaywriter session list'

export type RelayConnectionIssue = 'offline' | 'outdated' | 'unavailable'

export function relayIssueText(options: { issue: RelayConnectionIssue }): string {
  if (options.issue === 'outdated') {
    return `Playwriter local service is outdated. Restart or update the Playwriter CLI.\n\nRun:\n${RELAY_RECOVERY_COMMAND}`
  }
  if (options.issue === 'unavailable') {
    return `Playwriter local service is not responding correctly. Restart or update the Playwriter CLI.\n\nRun:\n${RELAY_RECOVERY_COMMAND}`
  }
  return `Playwriter local service is not running. Start or update the Playwriter CLI.\n\nRun:\n${RELAY_RECOVERY_COMMAND}`
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
