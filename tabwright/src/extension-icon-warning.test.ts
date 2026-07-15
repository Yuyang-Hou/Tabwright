import { describe, expect, it } from 'vitest'
import {
  getRelayReviewIssue,
  isRelayVersionOutdated,
  RELAY_RECOVERY_COMMAND,
  RelayConnectionProblemError,
  relayIssueText,
  relayReviewIssueText,
} from 'mcp-extension/src/relay-warning.js'

describe('extension relay warning copy', () => {
  it('detects an older local service version', () => {
    expect(isRelayVersionOutdated({ currentVersion: '1.0.1', requiredVersion: '1.0.2' })).toBe(true)
    expect(isRelayVersionOutdated({ currentVersion: '1.0.2', requiredVersion: '1.0.2' })).toBe(false)
    expect(isRelayVersionOutdated({ currentVersion: '1.1.0', requiredVersion: '1.0.2' })).toBe(false)
    expect(isRelayVersionOutdated({ currentVersion: '2.0.0', requiredVersion: '1.9.0' })).toBe(false)
  })

  it('tells users how to recover when the relay is outdated', () => {
    const text = relayIssueText({ issue: 'outdated' })

    expect(text).toContain('Tabwright local service is outdated')
    expect(text).toContain('Restart or update the Tabwright CLI')
    expect(text).toContain(RELAY_RECOVERY_COMMAND)
    expect(text).toContain('npm install -g tabwright@latest')
    expect(text).toContain('tabwright session list')
  })

  it('distinguishes offline and unhealthy relay states', () => {
    expect(relayIssueText({ issue: 'offline' })).toContain('is not running')
    expect(relayIssueText({ issue: 'unavailable' })).toContain('is not responding correctly')
  })

  it('keeps the issue type on the thrown error', () => {
    const cause = new Error('connect failed')
    const error = new RelayConnectionProblemError({ issue: 'offline', cause })

    expect(error.issue).toBe('offline')
    expect(error.message).toContain('Tabwright local service is not running')
    expect(error.cause).toBe(cause)
  })

  it('keeps browser control available while review endpoints are degraded', () => {
    expect(getRelayReviewIssue({ statuses: [404, 404] })).toBe('outdated')
    expect(getRelayReviewIssue({ statuses: [200, 503] })).toBe('unavailable')
    expect(getRelayReviewIssue({ statuses: [200, 204] })).toBeUndefined()

    const text = relayReviewIssueText({ issue: 'outdated' })
    expect(text).toContain('Browser control is connected')
    expect(text).toContain('Your files were not deleted')
    expect(text).toContain(RELAY_RECOVERY_COMMAND)
  })
})
