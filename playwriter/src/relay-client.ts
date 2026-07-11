/**
 * Shared utilities for connecting to the relay server.
 * Used by both MCP and CLI.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import { getListeningPidsForPort, killPortProcess } from './kill-port.js'
import { VERSION, sleep, LOG_FILE_PATH } from './utils.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988
export const LOCAL_RELAY_HOSTS = ['127.0.0.1', 'localhost', '[::1]'] as const

export type ExtensionStatus = {
  extensionId: string
  stableKey?: string
  browser: string | null
  profile: { email: string; id: string } | null
  activeTargets: number
  playwriterVersion: string | null
  protocolVersion?: number
  features?: string[]
  connectionHealth?: 'ready' | 'limited' | 'legacy'
  missingFeatures?: string[]
}

/**
 * Select an extension only when the choice is unambiguous.
 * A single connection remains the backward-compatible default. With multiple
 * connections, an enabled tab is a useful signal only when exactly one
 * extension has one.
 */
export function selectImplicitExtension(extensions: ExtensionStatus[]): ExtensionStatus | null {
  if (extensions.length === 1) {
    return extensions[0]!
  }

  const activeExtensions = extensions.filter((extension) => {
    return extension.activeTargets > 0
  })
  if (activeExtensions.length === 1) {
    return activeExtensions[0]!
  }

  return null
}

export function getLocalRelayHttpBaseUrls(port: number = RELAY_PORT): string[] {
  return LOCAL_RELAY_HOSTS.map((host) => {
    return `http://${host}:${port}`
  })
}

async function fetchLocalRelayPath({
  path,
  port = RELAY_PORT,
  timeoutMs = 2000,
  init,
  accept = () => {
    return true
  },
}: {
  path: string
  port?: number
  timeoutMs?: number
  init?: RequestInit
  accept?: (response: Response) => boolean
}): Promise<{ response: Response; httpBaseUrl: string } | null> {
  const attempts = getLocalRelayHttpBaseUrls(port)

  for (const httpBaseUrl of attempts) {
    try {
      const response = await fetch(`${httpBaseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (accept(response)) {
        return { response, httpBaseUrl }
      }
    } catch {}
  }

  return null
}

export async function getLocalRelayHttpBaseUrl(port: number = RELAY_PORT): Promise<string> {
  const result = await fetchLocalRelayPath({
    path: '/version',
    port,
    timeoutMs: 500,
    accept: (response) => {
      return response.ok
    },
  })
  if (result) {
    return result.httpBaseUrl
  }
  return getLocalRelayHttpBaseUrls(port)[0]!
}

export async function getRelayServerVersion(port: number = RELAY_PORT): Promise<string | null> {
  const result = await fetchLocalRelayPath({
    path: '/version',
    port,
    timeoutMs: 2000,
    accept: (response) => {
      return response.ok
    },
  })
  if (!result) {
    return null
  }
  const data = (await result.response.json()) as { version: string }
  return data.version
}

function acceptsRelayVersion({
  version,
  expectedVersion,
  minimumVersion,
}: {
  version: string | null
  expectedVersion?: string
  minimumVersion?: string
}): boolean {
  if (!version) {
    return false
  }
  if (expectedVersion) {
    return version === expectedVersion
  }
  if (minimumVersion) {
    return compareVersions(version, minimumVersion) >= 0
  }
  return true
}

/**
 * Poll /version until a relay responds or timeout expires.
 * Used during startup races where a relay may have bound the port
 * but isn't serving HTTP yet (issue #75).
 */
export async function waitForRelayVersion({
  port = RELAY_PORT,
  timeoutMs = 2000,
  intervalMs = 200,
  expectedVersion,
  minimumVersion,
}: {
  port?: number
  timeoutMs?: number
  intervalMs?: number
  /** Keep polling until this exact relay version responds. Takes precedence over minimumVersion. */
  expectedVersion?: string
  /** Keep polling until this relay version or a newer one responds. */
  minimumVersion?: string
} = {}): Promise<string | null> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const version = await getRelayServerVersion(port)
    if (acceptsRelayVersion({ version, expectedVersion, minimumVersion })) {
      return version
    }
    await sleep(intervalMs)
  }
  return null
}

export async function getExtensionStatus(
  port: number = RELAY_PORT,
): Promise<{
  connected: boolean
  activeTargets: number
  playwriterVersion: string | null
  protocolVersion?: number
  features?: string[]
  connectionHealth?: 'ready' | 'limited' | 'legacy'
  missingFeatures?: string[]
} | null> {
  const result = await fetchLocalRelayPath({
    path: '/extension/status',
    port,
    timeoutMs: 500,
    accept: (response) => {
      return response.ok
    },
  })
  if (!result) {
    return null
  }
  return (await result.response.json()) as {
    connected: boolean
    activeTargets: number
    playwriterVersion: string | null
    protocolVersion?: number
    features?: string[]
    connectionHealth?: 'ready' | 'limited' | 'legacy'
    missingFeatures?: string[]
  }
}

export async function getExtensionsStatus(port: number = RELAY_PORT): Promise<ExtensionStatus[]> {
  const result = await fetchLocalRelayPath({
    path: '/extensions/status',
    port,
    timeoutMs: 2000,
    accept: (response) => {
      return response.ok
    },
  })
  if (result) {
    const data = (await result.response.json()) as {
      extensions: ExtensionStatus[]
    }
    return data.extensions || []
  }

  const fallbackResult = await fetchLocalRelayPath({
    path: '/extension/status',
    port,
    timeoutMs: 2000,
    accept: (response) => {
      return response.ok
    },
  })
  if (!fallbackResult) {
    return []
  }

  const fallbackData = (await fallbackResult.response.json()) as {
    connected: boolean
    activeTargets: number
    browser: string | null
    profile: { email: string; id: string } | null
    playwriterVersion?: string | null
    protocolVersion?: number
    features?: string[]
    connectionHealth?: 'ready' | 'limited' | 'legacy'
    missingFeatures?: string[]
  }

  if (!fallbackData?.connected) {
    return []
  }

  return [
    {
      extensionId: 'default',
      stableKey: undefined,
      browser: fallbackData.browser,
      profile: fallbackData.profile,
      activeTargets: fallbackData.activeTargets,
      playwriterVersion: fallbackData.playwriterVersion || null,
      protocolVersion: fallbackData.protocolVersion,
      features: fallbackData.features,
      connectionHealth: fallbackData.connectionHealth,
      missingFeatures: fallbackData.missingFeatures,
    },
  ]
}

function getExtensionSettleSignature(extensions: ExtensionStatus[]): string {
  return extensions
    .map((extension) => {
      return JSON.stringify({
        extensionId: extension.extensionId,
        stableKey: extension.stableKey ?? null,
        activeTargets: extension.activeTargets,
      })
    })
    .sort()
    .join('\n')
}

/**
 * Wait for at least one extension to appear in extensions status.
 * Returns connected extension entries, or [] on timeout.
 */
export async function waitForConnectedExtensions(
  options: {
    port?: number
    timeoutMs?: number
    pollIntervalMs?: number
    /** Wait for the connection snapshot to remain unchanged before returning. Default: 0. */
    settleMs?: number
    logger?: { log: (...args: any[]) => void }
  } = {},
): Promise<ExtensionStatus[]> {
  const { port = RELAY_PORT, timeoutMs = 5000, pollIntervalMs = 200, settleMs = 0, logger } = options
  const startTime = Date.now()
  let latestNonEmpty: ExtensionStatus[] = []
  let latestSnapshotWasConnected = false
  let stableSignature: string | null = null
  let stableSince = 0

  logger?.log(pc.dim('Waiting for extension to connect...'))

  while (Date.now() - startTime < timeoutMs) {
    const extensions = await getExtensionsStatus(port)
    if (extensions.length > 0) {
      latestSnapshotWasConnected = true
      latestNonEmpty = extensions
      const signature = getExtensionSettleSignature(extensions)
      if (signature !== stableSignature) {
        stableSignature = signature
        stableSince = Date.now()
      }
      if (settleMs === 0 || Date.now() - stableSince >= settleMs) {
        logger?.log(pc.green('Extension connected'))
        return latestNonEmpty
      }
    } else if (latestNonEmpty.length > 0) {
      latestSnapshotWasConnected = false
      stableSignature = null
    }
    await sleep(pollIntervalMs)
  }

  if (latestSnapshotWasConnected && latestNonEmpty.length > 0) {
    logger?.log(pc.green('Extension connected'))
    return latestNonEmpty
  }

  logger?.log(pc.yellow('Extension did not connect within timeout'))
  return []
}

async function killRelayServer(options: { port: number; waitForFreeMs?: number }): Promise<void> {
  const { port, waitForFreeMs = 3000 } = options

  try {
    await killPortProcess({ port })
  } catch {
    return
  }

  const startTime = Date.now()
  while (Date.now() - startTime < waitForFreeMs) {
    const pids = await getListeningPidsForPort({ port }).catch(() => [])
    if (pids.length === 0) {
      return
    }
    await sleep(100)
  }
}

/**
 * Compare two semver versions. Returns:
 * - negative if v1 < v2
 * - 0 if v1 === v2
 * - positive if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  const len = Math.max(parts1.length, parts2.length)

  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 !== p2) {
      return p1 - p2
    }
  }
  return 0
}

/**
 * Check if the running playwriter package is older than the version the extension was built with.
 * The extension bundles the playwriter version at build time. If the extension reports a newer
 * version, it means the user's CLI/MCP needs updating.
 * Returns a warning message if outdated, null otherwise.
 */
export function getExtensionOutdatedWarning(extensionPlaywriterVersion: string | null | undefined): string | null {
  if (!extensionPlaywriterVersion) {
    return null
  }
  if (compareVersions(extensionPlaywriterVersion, VERSION) > 0) {
    return `Playwriter ${VERSION} is outdated (extension requires ${extensionPlaywriterVersion}). Run \`npm install -g playwriter@latest\` or update the playwriter package in your project.`
  }
  return null
}

export interface EnsureRelayServerOptions {
  logger?: { log: (...args: any[]) => void }
  /** If true, will kill and restart server on version mismatch. Default: true */
  restartOnVersionMismatch?: boolean
  /** Pass additional environment variables to the relay server process */
  env?: Record<string, string>
}

// Module-level dedup: if ensureRelayServer is called concurrently within the
// same process (e.g. two MCP tool handlers at once), only one spawn runs.
let pendingEnsure: Promise<true | undefined> | null = null

/**
 * Ensures the relay server is running. Starts it if not running.
 * Optionally restarts on version mismatch.
 * Concurrent calls within the same process are deduplicated.
 */
export async function ensureRelayServer(options: EnsureRelayServerOptions = {}): Promise<true | undefined> {
  if (pendingEnsure) {
    return pendingEnsure
  }
  pendingEnsure = ensureRelayServerImpl(options).finally(() => {
    pendingEnsure = null
  })
  return pendingEnsure
}

async function ensureRelayServerImpl(options: EnsureRelayServerOptions = {}): Promise<true | undefined> {
  const { logger, restartOnVersionMismatch = true, env: additionalEnv } = options
  const serverVersion = await getRelayServerVersion(RELAY_PORT)

  if (serverVersion === VERSION) {
    return
  }

  // Don't restart if server version is higher than our version.
  // This prevents older clients from killing a newer server.
  if (serverVersion !== null && compareVersions(serverVersion, VERSION) > 0) {
    return
  }

  if (serverVersion !== null) {
    if (restartOnVersionMismatch) {
      logger?.log(
        pc.yellow(`CDP relay server version mismatch (server: ${serverVersion}, client: ${VERSION}), restarting...`),
      )
      await killRelayServer({ port: RELAY_PORT })
    } else {
      // Server is running but different version, just use it
      return
    }
  } else {
    const listeningPids = await getListeningPidsForPort({ port: RELAY_PORT }).catch(() => [])
    if (listeningPids.length > 0) {
      // Something is on the port but /version didn't respond. It might be a
      // relay that's still starting (race with another CLI/MCP instance).
      // Poll /version briefly before deciding to kill it (issue #75).
      const foundVersion = await waitForRelayVersion({ port: RELAY_PORT })
      if (foundVersion) {
        // A relay came up while we waited; use it
        if (foundVersion === VERSION || compareVersions(foundVersion, VERSION) > 0) {
          return
        }
        if (!restartOnVersionMismatch) {
          return
        }
        logger?.log(
          pc.yellow(`CDP relay server version mismatch (server: ${foundVersion}, client: ${VERSION}), restarting...`),
        )
      } else {
        logger?.log(
          pc.yellow(
            `Port ${RELAY_PORT} is already in use (pid(s): ${listeningPids.join(', ')}). Attempting to stop the existing process...`,
          ),
        )
      }
      await killRelayServer({ port: RELAY_PORT })
    }

    logger?.log(pc.dim('CDP relay server not running, starting it...'))
  }

  // Detect if we're running from source (.ts) or compiled (.js)
  // This handles: tsx, vite-node, ts-node, or direct node on compiled output
  const isRunningFromSource = __filename.endsWith('.ts')
  const scriptPath = isRunningFromSource
    ? path.resolve(__dirname, './start-relay-server.ts')
    : path.resolve(__dirname, './start-relay-server.js')

  const serverProcess = spawn(isRunningFromSource ? 'tsx' : process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...additionalEnv },
  })

  serverProcess.unref()

  const startTimeoutMs = 5000
  const startTime = Date.now()

  const newVersion = await waitForRelayVersion({
    port: RELAY_PORT,
    timeoutMs: startTimeoutMs,
    minimumVersion: VERSION,
  })
  if (newVersion && compareVersions(newVersion, VERSION) >= 0) {
    logger?.log(pc.green('CDP relay server started successfully'))
    await sleep(1000)
    return true
  }

  const waitedMs = Date.now() - startTime
  throw new Error(`Failed to start CDP relay server within ${waitedMs}ms. Check logs at: ${LOG_FILE_PATH}`)
}
