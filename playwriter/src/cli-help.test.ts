// Verifies CLI help stays runnable without loading browser-start-only dependencies.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const playwriterDir = path.resolve(currentDir, '..')
const viteNodeBinary = path.join(
  playwriterDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node',
)

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(viteNodeBinary, ['src/cli.ts', ...args], {
    cwd: playwriterDir,
    env: process.env,
  })
}

describe('playwriter cli help', () => {
  test('renders root help without crashing', async () => {
    const { stdout, stderr } = await runCli(['--help'])

    expect(stdout).toContain('playwriter')
    expect(stdout).toContain('doctor')
    expect(stdout).toContain('serve')
    expect(stderr).toBe('')
  }, 30000)

  test('renders doctor help without starting the relay', async () => {
    const { stdout, stderr } = await runCli(['doctor', '--help'])

    expect(stdout).toContain('single best next step')
    expect(stdout).toContain('--json')
    expect(stderr).toBe('')
  }, 30000)

  test('reports an unreachable remote relay without crashing', async () => {
    const { stdout, stderr } = await runCli(['doctor', '--host', 'http://127.0.0.1:1', '--json'])
    const report = JSON.parse(stdout) as {
      ready: boolean
      checks: Array<{ id: string; status: string }>
    }

    expect(report.ready).toBe(false)
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'relay', status: 'fail' })]),
    )
    expect(stderr).toBe('')
  }, 30000)

  test('renders serve help without crashing', async () => {
    const { stdout, stderr } = await runCli(['serve', '--help'])

    expect(stdout).toContain('Start the relay server on this machine')
    expect(stdout).toContain('--replace')
    expect(stderr).toBe('')
  }, 30000)

  test('renders replay discovery and compact evidence help', async () => {
    const listHelp = await runCli(['replay', 'list', '--help'])
    const indexHelp = await runCli(['replay', 'index', '--help'])

    expect(listHelp.stdout).toContain('next commands')
    expect(listHelp.stdout).toContain('--limit')
    expect(indexHelp.stdout).toContain('--full')
    expect(listHelp.stderr).toBe('')
    expect(indexHelp.stderr).toBe('')
  }, 30000)

  test('teaches a fresh agent how to package and install capabilities', async () => {
    const { stdout, stderr } = await runCli(['skill'])
    const discoverySkill = fs.readFileSync(path.resolve(playwriterDir, '..', 'skills', 'playwriter', 'SKILL.md'), 'utf-8')

    expect(stdout).toContain('playwriter capability pack query-user')
    expect(stdout).toContain('playwriter capability install ./query-user.tgz')
    expect(stdout).toContain('A shared capability always installs as `draft`')
    expect(discoverySkill).toContain('playwriter capability pack <capability-id>')
    expect(discoverySkill).toContain('playwriter capability install ./<capability-id>.tgz')
    expect(stderr).toBe('')
  }, 30000)

  test('unknown command exits with code 1', async () => {
    try {
      await runCli(['run'])
      expect.unreachable('should have thrown')
    } catch (error: any) {
      expect(error.code).toBe(1)
      expect(error.stderr).toContain('Unknown command: run')
      expect(error.stderr).toContain('playwriter --help')
    }
  }, 30000)

  test('unknown subcommand exits with code 1', async () => {
    try {
      await runCli(['session', 'nonexistent'])
      expect.unreachable('should have thrown')
    } catch (error: any) {
      expect(error.code).toBe(1)
      expect(error.stdout).toContain('Unknown command: session nonexistent')
      expect(error.stdout).toContain('session new')
    }
  }, 30000)
})
