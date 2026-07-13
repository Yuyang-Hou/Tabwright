import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import vm from 'node:vm'
import {
  appendCapabilityRun,
  capabilityMatchesUrl,
  getCapabilityContractFingerprint,
  getCapabilityContractHealth,
  readCapabilitySecrets,
  requireCapability,
  resolveCapabilityOperation,
  updateCapabilityManifest,
  validateJsonAgainstSchema,
  type CapabilityContractCheckStatus,
  type CapabilityRecord,
  type CapabilityRunContract,
  type CapabilityRunRecord,
  type ResolvedCapabilityOperation,
} from './capability-registry.js'
import type { ExecuteResult } from './executor.js'

export interface CapabilityExecutor {
  execute(code: string, timeout?: number, options?: { includeStructuredResult?: boolean }): Promise<ExecuteResult>
}

export interface PreparedCapabilityRun {
  capability: CapabilityRecord
  operation: ResolvedCapabilityOperation
  code: string
  input: unknown
  inputHash: string
}

export interface CapabilityRunResult {
  capability: CapabilityRecord
  executeResult: ExecuteResult
  output: unknown
  runRecord: CapabilityRunRecord
}

export interface NodeCapabilityRunResult {
  capability: CapabilityRecord
  output: unknown
  text: string
  isError: boolean
  runRecord: CapabilityRunRecord
}

export interface CapabilityExecutionObservation {
  status: 'success' | 'error'
  output: unknown
  error?: string
  observedNetworkUrls?: string[]
  url?: string
}

export interface FinalizedCapabilityRun {
  capability: CapabilityRecord
  output: unknown
  runRecord: CapabilityRunRecord
  contractError?: Error
}

interface CapabilityExecutionEnvelope {
  __playwriterCapabilityEnvelope: 1
  output: unknown
  observedNetworkUrls: string[]
  url?: string
  error?: string
}

interface NodeCapabilityExecution {
  output: unknown
  observedNetworkUrls: string[]
}

class ObservedCapabilityExecutionError extends Error {
  observedNetworkUrls: string[]

  constructor(options: { cause: unknown; observedNetworkUrls: string[] }) {
    const message = options.cause instanceof Error ? options.cause.message : String(options.cause)
    super(message, { cause: options.cause })
    this.name = 'ObservedCapabilityExecutionError'
    this.observedNetworkUrls = options.observedNetworkUrls
  }
}

interface CapabilityArtifacts {
  root: string
  path(options: { filename: string }): string
  writeJson(options: { filename: string; value: unknown }): string
  writeText(options: { filename: string; text: string }): string
}

export function prepareCapabilityRun(options: {
  id: string
  input: unknown
  cwd?: string
  force?: boolean
  confirmation?: string
}): PreparedCapabilityRun {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  const operation = validateCapabilityRunnable({
    capability,
    input: options.input,
    force: options.force,
    confirmation: options.confirmation,
  })

  const script = fs.readFileSync(capability.scriptPath, 'utf-8')
  return {
    capability,
    operation,
    code: buildCapabilityCode({ capability, operation, script, input: options.input, force: options.force }),
    input: options.input,
    inputHash: hashInput(options.input),
  }
}

export async function runNodeCapability(options: {
  id: string
  input: unknown
  timeout?: number
  cwd?: string
  force?: boolean
  confirmation?: string
}): Promise<NodeCapabilityRunResult> {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  if (capability.manifest.runtime !== 'node') {
    throw new Error(`Capability ${options.id} is runtime "${capability.manifest.runtime}", not "node"`)
  }
  const operation = validateCapabilityRunnable({
    capability,
    input: options.input,
    force: options.force,
    confirmation: options.confirmation,
  })

  const start = Date.now()
  const inputHash = hashInput(options.input)
  const execution = await executeNodeCapabilityScript({
    capability,
    operation,
    input: options.input,
    timeout: options.timeout || 10000,
  }).catch((error: unknown) => {
    const finalized = finalizeCapabilityRun({
      capability,
      operation,
      cwd: options.cwd,
      inputHash,
      startedAt: start,
      execution: {
        status: 'error',
        output: undefined,
        error: error instanceof Error ? error.message : String(error),
        observedNetworkUrls: error instanceof ObservedCapabilityExecutionError ? error.observedNetworkUrls : [],
      },
    })
    throw finalized.contractError || error
  })
  const finalized = finalizeCapabilityRun({
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

export async function runCapabilityWithExecutor(options: {
  executor: CapabilityExecutor
  id: string
  input: unknown
  timeout?: number
  cwd?: string
  force?: boolean
  confirmation?: string
}): Promise<CapabilityRunResult> {
  const prepared = prepareCapabilityRun(options)
  const start = Date.now()
  const executeResult = await options.executor
    .execute(prepared.code, options.timeout || 10000, {
      includeStructuredResult: true,
    })
    .catch((error: unknown) => {
      finalizeCapabilityRun({
        capability: prepared.capability,
        operation: prepared.operation,
        cwd: options.cwd,
        inputHash: prepared.inputHash,
        startedAt: start,
        execution: {
          status: 'error',
          output: undefined,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    })
  const observation = readCapabilityExecutionObservation(executeResult.structuredResult)
  const isExecutionError = executeResult.isError || Boolean(observation.error)
  const normalizedExecuteResult: ExecuteResult = {
    ...executeResult,
    text: normalizeCapabilityExecutionText({
      text: executeResult.text,
      output: observation.output,
      error: observation.error,
    }),
    isError: isExecutionError,
    structuredResult: observation.output,
  }
  const finalized = finalizeCapabilityRun({
    capability: prepared.capability,
    operation: prepared.operation,
    cwd: options.cwd,
    inputHash: prepared.inputHash,
    startedAt: start,
    execution: {
      status: isExecutionError ? 'error' : 'success',
      output: observation.output,
      error: isExecutionError ? observation.error || normalizedExecuteResult.text : undefined,
      observedNetworkUrls: observation.observedNetworkUrls,
      url: observation.url,
    },
  })
  if (finalized.contractError) {
    throw finalized.contractError
  }

  return {
    capability: finalized.capability,
    executeResult: normalizedExecuteResult,
    output: finalized.output,
    runRecord: finalized.runRecord,
  }
}

export function finalizeCapabilityRun(options: {
  capability: CapabilityRecord
  operation: ResolvedCapabilityOperation
  cwd?: string
  inputHash: string
  startedAt: number
  execution: CapabilityExecutionObservation
}): FinalizedCapabilityRun {
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
        message: `Network host is not declared by capability permissions: ${host}`,
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
  const nextCapability = (() => {
    if (contractStatus !== 'failed' || trustBefore !== 'trusted') {
      return options.capability
    }
    return updateCapabilityManifest({
      id: options.capability.manifest.id,
      cwd: options.cwd,
      patch: { status: 'draft' },
    })
  })()
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
        'Capability execution completed but contract conformance failed.',
        ...failures.map((failure) => {
          return failure.message
        }),
        trustBefore === 'trusted'
          ? 'The capability was moved to draft. Do not automatically retry a write operation.'
          : 'The capability remains draft. Do not automatically retry a write operation.',
      ].join('\n'),
    )
  })()
  const runRecord = buildCapabilityRunRecord({
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

export function readCapabilityExecutionObservation(value: unknown): {
  output: unknown
  observedNetworkUrls: string[]
  url?: string
  error?: string
} {
  if (!isCapabilityExecutionEnvelope(value)) {
    return { output: value, observedNetworkUrls: [] }
  }
  return {
    output: value.output,
    observedNetworkUrls: value.observedNetworkUrls,
    url: value.url,
    error: value.error,
  }
}

export function normalizeCapabilityExecutionText(options: { text: string; output: unknown; error?: string }): string {
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

function isCapabilityExecutionEnvelope(value: unknown): value is CapabilityExecutionEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const candidate = value as Partial<CapabilityExecutionEnvelope>
  return (
    candidate.__playwriterCapabilityEnvelope === 1 &&
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
        const declared = scopedPermissions.some((pattern) => {
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

export function buildCapabilityRunRecord(options: {
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

export function validateCapabilityUrl(options: { capability: CapabilityRecord; url: string; force?: boolean }): void {
  if (options.force) {
    return
  }
  if (capabilityMatchesUrl({ capability: options.capability.manifest, url: options.url })) {
    return
  }
  throw new Error(`Capability ${options.capability.manifest.id} does not match current page URL: ${options.url}`)
}

function validateCapabilityRunnable(options: {
  capability: CapabilityRecord
  input: unknown
  force?: boolean
  confirmation?: string
}): ResolvedCapabilityOperation {
  if (options.capability.manifest.status === 'disabled') {
    throw new Error(`Capability is disabled: ${options.capability.manifest.id}`)
  }
  if (getCapabilityContractHealth(options.capability).state === 'drifted' && !options.force) {
    throw new Error(
      `Capability ${options.capability.manifest.id} failed conformance for its current contract. Repair it and run with --force before trusting it again.`,
    )
  }
  if (options.capability.manifest.status !== 'trusted' && !options.force) {
    throw new Error(`Capability is ${options.capability.manifest.status}. Run with --force or trust it first.`)
  }
  const operation = resolveCapabilityOperation({ capability: options.capability, input: options.input })
  const validation = validateJsonAgainstSchema({
    schema: operation.inputSchema,
    value: options.input,
    label: 'input',
  })
  if (!validation.valid) {
    throw new Error(`Invalid capability input:\n${validation.errors.join('\n')}`)
  }
  if (operation.requiresConfirmation && options.confirmation !== operation.confirmationToken) {
    throw new Error(
      `Capability ${options.capability.manifest.id}${operation.id ? ` operation ${operation.id}` : ''} requires explicit user confirmation for its ${operation.sideEffect} side effect. After approval, rerun with --confirm ${operation.confirmationToken}.`,
    )
  }
  return operation
}

async function executeNodeCapabilityScript(options: {
  capability: CapabilityRecord
  operation: ResolvedCapabilityOperation
  input: unknown
  timeout: number
}): Promise<NodeCapabilityExecution> {
  const script = fs.readFileSync(options.capability.scriptPath, 'utf-8')
  const secrets = readCapabilitySecrets({ capability: options.capability })
  const artifacts = createCapabilityArtifacts({ capability: options.capability })
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
    'const __playwriterCapabilityOutput = await (async () => {',
    script,
    '\n})();',
    'return __playwriterCapabilityOutput === undefined ? undefined : JSON.parse(JSON.stringify(__playwriterCapabilityOutput));',
    `//# sourceURL=playwriter-node-capability://${options.capability.manifest.id}`,
    '',
  ].join('\n')

  const timeout = createCapabilityTimeout({ timeout: options.timeout })
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
    throw new ObservedCapabilityExecutionError({
      cause: error,
      observedNetworkUrls: [...observedNetworkUrls],
    })
  } finally {
    timeout.cancel()
  }
}

function createCapabilityTimeout(options: { timeout: number }): {
  promise: Promise<never>
  cancel: () => void
} {
  const controller = new AbortController()
  const promise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Capability execution timed out after ${options.timeout}ms`))
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

function createCapabilityArtifacts(options: { capability: CapabilityRecord }): CapabilityArtifacts {
  const root = path.join(options.capability.dir, 'artifacts')
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, options.text)
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

function buildCapabilityCode(options: {
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
    `const __playwriterCapabilityMatch = ${matchLiteral};`,
    `const __playwriterCapabilityForce = ${options.force ? 'true' : 'false'};`,
    'if (!__playwriterCapabilityForce && __playwriterCapabilityMatch.length > 0) {',
    '  const __currentUrl = page.url();',
    '  const __matched = __playwriterCapabilityMatch.some((pattern) => {',
    "    const escaped = pattern.split('*').map((part) => part.replace(/[|\\\\{}()[\\]^$+?.]/g, '\\\\$&')).join('.*');",
    '    return new RegExp(`^${escaped}$`).test(__currentUrl);',
    '  });',
    '  if (!__matched) {',
    '    throw new Error(`Capability ${capability.id} does not match current page URL: ${__currentUrl}`);',
    '  }',
    '}',
    'const __playwriterCapabilityObservedNetworkUrls = new Set();',
    'const __playwriterCapabilityOnRequest = (request) => {',
    '  __playwriterCapabilityObservedNetworkUrls.add(request.url());',
    '};',
    "page.on('request', __playwriterCapabilityOnRequest);",
    'try {',
    '  const __playwriterCapabilityOutput = await (async () => {',
    options.script,
    '\n  })();',
    '  return {',
    '    __playwriterCapabilityEnvelope: 1,',
    '    output: __playwriterCapabilityOutput === undefined ? undefined : JSON.parse(JSON.stringify(__playwriterCapabilityOutput)),',
    '    observedNetworkUrls: [...__playwriterCapabilityObservedNetworkUrls],',
    '    url: page.url(),',
    '  };',
    '} catch (__playwriterCapabilityError) {',
    '  return {',
    '    __playwriterCapabilityEnvelope: 1,',
    '    output: undefined,',
    '    observedNetworkUrls: [...__playwriterCapabilityObservedNetworkUrls],',
    '    url: page.url(),',
    '    error: __playwriterCapabilityError instanceof Error',
    '      ? (__playwriterCapabilityError.stack || __playwriterCapabilityError.message)',
    '      : String(__playwriterCapabilityError),',
    '  };',
    '} finally {',
    "  page.off('request', __playwriterCapabilityOnRequest);",
    '}',
    `//# sourceURL=playwriter-capability://${options.capability.manifest.id}`,
    '',
  ].join('\n')
}

function hashInput(input: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(input) || 'undefined')
    .digest('hex')
}
