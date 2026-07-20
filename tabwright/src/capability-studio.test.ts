import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { createCapability } from './capability-registry.js'
import { startCapabilityStudio } from './capability-studio.js'

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

describe('capability studio', () => {
  test('serves the studio page and capability API', async () => {
    const cwd = createTempDir('capability-studio-')
    const server = await startCapabilityStudio({ host: '127.0.0.1', port: 0, cwd })
    try {
      createCapability({
        id: 'studio-tool',
        title: 'Studio Tool',
        location: 'project',
        cwd,
      })

      const pageResponse = await fetch(`http://${server.host}:${server.port}/`)
      const pageHtml = await pageResponse.text()
      expect(pageHtml).toContain('Tabwright Studio')
      expect(pageHtml).toContain('Operations')
      expect(pageHtml).toContain('Execution contract')

      const apiResponse = await fetch(`http://${server.host}:${server.port}/api/capabilities`)
      const capabilities = (await apiResponse.json()) as Array<{
        id: string
        title: string
        execution: { strategy: string }
      }>
      expect(capabilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'studio-tool',
            title: 'Studio Tool',
            execution: expect.objectContaining({ strategy: 'browser-ui' }),
          }),
        ]),
      )
    } finally {
      await server.close()
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
})
