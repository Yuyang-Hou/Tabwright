import path from 'node:path'
import { requireCapability, type CapabilityRecord } from './capability-registry.js'
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
  path: string
}

export async function refreshCapabilityAuthWithExecutor(options: {
  executor: CapabilityAuthExecutor
  id: string
  cwd?: string
  timeout?: number
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
  return {
    capability,
    ...parsed,
  }
}

function buildCookieRefreshCode(options: { capability: CapabilityRecord }): string {
  const secretKey = options.capability.manifest.auth.secretKey || 'cookieHeader'
  const secretsPath = path.join(options.capability.dir, 'secrets.json')
  return [
    'const fs = await globalThis.import("node:fs")',
    `const urls = ${JSON.stringify(options.capability.manifest.auth.browserUrls)};`,
    `const requiredCookieNames = ${JSON.stringify(options.capability.manifest.auth.requiredCookieNames)};`,
    `const secretKey = ${JSON.stringify(secretKey)};`,
    `const secretsPath = ${JSON.stringify(secretsPath)};`,
    `const secretsDir = ${JSON.stringify(options.capability.dir)};`,
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
    'fs.mkdirSync(secretsDir, { recursive: true });',
    'fs.writeFileSync(secretsPath, JSON.stringify(nextSecrets, null, 2), { mode: 0o600 });',
    'if (process.platform !== "win32") {',
    '  fs.chmodSync(secretsPath, 0o600);',
    '}',
    'return {',
    '  saved: true,',
    '  secretKey,',
    '  cookieCount: cookies.length,',
    '  cookieNames,',
    '  urls,',
    '  path: secretsPath,',
    '};',
    `//# sourceURL=playwriter-capability-auth://${options.capability.manifest.id}`,
    '',
  ].join('\n')
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
    path: secretsPath,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
