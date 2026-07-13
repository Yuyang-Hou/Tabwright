import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installCapabilityPackage, packCapability } from './capability-package.js'
import { createCapability, updateCapabilityManifest, updateCapabilityScript, writeCapabilitySecrets } from './capability-registry.js'

describe('capability package sharing', () => {
  let testRoot: string
  let sourceCwd: string
  let recipientCwd: string

  beforeEach(() => {
    const tmpRoot = path.join(process.cwd(), 'tmp')
    fs.mkdirSync(tmpRoot, { recursive: true })
    testRoot = fs.mkdtempSync(path.join(tmpRoot, 'capability-package-'))
    sourceCwd = path.join(testRoot, 'source')
    recipientCwd = path.join(testRoot, 'recipient')
    fs.mkdirSync(sourceCwd, { recursive: true })
    fs.mkdirSync(recipientCwd, { recursive: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fs.rmSync(testRoot, { recursive: true, force: true })
  })

  it('packs only shareable files and installs the recipient copy as draft', async () => {
    const source = createCapability({
      id: 'shared-query',
      title: 'Shared query',
      description: 'Queries shared data.',
      location: 'project',
      cwd: sourceCwd,
      runtime: 'node',
    })
    updateCapabilityScript({
      id: source.manifest.id,
      cwd: sourceCwd,
      source: 'return { ok: true }\n',
    })
    updateCapabilityManifest({
      id: source.manifest.id,
      cwd: sourceCwd,
      allowUnvalidatedTrust: true,
      patch: {
        status: 'trusted',
        auth: {
          type: 'cookie',
          refresh: 'from-browser',
          browserUrls: ['https://example.com'],
          requiredCookieNames: ['session'],
          failureSignals: ['unauthorized'],
        },
      },
    })
    const capabilityDir = source.dir
    writeCapabilitySecrets({ capability: source, secrets: { cookieHeader: 'secret-value' } })
    fs.writeFileSync(path.join(capabilityDir, 'runs.jsonl'), '{"private":"run"}\n')
    fs.mkdirSync(path.join(capabilityDir, 'artifacts'), { recursive: true })
    fs.writeFileSync(path.join(capabilityDir, 'artifacts', 'private.json'), '{}\n')
    fs.mkdirSync(path.join(capabilityDir, 'agent-skills', 'codex', 'agents'), { recursive: true })
    fs.writeFileSync(
      path.join(capabilityDir, 'agent-skills', 'codex', 'SKILL.md'),
      '---\nname: shared-query\ndescription: Use shared query.\n---\n',
    )
    fs.writeFileSync(path.join(capabilityDir, 'agent-skills', 'codex', 'agents', 'openai.yaml'), 'name: Shared query\n')

    const archivePath = path.join(testRoot, 'shared-query.tgz')
    const packed = await packCapability({ id: source.manifest.id, cwd: sourceCwd, output: archivePath })
    const installed = await installCapabilityPackage({
      source: packed.path,
      cwd: recipientCwd,
      location: 'project',
    })

    expect(packed.files).toEqual([
      'README.md',
      'agent-skills/codex/SKILL.md',
      'agent-skills/codex/agents/openai.yaml',
      'capability.json',
      'script.js',
    ])
    expect(installed.capability.manifest.status).toBe('draft')
    expect(fs.readFileSync(installed.capability.scriptPath, 'utf-8')).toBe('return { ok: true }\n')
    expect(installed.agentSkillAvailable).toBe(true)
    expect(fs.existsSync(path.join(installed.capability.dir, 'secrets.json'))).toBe(false)
    expect(fs.existsSync(path.join(installed.capability.dir, 'runs.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(installed.capability.dir, 'artifacts'))).toBe(false)
    expect(installed.integrity).toBe(packed.integrity)
  })

  it('installs directly from a capability directory without copying local state', async () => {
    const source = createCapability({
      id: 'directory-query',
      location: 'project',
      cwd: sourceCwd,
      runtime: 'node',
    })
    updateCapabilityScript({ id: source.manifest.id, cwd: sourceCwd, source: 'return input\n' })
    writeCapabilitySecrets({ capability: source, secrets: { token: 'do-not-copy' } })

    const installed = await installCapabilityPackage({
      source: source.dir,
      cwd: recipientCwd,
      location: 'project',
    })

    expect(installed.capability.manifest.status).toBe('draft')
    expect(fs.existsSync(path.join(installed.capability.dir, 'secrets.json'))).toBe(false)
    expect(installed.files).toEqual(['README.md', 'capability.json', 'script.js'])
  })

  it('requires force before replacing package files and preserves recipient secrets', async () => {
    const source = createCapability({
      id: 'replace-query',
      location: 'project',
      cwd: sourceCwd,
      runtime: 'node',
    })
    updateCapabilityScript({ id: source.manifest.id, cwd: sourceCwd, source: 'return { version: 2 }\n' })
    const archive = await packCapability({
      id: source.manifest.id,
      cwd: sourceCwd,
      output: path.join(testRoot, 'replace-query.tgz'),
    })
    const existing = createCapability({
      id: source.manifest.id,
      location: 'project',
      cwd: recipientCwd,
      runtime: 'node',
    })
    writeCapabilitySecrets({ capability: existing, secrets: { token: 'recipient-only' } })

    await expect(
      installCapabilityPackage({ source: archive.path, cwd: recipientCwd, location: 'project' }),
    ).rejects.toThrow('Use --force')

    const installed = await installCapabilityPackage({
      source: archive.path,
      cwd: recipientCwd,
      location: 'project',
      overwrite: true,
    })
    expect(fs.readFileSync(installed.capability.scriptPath, 'utf-8')).toBe('return { version: 2 }\n')
    expect(JSON.parse(fs.readFileSync(path.join(installed.capability.dir, 'secrets.json'), 'utf-8'))).toEqual({
      token: 'recipient-only',
    })
  })

  it('installs a package downloaded from an HTTPS URL', async () => {
    const source = createCapability({
      id: 'remote-query',
      location: 'project',
      cwd: sourceCwd,
      runtime: 'node',
    })
    const packed = await packCapability({
      id: source.manifest.id,
      cwd: sourceCwd,
      output: path.join(testRoot, 'remote-query.tgz'),
    })
    const archive = fs.readFileSync(packed.path)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(archive, {
          status: 200,
          headers: { 'content-length': String(archive.length) },
        })
      }),
    )

    const installed = await installCapabilityPackage({
      source: 'https://example.com/remote-query.tgz',
      cwd: recipientCwd,
      location: 'project',
    })

    expect(installed.source).toBe('https://example.com/remote-query.tgz')
    expect(installed.capability.manifest.id).toBe('remote-query')
    expect(installed.capability.manifest.status).toBe('draft')
  })

  it('requires force before overwriting an existing package archive', async () => {
    const source = createCapability({
      id: 'archive-overwrite',
      location: 'project',
      cwd: sourceCwd,
      runtime: 'node',
    })
    const output = path.join(testRoot, 'archive-overwrite.tgz')
    await packCapability({ id: source.manifest.id, cwd: sourceCwd, output })

    await expect(packCapability({ id: source.manifest.id, cwd: sourceCwd, output })).rejects.toThrow('Use --force')

    const overwritten = await packCapability({
      id: source.manifest.id,
      cwd: sourceCwd,
      output,
      overwrite: true,
    })
    expect(fs.existsSync(overwritten.path)).toBe(true)
  })
})
