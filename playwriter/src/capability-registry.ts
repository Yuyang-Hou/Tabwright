import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'

export type CapabilityStatus = 'draft' | 'trusted' | 'disabled'
export type CapabilityLocation = 'project' | 'user'
export type CapabilityRuntime = 'browser' | 'node'
export type CapabilitySideEffect = 'read' | 'write' | 'dangerous'
export type CapabilityAuthType = 'none' | 'cookie' | 'token' | 'custom'
export type CapabilityAuthRefresh = 'none' | 'manual' | 'from-browser'
export type CapabilityRoutingHint = 'search-first' | 'exact-match-direct-run'

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
  auth: CapabilityAuthConfig
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
  manifestPath: string
  scriptPath: string
  location: CapabilityLocation
}

export interface CapabilityRunRecord {
  id: string
  status: 'success' | 'error'
  url?: string
  durationMs: number
  inputHash: string
  error?: string
  createdAt: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface CapabilitySearchResult {
  capability: CapabilityRecord
  score: number
  reasons: string[]
}

export interface CapabilityRouteResult {
  capability: CapabilityRecord
  input: Record<string, unknown>
  command: string
  shellCommand: string
  commandWarning: string
  executionHint: {
    routeCanRunSandboxed: boolean
    runRequiresEscalatedSandbox: boolean
    commandMustStartWith: string
    reason: string
  }
  reasons: string[]
  matchedText: string
}

export type CapabilityManifestPatch = Partial<Omit<CapabilityManifest, 'schemaVersion' | 'id' | 'createdAt'>>

const CapabilityStatusSchema = z.enum(['draft', 'trusted', 'disabled'])
const CapabilityRuntimeSchema = z.enum(['browser', 'node'])
const CapabilitySideEffectSchema = z.enum(['read', 'write', 'dangerous'])
const CapabilityRoutingHintSchema = z.enum(['search-first', 'exact-match-direct-run'])
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
const CapabilityRunRecordSchema = z.object({
  id: z.string(),
  status: z.enum(['success', 'error']),
  url: z.string().optional(),
  durationMs: z.number(),
  inputHash: z.string(),
  error: z.string().optional(),
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
    auth: CapabilityAuthConfigSchema,
    examples: z.array(CapabilityExampleSchema).default([]),
    entry: z.string().default('script.js'),
    runtime: CapabilityRuntimeSchema.default('browser'),
    status: CapabilityStatusSchema.default('draft'),
    createdBy: z.enum(['user', 'ai']).default('user'),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough()

export function getUserCapabilitiesDir(): string {
  return path.join(os.homedir(), '.playwriter', 'capabilities')
}

export function getProjectCapabilitiesDir(options: { cwd?: string } = {}): string {
  return path.join(options.cwd || process.cwd(), '.playwriter', 'capabilities')
}

export function getCapabilityRoots(options: { cwd?: string } = {}): Array<{ dir: string; location: CapabilityLocation }> {
  return [
    { dir: getProjectCapabilitiesDir({ cwd: options.cwd }), location: 'project' },
    { dir: getUserCapabilitiesDir(), location: 'user' },
  ]
}

export function validateCapabilityId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(id)) {
    throw new Error(`Invalid capability id "${id}". Use kebab-case letters and numbers only.`)
  }
}

export function getCapabilityDir(options: { id: string; location: CapabilityLocation; cwd?: string }): string {
  validateCapabilityId(options.id)
  const root =
    options.location === 'project' ? getProjectCapabilitiesDir({ cwd: options.cwd }) : getUserCapabilitiesDir()
  return path.join(root, options.id)
}

function readJsonFile(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(content)
}

function writeJsonFile(options: { filePath: string; value: unknown }): void {
  fs.writeFileSync(options.filePath, `${JSON.stringify(options.value, null, 2)}\n`)
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
  return CapabilityManifestSchema.parse(raw)
}

export function readCapability(options: { dir: string; location: CapabilityLocation }): CapabilityRecord {
  const manifestPath = path.join(options.dir, 'capability.json')
  const manifest = parseManifest({ manifestPath })
  const scriptPath = resolveCapabilityEntry({ dir: options.dir, entry: manifest.entry })
  return {
    manifest,
    dir: options.dir,
    manifestPath,
    scriptPath,
    location: options.location,
  }
}

export function listCapabilities(options: { cwd?: string } = {}): CapabilityRecord[] {
  return getCapabilityRoots({ cwd: options.cwd }).flatMap((root) => {
    if (!fs.existsSync(root.dir)) {
      return []
    }
    return fs
      .readdirSync(root.dir, { withFileTypes: true })
      .filter((entry) => {
        return entry.isDirectory()
      })
      .flatMap((entry) => {
        const dir = path.join(root.dir, entry.name)
        const manifestPath = path.join(dir, 'capability.json')
        if (!fs.existsSync(manifestPath)) {
          return []
        }
        try {
          return [readCapability({ dir, location: root.location })]
        } catch {
          return []
        }
      })
  })
}

export function findCapability(options: { id: string; cwd?: string }): CapabilityRecord | null {
  validateCapabilityId(options.id)
  return (
    getCapabilityRoots({ cwd: options.cwd })
      .map((root) => {
        const dir = path.join(root.dir, options.id)
        if (!fs.existsSync(path.join(dir, 'capability.json'))) {
          return null
        }
        return readCapability({ dir, location: root.location })
      })
      .find((record) => {
        return record !== null
      }) || null
  )
}

export function requireCapability(options: { id: string; cwd?: string }): CapabilityRecord {
  const capability = findCapability(options)
  if (!capability) {
    throw new Error(`Capability not found: ${options.id}`)
  }
  return capability
}

export function capabilityMatchesText(options: { capability: CapabilityManifest; text: string }): boolean {
  if (options.capability.match.length === 0) {
    return true
  }
  return options.capability.match.some((pattern) => {
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

export function createCapability(options: {
  id: string
  title?: string
  description?: string
  location?: CapabilityLocation
  cwd?: string
  overwrite?: boolean
  createdBy?: 'user' | 'ai'
  runtime?: CapabilityRuntime
}): CapabilityRecord {
  validateCapabilityId(options.id)
  const location = options.location || 'user'
  const dir = getCapabilityDir({ id: options.id, location, cwd: options.cwd })
  if (fs.existsSync(dir) && !options.overwrite) {
    throw new Error(`Capability already exists: ${options.id}`)
  }

  fs.mkdirSync(dir, { recursive: true })
  const now = new Date().toISOString()
  const manifest: CapabilityManifest = {
    schemaVersion: 1,
    id: options.id,
    title: options.title || options.id,
    description: options.description || '',
    whenToUse: options.description ? [options.description] : [],
    whenNotToUse: [],
    tags: [],
    match: [],
    routingHint: 'search-first',
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', properties: {} },
    permissions: options.runtime === 'node' ? ['network'] : ['browser.read'],
    sideEffect: 'read',
    requiresConfirmation: false,
    auth: {
      type: 'none',
      refresh: 'none',
      browserUrls: [],
      requiredCookieNames: [],
      failureSignals: [],
    },
    examples: [],
    entry: 'script.js',
    runtime: options.runtime || 'browser',
    status: 'draft',
    createdBy: options.createdBy || 'user',
    createdAt: now,
    updatedAt: now,
  }

  writeJsonFile({ filePath: path.join(dir, 'capability.json'), value: manifest })
  fs.writeFileSync(path.join(dir, 'script.js'), getDefaultCapabilityScript({ runtime: manifest.runtime }))
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${manifest.title}\n\n${manifest.description}\n`)
  return readCapability({ dir, location })
}

export function updateCapabilityManifest(options: {
  id: string
  cwd?: string
  patch: Partial<Omit<CapabilityManifest, 'schemaVersion' | 'id' | 'createdAt'>>
}): CapabilityRecord {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  const nextManifest: CapabilityManifest = {
    ...capability.manifest,
    ...options.patch,
    id: capability.manifest.id,
    schemaVersion: 1,
    createdAt: capability.manifest.createdAt,
    updatedAt: new Date().toISOString(),
  }
  writeJsonFile({ filePath: capability.manifestPath, value: CapabilityManifestSchema.parse(nextManifest) })
  return readCapability({ dir: capability.dir, location: capability.location })
}

export function updateCapabilityScript(options: { id: string; cwd?: string; source: string }): CapabilityRecord {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  fs.writeFileSync(capability.scriptPath, options.source)
  const nextStatus: CapabilityStatus = capability.manifest.status === 'trusted' ? 'draft' : capability.manifest.status
  return updateCapabilityManifest({
    id: options.id,
    cwd: options.cwd,
    patch: { status: nextStatus },
  })
}

export function readCapabilityScript(options: { id: string; cwd?: string }): string {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  return fs.readFileSync(capability.scriptPath, 'utf-8')
}

export function readCapabilitySecrets(options: { capability: CapabilityRecord }): Record<string, unknown> {
  const secretsPath = path.join(options.capability.dir, 'secrets.json')
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
  const secretsPath = path.join(options.capability.dir, 'secrets.json')
  fs.mkdirSync(options.capability.dir, { recursive: true })
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
  fs.appendFileSync(path.join(options.capability.dir, 'runs.jsonl'), `${JSON.stringify(options.record)}\n`)
}

export function readCapabilityRuns(options: { capability: CapabilityRecord; limit?: number }): CapabilityRunRecord[] {
  const runsPath = path.join(options.capability.dir, 'runs.jsonl')
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
    const parsed = CapabilityRunRecordSchema.safeParse(JSON.parse(line))
    if (!parsed.success) {
      return []
    }
    return [parsed.data]
  })
}

export function getCapabilityAutonomy(capability: CapabilityRecord): { allowed: boolean; reasons: string[] } {
  const blockers = [
    capability.manifest.status === 'trusted' ? '' : `status is ${capability.manifest.status}`,
    capability.manifest.sideEffect === 'read' ? '' : `sideEffect is ${capability.manifest.sideEffect}`,
    capability.manifest.requiresConfirmation ? 'requires confirmation' : '',
  ].filter((reason) => {
    return reason.length > 0
  })
  return {
    allowed: blockers.length === 0,
    reasons: blockers.length === 0 ? ['trusted read-only capability'] : blockers,
  }
}

export function toCapabilityContract(capability: CapabilityRecord): Record<string, unknown> {
  return {
    ...toCapabilitySummary(capability),
    whenToUse: capability.manifest.whenToUse,
    whenNotToUse: capability.manifest.whenNotToUse,
    tags: capability.manifest.tags,
    sideEffect: capability.manifest.sideEffect,
    requiresConfirmation: capability.manifest.requiresConfirmation,
    auth: capability.manifest.auth,
    examples: capability.manifest.examples,
    autonomousInvocation: getCapabilityAutonomy(capability),
    recentRuns: readCapabilityRuns({ capability, limit: 5 }),
  }
}

export function searchCapabilities(options: { query: string; cwd?: string; limit?: number }): CapabilitySearchResult[] {
  const tokens = tokenizeSearchQuery(options.query)
  const results = dedupeCapabilitiesById(listCapabilities({ cwd: options.cwd }))
    .map((capability) => {
      return scoreCapabilitySearch({ capability, tokens })
    })
    .filter((result) => {
      return tokens.length === 0 || result.score > 0
    })
    .sort((left, right) => {
      return right.score - left.score || left.capability.manifest.id.localeCompare(right.capability.manifest.id)
    })
  return typeof options.limit === 'number' ? results.slice(0, options.limit) : results
}

export function routeCapabilities(options: { task: string; cwd?: string; limit?: number }): CapabilityRouteResult[] {
  const task = options.task.trim()
  if (!task) {
    return []
  }
  const candidates = getRouteCandidateTexts(task)
  const routes = dedupeCapabilitiesById(listCapabilities({ cwd: options.cwd }))
    .filter((capability) => {
      return capability.manifest.routingHint === 'exact-match-direct-run'
    })
    .filter((capability) => {
      return getCapabilityAutonomy(capability).allowed
    })
    .flatMap((capability) => {
      const matchedText = candidates.find((candidate) => {
        return capability.manifest.match.length > 0 && capabilityMatchesText({ capability: capability.manifest, text: candidate })
      })
      if (!matchedText) {
        return []
      }
      const input = buildRouteInput({ capability, task, matchedText })
      const shellCommand = buildCapabilityRunCommand({ id: capability.manifest.id, input })
      return [
        {
          capability,
          input,
          command: shellCommand,
          shellCommand,
          commandWarning: buildCapabilityCommandWarning({ id: capability.manifest.id }),
          executionHint: {
            routeCanRunSandboxed: true,
            runRequiresEscalatedSandbox: true,
            commandMustStartWith: 'playwriter capability run ',
            reason:
              'capability run writes runs.jsonl and may write artifacts under ~/.playwriter/capabilities; use escalated/unsandboxed execution in Codex sandbox',
          },
          reasons: [
            'routingHint: exact-match-direct-run',
            'autonomousInvocation: trusted read-only capability',
            `matched: ${matchedText}`,
          ],
          matchedText,
        },
      ]
    })
  return typeof options.limit === 'number' ? routes.slice(0, options.limit) : routes
}

function dedupeCapabilitiesById(capabilities: CapabilityRecord[]): CapabilityRecord[] {
  return capabilities.filter((capability, index) => {
    return (
      capabilities.findIndex((candidate) => {
        return candidate.manifest.id === capability.manifest.id
      }) === index
    )
  })
}

function getRouteCandidateTexts(task: string): string[] {
  const urls = task.match(/https?:\/\/[^\s<>"']+/g) || []
  return Array.from(
    new Set(
      [task, ...urls].map((value) => {
        return value.replace(/[),，。；;]+$/g, '')
      }),
    ),
  )
}

function buildRouteInput(options: {
  capability: CapabilityRecord
  task: string
  matchedText: string
}): Record<string, unknown> {
  if (options.matchedText.startsWith('http') && hasInputProperty({ capability: options.capability, name: 'url' })) {
    return { url: options.matchedText }
  }
  if (hasInputProperty({ capability: options.capability, name: 'query' })) {
    return { query: options.task }
  }
  return {}
}

function hasInputProperty(options: { capability: CapabilityRecord; name: string }): boolean {
  const properties = isPlainObject(options.capability.manifest.inputSchema.properties)
    ? options.capability.manifest.inputSchema.properties
    : {}
  return properties[options.name] !== undefined
}

export function buildCapabilityRunCommand(options: { id: string; input: Record<string, unknown> }): string {
  return `playwriter capability run ${options.id} --input-json ${quoteShell(JSON.stringify(options.input))} --json`
}

function buildCapabilityCommandWarning(options: { id: string }): string {
  return `${options.id} is a Playwriter capability id, not a shell command. Do not run "${options.id} ..."; run shellCommand exactly.`
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function toCapabilitySummary(capability: CapabilityRecord): Record<string, unknown> {
  return {
    id: capability.manifest.id,
    title: capability.manifest.title,
    description: capability.manifest.description,
    status: capability.manifest.status,
    runtime: capability.manifest.runtime,
    match: capability.manifest.match,
    routingHint: capability.manifest.routingHint,
    permissions: capability.manifest.permissions,
    sideEffect: capability.manifest.sideEffect,
    requiresConfirmation: capability.manifest.requiresConfirmation,
    whenToUse: capability.manifest.whenToUse,
    whenNotToUse: capability.manifest.whenNotToUse,
    tags: capability.manifest.tags,
    auth: capability.manifest.auth,
    inputSchema: capability.manifest.inputSchema,
    outputSchema: capability.manifest.outputSchema,
    location: capability.location,
    dir: capability.dir,
  }
}

function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .map((token) => {
      return token.trim()
    })
    .filter((token) => {
      return token.length > 0
    })
}

function scoreCapabilitySearch(options: { capability: CapabilityRecord; tokens: string[] }): CapabilitySearchResult {
  const weightedFields: Array<{ label: string; weight: number; values: string[] }> = [
    { label: 'id', weight: 5, values: [options.capability.manifest.id] },
    { label: 'title', weight: 6, values: [options.capability.manifest.title] },
    { label: 'description', weight: 4, values: [options.capability.manifest.description] },
    { label: 'whenToUse', weight: 8, values: options.capability.manifest.whenToUse },
    { label: 'tags', weight: 6, values: options.capability.manifest.tags },
    { label: 'match', weight: 3, values: options.capability.manifest.match },
  ]

  const matches = weightedFields.flatMap((field) => {
    const text = field.values.join(' ').toLowerCase()
    const matchedTokens = options.tokens.filter((token) => {
      return text.includes(token)
    })
    if (matchedTokens.length === 0) {
      return []
    }
    return [
      {
        score: matchedTokens.length * field.weight,
        reason: `${field.label}: ${matchedTokens.join(', ')}`,
      },
    ]
  })

  const negativeMatches = options.capability.manifest.whenNotToUse.flatMap((text) => {
    const lowerText = text.toLowerCase()
    const matchedTokens = options.tokens.filter((token) => {
      return lowerText.includes(token)
    })
    if (matchedTokens.length === 0) {
      return []
    }
    return [matchedTokens.length * 3]
  })

  return {
    capability: options.capability,
    score:
      matches.reduce((total, match) => {
        return total + match.score
      }, 0) -
      negativeMatches.reduce((total, score) => {
        return total + score
      }, 0),
    reasons: matches.map((match) => {
      return match.reason
    }),
  }
}

function getDefaultCapabilityScript(options: { runtime: CapabilityRuntime }): string {
  if (options.runtime === 'node') {
    return [
      'return {',
      '  input,',
      '  hasSecrets: Object.keys(secrets).length > 0,',
      '}',
      '',
    ].join('\n')
  }

  return [
    'const currentUrl = page.url()',
    '',
    'return {',
    '  currentUrl,',
    '  input,',
    '}',
    '',
  ].join('\n')
}
