#!/usr/bin/env node

import './env-compat.js'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import { goke, openInBrowser } from 'goke'
import { z } from 'zod'
import pc from 'picocolors'

// Prevent Buffers from dumping hex bytes in util.inspect output.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}
import { killPortProcess } from './kill-port.js'
import { canEmitKittyGraphics, emitKittyImage } from './kitty-graphics.js'
import { VERSION, LOG_FILE_PATH, LOG_CDP_FILE_PATH, parseRelayHost } from './utils.js'
import {
  ensureRelayServer,
  RELAY_PORT,
  waitForConnectedExtensions,
  getExtensionOutdatedWarning,
  getExtensionStatus,
  getExtensionsStatus,
  getLocalRelayHttpBaseUrl,
  getRelayServerFeatures,
  getRelayServerVersion,
  selectImplicitExtension,
  type ExtensionStatus,
} from './relay-client.js'
import { discoverChromeInstances, resolveDirectInput, type DiscoveredInstance } from './chrome-discovery.js'
import { getCloudClient, loadCloudAuth, saveCloudAuth, CloudClient, buildLiveUrl } from './cloud-client.js'
import {
  createCapability,
  getCapabilitySafetySummary,
  listCapabilities,
  readCapabilityScript,
  routeCapabilities,
  searchCapabilities,
  toCapabilityContract,
  toCapabilitySummary,
  updateCapabilityManifest,
  updateCapabilityScript,
  type CapabilityManifestPatch,
  type CapabilityRecord,
} from './capability-registry.js'
import { initCapabilityAgentSkill, installCapabilityAgentSkill, showCapabilityAgentSkill } from './capability-agent-skill.js'
import {
  getTabwrightAgentSkillStatus,
  installTabwrightAgentSkill,
  type TabwrightAgentSkillTarget,
} from './tabwright-agent-skill.js'
import { installCapabilityPackage, packCapability } from './capability-package.js'
import { refreshCapabilityAuthWithExecutor } from './capability-auth.js'
import {
  finalizeCapabilityRun,
  normalizeCapabilityExecutionText,
  prepareCapabilityRun,
  readCapabilityExecutionObservation,
  runNodeCapability,
} from './capability-runner.js'
import { createReplayAiIndexFromRecording, saveReplayAiIndex } from './replay-ai-index.js'
import { listSavedRrwebRecordings } from './rrweb-recording-relay.js'
import {
  compileReplayWorkflow,
  UnsupportedReplayWorkflowError,
  type ReplayWorkflowAnalysis,
} from './replay-workflow-compiler.js'
import {
  buildReplayCreateCommand,
  buildReplayIndexCommand,
  buildReplayMakeCommand,
  buildReplayRunCommand,
  replayCapabilityId,
  toCompactReplayAiIndex,
} from './replay-handoff.js'
import { formatReplayEvalReport, runReplayEval } from './replay-eval.js'
import type { ExecuteResult } from './executor.js'
import { buildDoctorReport, formatDoctorReport, type DoctorSession } from './doctor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const cli = goke('tabwright')

cli.on('command:*', () => {
  const firstArg = cli.args[0]
  if (!firstArg) {
    return
  }

  const hasMatchingCommandPrefix = cli.commands.some((command) => {
    if (command.name === '') {
      return false
    }
    return command.name.split(' ')[0] === firstArg
  })

  if (hasMatchingCommandPrefix) {
    return
  }

  console.error('Run "tabwright --help" for usage information.')
})

cli
  .command('browser start [binaryPath]', 'Start Chromium or Chrome for Testing with the bundled Tabwright extension')
  .hidden()
  .option('--user-data-dir <dir>', 'Persistent browser profile directory used for the managed browser')
  .option('--headless', 'Run the browser in headless mode')
  .option('--headed', 'Force headed mode even on Linux without DISPLAY/WAYLAND_DISPLAY')
  .option('--disable-sandbox', 'Disable the browser sandbox, useful on some VPS setups')
  .action(async (binaryPath, options) => {
      if (options.headless && options.headed) {
        console.error('Error: --headless and --headed cannot be used together.')
        process.exit(1)
      }

      try {
        // Avoid loading playwright-core during generic CLI startup/help. This command
        // is the only path that needs browser discovery and bundled extension launch.
        const [{ getBrowserLaunchArgs, getDefaultBrowserUserDataDir, startBrowserProcess }, { resolveBrowserExecutablePath, shouldUseHeadlessByDefault }, { getBundledExtensionPath }] = await Promise.all([
          import('./browser-launch.js'),
          import('./browser-config.js'),
          import('./package-paths.js'),
        ])

        await ensureRelayServer({ logger: console })

        const browserPath = resolveBrowserExecutablePath({ browserPath: binaryPath })
        const extensionPath = getBundledExtensionPath()
        const userDataDir = path.resolve(options.userDataDir || getDefaultBrowserUserDataDir())
        const headless = options.headed ? false : options.headless ? true : shouldUseHeadlessByDefault()
        const args = getBrowserLaunchArgs({
          extensionPath,
          userDataDir,
          headless,
          noSandbox: options.disableSandbox,
        })

        const { pid } = startBrowserProcess({
          browserPath,
          args,
          userDataDir,
        })

        const connectedExtensions = await waitForConnectedExtensions({
          timeoutMs: 15000,
          pollIntervalMs: 250,
          logger: console,
        })

        console.log(`Browser started (pid ${pid}).`)
        console.log(`  Binary: ${browserPath}`)
        console.log(`  Extension: ${extensionPath}`)
        console.log(`  Profile: ${userDataDir}`)
        console.log(`  Mode: ${headless ? 'headless' : 'headed'}`)
        console.log('  Replay recording: rrweb DOM capture enabled')

        if (connectedExtensions.length > 0) {
          console.log('Tabwright extension connected to the relay server.')
          return
        }

        console.log('Browser started, but the extension has not connected yet.')
        console.log(`Check logs at: ${LOG_FILE_PATH}`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

cli
  .command('browser install', 'Download Chrome for Testing for headless browser automation')
  .action(async () => {
    try {
      const { installChrome } = await import('./browser-install.js')
      await installChrome()
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('', 'Start the MCP server or controls the browser with -e')
  .hidden()
  .option('--host <host>', 'Remote relay server host to connect to (or use TABWRIGHT_HOST env var)')
  .option('--token <token>', 'Authentication token (or use TABWRIGHT_TOKEN env var)')
  .option('-s, --session <name>', 'Session ID (required for -e, get one with `tabwright session new`)')
  .option('-e, --eval <code>', 'Execute JavaScript code and exit, read https://playwriter.dev/SKILL.md for usage')
  .option('-f, --file <path>', 'Execute JavaScript from a file and exit')
  .option('--patchright', 'Use @playwriter/patchright-core for stealth mode (bypasses bot detection)')
  .option('--timeout [ms]', z.number().default(10000).describe('Execution timeout in milliseconds'))
  .action(async (options) => {
    if (options.patchright) {
      process.env.TABWRIGHT_PATCHRIGHT = '1'
    }

    if (options.eval && options.file) {
      console.error('Error: -e and -f cannot be used together.')
      process.exit(1)
    }

    // If -e or -f flag is provided, execute code via relay server
    const code = (() => {
      if (options.eval) {
        return options.eval
      }
      if (options.file) {
        const filePath = path.resolve(options.file)
        if (!fs.existsSync(filePath)) {
          console.error(`Error: File not found: ${filePath}`)
          process.exit(1)
        }
        return fs.readFileSync(filePath, 'utf-8')
      }
      return null
    })()

    if (code) {
      await executeCode({
        code,
        timeout: options.timeout || 10000,
        sessionId: options.session,
        host: options.host,
        token: options.token,
      })
      return
    }

    // Otherwise start the MCP server
    // For direct CDP in MCP mode, use TABWRIGHT_DIRECT env var
    const { startMcp } = await import('./mcp.js')
    await startMcp({
      host: options.host,
      token: options.token,
    })
  })

async function getServerUrl(host?: string): Promise<string> {
  if (!host && !process.env.TABWRIGHT_HOST) {
    return await getLocalRelayHttpBaseUrl(RELAY_PORT)
  }
  const serverHost = host || process.env.TABWRIGHT_HOST || '127.0.0.1'
  const { httpBaseUrl } = parseRelayHost(serverHost, RELAY_PORT)
  return httpBaseUrl
}

// Centralized header builder so every CLI subcommand sends the token consistently.
// Falls back to TABWRIGHT_TOKEN env var when --token is not provided.
function buildAuthHeaders({ token, json }: { token?: string; json?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {}
  if (json) {
    headers['Content-Type'] = 'application/json'
  }
  const effectiveToken = token || process.env.TABWRIGHT_TOKEN
  if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`
  }
  return headers
}

async function fetchExtensionsStatus({ host, token }: { host?: string; token?: string } = {}): Promise<ExtensionStatus[]> {
  try {
    const serverUrl = await getServerUrl(host)
    const headers = buildAuthHeaders({ token })
    const response = await fetch(`${serverUrl}/extensions/status`, {
      signal: AbortSignal.timeout(2000),
      headers,
    })
    if (!response.ok) {
      const fallback = await fetch(`${serverUrl}/extension/status`, {
        signal: AbortSignal.timeout(2000),
        headers,
      })
      if (!fallback.ok) {
        return []
      }
      const fallbackData = (await fallback.json()) as {
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
          browser: fallbackData?.browser,
          profile: fallbackData?.profile,
          activeTargets: fallbackData?.activeTargets,
          playwriterVersion: fallbackData?.playwriterVersion || null,
          protocolVersion: fallbackData?.protocolVersion,
          features: fallbackData?.features,
          connectionHealth: fallbackData?.connectionHealth,
          missingFeatures: fallbackData?.missingFeatures,
        },
      ]
    }
    const data = (await response.json()) as {
      extensions: ExtensionStatus[]
    }
    return data?.extensions || []
  } catch {
    return []
  }
}

async function executeCode(options: {
  code: string
  timeout: number
  sessionId?: string
  host?: string
  token?: string
}): Promise<void> {
  const { code, timeout, host, token } = options
  const cwd = process.cwd()
  const sessionId = options.sessionId ? String(options.sessionId) : process.env.TABWRIGHT_SESSION

  // Session is required
  if (!sessionId) {
    console.error('Error: -s/--session is required.')
    console.error('Always run `tabwright session new` first to get a session ID to use.')
    process.exit(1)
  }

  // Ensure relay server is running (only for local)
  if (!host && !process.env.TABWRIGHT_HOST) {
    const restarted = await ensureRelayServer({ logger: console })
    if (restarted) {
      const connectedExtensions = await waitForConnectedExtensions({
        logger: console,
        timeoutMs: 10000,
        pollIntervalMs: 250,
      })
      if (connectedExtensions.length === 0) {
        console.error('Warning: Extension not connected. Commands may fail.')
      }
    }
  }

  const serverUrl = await getServerUrl(host)

  // Warn once if extension is outdated
  const extensionStatus = await getExtensionStatus()
  const outdatedWarning = getExtensionOutdatedWarning(extensionStatus?.playwriterVersion)
  if (outdatedWarning) {
    console.error(outdatedWarning)
  }

  // Build request URL with token if provided
  const executeUrl = `${serverUrl}/cli/execute`

  try {
    const response = await fetch(executeUrl, {
      method: 'POST',
      headers: buildAuthHeaders({ token, json: true }),
      body: JSON.stringify({ sessionId, code, timeout, cwd }),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`Error: ${response.status} ${text}`)
      process.exit(1)
    }

    const result = (await response.json()) as {
      text: string
      images: Array<{ data: string; mimeType: string }>
      screenshots: Array<{ path: string; base64: string; snapshot: string; labelCount: number }>
      isError: boolean
      isCloud?: boolean
    }

    // Print output
    if (result.text) {
      if (result.isError) {
        console.error(result.text)
      } else {
        console.log(result.text)
      }
    }

    // Emit images via Kitty Graphics Protocol when AGENT_GRAPHICS=kitty.
    // Agents with kitty-graphics-agent intercept these escape sequences and pass
    // the PNG images to the LLM as media parts — no extra tool call needed.
    const kittyEnabled = canEmitKittyGraphics()

    // Track emitted base64 to avoid duplicates (screenshots appear in both
    // result.screenshots and result.images from the same screenshotCollector)
    const emittedImages = new Set<string>()

    if (result.screenshots && result.screenshots.length > 0) {
      for (const s of result.screenshots) {
        if (kittyEnabled && s.base64) {
          emitKittyImage({ base64: s.base64 })
          emittedImages.add(s.base64)
        }
        console.log(`\nScreenshot saved to: ${s.path}`)
        console.log(`Labels shown: ${s.labelCount}\n`)
        console.log(`Accessibility snapshot:\n${s.snapshot}`)
      }
    }

    // Emit resized images from resizeImageForAgent() calls that aren't
    // already emitted as part of labeled screenshots
    if (kittyEnabled && result.images && result.images.length > 0) {
      for (const img of result.images) {
        if (img.data && !emittedImages.has(img.data)) {
          emitKittyImage({ base64: img.data })
          emittedImages.add(img.data)
        }
      }
    }

    if (result.isCloud) {
      console.error(pc.dim(`\nCloud session. Run \`tabwright session delete ${sessionId}\` when done.`))
    }

    if (result.isError) {
      process.exit(1)
    }
  } catch (error: any) {
    if (error.cause?.code === 'ECONNREFUSED') {
      console.error('Error: Cannot connect to relay server.')
      console.error('The Tabwright relay server should start automatically. Check logs at:')
      console.error(`  ${LOG_FILE_PATH}`)
    } else {
      console.error(`Error: ${error.message}`)
    }
    process.exit(1)
  }
}

type CliExecuteResult = ExecuteResult & { isCloud?: boolean }

interface CapabilityRunOptions {
  input?: string
  inputJson?: string
  session?: string
  host?: string
  token?: string
  timeout?: number
  force?: boolean
  confirm?: string
  browser?: string
  json?: boolean
  keepSession?: boolean
}

interface CapabilityRefreshAuthOptions {
  session?: string
  host?: string
  token?: string
  timeout?: number
  browser?: string
  json?: boolean
  keepSession?: boolean
}

interface CapabilityInstallOptions {
  project?: boolean
  force?: boolean
  withAgentSkill?: boolean
  json?: boolean
}

interface CapabilityPackOptions {
  output?: string
  force?: boolean
  json?: boolean
}

function parseCapabilityInput(options: { input?: string; inputJson?: string }): unknown {
  const rawInput = options.inputJson || options.input || '{}'
  try {
    return JSON.parse(rawInput)
  } catch (error) {
    throw new Error(`Invalid JSON input: ${rawInput}`, { cause: error })
  }
}

async function requestCliExecute(options: {
  code: string
  timeout: number
  sessionId: string
  host?: string
  token?: string
  includeStructuredResult?: boolean
}): Promise<CliExecuteResult> {
  if (!options.host && !process.env.TABWRIGHT_HOST) {
    await ensureRelayServer({ logger: console })
  }
  const serverUrl = await getServerUrl(options.host)

  const response = await fetch(`${serverUrl}/cli/execute`, {
    method: 'POST',
    headers: buildAuthHeaders({ token: options.token, json: true }),
    body: JSON.stringify({
      sessionId: options.sessionId,
      code: options.code,
      timeout: options.timeout,
      cwd: process.cwd(),
      includeStructuredResult: options.includeStructuredResult,
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Execute failed: ${response.status} ${text}`)
  }
  return (await response.json()) as CliExecuteResult
}

async function createCapabilityRunSession(options: {
  browser: string
  host?: string
  token?: string
}): Promise<{ sessionId: string; autoCreated: boolean }> {
  const isLocal = !options.host && !process.env.TABWRIGHT_HOST
  await ensureRelayForSessionCreation(isLocal)
  const serverUrl = await getServerUrl(options.host)

  const body = (() => {
    if (options.browser === 'headless') {
      return { headless: true, cwd: process.cwd() }
    }
    if (options.browser === 'user') {
      return { cwd: process.cwd() }
    }
    return { extensionId: options.browser, cwd: process.cwd() }
  })()

  const response = await fetch(`${serverUrl}/cli/session/new`, {
    method: 'POST',
    headers: buildAuthHeaders({ token: options.token, json: true }),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to create ${options.browser} session: ${response.status} ${text}`)
  }
  const result = (await response.json()) as { id: string }
  return { sessionId: result.id, autoCreated: true }
}

async function deleteCapabilityRunSession(options: { sessionId: string; host?: string; token?: string }): Promise<void> {
  const serverUrl = await getServerUrl(options.host)
  await fetch(`${serverUrl}/cli/session/delete`, {
    method: 'POST',
    headers: buildAuthHeaders({ token: options.token, json: true }),
    body: JSON.stringify({ sessionId: options.sessionId }),
  }).catch(() => {})
}

function printCapabilityList(options: { capabilities: CapabilityRecord[]; json?: boolean }): void {
  if (options.json) {
    console.log(JSON.stringify(options.capabilities.map(toCapabilitySummary), null, 2))
    return
  }
  if (options.capabilities.length === 0) {
    console.log('No capabilities found.')
    return
  }
  const idWidth = Math.max(2, ...options.capabilities.map((capability) => capability.manifest.id.length))
  const statusWidth = Math.max(6, ...options.capabilities.map((capability) => capability.manifest.status.length))
  console.log(`${'ID'.padEnd(idWidth)}  ${'Status'.padEnd(statusWidth)}  Runtime  Location  Title`)
  console.log(`${'-'.repeat(idWidth)}  ${'-'.repeat(statusWidth)}  -------  --------  -----`)
  options.capabilities.forEach((capability) => {
    console.log(
      `${capability.manifest.id.padEnd(idWidth)}  ${capability.manifest.status.padEnd(statusWidth)}  ${capability.manifest.runtime.padEnd(7)}  ${capability.location.padEnd(8)}  ${capability.manifest.title}`,
    )
  })
}

function printCapabilitySearch(options: {
  query: string
  results: ReturnType<typeof searchCapabilities>
  json?: boolean
}): void {
  if (options.json) {
    console.log(
      JSON.stringify(
        options.results.map((result) => {
          return {
            score: result.score,
            reasons: result.reasons,
            ...toCapabilityContract(result.capability),
          }
        }),
        null,
        2,
      ),
    )
    return
  }
  if (options.results.length === 0) {
    console.log(`No capabilities matched: ${options.query}`)
    return
  }
  const lines = options.results.map((result) => {
    const safety = getCapabilitySafetySummary(result.capability)
    const autonomy = safety.sideEffect === 'mixed' ? 'mixed' : safety.requiresConfirmation ? 'confirm' : safety.sideEffect
    return `${result.capability.manifest.id}  score=${result.score}  ${result.capability.manifest.runtime}/${autonomy}  ${result.capability.manifest.title}`
  })
  console.log(lines.join('\n'))
}

function printCapabilityRoutes(options: {
  task: string
  routes: ReturnType<typeof routeCapabilities>
  json?: boolean
}): void {
  const routeSummaries = options.routes.map((route) => {
    return {
      shellCommand: route.shellCommand,
      command: route.command,
      capabilityId: route.capability.manifest.id,
      operation: route.operation,
      id: route.capability.manifest.id,
      title: route.capability.manifest.title,
      location: route.capability.location,
      routingHint:
        route.operation === undefined
          ? route.capability.manifest.routingHint
          : route.capability.manifest.operations[route.operation]?.routingHint,
      input: route.input,
      commandWarning: route.commandWarning,
      executionHint: route.executionHint,
      reasons: route.reasons,
      matchedText: route.matchedText,
    }
  })
  if (options.json) {
    console.log(JSON.stringify(routeSummaries, null, 2))
    return
  }
  if (routeSummaries.length === 0) {
    console.log(`No exact direct-run capability matched: ${options.task}`)
    console.log(`Next: tabwright capability search ${quoteShell(options.task)}`)
    return
  }
  console.log(
    routeSummaries
      .map((route) => {
        return `run: ${route.shellCommand}\ncapabilityId: ${route.capabilityId}\nwarning: ${route.commandWarning}`
      })
      .join('\n'),
  )
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function readCapabilityManifestPatchFromFile(filePath: string): CapabilityManifestPatch {
  const parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf-8'))
  if (!isRecord(parsed)) {
    throw new Error('Capability contract file must contain a JSON object')
  }
  return parsed as CapabilityManifestPatch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function refreshCapabilityAuthFromCli(id: string, options: CapabilityRefreshAuthOptions): Promise<void> {
  const session = options.session || process.env.TABWRIGHT_SESSION
  const sessionInfo = session
    ? { sessionId: session, autoCreated: false }
    : await createCapabilityRunSession({
        browser: options.browser || 'user',
        host: options.host,
        token: options.token,
      })

  try {
    const result = await refreshCapabilityAuthWithExecutor({
      id,
      cwd: process.cwd(),
      timeout: options.timeout || 10000,
      executor: {
        execute: (code, timeout, executeOptions) => {
          return requestCliExecute({
            code,
            timeout: timeout || 10000,
            sessionId: sessionInfo.sessionId,
            host: options.host,
            token: options.token,
            includeStructuredResult: executeOptions?.includeStructuredResult,
          })
        },
      },
    })
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            capability: result.capability.manifest.id,
            saved: result.saved,
            secretKey: result.secretKey,
            cookieCount: result.cookieCount,
            cookieNames: result.cookieNames,
            urls: result.urls,
            expiresAt: result.expiresAt,
            path: result.path,
          },
          null,
          2,
        ),
      )
      return
    }
    console.log(`Refreshed ${result.capability.manifest.id} auth at ${result.path}`)
    console.log(`Saved ${result.cookieCount} cookies into secret "${result.secretKey}".`)
    if (result.expiresAt) {
      console.log(`Expires at ${result.expiresAt}.`)
    }
  } finally {
    if (sessionInfo.autoCreated && !options.keepSession) {
      await deleteCapabilityRunSession({
        sessionId: sessionInfo.sessionId,
        host: options.host,
        token: options.token,
      })
    }
  }
}

async function runCapabilityFromCli(id: string, options: CapabilityRunOptions): Promise<void> {
  const input = parseCapabilityInput({ input: options.input, inputJson: options.inputJson })
  const prepared = prepareCapabilityRun({
    id,
    input,
    cwd: process.cwd(),
    force: options.force,
    confirmation: options.confirm,
  })
  if (prepared.capability.manifest.runtime === 'node') {
    const result = await runNodeCapability({
      id,
      input,
      cwd: process.cwd(),
      force: options.force,
      confirmation: options.confirm,
      timeout: options.timeout || 10000,
    })
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            capability: result.capability.manifest.id,
            output: result.output,
            text: result.text,
            isError: result.isError,
          },
          null,
          2,
        ),
      )
      return
    }
    console.log(JSON.stringify(result.output, null, 2))
    return
  }

  const session = options.session || process.env.TABWRIGHT_SESSION
  const sessionInfo = session
    ? { sessionId: session, autoCreated: false }
    : await createCapabilityRunSession({
        browser: options.browser || 'headless',
        host: options.host,
        token: options.token,
      })

  const start = Date.now()
  try {
    const result = await requestCliExecute({
      code: prepared.code,
      timeout: options.timeout || 10000,
      sessionId: sessionInfo.sessionId,
      host: options.host,
      token: options.token,
      includeStructuredResult: true,
    }).catch((error: unknown) => {
      finalizeCapabilityRun({
        capability: prepared.capability,
        operation: prepared.operation,
        cwd: process.cwd(),
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
    const observation = readCapabilityExecutionObservation(result.structuredResult)
    const isExecutionError = result.isError || Boolean(observation.error)
    const normalizedText = normalizeCapabilityExecutionText({
      text: result.text,
      output: observation.output,
      error: observation.error,
    })
    const finalized = finalizeCapabilityRun({
      capability: prepared.capability,
      operation: prepared.operation,
      cwd: process.cwd(),
      inputHash: prepared.inputHash,
      startedAt: start,
      execution: {
        status: isExecutionError ? 'error' : 'success',
        output: observation.output,
        error: isExecutionError ? observation.error || normalizedText : undefined,
        observedNetworkUrls: observation.observedNetworkUrls,
        url: observation.url,
      },
    })
    if (finalized.contractError) {
      throw finalized.contractError
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            capability: prepared.capability.manifest.id,
            output: observation.output,
            text: normalizedText,
            isError: isExecutionError,
          },
          null,
          2,
        ),
      )
    } else {
      console.log(JSON.stringify(observation.output, null, 2))
      if (isExecutionError) {
        console.error(normalizedText)
      }
    }

    if (isExecutionError) {
      process.exit(1)
    }
  } finally {
    if (sessionInfo.autoCreated && !options.keepSession) {
      await deleteCapabilityRunSession({
        sessionId: sessionInfo.sessionId,
        host: options.host,
        token: options.token,
      })
    }
  }
}

// Session management commands
// Unified browser option type used in the multi-browser selection table
interface BrowserOption {
  key: string
  type: 'extension' | 'direct' | 'cloud' | 'headless'
  browser: string
  profile: string
  /** For extension entries */
  extensionId?: string | null
  /** For direct CDP entries */
  wsUrl?: string
  /** Raw profile data from discovery (for passing to relay) */
  profiles?: Array<{ name: string; email: string }>
  /** For cloud entries — active BU session's cloud session ID (if VM is running) */
  activeCloudSessionId?: string
}

function exitWithError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Error: ${message}`)
  process.exit(1)
}

function buildNestedExampleInput(pathValue: string): Record<string, unknown> {
  const parts = pathValue.split('.').filter((part) => {
    return part.length > 0
  })
  if (parts.length === 0) {
    return { value: '...' }
  }
  return parts.reduceRight<Record<string, unknown> | string>((current, part) => {
    if (typeof current === 'string') {
      return { [part]: current }
    }
    return { [part]: current }
  }, '...') as Record<string, unknown>
}

function toReplayCompilerSummary(analysis: ReplayWorkflowAnalysis): ReplayWorkflowAnalysis & { supported: boolean } {
  return {
    supported: analysis.actionKind !== 'unknown',
    ...analysis,
  }
}

function buildReplayNeedsAiHandoff(options: {
  replayId: string
  capabilityId: string
  goal?: string
  analysis: ReplayWorkflowAnalysis
}) {
  const index = createReplayAiIndexFromRecording(options.replayId)
  return {
    status: 'needs_ai' as const,
    replay: {
      id: options.replayId,
      url: index.url,
    },
    capabilityWritten: false,
    compiler: toReplayCompilerSummary(options.analysis),
    evidence: toCompactReplayAiIndex(index),
    next: {
      action: 'author_capability' as const,
      inspectCommand: buildReplayIndexCommand({ replayId: options.replayId, full: true }),
      createCommand: buildReplayCreateCommand({
        capabilityId: options.capabilityId,
        title: `Workflow from replay ${options.replayId}`,
        description: options.goal,
      }),
    },
  }
}

function printReplayNeedsAiHandoff(options: {
  handoff: ReturnType<typeof buildReplayNeedsAiHandoff>
  json?: boolean
}): void {
  if (options.json) {
    console.log(JSON.stringify(options.handoff, null, 2))
    return
  }
  console.log(`Replay ${options.handoff.replay.id} needs AI authoring.`)
  console.log('No capability was written.')
  options.handoff.compiler.reasons.forEach((reason) => {
    console.log(`- ${reason}`)
  })
  console.log(`Inspect full evidence: ${options.handoff.next.inspectCommand}`)
  console.log(`Create a browser scaffold: ${options.handoff.next.createCommand}`)
}

cli
  .command('replay list', 'List saved rrweb replays and the next commands for each recording')
  .option('--limit <n>', z.number().default(10).describe('Maximum number of recordings'))
  .option('--json', 'Print JSON')
  .action((options: { limit?: number; json?: boolean }) => {
    try {
      const recordings = listSavedRrwebRecordings({ limit: options.limit || 10 }).map((recording) => {
        return {
          id: recording.id,
          url: recording.url,
          savedAt: recording.savedAt,
          durationMs: recording.duration,
          eventCount: recording.eventCount,
          commands: {
            inspect: buildReplayIndexCommand({ replayId: recording.id }),
            make: buildReplayMakeCommand({
              replayId: recording.id,
              capabilityId: replayCapabilityId(recording.id),
            }),
          },
        }
      })
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              recordings,
              next:
                recordings.length > 0
                  ? recordings[0]?.commands
                  : { action: 'record', command: 'Use replay.start() and replay.stop() in a Tabwright session.' },
            },
            null,
            2,
          ),
        )
        return
      }
      if (recordings.length === 0) {
        console.log('No saved replays. Use replay.start() and replay.stop() in a Tabwright session first.')
        return
      }
      recordings.forEach((recording) => {
        console.log(`${recording.id}  ${recording.url || '-'}  ${recording.eventCount} events`)
        console.log(`  Inspect: ${recording.commands.inspect}`)
        console.log(`  Make: ${recording.commands.make}`)
      })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('replay index <replayId>', 'Build an AI-readable index from an rrweb replay')
  .option('--write', 'Save the index under ~/.tabwright/replay-ai-indexes')
  .option('--full', 'Include page text and the full interactive-element inventory')
  .option('--json', 'Print JSON')
  .action((replayId: string, options: { write?: boolean; full?: boolean; json?: boolean }) => {
    try {
      const index = createReplayAiIndexFromRecording(replayId)
      const saved = options.write ? saveReplayAiIndex(index) : undefined
      if (options.json) {
        const outputIndex = options.full ? index : toCompactReplayAiIndex(index)
        console.log(JSON.stringify(saved ? { index: outputIndex, saved } : { index: outputIndex }, null, 2))
        return
      }
      console.log(`Replay: ${index.replayId}`)
      console.log(`URL: ${index.url || '-'}`)
      console.log(`Actions: ${index.actions.length}`)
      console.log(`Fields: ${index.fields.length}`)
      console.log(`Annotations: ${index.annotations.length}`)
      console.log(`Stats: ${JSON.stringify(index.stats)}`)
      if (saved) {
        console.log(`Saved: ${saved.path}`)
      }
      index.annotations.slice(0, 8).forEach((annotation, index) => {
        const target = annotation.target?.label || annotation.target?.selectorHints[0] || annotation.target?.tagName || 'target'
        console.log(`${index + 1}. ${pc.magenta('annotation')} ${target}: ${annotation.text}`)
      })
      index.actions.slice(0, 12).forEach((action, index) => {
        const value = action.value === undefined ? '' : ` = ${JSON.stringify(action.value)}`
        console.log(`${index + 1}. ${pc.cyan(action.kind)} ${action.label}${value}`)
      })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('replay compile <replayId> <capabilityId>', 'Compile an rrweb replay into a draft workflow capability')
  .option('--title <title>', 'Capability title')
  .option('--description <description>', 'Capability description')
  .option('--goal <goal>', 'User goal to store as capability description')
  .option('--value-input-path <path>', 'Input path for the appended value (default: value)')
  .option('--force', 'Overwrite an existing capability')
  .option('--json', 'Print JSON')
  .action(
    (
      replayId: string,
      capabilityId: string,
      options: {
        title?: string
        description?: string
        goal?: string
        valueInputPath?: string
        force?: boolean
        json?: boolean
      },
    ) => {
      try {
        const valueInputPath = options.valueInputPath || 'value'
        const compiled = compileReplayWorkflow({
          replayId,
          id: capabilityId,
          cwd: process.cwd(),
          title: options.title,
          description: options.description || options.goal,
          valueInputPath,
          overwrite: options.force,
        })
        const runCommand = buildReplayRunCommand({
          capabilityId,
          input: buildNestedExampleInput(valueInputPath),
        })
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                status: 'compiled',
                replay: {
                  id: replayId,
                  url: compiled.analysis.url,
                },
                compiler: toReplayCompilerSummary(compiled.analysis),
                capability: compiled.saved.capability,
                next: {
                  requiresUserConfirmation: true,
                  runCommand,
                },
              },
              null,
              2,
            ),
          )
          return
        }
        console.log(`Compiled ${replayId} into ${capabilityId}`)
        console.log(`Action: ${compiled.analysis.actionKind}`)
        console.log(`Confidence: ${compiled.analysis.confidence}`)
        console.log(`Observed value: ${compiled.analysis.demonstratedValue || '-'}`)
        console.log('Requires explicit user confirmation before running.')
        console.log(`After approval: ${runCommand}`)
      } catch (error) {
        if (error instanceof UnsupportedReplayWorkflowError) {
          printReplayNeedsAiHandoff({
            handoff: buildReplayNeedsAiHandoff({
              replayId,
              capabilityId,
              goal: options.description || options.goal,
              analysis: error.analysis,
            }),
            json: options.json,
          })
          return
        }
        exitWithError(error)
      }
    },
  )

cli
  .command('replay make <replayId> <capabilityId>', 'Index and compile a replay into a runnable draft capability')
  .option('--title <title>', 'Capability title')
  .option('--description <description>', 'Capability description')
  .option('--goal <goal>', 'User goal to store as capability description')
  .option('--value-input-path <path>', 'Input path for the appended value (default: value)')
  .option('--write-index', 'Save the generated replay index under ~/.tabwright/replay-ai-indexes')
  .option('--force', 'Overwrite an existing capability')
  .option('--json', 'Print JSON')
  .action(
    (
      replayId: string,
      capabilityId: string,
      options: {
        title?: string
        description?: string
        goal?: string
        valueInputPath?: string
        writeIndex?: boolean
        force?: boolean
        json?: boolean
      },
    ) => {
      try {
        const valueInputPath = options.valueInputPath || 'value'
        const index = createReplayAiIndexFromRecording(replayId)
        const savedIndex = options.writeIndex ? saveReplayAiIndex(index) : undefined
        const compiled = compileReplayWorkflow({
          replayId,
          id: capabilityId,
          cwd: process.cwd(),
          title: options.title,
          description: options.description || options.goal,
          valueInputPath,
          overwrite: options.force,
        })
        const runCommand = buildReplayRunCommand({
          capabilityId,
          input: buildNestedExampleInput(valueInputPath),
        })
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                status: 'compiled',
                replay: {
                  id: replayId,
                  url: index.url,
                },
                savedIndex,
                compiler: toReplayCompilerSummary(compiled.analysis),
                evidence: toCompactReplayAiIndex(index),
                capability: compiled.saved.capability,
                next: {
                  requiresUserConfirmation: true,
                  runCommand,
                },
              },
              null,
              2,
            ),
          )
          return
        }
        console.log(`Replay: ${index.replayId}`)
        console.log(`URL: ${index.url || '-'}`)
        console.log(`Actions: ${index.actions.length}`)
        console.log(`Fields: ${index.fields.length}`)
        console.log(`Annotations: ${index.annotations.length}`)
        if (savedIndex) {
          console.log(`Saved index: ${savedIndex.path}`)
        }
        console.log(`Compiled capability: ${capabilityId}`)
        console.log(`Action: ${compiled.analysis.actionKind}`)
        console.log(`Confidence: ${compiled.analysis.confidence}`)
        console.log(`Observed value: ${compiled.analysis.demonstratedValue || '-'}`)
        console.log('Requires explicit user confirmation before running.')
        console.log(`After approval: ${runCommand}`)
      } catch (error) {
        if (error instanceof UnsupportedReplayWorkflowError) {
          printReplayNeedsAiHandoff({
            handoff: buildReplayNeedsAiHandoff({
              replayId,
              capabilityId,
              goal: options.description || options.goal,
              analysis: error.analysis,
            }),
            json: options.json,
          })
          return
        }
        exitWithError(error)
      }
    },
  )

cli
  .command('replay eval', 'Run replay-to-capability evaluation cases against local example pages')
  .option('--case <id>', 'Run one evaluation case')
  .option('--json', 'Print JSON')
  .option('--report <path>', 'Write an HTML report')
  .option('--keep-artifacts', 'Keep generated temporary recordings and capabilities')
  .option('--headed', 'Run the evaluation browser in headed mode')
  .action(
    async (options: { case?: string; json?: boolean; report?: string; keepArtifacts?: boolean; headed?: boolean }) => {
      try {
        const report = await runReplayEval({
          caseId: options.case,
          reportPath: options.report,
          keepArtifacts: options.keepArtifacts,
          headed: options.headed,
        })
        if (options.json) {
          console.log(JSON.stringify(report, null, 2))
          return
        }
        console.log(formatReplayEvalReport(report))
        if (options.report) {
          console.log(`Report: ${path.resolve(options.report)}`)
        }
        if (report.failed > 0) {
          process.exitCode = 1
        }
      } catch (error) {
        exitWithError(error)
      }
    },
  )

cli
  .command('capability list', 'List saved Tabwright capabilities')
  .option('--json', 'Print JSON')
  .action((options: { json?: boolean }) => {
    try {
      printCapabilityList({ capabilities: listCapabilities({ cwd: process.cwd() }), json: options.json })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability route <task>', 'Find an exact-match direct-run capability for a concrete task or URL')
  .option('--limit <n>', z.number().default(3).describe('Maximum number of routes'))
  .option('--json', 'Print JSON')
  .action((task: string, options: { limit?: number; json?: boolean }) => {
    try {
      printCapabilityRoutes({
        task,
        routes: routeCapabilities({ task, cwd: process.cwd(), limit: options.limit || 3 }),
        json: options.json,
      })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability search <query>', 'Search saved Tabwright capabilities by user intent')
  .option('--limit <n>', z.number().default(10).describe('Maximum number of results'))
  .option('--json', 'Print JSON')
  .action((query: string, options: { limit?: number; json?: boolean }) => {
    try {
      printCapabilitySearch({
        query,
        results: searchCapabilities({ query, cwd: process.cwd(), limit: options.limit || 10 }),
        json: options.json,
      })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability describe <id>', 'Print the AI-readable contract for a capability')
  .option('--json', 'Print JSON')
  .action((id: string, options: { json?: boolean }) => {
    try {
      const capability = listCapabilities({ cwd: process.cwd() }).find((candidate) => {
        return candidate.manifest.id === id
      })
      if (!capability) {
        throw new Error(`Capability not found: ${id}`)
      }
      const contract = toCapabilityContract(capability)
      if (options.json) {
        console.log(JSON.stringify(contract, null, 2))
        return
      }
      console.log(JSON.stringify(contract, null, 2))
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability show <id>', 'Show a saved Tabwright capability')
  .option('--json', 'Print JSON')
  .option('--script', 'Print the script source')
  .action((id: string, options: { json?: boolean; script?: boolean }) => {
    try {
      const capability = listCapabilities({ cwd: process.cwd() }).find((candidate) => {
        return candidate.manifest.id === id
      })
      if (!capability) {
        throw new Error(`Capability not found: ${id}`)
      }
      if (options.script) {
        console.log(readCapabilityScript({ id, cwd: process.cwd() }))
        return
      }
      if (options.json) {
        console.log(JSON.stringify(toCapabilitySummary(capability), null, 2))
        return
      }
      console.log(`${capability.manifest.title} (${capability.manifest.id})`)
      console.log(`Status: ${capability.manifest.status}`)
      console.log(`Runtime: ${capability.manifest.runtime}`)
      console.log(`Location: ${capability.location}`)
      console.log(`Directory: ${capability.dir}`)
      if (capability.manifest.description) {
        console.log(`Description: ${capability.manifest.description}`)
      }
      console.log(`Match: ${capability.manifest.match.length > 0 ? capability.manifest.match.join(', ') : '-'}`)
      console.log(`Permissions: ${capability.manifest.permissions.join(', ') || '-'}`)
      console.log(`Entry: ${capability.manifest.entry}`)
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability create <id>', 'Create a draft Tabwright capability')
  .option('--title <title>', 'Capability title')
  .option('--description <description>', 'Capability description')
  .option('--project', 'Create under .tabwright/capabilities in the current project')
  .option('--runtime <browser|node>', 'Capability runtime (default: browser)')
  .option('--force', 'Overwrite an existing capability')
  .option('--json', 'Print JSON')
  .action(
    (
      id: string,
      options: { title?: string; description?: string; project?: boolean; runtime?: string; force?: boolean; json?: boolean },
    ) => {
      try {
        if (options.runtime && options.runtime !== 'browser' && options.runtime !== 'node') {
          throw new Error(`Invalid runtime: ${options.runtime}`)
        }
        const runtime = options.runtime === 'browser' || options.runtime === 'node' ? options.runtime : undefined
        const capability = createCapability({
          id,
          title: options.title,
          description: options.description,
          location: options.project ? 'project' : 'user',
          cwd: process.cwd(),
          overwrite: options.force,
          createdBy: 'ai',
          runtime,
        })
        if (options.json) {
          console.log(JSON.stringify(toCapabilitySummary(capability), null, 2))
          return
        }
        console.log(`Created ${capability.manifest.id} at ${capability.dir}`)
      } catch (error) {
        exitWithError(error)
      }
    },
  )

cli
  .command('capability skill init <id>', 'Create an editable agent skill scaffold for a saved capability')
  .option('--force', 'Overwrite an existing agent skill draft')
  .option('--json', 'Print JSON')
  .action((id: string, options: { force?: boolean; json?: boolean }) => {
    try {
      const result = initCapabilityAgentSkill({
        id,
        cwd: process.cwd(),
        overwrite: options.force,
      })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`Created agent skill draft for ${result.capabilityId}: ${result.dir}`)
      result.files.forEach((file) => {
        console.log(`- ${file.status}: ${file.path}`)
      })
      console.log('')
      console.log('Next:')
      result.next.forEach((step) => {
        console.log(`  ${step}`)
      })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability skill install <id>', 'Install an edited capability agent skill into Codex')
  .option('--force', 'Overwrite an existing installed agent skill')
  .option('--codex-home <dir>', 'Codex home directory (defaults to CODEX_HOME or ~/.codex)')
  .option('--json', 'Print JSON')
  .action((id: string, options: { force?: boolean; codexHome?: string; json?: boolean }) => {
    try {
      const result = installCapabilityAgentSkill({
        id,
        cwd: process.cwd(),
        overwrite: options.force,
        codexHome: options.codexHome,
      })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`Installed agent skill for ${result.capabilityId}: ${result.dir}`)
      result.files.forEach((file) => {
        console.log(`- ${file.status}: ${file.path}`)
      })
      console.log('')
      console.log('Next:')
      result.next.forEach((step) => {
        console.log(`  ${step}`)
      })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability skill show <id>', 'Show the editable agent skill draft for a saved capability')
  .option('--json', 'Print JSON')
  .action((id: string, options: { json?: boolean }) => {
    try {
      const result = showCapabilityAgentSkill({
        id,
        cwd: process.cwd(),
      })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      const skill = result.files.find((file) => {
        return file.relativePath === 'SKILL.md'
      })
      if (!skill) {
        throw new Error(`Agent skill draft missing SKILL.md for ${id}`)
      }
      console.log(skill.content)
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability pack <id>', 'Pack a capability for safe sharing')
  .option('-o, --output <path>', 'Output .tgz path (default: <id>.tgz)')
  .option('--force', 'Overwrite an existing package')
  .option('--json', 'Print JSON')
  .action(async (id: string, options: CapabilityPackOptions) => {
    try {
      const packed = await packCapability({
        id,
        cwd: process.cwd(),
        output: options.output,
        overwrite: options.force,
      })
      if (options.json) {
        console.log(JSON.stringify(packed, null, 2))
        return
      }
      console.log(`Packed ${packed.capabilityId}: ${packed.path}`)
      console.log(`Integrity: ${packed.integrity}`)
      console.log('Included files:')
      packed.files.map((file) => {
        console.log(`- ${file}`)
        return file
      })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability install <source>', 'Install a capability directory, Git source, local .tgz, or .tgz URL')
  .option('--project', 'Install under .tabwright/capabilities in the current project')
  .option('--force', 'Overwrite existing installed capabilities')
  .option('--with-agent-skill', 'Install a shared package agent skill after reviewing the source')
  .option('--json', 'Print JSON')
  .action(async (source: string, options: CapabilityInstallOptions) => {
    try {
      const installed = await installCapabilityPackage({
        source,
        cwd: process.cwd(),
        location: options.project ? 'project' : 'user',
        overwrite: options.force,
      })
      const agentSkill =
        installed.agentSkillAvailable && options.withAgentSkill
          ? installCapabilityAgentSkill({
              id: installed.capability.manifest.id,
              cwd: process.cwd(),
              overwrite: options.force,
              capability: installed.capability,
            })
          : null
      const next = [
        `tabwright capability describe ${installed.capability.manifest.id} --json`,
        ...(installed.agentSkillAvailable && !agentSkill
          ? [`Review the packaged agent skill, then install it with: tabwright capability skill install ${installed.capability.manifest.id}`]
          : []),
        ...(installed.capability.manifest.auth.refresh === 'from-browser'
          ? [`tabwright capability refresh-auth ${installed.capability.manifest.id} --browser user --json`]
          : []),
        `Validate with capability run --force before trusting ${installed.capability.manifest.id}.`,
      ]
      const summary = {
        type: 'package',
        source: installed.source,
        capability: toCapabilitySummary(installed.capability),
        files: installed.files,
        integrity: installed.integrity,
        agentSkill,
        next,
      }
      if (options.json) {
        console.log(JSON.stringify(summary, null, 2))
        return
      }
      console.log(`Installed ${installed.capability.manifest.id} as draft: ${installed.capability.dir}`)
      console.log(`Integrity: ${installed.integrity}`)
      if (agentSkill) {
        console.log(`Installed agent skill: ${agentSkill.dir}`)
      }
      console.log('')
      console.log('Next:')
      next.map((step) => {
        console.log(`  ${step}`)
        return step
      })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability update <id>', 'Update a capability script from a file')
  .option('--from-file <path>', 'Path to the new script.js source')
  .option('--contract-file <path>', 'Path to a JSON manifest contract patch')
  .option('--title <title>', 'Update title')
  .option('--description <description>', 'Update description')
  .option('--json', 'Print JSON')
  .action(
    (
      id: string,
      options: { fromFile?: string; contractFile?: string; title?: string; description?: string; json?: boolean },
    ) => {
      try {
        let capability: CapabilityRecord | null = null
        if (options.fromFile) {
          const sourcePath = path.resolve(options.fromFile)
          capability = updateCapabilityScript({ id, cwd: process.cwd(), source: fs.readFileSync(sourcePath, 'utf-8') })
        }
        if (options.contractFile) {
          const patch = readCapabilityManifestPatchFromFile(options.contractFile)
          const currentCapability =
            capability ||
            listCapabilities({ cwd: process.cwd() }).find((candidate) => {
              return candidate.manifest.id === id
            }) ||
            null
          if (currentCapability?.manifest.status === 'trusted' && !patch.status) {
            patch.status = 'draft'
          }
          capability = updateCapabilityManifest({ id, cwd: process.cwd(), patch })
        }
        if (options.title || options.description) {
          const patch: CapabilityManifestPatch = {}
          if (options.title) {
            patch.title = options.title
          }
          if (options.description) {
            patch.description = options.description
          }
          capability = updateCapabilityManifest({
            id,
            cwd: process.cwd(),
            patch,
          })
        }
        if (!capability) {
          throw new Error('Nothing to update. Pass --from-file, --contract-file, --title, or --description.')
        }
        if (options.json) {
          console.log(JSON.stringify(toCapabilitySummary(capability), null, 2))
          return
        }
        console.log(`Updated ${capability.manifest.id}. Status: ${capability.manifest.status}`)
      } catch (error) {
        exitWithError(error)
      }
    },
  )

cli
  .command('capability trust <id>', 'Mark a capability trusted')
  .action((id: string) => {
    try {
      const capability = updateCapabilityManifest({ id, cwd: process.cwd(), patch: { status: 'trusted' } })
      console.log(`Trusted ${capability.manifest.id}`)
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability draft <id>', 'Mark a capability draft')
  .action((id: string) => {
    try {
      const capability = updateCapabilityManifest({ id, cwd: process.cwd(), patch: { status: 'draft' } })
      console.log(`Marked ${capability.manifest.id} as draft`)
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability disable <id>', 'Disable a capability')
  .action((id: string) => {
    try {
      const capability = updateCapabilityManifest({ id, cwd: process.cwd(), patch: { status: 'disabled' } })
      console.log(`Disabled ${capability.manifest.id}`)
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability refresh-auth <id>', 'Refresh a capability auth secret from the current browser session')
  .option('-s, --session <id>', 'Existing Tabwright session id')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use TABWRIGHT_TOKEN env var)')
  .option('--browser <headless|user|key>', 'Runtime when --session is omitted (default: user)')
  .option('--keep-session', 'Keep auto-created session alive after refresh')
  .option('--json', 'Print JSON envelope')
  .option('--timeout [ms]', z.number().default(10000).describe('Execution timeout in milliseconds'))
  .action(async (id: string, options: CapabilityRefreshAuthOptions) => {
    try {
      await refreshCapabilityAuthFromCli(id, options)
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('capability run <id>', 'Run a Tabwright capability')
  .option('--input <json>', 'JSON input object')
  .option('--input-json <json>', 'JSON input object')
  .option('-s, --session <id>', 'Existing Tabwright session id')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use TABWRIGHT_TOKEN env var)')
  .option('--browser <headless|user|key>', 'Runtime when --session is omitted (default: headless)')
  .option('--force', 'Run draft capabilities or bypass URL match checks')
  .option('--confirm <capability-id>', 'Repeat the capability id after explicit user approval of its side effect')
  .option('--keep-session', 'Keep auto-created session alive after run')
  .option('--json', 'Print JSON envelope')
  .option('--timeout [ms]', z.number().default(10000).describe('Execution timeout in milliseconds'))
  .action(async (id: string, options: CapabilityRunOptions) => {
    try {
      await runCapabilityFromCli(id, options)
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('studio', 'Start the local Tabwright capability studio')
  .option('--host <host>', z.string().default('127.0.0.1').describe('Host to bind to'))
  .option('--port <port>', z.number().default(19989).describe('Port to bind to'))
  .option('--open', 'Open the studio URL in the default browser')
  .action(async (options: { host?: string; port?: number; open?: boolean }) => {
    try {
      const { startCapabilityStudio } = await import('./capability-studio.js')
      const server = await startCapabilityStudio({
        host: options.host || '127.0.0.1',
        port: options.port || 19989,
        cwd: process.cwd(),
      })
      const url = `http://${server.host}:${server.port}`
      console.log(`Tabwright capability studio: ${url}`)
      console.log('Press Ctrl+C to stop.')
      if (options.open) {
        await openInBrowser(url)
      }
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('session new', 'Create a new session and print the session ID')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use TABWRIGHT_TOKEN env var)')
  .option('--browser <key>', 'Browser key when multiple browsers are available. Special values: "headless" (launch headless Chrome, no extension), "cloud" (cloud browser with stealth/proxies)')
  .option('--patchright', 'Use @playwriter/patchright-core for stealth mode (bypasses bot detection)')
  .option('--direct [endpoint]', 'Use direct CDP connection without the extension. Enable debugging first at chrome://inspect/#remote-debugging or launch Chrome with --remote-debugging-port=9222. Auto-discovers instances or accepts an explicit ws:// endpoint')
  .option('--proxy <region>', 'Enable residential proxy for cloud browser (e.g. us, de, jp). Disabled by default. Use for anti-detection or geo-targeting.')
  .option('--custom-proxy <url>', 'Custom proxy for cloud browser (host:port or user:pass@host:port)')
  .option('--timeout <minutes>', 'Cloud browser timeout in minutes (1-240, default 60)')
  .option('--disable-proxy-bandwidth-acceleration', 'Allow loading images, video, and fonts when proxy is enabled (they are blocked by default to save proxy bandwidth)')
  .action(async (options) => {
    if (options.patchright) {
      process.env.TABWRIGHT_PATCHRIGHT = '1'
    }

    const isLocal = !options.host && !process.env.TABWRIGHT_HOST

    // --browser headless: launch headless Chrome via chromium.launch(), no extension
    if (options.browser === 'headless') {
      try {
        await ensureRelayForSessionCreation(isLocal)
        const serverUrl = await getServerUrl(options.host)
        const response = await fetch(`${serverUrl}/cli/session/new`, {
          method: 'POST',
          headers: buildAuthHeaders({ token: options.token, json: true }),
          body: JSON.stringify({ headless: true, cwd: process.cwd() }),
        })
        if (!response.ok) {
          const text = await response.text()
          if (text.includes('Could not find a supported browser binary')) {
            console.error('No Chrome browser found. Install one first:')
            console.error('')
            console.error('  tabwright browser install')
            console.error('')
            console.error('This downloads Chrome for Testing from Google.')
            process.exit(1)
          }
          console.error(`Error: ${response.status} ${text}`)
          process.exit(1)
        }
        const result = (await response.json()) as { id: string }
        console.log(`Session ${result.id} created (headless). Use with: tabwright -s ${result.id} -e "..."`)
        console.log(pc.dim('NOTE: Recording unavailable in headless mode.'))
      } catch (error: any) {
        if (error.message?.includes('Could not find a supported browser binary')) {
          console.error('No Chrome browser found. Install one first:')
          console.error('')
          console.error('  tabwright browser install')
          console.error('')
          console.error('This downloads Chrome for Testing from Google.')
          process.exit(1)
        }
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      return
    }
    // goke 6.6: optional-value flags are string | undefined
    //   `--direct ws://...` → 'ws://...' (explicit endpoint)
    //   `--direct`          → ''          (bare flag, auto-discover)
    //   (omitted)           → undefined   (don't use direct CDP)
    const directEndpoint = options.direct || null

    // If --direct with explicit endpoint, resolve it (handles host:port → ws://) then skip discovery
    if (directEndpoint) {
      let cdpEndpoint: string
      try {
        cdpEndpoint = await resolveDirectInput(directEndpoint)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      await ensureRelayForSessionCreation(isLocal)
      const serverUrl = await getServerUrl(options.host)
      const result = await createDirectSession({ serverUrl, cdpEndpoint, token: options.token })
      console.log(`Session ${result.id} created (direct CDP). Use with: tabwright -s ${result.id} -e "..."`)
      console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
      return
    }

    // If --direct with no endpoint, discover Chrome instances
    if (options.direct === '') {
      if (!isLocal) {
        console.error('Error: --direct auto-discovery only works locally.')
        console.error('For remote relay, pass an explicit endpoint reachable from the relay host:')
        console.error('  tabwright session new --host <host> --direct ws://relay-host:9222/devtools/browser/...')
        process.exit(1)
      }
      await ensureRelayForSessionCreation(isLocal)
      console.log(pc.dim('Discovering Chrome instances with debugging enabled...'))
      const instances = await discoverChromeInstances()

      if (instances.length === 0) {
        console.error('No Chrome instances with debugging enabled found.')
        console.error('')
        console.error('Enable debugging in one of these ways:')
        console.error('  1. Open chrome://inspect/#remote-debugging in Chrome')
        console.error('  2. Launch Chrome with: chrome --remote-debugging-port=9222')
        process.exit(1)
      }

      if (instances.length === 1 && !options.browser) {
        const instance = instances[0]
        const serverUrl = await getServerUrl(options.host)
        const result = await createDirectSession({ serverUrl, cdpEndpoint: instance.wsUrl, browser: instance.browser, profiles: instance.profiles, token: options.token })
        const profileLabel = formatInstanceProfiles(instance)
        console.log(
          `Session ${result.id} created (direct CDP, ${instance.browser}${profileLabel}). Use with: tabwright -s ${result.id} -e "..."`,
        )
        console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
        return
      }

      // Multiple instances or --browser specified
      const directOptions = instances.map((instance) => {
        return instanceToBrowserOption(instance)
      })

      if (options.browser) {
        const selected = directOptions.find((opt) => {
          return opt.key === options.browser
        })
        if (!selected) {
          await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: false })
          console.error(`Browser not found: ${options.browser}`)
          console.error('Available: ' + directOptions.map((opt) => opt.key).join(', '))
          process.exit(1)
        }
        const serverUrl = await getServerUrl(options.host)
        const result = await createDirectSession({ serverUrl, cdpEndpoint: selected.wsUrl!, browser: selected.browser, profiles: selected.profiles, token: options.token })
        console.log(`Session ${result.id} created (direct CDP). Use with: tabwright -s ${result.id} -e "..."`)
        console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
        return
      }

      printBrowserTable(directOptions)
      console.log('\nRun again with --browser <key>.')
      process.exit(1)
    }

    // Default mode: extension-based (existing behavior)
    let extensions: ExtensionStatus[] = []

    if (isLocal) {
      await ensureRelayServer({ logger: console })
      extensions = await waitForConnectedExtensions({
        timeoutMs: 12000,
        pollIntervalMs: 250,
        settleMs: 750,
        logger: console,
      })

      if (extensions.length === 0) {
        console.log(pc.dim('Waiting briefly for extension to reconnect...'))
        extensions = await waitForConnectedExtensions({
          timeoutMs: 10000,
          pollIntervalMs: 250,
          settleMs: 750,
          logger: console,
        })
      }
    } else {
      extensions = await fetchExtensionsStatus({ host: options.host, token: options.token })
    }

    if (extensions.length === 0) {
      // Before giving up, check if cloud browsers are available
      const cloudOptions = await discoverCloudBrowsers()
      if (cloudOptions.length > 0) {
        // Cloud-only user: skip extension requirement, show cloud options
        await ensureRelayForSessionCreation(isLocal)
        const allOptions: BrowserOption[] = [...cloudOptions]

        if (options.browser) {
          const selected = allOptions.find((opt) => { return opt.key === options.browser })
          if (!selected) {
            await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: true })
            console.error(`Browser not found: ${options.browser}`)
            console.error('Available: ' + allOptions.map((opt) => opt.key).join(', '))
            process.exit(1)
          }
          const serverUrl = await getServerUrl(options.host)
          // Reuse existing running VM if selected, otherwise create new
          const result = selected.activeCloudSessionId
            ? await attachExistingCloudSession({
              serverUrl,
              cloudSessionId: selected.activeCloudSessionId,
              blockProxyResources: computeBlockProxyResources(options),
              token: options.token,
            })
            : await createCloudSession({
              serverUrl,
              proxyRegion: options.proxy,
              customProxy: options.customProxy,
              timeout: parseCloudTimeout(options.timeout),
              blockProxyResources: computeBlockProxyResources(options),
              token: options.token,
            })
          console.log(`Session ${result.id} created (cloud). Use with: tabwright -s ${result.id} -e "..."`)
          if (result.liveUrl) {
            console.log(pc.dim(`Live view: ${result.liveUrl}`))
          }
          return
        }

        console.log('\nNo local browsers detected, but cloud browsers are available:\n')
        printBrowserTable(allOptions)
        console.log('\nRun again with --browser <key>.')
        process.exit(1)
      }

      if (options.browser) {
        await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: false })
      }
      console.error('No connected browsers detected. Click the Tabwright extension icon.')
      console.error(pc.dim('Tip: Use --direct to connect via Chrome DevTools Protocol instead.'))
      console.error(pc.dim('Tip: Run `tabwright cloud login` to use cloud browsers.'))
      process.exit(1)
    }

    // Warn if any connected extension was built with an older tabwright version
    for (const ext of extensions) {
      const warning = getExtensionOutdatedWarning(ext.playwriterVersion)
      if (warning) {
        console.error(warning)
        break
      }
    }

    // Auto-select only when the extension choice is unambiguous. With multiple
    // profiles, a single extension with enabled tabs is the user's active choice.
    const implicitExtension = options.browser ? null : selectImplicitExtension(extensions)
    if (implicitExtension) {
      const selectedExtension = implicitExtension
      try {
        const serverUrl = await getServerUrl(options.host)
        const extensionId =
          selectedExtension.extensionId === 'default'
            ? null
            : selectedExtension.stableKey || selectedExtension.extensionId
        const cwd = process.cwd()
        const response = await fetch(`${serverUrl}/cli/session/new`, {
          method: 'POST',
          headers: buildAuthHeaders({ token: options.token, json: true }),
          body: JSON.stringify({ extensionId, cwd }),
        })
        if (!response.ok) {
          const text = await response.text()
          console.error(`Error: ${response.status} ${text}`)
          process.exit(1)
        }
        const result = (await response.json()) as { id: string; extensionId: string | null }
        console.log(`Session ${result.id} created. Use with: tabwright -s ${result.id} -e "..."`)
        printCloudTip()
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      return
    }

    // Multiple extensions: also discover direct CDP instances and cloud browsers.
    // Direct discovery only works locally — remote relay can't reach local Chrome debug ports.
    const directInstances = isLocal ? await (async () => {
      console.log(pc.dim('Discovering additional Chrome instances...'))
      return await discoverChromeInstances()
    })() : []

    // Fetch cloud browser slots if user is logged in
    const cloudOptions = await discoverCloudBrowsers()

    const allOptions: BrowserOption[] = [
      ...extensions.map((ext) => {
        return {
          key: ext.stableKey || ext.extensionId,
          type: 'extension' as const,
          browser: ext.browser || 'Chrome',
          profile: ext.profile?.email || '(not signed in)',
          extensionId: ext.extensionId === 'default' ? null : ext.stableKey || ext.extensionId,
        }
      }),
      ...directInstances.map((instance) => {
        return instanceToBrowserOption(instance)
      }),
      ...cloudOptions,
    ]

    if (options.browser) {
      const selected = allOptions.find((opt) => {
        return opt.key === options.browser
      })
      if (!selected) {
        await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: cloudOptions.length > 0 })
        console.error(`Browser not found: ${options.browser}`)
        console.error('Available: ' + allOptions.map((opt) => opt.key).join(', '))
        process.exit(1)
      }

      try {
        const serverUrl = await getServerUrl(options.host)
        if (selected.type === 'cloud') {
          // Reuse existing running VM if selected, otherwise create new
          const result = selected.activeCloudSessionId
            ? await attachExistingCloudSession({
              serverUrl,
              cloudSessionId: selected.activeCloudSessionId,
              blockProxyResources: computeBlockProxyResources(options),
              token: options.token,
            })
            : await createCloudSession({
              serverUrl,
              proxyRegion: options.proxy,
              customProxy: options.customProxy,
              timeout: parseCloudTimeout(options.timeout),
              blockProxyResources: computeBlockProxyResources(options),
              token: options.token,
            })
          console.log(`Session ${result.id} created (cloud). Use with: tabwright -s ${result.id} -e "..."`)
          if (result.liveUrl) {
            console.log(pc.dim(`Live view: ${result.liveUrl}`))
          }
        } else if (selected.type === 'direct') {
          const result = await createDirectSession({ serverUrl, cdpEndpoint: selected.wsUrl!, browser: selected.browser, profiles: selected.profiles, token: options.token })
          console.log(`Session ${result.id} created (direct CDP). Use with: tabwright -s ${result.id} -e "..."`)
          console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
        } else {
          const cwd = process.cwd()
          const response = await fetch(`${serverUrl}/cli/session/new`, {
            method: 'POST',
            headers: buildAuthHeaders({ token: options.token, json: true }),
            body: JSON.stringify({ extensionId: selected.extensionId, cwd }),
          })
          if (!response.ok) {
            const text = await response.text()
            console.error(`Error: ${response.status} ${text}`)
            process.exit(1)
          }
          const result = (await response.json()) as { id: string }
          console.log(`Session ${result.id} created. Use with: tabwright -s ${result.id} -e "..."`)
          printCloudTip()
        }
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      return
    }

    // Show unified table
    console.log('\nMultiple browsers detected:\n')
    printBrowserTable(allOptions)
    console.log('\nRun again with --browser <key>.')
    process.exit(1)
  })

async function ensureRelayForSessionCreation(isLocal: boolean): Promise<void> {
  if (isLocal) {
    await ensureRelayServer({ logger: console })
  }
}

async function createDirectSession({
  serverUrl,
  cdpEndpoint,
  browser,
  profiles,
  token,
}: {
  serverUrl: string
  cdpEndpoint: string
  browser?: string
  profiles?: Array<{ name: string; email: string }>
  token?: string
}): Promise<{ id: string }> {
  const cwd = process.cwd()
  const response = await fetch(`${serverUrl}/cli/session/new`, {
    method: 'POST',
    headers: buildAuthHeaders({ token, json: true }),
    body: JSON.stringify({ cdpEndpoint, cwd, browser, profiles }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }
  return (await response.json()) as { id: string }
}

function instanceToBrowserOption(instance: DiscoveredInstance): BrowserOption {
  return {
    key: `direct:${instance.port}`,
    type: 'direct',
    browser: instance.browser,
    profile: formatInstanceProfiles(instance),
    wsUrl: instance.wsUrl,
    profiles: instance.profiles,
  }
}

function formatInstanceProfiles(instance: DiscoveredInstance): string {
  if (instance.profiles.length === 0) {
    return '(unknown)'
  }
  return instance.profiles
    .map((p) => {
      return p.email ? `${p.name} (${p.email})` : p.name
    })
    .join(', ')
}

/** Discover cloud sessions from the website API, if logged in.
 *  Also adds a "cloud-new" option to create a new cloud browser. */
async function discoverCloudBrowsers(): Promise<BrowserOption[]> {
  const client = getCloudClient()
  if (!client) return []

  try {
    const { sessions } = await client.getStatus()
    const options: BrowserOption[] = sessions.map((s) => {
      return {
        key: `cloud-${s.index}`,
        type: 'cloud' as const,
        browser: 'Chromium',
        profile: `(running, expires ${new Date(s.timeoutAt).toLocaleTimeString()})`,
        activeCloudSessionId: s.cloudSessionId,
      }
    })
    // Always offer a "cloud-new" option to spin up a fresh VM
    options.push({
      key: 'cloud',
      type: 'cloud' as const,
      browser: 'Chromium',
      profile: '(new cloud browser)',
    })
    return options
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(pc.dim(`Cloud browser discovery failed: ${msg}`))
    return []
  }
}

/** Compute whether to block images/video/fonts for proxy bandwidth savings.
 *  Enabled by default when proxy or custom-proxy is set, disabled via
 *  --disable-proxy-bandwidth-acceleration. */
function computeBlockProxyResources(options: { proxy?: string; customProxy?: string; disableProxyBandwidthAcceleration?: boolean }): boolean | undefined {
  const proxyEnabled = !!(options.proxy || options.customProxy)
  if (!proxyEnabled) return undefined // no proxy, no blocking needed
  if (options.disableProxyBandwidthAcceleration) return false
  return true
}

/** Check if user requested a cloud browser that isn't available.
 *  Shows helpful login/subscribe instructions instead of a generic "not found" error.
 *  @param hasCloudOptions whether any cloud options were discovered (to distinguish
 *         "not logged in" from "typo in cloud key") */
async function handleCloudBrowserNotFound(browserKey: string, { hasCloudOptions }: { hasCloudOptions: boolean }): Promise<boolean> {
  if (!browserKey.startsWith('cloud')) return false
  // If cloud options exist, this is a typo (e.g. cloud-99) — let the
  // generic "Browser not found" message show the available list instead.
  if (hasCloudOptions) return false
  const auth = loadCloudAuth()
  if (!auth) {
    console.error('Cloud browsers require authentication.')
    console.error('')
    console.error('  Option 1: Run `tabwright cloud login` (interactive browser flow)')
    console.error('  Option 2: Set TABWRIGHT_API_KEY env var (create one at playwriter.dev/dashboard)')
    console.error('')
    console.error('  Then subscribe at playwriter.dev/dashboard and run `tabwright session new --browser cloud`')
  } else {
    // Verify token is still valid with a quick API check
    const client = getCloudClient()
    const tokenValid = await (async () => {
      if (!client) return false
      try {
        await client.getStatus()
        return true
      } catch {
        return false
      }
    })()

    if (!tokenValid) {
      console.error('Cloud authentication expired. Please re-authenticate.')
      console.error('')
      console.error('  Run `tabwright cloud login` or set TABWRIGHT_API_KEY env var.')
    } else {
      console.error('No cloud browser sessions available.')
      console.error('')
      console.error('  You are logged in, but you may need an active subscription.')
      console.error('  Run `tabwright cloud subscribe` to manage your plan.')
      console.error('  Then run `tabwright session new --browser cloud` to start a cloud browser.')
    }
  }
  process.exit(1)
}

function printCloudTip(): void {
  console.log('')
  console.log(
    pc.dim('Tip: Need stealth browsing, VPS control, or auto CAPTCHA solving? Run `tabwright cloud login` or set TABWRIGHT_API_KEY'),
  )
  console.log(
    pc.dim('     to control a browser in the cloud instead of local Chrome.'),
  )
}

/** Parse a custom proxy string (host:port or user:pass@host:port) into an object. */
function parseCustomProxy(proxyStr: string): { host: string; port: number; username?: string; password?: string } {
  // Format: [user:pass@]host:port
  const atIdx = proxyStr.lastIndexOf('@')
  let hostPort: string
  let username: string | undefined
  let password: string | undefined

  if (atIdx !== -1) {
    const userPass = proxyStr.slice(0, atIdx)
    hostPort = proxyStr.slice(atIdx + 1)
    const colonIdx = userPass.indexOf(':')
    if (colonIdx !== -1) {
      username = userPass.slice(0, colonIdx)
      password = userPass.slice(colonIdx + 1)
    } else {
      username = userPass
    }
  } else {
    hostPort = proxyStr
  }

  const lastColon = hostPort.lastIndexOf(':')
  if (lastColon === -1) {
    throw new Error(`Invalid proxy format: missing port in "${proxyStr}". Expected host:port or user:pass@host:port`)
  }
  const host = hostPort.slice(0, lastColon)
  const port = parseInt(hostPort.slice(lastColon + 1), 10)
  if (isNaN(port)) {
    throw new Error(`Invalid proxy port in "${proxyStr}"`)
  }

  return { host, port, username, password }
}

/** Parse and validate the --timeout CLI option (integer 1-240). */
function parseCloudTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) {
    throw new Error('--timeout must be an integer from 1 to 240')
  }
  const timeout = Number(value)
  if (timeout < 1 || timeout > 240) {
    throw new Error('--timeout must be between 1 and 240 minutes')
  }
  return timeout
}

/** Connect to a cloud browser and create a tabwright session via the relay. */
async function createCloudSession({
  serverUrl,
  proxyRegion,
  customProxy,
  timeout,
  blockProxyResources,
  token,
}: {
  serverUrl: string
  proxyRegion?: string
  customProxy?: string
  /** Cloud browser timeout in minutes (1-240, default 60) */
  timeout?: number
  /** Block images/video/fonts to save proxy bandwidth (default: true when proxy is enabled) */
  blockProxyResources?: boolean
  token?: string
}): Promise<{ id: string; liveUrl: string | null }> {
  const client = getCloudClient()
  if (!client) {
    throw new Error('Not logged in to cloud. Run `tabwright cloud login` first.')
  }

  const connectResult = await client.connect({
    proxyRegion,
    customProxy: customProxy ? parseCustomProxy(customProxy) : undefined,
    timeout,
  })

  if (!connectResult.cdpUrl) {
    throw new Error('Cloud browser returned no CDP URL. The VM may have failed to start.')
  }

  // Normalize https:// CDP URL to wss:// for the relay
  const cdpEndpoint = await resolveDirectInput(connectResult.cdpUrl)

  // Create a tabwright session via the relay using the CDP URL (same as --direct).
  // Also pass cloud metadata so the relay can track idle timeout and auto-disconnect.
  const auth = loadCloudAuth()!
  const cwd = process.cwd()
  let response: Response
  try {
    response = await fetch(`${serverUrl}/cli/session/new`, {
      method: 'POST',
      headers: buildAuthHeaders({ token, json: true }),
      body: JSON.stringify({
        cdpEndpoint,
        cwd,
        browser: 'Chromium (cloud)',
        cloud: {
          cloudSessionId: connectResult.cloudSessionId,
          cloudBaseUrl: auth.baseUrl,
          cloudToken: auth.token,
          timeoutAt: connectResult.timeoutAt,
          blockProxyResources,
        },
      }),
    })
  } catch (cause) {
    // Relay session creation failed — stop the cloud VM so we don't leak a paid resource
    await client.disconnect(connectResult.cloudSessionId).catch(() => {})
    throw new Error('Failed to create relay session', { cause })
  }

  if (!response.ok) {
    await client.disconnect(connectResult.cloudSessionId).catch(() => {})
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }
  const result = (await response.json()) as { id: string }

  return { id: result.id, liveUrl: connectResult.cdpUrl ? buildLiveUrl(connectResult.cdpUrl, auth.baseUrl) : null }
}

/** Reattach to an existing running cloud browser VM instead of creating a new one.
 *  Fetches the session's cdpUrl from the cloud API and creates a relay session. */
async function attachExistingCloudSession({
  serverUrl,
  cloudSessionId,
  blockProxyResources,
  token,
}: {
  serverUrl: string
  cloudSessionId: string
  blockProxyResources?: boolean
  token?: string
}): Promise<{ id: string; liveUrl: string | null }> {
  const client = getCloudClient()
  if (!client) {
    throw new Error('Not logged in to cloud. Run `tabwright cloud login` first.')
  }

  const session = await client.getSessionStatus(cloudSessionId)
  if (!session || session.status !== 'active') {
    throw new Error('Cloud session is no longer active. It may have timed out.')
  }
  if (!session.cdpUrl) {
    throw new Error('Cloud session has no CDP URL available.')
  }

  const cdpEndpoint = await resolveDirectInput(session.cdpUrl)
  const auth = loadCloudAuth()!
  const cwd = process.cwd()

  const response = await fetch(`${serverUrl}/cli/session/new`, {
    method: 'POST',
    headers: buildAuthHeaders({ token, json: true }),
    body: JSON.stringify({
      cdpEndpoint,
      cwd,
      browser: 'Chromium (cloud)',
      cloud: {
        cloudSessionId,
        cloudBaseUrl: auth.baseUrl,
        cloudToken: auth.token,
        timeoutAt: session.timeoutAt,
        blockProxyResources,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }
  const result = (await response.json()) as { id: string }

  return { id: result.id, liveUrl: session.cdpUrl ? buildLiveUrl(session.cdpUrl, auth.baseUrl) : null }
}

function printBrowserTable(options: BrowserOption[]): void {
  const typeLabels = options.map((opt) => {
    if (opt.type === 'direct') return '--direct'
    if (opt.type === 'cloud') return 'cloud'
    return opt.type
  })
  const keyWidth = Math.max(3, ...options.map((opt) => opt.key.length))
  const typeWidth = Math.max(4, ...typeLabels.map((t) => t.length))
  const browserWidth = Math.max(7, ...options.map((opt) => opt.browser.length))

  console.log(
    'KEY'.padEnd(keyWidth) + '  ' + 'TYPE'.padEnd(typeWidth) + '  ' + 'BROWSER'.padEnd(browserWidth) + '  ' + 'PROFILE',
  )
  console.log('-'.repeat(keyWidth + typeWidth + browserWidth + 20))
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]
    console.log(
      opt.key.padEnd(keyWidth) +
        '  ' +
        typeLabels[i].padEnd(typeWidth) +
        '  ' +
        opt.browser.padEnd(browserWidth) +
        '  ' +
        opt.profile,
    )
  }
}

cli
  .command('doctor', 'Check Tabwright readiness and print the single best next step')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use TABWRIGHT_TOKEN env var)')
  .option('--json', 'Print a machine-readable health report')
  .action(async (options) => {
    const isRemote = Boolean(options.host || process.env.TABWRIGHT_HOST)
    const relayStartup = isRemote
      ? { started: false, error: null }
      : await ensureRelayServer({ logger: options.json ? undefined : console })
          .then((started) => {
            return { started: started === true, error: null }
          })
          .catch((error: unknown) => {
            return {
              started: false,
              error: error instanceof Error ? error.message : String(error),
            }
          })

    const serverUrl = await getServerUrl(options.host)
    const headers = buildAuthHeaders({ token: options.token })
    const [relayVersion, relayFeatures, initialExtensions, sessions] = await Promise.all([
      isRemote
        ? fetch(`${serverUrl}/version`, { headers, signal: AbortSignal.timeout(2000) })
            .then(async (response) => {
              if (!response.ok) {
                return null
              }
              const result = (await response.json()) as { version?: string }
              return result.version || null
            })
            .catch(() => {
              return null
            })
        : getRelayServerVersion(RELAY_PORT),
      isRemote
        ? fetch(`${serverUrl}/features`, { headers, signal: AbortSignal.timeout(2000) })
            .then(async (response) => {
              if (!response.ok) {
                return null
              }
              const result: unknown = await response.json()
              if (!result || typeof result !== 'object') {
                return null
              }
              const features = (result as { features?: unknown }).features
              return Array.isArray(features) && features.every((feature) => typeof feature === 'string')
                ? features
                : null
            })
            .catch(() => {
              return null
            })
        : getRelayServerFeatures(RELAY_PORT),
      isRemote ? fetchExtensionsStatus({ host: options.host, token: options.token }) : getExtensionsStatus(RELAY_PORT),
      fetch(`${serverUrl}/cli/sessions`, { headers, signal: AbortSignal.timeout(2000) })
        .then(async (response) => {
          if (!response.ok) {
            return []
          }
          const result = (await response.json()) as { sessions?: DoctorSession[] }
          return result.sessions || []
        })
        .catch(() => {
          return []
        }),
    ])
    const extensions =
      relayStartup.started && initialExtensions.length === 0
        ? await waitForConnectedExtensions({
            timeoutMs: 4000,
            pollIntervalMs: 200,
            logger: options.json ? undefined : console,
          })
        : initialExtensions

    const report = buildDoctorReport({
      version: VERSION,
      cwd: process.cwd(),
      remote: isRemote,
      relayVersion,
      relayFeatures,
      relayError: relayStartup.error,
      extensions,
      sessions,
      capabilityCount: listCapabilities({ cwd: process.cwd() }).length,
      skillStatus: getTabwrightAgentSkillStatus(),
    })

    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log(formatDoctorReport(report))
  })

cli
  .command('session list', 'List all active sessions')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use TABWRIGHT_TOKEN env var)')
  .action(async (options) => {
    if (!options.host && !process.env.TABWRIGHT_HOST) {
      await ensureRelayServer({ logger: console })
    }

    const serverUrl = await getServerUrl(options.host)
    let sessions: Array<{
      id: string
      stateKeys: string[]
      browser: string | null
      profile: { email: string; id: string } | null
      extensionId: string | null
      cwd: string | null
    }> = []

    try {
      const response = await fetch(`${serverUrl}/cli/sessions`, {
        headers: buildAuthHeaders({ token: options.token }),
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) {
        console.error(`Error: ${response.status} ${await response.text()}`)
        process.exit(1)
      }
      const result = (await response.json()) as {
        sessions: Array<{
          id: string
          stateKeys: string[]
          browser: string | null
          profile: { email: string; id: string } | null
          extensionId: string | null
          cwd: string | null
        }>
      }
      sessions = result.sessions
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }

    if (sessions.length === 0) {
      console.log('No active sessions')
      return
    }

    const idWidth = Math.max(2, ...sessions.map((session) => String(session.id).length))
    const browserWidth = Math.max(7, ...sessions.map((session) => (session.browser || 'Chrome').length))
    const profileWidth = Math.max(7, ...sessions.map((session) => (session.profile?.email || '').length || 1))
    const extensionWidth = Math.max(2, ...sessions.map((session) => (session.extensionId || '').length || 1))
    const cwdWidth = Math.max(3, ...sessions.map((session) => (session.cwd || '').length || 1))
    const stateWidth = Math.max(10, ...sessions.map((session) => session.stateKeys.join(', ').length || 1))

    console.log(
      'ID'.padEnd(idWidth) +
        '  ' +
        'BROWSER'.padEnd(browserWidth) +
        '  ' +
        'PROFILE'.padEnd(profileWidth) +
        '  ' +
        'EXT'.padEnd(extensionWidth) +
        '  ' +
        'CWD'.padEnd(cwdWidth) +
        '  ' +
        'STATE KEYS',
    )
    console.log('-'.repeat(idWidth + browserWidth + profileWidth + extensionWidth + cwdWidth + stateWidth + 10))

    for (const session of sessions) {
      const stateStr = session.stateKeys.length > 0 ? session.stateKeys.join(', ') : '-'
      const profileLabel = session.profile?.email || '-'
      const cwdLabel = session.cwd || '-'
      console.log(
        String(session.id).padEnd(idWidth) +
          '  ' +
          (session.browser || 'Chrome').padEnd(browserWidth) +
          '  ' +
          profileLabel.padEnd(profileWidth) +
          '  ' +
          (session.extensionId || '-').padEnd(extensionWidth) +
          '  ' +
          cwdLabel.padEnd(cwdWidth) +
          '  ' +
          stateStr,
      )
    }
  })

cli
  .command('session delete <sessionId>', 'Delete a session and clear its state')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use TABWRIGHT_TOKEN env var)')
  .action(async (sessionId, options) => {
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.TABWRIGHT_HOST) {
      await ensureRelayServer({ logger: console })
    }

    try {
      const response = await fetch(`${serverUrl}/cli/session/delete`, {
        method: 'POST',
        headers: buildAuthHeaders({ token: options.token, json: true }),
        body: JSON.stringify({ sessionId }),
      })

      if (!response.ok) {
        const result = (await response.json()) as { error: string }
        console.error(`Error: ${result.error}`)
        process.exit(1)
      }

      console.log(`Session ${sessionId} deleted.`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('session reset <sessionId>', 'Reset the browser connection for a session')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use TABWRIGHT_TOKEN env var)')
  .action(async (sessionId, options) => {
    const cwd = process.cwd()
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.TABWRIGHT_HOST) {
      await ensureRelayServer({ logger: console })
    }

    try {
      const response = await fetch(`${serverUrl}/cli/reset`, {
        method: 'POST',
        headers: buildAuthHeaders({ token: options.token, json: true }),
        body: JSON.stringify({ sessionId, cwd }),
      })

      if (!response.ok) {
        const text = await response.text()
        console.error(`Error: ${response.status} ${text}`)
        process.exit(1)
      }

      const result = (await response.json()) as { success: boolean; pageUrl: string; pagesCount: number }
      console.log(
        `Connection reset successfully. ${result.pagesCount} page(s) available. Current page URL: ${result.pageUrl}`,
      )
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command(
    'serve',
    `Start the relay server on this machine (must be the same host where Chrome is running). Remote clients (Docker, other machines) connect via TABWRIGHT_HOST. Use --host localhost for Docker (no token needed) — containers reach it via host.docker.internal. Use --host 0.0.0.0 for LAN/internet access (requires --token).`,
  )
  .option('--host [host]', z.string().default('0.0.0.0').describe('Host to bind to (use "localhost" for Docker, "0.0.0.0" for remote access)'))
  .option('--token <token>', 'Authentication token, required when --host is 0.0.0.0 (or use TABWRIGHT_TOKEN env var)')
  .option('--replace', 'Kill existing server if running')
  .action(async (options) => {
    const token = options.token || process.env.TABWRIGHT_TOKEN
    const isPublicHost = options.host === '0.0.0.0' || options.host === '::'
    if (isPublicHost && !token) {
      console.error('Error: Authentication token is required when binding to a public host.')
      console.error('Provide --token <token> or set TABWRIGHT_TOKEN environment variable.')
      process.exit(1)
    }

    // Expose the token to in-process callers so
    // they can attach Authorization: Bearer ... when calling the relay's own
    // privileged endpoints. Required because we no longer bypass auth for
    // loopback — see commit history for the tunnel-agent threat model.
    if (token) {
      process.env.TABWRIGHT_TOKEN = token
    }

    // Check if server is already running on the port
    const net = await import('node:net')
    const isPortInUse = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(500)
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      socket.on('error', () => {
        resolve(false)
      })
      socket.connect(RELAY_PORT, '127.0.0.1')
    })

    if (isPortInUse) {
      if (!options.replace) {
        console.log(`Tabwright server is already running on port ${RELAY_PORT}`)
        console.log('Tip: Use --replace to kill the existing server and start a new one.')
        process.exit(0)
      }

      // Kill existing process on the port
      console.log(`Killing existing server on port ${RELAY_PORT}...`)
      await killPortProcess({ port: RELAY_PORT })
    }

    // Lazy-load heavy dependencies only when serve command is used
    const { createFileLogger } = await import('./create-logger.js')
    const { startTabwrightCDPRelayServer } = await import('./cdp-relay.js')

    const logger = createFileLogger()

    process.title = 'tabwright-serve'

    process.on('uncaughtException', async (err) => {
      await logger.error('Uncaught Exception:', err)
      process.exit(1)
    })

    process.on('unhandledRejection', async (reason) => {
      await logger.error('Unhandled Rejection:', reason)
      process.exit(1)
    })

    const server = await startTabwrightCDPRelayServer({
      port: RELAY_PORT,
      host: options.host,
      token,
      logger,
    })

    console.log('Tabwright CDP relay server started')
    console.log(`  Host: ${options.host}`)
    console.log(`  Port: ${RELAY_PORT}`)
    console.log(`  Token: ${token ? '(configured)' : '(none)'}`)
    console.log(`  Logs: ${logger.logFilePath}`)
    console.log(`  CDP Logs: ${LOG_CDP_FILE_PATH}`)
    console.log('')
    console.log(`CDP endpoint: http://${options.host}:${RELAY_PORT}${token ? '?token=<token>' : ''}`)
    console.log('')
    console.log('Press Ctrl+C to stop.')

    process.on('SIGINT', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })
  })

cli
  .command('browser list', 'List all available browsers: extension-connected and direct CDP on port 9222')
  .option('--host <host>', z.string().describe('Remote relay server host'))
  .option('--token <token>', 'Authentication token (or use TABWRIGHT_TOKEN env var)')
  .action(async (options) => {
    const isLocal = !options.host && !process.env.TABWRIGHT_HOST

    // Start relay if local so the extension can connect, then fetch in parallel
    if (isLocal) {
      await ensureRelayServer({ logger: console })
    }

    const [extensions, directInstances] = await Promise.all([
      isLocal
        ? waitForConnectedExtensions({ timeoutMs: 2000, pollIntervalMs: 200, logger: console })
        : fetchExtensionsStatus({ host: options.host, token: options.token }),
      isLocal ? discoverChromeInstances() : Promise.resolve([] as DiscoveredInstance[]),
    ])

    const cloudOptions = await discoverCloudBrowsers()

    // Check if a Chrome binary is available for headless mode
    const headlessOption: BrowserOption[] = await (async () => {
      try {
        const { resolveBrowserExecutablePath } = await import('./browser-config.js')
        resolveBrowserExecutablePath()
        return [{
          key: 'headless',
          type: 'headless' as const,
          browser: 'Chrome (Headless)',
          profile: '-',
        }]
      } catch {
        return []
      }
    })()

    const allOptions: BrowserOption[] = [
      ...extensions.map((ext) => {
        return {
          key: ext.stableKey || ext.extensionId,
          type: 'extension' as const,
          browser: ext.browser || 'Chrome',
          profile: ext.profile?.email || '(not signed in)',
          extensionId: ext.extensionId === 'default' ? null : ext.stableKey || ext.extensionId,
        }
      }),
      ...directInstances.map(instanceToBrowserOption),
      ...headlessOption,
      ...cloudOptions,
    ]

    if (allOptions.length === 0) {
      console.log('No browsers detected.\n')
      console.log('  Extension: click the Tabwright icon on a tab to connect')
      console.log('  Direct:    open chrome://inspect/#remote-debugging in Chrome')
      console.log('  Headless:  run `tabwright browser install` then `--browser headless`')
      console.log('  Cloud:     run `tabwright cloud login` to connect cloud browsers')
      return
    }

    printBrowserTable(allOptions)
    console.log('')

    const hasDirectInstances = allOptions.some((opt) => {
      return opt.type === 'direct'
    })
    if (hasDirectInstances) {
      console.log(pc.dim('Connect with: tabwright session new --direct'))
      console.log(pc.dim('Chrome may ask to approve the debugging connection.'))
    } else {
      console.log(pc.dim('Use with: tabwright session new [--browser <key>]'))
    }

    const hasCloud = allOptions.some((opt) => {
      return opt.type === 'cloud'
    })
    if (!hasCloud) {
      printCloudTip()
    }
  })

// ── Cloud commands ──────────────────────────────────────────────────

cli
  .command('cloud login', 'Authenticate with playwriter.dev to use cloud browsers')
  .option('--base-url <url>', 'Website base URL (default: https://playwriter.dev)')
  .action(async (options) => {
    const baseUrl = options.baseUrl || process.env.TABWRIGHT_CLOUD_URL || 'https://playwriter.dev'

    // Use the better-auth client SDK so we don't hardcode endpoint URLs.
    // Hardcoded URLs broke before when better-auth changed paths between versions.
    const { createAuthClient } = await import('better-auth/client')
    const { deviceAuthorizationClient } = await import('better-auth/client/plugins')
    const client = createAuthClient({
      baseURL: baseUrl,
      plugins: [deviceAuthorizationClient()],
    })

    console.log('Requesting device authorization...')
    const { data: deviceData, error: requestError } = await client.device.code({
      client_id: 'tabwright-cli',
    })
    if (requestError || !deviceData) {
      console.error(`Error: failed to request device code — ${requestError?.error_description || requestError?.error || 'unknown error'}`)
      process.exit(1)
    }

    const verificationUrl = deviceData.verification_uri_complete || `${baseUrl}/device?user_code=${deviceData.user_code}`
    console.log(`\nOpen this URL in your browser:\n  ${verificationUrl}\n`)
    console.log(`Code: ${deviceData.user_code}\n`)

    await openInBrowser(verificationUrl)

    console.log('Waiting for approval...')
    const pollInterval = (deviceData.interval || 5) * 1000
    const deadline = Date.now() + (deviceData.expires_in || 300) * 1000

    while (Date.now() < deadline) {
      await new Promise((r) => { setTimeout(r, pollInterval) })
      const { data: tokenData, error: pollError } = await client.device.token({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceData.device_code,
        client_id: 'tabwright-cli',
      })
      if (tokenData?.access_token) {
        saveCloudAuth({ token: tokenData.access_token, baseUrl })
        console.log(pc.green('\nLogged in successfully!'))
        console.log('Cloud browsers will now appear in `tabwright session new`.')
        return
      }
      if (pollError?.error === 'authorization_pending' || pollError?.error === 'slow_down') {
        continue
      }
      if (pollError) {
        console.error(`\nError: Device authorization failed — ${pollError.error_description || pollError.error}`)
        process.exit(1)
      }
    }

    console.error('\nError: Device authorization timed out.')
    process.exit(1)
  })

cli
  .command('cloud subscribe', 'Open the subscription page to purchase cloud browser sessions')
  .action(async () => {
    const auth = loadCloudAuth()
    if (!auth) {
      console.error('Not logged in. Run `tabwright cloud login` first.')
      process.exit(1)
    }
    const subscribeUrl = new URL('/dashboard', auth.baseUrl).toString()
    console.log(`Open your browser to manage your subscription:\n  ${subscribeUrl}\n`)
    await openInBrowser(subscribeUrl)
  })

cli
  .command('cloud status', 'Show active cloud browser sessions')
  .action(async () => {
    const client = getCloudClient()
    if (!client) {
      console.error('Not logged in. Run `tabwright cloud login` first.')
      process.exit(1)
    }

    try {
      const { sessions } = await client.getStatus()

      if (sessions.length === 0) {
        console.log('No active cloud sessions.')
        console.log(pc.dim('Start one with: tabwright session new --browser cloud'))
        return
      }

      const keyWidth = Math.max(3, ...sessions.map((s) => `cloud-${s.index}`.length))
      console.log('KEY'.padEnd(keyWidth) + '  ' + 'STATUS'.padEnd(10) + '  ' + 'DETAILS')
      console.log('-'.repeat(keyWidth + 30))

      for (const s of sessions) {
        const key = `cloud-${s.index}`
        const timeoutAt = new Date(s.timeoutAt).toLocaleTimeString()
        console.log(
          key.padEnd(keyWidth) +
            '  ' +
            pc.green('running'.padEnd(10)) +
            '  ' +
            `expires ${timeoutAt}`,
        )
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`Error: ${msg}`)
      process.exit(1)
    }
  })

cli
  .command('cloud live [key]', 'Open a live browser view for an active cloud session')
  .action(async (key) => {
    const client = getCloudClient()
    if (!client) {
      console.error('Not logged in. Run `tabwright cloud login` first.')
      process.exit(1)
    }

    try {
      const { sessions } = await client.getStatus()
      if (sessions.length === 0) {
        console.log('No active cloud sessions.')
        console.log(pc.dim('Start one with: tabwright session new --browser cloud'))
        process.exit(1)
      }

      let session: (typeof sessions)[number] | undefined
      if (key) {
        // Match by cloud-N key or by cloudSessionId
        session = sessions.find((s) => {
          return `cloud-${s.index}` === key || s.cloudSessionId === key || s.browserUseSessionId === key
        })
        if (!session) {
          console.error(`No active session matching "${key}".`)
          console.error('Active sessions: ' + sessions.map((s) => { return `cloud-${s.index}` }).join(', '))
          process.exit(1)
        }
      } else if (sessions.length === 1) {
        session = sessions[0]!
      } else {
        console.log('Multiple active sessions. Specify one:\n')
        for (const s of sessions) {
          console.log(`  cloud-${s.index}  (expires ${new Date(s.timeoutAt).toLocaleTimeString()})`)
        }
        console.log(`\nUsage: tabwright cloud live cloud-1`)
        process.exit(1)
      }

      if (!session.cdpUrl) {
        console.error('Session has no CDP URL — it may still be starting.')
        process.exit(1)
      }
      const auth = loadCloudAuth()!
      const liveUrl = buildLiveUrl(session.cdpUrl, auth.baseUrl)
      console.log(liveUrl)
      await openInBrowser(liveUrl)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`Error: ${msg}`)
      process.exit(1)
    }
  })

cli.command('logfile', 'Print the path to the relay server log file').action(() => {
  console.log(`relay: ${LOG_FILE_PATH}`)
  console.log(`cdp: ${LOG_CDP_FILE_PATH}`)
})

cli
  .command('skill install', 'Install the Tabwright agent skill bundled with this CLI')
  .option('--target <target>', 'Agent skill target (default: codex)')
  .option('--codex-home <dir>', 'Codex home directory (defaults to CODEX_HOME or ~/.codex)')
  .option('--force', 'Overwrite an installed Tabwright skill from another CLI build')
  .option('--json', 'Print JSON')
  .action((options: { target?: string; codexHome?: string; force?: boolean; json?: boolean }) => {
    try {
      const target = parseTabwrightAgentSkillTarget(options.target)
      const result = installTabwrightAgentSkill({
        target,
        codexHome: options.codexHome,
        overwrite: options.force,
      })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`Tabwright skill ${result.fileStatus}: ${result.installedPath}`)
      result.next.forEach((step) => {
        console.log(`Next: ${step}`)
      })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('skill status', 'Check whether the installed Tabwright agent skill matches this CLI')
  .option('--target <target>', 'Agent skill target (default: codex)')
  .option('--codex-home <dir>', 'Codex home directory (defaults to CODEX_HOME or ~/.codex)')
  .option('--json', 'Print JSON')
  .action((options: { target?: string; codexHome?: string; json?: boolean }) => {
    try {
      const status = getTabwrightAgentSkillStatus({
        target: parseTabwrightAgentSkillTarget(options.target),
        codexHome: options.codexHome,
      })
      if (options.json) {
        console.log(JSON.stringify(status, null, 2))
        return
      }
      console.log(`Tabwright skill (${status.target}): ${status.state}`)
      console.log(`Bundled: ${status.bundledPath}`)
      console.log(`Installed: ${status.installedPath}`)
      if (status.state !== 'current') {
        console.log(`Next: ${status.installCommand}`)
      }
    } catch (error) {
      exitWithError(error)
    }
  })

cli.command('skill', 'Print the full tabwright usage instructions').action(() => {
  const skillPath = path.join(__dirname, '..', 'src', 'skill.md')
  const content = fs.readFileSync(skillPath, 'utf-8')
  console.log(content)
})

function parseTabwrightAgentSkillTarget(value: string | undefined): TabwrightAgentSkillTarget {
  if (!value || value === 'codex') {
    return 'codex'
  }
  throw new Error(`Unsupported Tabwright skill target: ${value}. Expected codex.`)
}

cli.help()
cli.completions()
cli.version(VERSION)

const commandLineArgs = process.argv.slice(2)
const isVersionOnly = commandLineArgs.length === 1 && ['-v', '--version'].includes(commandLineArgs[0] || '')
if (isVersionOnly) {
  cli.outputVersion()
} else {
  await cli.parse()
}
