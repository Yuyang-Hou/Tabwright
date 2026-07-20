import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { chromium, type Browser, type Page } from '@xmorse/playwright-core'
import { readCapabilityScript } from './capability-registry.js'
import { saveWorkflowFromRecording } from './workflow-capability.js'

type SubmittedMaterial = {
  title: string
  publishDate: string
  slug: string
  clientValidated: boolean
  generatedMonth: string
}

type MaterialRequest = {
  method: string
  headers: Record<string, string | string[] | undefined>
  body: SubmittedMaterial
}

type MaterialServer = {
  baseUrl: string
  getRequests: () => MaterialRequest[]
  close: () => Promise<void>
}

type SnapshotFunction = (options: { page: Page }) => Promise<string>

type RecordingApi = {
  start: () => Promise<unknown>
  stop: () => Promise<unknown>
}

type WorkflowItemResult = {
  status: string
  reason?: string
  phase?: string
  step?: Record<string, unknown>
  context?: {
    url?: string
    title?: string
    snapshot?: string
  }
  finalRequest?: {
    method: string
    url: string
    postData?: string | null
    responseStatus?: number
  }
}

type WorkflowRunResult = {
  status: 'completed' | 'failed' | 'needs_ai' | 'needs_human'
  total: number
  completed: number
  failed: number
  needsAi: WorkflowItemResult | null
  needsHuman: WorkflowItemResult | null
  results: WorkflowItemResult[]
}

type GeneratedWorkflowRunner = (
  page: Page,
  input: unknown,
  snapshot: SnapshotFunction,
  recording: RecordingApi,
) => Promise<WorkflowRunResult>

let browser: Browser | null = null

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

function getLocalChromeExecutable(): string | undefined {
  const candidates = [
    process.env.PLAYWRITER_TEST_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((candidate): candidate is string => {
    return Boolean(candidate)
  })

  return candidates.find((candidate) => {
    return fs.existsSync(candidate)
  })
}

function parseMaterialBody(body: string): SubmittedMaterial {
  const parsed = JSON.parse(body) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid material request body')
  }
  const candidate = parsed as Partial<SubmittedMaterial>
  if (
    typeof candidate.title !== 'string' ||
    typeof candidate.publishDate !== 'string' ||
    typeof candidate.slug !== 'string' ||
    typeof candidate.clientValidated !== 'boolean' ||
    typeof candidate.generatedMonth !== 'string'
  ) {
    throw new Error('Invalid material request body')
  }
  return {
    title: candidate.title,
    publishDate: candidate.publishDate,
    slug: candidate.slug,
    clientValidated: candidate.clientValidated,
    generatedMonth: candidate.generatedMonth,
  }
}

async function createMaterialServer(): Promise<MaterialServer> {
  const requests: MaterialRequest[] = []
  const openSockets: Set<net.Socket> = new Set()

  const server = http.createServer((req, res) => {
    if (req.url === '/materials/new') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Generated Workflow Form</title>
  </head>
  <body>
    <form id="material-form">
      <label>
        Title
        <input id="title" name="title" aria-label="Title" required />
      </label>
      <label>
        Publish date
        <input id="publish-date" name="publishDate" aria-label="Publish date" type="date" required />
      </label>
      <button type="submit">Publish</button>
    </form>
    <script>
      const form = document.getElementById('material-form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const title = document.getElementById('title').value.trim();
        const publishDate = document.getElementById('publish-date').value;
        if (!title || !publishDate) {
          window.__formError = 'frontend-validation-failed';
          return;
        }
        const payload = {
          title,
          publishDate,
          slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          clientValidated: true,
          generatedMonth: publishDate.slice(0, 7),
        };
        window.__preparedPayload = payload;
        const response = await fetch('/api/materials', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-form-case': 'generated-workflow' },
          body: JSON.stringify(payload),
        });
        window.__lastResponse = await response.json();
      });
    </script>
  </body>
</html>`)
      return
    }

    if (req.url === '/api/materials' && req.method === 'POST') {
      if (req.headers['x-form-case'] !== 'generated-workflow') {
        res.writeHead(406, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'frontend-verification-required' }))
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf-8')
        requests.push({
          method: req.method || '',
          headers: req.headers,
          body: parseMaterialBody(rawBody),
        })
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, requestCount: requests.length }))
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
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
    throw new Error('Failed to start material server')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    getRequests: () => {
      return [...requests]
    },
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

function createRunner(script: string): GeneratedWorkflowRunner {
  const runner = new Function(
    'page',
    'input',
    'snapshot',
    'recording',
    `return (async () => {\n${script}\n})()`,
  )
  return runner as unknown as GeneratedWorkflowRunner
}

const snapshotBodyText: SnapshotFunction = async ({ page }) => {
  return await page.locator('body').innerText()
}

const recordingApi: RecordingApi = {
  start: async () => {
    return { id: 'test-recording-started' }
  },
  stop: async () => {
    return { id: 'test-recording-stopped' }
  },
}

describe('recording-generated workflow scripts', () => {
  afterEach(async () => {
    if (browser) {
      await browser.close()
      browser = null
    }
  })

  test('runs batch form work and hands control back to AI on page drift', async () => {
    const cwd = createTempDir('workflow-script-flow-')
    const materialServer = await createMaterialServer()
    const chromeExecutable = getLocalChromeExecutable()
    browser = await chromium.launch(
      chromeExecutable ? { executablePath: chromeExecutable, headless: true } : { channel: 'chromium', headless: true },
    )
    const page = await browser.newPage()

    try {
      const directResponse = await fetch(`${materialServer.baseUrl}/api/materials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'direct-call',
          publishDate: '2026-07-05',
          slug: 'direct-call',
          clientValidated: true,
          generatedMonth: '2026-07',
        }),
      })
      expect(directResponse.status).toBe(406)

      const saved = saveWorkflowFromRecording({
        id: 'generated-material-flow',
        title: 'Generated Material Flow',
        description: 'Fill the material form from recording evidence and submit the frontend-generated request.',
        cwd,
        recordingId: '2026-07-05T09-40-58-371Z-0cb7c28e',
        steps: [
          { action: 'goto', url: { value: `${materialServer.baseUrl}/materials/new` } },
          { action: 'fill', locator: '#title', value: { inputPath: 'title' } },
          { action: 'fill', locator: '#publish-date', value: { inputPath: 'publishDate' } },
        ],
        finalRequest: {
          url: `${materialServer.baseUrl}/api/materials`,
          method: 'POST',
          title: 'Publish material',
          trigger: { action: 'click', locator: 'button[type="submit"]' },
        },
      })
      const script = readCapabilityScript({ id: 'generated-material-flow', cwd })
      expect(saved.script).toBe(script)
      expect(script).toContain('needs_ai')
      expect(script).not.toContain('approval.captureAndSubmit')
      expect(script).not.toContain('taskQueue.run')

      const runner = createRunner(script)
      const result = await runner(
        page,
        {
          items: [
            { title: 'test2', publishDate: '2026-07-06' },
            { title: 'test3', publishDate: '2026-07-07' },
          ],
        },
        snapshotBodyText,
        recordingApi,
      )

      expect(result).toMatchObject({
        status: 'completed',
        total: 2,
        completed: 2,
        failed: 0,
        needsAi: null,
      })
      expect(materialServer.getRequests().map((request) => {
        return request.body
      })).toEqual([
        {
          title: 'test2',
          publishDate: '2026-07-06',
          slug: 'test2',
          clientValidated: true,
          generatedMonth: '2026-07',
        },
        {
          title: 'test3',
          publishDate: '2026-07-07',
          slug: 'test3',
          clientValidated: true,
          generatedMonth: '2026-07',
        },
      ])
      expect(result.results[0]?.finalRequest?.postData).toContain('"title":"test2"')
      expect(result.results[1]?.finalRequest?.responseStatus).toBe(201)

      saveWorkflowFromRecording({
        id: 'generated-material-flow-drift',
        title: 'Generated Material Flow Drift',
        cwd,
        recordingId: '2026-07-05T09-40-58-371Z-0cb7c28e',
        steps: [
          { action: 'goto', url: { value: `${materialServer.baseUrl}/materials/new` } },
          { action: 'fill', locator: '#title', value: { inputPath: 'title' } },
          { action: 'fill', locator: '#publish-date', value: { inputPath: 'publishDate' } },
        ],
        finalRequest: {
          url: `${materialServer.baseUrl}/api/materials`,
          method: 'POST',
          trigger: { action: 'click', locator: 'button[data-missing="submit"]' },
        },
      })
      const driftRunner = createRunner(readCapabilityScript({ id: 'generated-material-flow-drift', cwd }))
      const driftResult = await driftRunner(
        page,
        { items: [{ title: 'test4', publishDate: '2026-07-08' }] },
        snapshotBodyText,
        recordingApi,
      )

      expect(driftResult.status).toBe('needs_ai')
      expect(driftResult.completed).toBe(0)
      expect(driftResult.needsAi).toMatchObject({
        status: 'needs_ai',
        phase: 'final-request',
        reason: 'Expected locator was not found on the live page.',
        step: { locator: 'button[data-missing="submit"]' },
      })
      expect(driftResult.needsAi?.context?.snapshot).toContain('Publish')
      expect(materialServer.getRequests()).toHaveLength(2)

      await page.setContent('<main><h1>安全验证</h1><div id="captcha">请完成滑块验证</div></main>')
      saveWorkflowFromRecording({
        id: 'generated-material-flow-challenge',
        title: 'Generated Material Flow Challenge',
        cwd,
        recordingId: '2026-07-05T09-40-58-371Z-0cb7c28e',
        steps: [],
        finalRequest: {
          url: `${materialServer.baseUrl}/api/materials`,
          method: 'POST',
          trigger: { action: 'click', locator: 'button[type="submit"]' },
        },
      })
      const challengeRunner = createRunner(
        readCapabilityScript({ id: 'generated-material-flow-challenge', cwd }),
      )
      const challengeResult = await challengeRunner(page, { title: 'test5' }, snapshotBodyText, recordingApi)

      expect(challengeResult.status).toBe('needs_human')
      expect(challengeResult.needsHuman).toMatchObject({
        status: 'needs_human',
        phase: 'final-request',
      })
      expect(materialServer.getRequests()).toHaveLength(2)
    } finally {
      await page.close()
      await materialServer.close()
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }, 30000)
})
