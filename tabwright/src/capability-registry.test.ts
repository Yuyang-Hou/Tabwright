import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import {
  createCapability,
  appendCapabilityRun,
  getCapabilityRoots,
  getCapabilityStateDir,
  getProjectCapabilitiesDir,
  listCapabilities,
  readCapabilityRuns,
  readCapabilityScript,
  requireCapability,
  routeCapabilities,
  searchCapabilities,
  toCapabilityContract,
  updateCapabilityStatus,
  updateCapabilityManifest as updateCapabilityManifestRecord,
  updateCapabilityScript,
  validateJsonAgainstSchema,
  writeCapabilitySecrets,
} from './capability-registry.js'
import { refreshCapabilityAuthFromCookies, refreshCapabilityAuthWithExecutor } from './capability-auth.js'
import { getCapabilityAuthState, shouldAutoRefreshCapabilityAuth } from './capability-auth-state.js'
import { exportCapabilityAgentSkill } from './capability-agent-skill.js'
import { prepareCapabilityRun, runCapabilityWithExecutor, runNodeCapability } from './capability-runner.js'
import { saveWorkflowCapability, saveWorkflowFromRecording } from './workflow-capability.js'

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

function updateCapabilityManifest(
  options: Parameters<typeof updateCapabilityManifestRecord>[0],
): ReturnType<typeof updateCapabilityManifestRecord> {
  return updateCapabilityManifestRecord({
    ...options,
    allowUnvalidatedTrust: options.patch.status === 'trusted' || options.allowUnvalidatedTrust,
  })
}

describe('capability registry', () => {
  test('deduplicates the capability root when the project cwd is the home directory', () => {
    const roots = getCapabilityRoots({ cwd: os.homedir() })

    expect(roots).toEqual([
      {
        dir: getProjectCapabilitiesDir({ cwd: os.homedir() }),
        location: 'project',
      },
    ])
  })

  test('creates and lists project capabilities', () => {
    const cwd = createTempDir('capability-registry-')
    try {
      const capability = createCapability({
        id: 'query-user',
        title: 'Query user',
        description: 'Find user details',
        location: 'project',
        cwd,
        createdBy: 'ai',
      })

      expect(capability.dir).toBe(path.join(getProjectCapabilitiesDir({ cwd }), 'query-user'))
      expect(capability.manifest.status).toBe('draft')
      expect(readCapabilityScript({ id: 'query-user', cwd })).toContain('return {')
      expect(listCapabilities({ cwd }).map((item) => item.manifest.id)).toContain('query-user')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('changing script downgrades trusted capability to draft', () => {
    const cwd = createTempDir('capability-downgrade-')
    try {
      createCapability({ id: 'saved-script', location: 'project', cwd })
      updateCapabilityManifest({ id: 'saved-script', cwd, patch: { status: 'trusted' } })
      const capability = updateCapabilityScript({
        id: 'saved-script',
        cwd,
        source: 'return { ok: true }',
      })

      expect(capability.manifest.status).toBe('draft')
      expect(readCapabilityScript({ id: 'saved-script', cwd })).toBe('return { ok: true }')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('changing a trusted contract requires validation before trusting it again', () => {
    const cwd = createTempDir('capability-contract-downgrade-')
    try {
      createCapability({ id: 'saved-contract', location: 'project', cwd })
      updateCapabilityManifest({ id: 'saved-contract', cwd, patch: { status: 'trusted' } })

      const edited = updateCapabilityManifest({
        id: 'saved-contract',
        cwd,
        patch: { description: 'Updated behavior contract' },
      })

      expect(edited.manifest.status).toBe('draft')
      expect(() => {
        updateCapabilityManifestRecord({
          id: 'saved-contract',
          cwd,
          patch: { description: 'Reviewed behavior contract', status: 'trusted' },
        })
      }).toThrow('cannot change its contract and become trusted in the same update')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('creates node capabilities', () => {
    const cwd = createTempDir('capability-node-')
    try {
      const capability = createCapability({
        id: 'api-tool',
        location: 'project',
        cwd,
        runtime: 'node',
      })

      expect(capability.manifest.runtime).toBe('node')
      expect(capability.manifest.permissions).toEqual(['network'])
      expect(capability.manifest.execution).toEqual({
        strategy: 'direct-request',
        requiresUserBrowser: false,
        humanAssistance: 'none',
        requirements: [],
        observedRequestPatterns: [],
      })
      expect(readCapabilityScript({ id: 'api-tool', cwd })).toContain('secrets')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('exports portable agent skills with runtime-only contracts', async () => {
    const cwd = createTempDir('capability-agent-skill-')
    const previousHome = process.env.HOME
    process.env.HOME = path.join(cwd, 'home')
    try {
      createCapability({
        id: 'query-user',
        title: 'Query User',
        description: 'Query a user by email in the admin API',
        location: 'project',
        cwd,
        runtime: 'node',
      })
      updateCapabilityManifest({
        id: 'query-user',
        cwd,
        patch: {
          status: 'trusted',
          match: ['admin user email query'],
          routingHint: 'exact-match-direct-run',
          whenToUse: ['Use for admin user lookup requests that include an email address.'],
          whenNotToUse: ['Do not use for public profile lookup.'],
          auth: {
            type: 'cookie',
            refresh: 'from-browser',
            browserUrls: ['https://admin.example.com'],
            requiredCookieNames: ['session'],
            failureSignals: ['unauthorized'],
          },
        },
      })
      const exportDir = path.join(cwd, 'exports', 'query-user')
      const exported = exportCapabilityAgentSkill({ id: 'query-user', cwd, output: exportDir })
      const exportedSkill = fs.readFileSync(path.join(exportDir, 'SKILL.md'), 'utf-8')
      const exportedContract = JSON.parse(
        fs.readFileSync(path.join(exportDir, 'runtime', 'capability.json'), 'utf-8'),
      ) as {
        status: string
        description: string
        whenToUse: string[]
        whenNotToUse: string[]
        match: string[]
        tags: string[]
        routingHint: string
      }
      expect(exported.dir).toBe(exportDir)
      expect(exported.files).toEqual([
        'SKILL.md',
        'agents/openai.yaml',
        'runtime/capability.json',
        'runtime/script.js',
      ])
      expect(exportedContract.status).toBe('draft')
      expect(exportedContract).toMatchObject({
        description: '',
        whenToUse: [],
        whenNotToUse: [],
        match: [],
        tags: [],
        routingHint: 'search-first',
      })
      expect(exportedSkill).not.toContain('compatibility:')
      expect(exportedSkill).toContain('Ask the user only when Node.js or npm is unavailable')
      expect(exportedSkill).toContain('Use for admin user lookup requests that include an email address.')
      expect(exportedSkill).toContain('runtime/capability.json')
      expect(exportedSkill.indexOf('## Scope Limits')).toBeGreaterThan(-1)
      expect(exportedSkill.indexOf('## Tabwright Runtime')).toBeGreaterThan(
        exportedSkill.indexOf('## Workflow'),
      )
      expect(exportedSkill).toContain('runtime/script.js')
      expect(exportedSkill).toContain('npm exec --yes --package=tabwright@latest -- tabwright')
      expect(exportedSkill).toContain('"<absolute-skill-directory>/runtime"')
      expect(exportedSkill).toContain('automatically refreshes declared browser authentication')
      expect(exportedSkill).not.toContain('tabwright capability trust')
      expect(exportedSkill).not.toContain('tabwright capability refresh-auth')
      expect(fs.existsSync(path.join(exportDir, 'secrets.json'))).toBe(false)
      expect(fs.existsSync(path.join(exportDir, 'runs.jsonl'))).toBe(false)
      expect(fs.existsSync(path.join(exportDir, 'artifacts'))).toBe(false)
      expect(fs.existsSync(path.join(exportDir, 'runtime', 'README.md'))).toBe(false)
      expect(fs.readFileSync(path.join(exportDir, 'agents', 'openai.yaml'), 'utf-8')).toContain('$query-user')

      updateCapabilityScript({ id: 'query-user', cwd, source: 'return input\n' })
      exportCapabilityAgentSkill({
        id: 'query-user',
        cwd,
        output: path.join(cwd, 'direct-runtime', 'query-user'),
      })
      const runtimeDir = path.join(cwd, 'direct-runtime', 'query-user', 'runtime')
      const directRuntime = requireCapability({ id: runtimeDir, cwd })
      expect(directRuntime.location).toBe('skill')
      expect(directRuntime.stateDir).toBe(getCapabilityStateDir({ id: 'query-user' }))
      expect(directRuntime.manifest.status).toBe('trusted')
      const run = await runNodeCapability({ id: runtimeDir, cwd, input: { email: 'a@example.com' } })
      expect(run.output).toEqual({ email: 'a@example.com' })
      expect(fs.existsSync(path.join(directRuntime.stateDir, 'runs.jsonl'))).toBe(true)
      const quarantined = updateCapabilityStatus({
        capability: requireCapability({ id: runtimeDir, cwd }),
        status: 'draft',
      })
      expect(quarantined.manifest.status).toBe('draft')
      expect(fs.existsSync(path.join(directRuntime.stateDir, 'runtime-state.json'))).toBe(true)
      await expect(
        runNodeCapability({ id: runtimeDir, cwd, input: { email: 'a@example.com' }, force: true }),
      ).rejects.toThrow(/quarantined/)
      const bundledManifest = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'capability.json'), 'utf-8')) as {
        status: string
      }
      expect(bundledManifest.status).toBe('draft')
      fs.writeFileSync(path.join(runtimeDir, 'script.js'), 'return { changed: true }\n')
      expect(requireCapability({ id: runtimeDir, cwd }).manifest.status).toBe('trusted')

      const unrelatedDir = path.join(cwd, 'unrelated', 'query-user')
      fs.mkdirSync(unrelatedDir, { recursive: true })
      fs.writeFileSync(path.join(unrelatedDir, 'user-file.txt'), 'keep me')
      expect(() => {
        exportCapabilityAgentSkill({ id: 'query-user', cwd, output: unrelatedDir })
      }).toThrow(/Manage updates with the agent's skill tooling/)

      createCapability({ id: 'update-user', location: 'project', cwd, runtime: 'browser' })
      updateCapabilityManifest({
        id: 'update-user',
        cwd,
        patch: { sideEffect: 'write', requiresConfirmation: true },
      })
      const writeSkillDir = path.join(cwd, 'exports', 'update-user')
      exportCapabilityAgentSkill({ id: 'update-user', cwd, output: writeSkillDir })
      const writeSkillContent = fs.readFileSync(path.join(writeSkillDir, 'SKILL.md'), 'utf-8')
      expect(writeSkillContent).toContain('--browser user')
      expect(writeSkillContent).not.toContain('runtime" --browser user --force')
      expect(writeSkillContent).toContain('--confirm update-user')
      expect(writeSkillContent).toContain('stop and obtain explicit user approval')
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = previousHome
      }
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('uses Chinese agent-facing copy for capabilities with Chinese metadata', () => {
    const cwd = createTempDir('capability-agent-skill-zh-')
    try {
      createCapability({
        id: 'query-cn-user',
        title: '用户查询',
        description: '查询国内管理后台的用户资料和账号状态',
        location: 'project',
        cwd,
        runtime: 'node',
      })
      updateCapabilityManifest({
        id: 'query-cn-user',
        cwd,
        patch: {
          whenToUse: ['用户要求查询指定账号时'],
          whenNotToUse: ['不要用于修改用户资料'],
        },
      })

      const exportDir = path.join(cwd, 'exports', 'query-cn-user')
      exportCapabilityAgentSkill({ id: 'query-cn-user', cwd, output: exportDir })
      const exportedSkill = fs.readFileSync(path.join(exportDir, 'SKILL.md'), 'utf-8')
      const openAiMetadata = fs.readFileSync(path.join(exportDir, 'agents', 'openai.yaml'), 'utf-8')

      expect(exportedSkill).toContain('## 适用边界')
      expect(exportedSkill).toContain('## 操作流程')
      expect(exportedSkill).toContain('## Tabwright 运行环境')
      expect(exportedSkill).toContain('仅当 Node.js 或 npm 不可用时才询问用户')
      expect(exportedSkill).not.toContain('## Scope Limits')
      expect(exportedSkill).not.toContain('## Tabwright Runtime')
      expect(openAiMetadata).toContain('default_prompt: "使用 $query-cn-user')
      expect(openAiMetadata).not.toContain('complete the matching task')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('creates AI-readable capability contracts', () => {
    const cwd = createTempDir('capability-contract-')
    try {
      createCapability({
        id: 'bilibili-current-user',
        title: 'Bilibili Current User',
        description: 'Fetch current Bilibili account information',
        location: 'project',
        cwd,
        runtime: 'node',
      })
      const capability = updateCapabilityManifest({
        id: 'bilibili-current-user',
        cwd,
        patch: {
          status: 'trusted',
          whenToUse: ['用户询问当前 Bilibili 登录账号是谁'],
          whenNotToUse: ['查询其他人的公开主页'],
          tags: ['bilibili', 'account'],
          auth: {
            type: 'cookie',
            refresh: 'from-browser',
            secretKey: 'cookieHeader',
            browserUrls: ['https://www.bilibili.com/', 'https://api.bilibili.com/'],
            requiredCookieNames: ['SESSDATA'],
            failureSignals: ['isLogin=false'],
          },
        },
      })
      const contract = toCapabilityContract(capability)

      expect(contract).toMatchObject({
        id: 'bilibili-current-user',
        runtime: 'node',
        routingHint: 'search-first',
        sideEffect: 'read',
        autonomousInvocation: { allowed: true },
      })
      const searchResults = searchCapabilities({ query: '当前 Bilibili 登录账号', cwd }).map((result) => {
        return result.capability.manifest.id
      })
      expect(searchResults[0]).toBe('bilibili-current-user')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('validates simple object schemas', () => {
    const result = validateJsonAgainstSchema({
      schema: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email'],
      },
      value: { email: 'a@example.com' },
      label: 'input',
    })

    expect(result.valid).toBe(true)
  })

  test('does not route a capability autonomously when a person is always required', () => {
    const cwd = createTempDir('capability-human-required-')
    try {
      createCapability({ id: 'approve-in-browser', location: 'project', cwd, runtime: 'browser' })
      const capability = updateCapabilityManifest({
        id: 'approve-in-browser',
        cwd,
        patch: {
          status: 'trusted',
          execution: {
            strategy: 'browser-ui',
            requiresUserBrowser: true,
            humanAssistance: 'required',
            requirements: ['A person must review the final screen.'],
            observedRequestPatterns: [],
          },
        },
      })

      expect(toCapabilityContract(capability)).toMatchObject({
        autonomousInvocation: {
          allowed: false,
          reasons: expect.arrayContaining(['execution requires human assistance']),
        },
      })
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('saves recording-derived workflows as draft write capabilities', () => {
    const cwd = createTempDir('workflow-capability-')
    try {
      const saved = saveWorkflowCapability({
        id: 'create-material-from-demo',
        title: 'Create Material From Demo',
        description: 'Fill and submit material form from input',
        cwd,
        sourceRecordingId: 'recording-123',
        script: 'return { title: input.title }',
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        },
      })

      const capability = listCapabilities({ cwd }).find((item) => {
        return item.manifest.id === 'create-material-from-demo'
      })

      expect(capability?.manifest).toMatchObject({
        status: 'draft',
        runtime: 'browser',
        sideEffect: 'write',
        requiresConfirmation: true,
        execution: {
          strategy: 'browser-ui',
          requiresUserBrowser: true,
          humanAssistance: 'on-challenge',
        },
        tags: expect.arrayContaining(['workflow', 'recording-derived', 'recording:recording-123']),
      })
      expect(readCapabilityScript({ id: 'create-material-from-demo', cwd })).toBe('return { title: input.title }')
      expect(saved.capability).toMatchObject({ id: 'create-material-from-demo', sideEffect: 'write' })
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('generates batch workflow capabilities from recording-derived steps', () => {
    const cwd = createTempDir('workflow-from-recording-')
    try {
      const saved = saveWorkflowFromRecording({
        id: 'batch-create-material-from-demo',
        title: 'Batch Create Material From Demo',
        description: 'Replay the demonstrated material creation flow for each input item',
        cwd,
        recordingId: 'recording-456',
        inputSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  image: { type: 'string' },
                },
                required: ['title', 'image'],
              },
            },
          },
          required: ['items'],
        },
        steps: [
          { action: 'goto', url: { value: 'https://admin.example.com/materials/new' } },
          { action: 'fill', locator: '[name="title"]', value: { inputPath: 'title' } },
          { action: 'setInputFiles', locator: '[name="image"]', path: { inputPath: 'image' } },
        ],
        finalRequest: {
          url: '**/api/materials/**',
          method: 'POST',
          title: 'Create material',
          trigger: { action: 'click', locator: 'button[type="submit"]' },
        },
      })

      const script = readCapabilityScript({ id: 'batch-create-material-from-demo', cwd })
      const capability = listCapabilities({ cwd }).find((item) => {
        return item.manifest.id === 'batch-create-material-from-demo'
      })

      expect(script).toContain('needs_ai')
      expect(script).toContain('needs_human')
      expect(script).toContain('runOneWorkflowItem')
      expect(script).not.toContain('taskQueue.run')
      expect(script).not.toContain('approval.captureAndSubmit')
      expect(script).toContain('const items')
      expect(capability?.manifest.tags).toEqual(
        expect.arrayContaining(['workflow', 'recording-derived', 'recording:recording-456']),
      )
      expect(capability?.manifest.execution).toEqual({
        strategy: 'hybrid',
        requiresUserBrowser: true,
        humanAssistance: 'on-challenge',
        requirements: ['A signed-in user browser for the recorded website.'],
        observedRequestPatterns: ['**/api/materials/**'],
      })
      expect(saved.capability).toMatchObject({ id: 'batch-create-material-from-demo', requiresConfirmation: true })
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('generates recording-derived workflows without forcing a final request', () => {
    const cwd = createTempDir('workflow-from-recording-without-request-')
    try {
      saveWorkflowFromRecording({
        id: 'draft-page-cleanup-from-demo',
        title: 'Draft Page Cleanup From Demo',
        cwd,
        recordingId: 'recording-789',
        steps: [
          { action: 'goto', url: { value: 'https://admin.example.com/editor' } },
          { action: 'fill', locator: '[name="title"]', value: { inputPath: 'title' } },
        ],
      })

      const script = readCapabilityScript({ id: 'draft-page-cleanup-from-demo', cwd })
      const capability = requireCapability({ id: 'draft-page-cleanup-from-demo', cwd })

      expect(script).toContain('const finalRequest = undefined')
      expect(script).toContain('if (!finalRequest || !finalRequest.trigger)')
      expect(script).not.toContain('approval.captureAndSubmit')
      expect(capability.manifest.execution?.strategy).toBe('browser-ui')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('capability runner', () => {
  test('wraps a trusted capability with input and URL match checks', () => {
    const cwd = createTempDir('capability-runner-')
    try {
      createCapability({ id: 'lookup-user', location: 'project', cwd })
      updateCapabilityScript({
        id: 'lookup-user',
        cwd,
        source: 'return { email: input.email, url: page.url(), capabilityId: capability.id }',
      })
      updateCapabilityManifest({
        id: 'lookup-user',
        cwd,
        patch: {
          status: 'trusted',
          match: ['https://admin.example.com/*'],
          inputSchema: {
            type: 'object',
            properties: { email: { type: 'string' } },
            required: ['email'],
          },
        },
      })

      const prepared = prepareCapabilityRun({
        id: 'lookup-user',
        cwd,
        input: { email: 'a@example.com' },
      })

      expect(prepared.code).toContain('const input = {"email":"a@example.com"};')
      expect(prepared.code).toContain('const __tabwrightCapabilityMatch = ["https://admin.example.com/*"];')
      expect(prepared.code).toContain('tabwright-capability://lookup-user')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('requires force for draft capabilities', () => {
    const cwd = createTempDir('capability-draft-')
    try {
      createCapability({ id: 'draft-tool', location: 'project', cwd })

      expect(() => {
        prepareCapabilityRun({ id: 'draft-tool', cwd, input: {} })
      }).toThrow('Capability is draft')
      expect(() => {
        prepareCapabilityRun({ id: 'draft-tool', cwd, input: {}, force: true })
      }).not.toThrow()
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('requires an exact capability confirmation even when force is set', () => {
    const cwd = createTempDir('capability-confirmation-')
    try {
      createCapability({ id: 'write-tool', location: 'project', cwd })
      updateCapabilityManifest({
        id: 'write-tool',
        cwd,
        patch: {
          status: 'trusted',
          sideEffect: 'write',
          requiresConfirmation: true,
          inputSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
        },
      })

      expect(() => {
        prepareCapabilityRun({ id: 'write-tool', cwd, input: { value: 'x' }, force: true })
      }).toThrow('requires explicit user confirmation')
      expect(() => {
        prepareCapabilityRun({
          id: 'write-tool',
          cwd,
          input: { value: 'x' },
          force: true,
          confirmation: 'another-tool',
        })
      }).toThrow('rerun with --confirm write-tool')
      expect(() => {
        prepareCapabilityRun({
          id: 'write-tool',
          cwd,
          input: { value: 'x' },
          force: true,
          confirmation: 'write-tool',
        })
      }).not.toThrow()
      expect(() => {
        prepareCapabilityRun({ id: 'write-tool', cwd, input: {}, force: true })
      }).toThrow('Invalid capability input')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('applies schemas and confirmation at operation scope', async () => {
    const cwd = createTempDir('capability-operation-policy-')
    try {
      createCapability({ id: 'mixed-tool', location: 'project', cwd, runtime: 'node' })
      updateCapabilityScript({
        id: 'mixed-tool',
        cwd,
        source: 'return input.action === "read" ? { value: input.value } : { updated: true, value: input.value };',
      })
      updateCapabilityManifest({
        id: 'mixed-tool',
        cwd,
        patch: {
          status: 'trusted',
          sideEffect: 'write',
          requiresConfirmation: true,
          operations: {
            read: {
              title: 'Read',
              description: 'Read a value',
              match: ['https://example.com/read*'],
              routingHint: 'exact-match-direct-run',
              inputSchema: {
                type: 'object',
                properties: { action: { type: 'string' }, value: { type: 'string' } },
                required: ['action', 'value'],
              },
              outputSchema: {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: ['value'],
              },
              sideEffect: 'read',
              requiresConfirmation: false,
            },
            write: {
              title: 'Write',
              description: 'Write a value',
              match: [],
              routingHint: 'search-first',
              inputSchema: {
                type: 'object',
                properties: { action: { type: 'string' }, value: { type: 'string' } },
                required: ['action', 'value'],
              },
              outputSchema: {
                type: 'object',
                properties: { updated: { type: 'boolean' }, value: { type: 'string' } },
                required: ['updated', 'value'],
              },
              sideEffect: 'write',
              requiresConfirmation: true,
            },
          },
        },
      })

      await expect(
        runNodeCapability({ id: 'mixed-tool', cwd, input: { action: 'read', value: 'a' } }),
      ).resolves.toMatchObject({
        output: { value: 'a' },
        runRecord: { operation: 'read' },
      })
      await expect(
        runNodeCapability({ id: 'mixed-tool', cwd, input: { action: 'write', value: 'b' }, force: true }),
      ).rejects.toThrow('rerun with --confirm mixed-tool:write')
      await expect(
        runNodeCapability({
          id: 'mixed-tool',
          cwd,
          input: { action: 'write', value: 'b' },
          force: true,
          confirmation: 'mixed-tool',
        }),
      ).rejects.toThrow('rerun with --confirm mixed-tool:write')
      await expect(
        runNodeCapability({
          id: 'mixed-tool',
          cwd,
          input: { action: 'write', value: 'b' },
          force: true,
          confirmation: 'mixed-tool:write',
        }),
      ).resolves.toMatchObject({ output: { updated: true, value: 'b' }, runRecord: { operation: 'write' } })
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('does not execute node or browser scripts before confirmation', async () => {
    const cwd = createTempDir('capability-confirmation-execution-')
    try {
      const nodeCapability = createCapability({
        id: 'confirmed-node-write',
        location: 'project',
        cwd,
        runtime: 'node',
      })
      updateCapabilityScript({
        id: 'confirmed-node-write',
        cwd,
        source: 'artifacts.writeText({ filename: "executed.txt", text: "yes" }); return { ok: true };',
      })
      updateCapabilityManifest({
        id: 'confirmed-node-write',
        cwd,
        patch: { status: 'trusted', sideEffect: 'write', requiresConfirmation: true },
      })

      await expect(runNodeCapability({ id: 'confirmed-node-write', cwd, input: {}, force: true })).rejects.toThrow(
        'requires explicit user confirmation',
      )
      expect(fs.existsSync(path.join(nodeCapability.dir, 'artifacts', 'executed.txt'))).toBe(false)

      createCapability({ id: 'confirmed-browser-write', location: 'project', cwd, runtime: 'browser' })
      updateCapabilityManifest({
        id: 'confirmed-browser-write',
        cwd,
        patch: { status: 'trusted', sideEffect: 'write', requiresConfirmation: true },
      })
      let browserScriptExecuted = false
      await expect(
        runCapabilityWithExecutor({
          executor: {
            execute: async () => {
              browserScriptExecuted = true
              return { text: '', images: [], screenshots: [], isError: false, structuredResult: {} }
            },
          },
          id: 'confirmed-browser-write',
          cwd,
          input: {},
          force: true,
        }),
      ).rejects.toThrow('requires explicit user confirmation')
      expect(browserScriptExecuted).toBe(false)
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('runs node capabilities without a browser executor', async () => {
    const cwd = createTempDir('capability-node-run-')
    try {
      const capability = createCapability({
        id: 'node-api-tool',
        location: 'project',
        cwd,
        runtime: 'node',
      })
      writeCapabilitySecrets({ capability, secrets: { token: 'secret-token' } })
      updateCapabilityScript({
        id: 'node-api-tool',
        cwd,
        source: 'return { token: secrets.token, input }',
      })
      updateCapabilityManifest({
        id: 'node-api-tool',
        cwd,
        patch: {
          status: 'trusted',
          outputSchema: {
            type: 'object',
            properties: { token: { type: 'string' } },
            required: ['token'],
          },
        },
      })

      const result = await runNodeCapability({
        id: 'node-api-tool',
        cwd,
        input: { ok: true },
      })

      expect(result.output).toEqual({ token: 'secret-token', input: { ok: true } })
      expect(result.runRecord.contract).toMatchObject({
        status: 'passed',
        output: { status: 'passed' },
        network: { status: 'not-applicable' },
        trust: { before: 'trusted', after: 'trusted', downgraded: false },
      })
      expect(toCapabilityContract(result.capability)).toMatchObject({
        lifecycle: {
          stage: 'trusted',
          contractHealth: { state: 'healthy' },
        },
      })
      const edited = updateCapabilityScript({
        id: 'node-api-tool',
        cwd,
        source: 'return { token: secrets.token, input, edited: true }',
      })
      expect(toCapabilityContract(edited)).toMatchObject({
        lifecycle: {
          stage: 'drafted',
          contractHealth: { state: 'unknown' },
        },
      })
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('records output drift once and downgrades trusted capabilities', async () => {
    const cwd = createTempDir('capability-output-drift-')
    try {
      createCapability({ id: 'drifted-node-tool', location: 'project', cwd, runtime: 'node' })
      updateCapabilityScript({
        id: 'drifted-node-tool',
        cwd,
        source: 'return { userId: 42 }',
      })
      const capability = updateCapabilityManifest({
        id: 'drifted-node-tool',
        cwd,
        patch: {
          status: 'trusted',
          outputSchema: {
            type: 'object',
            properties: { userId: { type: 'string' } },
            required: ['userId'],
          },
        },
      })

      await expect(runNodeCapability({ id: 'drifted-node-tool', cwd, input: {} })).rejects.toThrow(
        'execution completed but contract conformance failed',
      )

      const runs = readCapabilityRuns({ capability })
      expect(runs).toHaveLength(1)
      expect(runs[0]).toMatchObject({
        status: 'error',
        contract: {
          status: 'failed',
          failures: [{ kind: 'output-schema', message: 'output.userId must be string' }],
          trust: { before: 'trusted', after: 'draft', downgraded: true },
        },
      })
      const current = listCapabilities({ cwd }).find((item) => {
        return item.manifest.id === 'drifted-node-tool'
      })
      expect(current?.manifest.status).toBe('draft')
      expect(current ? toCapabilityContract(current) : {}).toMatchObject({
        autonomousInvocation: {
          allowed: false,
          reasons: expect.arrayContaining(['current contract failed conformance']),
        },
        lifecycle: {
          stage: 'drifted',
          nextAction: 'repair',
          contractHealth: { state: 'drifted' },
        },
      })
      expect(() => {
        updateCapabilityManifestRecord({ id: 'drifted-node-tool', cwd, patch: { status: 'trusted' } })
      }).toThrow('has no passing conformance evidence')

      updateCapabilityScript({
        id: 'drifted-node-tool',
        cwd,
        source: 'return { userId: "repaired" }',
      })
      await runNodeCapability({ id: 'drifted-node-tool', cwd, input: {}, force: true })
      const repaired = updateCapabilityManifestRecord({
        id: 'drifted-node-tool',
        cwd,
        patch: { status: 'trusted' },
      })
      expect(toCapabilityContract(repaired)).toMatchObject({
        lifecycle: { stage: 'trusted', contractHealth: { state: 'healthy' } },
      })
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('records browser output drift before throwing', async () => {
    const cwd = createTempDir('capability-browser-drift-')
    try {
      const capability = createCapability({
        id: 'drifted-browser-tool',
        location: 'project',
        cwd,
        runtime: 'browser',
      })
      updateCapabilityManifest({
        id: 'drifted-browser-tool',
        cwd,
        patch: {
          status: 'trusted',
          outputSchema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
        },
      })

      await expect(
        runCapabilityWithExecutor({
          executor: {
            execute: async () => {
              return {
                text: '',
                images: [],
                screenshots: [],
                isError: false,
                structuredResult: { ok: 'yes' },
              }
            },
          },
          id: 'drifted-browser-tool',
          cwd,
          input: {},
        }),
      ).rejects.toThrow('output.ok must be boolean')

      expect(readCapabilityRuns({ capability })).toHaveLength(1)
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('unwraps browser observations without exposing the internal envelope', async () => {
    const cwd = createTempDir('capability-browser-observation-')
    try {
      createCapability({ id: 'observed-browser-tool', location: 'project', cwd, runtime: 'browser' })
      updateCapabilityManifest({
        id: 'observed-browser-tool',
        cwd,
        patch: {
          status: 'trusted',
          permissions: ['browser.read', 'network:https://allowed.example/*'],
          outputSchema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
        },
      })

      const result = await runCapabilityWithExecutor({
        executor: {
          execute: async () => {
            return {
              text: '[return value] { __tabwrightCapabilityEnvelope: 1, output: { ok: true } }',
              images: [],
              screenshots: [],
              isError: false,
              structuredResult: {
                __tabwrightCapabilityEnvelope: 1,
                output: { ok: true },
                observedNetworkUrls: ['https://allowed.example/api/value'],
                url: 'https://allowed.example/app',
              },
            }
          },
        },
        id: 'observed-browser-tool',
        cwd,
        input: {},
      })

      expect(result.output).toEqual({ ok: true })
      expect(result.executeResult.structuredResult).toEqual({ ok: true })
      expect(result.executeResult.text).toBe('[return value] { ok: true }')
      expect(result.executeResult.text).not.toContain('__tabwrightCapabilityEnvelope')
      expect(result.runRecord).toMatchObject({
        url: 'https://allowed.example/app',
        contract: {
          status: 'passed',
          network: { status: 'passed', observedHosts: ['https://allowed.example'] },
        },
      })

      await expect(
        runCapabilityWithExecutor({
          executor: {
            execute: async () => {
              return {
                text: '[return value] { __tabwrightCapabilityEnvelope: 1 }',
                images: [],
                screenshots: [],
                isError: false,
                structuredResult: {
                  __tabwrightCapabilityEnvelope: 1,
                  output: undefined,
                  observedNetworkUrls: ['https://undeclared.example/api/value'],
                  url: 'https://allowed.example/app',
                  error: 'runtime failed after request',
                },
              }
            },
          },
          id: 'observed-browser-tool',
          cwd,
          input: {},
        }),
      ).rejects.toThrow('Network host is not declared')
      const current = listCapabilities({ cwd }).find((item) => {
        return item.manifest.id === 'observed-browser-tool'
      })
      expect(current?.manifest.status).toBe('draft')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('observes node fetch hosts and rejects undeclared network access', async () => {
    const cwd = createTempDir('capability-network-drift-')
    const requestUrl = 'https://undeclared.example/data'
    vi.stubGlobal('fetch', async () => {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    try {
      const capability = createCapability({
        id: 'scoped-network-tool',
        location: 'project',
        cwd,
        runtime: 'node',
      })
      updateCapabilityScript({
        id: 'scoped-network-tool',
        cwd,
        source: `await fetch(${JSON.stringify(requestUrl)}); throw new Error('runtime failed after request');`,
      })
      updateCapabilityManifest({
        id: 'scoped-network-tool',
        cwd,
        patch: {
          status: 'trusted',
          permissions: ['network:https://allowed.example/*'],
        },
      })

      await expect(runNodeCapability({ id: 'scoped-network-tool', cwd, input: {} })).rejects.toThrow(
        'Network host is not declared',
      )

      expect(readCapabilityRuns({ capability })[0]?.contract).toMatchObject({
        status: 'failed',
        network: {
          status: 'failed',
          observedHosts: [new URL(requestUrl).origin],
          undeclaredHosts: [new URL(requestUrl).origin],
        },
      })
    } finally {
      vi.unstubAllGlobals()
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('times out a node capability that does not settle', async () => {
    const cwd = createTempDir('capability-node-timeout-')
    try {
      createCapability({ id: 'node-timeout-tool', location: 'project', cwd, runtime: 'node' })
      updateCapabilityScript({
        id: 'node-timeout-tool',
        cwd,
        source: 'await new Promise(() => {}); return { ok: true };',
      })
      updateCapabilityManifest({ id: 'node-timeout-tool', cwd, patch: { status: 'trusted' } })

      await expect(runNodeCapability({ id: 'node-timeout-tool', cwd, input: {}, timeout: 50 })).rejects.toThrow(
        'Capability execution timed out after 50ms',
      )
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('node capabilities can write scoped artifacts', async () => {
    const cwd = createTempDir('capability-node-artifacts-')
    try {
      createCapability({
        id: 'node-artifact-tool',
        location: 'project',
        cwd,
        runtime: 'node',
      })
      updateCapabilityScript({
        id: 'node-artifact-tool',
        cwd,
        source: [
          'const jsonPath = artifacts.writeJson({ filename: "results/latest.json", value: input });',
          'const textPath = artifacts.writeText({ filename: "results/latest.md", text: "# ok\\n" });',
          'return { root: artifacts.root, jsonPath, textPath };',
        ].join('\n'),
      })
      updateCapabilityManifest({
        id: 'node-artifact-tool',
        cwd,
        patch: { status: 'trusted' },
      })

      const result = await runNodeCapability({
        id: 'node-artifact-tool',
        cwd,
        input: { ok: true },
      })
      const output = result.output as { jsonPath: string; textPath: string; root: string }

      expect(output.root).toBe(path.join(getProjectCapabilitiesDir({ cwd }), 'node-artifact-tool', 'artifacts'))
      expect(JSON.parse(fs.readFileSync(output.jsonPath, 'utf-8'))).toEqual({ ok: true })
      expect(fs.readFileSync(output.textPath, 'utf-8')).toBe('# ok\n')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('builds browser cookie auth refresh without returning cookie values', async () => {
    const cwd = createTempDir('capability-auth-refresh-')
    try {
      createCapability({
        id: 'cookie-api-tool',
        location: 'project',
        cwd,
        runtime: 'node',
      })
      const capability = updateCapabilityManifest({
        id: 'cookie-api-tool',
        cwd,
        patch: {
          auth: {
            type: 'cookie',
            refresh: 'from-browser',
            secretKey: 'cookieHeader',
            browserUrls: ['https://example.com/'],
            requiredCookieNames: ['SESSION'],
            failureSignals: ['loggedOut'],
          },
        },
      })
      const executedCode: string[] = []
      const result = await refreshCapabilityAuthWithExecutor({
        id: 'cookie-api-tool',
        cwd,
        executor: {
          execute: async (code) => {
            executedCode.push(code)
            writeCapabilitySecrets({ capability, secrets: { cookieHeader: 'secret-value' } })
            return {
              text: '[return value] { saved: true }',
              images: [],
              screenshots: [],
              isError: false,
              structuredResult: {
                saved: true,
                secretKey: 'cookieHeader',
                cookieCount: 1,
                cookieNames: ['SESSION'],
                urls: ['https://example.com/'],
                expiresAt: '2099-01-01T00:00:00.000Z',
                path: path.join(capability.dir, 'secrets.json'),
              },
            }
          },
        },
      })

      expect(result.cookieCount).toBe(1)
      expect(executedCode.join('\n')).toContain('Network.getCookies')
      expect(executedCode.join('\n')).toContain('cookieHeader')
      expect(JSON.stringify(result)).not.toContain('secret-value')
      expect(getCapabilityAuthState({ capability }).status).toBe('authenticated')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('tracks direct browser cookie authentication and marks authentication failures as expired', () => {
    const cwd = createTempDir('capability-auth-state-')
    try {
      createCapability({ id: 'cookie-state-tool', location: 'project', cwd, runtime: 'node' })
      const capability = updateCapabilityManifest({
        id: 'cookie-state-tool',
        cwd,
        patch: {
          auth: {
            type: 'cookie',
            refresh: 'from-browser',
            secretKey: 'cookieHeader',
            browserUrls: ['https://example.com/'],
            requiredCookieNames: ['SESSION'],
            failureSignals: ['Request failed 401'],
          },
        },
      })
      const expires = Math.floor(new Date('2099-01-01T00:00:00.000Z').getTime() / 1000)
      const refreshed = refreshCapabilityAuthFromCookies({
        id: 'cookie-state-tool',
        cwd,
        browserKey: 'install:Chrome:test-profile',
        cookies: [{ name: 'SESSION', value: 'secret-value', expires }],
      })

      expect(refreshed.expiresAt).toBe('2099-01-01T00:00:00.000Z')
      expect(getCapabilityAuthState({ capability })).toMatchObject({
        status: 'authenticated',
        cookieNames: ['SESSION'],
        browserKey: 'install:Chrome:test-profile',
      })
      expect(fs.readFileSync(path.join(capability.dir, 'auth-state.json'), 'utf-8')).not.toContain('secret-value')

      appendCapabilityRun({
        capability,
        record: {
          id: 'auth-failure',
          status: 'error',
          durationMs: 10,
          inputHash: 'test',
          error: 'Request failed 401: login expired',
          createdAt: new Date(Date.now() + 1000).toISOString(),
        },
      })
      expect(getCapabilityAuthState({ capability })).toMatchObject({
        status: 'expired',
        reason: expect.stringContaining('Request failed 401'),
      })
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('automatically refreshes missing or stale Skill authentication without refreshing every run', () => {
    const base = {
      type: 'cookie' as const,
      canRefresh: true,
      browserUrls: ['https://example.com/'],
      requiredCookieNames: ['SESSION'],
      cookieNames: [],
    }
    expect(shouldAutoRefreshCapabilityAuth({ state: { ...base, status: 'missing' } })).toBe(true)
    expect(shouldAutoRefreshCapabilityAuth({ state: { ...base, status: 'expired' } })).toBe(true)
    expect(shouldAutoRefreshCapabilityAuth({ state: { ...base, status: 'unknown' } })).toBe(true)
    expect(
      shouldAutoRefreshCapabilityAuth({
        state: { ...base, status: 'expiring', refreshedAt: '2026-07-17T00:00:00.000Z' },
        now: new Date('2026-07-17T00:30:00.000Z'),
      }),
    ).toBe(false)
    expect(
      shouldAutoRefreshCapabilityAuth({
        state: { ...base, status: 'expiring', refreshedAt: '2026-07-17T00:00:00.000Z' },
        now: new Date('2026-07-17T02:00:00.000Z'),
      }),
    ).toBe(true)
    expect(
      shouldAutoRefreshCapabilityAuth({ state: { ...base, status: 'authenticated', canRefresh: false }, force: true }),
    ).toBe(false)
  })
})
