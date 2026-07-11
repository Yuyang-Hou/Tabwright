import { describe, expect, test } from 'vitest'
import { buildDoctorReport, formatDoctorReport, type DoctorSession } from './doctor.js'
import type { ExtensionStatus } from './relay-client.js'

const extension = (overrides: Partial<ExtensionStatus> = {}): ExtensionStatus => {
  return {
    extensionId: 'extension-1',
    stableKey: 'install:Chrome:profile-1',
    browser: 'Chrome',
    profile: null,
    activeTargets: 1,
    playwriterVersion: '0.4.0',
    ...overrides,
  }
}

const session = (overrides: Partial<DoctorSession> = {}): DoctorSession => {
  return {
    id: '1',
    browser: 'Chrome',
    extensionId: 'install:Chrome:profile-1',
    cwd: '/project',
    ...overrides,
  }
}

describe('buildDoctorReport', () => {
  test('recognizes readiness without reusing another task session', () => {
    const report = buildDoctorReport({
      version: '0.4.0',
      cwd: '/project',
      remote: false,
      relayVersion: '0.4.0',
      extensions: [extension()],
      sessions: [session()],
      capabilityCount: 2,
    })

    expect(report.ready).toBe(true)
    expect(report.next.command).toBe('playwriter session new --browser install:Chrome:profile-1')
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'relay', status: 'pass' }),
        expect.objectContaining({ id: 'extension', status: 'pass' }),
        expect.objectContaining({ id: 'session', status: 'pass' }),
      ]),
    )
  })

  test('chooses session creation when Chrome has an enabled tab', () => {
    const report = buildDoctorReport({
      version: '0.4.0',
      cwd: '/project',
      remote: false,
      relayVersion: '0.4.0',
      extensions: [extension()],
      sessions: [],
      capabilityCount: 0,
    })

    expect(report.ready).toBe(false)
    expect(report.next.command).toBe('playwriter session new --browser install:Chrome:profile-1')
  })

  test('asks for the extension click before suggesting a headless fallback', () => {
    const report = buildDoctorReport({
      version: '0.4.0',
      cwd: '/project',
      remote: false,
      relayVersion: '0.4.0',
      extensions: [extension({ activeTargets: 0 })],
      sessions: [session()],
      capabilityCount: 0,
    })

    expect(report.next.command).toBeUndefined()
    expect(report.ready).toBe(false)
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'session',
          status: 'warn',
          message: expect.stringContaining('none are currently usable'),
        }),
      ]),
    )
    expect(report.next.title).toContain('click the Playwriter extension icon')
    expect(report.next.fallbackCommand).toBe('playwriter session new --browser headless')
  })

  test('keeps a connected direct or headless session usable without an extension', () => {
    const report = buildDoctorReport({
      version: '0.4.0',
      cwd: '/project',
      remote: false,
      relayVersion: '0.4.0',
      extensions: [],
      sessions: [session({ extensionId: null, connected: true, browser: 'Chromium (headless)' })],
      capabilityCount: 0,
    })

    expect(report.ready).toBe(true)
    expect(report.next.command).toBe('playwriter session new --browser headless')
  })

  test('explains a newer extension and missing relay', () => {
    const report = buildDoctorReport({
      version: '0.4.0',
      cwd: '/project',
      remote: false,
      relayVersion: null,
      relayError: 'Failed to start relay. Check logs at ~/.playwriter/relay-server.log',
      extensions: [extension({ playwriterVersion: '0.5.0' })],
      sessions: [],
      capabilityCount: 0,
    })

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'relay', status: 'fail' }),
        expect.objectContaining({ id: 'extension', status: 'fail' }),
      ]),
    )
    expect(formatDoctorReport(report)).toContain('[FAIL] Local relay is not reachable.')
    expect(formatDoctorReport(report)).toContain('Failed to start relay')
    expect(report.next.command).toBe('playwriter logfile')
  })

  test('keeps remote connection failures diagnostic and non-destructive', () => {
    const report = buildDoctorReport({
      version: '0.4.0',
      cwd: '/project',
      remote: true,
      relayVersion: null,
      extensions: [],
      sessions: [],
      capabilityCount: 0,
    })

    expect(report.ready).toBe(false)
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'relay', status: 'fail', message: 'Remote relay is not reachable.' }),
      ]),
    )
    expect(report.next.command).toBeUndefined()
    expect(report.next.title).toContain('host, token, and network path')
  })
})
