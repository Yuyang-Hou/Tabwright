import http from 'node:http'
import childProcess from 'node:child_process'
import util from 'node:util'
import path from 'node:path'
import { chromium, type Browser, type Page } from '@xmorse/playwright-core'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { WebMCP, webMCPCode } from './webmcp.js'
import { cleanupTestContext, safeCloseCDPBrowser, setupTestContext, type TestContext } from './test-utils.js'
import { createMCPClient } from './mcp-client.js'
import { getCdpUrl } from './utils.js'

const execFile = util.promisify(childProcess.execFile)
const port = 19979
const fixture = `<!doctype html><title>WebMCP acceptance</title><script>
window.calls = 0;
window.controller = new AbortController();
window.register = () => document.modelContext.registerTool({
  name: 'lookup', description: 'Look up a synthetic item',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  annotations: { readOnlyHint: true },
  execute: async ({query}) => {
    window.calls++;
    if (query === 'reject') throw new Error('Fixture rejected');
    if (query === 'navigate') { window.location.href = '/after'; return new Promise(() => {}); }
    if (query === 'slow') await new Promise(resolve => setTimeout(resolve, 700));
    return 'item:' + query;
  }
}, { signal: window.controller.signal });
window.register();
</script>`

function resultText(result: { [key: string]: unknown }): string {
  const blocks = result.content as Array<{ type: string; text?: string }>
  return blocks
    .filter((block) => {
      return block.type === 'text'
    })
    .map((block) => {
      return block.text
    })
    .join('\n')
}

function outputJson(text: string): { tools: Array<{ toolId: string }>; result?: string; status?: string } {
  const line = text.split('\n').find((entry) => {
    return entry.startsWith('[log] {')
  })
  if (!line) {
    throw new Error(`Missing JSON result: ${text}`)
  }
  return JSON.parse(line.slice('[log] '.length))
}

describe('native WebMCP through the Tabwright extension', () => {
  const api = new WebMCP()
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(fixture)
  })
  let context: TestContext
  let browser: Browser
  let page: Page
  let baseUrl: string

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing fixture address')
    }
    baseUrl = `http://127.0.0.1:${address.port}/`
    context = await setupTestContext({
      port,
      tempDirPrefix: 'webmcp-test-',
      toggleExtension: true,
      browserArgs: ['--enable-features=WebMCPTesting'],
    })
    browser = await chromium.connectOverCDP(getCdpUrl({ port }))
    page = await browser.contexts()[0].newPage()
    console.log('Native WebMCP acceptance user agent:', await page.evaluate('navigator.userAgent'))
  }, 60000)

  beforeEach(async () => {
    await api.dispose()
    await page.goto(baseUrl)
  })

  afterAll(async () => {
    await api.dispose()
    if (browser) {
      await safeCloseCDPBrowser(browser)
    }
    await cleanupTestContext(context)
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  })

  test('discovers metadata without executing, invokes native tool and preserves non-JSON output', async () => {
    const listing = await api.list({ page })
    expect(listing.pageUrl).toBe(baseUrl)
    expect(listing.tools).toHaveLength(1)
    expect(listing.tools[0]).toMatchObject({
      name: 'lookup',
      description: 'Look up a synthetic item',
      origin: new URL(baseUrl).origin,
    })
    expect(await page.evaluate('window.calls')).toBe(0)
    expect(await api.call({ toolId: listing.tools[0].toolId, input: { query: 'hello' } })).toEqual({
      status: 'returned',
      result: 'item:hello',
    })
    expect(await page.evaluate('window.calls')).toBe(1)
  })

  test('repeat discovery and reload invalidate IDs, including a reload to the same URL', async () => {
    const first = await api.list({ page })
    const second = await api.list({ page })
    await expect(api.call({ toolId: first.tools[0].toolId, input: {} })).rejects.toThrow('WEBMCP_STALE')
    await page.reload()
    await expect(api.call({ toolId: second.tools[0].toolId, input: {} })).rejects.toThrow('WEBMCP_STALE')
    const fresh = await api.list({ page })
    expect(await api.call({ toolId: fresh.tools[0].toolId, input: { query: 'fresh' } })).toMatchObject({
      result: 'item:fresh',
    })
  })

  test('SPA round-trip navigation invalidates tools even when the URL returns to the original', async () => {
    const listing = await api.list({ page })
    await page.evaluate(() => {
      window.history.pushState({}, '', '#other')
      window.history.replaceState({}, '', window.location.pathname)
    })
    await expect(api.call({ toolId: listing.tools[0].toolId, input: {} })).rejects.toThrow('WEBMCP_STALE')
    expect(await page.evaluate('window.calls')).toBe(0)
  })

  test('toolchange invalidates old IDs, handles removal and rediscovers replacements', async () => {
    const listing = await api.list({ page })
    await page.evaluate('window.controller.abort()')
    await expect(api.call({ toolId: listing.tools[0].toolId, input: {} })).rejects.toThrow()
    expect((await api.list({ page })).tools).toEqual([])
    await page.evaluate('window.controller = new AbortController(); window.register()')
    expect((await api.list({ page })).tools).toHaveLength(1)
  })

  test('reports unavailable API separately and rejects malformed input without invocation', async () => {
    const listing = await api.list({ page })
    await expect(
      api.call({ toolId: listing.tools[0].toolId, input: [] as unknown as Record<string, unknown> }),
    ).rejects.toThrow('WEBMCP_INVALID_INPUT')
    await expect(api.call({ toolId: listing.tools[0].toolId, input: {} })).rejects.toThrow()
    expect(await page.evaluate('window.calls')).toBe(0)
    await page.evaluate(() => {
      Object.defineProperty(document, 'modelContext', { value: undefined, configurable: true })
    })
    await expect(api.list({ page })).rejects.toThrow('WEBMCP_UNAVAILABLE')
  })

  test('rejected tool is invoked once and never retried', async () => {
    const listing = await api.list({ page })
    await expect(api.call({ toolId: listing.tools[0].toolId, input: { query: 'reject' } })).rejects.toThrow(
      'Do not automatically retry',
    )
    expect(await page.evaluate('window.calls')).toBe(1)
  })

  test('navigation during invocation reports an unknown outcome without retrying', async () => {
    const listing = await api.list({ page })
    const result = await api
      .call({ toolId: listing.tools[0].toolId, input: { query: 'navigate' } })
      .catch((error: unknown) => {
        return error
      })
    if (result instanceof Error) {
      expect(result.message).toMatch(/unknown|Do not automatically retry/)
    } else {
      expect(result).toEqual({ status: 'unknown', result: null })
    }
    await page.waitForURL(new URL('/after', baseUrl).toString())
  })

  test('inspection always refreshes tools and never presents a failed discovery as an empty directory', async () => {
    const first = await api.inspect({ page })
    expect(first.status).toBe('available')
    if (first.status !== 'available') {
      throw new Error('Fixture discovery failed')
    }
    expect(first.tools[0].inputSchema).toBeDefined()
    await page.evaluate('window.controller.abort()')
    expect(await api.inspect({ page })).toMatchObject({ status: 'available', tools: [] })
    await page.reload()
    const refreshed = await api.inspect({ page })
    expect(refreshed.status).toBe('available')
    if (refreshed.status !== 'available') {
      throw new Error('Fixture rediscovery failed')
    }
    expect(refreshed.tools[0].toolId).not.toBe(first.tools[0].toolId)
    await page.evaluate('document.modelContext.getTools = () => Promise.reject(new Error("probe failed"))')
    const failed = await api.inspect({ page })
    expect(failed).toMatchObject({ status: 'unknown' })
    expect(failed).not.toHaveProperty('tools')
    await expect(api.call({ toolId: refreshed.tools[0].toolId, input: { query: 'old' } })).rejects.toThrow(
      'WEBMCP_STALE',
    )
    expect(await page.evaluate('window.calls')).toBe(0)
  })

  test('automatic summaries track navigation and tool removal without invoking tools or invalidating IDs', async () => {
    const listing = await api.list({ page })
    expect(await api.notifications({ pages: [page] })).toContain('lookup')
    expect(await page.evaluate('window.calls')).toBe(0)
    expect(await api.notifications({ pages: [page] })).toBeUndefined()
    expect(await api.call({ toolId: listing.tools[0].toolId, input: { query: 'preserved' } })).toEqual({
      status: 'returned',
      result: 'item:preserved',
    })
    await page.evaluate('window.controller.abort()')
    expect(await api.notifications({ pages: [page] })).toContain('"total":0')
    await page.evaluate('window.controller = new AbortController(); window.register()')
    expect(await api.notifications({ pages: [page] })).toContain('lookup')
    await page.reload()
    expect(await api.notifications({ pages: [page] })).toContain('lookup')
  })

  test('failed and stalled metadata discovery stay bounded and recover', async () => {
    await page.evaluate(`window.originalGetTools = document.modelContext.getTools;
      document.modelContext.getTools = () => Promise.reject(new Error('metadata unavailable'))`)
    expect(await api.notifications({ pages: [page] })).toBeUndefined()
    await page.evaluate(`window.probes = 0; document.modelContext.getTools = () => {
      window.probes++; return new Promise(resolve => { window.finishProbe = resolve });
    }`)
    const started = Date.now()
    expect(await api.notifications({ pages: [page] })).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(1500)
    expect(await api.notifications({ pages: [page] })).toBeUndefined()
    expect(await page.evaluate('window.probes')).toBe(1)
    await page.evaluate('window.finishProbe([]); document.modelContext.getTools = window.originalGetTools')
    expect(await api.notifications({ pages: [page] })).toContain('lookup')
    await page.evaluate('document.modelContext.getTools = () => new Promise(() => {})')
    expect(await api.notifications({ pages: [page] })).toBeUndefined()
    await page.reload()
    expect(await api.notifications({ pages: [page] })).toContain('lookup')
  })

  test('MCP tools share executor state, reject overlap after timeout and invalidate on reset', async () => {
    const mcp = await createMCPClient({ port })
    try {
      const opened = await mcp.client.callTool({
        name: 'execute',
        arguments: {
          code: `state.page = context.pages().find(p => p.url() === ${JSON.stringify(baseUrl)}); await state.page.goto(${JSON.stringify(baseUrl)}); console.log(await state.page.title())`,
        },
      })
      expect(opened.isError).not.toBe(true)
      expect(resultText(opened)).toContain('WebMCP tools changed')
      expect(resultText(opened)).toContain('lookup')
      expect(await page.evaluate('window.calls')).toBe(0)
      const unchanged = await mcp.client.callTool({
        name: 'execute',
        arguments: { code: 'console.log(await state.page.title())' },
      })
      expect(resultText(unchanged)).not.toContain('WebMCP tools changed')
      expect(
        (await mcp.client.listTools()).tools.map((tool) => {
          return tool.name
        }),
      ).toEqual(expect.arrayContaining(['list_webmcp_tools', 'execute_webmcp_tool']))
      const listing = await mcp.client.callTool({ name: 'list_webmcp_tools', arguments: { pageUrl: baseUrl } })
      expect(listing.isError).not.toBe(true)
      const toolId = outputJson(resultText(listing)).tools[0].toolId
      const result = await mcp.client.callTool({
        name: 'execute_webmcp_tool',
        arguments: { toolId, input: { query: 'mcp' } },
      })
      expect(outputJson(resultText(result))).toEqual({ status: 'returned', result: 'item:mcp' })
      const timeout = await mcp.client.callTool({
        name: 'execute_webmcp_tool',
        arguments: { toolId, input: { query: 'slow' }, timeout: 100 },
      })
      expect(timeout.isError).toBe(true)
      expect(resultText(timeout)).toContain('Outcome unknown')
      const overlap = await mcp.client.callTool({
        name: 'execute_webmcp_tool',
        arguments: { toolId, input: { query: 'should-not-run' } },
      })
      expect(overlap.isError).toBe(true)
      expect(resultText(overlap)).toContain('Session is busy')
      await page.waitForTimeout(800)
      expect(await page.evaluate('window.calls')).toBe(2)
      await mcp.client.callTool({ name: 'reset', arguments: {} })
      const stale = await mcp.client.callTool({ name: 'execute_webmcp_tool', arguments: { toolId, input: {} } })
      expect(stale.isError).toBe(true)
      expect(resultText(stale)).toContain('WEBMCP_STALE')
    } finally {
      await mcp.cleanup()
    }
  }, 60000)

  test('CLI list/call use the existing relay session and reject an unknown tool ID', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/cli/session/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: process.cwd() }),
    })
    expect(response.ok).toBe(true)
    const session = (await response.json()) as { id: string }
    const run = async (args: string[]) => {
      return await execFile(
        path.resolve('node_modules/.bin', process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node'),
        ['src/cli.ts', ...args, '-s', String(session.id), '--host', `http://127.0.0.1:${port}`],
        { env: { ...process.env, PLAYWRITER_PORT: String(port) }, timeout: 20000 },
      )
    }
    try {
      const opened = await run([
        '-e',
        `state.page = context.pages().find(p => p.url() === ${JSON.stringify(baseUrl)}); console.log(await state.page.title())`,
      ])
      expect(opened.stderr).toContain('WebMCP tools changed')
      expect(opened.stderr).toContain('lookup')
      expect(await page.evaluate('window.calls')).toBe(0)
      const listed = await run(['webmcp', 'list', '--page-url', baseUrl])
      expect(listed.stderr).not.toContain('WebMCP tools changed')
      const inspected = await run(['page', 'inspect', '--page-url', baseUrl])
      expect(outputJson(inspected.stdout).status).toBe('available')
      const toolId = outputJson(inspected.stdout).tools[0].toolId
      expect(toolId).not.toBe(outputJson(listed.stdout).tools[0].toolId)
      const called = await run(['webmcp', 'call', '--tool-id', toolId, '--input-json', '{"query":"cli"}'])
      expect(outputJson(called.stdout)).toEqual({ status: 'returned', result: 'item:cli' })
      await expect(run(['webmcp', 'call', '--tool-id', 'unknown:0', '--input-json', '{}'])).rejects.toThrow(
        'WEBMCP_STALE',
      )
    } finally {
      const deleted = await fetch(`http://127.0.0.1:${port}/cli/session/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      })
      expect(deleted.ok).toBe(true)
    }
  }, 60000)
})

test('command builder encodes page URLs and tool inputs as data', () => {
  expect(webMCPCode({ action: 'list', pageUrl: 'https://example.com/"; throw 1; //' })).toContain(
    JSON.stringify('https://example.com/"; throw 1; //'),
  )
  expect(webMCPCode({ action: 'call', toolId: 'x', input: { query: '"; throw 1; //' } })).toContain(
    JSON.stringify({ toolId: 'x', input: { query: '"; throw 1; //' } }),
  )
})
