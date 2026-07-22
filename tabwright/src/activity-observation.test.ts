import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  cleanupTestContext,
  getExtensionServiceWorker,
  setupTestContext,
  type TestContext,
} from './test-utils.js'

const TEST_PORT = 19983
const execFileAsync = promisify(execFile)
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const viteNodeBinary = path.resolve(
  currentDir,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node',
)
const cliPath = path.join(currentDir, 'cli.ts')

type TestServer = {
  url: string
  close: () => Promise<void>
}

let testCtx: TestContext | null = null
let testServer: TestServer | null = null
let previousHome: string | undefined
let testHome: string | null = null

async function createTestServer(): Promise<TestServer> {
  const sockets: Set<net.Socket> = new Set()
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(`<!doctype html>
      <html>
        <body>
          <label>Name <input aria-label="Name" /></label>
          <button type="button">Save</button>
          <button type="button">Continue</button>
        </body>
      </html>`)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Activity test server did not start')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      sockets.forEach((socket) => {
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

async function activityRequest(options: { pathname: string; body?: Record<string, unknown> }): Promise<Response> {
  return await fetch(`http://127.0.0.1:${TEST_PORT}${options.pathname}`, {
    method: options.body ? 'POST' : 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
}

async function runActivityCli(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(viteNodeBinary, [cliPath, ...args], {
    cwd: path.resolve(currentDir, '..'),
    env: { ...process.env },
  })
  return stdout
}

describe('attached activity observation', () => {
  beforeAll(async () => {
    previousHome = process.env.HOME
    const tempRoot = path.join(process.cwd(), 'tmp')
    fs.mkdirSync(tempRoot, { recursive: true })
    testHome = fs.mkdtempSync(path.join(tempRoot, 'activity-observation-home-'))
    testServer = await createTestServer()
    testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'activity-observation-' })
    process.env.HOME = testHome
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx)
    await testServer?.close()
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
    if (testHome) {
      fs.rmSync(testHome, { recursive: true, force: true })
    }
    testCtx = null
    testServer = null
    testHome = null
  })

  test('lets an Agent save a recent event segment while observation continues', async () => {
    if (!testCtx || !testServer) {
      throw new Error('Activity observation test is not initialized')
    }
    const page = await testCtx.browserContext.newPage()
    await page.goto(testServer.url)
    await page.bringToFront()
    const serviceWorker = await getExtensionServiceWorker(testCtx.browserContext)
    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    const activities = await expect
      .poll(
        async () => {
          const response = await activityRequest({ pathname: '/activity/list' })
          const result = (await response.json()) as { activities: Array<{ sessionId?: string }> }
          return result.activities
        },
        { timeout: 15000 },
      )
      .toHaveLength(1)
    void activities

    await page.getByRole('textbox', { name: 'Name' }).fill('Ada')
    await page.getByRole('button', { name: 'Save' }).click()

    const inspection = JSON.parse(
      await runActivityCli([
        'activity',
        'inspect',
        '--host',
        `http://127.0.0.1:${TEST_PORT}`,
        '--last',
        '1m',
        '--json',
      ]),
    ) as {
      activity: { selectionStart: number; selectionEnd: number }
      timeline: { actions: Array<{ label: string }> }
    }
    expect(inspection.timeline.actions.map((action) => action.label)).toEqual(expect.arrayContaining(['Name', 'Save']))

    const saved = JSON.parse(
      await runActivityCli([
        'activity',
        'save',
        '--host',
        `http://127.0.0.1:${TEST_PORT}`,
        '--from',
        String(inspection.activity.selectionStart),
        '--to',
        String(inspection.activity.selectionEnd),
        '--json',
      ]),
    ) as {
      observing: boolean
      replay: { id: string; selectionStart: number; selectionEnd: number }
    }
    expect(saved.observing).toBe(true)
    expect(saved.replay.id).toBeTruthy()
    expect(saved.replay.selectionStart).toBe(inspection.activity.selectionStart)

    await page.getByRole('button', { name: 'Continue' }).click()
    const continuedInspection = await expect
      .poll(
        async () => {
          const response = await activityRequest({ pathname: '/activity/inspect', body: { lastMs: 60_000 } })
          return (await response.json()) as { timeline: { actions: Array<{ label: string }> } }
        },
        { timeout: 10000 },
      )
      .toMatchObject({ timeline: { actions: expect.arrayContaining([expect.objectContaining({ label: 'Continue' })]) } })
    void continuedInspection
  }, 60000)
})
