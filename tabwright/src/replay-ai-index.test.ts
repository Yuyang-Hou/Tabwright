import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { buildReplayAiIndex, saveReplayAiIndex } from './replay-ai-index.js'
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
  testHome = createTempDir('replay-ai-index-home-')
  process.env.HOME = testHome
  return testHome
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

function annotationEvent(options: { timestamp: number; text: string; selectorHints: string[]; id?: string }): RrwebEvent {
  return {
    type: 5,
    timestamp: options.timestamp,
    data: {
      tag: 'playwriter.annotation',
      payload: {
        schemaVersion: 1,
        id: options.id || 'ann-test-title',
        text: options.text,
        url: 'https://admin.example.com/#/config?key=config_demo_simple_COPY123',
        timestamp: options.timestamp,
        target: {
          tagName: 'textarea',
          label: 'ArrayStrings',
          text: '',
          selectorHints: options.selectorHints,
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
        url: 'https://admin.example.com/#/config?key=config_demo_simple_COPY123',
        timestamp: options.timestamp,
      },
    },
  }
}

function createReplayEvents(): RrwebEvent[] {
  return [
    {
      type: 4,
      timestamp: 900,
      data: { href: 'https://admin.example.com/#/config?key=config_demo_simple_COPY123' },
    },
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
                      id: 20,
                      tagName: 'div',
                      attributes: { class: 'designer-modal' },
                      childNodes: [
                        elementNode({
                          id: 21,
                          tagName: 'button',
                          attributes: { class: 'designer-btn designer-btn-dangerous' },
                        }),
                      ],
                    }),
                    elementNode({
                      id: 30,
                      tagName: 'button',
                      attributes: { class: 'designer-btn designer-formily-array-base-addition' },
                    }),
                    elementNode({
                      id: 40,
                      tagName: 'textarea',
                      attributes: { class: 'designer-input', placeholder: 'ArrayStrings' },
                    }),
                    elementNode({ id: 50, tagName: 'button', childNodes: [textNode(51, '提交')] }),
                    elementNode({
                      id: 60,
                      tagName: 'div',
                      attributes: { class: 'designer-modal' },
                      childNodes: [
                        elementNode({
                          id: 61,
                          tagName: 'button',
                          attributes: { class: 'designer-btn designer-btn-primary' },
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            },
          ],
        },
      },
    },
    clickEvent({ timestamp: 1100, id: 10 }),
    clickEvent({ timestamp: 1200, id: 21 }),
    clickEvent({ timestamp: 1300, id: 30 }),
    inputEvent({ timestamp: 1400, id: 40, text: 'test2' }),
    annotationEvent({
      timestamp: 1450,
      text: '批量任务要填这个字段',
      selectorHints: ['textarea[placeholder="ArrayStrings"]'],
    }),
    clickEvent({ timestamp: 1500, id: 50 }),
    clickEvent({ timestamp: 1600, id: 61 }),
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

describe('replay ai index', () => {
  test('turns rrweb snapshot events into action and field summaries', () => {
    const home = useTempHome()
    const index = buildReplayAiIndex({
      replayId: 'replay-ai-index',
      events: createReplayEvents(),
    })

    expect(index.url).toBe('https://admin.example.com/#/config?key=config_demo_simple_COPY123')
    expect(index.stats).toMatchObject({
      eventCount: 9,
      fullSnapshotCount: 1,
      clickEventCount: 5,
      inputEventCount: 1,
      annotationCount: 1,
    })
    expect(index.actions.map((action) => action.label)).toEqual([
      '编辑',
      '重新编辑',
      'Add entry',
      'ArrayStrings',
      '提交',
      'OK',
    ])
    expect(index.fields[0]).toMatchObject({
      label: 'ArrayStrings',
      value: 'test2',
      selectorHints: expect.arrayContaining(['textarea[placeholder="ArrayStrings"]', 'textarea.designer-input']),
    })
    expect(index.annotations[0]).toMatchObject({
      id: 'ann-test-title',
      text: '批量任务要填这个字段',
      target: {
        label: 'ArrayStrings',
        selectorHints: ['textarea[placeholder="ArrayStrings"]'],
      },
    })
    expect(index.interactiveElements.map((element) => element.label)).toEqual(
      expect.arrayContaining(['编辑', '重新编辑', 'Add entry', 'ArrayStrings', '提交', 'OK']),
    )

    const saved = saveReplayAiIndex(index)
    expect(saved.path).toBe(path.join(home, '.tabwright', 'replay-ai-indexes', 'replay-ai-index.json'))
    expect(fs.existsSync(saved.path)).toBe(true)
  })

  test('uses pre-range DOM context while exposing only actions inside an activity selection', () => {
    const index = buildReplayAiIndex({
      replayId: 'activity-selection',
      events: createReplayEvents(),
      actionRange: { from: 1350, to: 1550 },
    })

    expect(index.actions.map((action) => action.kind)).toEqual(['input', 'click'])
    expect(index.actions.map((action) => action.timestamp)).toEqual([1400, 1500])
    expect(index.annotations.map((annotation) => annotation.timestamp)).toEqual([1450])
    expect(index.fields).toHaveLength(1)
  })

  test('removes deleted recording annotations from the ai index', () => {
    const index = buildReplayAiIndex({
      replayId: 'replay-ai-index-deleted-annotation',
      events: [
        annotationEvent({
          id: 'ann-deleted',
          timestamp: 1000,
          text: '不要再给 AI 看这个标注',
          selectorHints: ['button[aria-label="Delete"]'],
        }),
        annotationDeleteEvent({ id: 'ann-deleted', timestamp: 1100 }),
        annotationEvent({
          id: 'ann-kept',
          timestamp: 1200,
          text: '保留这个标注',
          selectorHints: ['textarea[placeholder="ArrayStrings"]'],
        }),
      ],
    })

    expect(index.stats.annotationCount).toBe(1)
    expect(index.annotations).toHaveLength(1)
    expect(index.annotations[0]).toMatchObject({
      id: 'ann-kept',
      text: '保留这个标注',
    })
  })
})
