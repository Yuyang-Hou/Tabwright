import fs from 'node:fs'
import path from 'node:path'
import {
  readCapabilityRuns,
  readCapabilitySecrets,
  type CapabilityAuthType,
  type CapabilityRecord,
} from './capability-registry.js'

const AUTH_STATE_FILENAME = 'auth-state.json'
const EXPIRING_WINDOW_MS = 24 * 60 * 60 * 1000

export type CapabilityAuthStatus = 'not-required' | 'missing' | 'authenticated' | 'expiring' | 'expired' | 'unknown'

export interface StoredCapabilityAuthState {
  schemaVersion: 1
  refreshedAt: string
  expiresAt?: string
  cookieNames: string[]
  browserKey?: string
}

export interface CapabilityAuthState {
  type: CapabilityAuthType
  status: CapabilityAuthStatus
  canRefresh: boolean
  browserUrls: string[]
  requiredCookieNames: string[]
  cookieNames: string[]
  refreshedAt?: string
  expiresAt?: string
  browserKey?: string
  reason?: string
  refreshCommand?: string
}

export function writeStoredCapabilityAuthState(options: {
  capability: CapabilityRecord
  state: StoredCapabilityAuthState
}): string {
  const statePath = path.join(options.capability.dir, AUTH_STATE_FILENAME)
  fs.mkdirSync(options.capability.dir, { recursive: true })
  fs.writeFileSync(statePath, `${JSON.stringify(options.state, null, 2)}\n`, { mode: 0o600 })
  if (process.platform !== 'win32') {
    fs.chmodSync(statePath, 0o600)
  }
  return statePath
}

export function removeCapabilityAuthFiles(options: { capabilityDir: string }): void {
  const filenames: string[] = ['secrets.json', AUTH_STATE_FILENAME]
  filenames.map((filename) => {
    fs.rmSync(path.join(options.capabilityDir, filename), { force: true })
    return filename
  })
}

export function getCapabilityAuthState(options: { capability: CapabilityRecord; now?: Date }): CapabilityAuthState {
  const auth = options.capability.manifest.auth
  const canRefresh = auth.type === 'cookie' && auth.refresh === 'from-browser' && auth.browserUrls.length > 0
  const refreshCommand = canRefresh
    ? `tabwright capability refresh-auth ${options.capability.manifest.id} --browser user --json`
    : undefined
  const base = {
    type: auth.type,
    canRefresh,
    browserUrls: auth.browserUrls,
    requiredCookieNames: auth.requiredCookieNames,
    refreshCommand,
  }
  if (auth.type === 'none') {
    return { ...base, status: 'not-required', cookieNames: [] }
  }

  const secretKey = auth.secretKey || 'cookieHeader'
  const secrets = (() => {
    try {
      return readCapabilitySecrets({ capability: options.capability })
    } catch {
      return {}
    }
  })()
  if (typeof secrets[secretKey] !== 'string' || secrets[secretKey].length === 0) {
    return {
      ...base,
      status: 'missing',
      cookieNames: [],
      reason: 'No saved authentication is available on this device.',
    }
  }

  const stored = readStoredCapabilityAuthState({ capability: options.capability })
  if (!stored) {
    return {
      ...base,
      status: 'unknown',
      cookieNames: [],
      reason: 'Saved authentication predates status tracking. Refresh it to inspect expiry.',
    }
  }

  const runFailure = latestAuthFailure({ capability: options.capability, refreshedAt: stored.refreshedAt })
  if (runFailure) {
    return {
      ...base,
      ...stored,
      status: 'expired',
      reason: runFailure,
    }
  }

  // Cookie timestamps cover client-side expiry; failure signals cover sessions revoked earlier by the server.
  const now = options.now || new Date()
  const expiresAt = stored.expiresAt ? Date.parse(stored.expiresAt) : Number.NaN
  if (!Number.isNaN(expiresAt) && expiresAt <= now.getTime()) {
    return {
      ...base,
      ...stored,
      status: 'expired',
      reason: 'The saved browser cookies have expired.',
    }
  }
  if (!Number.isNaN(expiresAt) && expiresAt - now.getTime() <= EXPIRING_WINDOW_MS) {
    return {
      ...base,
      ...stored,
      status: 'expiring',
      reason: 'The saved browser cookies expire within 24 hours.',
    }
  }
  return { ...base, ...stored, status: 'authenticated' }
}

function readStoredCapabilityAuthState(options: { capability: CapabilityRecord }): StoredCapabilityAuthState | null {
  const statePath = path.join(options.capability.dir, AUTH_STATE_FILENAME)
  if (!fs.existsSync(statePath)) {
    return null
  }
  const parsed: unknown = (() => {
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    } catch {
      return null
    }
  })()
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.refreshedAt !== 'string') {
    return null
  }
  const cookieNames = Array.isArray(parsed.cookieNames)
    ? parsed.cookieNames.filter((value): value is string => {
        return typeof value === 'string'
      })
    : []
  return {
    schemaVersion: 1,
    refreshedAt: parsed.refreshedAt,
    expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : undefined,
    cookieNames,
    browserKey: typeof parsed.browserKey === 'string' ? parsed.browserKey : undefined,
  }
}

function latestAuthFailure(options: { capability: CapabilityRecord; refreshedAt: string }): string | null {
  const refreshedAt = Date.parse(options.refreshedAt)
  const relevantRun = readCapabilityRuns({ capability: options.capability, limit: 50 })
    .filter((run) => {
      return Number.isNaN(refreshedAt) || Date.parse(run.createdAt) >= refreshedAt
    })
    .reverse()
    .find((run) => {
      if (run.status === 'success') {
        return true
      }
      if (!run.error) {
        return false
      }
      const normalizedError = run.error.toLowerCase()
      return options.capability.manifest.auth.failureSignals.some((signal) => {
        return normalizedError.includes(signal.toLowerCase())
      })
    })
  if (!relevantRun || relevantRun.status === 'success' || !relevantRun.error) {
    return null
  }
  const normalizedError = relevantRun.error.toLowerCase()
  const matchedSignal = options.capability.manifest.auth.failureSignals.find((signal) => {
    return normalizedError.includes(signal.toLowerCase())
  })
  if (!matchedSignal) {
    return null
  }
  return `The latest run reported an authentication failure: ${matchedSignal}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
