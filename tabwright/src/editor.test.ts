import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ICDPSession } from './cdp-session.js'
import { Editor } from './editor.js'

const testDirs: string[] = []

function createTestDir(): string {
  const root = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(root, { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, 'editor-test-'))
  testDirs.push(directory)
  return directory
}

afterEach(() => {
  testDirs.map((directory) => {
    fs.rmSync(directory, { recursive: true, force: true })
    return directory
  })
})

describe('Editor.readRaw', () => {
  test('returns exact script source and deployment provenance', async () => {
    const source = '(()=>{const mode="global";return mode})()'
    const scriptUrl = 'https://example.com/assets/app.min.js'
    const listeners = new Map<string, Array<(params: unknown) => void>>()
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === 'Debugger.enable') {
          listeners.get('Debugger.scriptParsed')?.map((listener) => {
            listener({
              scriptId: 'script-1',
              url: scriptUrl,
              sourceMapURL: 'app.min.js.map',
            })
            return listener
          })
        }
        if (method === 'Debugger.getScriptSource') {
          return { scriptSource: source }
        }
        return {}
      }),
      on: vi.fn((event: string, listener: (params: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) || []), listener])
      }),
      off: vi.fn((event: string, listener: (params: unknown) => void) => {
        listeners.set(
          event,
          (listeners.get(event) || []).filter((candidate) => candidate !== listener),
        )
      }),
      detach: vi.fn(async () => {}),
    } as unknown as ICDPSession

    const editor = new Editor({ cdp })
    const result = await editor.readRaw({ url: scriptUrl })

    expect(result).toEqual({
      url: scriptUrl,
      content: source,
      sha256: crypto.createHash('sha256').update(source).digest('hex'),
      sourceMapURL: 'app.min.js.map',
    })
  })

  test('saves exact script source once by content hash', async () => {
    const cwd = createTestDir()
    const source = '(()=>{const endpoint="/api/items";return endpoint})()'
    const scriptUrl = 'https://example.com/assets/app.min.js'
    const listeners = new Map<string, Array<(params: unknown) => void>>()
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === 'Debugger.enable') {
          listeners.get('Debugger.scriptParsed')?.map((listener) => {
            listener({ scriptId: 'script-1', url: scriptUrl, sourceMapURL: 'app.min.js.map' })
            return listener
          })
        }
        if (method === 'Debugger.getScriptSource') {
          return { scriptSource: source }
        }
        return {}
      }),
      on: vi.fn((event: string, listener: (params: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) || []), listener])
      }),
      off: vi.fn((event: string, listener: (params: unknown) => void) => {
        listeners.set(
          event,
          (listeners.get(event) || []).filter((candidate) => candidate !== listener),
        )
      }),
      detach: vi.fn(async () => {}),
    } as unknown as ICDPSession

    const editor = new Editor({ cdp, cwd })
    const first = await editor.saveRaw({ url: scriptUrl })
    const second = await editor.saveRaw({ url: scriptUrl })

    expect(first.cacheHit).toBe(false)
    expect(second).toEqual({ ...first, cacheHit: true })
    expect(first.path).toBe(path.join(cwd, '.tabwright', 'artifacts', 'web', 'blobs', `${first.sha256}.js`))
    expect(fs.readFileSync(first.path, 'utf8')).toBe(source)
  })
})
