import './env-compat.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Prevent Buffers from dumping hex bytes in util.inspect output.
// Without this, returning a screenshot Buffer would log ~400+ chars of useless hex.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}

import dedent from 'string-dedent'
import { LOG_FILE_PATH, VERSION, parseRelayHost } from './utils.js'
import { ensureRelayServer, getLocalRelayHttpBaseUrl, RELAY_PORT } from './relay-client.js'
import { PlaywrightExecutor, CodeExecutionTimeoutError, type ExecuteResult } from './executor.js'
import { discoverChromeInstances, resolveDirectInput, appendSessionToWsUrl } from './chrome-discovery.js'
import crypto from 'node:crypto'
import {
  listCapabilities,
  readCapabilityScript,
  routeCapabilities,
  searchCapabilities,
  toCapabilityContract,
  toCapabilitySummary,
} from './capability-registry.js'
import { refreshCapabilityAuthWithExecutor } from './capability-auth.js'
import { runCapabilityWithExecutor, runNodeCapability } from './capability-runner.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

// Single executor instance for MCP (created lazily)
let executor: PlaywrightExecutor | null = null

interface RemoteConfig {
  host: string
  port: number
  token?: string
}

function getRemoteConfig(): RemoteConfig | null {
  const host = process.env.TABWRIGHT_HOST
  if (!host) {
    return null
  }
  return {
    host,
    port: RELAY_PORT,
    token: process.env.TABWRIGHT_TOKEN,
  }
}

function getLogServerUrl(): string {
  const remote = getRemoteConfig()
  if (remote) {
    const { httpBaseUrl } = parseRelayHost(remote.host, remote.port)
    return `${httpBaseUrl}/mcp-log`
  }
  return `http://127.0.0.1:${RELAY_PORT}/mcp-log`
}

async function sendLogToRelayServer(level: string, ...args: any[]) {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = process.env.TABWRIGHT_TOKEN
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    await fetch(getLogServerUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ level, args }),
      signal: AbortSignal.timeout(1000),
    })
  } catch {
    // Silently fail if relay server is not available
  }
}

/**
 * Log to both console.error (for early startup) and relay server log file.
 * Fire-and-forget to avoid blocking.
 */
function mcpLog(...args: any[]) {
  console.error(...args)
  sendLogToRelayServer('log', ...args)
}

/** MCP-specific logger for executor */
const mcpLogger = {
  log: (...args: any[]) => mcpLog(...args),
  error: (...args: any[]) => {
    console.error(...args)
    sendLogToRelayServer('error', ...args)
  },
}

async function ensureRelayServerForMcp(): Promise<void> {
  await ensureRelayServer({ logger: mcpLogger })
}

/**
 * Resolve direct CDP config from TABWRIGHT_DIRECT env var.
 * - "auto" / "1" / "true": auto-discover Chrome on default port 9222
 * - "ws://..." / "wss://...": use explicit WebSocket endpoint
 * - "host:port": resolve to ws:// URL via HTTP probe + DevToolsActivePort fallback
 */
async function getDirectCdpConfig(): Promise<{ directCdpUrl: string } | null> {
  const directEnv = process.env.TABWRIGHT_DIRECT
  if (!directEnv) {
    return null
  }

  // Auto-discover: check default port 9222
  if (directEnv === '1') {
    const instances = await discoverChromeInstances()
    if (instances.length === 0) {
      throw new Error(
        'TABWRIGHT_DIRECT is set but no Chrome found on port 9222. ' +
          'Enable debugging at chrome://inspect/#remote-debugging or launch with --remote-debugging-port=9222.',
      )
    }
    const sessionId = crypto.randomUUID()
    const wsUrl = appendSessionToWsUrl(instances[0].wsUrl, sessionId)
    mcpLog(`Direct CDP: using ${instances[0].browser} on port ${instances[0].port}`)
    return { directCdpUrl: wsUrl }
  }

  // ws://, wss://, or host:port — resolveDirectInput handles all three
  const resolved = await resolveDirectInput(directEnv)
  const sessionId = crypto.randomUUID()
  const directCdpUrl = appendSessionToWsUrl(resolved, sessionId)
  mcpLog(`Direct CDP: resolved ${directEnv} → ${directCdpUrl}`)
  return { directCdpUrl }
}

async function getOrCreateExecutor(): Promise<PlaywrightExecutor> {
  if (executor) {
    return executor
  }

  // Direct CDP mode takes priority over relay/remote
  const directConfig = await getDirectCdpConfig()
  if (directConfig) {
    executor = new PlaywrightExecutor({
      cdpConfig: directConfig,
      logger: mcpLogger,
      cwd: process.cwd(),
    })
    return executor
  }

  const remote = getRemoteConfig()
  if (!remote) {
    await ensureRelayServerForMcp()
  }

  // Pass config instead of pre-generated URL so executor can generate unique URLs for each connection
  const cdpConfig = remote || { host: await getLocalRelayHttpBaseUrl(RELAY_PORT), port: RELAY_PORT }
  executor = new PlaywrightExecutor({
    cdpConfig,
    logger: mcpLogger,
    cwd: process.cwd(),
  })

  return executor
}

async function checkRemoteServer({ host, port }: { host: string; port: number }): Promise<void> {
  const { httpBaseUrl } = parseRelayHost(host, port)
  const versionUrl = `${httpBaseUrl}/version`
  try {
    const response = await fetch(versionUrl, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`)
    }
  } catch (error: any) {
    const isConnectionError = error.cause?.code === 'ECONNREFUSED' || error.name === 'TimeoutError'
    if (isConnectionError) {
      throw new Error(
        `Cannot connect to remote relay server at ${host}. ` +
          `Make sure 'npx -y tabwright serve' is running on the host machine.`,
      )
    }
    throw new Error(`Failed to connect to remote relay server: ${error.message}`)
  }
}

const server = new McpServer({
  name: 'tabwright',
  title: 'The better playwright MCP: works as a browser extension. No context bloat. More capable.',
  version: VERSION,
})

const promptContent =
  fs.readFileSync(path.join(__dirname, '..', 'dist', 'prompt.md'), 'utf-8') +
  `\n\nfor debugging internal Tabwright errors, check Tabwright relay server logs at: ${LOG_FILE_PATH}`

server.resource(
  'debugger-api',
  'https://playwriter.dev/resources/debugger-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('tabwright/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'debugger-api.md'), 'utf-8')
    return {
      contents: [{ uri: 'https://playwriter.dev/resources/debugger-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.resource(
  'editor-api',
  'https://playwriter.dev/resources/editor-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('tabwright/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'editor-api.md'), 'utf-8')
    return {
      contents: [{ uri: 'https://playwriter.dev/resources/editor-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.resource(
  'styles-api',
  'https://playwriter.dev/resources/styles-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('tabwright/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'styles-api.md'), 'utf-8')
    return {
      contents: [{ uri: 'https://playwriter.dev/resources/styles-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.resource(
  'capabilities',
  'tabwright://capabilities',
  { mimeType: 'application/json' },
  async () => {
    const capabilities = listCapabilities({ cwd: process.cwd() }).map(toCapabilityContract)
    return {
      contents: [
        {
          uri: 'tabwright://capabilities',
          text: JSON.stringify(capabilities, null, 2),
          mimeType: 'application/json',
        },
      ],
    }
  },
)

function executeResultToMcpContent(options: {
  result: ExecuteResult
  prefix?: string
}): Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> {
  const MAX_TEXT = 10000
  let text = options.prefix ? `${options.prefix}\n\n${options.result.text}` : options.result.text
  for (const s of options.result.screenshots) {
    text += `\nScreenshot saved to: ${s.path} (image included below, ${s.labelCount} labels)\n`
    text += `Accessibility snapshot:\n${s.snapshot}\n`
  }
  if (text.length > MAX_TEXT) {
    text = text.slice(0, MAX_TEXT) + '\n\n[Truncated]'
  }

  const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
    { type: 'text', text },
  ]
  for (const image of options.result.images) {
    content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
  }
  return content
}

server.tool(
  'capability',
  dedent`
    Search, inspect, refresh auth for, or run saved Tabwright capabilities. Capabilities are reusable Tabwright scripts with AI-readable contracts, local secrets, and run logs.

    For concrete user tasks, use action "route" first. If it returns an exact-match direct-run capability, use action "run" directly with the returned input; do not search, describe, or open a page first.
    Capability ids are not shell commands. If route output includes shellCommand, use that exact Tabwright CLI command; never run the capability id directly as a binary.
    Do not treat every URL as a direct-run signal. If "route" returns no match, use action "search" before creating new browser code and action "describe" before running. Only use action "refresh_auth" after explicit user confirmation because it updates local credentials.
    If a capability operation requires confirmation, stop and ask the user. Only after explicit approval may you retry action "run" with confirmation set to the operation's exact confirmationToken. force never bypasses this gate.
  `,
  {
    action: z.enum(['list', 'route', 'search', 'show', 'describe', 'run', 'refresh_auth']).describe('Capability action'),
    id: z.string().optional().describe('Capability id for show/describe/run/refresh_auth'),
    query: z.string().optional().describe('Task or URL for action "route"; search query for action "search"'),
    limit: z.number().default(10).describe('Maximum number of search results'),
    input: z.record(z.string(), z.unknown()).optional().describe('JSON input for run'),
    force: z.boolean().optional().describe('Run draft capabilities or bypass URL match checks'),
    confirmation: z.string().optional().describe('Exact confirmationToken, supplied only after explicit user approval'),
    timeout: z.number().default(10000).describe('Timeout in milliseconds'),
  },
  async ({ action, id, query, limit, input, force, confirmation, timeout }) => {
    try {
      if (action === 'list') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(listCapabilities({ cwd: process.cwd() }).map(toCapabilityContract), null, 2),
            },
          ],
        }
      }

      if (action === 'search') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                searchCapabilities({ query: query || '', cwd: process.cwd(), limit }).map((result) => {
                  return {
                    score: result.score,
                    reasons: result.reasons,
                    ...toCapabilityContract(result.capability),
                  }
                }),
                null,
                2,
              ),
            },
          ],
        }
      }

      if (action === 'route') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                routeCapabilities({ task: query || '', cwd: process.cwd(), limit }).map((route) => {
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
                }),
                null,
                2,
              ),
            },
          ],
        }
      }

      if (!id) {
        return { content: [{ type: 'text', text: 'id is required' }], isError: true }
      }

      if (action === 'show' || action === 'describe') {
        const capability = listCapabilities({ cwd: process.cwd() }).find((candidate) => {
          return candidate.manifest.id === id
        })
        if (!capability) {
          return { content: [{ type: 'text', text: `Capability not found: ${id}` }], isError: true }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ...(action === 'describe' ? toCapabilityContract(capability) : toCapabilitySummary(capability)),
                  ...(action === 'show' ? { script: readCapabilityScript({ id, cwd: process.cwd() }) } : {}),
                },
                null,
                2,
              ),
            },
          ],
        }
      }

      if (action === 'refresh_auth') {
        const exec = await getOrCreateExecutor()
        const result = await refreshCapabilityAuthWithExecutor({
          executor: exec,
          id,
          cwd: process.cwd(),
          timeout,
        })
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
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
            },
          ],
        }
      }

      const capability = listCapabilities({ cwd: process.cwd() }).find((candidate) => {
        return candidate.manifest.id === id
      })
      if (!capability) {
        return { content: [{ type: 'text', text: `Capability not found: ${id}` }], isError: true }
      }
      if (capability.manifest.runtime === 'node') {
        const result = await runNodeCapability({
          id,
          input: input || {},
          cwd: process.cwd(),
          timeout,
          force,
          confirmation,
        })
        return {
          content: [
            {
              type: 'text',
              text: `Capability output:\n${JSON.stringify(result.output, null, 2)}\n\n${result.text}`,
            },
          ],
          isError: result.isError,
        }
      }

      const exec = await getOrCreateExecutor()
      const result = await runCapabilityWithExecutor({
        executor: exec,
        id,
        input: input || {},
        cwd: process.cwd(),
        timeout,
        force,
        confirmation,
      })
      return {
        content: executeResultToMcpContent({
          result: result.executeResult,
          prefix: `Capability output:\n${JSON.stringify(result.output, null, 2)}`,
        }),
        isError: result.executeResult.isError,
      }
    } catch (error) {
      const errorStack = error instanceof Error ? error.stack || error.message : String(error)
      console.error('Error in capability tool:', errorStack)
      return {
        content: [{ type: 'text', text: `Error running capability: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      }
    }
  },
)

server.tool(
  'execute',
  promptContent,
  {
    code: z
      .string()
      .describe(
        'js playwright code, has {page, state, context} in scope. Should be one line, using ; to execute multiple statements. you MUST call execute multiple times instead of writing complex scripts in a single tool call.',
      ),
    timeout: z.number().default(10000).describe('Timeout in milliseconds for code execution (default: 10000ms)'),
  },
  async ({ code, timeout }) => {
    try {
      // Check relay server on every execute to auto-recover from crashes
      // (skip in direct CDP mode — no relay involved)
      if (!process.env.TABWRIGHT_DIRECT) {
        const remote = getRemoteConfig()
        if (!remote) {
          await ensureRelayServerForMcp()
        }
      }

      const exec = await getOrCreateExecutor()
      const result = await exec.execute(code, timeout)

      // Transform executor result to MCP format
      // Append screenshot metadata to text for MCP (image is included inline as content)
      const MAX_TEXT = 10000
      let text = result.text
      for (const s of result.screenshots) {
        text += `\nScreenshot saved to: ${s.path} (image included below, ${s.labelCount} labels)\n`
        text += `Accessibility snapshot:\n${s.snapshot}\n`
      }
      if (text.length > MAX_TEXT) {
        text = text.slice(0, MAX_TEXT) + '\n\n[Truncated]'
      }

      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text },
      ]

      for (const image of result.images) {
        content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
      }

      if (result.isError) {
        return { content, isError: true }
      }

      return { content }
    } catch (error: any) {
      const errorStack = error.stack || error.message
      const isTimeoutError =
        error instanceof CodeExecutionTimeoutError || error?.name === 'TimeoutError' || error?.name === 'AbortError'

      console.error('Error in execute tool:', errorStack)
      if (!isTimeoutError) {
        sendLogToRelayServer('error', 'Error in execute tool:', errorStack)
      }

      const resetHint = isTimeoutError
        ? ''
        : '\n\n[HINT: If this is an internal Playwright error, page/browser closed, or connection issue, call the `reset` tool to reconnect. Do NOT reset for other non-connection non-internal errors.]'

      // timeout stacks are internal noise (Promise.race / setTimeout); only show the message
      const errorText = isTimeoutError ? error.message : errorStack
      return {
        content: [{ type: 'text', text: `Error executing code: ${errorText}${resetHint}` }],
        isError: true,
      }
    }
  },
)

server.tool(
  'reset',
  dedent`
    Recreates the CDP connection and resets the browser/page/context. Use this when the MCP stops responding, you get connection errors, if there are no pages in context, assertion failures, page closed, or other issues.

    After calling this tool, the page and context variables are automatically updated in the execution environment.

    This tools also removes any custom properties you may have added to the global scope AND clearing all keys from the \`state\` object. Only \`page\`, \`context\`, \`state\` (empty), \`console\`, and utility functions will remain.

    if playwright always returns all pages as about:blank urls and evaluate does not work you should ask the user to restart Chrome. This is a known Chrome bug.
  `,
  {},
  async () => {
    try {
      // Check relay server to auto-recover from crashes
      // (skip in direct CDP mode — no relay involved)
      if (!process.env.TABWRIGHT_DIRECT) {
        const remote = getRemoteConfig()
        if (!remote) {
          await ensureRelayServerForMcp()
        }
      }

      const exec = await getOrCreateExecutor()
      const { page, context } = await exec.reset()
      const pagesCount = context.pages().length
      return {
        content: [
          {
            type: 'text',
            text: `Connection reset successfully. ${pagesCount} page(s) available. Current page URL: ${page.url()}`,
          },
        ],
      }
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to reset connection: ${error.message}` }],
        isError: true,
      }
    }
  },
)

export async function startMcp(options: { host?: string; token?: string } = {}) {
  if (options.host) {
    process.env.TABWRIGHT_HOST = options.host
  }
  if (options.token) {
    process.env.TABWRIGHT_TOKEN = options.token
  }

  // In direct CDP mode (TABWRIGHT_DIRECT env var), no relay server needed
  if (process.env.TABWRIGHT_DIRECT) {
    mcpLog(`Using direct CDP connection: ${process.env.TABWRIGHT_DIRECT}`)
  } else {
    const remote = getRemoteConfig()
    if (!remote) {
      await ensureRelayServerForMcp()
    } else {
      mcpLog(`Using remote CDP relay server: ${remote.host}`)
      await checkRemoteServer(remote)
    }
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
