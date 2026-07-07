import { describe, expect, it } from 'vitest'
import { RELAY_RECOVERY_COMMAND, RelayConnectionProblemError, relayIssueText } from 'mcp-extension/src/relay-warning.js'

describe('extension relay warning copy', () => {
  it('tells users how to recover when the relay is outdated', () => {
    const text = relayIssueText({ issue: 'outdated' })

    expect(text).toContain('Playwriter local service is outdated')
    expect(text).toContain('Restart or update the Playwriter CLI')
    expect(text).toContain(RELAY_RECOVERY_COMMAND)
    expect(text).toContain('npm install -g playwriter@latest')
    expect(text).toContain('playwriter session list')
  })

  it('distinguishes offline and unhealthy relay states', () => {
    expect(relayIssueText({ issue: 'offline' })).toContain('is not running')
    expect(relayIssueText({ issue: 'unavailable' })).toContain('is not responding correctly')
  })

  it('keeps the issue type on the thrown error', () => {
    const cause = new Error('connect failed')
    const error = new RelayConnectionProblemError({ issue: 'offline', cause })

    expect(error.issue).toBe('offline')
    expect(error.message).toContain('Playwriter local service is not running')
    expect(error.cause).toBe(cause)
  })
})
