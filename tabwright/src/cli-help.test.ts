// Verifies CLI help stays runnable without loading browser-start-only dependencies.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const tabwrightDir = path.resolve(currentDir, '..')
const viteNodeBinary = path.join(
  tabwrightDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node',
)

async function runCliWithEnv(options: {
  args: string[]
  env?: NodeJS.ProcessEnv
}): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(viteNodeBinary, ['src/cli.ts', ...options.args], {
    cwd: tabwrightDir,
    env: options.env || process.env,
  })
}

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return runCliWithEnv({ args })
}

describe('tabwright cli help', () => {
  test('prints only one version line', async () => {
    const { stdout, stderr } = await runCli(['--version'])

    expect(stdout.trim().split('\n')).toHaveLength(1)
    expect(stdout).toMatch(/^tabwright\/\d+\.\d+\.\d+ /)
    expect(stderr).toBe('')
  }, 30000)

  test('renders root help without crashing', async () => {
    const { stdout, stderr } = await runCli(['--help'])

    expect(stdout).toContain('tabwright')
    expect(stdout).toContain('doctor')
    expect(stdout).toContain('docs [topic]')
    expect(stdout).toContain('serve')
    expect(stdout).not.toContain('skill runtime validate')
    expect(stdout).not.toContain('skill runtime run')
    expect(stdout).toContain('-e, --eval <code>')
    expect(stdout).not.toContain('tabwright  Start the MCP server')
    expect(stdout).not.toContain('capability create')
    expect(stdout).not.toContain('capability studio')
    expect(stdout).not.toContain('capability run')
    expect(stdout).not.toContain('replay compile')
    expect(stdout).not.toContain('replay make')
    expect(stdout).not.toContain('replay-to-capability')
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
    expect(report.checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'relay', status: 'fail' })]))
    expect(stderr).toBe('')
  }, 30000)

  test('renders serve help without crashing', async () => {
    const { stdout, stderr } = await runCli(['serve', '--help'])

    expect(stdout).toContain('Start the relay server on this machine')
    expect(stdout).toContain('--replace')
    expect(stderr).toBe('')
  }, 30000)

  test.each([['replay', 'list'], ['activity', 'list'], ['cloud', 'login'], ['skill', 'runtime', 'run']])(
    'rejects removed commands before execution: %s',
    async (...args) => {
      await expect(runCli(args)).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('No business request was sent.'),
      })
    },
    30000,
  )

  test('lists local references without connecting to a browser', async () => {
    const { stdout, stderr } = await runCliWithEnv({
      args: ['docs', '--json'],
      env: { ...process.env, TABWRIGHT_HOST: 'http://127.0.0.1:1' },
    })
    const report = JSON.parse(stdout) as {
      topics: Array<{ topic: string; description: string; command: string }>
    }

    expect(
      report.topics.map(({ topic, command }) => {
        return { topic, command }
      }),
    ).toEqual([
      { topic: 'browser', command: 'tabwright docs browser' },
      { topic: 'network', command: 'tabwright docs network' },
      { topic: 'editor', command: 'tabwright docs editor' },
      { topic: 'debugger', command: 'tabwright docs debugger' },
      { topic: 'styles', command: 'tabwright docs styles' },
      { topic: 'performance', command: 'tabwright docs performance' },
    ])
    expect(
      report.topics.every(({ description }) => {
        return description.length > 0
      }),
    ).toBe(true)
    expect(stderr).toBe('')
  }, 30000)

  test('renders local documentation pagination help', async () => {
    const { stdout, stderr } = await runCli(['docs', '--help'])

    expect(stdout).toContain('--offset <lines>')
    expect(stdout).toContain('--limit <lines>')
    expect(stdout).toContain('--json')
    expect(stderr).toBe('')
  }, 30000)

  test('introduces browser debugging, local references, and independent scripts', async () => {
    const { stdout, stderr } = await runCli(['skill'])
    const discoverySkill = fs.readFileSync(path.resolve(tabwrightDir, '..', 'skills', 'tabwright', 'SKILL.md'), 'utf-8')

    expect(stdout).toContain('# Browser Debugging')
    expect(stdout).toContain('createNetwork({ cdp, maxEntries? })')
    expect(stdout).toContain('### Local documentation')
    expect(stdout).toContain('tabwright docs editor --offset 160 --limit 120')
    expect(stdout).toContain('### Independent scripts and Skills')
    expect(stdout).not.toContain('Legacy `tabwright capability')
    expect(discoverySkill).toContain('tabwright docs network')
    expect(discoverySkill).toContain('tabwright docs editor')
    expect(discoverySkill).toContain('tabwright docs debugger')
    expect(discoverySkill).toContain('## Independent scripts')
    expect(stderr).toBe('')
  }, 30000)

  test('exposes automatic skill installation recovery and status commands', async () => {
    const instructions = await runCli(['skill'])
    const installHelp = await runCli(['skill', 'install', '--help'])
    const statusHelp = await runCli(['skill', 'status', '--help'])

    expect(instructions.stdout).toContain('installed automatically in')
    expect(instructions.stdout).toContain('tabwright skill install')
    expect(instructions.stdout).toContain('tabwright skill status')
    expect(installHelp.stdout).toContain('bundled with this CLI')
    expect(installHelp.stdout).toContain('agents, codex, or claude')
    expect(installHelp.stdout).toContain('--force')
    expect(statusHelp.stdout).toContain('matches this CLI')
    expect(instructions.stderr).toBe('')
    expect(installHelp.stderr).toBe('')
    expect(statusHelp.stderr).toBe('')
  }, 30000)

  test('unknown command exits with code 1', async () => {
    try {
      await runCli(['run'])
      expect.unreachable('should have thrown')
    } catch (error: any) {
      expect(error.code).toBe(1)
      expect(error.stderr).toContain('Unknown command: run')
      expect(error.stderr).toContain('tabwright --help')
    }
  }, 30000)

  test('explains that legacy capability commands require a Skill update', async () => {
    await expect(runCli(['capability', 'run', '/example/runtime', '--json'])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Migrate business validation'),
    })

    await expect(runCli(['capability', 'refresh-auth', '/example/runtime', '--json'])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Do not automatically translate'),
    })
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
