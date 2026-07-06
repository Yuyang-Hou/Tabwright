import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { cleanupTestContext, setupTestContext, type TestContext } from './test-utils.js'

const TEST_PORT = 19984

type StaticServer = {
  baseUrl: string
  close: () => Promise<void>
}

let testCtx: TestContext | null = null

function getExtensionDistRoot(): string {
  const candidates = [
    path.join(process.cwd(), 'extension', `dist-${TEST_PORT}`),
    path.resolve(process.cwd(), '..', 'extension', `dist-${TEST_PORT}`),
  ]
  const distRoot = candidates.find((candidate) => {
    return fs.existsSync(path.join(candidate, 'extension', 'src', 'options.html'))
  })
  if (!distRoot) {
    throw new Error(`Could not find extension dist for port ${TEST_PORT}`)
  }
  return distRoot
}

async function createStaticServer(rootDir: string): Promise<StaticServer> {
  const openSockets: Set<net.Socket> = new Set()
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const pathname = url.pathname === '/' ? '/extension/src/options.html' : url.pathname
    const filePath = path.resolve(rootDir, `.${pathname}`)

    if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404)
      res.end('not found')
      return
    }

    const contentType = filePath.endsWith('.js')
      ? 'text/javascript'
      : filePath.endsWith('.html')
        ? 'text/html'
        : 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(fs.readFileSync(filePath))
  })

  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => {
      openSockets.delete(socket)
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start static server')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      openSockets.forEach((socket) => {
        socket.destroy()
      })
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

describe('extension options page', () => {
  beforeAll(async () => {
    testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'options-page-test-' })
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx)
    testCtx = null
  })

  test('shows DOM replays and loads selected playback from the options page', async () => {
    if (!testCtx) {
      throw new Error('Test context is not initialized')
    }

    const distRoot = getExtensionDistRoot()
    const staticServer = await createStaticServer(distRoot)
    let replayEventsRequested = false
    const replay = {
      id: 'replay-options-smoke',
      path: '/Users/test/.playwriter/rrweb-recordings/replay-options-smoke.json',
      startedAt: Date.now() - 2000,
      savedAt: Date.now(),
      duration: 2000,
      size: 2048,
      eventCount: 2,
      tabId: 7,
      sessionId: 'pw-tab-options',
      url: 'https://example.com/materials/new',
    }
    const replayEvents = [
      {
        type: 4,
        timestamp: replay.startedAt,
        data: { href: replay.url, width: 1280, height: 720 },
      },
      {
        type: 2,
        timestamp: replay.startedAt + 100,
        data: { node: { id: 1, type: 0, childNodes: [] } },
      },
    ]

    const page = await testCtx.browserContext.newPage()
    try {
      await page.route(`http://127.0.0.1:${TEST_PORT}/**`, async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const corsHeaders = {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type',
        }

        if (request.method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: corsHeaders, body: '' })
          return
        }

        if (url.pathname === '/rrweb-recordings') {
          await route.fulfill({
            status: 200,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ recordings: [replay] }),
          })
          return
        }

        if (url.pathname === `/rrweb-recordings/${replay.id}/events`) {
          replayEventsRequested = true
          await route.fulfill({
            status: 200,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ recording: replay, events: replayEvents }),
          })
          return
        }

        await route.fulfill({ status: 404, headers: corsHeaders, body: 'not found' })
      })

      await page.goto(`${staticServer.baseUrl}/extension/src/options.html`)
      const recordingItem = page.locator('.recording-item').filter({ hasText: 'tab 7' })
      await recordingItem.waitFor({ timeout: 10000 })
      await expect.poll(async () => {
        return await recordingItem.textContent()
      }).toContain('2 events')
      await recordingItem.click()

      await expect.poll(() => {
        return replayEventsRequested
      }).toBe(true)
      await expect.poll(async () => {
        return await page.locator('#replay-details').textContent()
      }).toContain('replay-options-smoke')
    } finally {
      await page.close()
      await staticServer.close()
    }
  }, 30000)
})
