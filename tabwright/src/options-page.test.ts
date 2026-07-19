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
    return fs.existsSync(path.join(candidate, 'src', 'options.html'))
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
    const pathname = url.pathname === '/' ? '/src/options.html' : url.pathname
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
        : filePath.endsWith('.css')
          ? 'text/css'
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

  test.skip('shows DOM replays and loads selected playback from the options page', async () => {
    if (!testCtx) {
      throw new Error('Test context is not initialized')
    }

    const distRoot = getExtensionDistRoot()
    const staticServer = await createStaticServer(distRoot)
    let replayEventsRequested = false
    const replay = {
      id: 'replay-options-smoke',
      path: '/Users/test/.tabwright/rrweb-recordings/replay-options-smoke.json',
      startedAt: Date.now() - 2000,
      savedAt: Date.now(),
      duration: 2000,
      size: 2048,
      eventCount: 2,
      tabId: 7,
      sessionId: 'pw-tab-options',
      url: 'https://example.com/materials/new',
    }
    const recordings = Array.from({ length: 30 }, (_, index) => {
      return {
        ...replay,
        id: index === 0 ? replay.id : `replay-options-smoke-${index}`,
        path: index === 0 ? replay.path : `/Users/test/.tabwright/rrweb-recordings/replay-options-smoke-${index}.json`,
        startedAt: replay.startedAt - index * 1000,
        savedAt: replay.savedAt - index * 1000,
        tabId: replay.tabId + index,
      }
    })
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
      {
        type: 3,
        timestamp: replay.startedAt + 200,
        data: {
          source: 0,
          adds: [],
          removes: [],
          texts: [{ id: 404, value: 'missing node update' }],
          attributes: [],
        },
      },
      {
        type: 5,
        timestamp: replay.startedAt + 5000,
        data: { tag: 'end', payload: {} },
      },
    ]

    const page = await testCtx.browserContext.newPage()
    const missingNodeConsoleWarnings: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'warning' && message.text().includes('Node with id')) {
        missingNodeConsoleWarnings.push(message.text())
      }
    })
    await page.setViewportSize({ width: 1280, height: 720 })
    try {
      await testCtx.browserContext.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: staticServer.baseUrl,
      })
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
            body: JSON.stringify({ recordings }),
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

      await page.goto(`${staticServer.baseUrl}/src/options.html`)
      await page.locator('.language-button[data-language="en"]').click()
      const recordingItem = page.locator('.recording-item').first()
      await recordingItem.waitFor({ timeout: 10000 })
      await expect
        .poll(async () => {
          return await recordingItem.textContent()
        })
        .toContain('2 events')
      const replaysList = page.locator('#replays-list')
      await expect
        .poll(async () => {
          return await replaysList.evaluate((element) => {
            const list = element as unknown as { scrollHeight: number; clientHeight: number }
            return list.scrollHeight > list.clientHeight
          })
        })
        .toBe(true)
      await replaysList.evaluate((element) => {
        const list = element as unknown as { scrollHeight: number; scrollTop: number }
        list.scrollTop = list.scrollHeight
      })
      await expect
        .poll(async () => {
          return await replaysList.evaluate((element) => {
            const list = element as unknown as { scrollTop: number }
            return list.scrollTop > 0
          })
        })
        .toBe(true)
      await replaysList.evaluate((element) => {
        const list = element as unknown as { scrollTop: number }
        list.scrollTop = 0
      })
      await recordingItem.locator('.recording-select').click()

      await expect
        .poll(() => {
          return replayEventsRequested
        })
        .toBe(true)
      await expect
        .poll(async () => {
          return await page.locator('#status-text').textContent()
        })
        .toContain('Replay ready')
      await expect
        .poll(async () => {
          return await page.locator('#replay-controls').isVisible()
        })
        .toBe(true)
      await expect
        .poll(async () => {
          return await page.locator('#replay-play-toggle').textContent()
        })
        .toBe('Play')
      await expect
        .poll(async () => {
          return Number(await page.locator('#replay-timeline').inputValue())
        })
        .toBe(0)
      await page.locator('#replay-play-toggle').click()
      await expect
        .poll(async () => {
          return await page.locator('#replay-play-toggle').textContent()
        })
        .toBe('Pause')
      await expect
        .poll(async () => {
          return await page.locator('#replay-warning').textContent()
        })
        .toContain('1 DOM update')
      expect(missingNodeConsoleWarnings).toEqual([])
      await page.locator('#replay-play-toggle').click()
      await expect
        .poll(async () => {
          return await page.locator('#replay-play-toggle').textContent()
        })
        .toBe('Play')
      await expect
        .poll(async () => {
          return await page.locator('#replay-details').textContent()
        })
        .toContain('replay-options-smoke')
      await expect
        .poll(async () => {
          return await page.locator('#replay-details').textContent()
        })
        .toContain('https://example.com/materials/new')
      await recordingItem.getByRole('button', { name: 'Copy for AI' }).click()
      const replayContext = await page.evaluate(async () => {
        const clipboardNavigator = navigator as Navigator & {
          clipboard: { readText: () => Promise<string> }
        }
        return await clipboardNavigator.clipboard.readText()
      })
      expect(replayContext).toContain('Replay ID: replay-options-smoke')
      expect(replayContext).toContain(replay.path)
      await page.locator('#replay-player .replayer-wrapper').waitFor()
      await expect
        .poll(async () => {
          const playerBox = await page.locator('#replay-player').boundingBox()
          const wrapperBox = await page.locator('#replay-player .replayer-wrapper').boundingBox()
          if (!playerBox || !wrapperBox) {
            return false
          }
          return wrapperBox.width <= playerBox.width + 1 && wrapperBox.height <= playerBox.height + 1
        })
        .toBe(true)
    } finally {
      await testCtx.browserContext.clearPermissions()
      await page.close()
      await staticServer.close()
    }
  }, 30000)

  test('shows capabilities with clear status labels and focused actions', async () => {
    if (!testCtx) {
      throw new Error('Test context is not initialized')
    }

    const distRoot = getExtensionDistRoot()
    const staticServer = await createStaticServer(distRoot)
    const capabilityBase = {
      id: 'query-user',
      title: 'Query User',
      description: 'Look up a user by email.',
      status: 'trusted',
      runtime: 'browser',
      match: ['https://admin.example.com/users*'],
      routingHint: 'exact-match-direct-run',
      permissions: ['browser.read', 'browser.write'],
      sideEffect: 'write',
      requiresConfirmation: true,
      operations: {
        'read-user': {
          title: 'Read user',
          description: 'Reads the current user record.',
          permissions: ['browser.read'],
          sideEffect: 'read',
          requiresConfirmation: false,
        },
        'update-user': {
          title: 'Update user',
          description: 'Updates the user record.',
          permissions: ['browser.write'],
          sideEffect: 'write',
          requiresConfirmation: true,
        },
      },
      whenToUse: ['Use when the user asks to look up an admin user by email.'],
      whenNotToUse: ['Do not use for public profile lookup.'],
      tags: ['admin'],
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string' },
        },
        required: ['email'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
      location: 'project',
      dir: '/Users/test/project/.tabwright/capabilities/query-user',
      autonomousInvocation: {
        allowed: false,
        reasons: ['sideEffect is write', 'requires confirmation'],
      },
      recentRuns: [
        {
          id: 'run-1',
          operation: 'read-user',
          status: 'success',
          durationMs: 42,
          inputHash: 'abc',
          createdAt: '2026-07-07T00:00:00.000Z',
        },
      ],
    }
    const trustedNextCommand =
      'tabwright capability run query-user --browser user --input-json \'{"email":"from-contract@example.com"}\' --confirm query-user --json'
    const capability = {
      ...capabilityBase,
      location: 'skill',
      dir: '/Users/test/.codex/skills/query-user/runtime',
      sideEffect: 'mixed',
      agentSkill: {
        installations: [
          {
            manager: 'codex',
            scope: 'user',
            skillDir: '/Users/test/.codex/skills/query-user',
            runtimeDir: '/Users/test/.codex/skills/query-user/runtime',
          },
          {
            manager: 'claude',
            scope: 'user',
            skillDir: '/Users/test/.claude/skills/query-user',
            runtimeDir: '/Users/test/.claude/skills/query-user/runtime',
          },
        ],
        hasRuntimeConflict: false,
        localState: {
          stateDir: '/Users/test/.tabwright/capability-state/query-user',
          auth: {
            type: 'cookie',
            status: 'authenticated',
            canRefresh: true,
            refreshedAt: '2026-07-07T00:00:00.000Z',
          },
          artifactCount: 2,
        },
      },
      lifecycle: {
        stage: 'trusted',
        nextAction: 'run',
        nextCommand: trustedNextCommand,
        contractHealth: {
          state: 'healthy',
          checkedAt: '2026-07-07T00:00:00.000Z',
          reasons: [],
        },
      },
    }
    const driftedNextCommand = 'tabwright capability show drifted-user --json'
    const driftedCapability = {
      ...capabilityBase,
      id: 'drifted-user',
      title: 'Drifted User Query',
      status: 'draft',
      autonomousInvocation: {
        allowed: false,
        reasons: ['current contract failed conformance'],
      },
      lifecycle: {
        stage: 'drifted',
        nextAction: 'repair',
        nextCommand: driftedNextCommand,
        contractHealth: {
          state: 'drifted',
          checkedAt: '2026-07-08T00:00:00.000Z',
          reasons: ['output.userId must be string'],
        },
      },
    }
    const disabledCapability = {
      ...capabilityBase,
      id: 'legacy-disabled',
      title: 'Legacy Disabled',
      status: 'disabled',
      autonomousInvocation: {
        allowed: false,
        reasons: ['status is disabled'],
      },
    }
    const legacyTrustedCapability = {
      ...capabilityBase,
      id: 'legacy-trusted',
      title: 'Legacy Trusted',
      sideEffect: 'read',
      requiresConfirmation: false,
      autonomousInvocation: {
        allowed: true,
        reasons: [],
      },
    }
    const historicalTrustedNextCommand = "tabwright capability run historical-trusted --input-json '{}' --json"
    const historicalTrustedCapability = {
      ...legacyTrustedCapability,
      id: 'historical-trusted',
      title: 'Historical Trusted',
      lifecycle: {
        stage: 'trusted',
        nextAction: 'run',
        nextCommand: historicalTrustedNextCommand,
        contractHealth: {
          state: 'unknown',
          reasons: [],
        },
      },
    }
    const futureLifecycleCapability = {
      ...legacyTrustedCapability,
      id: 'future-lifecycle',
      title: 'Future Lifecycle',
      recentRuns: [{ status: 'future-run-format' }],
      lifecycle: {
        stage: 'reviewed',
        nextAction: 'approve',
        nextCommand: 'tabwright capability trust future-lifecycle',
        contractHealth: {
          state: 'future-health',
          reasons: [],
        },
      },
    }

    const page = await testCtx.browserContext.newPage()
    await page.setViewportSize({ width: 1280, height: 720 })
    page.setDefaultTimeout(10000)
    async function readClipboard(): Promise<string> {
      return await page.evaluate(async () => {
        const clipboardNavigator = navigator as Navigator & {
          clipboard: { readText: () => Promise<string> }
        }
        return await clipboardNavigator.clipboard.readText()
      })
    }
    async function copyTechnicalCommand(): Promise<string> {
      const details = page.locator('.advanced-details')
      const copy = details.getByRole('button', { name: /Copy command|复制命令/ })
      if (!(await copy.isVisible())) {
        await details.locator('summary').click()
      }
      await copy.click()
      return await readClipboard()
    }
    try {
      await testCtx.browserContext.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: staticServer.baseUrl,
      })
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
            body: JSON.stringify({ recordings: [] }),
          })
          return
        }

        if (url.pathname === '/capabilities') {
          await route.fulfill({
            status: 200,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({
              cwd: '/Users/test/project',
              capabilities: [
                capability,
                driftedCapability,
                disabledCapability,
                legacyTrustedCapability,
                historicalTrustedCapability,
                futureLifecycleCapability,
              ],
            }),
          })
          return
        }

        await route.fulfill({ status: 404, headers: corsHeaders, body: 'not found' })
      })

      await page.goto(`${staticServer.baseUrl}/src/options.html`, { waitUntil: 'domcontentloaded' })
      await page.locator('.language-button[data-language="en"]').click()
      expect(await page.locator('.tab-button').count()).toBe(0)
      expect(await page.locator('#recordings-view').count()).toBe(0)
      const capabilityItem = page.locator('.skill-item').filter({ hasText: 'Query User' })
      await capabilityItem.waitFor({ timeout: 10000 })
      expect(await page.locator('#status-text').textContent()).toBe('Local service ready')
      expect(await capabilityItem.textContent()).toContain('Codex')
      expect(await capabilityItem.textContent()).toContain('Claude')
      await capabilityItem.click()

      await expect
        .poll(async () => {
          return await page.locator('#skill-detail').textContent()
        })
        .toContain('query-user')
      expect(await page.locator('#skills-summary').textContent()).toContain('6 Skills')
      expect(await page.locator('.overview-item').count()).toBe(3)
      expect(await page.locator('.capability-overview').textContent()).toContain('Installed from')
      expect(await page.locator('.capability-overview').textContent()).toContain('Saved results')
      expect(await capabilityItem.textContent()).toContain('Reads and modifies data')
      expect(await page.locator('#skill-detail').textContent()).toContain('Read user')
      expect(await page.locator('#skill-detail').textContent()).toContain('Update user')
      expect(await page.locator('#skill-detail').textContent()).toContain('Recent activity')
      expect(await page.locator('#skill-detail').textContent()).toContain('/Users/test/.codex/skills/query-user')
      const technicalDetails = page.locator('.advanced-details')
      await technicalDetails.locator('summary').click()
      expect(await technicalDetails.textContent()).toContain('Ready')
      expect(await page.locator('#skill-detail').textContent()).toContain('2 files')
      expect(await technicalDetails.textContent()).toContain('/Users/test/.tabwright/capability-state/query-user')
      expect(await technicalDetails.textContent()).not.toContain('CLI command')
      expect(await technicalDetails.textContent()).not.toContain('Routing')
      expect(await page.locator('.lifecycle-card').count()).toBe(0)
      expect(await page.locator('.auth-card').count()).toBe(0)
      expect(await page.locator('.advanced-details').textContent()).toContain('Validation status')
      expect(await page.locator('.advanced-details').textContent()).toContain('Contract healthy')
      await page.getByRole('button', { name: 'Copy diagnostic details' }).click()
      const aiContext = await readClipboard()
      expect(aiContext).toContain('Capability ID: query-user')
      expect(aiContext).toContain('Look up a user by email.')
      expect(aiContext).toContain('/Users/test/.codex/skills/query-user')
      expect(aiContext).toContain('/Users/test/.tabwright/capability-state/query-user')

      await page.locator('.skill-item').filter({ hasText: 'Drifted User Query' }).click()
      await expect
        .poll(async () => {
          return await page.locator('#skill-detail').textContent()
        })
        .toContain('Needs attention')
      await expect
        .poll(async () => {
          return await page.locator('.advanced-details').textContent()
        })
        .toContain('output.userId must be string')
      expect(await copyTechnicalCommand()).toBe(driftedNextCommand)

      await page.locator('.skill-item').filter({ hasText: 'Legacy Disabled' }).click()
      await expect
        .poll(async () => {
          return await page.locator('#skill-detail').textContent()
        })
        .toContain('Disabled')
      expect(await copyTechnicalCommand()).toBe("tabwright capability draft 'legacy-disabled'")

      await page.locator('.skill-item').filter({ hasText: 'Legacy Trusted' }).click()
      expect(await copyTechnicalCommand()).toContain("tabwright capability run 'legacy-trusted'")
      expect(await page.locator('.advanced-details').textContent()).toContain('Not yet checked for usability')

      await page.locator('.skill-item').filter({ hasText: 'Historical Trusted' }).click()
      expect(await copyTechnicalCommand()).toBe(historicalTrustedNextCommand)
      expect(await page.locator('.advanced-details').textContent()).toContain('Not yet checked for usability')

      await page.locator('.skill-item').filter({ hasText: 'Future Lifecycle' }).click()
      await expect
        .poll(async () => {
          return await page.locator('.advanced-details').textContent()
        })
        .toContain('This extension cannot interpret the capability lifecycle')
      await expect
        .poll(async () => {
          return await page.locator('#skill-detail').textContent()
        })
        .not.toContain('future-run-format')
      expect(await copyTechnicalCommand()).toBe("tabwright capability describe 'future-lifecycle' --json")

      await page.locator('.skill-item').filter({ hasText: 'Drifted User Query' }).click()
      await page.locator('.language-button[data-language="zh_CN"]').click()
      await expect
        .poll(async () => {
          return await page.locator('#skill-detail').textContent()
        })
        .toContain('需处理')
      expect(await copyTechnicalCommand()).toBe(driftedNextCommand)
      expect(await page.locator('.advanced-details').textContent()).toContain('配置发生变化 · 检查于')
      expect(await page.locator('.advanced-details').textContent()).toContain('CLI 命令')
      await page.locator('#status-filter').selectOption('attention')
      expect(await page.locator('.skill-item').count()).toBe(2)
      expect(await page.locator('#status-filter').inputValue()).toBe('attention')
    } finally {
      await testCtx.browserContext.clearPermissions()
      await page.close()
      await staticServer.close()
    }
  }, 30000)

  test('shows a persistent degraded warning for stale relay review endpoints and clears it after recovery', async () => {
    if (!testCtx) {
      throw new Error('Test context is not initialized')
    }

    const distRoot = getExtensionDistRoot()
    const staticServer = await createStaticServer(distRoot)
    let reviewEndpointsAvailable = false
    const page = await testCtx.browserContext.newPage()
    page.setDefaultTimeout(10000)
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

        if (!reviewEndpointsAvailable) {
          await route.fulfill({ status: 404, headers: corsHeaders, body: 'not found' })
          return
        }

        if (url.pathname === '/rrweb-recordings') {
          await route.fulfill({
            status: 200,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ recordings: [] }),
          })
          return
        }

        if (url.pathname === '/capabilities') {
          await route.fulfill({
            status: 200,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ cwd: '/Users/test/project', capabilities: [] }),
          })
          return
        }

        await route.fulfill({ status: 404, headers: corsHeaders, body: 'not found' })
      })

      await page.goto(`${staticServer.baseUrl}/src/options.html`, { waitUntil: 'domcontentloaded' })
      await expect
        .poll(async () => {
          return await page.locator('#relay-review-warning').isVisible()
        })
        .toBe(true)
      await page.locator('.language-button[data-language="en"]').click()
      await expect
        .poll(async () => {
          return await page.locator('#relay-review-warning').textContent()
        })
        .toContain('Your files were not deleted')
      await expect
        .poll(async () => {
          return await page.locator('#relay-review-warning').isVisible()
        })
        .toBe(true)

      reviewEndpointsAvailable = true
      await page.locator('#refresh-button').click()
      await expect
        .poll(async () => {
          return await page.locator('#skills-summary').textContent()
        })
        .toBe('0 Skills · 0 ready · 0 need attention')
      await expect
        .poll(async () => {
          return await page.locator('#relay-review-warning').isVisible()
        })
        .toBe(false)
    } finally {
      await page.close()
      await staticServer.close()
    }
  }, 30000)

  test('shows the running and required versions when the local service is outdated', async () => {
    if (!testCtx) {
      throw new Error('Test context is not initialized')
    }

    const distRoot = getExtensionDistRoot()
    const staticServer = await createStaticServer(distRoot)
    const page = await testCtx.browserContext.newPage()
    try {
      await page.route(`http://127.0.0.1:${TEST_PORT}/**`, async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const headers = {
          'access-control-allow-origin': '*',
          'content-type': 'application/json',
        }

        if (url.pathname === '/version') {
          await route.fulfill({ status: 200, headers, body: JSON.stringify({ version: '1.0.0' }) })
          return
        }
        if (url.pathname === '/rrweb-recordings') {
          await route.fulfill({ status: 200, headers, body: JSON.stringify({ recordings: [] }) })
          return
        }
        await route.fulfill({ status: 404, headers, body: '{}' })
      })

      await page.goto(`${staticServer.baseUrl}/src/options.html`, { waitUntil: 'domcontentloaded' })
      await page.locator('.language-button[data-language="zh_CN"]').click()
      await expect
        .poll(async () => {
          return await page.locator('#relay-review-warning-title').textContent()
        })
        .toMatch(/^本地服务需要更新，当前版本 1\.0\.0，需要 \d+\.\d+\.\d+。$/)
      expect(await page.locator('#relay-review-warning-text').textContent()).toBe(
        '在终端运行以下命令，完成后刷新页面。',
      )
      expect(await page.locator('#relay-review-warning-command').textContent()).toContain(
        'npm install -g tabwright@latest',
      )
      expect(await page.locator('#relay-review-warning-command').textContent()).toContain('tabwright session list')
    } finally {
      await page.close()
      await staticServer.close()
    }
  }, 30000)
})
