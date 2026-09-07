import events from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import type { CDPSession, Page } from '@xmorse/playwright-core'
import { getCDPResources } from './cdp-resources.js'
import { getCDPSessionForPage, type ICDPSession } from './cdp-session.js'
import { Debugger } from './debugger.js'
import { Editor } from './editor.js'
import { NetworkInspector } from './network-inspector.js'

function createSession() {
  const emitter = new events.EventEmitter()
  const enabled = new Set<string>()
  const sources = new Map<string, string>([
    ['script-1', 'const value = 1'],
    ['style-1', 'body { color: red; }'],
  ])
  const send = vi.fn(async (method: string, params?: { scriptId?: string; styleSheetId?: string }) => {
    if (method.endsWith('.enable') && !enabled.has(method)) {
      enabled.add(method)
      if (method === 'Debugger.enable') {
        emitter.emit('Debugger.scriptParsed', {
          scriptId: 'script-1',
          url: 'https://example.com/app.js',
          executionContextId: 1,
          sourceMapURL: 'app.js.map',
          stackTrace: { mustNotBeRetained: true },
        })
      }
      if (method === 'CSS.enable') {
        emitter.emit('CSS.styleSheetAdded', {
          header: { styleSheetId: 'style-1', sourceURL: 'https://example.com/style.css' },
        })
      }
    }
    if (method === 'Debugger.getScriptSource') {
      return { scriptSource: sources.get(params?.scriptId || '') }
    }
    if (method === 'CSS.getStyleSheetText') {
      return { text: sources.get(params?.styleSheetId || '') }
    }
    return {}
  })
  const cdp = {
    send,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    detach: vi.fn(async () => {}),
  } as unknown as ICDPSession
  return { cdp, emitter, send, sources }
}

describe('shared CDP resources', () => {
  test('subscribes once without enabling domains and retains only metadata', async () => {
    const { cdp, emitter, send } = createSession()
    const resources = getCDPResources(cdp)
    expect(getCDPResources(cdp)).toBe(resources)
    expect(send).not.toHaveBeenCalled()
    expect(emitter.listenerCount('Debugger.scriptParsed')).toBe(1)
    await cdp.send('Debugger.enable')
    expect(resources.scripts.get('script-1')).toEqual({
      scriptId: 'script-1',
      url: 'https://example.com/app.js',
      executionContextId: 1,
      sourceMapURL: 'app.js.map',
    })
  })

  test('late Editor and Debugger discover resources enabled by Network without resetting domains', async () => {
    const { cdp, emitter, send } = createSession()
    const network = new NetworkInspector({ cdp })
    await network.enable()
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const editor = new Editor({ cdp })
    expect(await editor.list()).toEqual(['https://example.com/app.js', 'https://example.com/style.css'])
    expect((await editor.readRaw({ url: 'https://example.com/app.js' })).content).toBe('const value = 1')
    expect((await editor.read({ url: 'https://example.com/style.css' })).content).toContain('color: red')
    expect(await new Debugger({ cdp }).listScripts()).toEqual([
      { scriptId: 'script-1', url: 'https://example.com/app.js' },
    ])
    expect(
      send.mock.calls
        .map(([method]) => {
          return method
        })
        .filter((method) => {
          return method.endsWith('.disable')
        }),
    ).toEqual([])
    expect(emitter.listenerCount('Debugger.scriptParsed')).toBe(1)
    expect(emitter.listenerCount('CSS.styleSheetAdded')).toBe(1)
    await network.dispose()
  })

  test('invalidates styles and source caches, and does not retain resources across navigation', async () => {
    const { cdp, emitter, sources } = createSession()
    const editor = new Editor({ cdp })
    await editor.enable()
    await editor.readRaw({ url: 'https://example.com/app.js' })
    await editor.read({ url: 'https://example.com/style.css' })
    sources.set('style-1', 'body { color: blue; }')
    emitter.emit('CSS.styleSheetChanged', { styleSheetId: 'style-1' })
    expect((await editor.read({ url: 'https://example.com/style.css' })).content).toContain('color: blue')
    emitter.emit('CSS.styleSheetRemoved', { styleSheetId: 'style-1' })
    expect(await editor.list()).toEqual(['https://example.com/app.js'])
    emitter.emit('Debugger.scriptParsed', {
      scriptId: 'child',
      url: 'https://example.com/child.js',
      executionContextId: 2,
    })
    emitter.emit('Runtime.executionContextDestroyed', { executionContextId: 2 })
    expect(await editor.list()).toEqual(['https://example.com/app.js'])
    emitter.emit('CSS.styleSheetAdded', {
      header: { styleSheetId: 'old-style', sourceURL: 'https://example.com/old.css' },
    })
    emitter.emit('Runtime.executionContextsCleared')
    expect(await editor.list()).toEqual([])
    sources.set('script-1', 'const value = 2')
    emitter.emit('Debugger.scriptParsed', {
      scriptId: 'script-1',
      url: 'https://example.com/app.js',
      executionContextId: 3,
    })
    expect((await editor.readRaw({ url: 'https://example.com/app.js' })).content).toBe('const value = 2')
  })

  test.each([
    { url: 'https://example.com/app.js', id: 'script-1', method: 'Debugger.getScriptSource' },
    { url: 'https://example.com/style.css', id: 'style-1', method: 'CSS.getStyleSheetText' },
  ])('does not let a late source response replace the current $method cache', async ({ url, id, method }) => {
    const { cdp, emitter, send, sources } = createSession()
    const editor = new Editor({ cdp })
    await editor.enable()
    const releases: Array<() => void> = []
    send.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releases.push(resolve)
      })
      return method === 'CSS.getStyleSheetText' ? { text: 'old source' } : { scriptSource: 'old source' }
    })

    const oldRead = editor.read({ url })
    await vi.waitFor(() => {
      expect(releases).toHaveLength(1)
    })
    sources.set(id, 'new source')
    if (id === 'style-1') {
      emitter.emit('CSS.styleSheetChanged', { styleSheetId: id })
    } else {
      emitter.emit('Debugger.scriptParsed', { scriptId: id, url, executionContextId: 1 })
    }
    try {
      expect((await editor.read({ url })).content).toContain('new source')
    } finally {
      releases[0]()
    }
    expect((await oldRead).content).toContain('old source')
    expect((await editor.read({ url })).content).toContain('new source')
    expect(
      send.mock.calls.filter(([calledMethod]) => {
        return calledMethod === method
      }),
    ).toHaveLength(2)
  })

  test('coalesces Page adapters, retries failed creation, and preserves borrowed detach semantics', async () => {
    const { cdp } = createSession()
    const getExistingCDPSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('not connected'))
      .mockResolvedValue(cdp as unknown as CDPSession)
    const page = {
      isClosed: () => {
        return false
      },
      context: () => {
        return { getExistingCDPSession }
      },
    } as unknown as Page
    await expect(getCDPSessionForPage({ page })).rejects.toThrow('not connected')
    const [first, second] = await Promise.all([getCDPSessionForPage({ page }), getCDPSessionForPage({ page })])
    expect(first).toBe(second)
    expect(getExistingCDPSession).toHaveBeenCalledTimes(2)
    await first.detach()
    expect(await getCDPSessionForPage({ page })).toBe(first)
    expect(getExistingCDPSession).toHaveBeenCalledTimes(2)
  })
})
