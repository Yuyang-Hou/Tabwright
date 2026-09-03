import crypto from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import type { ICDPSession } from './cdp-session.js'
import { Editor } from './editor.js'

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
})
