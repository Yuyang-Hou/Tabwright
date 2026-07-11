import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { startPlayWriterCDPRelayServer } from './cdp-relay.js'
import {
  getExtensionServiceWorker,
  getLegacyExtensionLaunchArgs,
  isExtensionLoadUnavailableError,
  launchPersistentContextWithExtensions,
} from './test-utils.js'

describe('extension test browser launch', () => {
  test('builds the legacy extension launch fallback flags', () => {
    const extensionPaths = ['./extension-one', './extension-two']
    const args = getLegacyExtensionLaunchArgs({ extensionPaths })
    const resolvedPaths = extensionPaths.map((extensionPath) => {
      return path.resolve(extensionPath)
    })

    expect(args).toContain(`--disable-extensions-except=${resolvedPaths.join(',')}`)
    expect(args).toContain(`--load-extension=${resolvedPaths.join(',')}`)
  })

  test('recognizes older browsers without Extensions.loadUnpacked', () => {
    expect(
      isExtensionLoadUnavailableError(
        new Error("Protocol error (Extensions.loadUnpacked): 'Extensions.loadUnpacked' wasn't found"),
      ),
    ).toBe(true)
    expect(isExtensionLoadUnavailableError(new Error('Method not found'))).toBe(true)
    expect(isExtensionLoadUnavailableError(new Error('Manifest is invalid'))).toBe(false)
  })

  test.runIf(Boolean(process.env.PLAYWRITER_TEST_EXTENSION_PATH))(
    'loads an unpacked extension in the installed Chrome build',
    async () => {
      const extensionPath = process.env.PLAYWRITER_TEST_EXTENSION_PATH
      if (!extensionPath) {
        throw new Error('PLAYWRITER_TEST_EXTENSION_PATH is required')
      }

      const tempRoot = path.join(process.cwd(), 'tmp')
      fs.mkdirSync(tempRoot, { recursive: true })
      const userDataDir = fs.mkdtempSync(path.join(tempRoot, 'pw-extension-load-test-'))
      const relayServer = await startPlayWriterCDPRelayServer({
        port: Number(process.env.PLAYWRITER_TEST_RELAY_PORT) || 19_997,
      })
      try {
        const browserContext = await launchPersistentContextWithExtensions({
          userDataDir,
          extensionPaths: [extensionPath],
        })
        try {
          const serviceWorker = await getExtensionServiceWorker(browserContext).catch(async (error: unknown) => {
            const session = await browserContext.browser()?.newBrowserCDPSession()
            const targets = session ? await session.send('Target.getTargets') : null
            throw new Error(`No extension service worker target was visible: ${JSON.stringify(targets)}`, { cause: error })
          })
          expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\//)
        } finally {
          await browserContext.close()
        }
      } finally {
        relayServer.close()
        fs.rmSync(userDataDir, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
