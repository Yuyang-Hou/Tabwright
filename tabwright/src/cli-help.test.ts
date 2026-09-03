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
    expect(stdout).toContain('serve')
    expect(stdout).toContain('skill runtime validate')
    expect(stdout).toContain('skill runtime run')
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

  test('renders replay discovery and compact evidence help', async () => {
    const listHelp = await runCli(['replay', 'list', '--help'])
    const indexHelp = await runCli(['replay', 'index', '--help'])

    expect(listHelp.stdout).toContain('inspect command')
    expect(listHelp.stdout).toContain('--limit')
    expect(indexHelp.stdout).toContain('--full')
    expect(listHelp.stderr).toBe('')
    expect(indexHelp.stderr).toBe('')
  }, 30000)

  test('teaches a fresh agent to author and run independent Agent Skills directly', async () => {
    const { stdout, stderr } = await runCli(['skill'])
    const discoverySkill = fs.readFileSync(path.resolve(tabwrightDir, '..', 'skills', 'tabwright', 'SKILL.md'), 'utf-8')

    expect(stdout).toContain('tabwright skill runtime validate "/absolute/path/to/query-user"')
    expect(stdout).toContain('tabwright skill runtime run "/absolute/path/to/query-user"')
    expect(stdout).not.toContain('Legacy `tabwright capability')
    expect(discoverySkill).toContain('tabwright skill runtime validate "<absolute-skill-directory>"')
    expect(discoverySkill).toContain('do not copy its runtime into Tabwright storage')
    expect(stderr).toBe('')
  }, 30000)

  test('validates and runs a Skill-owned runtime without a capability registry entry', async () => {
    const testRoot = path.join(tabwrightDir, 'tmp', `skill-runtime-cli-${process.pid}-${Date.now()}`)
    const skillDir = path.join(testRoot, 'cli-runtime-test')
    const runtimeDir = path.join(skillDir, 'runtime')
    const isolatedHome = path.join(testRoot, 'home')
    fs.mkdirSync(runtimeDir, { recursive: true })
    fs.mkdirSync(isolatedHome, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: cli-runtime-test\ndescription: Test Skill runtime.\n---\n',
    )
    fs.writeFileSync(
      path.join(runtimeDir, 'capability.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          id: 'cli-runtime-test',
          title: 'CLI runtime test',
          inputSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
          outputSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
          sideEffect: 'read',
          requiresConfirmation: false,
          entry: 'script.js',
          runtime: 'node',
          status: 'draft',
          createdBy: 'ai',
        },
        null,
        2,
      )}\n`,
    )
    fs.writeFileSync(path.join(runtimeDir, 'script.js'), 'throw new Error("validation must not execute this")\n')

    try {
      const env = { ...process.env, HOME: isolatedHome, USERPROFILE: isolatedHome }
      const validated = await runCliWithEnv({
        args: ['skill', 'runtime', 'validate', skillDir, '--json'],
        env,
      })
      expect(JSON.parse(validated.stdout)).toMatchObject({
        valid: true,
        skill: { id: 'cli-runtime-test', dir: skillDir },
        runtime: { dir: runtimeDir, type: 'node', sideEffect: 'read', requiresConfirmation: false },
      })
      expect(validated.stderr).toBe('')

      fs.writeFileSync(path.join(runtimeDir, 'script.js'), 'return { value: input.value }\n')
      const executed = await runCliWithEnv({
        args: ['skill', 'runtime', 'run', skillDir, '--input-json', '{"value":"ok"}', '--json'],
        env,
      })
      expect(JSON.parse(executed.stdout)).toMatchObject({
        runtime: 'cli-runtime-test',
        output: { value: 'ok' },
        isError: false,
      })
      expect(executed.stderr).toBe('')
      expect(fs.existsSync(path.join(isolatedHome, '.tabwright', 'capabilities'))).toBe(false)
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true })
    }
  }, 30000)

  test('exposes automatic skill installation recovery and status commands', async () => {
    const instructions = await runCli(['skill'])
    const installHelp = await runCli(['skill', 'install', '--help'])
    const statusHelp = await runCli(['skill', 'status', '--help'])

    expect(instructions.stdout).toContain('Global CLI installation creates or safely updates')
    expect(instructions.stdout).toContain('tabwright skill install')
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
