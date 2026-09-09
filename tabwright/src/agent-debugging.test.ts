import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import childProcess from 'node:child_process'
import util from 'node:util'
import { chromium } from '@xmorse/playwright-core'
import { expect, test } from 'vitest'
import { getCDPSessionForPage } from './cdp-session.js'
import { Debugger } from './debugger.js'
import { Editor } from './editor.js'
import { NetworkInspector } from './network-inspector.js'
import { createDebuggingFixture, DEBUGGING_FIXTURE_SCRIPT } from './debugging-fixture.js'
import { cleanupTestContext, safeCloseCDPBrowser, setupTestContext } from './test-utils.js'
import { getCdpUrl } from './utils.js'

test('traces an incorrect order total from the UI through network evidence to paused source locals', async () => {
  const fixture = await createDebuggingFixture()
  const artifactRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(artifactRoot, { recursive: true })
  const artifactDir = fs.mkdtempSync(path.join(artifactRoot, 'agent-debugging-'))
  try {
    const testContext = await setupTestContext({
      port: 19982,
      tempDirPrefix: 'agent-debugging-profile-',
      toggleExtension: true,
    })
    try {
      // This browser connection goes through the real extension/relay, not the setup browser's direct CDP.
      const browser = await chromium.connectOverCDP(getCdpUrl({ port: 19982 }))
      try {
        const page = await browser.contexts()[0].newPage()
        const cdp = await getCDPSessionForPage({ page })
        const editor = new Editor({ cdp, cwd: artifactDir })
        const debuggerApi = new Debugger({ cdp })
        const network = new NetworkInspector({ cdp, maxEntries: 20 })
        try {
          await editor.enable()
          await debuggerApi.enable()
          await network.enable()
          await page.goto(fixture.baseUrl)
          await page.getByLabel('Discount').fill('5')
          await page.getByRole('button', { name: 'Load items' }).click()
          await expect
            .poll(
              async () => {
                return await page.locator('#result').textContent()
              },
              { timeout: 5000 },
            )
            .toBe('2 items, total 120')
          await expect
            .poll(
              () => {
                return network.list({ search: '/api/items' })[0]?.state
              },
              { timeout: 5000 },
            )
            .toBe('complete')
          const request = network.list({ search: '/api/items', method: 'GET', status: 200 })[0]
          expect(request).toBeDefined()
          const details = network.inspect({ requestId: request.requestId })
          expect(details?.responseHeaders?.['X-Auth-Token'] || details?.responseHeaders?.['x-auth-token']).toBe(
            '[redacted]',
          )
          const scriptUrl = new URL('/app.js', fixture.baseUrl).toString()
          const initiator = details?.initiator.callFrames.find((frame) => {
            return frame.url === scriptUrl
          })
          expect(initiator?.functionName).toBe('loadItems')
          expect(initiator?.lineNumber).toBe(2)
          const body = await network.responseBody({ requestId: request.requestId })
          expect(body.available).toBe(true)
          if (!body.available) {
            throw new Error(body.reason)
          }
          expect(body.base64Encoded).toBe(false)
          expect(body.truncated).toBe(false)
          expect(JSON.parse(body.body)).toEqual({
            items: [
              { id: 'book', price: 100 },
              { id: 'pen', price: 25 },
            ],
          })

          const source = await editor.readRaw({ url: scriptUrl })
          expect(source.content).toBe(DEBUGGING_FIXTURE_SCRIPT)
          const saved = await editor.saveRaw({ url: scriptUrl })
          const cached = await editor.saveRaw({ url: scriptUrl })
          expect(saved.sha256).toBe(crypto.createHash('sha256').update(DEBUGGING_FIXTURE_SCRIPT).digest('hex'))
          expect(cached).toEqual({ ...saved, cacheHit: true })
          expect(fs.readFileSync(saved.path, 'utf8')).toBe(DEBUGGING_FIXTURE_SCRIPT)

          const renderLine =
            source.content.split('\n').findIndex((line) => {
              return line.includes("document.getElementById('result')")
            }) + 1
          const breakpoint = await debuggerApi.setBreakpoint({ file: scriptUrl, line: renderLine })
          const click = page
            .getByRole('button', { name: 'Load items' })
            .click()
            .then(
              () => {
                return null
              },
              (error: unknown) => {
                return error
              },
            )
          try {
            await expect
              .poll(
                () => {
                  return debuggerApi.isPaused()
                },
                { timeout: 5000 },
              )
              .toBe(true)
            const location = await debuggerApi.getLocation()
            expect(location.lineNumber).toBe(renderLine)
            expect(location.sourceContext).toContain('const total =')
            expect(await debuggerApi.inspectLocalVariables()).toMatchObject({ discount: 5, total: 120 })
            expect((await debuggerApi.evaluate({ expression: 'total + discount' })).value).toBe(125)
            // Stopping Network inspection must not disable the Debugger owned by another helper.
            network.dispose()
            expect((await debuggerApi.evaluate({ expression: 'total' })).value).toBe(120)
          } finally {
            if (debuggerApi.isPaused()) {
              await debuggerApi.resume()
            }
            await debuggerApi.deleteBreakpoint({ breakpointId: breakpoint })
            const clickError = await click
            if (clickError) {
              throw new Error('Fixture button did not complete', { cause: clickError })
            }
          }
          await expect
            .poll(
              async () => {
                return await page.locator('#result').textContent()
              },
              { timeout: 5000 },
            )
            .toBe('2 items, total 120')
          await page.getByLabel('Discount').fill('0')
          await page.getByRole('button', { name: 'Load items' }).click()
          await expect
            .poll(
              async () => {
                return await page.locator('#result').textContent()
              },
              { timeout: 5000 },
            )
            .toBe('2 items, total 125')
          const activityResponse = await fetch('http://127.0.0.1:19982/activity/list')
          expect(activityResponse.status).toBe(410)

          const sessionResponse = await postRelay({ pathname: '/cli/session/new', body: { cwd: artifactDir } })
          expect(sessionResponse.ok).toBe(true)
          const { id: sessionId } = (await sessionResponse.json()) as { id: string }
          const execute = async ({ code, timeout = 10000 }: { code: string; timeout?: number }) => {
            const response = await postRelay({ pathname: '/cli/execute', body: { sessionId, code, timeout } })
            expect(response.ok).toBe(true)
            return (await response.json()) as { text: string; isError?: boolean }
          }
          const setup = await execute({
            code: `
            state.page = context.pages().find((p) => p.url() === ${JSON.stringify(page.url())});
            state.cdp = await getCDPSession({ page: state.page });
            state.network = createNetwork({ cdp: state.cdp });
            await state.network.enable();
          `,
          })
          expect(setup.isError).toBeFalsy()
          // The CLI file is an ordinary consumer: no Skill manifest or credential extraction.
          const scriptPath = path.join(artifactDir, 'authenticated-read.js')
          fs.writeFileSync(
            scriptPath,
            `
            const result = await state.page.evaluate(async () => {
              const response = await fetch('/api/session', { credentials: 'include' });
              return { status: response.status, payload: await response.json(), visibleCookies: document.cookie };
            });
            console.log(JSON.stringify({ ...result, recordingHelper: typeof replay }));
          `,
          )
          const anonymous = await fetch(new URL('/api/session', fixture.baseUrl))
          expect(anonymous.status).toBe(401)
          const { stdout } = await util.promisify(childProcess.execFile)(
            path.resolve('node_modules/.bin', process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node'),
            ['src/cli.ts', '--host', 'http://127.0.0.1:19982', '-s', sessionId, '-f', scriptPath],
            { timeout: 20000 },
          )
          expect(stdout).toContain('"authenticated":true')
          expect(stdout).toContain('"visibleCookies":""')
          expect(stdout).toContain('"recordingHelper":"undefined"')
          expect(stdout).not.toContain('fixture-only')
          const timedOut = await execute({
            code: `
            await state.page.evaluate(async () => {
              await new Promise((resolve) => setTimeout(resolve, 700));
              document.body.dataset.completed = 'once';
            });
          `,
            timeout: 100,
          })
          expect(timedOut.isError).toBe(true)
          expect(timedOut.text).toContain('Outcome unknown')
          const overlap = await execute({
            code: `await state.page.evaluate(() => { document.body.dataset.overlapped = 'yes' })`,
          })
          expect(overlap.isError).toBe(true)
          expect(overlap.text).toContain('Session is busy')
          const reset = await postRelay({ pathname: '/cli/reset', body: { sessionId } })
          expect(reset.ok).toBe(false)
          expect(await reset.text()).toContain('reset cannot cancel')
          await expect
            .poll(async () => {
              return await page.locator('body').getAttribute('data-completed')
            })
            .toBe('once')
          await expect
            .poll(async () => {
              const response = await fetch('http://127.0.0.1:19982/cli/sessions')
              const result = (await response.json()) as {
                sessions: Array<{ id: string; execution: { status: string } }>
              }
              return result.sessions.find((session) => {
                return session.id === sessionId
              })?.execution.status
            })
            .toBe('idle')
          expect(await page.locator('body').getAttribute('data-overlapped')).toBeNull()
          const recovered = await execute({
            code: `state.network.dispose(); console.log(await state.page.locator('body').getAttribute('data-completed'))`,
          })
          expect(recovered.isError).toBeFalsy()
          expect(recovered.text).toContain('once')
        } finally {
          network.dispose()
          if (debuggerApi.isPaused()) {
            await debuggerApi.resume()
          }
          await page.close()
        }
      } finally {
        await safeCloseCDPBrowser(browser)
      }
    } finally {
      await cleanupTestContext(testContext)
    }
  } finally {
    await fixture.close()
    fs.rmSync(artifactDir, { recursive: true, force: true })
  }
}, 60000)

async function postRelay({ pathname, body }: { pathname: string; body: Record<string, unknown> }): Promise<Response> {
  return await fetch(new URL(pathname, 'http://127.0.0.1:19982'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
