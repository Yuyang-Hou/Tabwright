import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import vm from 'node:vm'
import {
  appendCapabilityRun,
  capabilityMatchesUrl,
  readCapabilitySecrets,
  requireCapability,
  validateJsonAgainstSchema,
  type CapabilityRecord,
  type CapabilityRunRecord,
} from './capability-registry.js'
import type { ExecuteResult } from './executor.js'

export interface CapabilityExecutor {
  execute(
    code: string,
    timeout?: number,
    options?: { includeStructuredResult?: boolean },
  ): Promise<ExecuteResult>
}

export interface PreparedCapabilityRun {
  capability: CapabilityRecord
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
}): PreparedCapabilityRun {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  validateCapabilityRunnable({ capability, input: options.input, force: options.force })

  const script = fs.readFileSync(capability.scriptPath, 'utf-8')
  return {
    capability,
    code: buildCapabilityCode({ capability, script, input: options.input, force: options.force }),
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
}): Promise<NodeCapabilityRunResult> {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  if (capability.manifest.runtime !== 'node') {
    throw new Error(`Capability ${options.id} is runtime "${capability.manifest.runtime}", not "node"`)
  }
  validateCapabilityRunnable({ capability, input: options.input, force: options.force })

  const start = Date.now()
  const inputHash = hashInput(options.input)
  try {
    const output = await executeNodeCapabilityScript({
      capability,
      input: options.input,
      timeout: options.timeout || 10000,
    })
    const outputValidation = validateJsonAgainstSchema({
      schema: capability.manifest.outputSchema,
      value: output,
      label: 'output',
    })
    if (!outputValidation.valid) {
      throw new Error(`Invalid capability output:\n${outputValidation.errors.join('\n')}`)
    }

    const runRecord = buildCapabilityRunRecord({
      capability,
      status: 'success',
      durationMs: Date.now() - start,
      inputHash,
    })
    appendCapabilityRun({ capability, record: runRecord })
    return {
      capability,
      output,
      text: formatNodeOutput(output),
      isError: false,
      runRecord,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const runRecord = buildCapabilityRunRecord({
      capability,
      status: 'error',
      durationMs: Date.now() - start,
      inputHash,
      error: message,
    })
    appendCapabilityRun({ capability, record: runRecord })
    throw error
  }
}

export async function runCapabilityWithExecutor(options: {
  executor: CapabilityExecutor
  id: string
  input: unknown
  timeout?: number
  cwd?: string
  force?: boolean
}): Promise<CapabilityRunResult> {
  const prepared = prepareCapabilityRun(options)
  const start = Date.now()
  const executeResult = await options.executor.execute(prepared.code, options.timeout || 10000, {
    includeStructuredResult: true,
  })
  const output = executeResult.structuredResult
  if (!executeResult.isError) {
    const outputValidation = validateJsonAgainstSchema({
      schema: prepared.capability.manifest.outputSchema,
      value: output,
      label: 'output',
    })
    if (!outputValidation.valid) {
      throw new Error(`Invalid capability output:\n${outputValidation.errors.join('\n')}`)
    }
  }

  const runRecord: CapabilityRunRecord = {
    id: prepared.capability.manifest.id,
    status: executeResult.isError ? 'error' : 'success',
    durationMs: Date.now() - start,
    inputHash: prepared.inputHash,
    error: executeResult.isError ? executeResult.text : undefined,
    createdAt: new Date().toISOString(),
  }
  appendCapabilityRun({ capability: prepared.capability, record: runRecord })
  return {
    capability: prepared.capability,
    executeResult,
    output,
    runRecord,
  }
}

export function buildCapabilityRunRecord(options: {
  capability: CapabilityRecord
  status: 'success' | 'error'
  durationMs: number
  inputHash: string
  error?: string
  url?: string
}): CapabilityRunRecord {
  return {
    id: options.capability.manifest.id,
    status: options.status,
    durationMs: options.durationMs,
    inputHash: options.inputHash,
    error: options.error,
    url: options.url,
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

function validateCapabilityRunnable(options: { capability: CapabilityRecord; input: unknown; force?: boolean }): void {
  if (options.capability.manifest.status === 'disabled') {
    throw new Error(`Capability is disabled: ${options.capability.manifest.id}`)
  }
  if (options.capability.manifest.status !== 'trusted' && !options.force) {
    throw new Error(`Capability is ${options.capability.manifest.status}. Run with --force or trust it first.`)
  }

  const validation = validateJsonAgainstSchema({
    schema: options.capability.manifest.inputSchema,
    value: options.input,
    label: 'input',
  })
  if (!validation.valid) {
    throw new Error(`Invalid capability input:\n${validation.errors.join('\n')}`)
  }
}

async function executeNodeCapabilityScript(options: {
  capability: CapabilityRecord
  input: unknown
  timeout: number
}): Promise<unknown> {
  const script = fs.readFileSync(options.capability.scriptPath, 'utf-8')
  const secrets = readCapabilitySecrets({ capability: options.capability })
  const artifacts = createCapabilityArtifacts({ capability: options.capability })
  const vmContext = vm.createContext({
    input: options.input,
    capability: {
      id: options.capability.manifest.id,
      title: options.capability.manifest.title,
      description: options.capability.manifest.description,
      permissions: options.capability.manifest.permissions,
      runtime: options.capability.manifest.runtime,
    },
    secrets,
    artifacts,
    console,
    fetch,
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

  return await Promise.race([
    vm.runInContext(`(async () => { ${wrappedCode} })()`, vmContext, {
      timeout: options.timeout,
      displayErrors: true,
    }),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Capability execution timed out after ${options.timeout}ms`))
      }, options.timeout)
    }),
  ])
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

function buildCapabilityCode(options: { capability: CapabilityRecord; script: string; input: unknown; force?: boolean }): string {
  const inputLiteral = JSON.stringify(options.input)
  const capabilityLiteral = JSON.stringify({
    id: options.capability.manifest.id,
    title: options.capability.manifest.title,
    description: options.capability.manifest.description,
    permissions: options.capability.manifest.permissions,
  })
  const matchLiteral = JSON.stringify(options.capability.manifest.match)
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
    'const __playwriterCapabilityOutput = await (async () => {',
    options.script,
    '\n})();',
    'return __playwriterCapabilityOutput === undefined ? undefined : JSON.parse(JSON.stringify(__playwriterCapabilityOutput));',
    `//# sourceURL=playwriter-capability://${options.capability.manifest.id}`,
    '',
  ].join('\n')
}

function hashInput(input: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(input) || 'undefined').digest('hex')
}
