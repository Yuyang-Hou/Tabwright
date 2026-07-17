import path from 'node:path'
import {
  readCapabilitySecrets,
  requireCapability,
  writeCapabilitySecrets,
  type CapabilityRecord,
} from './capability-registry.js'
import { writeStoredCapabilityAuthState } from './capability-auth-state.js'
import type { ExecuteResult } from './executor.js'

export interface CapabilityAuthExecutor {
  execute(
    code: string,
    timeout?: number,
    options?: { includeStructuredResult?: boolean },
  ): Promise<ExecuteResult>
}

export interface CapabilityAuthRefreshResult {
  capability: CapabilityRecord
  saved: boolean
  secretKey: string
  cookieCount: number
  cookieNames: string[]
  urls: string[]
  expiresAt?: string
  path: string
}

export interface CapabilityAuthCookie {
  name: string
  value: string
  expires?: number
}

export async function refreshCapabilityAuthWithExecutor(options: {
  executor: CapabilityAuthExecutor
  id: string
  cwd?: string
  timeout?: number
  browserKey?: string
}): Promise<CapabilityAuthRefreshResult> {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  if (capability.manifest.auth.type !== 'cookie' || capability.manifest.auth.refresh !== 'from-browser') {
    throw new Error(`Capability ${options.id} does not declare browser-refreshable cookie auth`)
  }
  if (capability.manifest.auth.browserUrls.length === 0) {
    throw new Error(`Capability ${options.id} auth.browserUrls is required for cookie refresh`)
  }

  const executeResult = await options.executor.execute(buildCookieRefreshCode({ capability }), options.timeout || 10000, {
    includeStructuredResult: true,
  })
  if (executeResult.isError) {
    throw new Error(`Failed to refresh capability auth: ${executeResult.text}`)
  }
  const parsed = parseRefreshResult(executeResult.structuredResult)
  writeStoredCapabilityAuthState({
    capability,
    state: {
      schemaVersion: 1,
      refreshedAt: new Date().toISOString(),
      expiresAt: parsed.expiresAt,
      cookieNames: parsed.cookieNames,
      browserKey: options.browserKey,
    },
  })
  return {
    capability,
    ...parsed,
  }
}

function buildCookieRefreshCode(options: { capability: CapabilityRecord }): string {
  const secretKey = options.capability.manifest.auth.secretKey || 'cookieHeader'
  const secretsPath = path.join(options.capability.stateDir, 'secrets.json')
  return [
    'const fs = await globalThis.import("node:fs")',
    `const urls = ${JSON.stringify(options.capability.manifest.auth.browserUrls)};`,
    `const requiredCookieNames = ${JSON.stringify(options.capability.manifest.auth.requiredCookieNames)};`,
    `const secretKey = ${JSON.stringify(secretKey)};`,
    `const secretsPath = ${JSON.stringify(secretsPath)};`,
    `const secretsDir = ${JSON.stringify(options.capability.stateDir)};`,
    'const cdp = await getCDPSession({ page });',
    'const result = await cdp.send("Network.getCookies", { urls });',
    'const cookies = Array.isArray(result.cookies) ? result.cookies : [];',
    'const cookieNames = cookies.map((cookie) => cookie.name).filter((name) => typeof name === "string");',
    'const missingCookieNames = requiredCookieNames.filter((name) => !cookieNames.includes(name));',
    'if (missingCookieNames.length > 0) {',
    '  throw new Error(`Missing required cookies: ${missingCookieNames.join(", ")}`);',
    '}',
    'const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");',
    'if (!cookieHeader) {',
    '  throw new Error("No cookies were available for capability auth refresh");',
    '}',
    'const existingSecrets = fs.existsSync(secretsPath) ? JSON.parse(fs.readFileSync(secretsPath, "utf-8")) : {};',
    'const nextSecrets = {',
    '  ...existingSecrets,',
    '  [secretKey]: cookieHeader,',
    '  updatedAt: new Date().toISOString(),',
    '};',
    'fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });',
    'if (process.platform !== "win32") {',
    '  fs.chmodSync(secretsDir, 0o700);',
    '}',
    'fs.writeFileSync(secretsPath, JSON.stringify(nextSecrets, null, 2), { mode: 0o600 });',
    'if (process.platform !== "win32") {',
    '  fs.chmodSync(secretsPath, 0o600);',
    '}',
    'const expiryCookies = requiredCookieNames.length > 0',
    '  ? cookies.filter((cookie) => requiredCookieNames.includes(cookie.name))',
    '  : [];',
    'const expiryValues = expiryCookies.map((cookie) => cookie.expires).filter((expires) => typeof expires === "number" && expires > 0);',
    'const expiresAt = expiryCookies.length > 0 && expiryValues.length === expiryCookies.length',
    '  ? new Date(Math.min(...expiryValues) * 1000).toISOString()',
    '  : undefined;',
    'return {',
    '  saved: true,',
    '  secretKey,',
    '  cookieCount: cookies.length,',
    '  cookieNames,',
    '  urls,',
    '  expiresAt,',
    '  path: secretsPath,',
    '};',
    `//# sourceURL=tabwright-capability-auth://${options.capability.manifest.id}`,
    '',
  ].join('\n')
}

export function refreshCapabilityAuthFromCookies(options: {
  id: string
  cookies: CapabilityAuthCookie[]
  cwd?: string
  browserKey?: string
}): CapabilityAuthRefreshResult {
  const capability = requireBrowserRefreshableCookieCapability({ id: options.id, cwd: options.cwd })
  const cookieNames = options.cookies.map((cookie) => {
    return cookie.name
  })
  const missingCookieNames = capability.manifest.auth.requiredCookieNames.filter((name) => {
    return !cookieNames.includes(name)
  })
  if (missingCookieNames.length > 0) {
    throw new Error(`Missing required cookies: ${missingCookieNames.join(', ')}`)
  }
  const cookieHeader = options.cookies
    .map((cookie) => {
      return `${cookie.name}=${cookie.value}`
    })
    .join('; ')
  if (!cookieHeader) {
    throw new Error('No cookies were available for capability auth refresh')
  }

  const secretKey = capability.manifest.auth.secretKey || 'cookieHeader'
  const existingSecrets = readCapabilitySecrets({ capability })
  writeCapabilitySecrets({
    capability,
    secrets: {
      ...existingSecrets,
      [secretKey]: cookieHeader,
      updatedAt: new Date().toISOString(),
    },
  })

  const requiredCookies = capability.manifest.auth.requiredCookieNames.map((name) => {
    return options.cookies.find((cookie) => {
      return cookie.name === name
    })
  })
  const expiryValues = requiredCookies
    .map((cookie) => {
      return cookie?.expires
    })
    .filter((expires): expires is number => {
      return typeof expires === 'number' && expires > 0
    })
  // Do not invent an expiry for session cookies: only all timestamped required cookies produce a deadline.
  const expiresAt =
    requiredCookies.length > 0 && expiryValues.length === requiredCookies.length
      ? new Date(Math.min(...expiryValues) * 1000).toISOString()
      : undefined
  writeStoredCapabilityAuthState({
    capability,
    state: {
      schemaVersion: 1,
      refreshedAt: new Date().toISOString(),
      expiresAt,
      cookieNames,
      browserKey: options.browserKey,
    },
  })
  return {
    capability,
    saved: true,
    secretKey,
    cookieCount: options.cookies.length,
    cookieNames,
    urls: capability.manifest.auth.browserUrls,
    expiresAt,
    path: path.join(capability.stateDir, 'secrets.json'),
  }
}

function parseRefreshResult(value: unknown): Omit<CapabilityAuthRefreshResult, 'capability'> {
  if (!isRecord(value)) {
    throw new Error('Capability auth refresh did not return an object')
  }
  const saved = value.saved === true
  const secretKey = typeof value.secretKey === 'string' ? value.secretKey : ''
  const cookieCount = typeof value.cookieCount === 'number' ? value.cookieCount : 0
  const cookieNames = Array.isArray(value.cookieNames)
    ? value.cookieNames.filter((item): item is string => {
        return typeof item === 'string'
      })
    : []
  const urls = Array.isArray(value.urls)
    ? value.urls.filter((item): item is string => {
        return typeof item === 'string'
      })
    : []
  const expiresAt = typeof value.expiresAt === 'string' ? value.expiresAt : undefined
  const secretsPath = typeof value.path === 'string' ? value.path : ''
  if (!saved || !secretKey || !secretsPath) {
    throw new Error('Capability auth refresh returned an incomplete result')
  }
  return {
    saved,
    secretKey,
    cookieCount,
    cookieNames,
    urls,
    expiresAt,
    path: secretsPath,
  }
}

function requireBrowserRefreshableCookieCapability(options: { id: string; cwd?: string }): CapabilityRecord {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  if (capability.manifest.auth.type !== 'cookie' || capability.manifest.auth.refresh !== 'from-browser') {
    throw new Error(`Capability ${options.id} does not declare browser-refreshable cookie auth`)
  }
  if (capability.manifest.auth.browserUrls.length === 0) {
    throw new Error(`Capability ${options.id} auth.browserUrls is required for cookie refresh`)
  }
  return capability
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
