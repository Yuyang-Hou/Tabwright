import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { createCapability, updateCapabilityManifest, updateCapabilityScript } from './capability-registry.js'

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

function createTempDir(prefix: string): string {
  const tempRoot = path.join(playwriterDir, 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

function runCli(options: { cwd: string; args: string[] }): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(viteNodeBinary, [cliPath, ...options.args], {
    cwd: options.cwd,
    env: process.env,
  })
}

describe('capability CLI confirmation', () => {
  test('force cannot execute a confirmation-required script without the exact id', async () => {
    const cwd = createTempDir('capability-cli-confirmation-')
    try {
      const capability = createCapability({
        id: 'confirmed-cli-write',
        location: 'project',
        cwd,
        runtime: 'node',
      })
      updateCapabilityScript({
        id: capability.manifest.id,
        cwd,
        source: 'artifacts.writeText({ filename: "executed.txt", text: "yes" }); return { ok: true };',
      })
      updateCapabilityManifest({
        id: capability.manifest.id,
        cwd,
        allowUnvalidatedTrust: true,
        patch: { status: 'trusted', sideEffect: 'write', requiresConfirmation: true },
      })
      const markerPath = path.join(capability.dir, 'artifacts', 'executed.txt')

      await expect(
        runCli({
          cwd,
          args: ['capability', 'run', capability.manifest.id, '--force', '--input-json', '{}', '--json'],
        }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('requires explicit user confirmation'),
      })
      expect(fs.existsSync(markerPath)).toBe(false)

      const runStartedAt = Date.now()
      const { stdout, stderr } = await runCli({
        cwd,
        args: [
          'capability',
          'run',
          capability.manifest.id,
          '--force',
          '--confirm',
          capability.manifest.id,
          '--input-json',
          '{}',
          '--json',
        ],
      })
      expect(JSON.parse(stdout)).toMatchObject({ capability: capability.manifest.id, output: { ok: true } })
      expect(stderr).toBe('')
      expect(fs.readFileSync(markerPath, 'utf-8')).toBe('yes')
      expect(Date.now() - runStartedAt).toBeLessThan(5000)
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }, 30000)
})
