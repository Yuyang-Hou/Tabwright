#!/usr/bin/env node

import './env-compat.js'
import { webMCPCode } from './webmcp.js'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import { goke } from 'goke'
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
import {
  getTabwrightAgentSkillStatus,
  installTabwrightAgentSkill,
  type TabwrightAgentSkillTarget,
} from './tabwright-agent-skill.js'
import { buildDoctorReport, formatDoctorReport, type DoctorSession } from './doctor.js'
import { documentationTopics, readDocumentation } from './documentation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const cli = goke('tabwright')

cli
  .command('docs [topic]', 'Read local browser debugging API references without connecting to a browser')
  .option('--offset <lines>', z.number().default(0).describe('Zero-based starting line'))
  .option('--limit <lines>', z.number().default(160).describe('Maximum lines to return (1-500)'))
  .option('--json', 'Print structured documentation or the topic list')
  .action((topic: string | undefined, options: { offset: number; limit: number; json?: boolean }) => {
    try {
      if (!topic) {
        const topics = documentationTopics.map(({ topic, description }) => {
          return { topic, description, command: `tabwright docs ${topic}` }
        })
        console.log(
          options.json
            ? JSON.stringify({ topics }, null, 2)
            : topics
                .map((item) => {
                  return `${item.command.padEnd(28)} ${item.description}`
                })
                .join('\n'),
        )
        return
      }
      const reference = readDocumentation({ topic, offset: options.offset, limit: options.limit })
      if (options.json) {
        console.log(JSON.stringify(reference, null, 2))
        return
      }
      console.log(reference.content)
      console.log(
        `\n[${reference.topic}: lines ${Math.min(reference.offset + 1, reference.end)}-${reference.end} of ${reference.totalLines}]`,
      )
      if (reference.nextCommand) {
        console.log(`Next: ${reference.nextCommand}`)
      }
    } catch (error) {
      exitWithError(error)
    }
  })

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
      const [
        { getBrowserLaunchArgs, getDefaultBrowserUserDataDir, startBrowserProcess },
        { resolveBrowserExecutablePath, shouldUseHeadlessByDefault },
        { getBundledExtensionPath },
      ] = await Promise.all([
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
  })

cli.command('browser install', 'Download Chrome for Testing for headless browser automation').action(async () => {
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
  .option('-e, --eval <code>', 'Execute JavaScript; use `tabwright docs` for local browser debugging references')
  .option('-f, --file <path>', 'Execute JavaScript from a file and exit')
  .option('--patchright', 'Use @playwriter/patchright-core for stealth mode (bypasses bot detection)')
  .option(
    '--timeout [ms]',
    z.number().default(10000).describe('Response deadline in milliseconds; does not cancel browser actions'),
  )
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

cli
  .command('webmcp list', 'Discover native WebMCP tools in one connected top-level page')
  .option('-s, --session <id>', 'Session ID from tabwright session new')
  .option('--page-url <url>', 'Exact observed URL of one connected page')
  .option('--host <host>', 'Remote relay host')
  .option('--token <token>', 'Remote relay token')
  .option(
    '--timeout <ms>',
    z.number().positive().default(10000).describe('Response deadline; does not cancel browser work'),
  )
  .action(async (options) => {
    try {
      const pageUrl = z.string().url().parse(options.pageUrl)
      const timeout = z.coerce.number().positive().parse(options.timeout)
      await executeCode({
        code: webMCPCode({ action: 'list', pageUrl }),
        timeout,
        sessionId: options.session,
        host: options.host,
        token: options.token,
      })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('webmcp call', 'Invoke a discovered WebMCP tool; never automatically retries')
  .option('-s, --session <id>', 'Same session used for discovery')
  .option('--tool-id <id>', 'Opaque tool ID from webmcp list')
  .option('--input-json <json>', 'JSON object matching the tool schema')
  .option('--host <host>', 'Remote relay host')
  .option('--token <token>', 'Remote relay token')
  .option(
    '--timeout <ms>',
    z.number().positive().default(10000).describe('Response deadline; does not cancel browser work'),
  )
  .action(async (options) => {
    try {
      const toolId = z.string().min(1).parse(options.toolId)
      const input = z.record(z.string(), z.unknown()).parse(JSON.parse(z.string().parse(options.inputJson)))
      const timeout = z.coerce.number().positive().parse(options.timeout)
      await executeCode({
        code: webMCPCode({ action: 'call', toolId, input }),
        timeout,
        sessionId: options.session,
        host: options.host,
        token: options.token,
      })
    } catch (error) {
      exitWithError(error)
    }
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

async function fetchExtensionsStatus({ host, token }: { host?: string; token?: string } = {}): Promise<
  ExtensionStatus[]
> {
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
    }

    if (result.isError) {
      process.exitCode = 1
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

// Session management commands
// Unified browser option type used in the multi-browser selection table
interface BrowserOption {
  key: string
  type: 'extension' | 'direct' | 'headless'
  browser: string
  profile: string
  /** For extension entries */
  extensionId?: string | null
  /** For direct CDP entries */
  wsUrl?: string
  /** Raw profile data from discovery (for passing to relay) */
  profiles?: Array<{ name: string; email: string }>
}

function exitWithError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Error: ${message}`)
  process.exit(1)
}

cli
  .command('session new', 'Create a new session and print the session ID')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use TABWRIGHT_TOKEN env var)')
  .option(
    '--browser <key>',
    'Browser key when multiple browsers are available. Use "headless" to launch a separate Chrome without the extension',
  )
  .option('--patchright', 'Use @playwriter/patchright-core for stealth mode (bypasses bot detection)')
  .option(
    '--direct [endpoint]',
    'Use direct CDP connection without the extension. Enable debugging first at chrome://inspect/#remote-debugging or launch Chrome with --remote-debugging-port=9222. Auto-discovers instances or accepts an explicit ws:// endpoint',
  )
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
        const result = await createDirectSession({
          serverUrl,
          cdpEndpoint: instance.wsUrl,
          browser: instance.browser,
          profiles: instance.profiles,
          token: options.token,
        })
        const profileLabel = formatInstanceProfiles(instance)
        console.log(
          `Session ${result.id} created (direct CDP, ${instance.browser}${profileLabel}). Use with: tabwright -s ${result.id} -e "..."`,
        )
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
          console.error(`Browser not found: ${options.browser}`)
          console.error('Available: ' + directOptions.map((opt) => opt.key).join(', '))
          process.exit(1)
        }
        const serverUrl = await getServerUrl(options.host)
        const result = await createDirectSession({
          serverUrl,
          cdpEndpoint: selected.wsUrl!,
          browser: selected.browser,
          profiles: selected.profiles,
          token: options.token,
        })
        console.log(`Session ${result.id} created (direct CDP). Use with: tabwright -s ${result.id} -e "..."`)
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
      console.error('No connected browsers detected. Click the Tabwright extension icon.')
      console.error(pc.dim('Tip: Use --direct to connect via Chrome DevTools Protocol instead.'))
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
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      return
    }

    // Multiple extensions: also discover local direct CDP instances.
    // Direct discovery only works locally — remote relay can't reach local Chrome debug ports.
    const directInstances = isLocal
      ? await (async () => {
          console.log(pc.dim('Discovering additional Chrome instances...'))
          return await discoverChromeInstances()
        })()
      : []

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
    ]

    if (options.browser) {
      const selected = allOptions.find((opt) => {
        return opt.key === options.browser
      })
      if (!selected) {
        console.error(`Browser not found: ${options.browser}`)
        console.error('Available: ' + allOptions.map((opt) => opt.key).join(', '))
        process.exit(1)
      }

      try {
        const serverUrl = await getServerUrl(options.host)
        if (selected.type === 'direct') {
          const result = await createDirectSession({
            serverUrl,
            cdpEndpoint: selected.wsUrl!,
            browser: selected.browser,
            profiles: selected.profiles,
            token: options.token,
          })
          console.log(`Session ${result.id} created (direct CDP). Use with: tabwright -s ${result.id} -e "..."`)
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

function printBrowserTable(options: BrowserOption[]): void {
  const typeLabels = options.map((opt) => {
    if (opt.type === 'direct') return '--direct'
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
  .option(
    '--host [host]',
    z.string().default('0.0.0.0').describe('Host to bind to (use "localhost" for Docker, "0.0.0.0" for remote access)'),
  )
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

    // Check if a Chrome binary is available for headless mode
    const headlessOption: BrowserOption[] = await (async () => {
      try {
        const { resolveBrowserExecutablePath } = await import('./browser-config.js')
        resolveBrowserExecutablePath()
        return [
          {
            key: 'headless',
            type: 'headless' as const,
            browser: 'Chrome (Headless)',
            profile: '-',
          },
        ]
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
    ]

    if (allOptions.length === 0) {
      console.log('No browsers detected.\n')
      console.log('  Extension: click the Tabwright icon on a tab to connect')
      console.log('  Direct:    open chrome://inspect/#remote-debugging in Chrome')
      console.log('  Headless:  run `tabwright browser install` then `--browser headless`')
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
  })

cli.command('logfile', 'Print the path to the relay server log file').action(() => {
  console.log(`relay: ${LOG_FILE_PATH}`)
  console.log(`cdp: ${LOG_CDP_FILE_PATH}`)
})

cli
  .command('skill install', 'Install the Tabwright Agent Skill bundled with this CLI')
  .option('--target <target>', 'Agent Skill target: agents, codex, or claude (default: agents)')
  .option('--skill-root <dir>', 'Override the target Agent Skills root directory')
  .option('--force', 'Overwrite a user-modified installed Tabwright Skill')
  .option('--json', 'Print JSON')
  .action((options: { target?: string; skillRoot?: string; force?: boolean; json?: boolean }) => {
    try {
      const result = installTabwrightAgentSkill({
        target: parseTabwrightAgentSkillTarget(options.target),
        skillRoot: options.skillRoot,
        overwrite: options.force,
      })
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`Tabwright Agent Skill ${result.fileStatus}: ${result.installedPath}`)
      result.next.map((step) => {
        console.log(`Next: ${step}`)
        return step
      })
    } catch (error) {
      exitWithError(error)
    }
  })

cli
  .command('skill status', 'Check whether the installed Tabwright Agent Skill matches this CLI')
  .option('--target <target>', 'Agent Skill target: agents, codex, or claude (default: agents)')
  .option('--skill-root <dir>', 'Override the target Agent Skills root directory')
  .option('--json', 'Print JSON')
  .action((options: { target?: string; skillRoot?: string; json?: boolean }) => {
    try {
      const status = getTabwrightAgentSkillStatus({
        target: parseTabwrightAgentSkillTarget(options.target),
        skillRoot: options.skillRoot,
      })
      if (options.json) {
        console.log(JSON.stringify(status, null, 2))
        return
      }
      console.log(`Tabwright Agent Skill: ${status.state}`)
      console.log(`Installed: ${status.installedPath}`)
      if (status.state !== 'current') {
        console.log(`Next: ${status.installCommand}`)
      }
    } catch (error) {
      exitWithError(error)
    }
  })

cli.command('skill', 'Print the full browser debugging reference (use docs for one topic)').action(() => {
  const skillPath = path.join(__dirname, '..', 'src', 'skill.md')
  const content = fs.readFileSync(skillPath, 'utf-8')
  console.log(content)
})

function parseTabwrightAgentSkillTarget(value: string | undefined): TabwrightAgentSkillTarget {
  if (!value || value === 'agents') {
    return 'agents'
  }
  if (value === 'codex' || value === 'claude') {
    return value
  }
  throw new Error(`Unknown Agent Skill target: ${value}. Expected agents, codex, or claude.`)
}

cli.help()
cli.completions()
cli.version(VERSION)

const commandLineArgs = process.argv.slice(2)
const isVersionOnly = commandLineArgs.length === 1 && ['-v', '--version'].includes(commandLineArgs[0] || '')
if (
  ['capability', 'cloud', 'activity', 'replay'].includes(commandLineArgs[0] || '') ||
  (commandLineArgs[0] === 'skill' && commandLineArgs[1] === 'runtime')
) {
  exitWithError(
    new Error(
      'Managed Skill runtimes, recording and cloud provisioning have been removed. Migrate business validation, confirmation and authentication into your own script, then use `tabwright -s <id> -f <file>`. No business request was sent. Do not automatically translate or retry the old command.',
    ),
  )
} else if (isVersionOnly) {
  cli.outputVersion()
} else {
  await cli.parse()
}
