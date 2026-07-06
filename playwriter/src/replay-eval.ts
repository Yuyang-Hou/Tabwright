import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import util from 'node:util'
import { chromium, type Browser, type Page } from '@xmorse/playwright-core'
import pc from 'picocolors'
import { prepareCapabilityRun, runCapabilityWithExecutor, type CapabilityExecutor } from './capability-runner.js'
import { createReplayAiIndexFromRecording } from './replay-ai-index.js'
import { compileReplayWorkflow } from './replay-workflow-compiler.js'
import type { ExecuteResult } from './executor.js'
import type { RrwebEvent } from './protocol.js'

type ReplayEvalExpectedStatus = 'completed' | 'needs_ai' | 'compile_failed'

type ReplayEvalCase = {
  id: string
  title: string
  description: string
  editLabel: string
  addLabel: string
  submitLabel: string
  okLabel: string
  demonstratedValue: string
  runValue: string
  initialValues?: string[]
  alreadyEditing?: boolean
  draftAction?: 'restart' | 'continue'
  brokenAdd?: boolean
  unsupported?: boolean
  addAnnotation?: boolean
  deleteAnnotation?: boolean
  expectedStatus: ReplayEvalExpectedStatus
  expectedReasonIncludes?: string
  expectedAnnotationCount?: number
}

export type ReplayEvalCaseResult = {
  id: string
  title: string
  status: 'passed' | 'failed'
  durationMs: number
  replayId: string
  phases: Array<'recording' | 'index' | 'compile' | 'run' | 'verify'>
  index?: {
    actionCount: number
    fieldCount: number
    annotationCount: number
  }
  compile?: {
    actionKind: string
    confidence: string
    demonstratedValue?: string
  }
  run?: {
    status?: string
    value?: string
    reason?: string
    completed?: number
    total?: number
  }
  error?: string
}

export type ReplayEvalReport = {
  generatedAt: string
  durationMs: number
  passed: number
  failed: number
  total: number
  results: ReplayEvalCaseResult[]
  artifactsDir: string
}

export type RunReplayEvalOptions = {
  caseId?: string
  reportPath?: string
  keepArtifacts?: boolean
  headed?: boolean
}

type ExampleCaseState = {
  values: string[]
}

type ExampleServer = {
  baseUrl: string
  close: () => Promise<void>
}

type AsyncFunctionConstructor = new (...args: string[]) => (...args: unknown[]) => Promise<unknown>

const REPLAY_EVAL_CASES: ReplayEvalCase[] = [
  {
    id: 'zh-list-append',
    title: 'Chinese admin list append',
    description: '编辑 -> Add entry -> 填值 -> 提交 -> OK',
    editLabel: '编辑',
    addLabel: 'Add entry',
    submitLabel: '提交',
    okLabel: 'OK',
    demonstratedValue: 'test2',
    runValue: 'test3',
    expectedStatus: 'completed',
  },
  {
    id: 'en-list-append',
    title: 'English list append',
    description: 'Edit -> Add entry -> fill -> Submit -> OK',
    editLabel: 'Edit',
    addLabel: 'Add entry',
    submitLabel: 'Submit',
    okLabel: 'OK',
    demonstratedValue: 'alpha',
    runValue: 'beta',
    expectedStatus: 'completed',
  },
  {
    id: 'cn-add-confirm',
    title: 'Chinese add and confirm labels',
    description: '新增/确定 button labels should still compile and run.',
    editLabel: '编辑',
    addLabel: '新增',
    submitLabel: '提交',
    okLabel: '确定',
    demonstratedValue: '中文值1',
    runValue: '中文值2',
    expectedStatus: 'completed',
  },
  {
    id: 'already-editing',
    title: 'Already editing page',
    description: 'Generated script should continue from an already-editing page.',
    editLabel: '编辑',
    addLabel: 'Add entry',
    submitLabel: '提交',
    okLabel: 'OK',
    demonstratedValue: 'inline-demo',
    runValue: 'inline-run',
    alreadyEditing: true,
    expectedStatus: 'completed',
  },
  {
    id: 'draft-restart',
    title: 'Draft dialog restart',
    description: 'Replay clicked 重新编辑, so generated script should restart the draft.',
    editLabel: '编辑',
    addLabel: 'Add entry',
    submitLabel: '提交',
    okLabel: 'OK',
    demonstratedValue: 'restart-demo',
    runValue: 'restart-run',
    draftAction: 'restart',
    expectedStatus: 'completed',
  },
  {
    id: 'draft-continue',
    title: 'Draft dialog continue',
    description: 'Replay clicked 继续编辑, so generated script should continue the draft.',
    editLabel: '编辑',
    addLabel: 'Add entry',
    submitLabel: '提交',
    okLabel: 'OK',
    demonstratedValue: 'continue-demo',
    runValue: 'continue-run',
    draftAction: 'continue',
    expectedStatus: 'completed',
  },
  {
    id: 'duplicate-short-circuit',
    title: 'Duplicate value short-circuit',
    description: 'If the target value is already visible, script should return completed without editing.',
    editLabel: '编辑',
    addLabel: 'Add entry',
    submitLabel: '提交',
    okLabel: 'OK',
    demonstratedValue: 'existing-demo',
    runValue: 'existing-demo',
    initialValues: ['existing-demo'],
    expectedStatus: 'completed',
  },
  {
    id: 'drift-add-fails',
    title: 'Page drift handoff',
    description: 'The add button no longer creates an input, so script should return needs_ai.',
    editLabel: '编辑',
    addLabel: 'Add entry',
    submitLabel: '提交',
    okLabel: 'OK',
    demonstratedValue: 'drift-demo',
    runValue: 'drift-run',
    brokenAdd: true,
    expectedStatus: 'needs_ai',
    expectedReasonIncludes: 'Add entry did not create a new list input',
  },
  {
    id: 'annotation-delete-index',
    title: 'Deleted annotation index',
    description: 'A deleted annotation should not reach AI index output.',
    editLabel: '编辑',
    addLabel: 'Add entry',
    submitLabel: '提交',
    okLabel: 'OK',
    demonstratedValue: 'annotation-demo',
    runValue: 'annotation-run',
    addAnnotation: true,
    deleteAnnotation: true,
    expectedStatus: 'completed',
    expectedAnnotationCount: 0,
  },
  {
    id: 'unsupported-click-only',
    title: 'Unsupported click-only replay',
    description: 'Compiler should fail clearly instead of generating a fake workflow.',
    editLabel: '编辑',
    addLabel: 'Add entry',
    submitLabel: '提交',
    okLabel: 'OK',
    demonstratedValue: '',
    runValue: '',
    unsupported: true,
    expectedStatus: 'compile_failed',
  },
]

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function createLocalTempDir(prefix: string): string {
  const root = path.join(process.cwd(), 'tmp')
  ensureDir(root)
  return fs.mkdtempSync(path.join(root, prefix))
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function textNode(id: number, textContent: string): Record<string, unknown> {
  return { id, type: 3, textContent }
}

function elementNode(options: {
  id: number
  tagName: string
  attributes?: Record<string, string>
  childNodes?: Array<Record<string, unknown>>
}): Record<string, unknown> {
  return {
    id: options.id,
    type: 2,
    tagName: options.tagName,
    attributes: options.attributes || {},
    childNodes: options.childNodes || [],
  }
}

function clickEvent(options: { timestamp: number; id: number }): RrwebEvent {
  return {
    type: 3,
    timestamp: options.timestamp,
    data: {
      source: 2,
      type: 2,
      id: options.id,
      x: 10,
      y: 10,
      pointerType: 0,
    },
  }
}

function inputEvent(options: { timestamp: number; id: number; text: string }): RrwebEvent {
  return {
    type: 3,
    timestamp: options.timestamp,
    data: {
      source: 5,
      id: options.id,
      text: options.text,
      isChecked: false,
    },
  }
}

function annotationEvent(options: { timestamp: number; id: string; text: string }): RrwebEvent {
  return {
    type: 5,
    timestamp: options.timestamp,
    data: {
      tag: 'playwriter.annotation',
      payload: {
        schemaVersion: 1,
        id: options.id,
        text: options.text,
        timestamp: options.timestamp,
        target: {
          tagName: 'textarea',
          label: 'List value',
          selectorHints: ['textarea.designer-input'],
          rect: { x: 10, y: 20, width: 240, height: 32 },
        },
      },
    },
  }
}

function annotationDeleteEvent(options: { timestamp: number; id: string }): RrwebEvent {
  return {
    type: 5,
    timestamp: options.timestamp,
    data: {
      tag: 'playwriter.annotation.delete',
      payload: {
        schemaVersion: 1,
        id: options.id,
        timestamp: options.timestamp,
      },
    },
  }
}

function createReplayEvents(testCase: ReplayEvalCase): RrwebEvent[] {
  const nodes = [
    elementNode({ id: 10, tagName: 'button', childNodes: [textNode(11, testCase.editLabel)] }),
    elementNode({
      id: 12,
      tagName: 'button',
      attributes: { class: 'designer-btn designer-btn-dangerous' },
      childNodes: [textNode(13, testCase.draftAction === 'restart' ? '重新编辑' : 'Restart')],
    }),
    elementNode({
      id: 14,
      tagName: 'button',
      attributes: { class: 'designer-btn designer-btn-primary' },
      childNodes: [textNode(15, testCase.draftAction === 'continue' ? '继续编辑' : 'Continue')],
    }),
    elementNode({
      id: 20,
      tagName: 'button',
      attributes: { class: 'designer-formily-array-base-addition' },
      childNodes: [textNode(21, testCase.addLabel)],
    }),
    elementNode({ id: 30, tagName: 'textarea', attributes: { class: 'designer-input' } }),
    elementNode({ id: 40, tagName: 'button', childNodes: [textNode(41, testCase.submitLabel)] }),
    elementNode({
      id: 50,
      tagName: 'button',
      attributes: { class: 'designer-btn designer-btn-primary' },
      childNodes: [textNode(51, testCase.okLabel)],
    }),
  ]
  const events: RrwebEvent[] = [
    {
      type: 2,
      timestamp: 1000,
      data: {
        node: {
          id: 1,
          type: 0,
          childNodes: [
            {
              id: 2,
              type: 1,
              childNodes: [
                elementNode({
                  id: 3,
                  tagName: 'body',
                  childNodes: nodes,
                }),
              ],
            },
          ],
        },
      },
    },
  ]
  if (testCase.unsupported) {
    events.push(clickEvent({ timestamp: 1100, id: 10 }))
    return events
  }
  if (!testCase.alreadyEditing) {
    events.push(clickEvent({ timestamp: 1100, id: 10 }))
  }
  if (testCase.draftAction === 'restart') {
    events.push(clickEvent({ timestamp: 1200, id: 12 }))
  }
  if (testCase.draftAction === 'continue') {
    events.push(clickEvent({ timestamp: 1200, id: 14 }))
  }
  events.push(clickEvent({ timestamp: 1300, id: 20 }))
  events.push(inputEvent({ timestamp: 1400, id: 30, text: testCase.demonstratedValue }))
  if (testCase.addAnnotation) {
    events.push(annotationEvent({ timestamp: 1450, id: `${testCase.id}-annotation`, text: '重点填写这个列表项' }))
  }
  if (testCase.deleteAnnotation) {
    events.push(annotationDeleteEvent({ timestamp: 1460, id: `${testCase.id}-annotation` }))
  }
  events.push(clickEvent({ timestamp: 1500, id: 40 }))
  events.push(clickEvent({ timestamp: 1600, id: 50 }))
  return events
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildExampleHtml(testCase: ReplayEvalCase, state: ExampleCaseState): string {
  const config = {
    id: testCase.id,
    labels: {
      edit: testCase.editLabel,
      add: testCase.addLabel,
      submit: testCase.submitLabel,
      ok: testCase.okLabel,
      restart: testCase.draftAction === 'restart' ? '重新编辑' : 'Restart',
      continue: testCase.draftAction === 'continue' ? '继续编辑' : 'Continue',
    },
    initialValues: state.values,
    alreadyEditing: Boolean(testCase.alreadyEditing),
    draftAction: testCase.draftAction || null,
    brokenAdd: Boolean(testCase.brokenAdd),
  }
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${htmlEscape(testCase.title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; color: #172033; }
      button { margin: 6px; padding: 7px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; cursor: pointer; }
      textarea { display: block; width: 320px; min-height: 36px; margin: 8px 0; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px; }
      .designer-modal { position: fixed; inset: auto 24px 24px auto; width: 360px; padding: 16px; border: 1px solid #cbd5e1; border-radius: 8px; background: white; box-shadow: 0 18px 48px rgba(15,23,42,.18); }
      .readonly-value { padding: 4px 0; }
    </style>
  </head>
  <body>
    <h1>${htmlEscape(testCase.title)}</h1>
    <div id="app"></div>
    <script>
      const config = ${JSON.stringify(config)};
      const app = document.getElementById('app');
      const state = {
        values: [...config.initialValues],
        editing: config.alreadyEditing,
        draftShown: false,
      };
      function renderReadOnly() {
        app.innerHTML = '<button id="edit">' + config.labels.edit + '</button><div id="values"></div>';
        const values = document.getElementById('values');
        state.values.forEach((value) => {
          const item = document.createElement('div');
          item.className = 'readonly-value';
          item.textContent = value;
          values.appendChild(item);
        });
        document.getElementById('edit').addEventListener('click', () => {
          if (config.draftAction && !state.draftShown) {
            state.draftShown = true;
            renderDraftDialog();
            return;
          }
          state.editing = true;
          render();
        });
      }
      function renderDraftDialog() {
        renderReadOnly();
        const modal = document.createElement('div');
        modal.className = 'designer-modal';
        modal.innerHTML = '<p>继续编辑上次修改 / Continue previous edit draft</p><button class="designer-btn designer-btn-dangerous" id="restart">' + config.labels.restart + '</button><button class="designer-btn designer-btn-primary" id="continue">' + config.labels.continue + '</button>';
        document.body.appendChild(modal);
        document.getElementById('restart').addEventListener('click', () => {
          modal.remove();
          state.values = [];
          state.editing = true;
          render();
        });
        document.getElementById('continue').addEventListener('click', () => {
          modal.remove();
          state.editing = true;
          render();
        });
      }
      function renderEditor() {
        app.innerHTML = '<div id="editor"></div><button class="designer-formily-array-base-addition" id="add">' + config.labels.add + '</button><button id="submit">' + config.labels.submit + '</button>';
        const editor = document.getElementById('editor');
        state.values.forEach((value, index) => {
          const input = document.createElement('textarea');
          input.className = 'designer-input';
          input.value = value;
          input.addEventListener('input', () => {
            state.values[index] = input.value;
          });
          editor.appendChild(input);
        });
        document.getElementById('add').addEventListener('click', () => {
          if (!config.brokenAdd) {
            state.values.push('');
          }
          render();
        });
        document.getElementById('submit').addEventListener('click', () => {
          renderConfirm();
        });
      }
      function renderConfirm() {
        const modal = document.createElement('div');
        modal.className = 'designer-modal';
        modal.innerHTML = '<p>Confirm values: ' + state.values.join(', ') + '</p><button class="designer-btn designer-btn-primary" id="ok">' + config.labels.ok + '</button>';
        document.body.appendChild(modal);
        document.getElementById('ok').addEventListener('click', async () => {
          await fetch('/enhancedConfigs/update', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ caseId: config.id, values: state.values }),
          });
          await fetch('/enhancedConfigs/publish', { method: 'POST' });
          await fetch('/enhancedConfigs/detail?id=' + encodeURIComponent(config.id));
          modal.remove();
          state.editing = false;
          render();
        });
      }
      function render() {
        if (state.editing) {
          renderEditor();
          return;
        }
        renderReadOnly();
      }
      render();
    </script>
  </body>
</html>`
}

function requestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'))
    })
    request.on('error', (error) => {
      reject(error)
    })
  })
}

async function startExampleServer(cases: ReplayEvalCase[]): Promise<ExampleServer> {
  const casesById = new Map(
    cases.map((testCase) => {
      return [testCase.id, testCase] as const
    }),
  )
  const states: Map<string, ExampleCaseState> = new Map(
    cases.map((testCase) => {
      const state: ExampleCaseState = { values: [...(testCase.initialValues || [])] }
      return [testCase.id, state]
    }),
  )
  const server = http.createServer((request, response) => {
    const host = request.headers.host || 'localhost'
    const url = new URL(request.url || '/', `http://${host}`)
    const sendJson = (statusCode: number, value: unknown): void => {
      response.writeHead(statusCode, { 'content-type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    if (request.method === 'GET' && url.pathname.startsWith('/case/')) {
      const caseId = decodeURIComponent(url.pathname.slice('/case/'.length))
      const testCase = casesById.get(caseId)
      const state = states.get(caseId)
      if (!testCase || !state) {
        response.writeHead(404)
        response.end('Not found')
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(buildExampleHtml(testCase, state))
      return
    }
    if (request.method === 'POST' && url.pathname === '/enhancedConfigs/update') {
      requestBody(request)
        .then((body) => {
          const parsed = JSON.parse(body || '{}') as { caseId?: unknown; values?: unknown }
          const caseId = typeof parsed.caseId === 'string' ? parsed.caseId : ''
          const state = states.get(caseId)
          if (state && Array.isArray(parsed.values)) {
            state.values = parsed.values.map((value) => {
              return String(value)
            })
          }
          sendJson(200, { code: 0, data: true })
        })
        .catch((error: unknown) => {
          sendJson(500, { code: 1, message: normalizeError(error) })
        })
      return
    }
    if (request.method === 'POST' && url.pathname === '/enhancedConfigs/publish') {
      sendJson(200, { code: 0, data: true })
      return
    }
    if (request.method === 'GET' && url.pathname === '/enhancedConfigs/detail') {
      const caseId = url.searchParams.get('id') || ''
      const state = states.get(caseId)
      sendJson(200, {
        code: 0,
        data: {
          config: {
            value: JSON.stringify(state?.values || []),
          },
        },
      })
      return
    }
    response.writeHead(404)
    response.end('Not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Replay eval server did not expose a TCP port')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
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

function getChromeExecutable(): string | undefined {
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

async function launchEvalBrowser(options: { headed?: boolean }): Promise<Browser> {
  const executablePath = getChromeExecutable()
  return await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    headless: !options.headed,
  })
}

function formatOutput(value: unknown): string {
  return `[return value] ${util.inspect(value, {
    depth: 5,
    colors: false,
    maxArrayLength: 80,
    maxStringLength: 2000,
    breakLength: 100,
  })}`
}

class PageEvalExecutor implements CapabilityExecutor {
  constructor(private page: Page) {}

  async execute(code: string, timeout = 15000): Promise<ExecuteResult> {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as AsyncFunctionConstructor
    const runner = new AsyncFunction(
      'page',
      'snapshot',
      'console',
      'setTimeout',
      'clearTimeout',
      'URL',
      'URLSearchParams',
      'fetch',
      'Buffer',
      code,
    )
    const snapshot = async (): Promise<string> => {
      return await this.page.locator('body').innerText({ timeout: 2000 }).catch((error: unknown) => {
        return `snapshot failed: ${normalizeError(error)}`
      })
    }
    try {
      const structuredResult = await Promise.race([
        runner(this.page, snapshot, console, setTimeout, clearTimeout, URL, URLSearchParams, fetch, Buffer),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Replay eval execution timed out after ${timeout}ms`))
          }, timeout)
        }),
      ])
      return {
        text: formatOutput(structuredResult),
        images: [],
        screenshots: [],
        isError: false,
        structuredResult: JSON.parse(JSON.stringify(structuredResult)),
      }
    } catch (error: unknown) {
      return {
        text: normalizeError(error),
        images: [],
        screenshots: [],
        isError: true,
      }
    }
  }
}

function writeRecording(options: {
  home: string
  replayId: string
  url: string
  events: RrwebEvent[]
}): void {
  const recordingsDir = path.join(options.home, '.playwriter', 'rrweb-recordings')
  const recordingPath = path.join(recordingsDir, `${options.replayId}.json`)
  writeJson(recordingPath, options.events)
  writeJson(path.join(recordingsDir, 'index.json'), [
    {
      id: options.replayId,
      path: recordingPath,
      startedAt: 1000,
      savedAt: 2000,
      duration: 1000,
      size: fs.statSync(recordingPath).size,
      eventCount: options.events.length,
      tabId: 1,
      url: options.url,
    },
  ])
}

function getOutputStatus(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') {
    return undefined
  }
  const candidate = output as { status?: unknown }
  return typeof candidate.status === 'string' ? candidate.status : undefined
}

function outputField(output: unknown, key: string): string | undefined {
  if (!output || typeof output !== 'object') {
    return undefined
  }
  const value = (output as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function outputNumberField(output: unknown, key: string): number | undefined {
  if (!output || typeof output !== 'object') {
    return undefined
  }
  const value = (output as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : undefined
}

function assertCaseResult(options: { testCase: ReplayEvalCase; output: unknown; annotationCount: number }): void {
  if (options.testCase.expectedAnnotationCount !== undefined && options.annotationCount !== options.testCase.expectedAnnotationCount) {
    throw new Error(`Expected ${options.testCase.expectedAnnotationCount} annotations, got ${options.annotationCount}`)
  }
  const status = getOutputStatus(options.output)
  if (status !== options.testCase.expectedStatus) {
    throw new Error(`Expected run status ${options.testCase.expectedStatus}, got ${status || 'undefined'}`)
  }
  if (options.testCase.expectedReasonIncludes) {
    const reason = outputField(options.output, 'reason') || ''
    const needsAi = options.output && typeof options.output === 'object' ? (options.output as Record<string, unknown>).needsAi : undefined
    const nestedReason = outputField(needsAi, 'reason') || ''
    if (!reason.includes(options.testCase.expectedReasonIncludes) && !nestedReason.includes(options.testCase.expectedReasonIncludes)) {
      throw new Error(`Expected reason to include "${options.testCase.expectedReasonIncludes}", got "${reason || nestedReason}"`)
    }
  }
}

async function runOneEvalCase(options: {
  testCase: ReplayEvalCase
  server: ExampleServer
  browser: Browser
  artifactsDir: string
}): Promise<ReplayEvalCaseResult> {
  const start = Date.now()
  const phases: ReplayEvalCaseResult['phases'] = []
  const replayId = `eval-${options.testCase.id}`
  const home = path.join(options.artifactsDir, replayId, 'home')
  const cwd = path.join(options.artifactsDir, replayId, 'cwd')
  ensureDir(home)
  ensureDir(cwd)
  const previousHome = process.env.HOME
  const url = `${options.server.baseUrl}/case/${encodeURIComponent(options.testCase.id)}?key=${encodeURIComponent(options.testCase.id)}`
  try {
    process.env.HOME = home
    const events = createReplayEvents(options.testCase)
    writeRecording({ home, replayId, url, events })
    phases.push('recording')

    const index = createReplayAiIndexFromRecording(replayId)
    phases.push('index')

    if (options.testCase.expectedStatus === 'compile_failed') {
      try {
        compileReplayWorkflow({ replayId, id: `${options.testCase.id}-capability`, cwd, overwrite: true })
      } catch (error: unknown) {
        phases.push('compile')
        return {
          id: options.testCase.id,
          title: options.testCase.title,
          status: 'passed',
          durationMs: Date.now() - start,
          replayId,
          phases,
          index: {
            actionCount: index.actions.length,
            fieldCount: index.fields.length,
            annotationCount: index.annotations.length,
          },
          error: normalizeError(error),
        }
      }
      throw new Error('Expected replay compiler to fail, but it produced a capability')
    }

    const compiled = compileReplayWorkflow({ replayId, id: `${options.testCase.id}-capability`, cwd, overwrite: true })
    phases.push('compile')

    const page = await options.browser.newPage()
    try {
      await page.goto(url)
      const executor = new PageEvalExecutor(page)
      const runResult = await runCapabilityWithExecutor({
        executor,
        id: `${options.testCase.id}-capability`,
        input: { value: options.testCase.runValue },
        cwd,
        force: true,
        timeout: 20000,
      })
      phases.push('run')
      assertCaseResult({
        testCase: options.testCase,
        output: runResult.output,
        annotationCount: index.annotations.length,
      })
      phases.push('verify')
      return {
        id: options.testCase.id,
        title: options.testCase.title,
        status: 'passed',
        durationMs: Date.now() - start,
        replayId,
        phases,
        index: {
          actionCount: index.actions.length,
          fieldCount: index.fields.length,
          annotationCount: index.annotations.length,
        },
        compile: {
          actionKind: compiled.analysis.actionKind,
          confidence: compiled.analysis.confidence,
          demonstratedValue: compiled.analysis.demonstratedValue,
        },
        run: {
          status: getOutputStatus(runResult.output),
          value: outputField(runResult.output, 'value'),
          reason: outputField(runResult.output, 'reason'),
          completed: outputNumberField(runResult.output, 'completed'),
          total: outputNumberField(runResult.output, 'total'),
        },
      }
    } finally {
      await page.close().catch(() => {})
    }
  } catch (error: unknown) {
    return {
      id: options.testCase.id,
      title: options.testCase.title,
      status: 'failed',
      durationMs: Date.now() - start,
      replayId,
      phases,
      error: normalizeError(error),
    }
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
  }
}

function renderReportHtml(report: ReplayEvalReport): string {
  const rows = report.results
    .map((result) => {
      const statusColor = result.status === 'passed' ? '#15803d' : '#b91c1c'
      return `<tr>
        <td>${htmlEscape(result.id)}</td>
        <td>${htmlEscape(result.title)}</td>
        <td style="color:${statusColor};font-weight:700">${htmlEscape(result.status)}</td>
        <td>${result.durationMs}ms</td>
        <td>${htmlEscape(result.phases.join(' -> '))}</td>
        <td>${htmlEscape(result.run?.status || result.error || '-')}</td>
      </tr>`
    })
    .join('\n')
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Playwriter Replay Eval</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 32px; color: #172033; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #f8fafc; font-size: 12px; text-transform: uppercase; color: #64748b; }
      .summary { margin-bottom: 18px; padding: 14px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
    </style>
  </head>
  <body>
    <h1>Playwriter Replay Eval</h1>
    <div class="summary">
      <strong>${report.passed}/${report.total} passed</strong>
      <span>generated ${htmlEscape(report.generatedAt)}</span>
      <span>duration ${report.durationMs}ms</span>
      <span>artifacts ${htmlEscape(report.artifactsDir)}</span>
    </div>
    <table>
      <thead>
        <tr><th>Case</th><th>Title</th><th>Status</th><th>Duration</th><th>Phases</th><th>Run/Error</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`
}

export async function runReplayEval(options: RunReplayEvalOptions = {}): Promise<ReplayEvalReport> {
  const selectedCases = options.caseId
    ? REPLAY_EVAL_CASES.filter((testCase) => {
        return testCase.id === options.caseId
      })
    : REPLAY_EVAL_CASES
  if (selectedCases.length === 0) {
    throw new Error(`Replay eval case not found: ${options.caseId}`)
  }
  const start = Date.now()
  const artifactsDir = createLocalTempDir('replay-eval-')
  const server = await startExampleServer(selectedCases)
  const browser = await launchEvalBrowser({ headed: options.headed })
  try {
    const results: ReplayEvalCaseResult[] = []
    for (const testCase of selectedCases) {
      results.push(
        await runOneEvalCase({
          testCase,
          server,
          browser,
          artifactsDir,
        }),
      )
    }
    const passed = results.filter((result) => {
      return result.status === 'passed'
    }).length
    const report: ReplayEvalReport = {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      passed,
      failed: results.length - passed,
      total: results.length,
      results,
      artifactsDir,
    }
    if (options.reportPath) {
      ensureDir(path.dirname(options.reportPath))
      fs.writeFileSync(options.reportPath, renderReportHtml(report))
    }
    if (!options.keepArtifacts) {
      fs.rmSync(artifactsDir, { recursive: true, force: true })
      return { ...report, artifactsDir: `${artifactsDir} (removed)` }
    }
    return report
  } finally {
    await browser.close().catch(() => {})
    await server.close().catch(() => {})
  }
}

export function formatReplayEvalReport(report: ReplayEvalReport): string {
  const lines = [
    `Replay eval: ${report.passed}/${report.total} passed in ${report.durationMs}ms`,
    `Artifacts: ${report.artifactsDir}`,
    '',
    ...report.results.map((result) => {
      const status = result.status === 'passed' ? pc.green('PASS') : pc.red('FAIL')
      const detail = result.error || result.run?.status || ''
      return `${status} ${result.id} (${result.durationMs}ms) ${detail}`
    }),
  ]
  return lines.join('\n')
}
