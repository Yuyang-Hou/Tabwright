import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@xmorse/playwright-core'
import { expect, test } from 'vitest'
import { getCDPResources } from './cdp-resources.js'
import { getCDPSessionForPage, type ICDPSession } from './cdp-session.js'
import { Debugger } from './debugger.js'
import { Editor } from './editor.js'
import { NetworkInspector } from './network-inspector.js'
import { getLocalChromeExecutable } from './test-utils.js'

function nextPause(cdp: ICDPSession): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = () => {
      clearTimeout(timeout)
      cdp.off('Debugger.paused', listener)
      resolve()
    }
    const timeout = setTimeout(() => {
      cdp.off('Debugger.paused', listener)
      reject(new Error('Breakpoint did not pause within 5 seconds'))
    }, 5000)
    cdp.on('Debugger.paused', listener)
  })
}

test('late source inspection preserves breakpoints, paused locals and fresh navigation resources', async () => {
  const root = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(root, { recursive: true })
  const profile = fs.mkdtempSync(path.join(root, 'cdp-resources-browser-'))
  const scriptUrl = 'https://fixture.invalid/probe-app.js'
  const html = `<style>body { color: rgb(1, 2, 3); }</style><script>
window.probe = function probe() {
  const marker = 41;
  return marker + 1;
};
//# sourceURL=${scriptUrl}
</script><p>Isolated CDP fixture</p>`
  try {
    const executablePath = getLocalChromeExecutable()
    const context = await chromium.launchPersistentContext(profile, {
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      headless: true,
    })
    try {
      const page = await context.newPage()
      await page.goto(`data:text/html,${encodeURIComponent(html)}`)
      const cdp = await getCDPSessionForPage({ page })
      expect(await getCDPSessionForPage({ page })).toBe(cdp)
      const network = new NetworkInspector({ cdp })
      await network.enable()
      await cdp.send('DOM.enable')
      await cdp.send('CSS.enable')
      const dbg = new Debugger({ cdp })
      expect(
        (await dbg.listScripts()).map((script) => {
          return script.url
        }),
      ).toContain(scriptUrl)
      await dbg.setBreakpoint({ file: scriptUrl, line: 4 })
      const paused = nextPause(cdp)
      const evaluation = cdp.send('Runtime.evaluate', { expression: 'window.probe()', returnByValue: true })
      await paused

      const editor = new Editor({ cdp })
      expect(await editor.list()).toContain(scriptUrl)
      expect((await editor.readRaw({ url: scriptUrl })).content).toContain('const marker = 41')
      const stylesheet = Array.from(getCDPResources(cdp).stylesheets.values())[0]
      expect(stylesheet).toBeDefined()
      expect((await editor.read({ url: stylesheet.url })).content).toContain('rgb(1, 2, 3)')
      expect(dbg.isPaused()).toBe(true)
      expect(await dbg.evaluate({ expression: 'marker' })).toEqual({ value: 41 })
      await cdp.detach()
      expect(await getCDPSessionForPage({ page })).toBe(cdp)
      await dbg.resume()
      expect((await evaluation).result.value).toBe(42)

      const pausedAgain = nextPause(cdp)
      const evaluatedAgain = cdp.send('Runtime.evaluate', { expression: 'window.probe()', returnByValue: true })
      await pausedAgain
      expect(await dbg.evaluate({ expression: 'marker' })).toEqual({ value: 41 })
      await dbg.resume()
      expect((await evaluatedAgain).result.value).toBe(42)

      const nextScriptUrl = scriptUrl.replace('probe-app', 'probe-next')
      await page.goto(
        `data:text/html,${encodeURIComponent(html.replace(scriptUrl, nextScriptUrl).replace('marker = 41', 'marker = 99'))}`,
      )
      await expect
        .poll(() => {
          return getCDPResources(cdp).stylesheets.size
        })
        .toBe(1)
      expect(await editor.list()).not.toContain(scriptUrl)
      expect((await editor.readRaw({ url: nextScriptUrl })).content).toContain('const marker = 99')
      expect(getCDPResources(cdp).stylesheets.has(stylesheet.styleSheetId)).toBe(false)
      expect(
        (await dbg.listScripts()).map((script) => {
          return script.url
        }),
      ).not.toContain(scriptUrl)
      await network.dispose()
    } finally {
      await context.close()
    }
  } finally {
    fs.rmSync(profile, { recursive: true, force: true })
  }
})
