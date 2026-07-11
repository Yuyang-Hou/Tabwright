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
  type ExtensionStatus,
  selectImplicitExtension,
  waitForConnectedExtensions,
  waitForRelayVersion,
} from './relay-client.js'
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
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(unrefMock).toHaveBeenCalledTimes(1)
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
