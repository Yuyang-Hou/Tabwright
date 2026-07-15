import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { getListeningPidsForPortMock, killPortProcessMock, spawnMock, unrefMock } = vi.hoisted(() => {
  return {
    getListeningPidsForPortMock: vi.fn(),
    killPortProcessMock: vi.fn(),
    spawnMock: vi.fn(),
    unrefMock: vi.fn(),
  }
})

vi.mock('node:child_process', () => {
  return { spawn: spawnMock }
})

vi.mock('./kill-port.js', () => {
  return {
    getListeningPidsForPort: getListeningPidsForPortMock,
    killPortProcess: killPortProcessMock,
  }
})

import {
  ensureRelayServer,
  getExtensionsStatus,
  type ExtensionStatus,
  selectImplicitExtension,
  waitForConnectedExtensions,
  waitForRelayVersion,
} from './relay-client.js'
import { RELAY_FEATURE, RELAY_FEATURES } from './protocol.js'
import { VERSION } from './utils.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function extension({ extensionId, activeTargets }: { extensionId: string; activeTargets: number }): ExtensionStatus {
  return {
    extensionId,
    browser: 'Chrome',
    profile: null,
    activeTargets,
    playwriterVersion: VERSION,
  }
}

function relayVersionResponse(version: string): Response {
  return new Response(JSON.stringify({ version }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function relayFeaturesResponse(features: readonly string[] = RELAY_FEATURES): Response {
  return new Response(JSON.stringify({ protocolVersion: 1, features }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function extensionsResponse(extensions: ExtensionStatus[]): Response {
  return new Response(JSON.stringify({ extensions }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('selectImplicitExtension', () => {
  test('returns null without connections', () => {
    expect(selectImplicitExtension([])).toBeNull()
  })

  test('selects the only connection even when it has no active tabs', () => {
    const onlyExtension = extension({ extensionId: 'extension-1', activeTargets: 0 })

    expect(selectImplicitExtension([onlyExtension])).toBe(onlyExtension)
  })

  test('selects the only active connection when multiple are connected', () => {
    const activeExtension = extension({ extensionId: 'extension-2', activeTargets: 1 })

    expect(
      selectImplicitExtension([
        extension({ extensionId: 'extension-1', activeTargets: 0 }),
        activeExtension,
        extension({ extensionId: 'extension-3', activeTargets: 0 }),
      ]),
    ).toBe(activeExtension)
  })

  test.each([
    {
      name: 'none are active',
      activeTargets: [0, 0],
    },
    {
      name: 'multiple are active',
      activeTargets: [1, 2],
    },
  ])('returns null when $name', ({ activeTargets }) => {
    const extensions = activeTargets.map((targets, index) => {
      return extension({ extensionId: `extension-${index}`, activeTargets: targets })
    })

    expect(selectImplicitExtension(extensions)).toBeNull()
  })
})

describe('getExtensionsStatus', () => {
  test('preserves optional feature negotiation fields from the legacy status fallback', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      if (String(input).includes('/extensions/status')) {
        return Promise.resolve(new Response(null, { status: 404 }))
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            connected: true,
            activeTargets: 1,
            browser: 'Chrome',
            profile: null,
            playwriterVersion: VERSION,
            protocolVersion: 1,
            features: ['heartbeat-v1'],
            connectionHealth: 'limited',
            missingFeatures: ['rrweb-recording-v1'],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getExtensionsStatus()).resolves.toEqual([
      expect.objectContaining({
        extensionId: 'default',
        protocolVersion: 1,
        features: ['heartbeat-v1'],
        connectionHealth: 'limited',
        missingFeatures: ['rrweb-recording-v1'],
      }),
    ])
  })
})

describe('waitForRelayVersion', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  test('accepts the first responding version when no expected version is provided', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(relayVersionResponse('9.9.9'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(waitForRelayVersion({ timeoutMs: 100 })).resolves.toBe('9.9.9')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('keeps polling until the expected version responds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(relayVersionResponse('9.9.9'))
      .mockResolvedValueOnce(relayVersionResponse(VERSION))
    vi.stubGlobal('fetch', fetchMock)

    const result = waitForRelayVersion({ timeoutMs: 500, intervalMs: 50, expectedVersion: VERSION })
    await vi.advanceTimersByTimeAsync(50)

    await expect(result).resolves.toBe(VERSION)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('waitForConnectedExtensions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  test('waits for a changing connection snapshot to settle before returning', async () => {
    const inactiveA = extension({ extensionId: 'extension-a', activeTargets: 0 })
    const activeB = extension({ extensionId: 'extension-b', activeTargets: 1 })
    const settledSnapshot = [inactiveA, activeB]
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(extensionsResponse([inactiveA]))
      .mockResolvedValueOnce(extensionsResponse(settledSnapshot))
      .mockImplementation(() => {
        return Promise.resolve(extensionsResponse(settledSnapshot))
      })
    vi.stubGlobal('fetch', fetchMock)

    let settled = false
    const result = waitForConnectedExtensions({ timeoutMs: 500, pollIntervalMs: 50, settleMs: 100 }).then(
      (extensions) => {
        settled = true
        return extensions
      },
    )

    await vi.advanceTimersByTimeAsync(99)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(51)

    await expect(result).resolves.toEqual(settledSnapshot)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  test('returns the latest non-empty snapshot when the settle window exceeds the timeout', async () => {
    const inactiveA = extension({ extensionId: 'extension-a', activeTargets: 0 })
    const activeB = extension({ extensionId: 'extension-b', activeTargets: 1 })
    const latestSnapshot = [inactiveA, activeB]
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(extensionsResponse([inactiveA]))
      .mockImplementation(() => {
        return Promise.resolve(extensionsResponse(latestSnapshot))
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = waitForConnectedExtensions({ timeoutMs: 100, pollIntervalMs: 50, settleMs: 500 })
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toEqual(latestSnapshot)
  })

  test('does not return a connection that disappeared during the settle window', async () => {
    const inactiveA = extension({ extensionId: 'extension-a', activeTargets: 0 })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(extensionsResponse([inactiveA]))
      .mockImplementation(() => {
        return Promise.resolve(extensionsResponse([]))
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = waitForConnectedExtensions({ timeoutMs: 100, pollIntervalMs: 50, settleMs: 500 })
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toEqual([])
  })
})

describe('ensureRelayServer', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.useFakeTimers()
    getListeningPidsForPortMock.mockResolvedValue([])
    killPortProcessMock.mockResolvedValue(undefined)
    spawnMock.mockReturnValue({ unref: unrefMock })
  })

  test('rejects an older spawned relay until the package version responds', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('not listening on IPv4'))
      .mockRejectedValueOnce(new Error('not listening on localhost'))
      .mockRejectedValueOnce(new Error('not listening on IPv6'))
      .mockResolvedValueOnce(relayVersionResponse('0.3.9'))
      .mockResolvedValueOnce(relayVersionResponse(VERSION))
      .mockResolvedValueOnce(relayFeaturesResponse())
    vi.stubGlobal('fetch', fetchMock)

    let settled = false
    const result = ensureRelayServer().then((value) => {
      settled = true
      return value
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    expect(spawnMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_200)

    await expect(result).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(unrefMock).toHaveBeenCalledTimes(1)
  })

  test('restarts a same-version relay that is missing current features', async () => {
    let spawnedCurrentRelay = false
    const staleRelayFeatures = RELAY_FEATURES.filter((feature) => {
      return feature !== RELAY_FEATURE.capabilityAuthAutoTab
    })
    spawnMock.mockImplementation(() => {
      spawnedCurrentRelay = true
      return { unref: unrefMock }
    })
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      if (String(input).includes('/features')) {
        return Promise.resolve(spawnedCurrentRelay ? relayFeaturesResponse() : relayFeaturesResponse(staleRelayFeatures))
      }
      return Promise.resolve(relayVersionResponse(VERSION))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = ensureRelayServer()
    await vi.advanceTimersByTimeAsync(200)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(result).resolves.toBe(true)
    expect(killPortProcessMock).toHaveBeenCalledTimes(1)
    expect(unrefMock).toHaveBeenCalledTimes(1)
  })

  test('rechecks features when a same-version relay wins the startup race', async () => {
    getListeningPidsForPortMock.mockResolvedValueOnce([123]).mockResolvedValue([])
    let spawnedCurrentRelay = false
    let initialVersionAttempts = 0
    spawnMock.mockImplementation(() => {
      spawnedCurrentRelay = true
      return { unref: unrefMock }
    })
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      if (String(input).includes('/features')) {
        return Promise.resolve(spawnedCurrentRelay ? relayFeaturesResponse() : new Response(null, { status: 404 }))
      }
      if (!spawnedCurrentRelay && initialVersionAttempts < 3) {
        initialVersionAttempts += 1
        return Promise.reject(new Error('relay is still starting'))
      }
      return Promise.resolve(relayVersionResponse(VERSION))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = ensureRelayServer()
    await vi.advanceTimersByTimeAsync(200)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(result).resolves.toBe(true)
    expect(killPortProcessMock).toHaveBeenCalledTimes(1)
    expect(unrefMock).toHaveBeenCalledTimes(1)
  })

  test('keeps a same-version relay that advertises current features', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      return Promise.resolve(
        String(input).includes('/features') ? relayFeaturesResponse() : relayVersionResponse(VERSION),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(ensureRelayServer()).resolves.toBeUndefined()
    expect(killPortProcessMock).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  test('accepts a newer relay that wins the startup race', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('not listening on IPv4'))
      .mockRejectedValueOnce(new Error('not listening on localhost'))
      .mockRejectedValueOnce(new Error('not listening on IPv6'))
      .mockResolvedValueOnce(relayVersionResponse('9.9.9'))
    vi.stubGlobal('fetch', fetchMock)

    const result = ensureRelayServer()
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(result).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })
})
