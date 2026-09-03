import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { getTabwrightUserDataDir } from './product-paths.js'

export type CapabilityStatus = 'draft' | 'trusted' | 'disabled'
export type CapabilityLocation = 'skill'
export type CapabilityRuntime = 'browser' | 'node'
export type CapabilitySideEffect = 'read' | 'write' | 'dangerous'
export type CapabilityAuthType = 'none' | 'cookie' | 'token' | 'custom'
export type CapabilityAuthRefresh = 'none' | 'manual' | 'from-browser'
export type CapabilityRoutingHint = 'search-first' | 'exact-match-direct-run'
export type CapabilityExecutionStrategy = 'direct-request' | 'browser-request' | 'browser-ui' | 'hybrid'
export type CapabilityHumanAssistance = 'none' | 'on-challenge' | 'required'

export interface CapabilityExecutionConfig {
  strategy: CapabilityExecutionStrategy
  requiresUserBrowser: boolean
  humanAssistance: CapabilityHumanAssistance
  requirements: string[]
  observedRequestPatterns: string[]
}

export interface CapabilityAuthConfig {
  type: CapabilityAuthType
  refresh: CapabilityAuthRefresh
  secretKey?: string
  browserUrls: string[]
  requiredCookieNames: string[]
  failureSignals: string[]
}

export interface CapabilityExample {
  description?: string
  input?: unknown
  output?: unknown
}

export interface CapabilityOperation {
  title: string
  description: string
  match: string[]
  routingHint: CapabilityRoutingHint
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  permissions?: string[]
  sideEffect: CapabilitySideEffect
  requiresConfirmation: boolean
}

export interface ResolvedCapabilityOperation extends CapabilityOperation {
  id?: string
  confirmationToken: string
}

export interface CapabilityManifest {
  schemaVersion: 1
  id: string
  title: string
  description: string
  whenToUse: string[]
  whenNotToUse: string[]
  tags: string[]
  match: string[]
  // Agents may skip search/describe only when this is exact-match-direct-run and autonomy is allowed; a URL alone is not enough.
  routingHint: CapabilityRoutingHint
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  permissions: string[]
  sideEffect: CapabilitySideEffect
  requiresConfirmation: boolean
  operations: Record<string, CapabilityOperation>
  auth: CapabilityAuthConfig
  execution?: CapabilityExecutionConfig
  examples: CapabilityExample[]
  entry: string
  runtime: CapabilityRuntime
  status: CapabilityStatus
  createdBy: 'user' | 'ai'
  createdAt?: string
  updatedAt?: string
}

export interface CapabilityRecord {
  manifest: CapabilityManifest
  dir: string
  stateDir: string
  target: string
  manifestPath: string
  scriptPath: string
  location: CapabilityLocation
}

export interface CapabilityRunRecord {
  id: string
  operation?: string
  status: 'success' | 'error'
  url?: string
  durationMs: number
  inputHash: string
  error?: string
  contract?: CapabilityRunContract
  createdAt: string
}

export type CapabilityContractCheckStatus = 'passed' | 'failed' | 'not-applicable' | 'unknown'

export interface CapabilityContractFailure {
  kind: 'output-schema' | 'undeclared-host'
  message: string
}

export interface CapabilityRunContract {
  schemaVersion: 1
  fingerprint: string
  status: 'passed' | 'failed' | 'unknown'
  failures: CapabilityContractFailure[]
  output: {
    status: CapabilityContractCheckStatus
    errors: string[]
  }
  network: {
    status: CapabilityContractCheckStatus
    observedHosts: string[]
    undeclaredHosts: string[]
  }
  trust: {
    before: CapabilityStatus
    after: CapabilityStatus
    downgraded: boolean
  }
}

export interface CapabilityContractHealth {
  state: 'healthy' | 'drifted' | 'unknown'
  checkedAt?: string
  reasons: string[]
}

export interface CapabilityLifecycle {
  stage: 'trusted' | 'drifted'
  nextAction: 'run' | 'repair'
  nextCommand: string
  contractHealth: CapabilityContractHealth
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

const CapabilityStatusSchema = z.enum(['draft', 'trusted', 'disabled'])
const CapabilityRuntimeSchema = z.enum(['browser', 'node'])
const CapabilitySideEffectSchema = z.enum(['read', 'write', 'dangerous'])
const CapabilityRoutingHintSchema = z.enum(['search-first', 'exact-match-direct-run'])
const CapabilityExecutionConfigSchema = z
  .object({
    strategy: z.enum(['direct-request', 'browser-request', 'browser-ui', 'hybrid']),
    requiresUserBrowser: z.boolean().default(false),
    humanAssistance: z.enum(['none', 'on-challenge', 'required']).default('none'),
    requirements: z.array(z.string()).default([]),
    observedRequestPatterns: z.array(z.string()).default([]),
  })
  .passthrough()
const CapabilityAuthConfigSchema = z
  .object({
    type: z.enum(['none', 'cookie', 'token', 'custom']).default('none'),
    refresh: z.enum(['none', 'manual', 'from-browser']).default('none'),
    secretKey: z.string().optional(),
    browserUrls: z.array(z.string()).default([]),
    requiredCookieNames: z.array(z.string()).default([]),
    failureSignals: z.array(z.string()).default([]),
  })
  .default({
    type: 'none',
    refresh: 'none',
    browserUrls: [],
    requiredCookieNames: [],
    failureSignals: [],
  })
const CapabilityExampleSchema = z
  .object({
    description: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
  })
  .passthrough()
const CapabilityOperationSchema = z
  .object({
    title: z.string().default(''),
    description: z.string().default(''),
    match: z.array(z.string()).default([]),
    routingHint: CapabilityRoutingHintSchema.default('search-first'),
    inputSchema: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
    outputSchema: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
    permissions: z.array(z.string()).optional(),
    sideEffect: CapabilitySideEffectSchema.default('read'),
    requiresConfirmation: z.boolean().default(false),
  })
  .passthrough()
const CapabilityRunRecordSchema = z.object({
  id: z.string(),
  operation: z.string().optional(),
  status: z.enum(['success', 'error']),
  url: z.string().optional(),
  durationMs: z.number(),
  inputHash: z.string(),
  error: z.string().optional(),
  contract: z
    .object({
      schemaVersion: z.literal(1),
      fingerprint: z.string(),
      status: z.enum(['passed', 'failed', 'unknown']),
      failures: z.array(
        z.object({
          kind: z.enum(['output-schema', 'undeclared-host']),
          message: z.string(),
        }),
      ),
      output: z.object({
        status: z.enum(['passed', 'failed', 'not-applicable', 'unknown']),
        errors: z.array(z.string()),
      }),
      network: z.object({
        status: z.enum(['passed', 'failed', 'not-applicable', 'unknown']),
        observedHosts: z.array(z.string()),
        undeclaredHosts: z.array(z.string()),
      }),
      trust: z.object({
        before: CapabilityStatusSchema,
        after: CapabilityStatusSchema,
        downgraded: z.boolean(),
      }),
    })
    .optional(),
  createdAt: z.string(),
})

const CapabilityManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/),
    title: z.string().min(1),
    description: z.string().default(''),
    whenToUse: z.array(z.string()).default([]),
    whenNotToUse: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    match: z.array(z.string()).default([]),
    routingHint: CapabilityRoutingHintSchema.default('search-first'),
    inputSchema: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
    outputSchema: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {} }),
    permissions: z.array(z.string()).default([]),
    sideEffect: CapabilitySideEffectSchema.default('read'),
    requiresConfirmation: z.boolean().default(false),
    operations: z
      .record(z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/), CapabilityOperationSchema)
      .default({}),
    auth: CapabilityAuthConfigSchema,
    execution: CapabilityExecutionConfigSchema.optional(),
    examples: z.array(CapabilityExampleSchema).default([]),
    entry: z.string().default('script.js'),
    runtime: CapabilityRuntimeSchema.default('browser'),
    status: CapabilityStatusSchema.default('draft'),
    createdBy: z.enum(['user', 'ai']).default('user'),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough()

export function parseSkillRuntimeManifest(value: unknown): CapabilityManifest {
  return CapabilityManifestSchema.parse(value)
}

export function getCapabilityExecutionConfig(capability: CapabilityRecord): CapabilityExecutionConfig {
  if (capability.manifest.execution) {
    return capability.manifest.execution
  }
  if (capability.manifest.runtime === 'node') {
    return {
      strategy: 'direct-request',
      requiresUserBrowser: false,
      humanAssistance: 'none',
      requirements: [],
      observedRequestPatterns: [],
    }
  }
  return {
    strategy: 'browser-ui',
    requiresUserBrowser: false,
    humanAssistance: 'on-challenge',
    requirements: [],
    observedRequestPatterns: [],
  }
}

export function getCapabilityStateDir(options: { id: string }): string {
  validateCapabilityId(options.id)
  return path.join(getTabwrightUserDataDir(), 'skill-runtime-state', options.id)
}

export function ensureCapabilityStateDir(capability: CapabilityRecord): void {
  fs.mkdirSync(capability.stateDir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    fs.chmodSync(capability.stateDir, 0o700)
  }
}

export function validateCapabilityId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(id)) {
    throw new Error(`Invalid capability id "${id}". Use kebab-case letters and numbers only.`)
  }
}

function readJsonFile(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(content)
}

function resolveCapabilityEntry(options: { dir: string; entry: string }): string {
  const resolvedDir = path.resolve(options.dir)
  const scriptPath = path.resolve(resolvedDir, options.entry)
  if (scriptPath !== resolvedDir && !scriptPath.startsWith(`${resolvedDir}${path.sep}`)) {
    throw new Error(`Capability entry must stay inside capability directory: ${options.entry}`)
  }
  return scriptPath
}

function parseManifest(options: { manifestPath: string }): CapabilityManifest {
  const raw = readJsonFile(options.manifestPath)
  return parseSkillRuntimeManifest(raw)
}

export function readCapability(options: {
  dir: string
  location: CapabilityLocation
  stateDir?: string
  target?: string
}): CapabilityRecord {
  const manifestPath = path.join(options.dir, 'capability.json')
  const baseManifest = parseManifest({ manifestPath })
  const scriptPath = resolveCapabilityEntry({ dir: options.dir, entry: baseManifest.entry })
  const stateDir = options.stateDir || options.dir
  const record: CapabilityRecord = {
    manifest: { ...baseManifest, status: 'trusted' },
    dir: options.dir,
    stateDir,
    target: options.target || baseManifest.id,
    manifestPath,
    scriptPath,
    location: options.location,
  }
  return record
}

function resolveCapabilityRuntimeDir(options: { target: string; cwd?: string }): string | null {
  const cwd = options.cwd || process.cwd()
  const candidate = path.resolve(cwd, options.target)
  const candidates: string[] = [candidate, path.join(candidate, 'runtime')]
  return (
    candidates.find((dir) => {
      return fs.existsSync(path.join(dir, 'capability.json'))
    }) || null
  )
}

export function requireCapability(options: { id: string; cwd?: string }): CapabilityRecord {
  const runtimeDir = resolveCapabilityRuntimeDir({ target: options.id, cwd: options.cwd })
  if (!runtimeDir) {
    throw new Error(`Skill runtime not found: ${options.id}`)
  }
  const manifest = parseManifest({ manifestPath: path.join(runtimeDir, 'capability.json') })
  return readCapability({
    dir: runtimeDir,
    stateDir: getCapabilityStateDir({ id: manifest.id }),
    target: runtimeDir,
    location: 'skill',
  })
}

function capabilityMatchesText(options: { capability: CapabilityManifest; text: string }): boolean {
  return matchesCapabilityPatterns({ patterns: options.capability.match, text: options.text })
}

function matchesCapabilityPatterns(options: { patterns: string[]; text: string }): boolean {
  if (options.patterns.length === 0) {
    return true
  }
  return options.patterns.some((pattern) => {
    const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`)
    return regex.test(options.text)
  })
}

export function capabilityMatchesUrl(options: { capability: CapabilityManifest; url: string }): boolean {
  return capabilityMatchesText({ capability: options.capability, text: options.url })
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

export function getCapabilityOperations(capability: CapabilityRecord): ResolvedCapabilityOperation[] {
  const operations = Object.entries(capability.manifest.operations)
  if (operations.length === 0) {
    return [
      {
        id: undefined,
        title: capability.manifest.title,
        description: capability.manifest.description,
        match: capability.manifest.match,
        routingHint: capability.manifest.routingHint,
        inputSchema: capability.manifest.inputSchema,
        outputSchema: capability.manifest.outputSchema,
        permissions: capability.manifest.permissions,
        sideEffect: capability.manifest.sideEffect,
        requiresConfirmation: capability.manifest.requiresConfirmation,
        confirmationToken: capability.manifest.id,
      },
    ]
  }
  return operations.map(([id, operation]) => {
    return {
      ...operation,
      id,
      permissions: operation.permissions || capability.manifest.permissions,
      confirmationToken: `${capability.manifest.id}:${id}`,
    }
  })
}

export function getCapabilitySafetySummary(capability: CapabilityRecord): {
  sideEffect: CapabilitySideEffect | 'mixed'
  requiresConfirmation: boolean
} {
  const operations = getCapabilityOperations(capability)
  const sideEffects = new Set(
    operations.map((operation) => {
      return operation.sideEffect
    }),
  )
  return {
    sideEffect: sideEffects.size === 1 ? operations[0]?.sideEffect || capability.manifest.sideEffect : 'mixed',
    requiresConfirmation: operations.some((operation) => {
      return operation.requiresConfirmation
    }),
  }
}

export function resolveCapabilityOperation(options: {
  capability: CapabilityRecord
  input: unknown
}): ResolvedCapabilityOperation {
  const operations = getCapabilityOperations(options.capability)
  if (operations.length === 1 && operations[0]?.id === undefined) {
    return operations[0]
  }
  if (!isPlainObject(options.input) || typeof options.input.action !== 'string') {
    throw new Error(
      `Capability ${options.capability.manifest.id} requires input.action. Use one of: ${operations
        .map((operation) => {
          return operation.id
        })
        .join(', ')}`,
    )
  }
  const action = options.input.action
  const operation = operations.find((candidate) => {
    return candidate.id === action
  })
  if (!operation) {
    throw new Error(
      `Unsupported capability action "${action}". Use one of: ${operations
        .map((candidate) => {
          return candidate.id
        })
        .join(', ')}`,
    )
  }
  return operation
}

export function readCapabilitySecrets(options: { capability: CapabilityRecord }): Record<string, unknown> {
  const secretsPath = path.join(options.capability.stateDir, 'secrets.json')
  if (!fs.existsSync(secretsPath)) {
    return {}
  }
  const parsed = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'))
  if (!isPlainObject(parsed)) {
    throw new Error(`Capability secrets.json must contain an object: ${secretsPath}`)
  }
  return parsed
}

export function writeCapabilitySecrets(options: {
  capability: CapabilityRecord
  secrets: Record<string, unknown>
}): void {
  const secretsPath = path.join(options.capability.stateDir, 'secrets.json')
  ensureCapabilityStateDir(options.capability)
  fs.writeFileSync(secretsPath, `${JSON.stringify(options.secrets, null, 2)}\n`, { mode: 0o600 })
  if (process.platform === 'win32') {
    return
  }
  fs.chmodSync(secretsPath, 0o600)
}

export function validateJsonAgainstSchema(options: {
  schema: Record<string, unknown>
  value: unknown
  label: string
}): ValidationResult {
  const errors: string[] = []
  const type = typeof options.schema.type === 'string' ? options.schema.type : undefined
  if (type && !matchesJsonType({ value: options.value, type })) {
    errors.push(`${options.label} must be ${type}`)
    return { valid: errors.length === 0, errors }
  }

  if (type === 'object' || options.schema.properties || options.schema.required) {
    if (!isPlainObject(options.value)) {
      errors.push(`${options.label} must be object`)
      return { valid: false, errors }
    }
    const objectValue = options.value

    const required = Array.isArray(options.schema.required)
      ? options.schema.required.filter((value): value is string => {
          return typeof value === 'string'
        })
      : []
    const properties = isPlainObject(options.schema.properties) ? options.schema.properties : {}

    errors.push(
      ...required
        .filter((key) => {
          return !(key in objectValue)
        })
        .map((key) => {
          return `${options.label}.${key} is required`
        }),
    )

    errors.push(
      ...Object.entries(properties).flatMap(([key, rawPropertySchema]) => {
        if (!(key in objectValue)) {
          return []
        }
        if (!isPlainObject(rawPropertySchema)) {
          return []
        }
        const propertyType = typeof rawPropertySchema.type === 'string' ? rawPropertySchema.type : undefined
        if (!propertyType) {
          return []
        }
        if (matchesJsonType({ value: objectValue[key], type: propertyType })) {
          return []
        }
        return [`${options.label}.${key} must be ${propertyType}`]
      }),
    )
  }

  return { valid: errors.length === 0, errors }
}

function matchesJsonType(options: { value: unknown; type: string }): boolean {
  if (options.type === 'array') {
    return Array.isArray(options.value)
  }
  if (options.type === 'object') {
    return isPlainObject(options.value)
  }
  if (options.type === 'integer') {
    return Number.isInteger(options.value)
  }
  if (options.type === 'number') {
    return typeof options.value === 'number'
  }
  if (options.type === 'string') {
    return typeof options.value === 'string'
  }
  if (options.type === 'boolean') {
    return typeof options.value === 'boolean'
  }
  if (options.type === 'null') {
    return options.value === null
  }
  return true
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function appendCapabilityRun(options: { capability: CapabilityRecord; record: CapabilityRunRecord }): void {
  ensureCapabilityStateDir(options.capability)
  const runsPath = path.join(options.capability.stateDir, 'runs.jsonl')
  fs.appendFileSync(runsPath, `${JSON.stringify(options.record)}\n`, { mode: 0o600 })
  if (process.platform !== 'win32') {
    fs.chmodSync(runsPath, 0o600)
  }
}

export function readCapabilityRuns(options: { capability: CapabilityRecord; limit?: number }): CapabilityRunRecord[] {
  const runsPath = path.join(options.capability.stateDir, 'runs.jsonl')
  if (!fs.existsSync(runsPath)) {
    return []
  }
  const lines = fs
    .readFileSync(runsPath, 'utf-8')
    .split(/\r?\n/)
    .filter((line) => {
      return line.trim().length > 0
    })
  const selectedLines = typeof options.limit === 'number' ? lines.slice(-options.limit) : lines
  return selectedLines.flatMap((line) => {
    const value: unknown = (() => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })()
    const parsed = CapabilityRunRecordSchema.safeParse(value)
    if (!parsed.success) {
      return []
    }
    return [parsed.data]
  })
}

export function getCapabilityContractFingerprint(capability: CapabilityRecord): string {
  const { status: _status, createdAt: _createdAt, updatedAt: _updatedAt, ...contractManifest } = capability.manifest
  const script = fs.readFileSync(capability.scriptPath, 'utf-8')
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ manifest: contractManifest, script }))
    .digest('hex')
}

export function getCapabilityContractHealth(capability: CapabilityRecord): CapabilityContractHealth {
  const fingerprintResult: { success: true; fingerprint: string } | { success: false; reason: string } = (() => {
    try {
      return { success: true, fingerprint: getCapabilityContractFingerprint(capability) }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, reason: `Cannot validate the capability entry script: ${message}` }
    }
  })()
  if (!fingerprintResult.success) {
    return {
      state: 'drifted',
      reasons: [fingerprintResult.reason],
    }
  }
  const fingerprint = fingerprintResult.fingerprint
  const latestContractRuns: CapabilityRunRecord[] = readCapabilityRuns({ capability, limit: 100 })
    .reverse()
    .filter((run) => {
      return run.contract?.fingerprint === fingerprint && run.contract.status !== 'unknown'
    })
    .reduce<CapabilityRunRecord[]>((latestRuns, run) => {
      const alreadyIncluded = latestRuns.some((latestRun) => {
        return latestRun.operation === run.operation
      })
      return alreadyIncluded ? latestRuns : [...latestRuns, run]
    }, [])

  if (latestContractRuns.length === 0) {
    return {
      state: 'unknown',
      reasons: ['No conformance evidence exists for the current script and contract.'],
    }
  }

  const failedRuns = latestContractRuns.filter((run) => {
    return run.contract?.status === 'failed'
  })
  if (failedRuns.length > 0) {
    return {
      state: 'drifted',
      checkedAt: failedRuns[0]?.createdAt,
      reasons: failedRuns.flatMap((run) => {
        return (run.contract?.failures || []).map((failure) => {
          return run.operation ? `${run.operation}: ${failure.message}` : failure.message
        })
      }),
    }
  }

  return {
    state: 'healthy',
    checkedAt: latestContractRuns[0]?.createdAt,
    reasons: [],
  }
}

export function getCapabilityOperationContractHealth(options: {
  capability: CapabilityRecord
  operation: string | undefined
}): CapabilityContractHealth {
  const fingerprintResult: { success: true; fingerprint: string } | { success: false; reason: string } = (() => {
    try {
      return { success: true, fingerprint: getCapabilityContractFingerprint(options.capability) }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, reason: `Cannot validate the capability entry script: ${message}` }
    }
  })()
  if (!fingerprintResult.success) {
    return {
      state: 'drifted',
      reasons: [fingerprintResult.reason],
    }
  }
  const latestContractRun = readCapabilityRuns({ capability: options.capability, limit: 100 })
    .reverse()
    .find((run) => {
      return (
        run.operation === options.operation &&
        run.contract?.fingerprint === fingerprintResult.fingerprint &&
        run.contract.status !== 'unknown'
      )
    })
  if (!latestContractRun?.contract) {
    return {
      state: 'unknown',
      reasons: ['No conformance evidence exists for this operation and the current contract.'],
    }
  }
  if (latestContractRun.contract.status === 'failed') {
    return {
      state: 'drifted',
      checkedAt: latestContractRun.createdAt,
      reasons: latestContractRun.contract.failures.map((failure) => {
        return failure.message
      }),
    }
  }
  return {
    state: 'healthy',
    checkedAt: latestContractRun.createdAt,
    reasons: [],
  }
}

export function getCapabilityLifecycle(capability: CapabilityRecord): CapabilityLifecycle {
  const contractHealth = getCapabilityContractHealth(capability)
  const skillDir = path.dirname(capability.dir)
  const commandTarget = quoteShell(skillDir)
  const stage: CapabilityLifecycle['stage'] = contractHealth.state === 'drifted' ? 'drifted' : 'trusted'
  const nextAction: CapabilityLifecycle['nextAction'] = stage === 'drifted' ? 'repair' : 'run'
  const nextCommand: string = (() => {
    if (nextAction === 'repair') {
      return `tabwright skill runtime validate ${commandTarget} --json`
    }

    const exampleInput = capability.manifest.examples.find((example) => {
      return isPlainObject(example.input)
    })?.input
    const input = isPlainObject(exampleInput) ? exampleInput : {}
    const operation: ResolvedCapabilityOperation | undefined = (() => {
      try {
        return resolveCapabilityOperation({ capability, input })
      } catch {
        return undefined
      }
    })()
    const args = [
      'tabwright',
      'skill',
      'runtime',
      'run',
      commandTarget,
      ...(capability.manifest.runtime === 'browser' ? ['--browser', 'user'] : []),
      '--input-json',
      quoteShell(JSON.stringify(input)),
      ...(operation?.requiresConfirmation ? ['--confirm', operation.confirmationToken] : []),
      '--json',
    ]
    return args.join(' ')
  })()

  return { stage, nextAction, nextCommand, contractHealth }
}

export function getCapabilityAutonomy(
  capability: CapabilityRecord,
  operation?: ResolvedCapabilityOperation,
): { allowed: boolean; reasons: string[] } {
  const contractHealth = operation
    ? getCapabilityOperationContractHealth({ capability, operation: operation.id })
    : getCapabilityContractHealth(capability)
  const execution = getCapabilityExecutionConfig(capability)
  const operations = operation ? [operation] : getCapabilityOperations(capability)
  const blockers = [
    contractHealth.state === 'drifted' ? 'current contract failed conformance' : '',
    execution.humanAssistance === 'required' ? 'execution requires human assistance' : '',
    ...operations.flatMap((candidate) => {
      return [
        candidate.sideEffect === 'read'
          ? ''
          : `${candidate.id ? `operation ${candidate.id} ` : ''}sideEffect is ${candidate.sideEffect}`,
        candidate.requiresConfirmation
          ? `${candidate.id ? `operation ${candidate.id} ` : ''}requires confirmation`
          : '',
      ]
    }),
  ].filter((reason) => {
    return reason.length > 0
  })
  return {
    allowed: blockers.length === 0,
    reasons: blockers.length === 0 ? ['ready read-only Skill runtime'] : blockers,
  }
}

export function toCapabilityContract(capability: CapabilityRecord): Record<string, unknown> {
  const safety = getCapabilitySafetySummary(capability)
  const operations = Object.fromEntries(
    getCapabilityOperations(capability)
      .filter((operation) => {
        return operation.id !== undefined
      })
      .map((operation) => {
        return [
          operation.id,
          {
            title: operation.title,
            description: operation.description,
            match: operation.match,
            routingHint: operation.routingHint,
            inputSchema: operation.inputSchema,
            outputSchema: operation.outputSchema,
            permissions: operation.permissions,
            sideEffect: operation.sideEffect,
            requiresConfirmation: operation.requiresConfirmation,
            confirmationToken: operation.confirmationToken,
            autonomousInvocation: getCapabilityAutonomy(capability, operation),
          },
        ]
      }),
  )
  return {
    ...toCapabilitySummary(capability),
    whenToUse: capability.manifest.whenToUse,
    whenNotToUse: capability.manifest.whenNotToUse,
    tags: capability.manifest.tags,
    sideEffect: safety.sideEffect,
    requiresConfirmation: safety.requiresConfirmation,
    auth: capability.manifest.auth,
    execution: getCapabilityExecutionConfig(capability),
    examples: capability.manifest.examples,
    autonomousInvocation: getCapabilityAutonomy(capability),
    operations,
    recentRuns: readCapabilityRuns({ capability, limit: 5 }),
    lifecycle: getCapabilityLifecycle(capability),
  }
}

export function toCapabilitySummary(capability: CapabilityRecord): Record<string, unknown> {
  const safety = getCapabilitySafetySummary(capability)
  return {
    id: capability.manifest.id,
    title: capability.manifest.title,
    description: capability.manifest.description,
    status: capability.manifest.status,
    runtime: capability.manifest.runtime,
    match: capability.manifest.match,
    routingHint: capability.manifest.routingHint,
    permissions: capability.manifest.permissions,
    sideEffect: safety.sideEffect,
    requiresConfirmation: safety.requiresConfirmation,
    operations: capability.manifest.operations,
    whenToUse: capability.manifest.whenToUse,
    whenNotToUse: capability.manifest.whenNotToUse,
    tags: capability.manifest.tags,
    auth: capability.manifest.auth,
    execution: getCapabilityExecutionConfig(capability),
    inputSchema: capability.manifest.inputSchema,
    outputSchema: capability.manifest.outputSchema,
    location: capability.location,
    dir: capability.dir,
    stateDir: capability.stateDir,
    target: capability.target,
  }
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
