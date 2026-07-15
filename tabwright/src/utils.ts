import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import './env-compat.js'
import { getTabwrightUserDataDir } from './product-paths.js'

// Tabwright extension IDs - used for validation and Chrome flag commands
export const EXTENSION_IDS = [
  'jfeammnjpkecdekppnclgkkffahnhfhe', // Production (Chrome Web Store)
  'pebbngnfojnignonigcnkdilknapkgid', // Dev extension (stable ID from manifest key)
]

/**
 * Parse a relay host string into HTTP and WebSocket base URLs.
 * Supports both plain hostnames (appends port) and full URLs (uses as-is).
 *
 * Examples:
 *   "192.168.1.10"                        → http://192.168.1.10:19988, ws://192.168.1.10:19988
 *   "https://my-machine-tunnel.traforo.dev" → https://my-machine-tunnel.traforo.dev, wss://my-machine-tunnel.traforo.dev
 */
export function parseRelayHost(host: string, port: number = 19988): { httpBaseUrl: string; wsBaseUrl: string } {
  if (host.startsWith('https://') || host.startsWith('http://')) {
    const url = new URL(host)
    const httpBaseUrl = url.origin
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBaseUrl = `${wsProtocol}//${url.host}`
    return { httpBaseUrl, wsBaseUrl }
  }
  return {
    httpBaseUrl: `http://${host}:${port}`,
    wsBaseUrl: `ws://${host}:${port}`,
  }
}

export function getCdpUrl({
  port = 19988,
  host = '127.0.0.1',
  token,
  extensionId,
}: {
  port?: number
  host?: string
  token?: string
  extensionId?: string | null
} = {}) {
  const id = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}`
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
  }
  if (extensionId) {
    params.set('extensionId', extensionId)
  }
  const queryString = params.toString()
  const suffix = queryString ? `?${queryString}` : ''
  const { wsBaseUrl } = parseRelayHost(host, port)
  return `${wsBaseUrl}/cdp/${id}${suffix}`
}

export function shouldAutoEnableTabwright(): boolean {
  return (process.env.TABWRIGHT_AUTO_ENABLE || process.env.PLAYWRITER_AUTO_ENABLE)?.toLowerCase() !== 'false'
}

// Existing installations continue using their legacy data directory until users migrate it.
const LOG_BASE_DIR = getTabwrightUserDataDir()
export const LOG_FILE_PATH =
  process.env.TABWRIGHT_LOG_FILE_PATH || process.env.PLAYWRITER_LOG_FILE_PATH || path.join(LOG_BASE_DIR, 'relay-server.log')
export const LOG_CDP_FILE_PATH =
  process.env.TABWRIGHT_CDP_LOG_FILE_PATH ||
  process.env.PLAYWRITER_CDP_LOG_FILE_PATH ||
  path.join(path.dirname(LOG_FILE_PATH), 'cdp.jsonl')

const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
export const VERSION = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version as string

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
