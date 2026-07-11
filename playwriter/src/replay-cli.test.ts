import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { RrwebEvent } from './protocol.js'

const execFileAsync = promisify(execFile)
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const playwriterDir = path.resolve(currentDir, '..')
const viteNodeBinary = path.join(
  playwriterDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node',
)
const cliPath = path.join(currentDir, 'cli.ts')

interface RecordingFixture {
  id: string
  savedAt: number
  url: string
  events: RrwebEvent[]
}

function createTempDir(prefix: string): string {
  const tempRoot = path.join(playwriterDir, 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

function writeJson(options: { filePath: string; value: unknown }): void {
  fs.mkdirSync(path.dirname(options.filePath), { recursive: true })
  fs.writeFileSync(options.filePath, `${JSON.stringify(options.value, null, 2)}\n`)
}

function textNode(options: { id: number; textContent: string }): Record<string, unknown> {
  return { id: options.id, type: 3, textContent: options.textContent }
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
    data: { source: 2, type: 2, id: options.id, x: 10, y: 10, pointerType: 0 },
  }
}

function inputEvent(options: { timestamp: number; id: number; text: string }): RrwebEvent {
  return {
    type: 3,
    timestamp: options.timestamp,
    data: { source: 5, id: options.id, text: options.text, isChecked: false },
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
                    elementNode({
                      id: 10,
                      tagName: 'button',
                      childNodes: [textNode({ id: 11, textContent: '编辑' })],
                    }),
                    elementNode({
                      id: 12,
                      tagName: 'button',
                      attributes: { class: 'designer-formily-array-base-addition' },
                    }),
                    elementNode({ id: 14, tagName: 'textarea', attributes: { class: 'designer-input' } }),
                    elementNode({
                      id: 16,
                      tagName: 'button',
                      childNodes: [textNode({ id: 17, textContent: '提交' })],
                    }),
                    elementNode({
                      id: 18,
                      tagName: 'button',
                      childNodes: [textNode({ id: 19, textContent: 'OK' })],
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
    clickEvent({ timestamp: 1200, id: 12 }),
    inputEvent({ timestamp: 1300, id: 14, text: 'test2' }),
    clickEvent({ timestamp: 1400, id: 16 }),
    clickEvent({ timestamp: 1500, id: 18 }),
  ]
}

function createUnsupportedReplayEvents(): RrwebEvent[] {
  return [
    {
      type: 2,
      timestamp: 1000,
      data: { node: { id: 1, type: 0, childNodes: [] } },
    },
  ]
}

function writeRecordings(options: { home: string; recordings: RecordingFixture[] }): void {
  const recordingsDir = path.join(options.home, '.playwriter', 'rrweb-recordings')
  const metadata = options.recordings.map((recording, index) => {
    const replayPath = path.join(recordingsDir, `${recording.id}.json`)
    writeJson({ filePath: replayPath, value: recording.events })
    return {
      id: recording.id,
      path: replayPath,
      startedAt: 1000,
      savedAt: recording.savedAt,
      duration: 500 + index,
      size: 100,
      eventCount: recording.events.length,
      tabId: index + 1,
      sessionId: `session-${index + 1}`,
      url: recording.url,
    }
  })
  writeJson({ filePath: path.join(recordingsDir, 'index.json'), value: metadata })
}

function runCli(options: { cwd: string; home: string; args: string[] }): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(viteNodeBinary, [cliPath, ...options.args], {
    cwd: options.cwd,
    env: { ...process.env, HOME: options.home, USERPROFILE: options.home },
  })
}

describe('replay CLI handoff', () => {
  test('lists local recordings newest first without exposing machine-local metadata', async () => {
    const home = createTempDir('replay-cli-list-home-')
    const cwd = createTempDir('replay-cli-list-cwd-')
    try {
      writeRecordings({
        home,
        recordings: [
          {
            id: 'older-replay',
            savedAt: 2000,
            url: 'https://example.com/older',
            events: createUnsupportedReplayEvents(),
          },
          {
            id: 'newer-replay',
            savedAt: 3000,
            url: 'https://example.com/newer',
            events: createUnsupportedReplayEvents(),
          },
        ],
      })

      const { stdout, stderr } = await runCli({ cwd, home, args: ['replay', 'list', '--limit', '2', '--json'] })
      const result = JSON.parse(stdout) as {
        recordings: Array<{ id: string; commands: { inspect: string; make: string } }>
      }

      expect(result.recordings.map((recording) => recording.id)).toEqual(['newer-replay', 'older-replay'])
      expect(result.recordings[0]?.commands.inspect).toContain('replay index')
      expect(result.recordings[0]?.commands.make).toContain('replay make')
      expect(stdout).not.toContain(home)
      expect(stdout).not.toContain('sessionId')
      expect(stdout).not.toContain('tabId')
      expect(stderr).toBe('')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }, 30000)

  test('prints compact replay evidence by default and full evidence on request', async () => {
    const home = createTempDir('replay-cli-index-home-')
    const cwd = createTempDir('replay-cli-index-cwd-')
    try {
      writeRecordings({
        home,
        recordings: [
          {
            id: 'indexed-replay',
            savedAt: 2000,
            url: 'https://example.com/indexed',
            events: createListAppendReplayEvents(),
          },
        ],
      })

      const compactRun = await runCli({ cwd, home, args: ['replay', 'index', 'indexed-replay', '--json'] })
      const compact = JSON.parse(compactRun.stdout) as {
        index: { pageText?: string[]; interactiveElements?: unknown[]; omitted?: Record<string, number> }
      }
      expect(compact.index).not.toHaveProperty('pageText')
      expect(compact.index).not.toHaveProperty('interactiveElements')
      expect(compact.index.omitted).toEqual(
        expect.objectContaining({ pageText: expect.any(Number), interactiveElements: expect.any(Number) }),
      )

      const fullRun = await runCli({ cwd, home, args: ['replay', 'index', 'indexed-replay', '--full', '--json'] })
      const full = JSON.parse(fullRun.stdout) as { index: { pageText: string[]; interactiveElements: unknown[] } }
      expect(full.index.pageText).toBeInstanceOf(Array)
      expect(full.index.interactiveElements).toBeInstanceOf(Array)
      expect(compactRun.stderr).toBe('')
      expect(fullRun.stderr).toBe('')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }, 30000)

  test('returns a needs_ai handoff without writing a fake capability', async () => {
    const home = createTempDir('replay-cli-unsupported-home-')
    const cwd = createTempDir('replay-cli-unsupported-cwd-')
    try {
      writeRecordings({
        home,
        recordings: [
          {
            id: 'unsupported-replay',
            savedAt: 2000,
            url: 'https://example.com/unsupported',
            events: createUnsupportedReplayEvents(),
          },
        ],
      })

      const { stdout, stderr } = await runCli({
        cwd,
        home,
        args: ['replay', 'make', 'unsupported-replay', 'unsupported-capability', '--force', '--json'],
      })
      const result = JSON.parse(stdout) as {
        status: string
        capabilityWritten: boolean
        next: { action: string; inspectCommand: string; createCommand: string }
      }

      expect(result).toMatchObject({ status: 'needs_ai', capabilityWritten: false })
      expect(result.next.action).toBe('author_capability')
      expect(result.next.inspectCommand).toContain('replay index')
      expect(result.next.createCommand).toContain('capability create')
      expect(fs.existsSync(path.join(cwd, '.playwriter', 'capabilities', 'unsupported-capability'))).toBe(false)
      expect(stderr).toBe('')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }, 30000)

  test('returns a compact compiled handoff with an approval-gated run command', async () => {
    const home = createTempDir('replay-cli-compiled-home-')
    const cwd = createTempDir('replay-cli-compiled-cwd-')
    try {
      writeRecordings({
        home,
        recordings: [
          {
            id: 'supported-replay',
            savedAt: 2000,
            url: 'https://admin.example.com/#/config?key=config_demo_simple_COPY123',
            events: createListAppendReplayEvents(),
          },
        ],
      })

      const { stdout, stderr } = await runCli({
        cwd,
        home,
        args: ['replay', 'make', 'supported-replay', 'compiled-capability', '--force', '--json'],
      })
      const result = JSON.parse(stdout) as {
        status: string
        evidence: { pageText?: string[]; interactiveElements?: unknown[] }
        next: { requiresUserConfirmation: boolean; runCommand: string }
      }

      expect(result.status).toBe('compiled')
      expect(result.evidence).not.toHaveProperty('pageText')
      expect(result.evidence).not.toHaveProperty('interactiveElements')
      expect(result.next.requiresUserConfirmation).toBe(true)
      expect(result.next.runCommand).toContain('--browser user')
      expect(result.next.runCommand).toContain('--confirm \'compiled-capability\'')
      expect(result.next.runCommand).toContain('--json')
      expect(fs.existsSync(path.join(cwd, '.playwriter', 'capabilities', 'compiled-capability'))).toBe(true)
      expect(stderr).toBe('')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }, 30000)
})
