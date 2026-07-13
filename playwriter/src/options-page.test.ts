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
    const recordings = Array.from({ length: 30 }, (_, index) => {
      return {
        ...replay,
        id: index === 0 ? replay.id : `replay-options-smoke-${index}`,
        path: index === 0 ? replay.path : `/Users/test/.playwriter/rrweb-recordings/replay-options-smoke-${index}.json`,
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
      const recordingItem = page.locator('.recording-item').filter({ hasText: 'tab 7' })
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
      await recordingItem.click()

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
        .toContain('--browser user')
      await expect
        .poll(async () => {
          return await page.locator('#replay-details').textContent()
        })
        .toContain('--confirm')
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
      await page.close()
      await staticServer.close()
    }
  }, 30000)

  test('shows capabilities and AI prompt actions from the options page', async () => {
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
      dir: '/Users/test/project/.playwriter/capabilities/query-user',
      autonomousInvocation: {
        allowed: false,
        reasons: ['sideEffect is write', 'requires confirmation'],
      },
      recentRuns: [
        {
          id: 'run-1',
          status: 'success',
          durationMs: 42,
          inputHash: 'abc',
          createdAt: '2026-07-07T00:00:00.000Z',
        },
      ],
      agentSkill: {
        target: 'codex',
        draftExists: true,
        draftPath: '/Users/test/project/.playwriter/capabilities/query-user/agent-skills/codex/SKILL.md',
        installedExists: false,
        installedPath: '/Users/test/.codex/skills/query-user/SKILL.md',
        initCommand: 'playwriter capability skill init query-user',
        showCommand: 'playwriter capability skill show query-user',
        installCommand: 'playwriter capability skill install query-user',
      },
    }
    const trustedNextCommand =
      'playwriter capability run query-user --browser user --input-json \'{"email":"from-contract@example.com"}\' --confirm query-user --json'
    const capability = {
      ...capabilityBase,
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
    const driftedNextCommand = 'playwriter capability show drifted-user --json'
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
    const historicalTrustedNextCommand = "playwriter capability run historical-trusted --input-json '{}' --json"
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
        nextCommand: 'playwriter capability trust future-lifecycle',
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
      const skillsTab = page.locator('.tab-button[data-tab="skills"]')
      await skillsTab.waitFor()
      await skillsTab.click()
      const capabilityItem = page.locator('.skill-item').filter({ hasText: 'Query User' })
      await capabilityItem.waitFor({ timeout: 10000 })
      await capabilityItem.click()

      await expect
        .poll(async () => {
          return await page.locator('#skill-detail').textContent()
        })
        .toContain('query-user')
      await expect
        .poll(async () => {
          return await page.locator('#skill-detail').textContent()
        })
        .toContain('Copy edit prompt')
      await expect
        .poll(async () => {
          return await page.locator('#skill-detail').textContent()
        })
        .toContain('email: string')
      await expect
        .poll(async () => {
          return await page.locator('.lifecycle-card').textContent()
        })
        .toContain('Contract healthy')
      await page.getByRole('button', { name: 'Copy approved run' }).click()
      const runCommand = await readClipboard()
      expect(runCommand).toBe(trustedNextCommand)
      await page.getByRole('button', { name: 'Copy use prompt' }).click()
      const usePrompt = await readClipboard()
      expect(usePrompt).toContain('Stop and ask for my explicit approval')
      expect(usePrompt).toContain(trustedNextCommand)

      await page.locator('.skill-item').filter({ hasText: 'Drifted User Query' }).click()
      await expect
        .poll(async () => {
          return await page.locator('.lifecycle-card').textContent()
        })
        .toContain('Repair contract drift')
      await expect
        .poll(async () => {
          return await page.locator('.lifecycle-card').textContent()
        })
        .toContain('output.userId must be string')
      expect(await page.getByRole('button', { name: 'Copy approved run' }).count()).toBe(0)
      await page.locator('.lifecycle-card').getByRole('button', { name: 'Copy next step' }).click()
      expect(await readClipboard()).toBe(driftedNextCommand)
      await page.getByRole('button', { name: 'Copy use prompt' }).click()
      expect(await readClipboard()).toContain('Do not run the capability as a normal task until it reaches Trusted')

      await page.locator('.skill-item').filter({ hasText: 'Legacy Disabled' }).click()
      await expect
        .poll(async () => {
          return await page.locator('.lifecycle-card').textContent()
        })
        .toContain('Enable as draft')
      await page.locator('.lifecycle-card').getByRole('button', { name: 'Copy next step' }).click()
      expect(await readClipboard()).toBe("playwriter capability draft 'legacy-disabled'")

      await page.locator('.skill-item').filter({ hasText: 'Legacy Trusted' }).click()
      await expect
        .poll(async () => {
          return await page.locator('.lifecycle-card').textContent()
        })
        .toContain('Contract not validated')
      await page.getByRole('button', { name: 'Copy run' }).click()
      expect(await readClipboard()).toContain("playwriter capability run 'legacy-trusted'")

      await page.locator('.skill-item').filter({ hasText: 'Historical Trusted' }).click()
      await expect
        .poll(async () => {
          return await page.locator('.lifecycle-card').textContent()
        })
        .toContain('Contract not validated')
      await page.getByRole('button', { name: 'Copy run' }).click()
      expect(await readClipboard()).toBe(historicalTrustedNextCommand)

      await page.locator('.skill-item').filter({ hasText: 'Future Lifecycle' }).click()
      await expect
        .poll(async () => {
          return await page.locator('.lifecycle-card').textContent()
        })
        .toContain('This extension cannot interpret the capability lifecycle')
      await expect
        .poll(async () => {
          return await page.locator('#skill-detail').textContent()
        })
        .not.toContain('future-run-format')
      expect(await page.getByRole('button', { name: 'Copy run' }).count()).toBe(0)
      await page.locator('.lifecycle-card').getByRole('button', { name: 'Copy next step' }).click()
      expect(await readClipboard()).toBe("playwriter capability describe 'future-lifecycle' --json")

      await page.locator('.skill-item').filter({ hasText: 'Drifted User Query' }).click()
      await page.locator('.language-button[data-language="zh_CN"]').click()
      await expect
        .poll(async () => {
          return await page.locator('.lifecycle-card').textContent()
        })
        .toContain('下一步：修复契约漂移')
      await expect
        .poll(async () => {
          return await page.locator('.lifecycle-card').textContent()
        })
        .toContain('检测到契约漂移 · 检查于')
      expect(await page.locator('.lifecycle-card').textContent()).not.toContain('$action$')
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
      await page.locator('.language-button[data-language="en"]').click()
      await expect
        .poll(async () => {
          return await page.locator('#relay-review-warning').isVisible()
        })
        .toBe(true)
      await expect
        .poll(async () => {
          return await page.locator('#relay-review-warning').textContent()
        })
        .toContain('Your files were not deleted')
      await expect
        .poll(async () => {
          return await page.locator('#recordings-count').textContent()
        })
        .toBe('–')

      await page.locator('.tab-button[data-tab="skills"]').click()
      await expect
        .poll(async () => {
          return await page.locator('#skills-count').textContent()
        })
        .toBe('–')
      await expect
        .poll(async () => {
          return await page.locator('#relay-review-warning').isVisible()
        })
        .toBe(true)

      reviewEndpointsAvailable = true
      await page.locator('#refresh-button').click()
      await expect
        .poll(async () => {
          return await page.locator('#skills-count').textContent()
        })
        .toBe('0')
      await expect
        .poll(async () => {
          return await page.locator('#relay-review-warning').isVisible()
        })
        .toBe(true)

      await page.locator('.tab-button[data-tab="recordings"]').click()
      await page.locator('#refresh-button').click()
      await expect
        .poll(async () => {
          return await page.locator('#recordings-count').textContent()
        })
        .toBe('0')
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
})
