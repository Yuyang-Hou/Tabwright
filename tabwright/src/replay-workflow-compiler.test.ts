import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { readCapabilityScript } from './capability-registry.js'
import {
  analyzeReplayWorkflow,
  compileReplayWorkflow,
  UnsupportedReplayWorkflowError,
} from './replay-workflow-compiler.js'
import type { RrwebEvent } from './protocol.js'

let previousHome: string | undefined
let testHome: string | null = null

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

function useTempHome(): string {
  previousHome = process.env.HOME
  testHome = createTempDir('replay-workflow-compiler-home-')
  process.env.HOME = testHome
  return testHome
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
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

function createListAppendReplayEvents(): RrwebEvent[] {
  return [
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
                  childNodes: [
                    elementNode({ id: 10, tagName: 'button', childNodes: [textNode(11, '编辑')] }),
                    elementNode({
                      id: 12,
                      tagName: 'button',
                      attributes: { class: 'designer-formily-array-base-addition' },
                    }),
                    elementNode({ id: 14, tagName: 'textarea', attributes: { class: 'designer-input' } }),
                    elementNode({ id: 16, tagName: 'button', childNodes: [textNode(17, '提交')] }),
                    elementNode({ id: 18, tagName: 'button', childNodes: [textNode(19, 'OK')] }),
                  ],
                }),
              ],
            },
          ],
        },
      },
    },
    clickEvent({ timestamp: 1100, id: 10 }),
    clickEvent({ timestamp: 1200, id: 12 }),
    inputEvent({ timestamp: 1300, id: 14, text: 'test2' }),
    clickEvent({ timestamp: 1400, id: 16 }),
    clickEvent({ timestamp: 1500, id: 18 }),
  ]
}

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = previousHome
  }
  previousHome = undefined

  if (testHome) {
    fs.rmSync(testHome, { recursive: true, force: true })
    testHome = null
  }
})

describe('replay workflow compiler', () => {
  test('infers a list append script from rrweb DOM events', () => {
    const home = useTempHome()
    const cwd = createTempDir('replay-workflow-compiler-cwd-')
    const replayPath = path.join(home, '.tabwright', 'rrweb-recordings', 'replay-list-add.json')
    const events = createListAppendReplayEvents()
    writeJson(replayPath, events)
    writeJson(path.join(home, '.tabwright', 'rrweb-recordings', 'index.json'), [
      {
        id: 'replay-list-add',
        path: replayPath,
        startedAt: 1000,
        savedAt: 2000,
        duration: 1000,
        size: 100,
        eventCount: events.length,
        tabId: 1,
        url: 'https://admin.example.com/#/config?key=config_demo_simple_COPY123',
      },
    ])

    try {
      const analysis = analyzeReplayWorkflow({
        replayId: 'replay-list-add',
        url: 'https://admin.example.com/#/config?key=config_demo_simple_COPY123',
        events,
      })
      expect(analysis).toMatchObject({
        actionKind: 'list-append',
        demonstratedValue: 'test2',
        confidence: 'high',
      })
      expect(analysis.clickedTexts).toEqual(expect.arrayContaining(['编辑', 'Add entry', '提交', 'OK']))

      const compiled = compileReplayWorkflow({
        replayId: 'replay-list-add',
        id: 'compiled-list-add',
        cwd,
        overwrite: true,
      })
      const script = readCapabilityScript({ id: 'compiled-list-add', cwd })

      expect(compiled.analysis.actionKind).toBe('list-append')
      expect(script).toContain('replayWorkflow.compile')
      expect(script).toContain('button:has-text(\\"Add entry\\")')
      expect(script).toContain('const expectedPageKey = "config_demo_simple_COPY123"')
      expect(script).toContain('needs_ai')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('throws a structured error before saving an unsupported workflow', () => {
    const home = useTempHome()
    const cwd = createTempDir('replay-workflow-compiler-unsupported-cwd-')
    const replayPath = path.join(home, '.tabwright', 'rrweb-recordings', 'replay-unsupported.json')
    const events: RrwebEvent[] = [
      {
        type: 2,
        timestamp: 1000,
        data: {
          node: {
            id: 1,
            type: 0,
            childNodes: [],
          },
        },
      },
    ]
    writeJson(replayPath, events)
    writeJson(path.join(home, '.tabwright', 'rrweb-recordings', 'index.json'), [
      {
        id: 'replay-unsupported',
        path: replayPath,
        startedAt: 1000,
        savedAt: 2000,
        duration: 1000,
        size: 100,
        eventCount: events.length,
        tabId: 1,
        url: 'https://example.com/',
      },
    ])

    try {
      let thrown: unknown
      try {
        compileReplayWorkflow({
          replayId: 'replay-unsupported',
          id: 'unsupported-workflow',
          cwd,
          overwrite: true,
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(UnsupportedReplayWorkflowError)
      if (!(thrown instanceof UnsupportedReplayWorkflowError)) {
        throw new Error('Expected UnsupportedReplayWorkflowError')
      }
      expect(thrown.analysis.actionKind).toBe('unknown')
      expect(thrown.analysis.reasons).toEqual(
        expect.arrayContaining(['Could not classify the replay into a known workflow template.']),
      )
      expect(thrown.message).toBe(
        `Replay compiler could not infer a supported workflow: ${thrown.analysis.reasons.join(' ')}`,
      )
      expect(fs.existsSync(path.join(cwd, '.tabwright', 'capabilities', 'unsupported-workflow'))).toBe(false)
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
})
