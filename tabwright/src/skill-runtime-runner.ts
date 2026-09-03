import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import vm from 'node:vm'
import {
  appendCapabilityRun,
  capabilityMatchesUrl,
  ensureCapabilityStateDir,
  getCapabilityContractFingerprint,
  getCapabilityOperationContractHealth,
  readCapabilitySecrets,
  requireCapability,
  resolveCapabilityOperation,
  validateJsonAgainstSchema,
  type CapabilityContractCheckStatus,
  type CapabilityRecord,
  type CapabilityRunContract,
  type CapabilityRunRecord,
  type ResolvedCapabilityOperation,
} from './skill-runtime.js'
export interface PreparedSkillRuntimeRun {
  capability: CapabilityRecord
  operation: ResolvedCapabilityOperation
  code: string
  input: unknown
  inputHash: string
}

export interface NodeSkillRuntimeRunResult {
  capability: CapabilityRecord
  output: unknown
  text: string
  isError: boolean
  runRecord: CapabilityRunRecord
}

export interface SkillRuntimeExecutionObservation {
  status: 'success' | 'error'
  output: unknown
  error?: string
  observedNetworkUrls?: string[]
  url?: string
}

export interface FinalizedSkillRuntimeRun {
  capability: CapabilityRecord
  output: unknown
  runRecord: CapabilityRunRecord
  contractError?: Error
}

interface SkillRuntimeExecutionEnvelope {
  __tabwrightSkillRuntimeEnvelope: 1
  output: unknown
  observedNetworkUrls: string[]
  url?: string
  error?: string
}

interface NodeSkillRuntimeExecution {
  output: unknown
  observedNetworkUrls: string[]
}

class ObservedSkillRuntimeExecutionError extends Error {
  observedNetworkUrls: string[]

  constructor(options: { cause: unknown; observedNetworkUrls: string[] }) {
    const message = options.cause instanceof Error ? options.cause.message : String(options.cause)
    super(message, { cause: options.cause })
    this.name = 'ObservedSkillRuntimeExecutionError'
    this.observedNetworkUrls = options.observedNetworkUrls
  }
}

interface SkillRuntimeArtifacts {
  root: string
  path(options: { filename: string }): string
  writeJson(options: { filename: string; value: unknown }): string
  writeText(options: { filename: string; text: string }): string
}

export function prepareSkillRuntimeRun(options: {
  id: string
  input: unknown
  cwd?: string
  force?: boolean
  confirmation?: string
}): PreparedSkillRuntimeRun {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  const operation = validateSkillRuntimeRunnable({
    capability,
    input: options.input,
    force: options.force,
    confirmation: options.confirmation,
  })

  const script = fs.readFileSync(capability.scriptPath, 'utf-8')
  return {
    capability,
    operation,
    code: buildSkillRuntimeCode({ capability, operation, script, input: options.input, force: options.force }),
    input: options.input,
    inputHash: hashInput(options.input),
  }
}

export async function runNodeSkillRuntime(options: {
  id: string
  input: unknown
  timeout?: number
  cwd?: string
  force?: boolean
  confirmation?: string
}): Promise<NodeSkillRuntimeRunResult> {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  if (capability.manifest.runtime !== 'node') {
    throw new Error(`Skill runtime ${options.id} is "${capability.manifest.runtime}", not "node"`)
  }
  const operation = validateSkillRuntimeRunnable({
    capability,
    input: options.input,
    force: options.force,
    confirmation: options.confirmation,
  })

  const start = Date.now()
  const inputHash = hashInput(options.input)
  const execution = await executeNodeSkillRuntimeScript({
    capability,
    operation,
    input: options.input,
    timeout: options.timeout || 10000,
  }).catch((error: unknown) => {
    const finalized = finalizeSkillRuntimeRun({
      capability,
      operation,
      cwd: options.cwd,
      inputHash,
      startedAt: start,
      execution: {
        status: 'error',
        output: undefined,
        error: error instanceof Error ? error.message : String(error),
        observedNetworkUrls: error instanceof ObservedSkillRuntimeExecutionError ? error.observedNetworkUrls : [],
      },
    })
    throw finalized.contractError || error
  })
  const finalized = finalizeSkillRuntimeRun({
    capability,
    operation,
    cwd: options.cwd,
    inputHash,
    startedAt: start,
    execution: {
      status: 'success',
      output: execution.output,
      observedNetworkUrls: execution.observedNetworkUrls,
    },
  })
  if (finalized.contractError) {
    throw finalized.contractError
  }

  return {
    capability: finalized.capability,
    output: finalized.output,
    text: formatNodeOutput(finalized.output),
    isError: false,
    runRecord: finalized.runRecord,
  }
}

export function finalizeSkillRuntimeRun(options: {
  capability: CapabilityRecord
  operation: ResolvedCapabilityOperation
  cwd?: string
  inputHash: string
  startedAt: number
  execution: SkillRuntimeExecutionObservation
}): FinalizedSkillRuntimeRun {
  const fingerprint = getCapabilityContractFingerprint(options.capability)
  const outputValidation =
    options.execution.status === 'success'
      ? validateJsonAgainstSchema({
          schema: options.operation.outputSchema,
          value: options.execution.output,
          label: 'output',
        })
      : { valid: false, errors: [] }
  const network = validateObservedNetworkUrls({
    capability: options.capability,
    operation: options.operation,
    executionStatus: options.execution.status,
    observedNetworkUrls: options.execution.observedNetworkUrls || [],
  })
  const failures: CapabilityRunContract['failures'] = [
    ...(options.execution.status === 'success' && !outputValidation.valid
      ? outputValidation.errors.map((message) => {
          return { kind: 'output-schema' as const, message }
        })
      : []),
    ...network.undeclaredHosts.map((host) => {
      return {
        kind: 'undeclared-host' as const,
        message: `Network host is not declared by Skill runtime permissions: ${host}`,
      }
    }),
  ]
  const contractStatus: CapabilityRunContract['status'] = (() => {
    if (failures.length > 0) {
      return 'failed'
    }
    if (options.execution.status === 'error') {
      return 'unknown'
    }
    return 'passed'
  })()
  const trustBefore = options.capability.manifest.status
  const nextCapability = options.capability
  const contract: CapabilityRunContract = {
    schemaVersion: 1,
    fingerprint,
    status: contractStatus,
    failures,
    output: {
      status: options.execution.status === 'error' ? 'unknown' : outputValidation.valid ? 'passed' : 'failed',
      errors: outputValidation.errors,
    },
    network: {
      status: network.status,
      observedHosts: network.observedHosts,
      undeclaredHosts: network.undeclaredHosts,
    },
    trust: {
      before: trustBefore,
      after: nextCapability.manifest.status,
      downgraded: trustBefore === 'trusted' && nextCapability.manifest.status === 'draft',
    },
  }
  const contractError = (() => {
    if (contractStatus !== 'failed') {
      return undefined
    }
    return new Error(
      [
        'Skill runtime execution completed but contract conformance failed.',
        ...failures.map((failure) => {
          return failure.message
        }),
        options.operation.id
          ? `Operation ${options.operation.id} is quarantined for the current contract; other operations remain available.`
          : 'This Skill runtime operation is quarantined for the current contract.',
        'Repair its authentication or contract, then rerun this operation with --force to validate the repair.',
        'Do not automatically retry a write operation.',
      ].join('\n'),
    )
  })()
  const runRecord = buildSkillRuntimeRunRecord({
    capability: options.capability,
    operation: options.operation,
    status: options.execution.status === 'error' || contractError ? 'error' : 'success',
    durationMs: Date.now() - options.startedAt,
    inputHash: options.inputHash,
    error: options.execution.error || contractError?.message,
    url: options.execution.url,
    contract,
  })
  appendCapabilityRun({ capability: options.capability, record: runRecord })
  return {
    capability: nextCapability,
    output: options.execution.output,
    runRecord,
    contractError,
  }
}

export function readSkillRuntimeExecutionObservation(value: unknown): {
  output: unknown
  observedNetworkUrls: string[]
  url?: string
  error?: string
} {
  if (!isSkillRuntimeExecutionEnvelope(value)) {
    return { output: value, observedNetworkUrls: [] }
  }
  return {
    output: value.output,
    observedNetworkUrls: value.observedNetworkUrls,
    url: value.url,
    error: value.error,
  }
}

export function normalizeSkillRuntimeExecutionText(options: { text: string; output: unknown; error?: string }): string {
  const markerIndex = options.text.lastIndexOf('[return value]')
  if (markerIndex === -1) {
    return options.error || options.text
  }
  const prefix = options.text.slice(0, markerIndex).trimEnd()
  const resultText: string = (() => {
    if (options.error) {
      return options.error
    }
    if (options.output === undefined) {
      return ''
    }
    const formatted =
      typeof options.output === 'string'
        ? options.output
        : util.inspect(options.output, {
            depth: 4,
            colors: false,
            maxArrayLength: 100,
            maxStringLength: 1000,
            breakLength: 80,
          })
    return formatted.trim() ? `[return value] ${formatted}` : ''
  })()
  return (
    [prefix, resultText]
      .filter((value) => {
        return value.length > 0
      })
      .join('\n')
      .trim() || 'Code executed successfully (no output)'
  )
}

function isSkillRuntimeExecutionEnvelope(value: unknown): value is SkillRuntimeExecutionEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const candidate = value as Partial<SkillRuntimeExecutionEnvelope>
  return (
    candidate.__tabwrightSkillRuntimeEnvelope === 1 &&
    Array.isArray(candidate.observedNetworkUrls) &&
    candidate.observedNetworkUrls.every((url) => {
      return typeof url === 'string'
    }) &&
    (candidate.url === undefined || typeof candidate.url === 'string') &&
    (candidate.error === undefined || typeof candidate.error === 'string')
  )
}

function validateObservedNetworkUrls(options: {
  capability: CapabilityRecord
  operation: ResolvedCapabilityOperation
  executionStatus: 'success' | 'error'
  observedNetworkUrls: string[]
}): {
  status: CapabilityContractCheckStatus
  observedHosts: string[]
  undeclaredHosts: string[]
} {
  const observations = options.observedNetworkUrls.flatMap((rawUrl) => {
    try {
      const url = new URL(rawUrl)
      return [{ url: url.toString(), host: url.origin }]
    } catch {
      return []
    }
  })
  const observedHosts = [...new Set(observations.map((observation) => observation.host))].sort()
  if (observations.length === 0) {
    return {
      status: options.executionStatus === 'error' ? 'unknown' : 'not-applicable',
      observedHosts,
      undeclaredHosts: [],
    }
  }

  const networkPermissions = (options.operation.permissions || options.capability.manifest.permissions).filter(
    (permission) => {
      return permission === 'network' || permission.startsWith('network:')
    },
  )
  if (networkPermissions.includes('network')) {
    return {
      status: options.executionStatus === 'error' ? 'unknown' : 'passed',
      observedHosts,
      undeclaredHosts: [],
    }
  }
  const scopedPermissions = networkPermissions.flatMap((permission) => {
    return permission.startsWith('network:') ? [permission.slice('network:'.length)] : []
  })
  const authNetworkPatterns = options.capability.manifest.auth.browserUrls.flatMap((browserUrl) => {
    try {
      const url = new URL(browserUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return []
      }
      return [`${url.origin}/*`]
    } catch {
      return []
    }
  })
  const allowedNetworkPatterns = [...new Set([...scopedPermissions, ...authNetworkPatterns])]
  if (options.capability.manifest.runtime === 'browser' && scopedPermissions.length === 0) {
    return {
      status: options.executionStatus === 'error' ? 'unknown' : 'not-applicable',
      observedHosts,
      undeclaredHosts: [],
    }
  }

  const undeclaredHosts = [
    ...new Set(
      observations.flatMap((observation) => {
        const declared = allowedNetworkPatterns.some((pattern) => {
          return matchesGlob({ value: observation.url, pattern })
        })
        return declared ? [] : [observation.host]
      }),
    ),
  ].sort()
  return {
    status: undeclaredHosts.length > 0 ? 'failed' : options.executionStatus === 'error' ? 'unknown' : 'passed',
    observedHosts,
    undeclaredHosts,
  }
}

function matchesGlob(options: { value: string; pattern: string }): boolean {
  const escaped = options.pattern
    .split('*')
    .map((part) => {
      return part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    })
    .join('.*')
  return new RegExp(`^${escaped}$`).test(options.value)
}

export function buildSkillRuntimeRunRecord(options: {
  capability: CapabilityRecord
  operation: ResolvedCapabilityOperation
  status: 'success' | 'error'
  durationMs: number
  inputHash: string
  error?: string
  url?: string
  contract?: CapabilityRunContract
}): CapabilityRunRecord {
  return {
    id: options.capability.manifest.id,
    operation: options.operation.id,
    status: options.status,
    durationMs: options.durationMs,
    inputHash: options.inputHash,
    error: options.error,
    url: options.url,
    contract: options.contract,
    createdAt: new Date().toISOString(),
  }
}

export function validateSkillRuntimeUrl(options: { capability: CapabilityRecord; url: string; force?: boolean }): void {
  if (options.force) {
    return
  }
  if (capabilityMatchesUrl({ capability: options.capability.manifest, url: options.url })) {
    return
  }
  throw new Error(`Skill runtime ${options.capability.manifest.id} does not match current page URL: ${options.url}`)
}

function validateSkillRuntimeRunnable(options: {
  capability: CapabilityRecord
  input: unknown
  force?: boolean
  confirmation?: string
}): ResolvedCapabilityOperation {
  const operation = resolveCapabilityOperation({ capability: options.capability, input: options.input })
  const contractHealth = getCapabilityOperationContractHealth({
    capability: options.capability,
    operation: operation.id,
  })
  if (contractHealth.state === 'drifted' && !options.force) {
    throw new Error(
      `Skill runtime ${options.capability.manifest.id}${operation.id ? ` operation ${operation.id}` : ''} is quarantined after contract conformance failed. Repair its authentication or contract, then rerun this operation with --force to validate the repair.${operation.id ? ' Other operations remain available.' : ''}`,
    )
  }
  const validation = validateJsonAgainstSchema({
    schema: operation.inputSchema,
    value: options.input,
    label: 'input',
  })
  if (!validation.valid) {
    throw new Error(`Invalid Skill runtime input:\n${validation.errors.join('\n')}`)
  }
  if (operation.requiresConfirmation && options.confirmation !== operation.confirmationToken) {
    throw new Error(
      `Skill runtime ${options.capability.manifest.id}${operation.id ? ` operation ${operation.id}` : ''} requires explicit user confirmation for its ${operation.sideEffect} side effect. After approval, rerun with --confirm ${operation.confirmationToken}.`,
    )
  }
  return operation
}

async function executeNodeSkillRuntimeScript(options: {
  capability: CapabilityRecord
  operation: ResolvedCapabilityOperation
  input: unknown
  timeout: number
}): Promise<NodeSkillRuntimeExecution> {
  const script = fs.readFileSync(options.capability.scriptPath, 'utf-8')
  const secrets = readCapabilitySecrets({ capability: options.capability })
  const artifacts = createSkillRuntimeArtifacts({ capability: options.capability })
  const observedNetworkUrls: Set<string> = new Set()
  const observedFetch: typeof fetch = async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : input.toString()
    observedNetworkUrls.add(requestUrl)
    const response = await fetch(input, init)
    if (response.url) {
      observedNetworkUrls.add(response.url)
    }
    return response
  }
  const vmContext = vm.createContext({
    input: options.input,
    capability: {
      id: options.capability.manifest.id,
      title: options.capability.manifest.title,
      description: options.capability.manifest.description,
      operation: options.operation.id,
      permissions: options.operation.permissions || options.capability.manifest.permissions,
      runtime: options.capability.manifest.runtime,
    },
    secrets,
    artifacts,
    console,
    fetch: observedFetch,
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    FormData,
    Buffer,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    structuredClone,
    setTimeout,
    clearTimeout,
    crypto,
  })
  const wrappedCode = [
    'const __tabwrightSkillRuntimeOutput = await (async () => {',
    script,
    '\n})();',
    'return __tabwrightSkillRuntimeOutput === undefined ? undefined : JSON.parse(JSON.stringify(__tabwrightSkillRuntimeOutput));',
    `//# sourceURL=tabwright-node-skill-runtime://${options.capability.manifest.id}`,
    '',
  ].join('\n')

  const timeout = createSkillRuntimeTimeout({ timeout: options.timeout })
  try {
    const output = await Promise.race([
      vm.runInContext(`(async () => { ${wrappedCode} })()`, vmContext, {
        timeout: options.timeout,
        displayErrors: true,
      }),
      timeout.promise,
    ])
    return { output, observedNetworkUrls: [...observedNetworkUrls] }
  } catch (error) {
    throw new ObservedSkillRuntimeExecutionError({
      cause: error,
      observedNetworkUrls: [...observedNetworkUrls],
    })
  } finally {
    timeout.cancel()
  }
}

function createSkillRuntimeTimeout(options: { timeout: number }): {
  promise: Promise<never>
  cancel: () => void
} {
  const controller = new AbortController()
  const promise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Skill runtime execution timed out after ${options.timeout}ms`))
    }, options.timeout)
    controller.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
      },
      { once: true },
    )
  })
  return {
    promise,
    cancel: () => {
      controller.abort()
    },
  }
}

function createSkillRuntimeArtifacts(options: { capability: CapabilityRecord }): SkillRuntimeArtifacts {
  ensureCapabilityStateDir(options.capability)
  const root = path.join(options.capability.stateDir, 'artifacts')
  return {
    root,
    path: (pathOptions) => {
      return resolveArtifactPath({ root, filename: pathOptions.filename })
    },
    writeJson: (writeOptions) => {
      return writeArtifactText({
        root,
        filename: writeOptions.filename,
        text: `${JSON.stringify(writeOptions.value, null, 2)}\n`,
      })
    },
    writeText: (writeOptions) => {
      return writeArtifactText({ root, filename: writeOptions.filename, text: writeOptions.text })
    },
  }
}

function writeArtifactText(options: { root: string; filename: string; text: string }): string {
  const filePath = resolveArtifactPath({ root: options.root, filename: options.filename })
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(filePath, options.text, { mode: 0o600 })
  return filePath
}

function resolveArtifactPath(options: { root: string; filename: string }): string {
  const root = path.resolve(options.root)
  if (!options.filename.trim()) {
    throw new Error('Artifact filename must not be empty')
  }
  const filePath = path.resolve(root, options.filename)
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Artifact filename must stay inside artifacts directory: ${options.filename}`)
  }
  return filePath
}

function formatNodeOutput(output: unknown): string {
  return `[return value] ${util.inspect(output, {
    depth: 4,
    colors: false,
    maxArrayLength: 100,
    maxStringLength: 1000,
    breakLength: 80,
  })}`
}

function buildSkillRuntimeCode(options: {
  capability: CapabilityRecord
  operation: ResolvedCapabilityOperation
  script: string
  input: unknown
  force?: boolean
}): string {
  const inputLiteral = JSON.stringify(options.input)
  const capabilityLiteral = JSON.stringify({
    id: options.capability.manifest.id,
    title: options.capability.manifest.title,
    description: options.capability.manifest.description,
    operation: options.operation.id,
    permissions: options.operation.permissions || options.capability.manifest.permissions,
  })
  const matchLiteral = JSON.stringify(options.operation.match)
  return [
    `const input = ${inputLiteral};`,
    `const capability = ${capabilityLiteral};`,
    `const __tabwrightSkillRuntimeMatch = ${matchLiteral};`,
    `const __tabwrightSkillRuntimeForce = ${options.force ? 'true' : 'false'};`,
    'if (!__tabwrightSkillRuntimeForce && __tabwrightSkillRuntimeMatch.length > 0) {',
    '  const __currentUrl = page.url();',
    '  const __matched = __tabwrightSkillRuntimeMatch.some((pattern) => {',
    "    const escaped = pattern.split('*').map((part) => part.replace(/[|\\\\{}()[\\]^$+?.]/g, '\\\\$&')).join('.*');",
    '    return new RegExp(`^${escaped}$`).test(__currentUrl);',
    '  });',
    '  if (!__matched) {',
    '    throw new Error(`Skill runtime ${capability.id} does not match current page URL: ${__currentUrl}`);',
    '  }',
    '}',
    'const __tabwrightSkillRuntimeObservedNetworkUrls = new Set();',
    'const __tabwrightSkillRuntimeOnRequest = (request) => {',
    '  __tabwrightSkillRuntimeObservedNetworkUrls.add(request.url());',
    '};',
    "page.on('request', __tabwrightSkillRuntimeOnRequest);",
    'try {',
    '  const __tabwrightSkillRuntimeOutput = await (async () => {',
    options.script,
    '\n  })();',
    '  return {',
    '    __tabwrightSkillRuntimeEnvelope: 1,',
    '    output: __tabwrightSkillRuntimeOutput === undefined ? undefined : JSON.parse(JSON.stringify(__tabwrightSkillRuntimeOutput)),',
    '    observedNetworkUrls: [...__tabwrightSkillRuntimeObservedNetworkUrls],',
    '    url: page.url(),',
    '  };',
    '} catch (__tabwrightSkillRuntimeError) {',
    '  return {',
    '    __tabwrightSkillRuntimeEnvelope: 1,',
    '    output: undefined,',
    '    observedNetworkUrls: [...__tabwrightSkillRuntimeObservedNetworkUrls],',
    '    url: page.url(),',
    '    error: __tabwrightSkillRuntimeError instanceof Error',
    '      ? (__tabwrightSkillRuntimeError.stack || __tabwrightSkillRuntimeError.message)',
    '      : String(__tabwrightSkillRuntimeError),',
    '  };',
    '} finally {',
    "  page.off('request', __tabwrightSkillRuntimeOnRequest);",
    '}',
    `//# sourceURL=tabwright-skill-runtime://${options.capability.manifest.id}`,
    '',
  ].join('\n')
}

function hashInput(input: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(input) || 'undefined')
    .digest('hex')
}
