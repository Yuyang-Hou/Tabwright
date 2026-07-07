import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createCapability,
  getProjectCapabilitiesDir,
  listCapabilities,
  readCapabilityScript,
  routeCapabilities,
  searchCapabilities,
  toCapabilityContract,
  updateCapabilityManifest,
  updateCapabilityScript,
  validateJsonAgainstSchema,
  writeCapabilitySecrets,
} from './capability-registry.js'
import { refreshCapabilityAuthWithExecutor } from './capability-auth.js'
import { installBuiltinCapabilitySuite } from './builtin-capabilities.js'
import { initCapabilityAgentSkill, installCapabilityAgentSkill, showCapabilityAgentSkill } from './capability-agent-skill.js'
import { prepareCapabilityRun, runNodeCapability } from './capability-runner.js'
import { saveWorkflowCapability, saveWorkflowFromRecording } from './workflow-capability.js'

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

describe('capability registry', () => {
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
      expect(readCapabilityScript({ id: 'api-tool', cwd })).toContain('secrets')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('installs built-in conan config capabilities', () => {
    const cwd = createTempDir('capability-builtins-')
    try {
      const codexHome = path.join(cwd, 'codex-home')
      const installed = installBuiltinCapabilitySuite({
        suite: 'conan-config',
        location: 'project',
        cwd,
        codexHome,
      })

      expect(installed.capabilities.map((capability) => capability.manifest.id)).toEqual([
        'conan-config-search',
        'conan-config-query',
      ])
      expect(installed.agentSkills.map((agentSkill) => agentSkill.name)).toEqual(['conan-config-query'])
      expect(installed.agentSkills[0]?.target).toBe('codex')
      expect(
        fs.readFileSync(path.join(codexHome, 'skills', 'conan-config-query', 'SKILL.md'), 'utf-8'),
      ).toContain('never a shell command')
      expect(
        fs.readFileSync(path.join(codexHome, 'skills', 'conan-config-query', 'agents', 'openai.yaml'), 'utf-8'),
      ).toContain('Conan Config Query')
      const projectCapabilityIds = listCapabilities({ cwd })
        .filter((capability) => {
          return capability.location === 'project'
        })
        .map((item) => item.manifest.id)
      expect(projectCapabilityIds).toEqual([
        'conan-config-query',
        'conan-config-search',
      ])
      const query = listCapabilities({ cwd }).find((capability) => {
        return capability.manifest.id === 'conan-config-query'
      })
      if (!query) {
        throw new Error('Expected conan-config-query to be installed')
      }
      expect(query.manifest).toMatchObject({
        runtime: 'node',
        status: 'trusted',
        match: [
          'https://buff.zhenguanyu.com/*Space_Enhanced_Config*key=*rootGroupingKey=*',
          'https://conan.zhenguanyu.com/*Space_Enhanced_Config*key=*rootGroupingKey=*',
          'Space_Enhanced_Config key rootGroupingKey namespace',
        ],
        routingHint: 'exact-match-direct-run',
        sideEffect: 'read',
        requiresConfirmation: false,
        auth: {
          type: 'cookie',
          refresh: 'from-browser',
          secretKey: 'cookieHeader',
        },
      })
      expect(toCapabilityContract(query)).toMatchObject({
        id: 'conan-config-query',
        routingHint: 'exact-match-direct-run',
        autonomousInvocation: { allowed: true },
      })
      expect(query.manifest.whenToUse.join('\n')).toContain('Space_Enhanced_Config')
      expect(readCapabilityScript({ id: 'conan-config-query', cwd })).toContain('/conan-config/api/newConfigs/')
      expect(readCapabilityScript({ id: 'conan-config-query', cwd })).toContain('saveConfigArtifacts')
      expect(readCapabilityScript({ id: 'conan-config-query', cwd })).toContain('latest.full.json')
      expect(query.manifest.inputSchema.properties).toMatchObject({
        saveArtifacts: { type: 'boolean' },
      })
      expect(query.manifest.outputSchema.properties).toMatchObject({
        artifacts: { type: 'object' },
      })
      expect(
        searchCapabilities({
          cwd,
          query:
            'https://buff.zhenguanyu.com/buff-army/#/buff-oversea-designer/Space_Enhanced_Config?key=wareLandingPageSendCouponConfig&rootGroupingKey=Space_Pedia',
        })[0]?.capability.manifest.id,
      ).toBe('conan-config-query')
      const routes = routeCapabilities({
        cwd,
        task:
          '查这个配置 https://buff.zhenguanyu.com/buff-army/#/buff-oversea-designer/Space_Enhanced_Config?key=wareLandingPageSendCouponConfig&rootGroupingKey=Space_Pedia&config=%E5%8F%91%E5%88%B8',
      })
      expect(routes[0]?.capability.manifest.id).toBe('conan-config-query')
      expect(routes[0]?.input).toEqual({
        url: 'https://buff.zhenguanyu.com/buff-army/#/buff-oversea-designer/Space_Enhanced_Config?key=wareLandingPageSendCouponConfig&rootGroupingKey=Space_Pedia&config=%E5%8F%91%E5%88%B8',
      })
      expect(routes[0]?.command).toContain('playwriter capability run conan-config-query')
      expect(routes[0]?.shellCommand).toBe(routes[0]?.command)
      expect(routes[0]?.commandWarning).toContain('not a shell command')
      expect(routes[0]?.commandWarning).toContain('run shellCommand exactly')
      expect(routes[0]?.executionHint).toMatchObject({
        routeCanRunSandboxed: true,
        runRequiresEscalatedSandbox: true,
        commandMustStartWith: 'playwriter capability run ',
      })
      expect(routeCapabilities({ cwd, task: 'https://example.com/not-a-known-config' })).toEqual([])
      expect(searchCapabilities({ cwd, query: '文案配置 查询 配置' })[0]?.capability.manifest.id).toMatch(
        /^conan-config-/,
      )
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('scaffolds and installs agent skills for AI-authored capabilities', () => {
    const cwd = createTempDir('capability-agent-skill-')
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
        },
      })

      const initialized = initCapabilityAgentSkill({ id: 'query-user', cwd })
      const skillPath = path.join(initialized.dir, 'SKILL.md')
      const openAiPath = path.join(initialized.dir, 'agents', 'openai.yaml')
      expect(initialized.files.map((file) => file.relativePath)).toEqual(['SKILL.md', 'agents/openai.yaml'])
      expect(fs.readFileSync(skillPath, 'utf-8')).toContain('PLAYWRITER_AGENT_SKILL_TEMPLATE')
      expect(fs.readFileSync(openAiPath, 'utf-8')).toContain('Query User')
      expect(showCapabilityAgentSkill({ id: 'query-user', cwd }).files[0]?.content).toContain('TODO')

      const codexHome = path.join(cwd, 'codex-home')
      expect(() => {
        installCapabilityAgentSkill({ id: 'query-user', cwd, codexHome })
      }).toThrow(/Edit the skill content before installing/)

      const editedSkill = fs
        .readFileSync(skillPath, 'utf-8')
        .replace('<!-- PLAYWRITER_AGENT_SKILL_TEMPLATE: edit before install -->\n\n', '')
        .replace('TODO: Explain when agents should use the query-user Playwriter capability. Mention concrete user phrasing, exact-match signals, and when not to use it.', 'Use when the user asks to look up an admin user by email.')
        .replace('- TODO: Describe the concrete user intent, URL pattern, page state, or data shape that should trigger this capability.', '- Use for admin user lookup requests that include an email address.')
        .replace('- TODO: State when this capability should not be used.', '- Do not use for public profile lookup.')
        .replace('- TODO: Define the default answer shape.', '- Return user id, email, and status.')
        .replace('- TODO: Say when to show a short summary versus when to point to artifacts.', '- Keep chat output short and point to artifacts for raw API output.')
        .replace('- TODO: Say whether large outputs should be saved, filtered, or exported only on request.', '- Export only when the user asks.')
      fs.writeFileSync(skillPath, editedSkill)

      const installed = installCapabilityAgentSkill({ id: 'query-user', cwd, codexHome })
      expect(installed.dir).toBe(path.join(codexHome, 'skills', 'query-user'))
      expect(
        fs.readFileSync(path.join(codexHome, 'skills', 'query-user', 'SKILL.md'), 'utf-8'),
      ).toContain('Use when the user asks to look up an admin user by email.')
      expect(
        fs.readFileSync(path.join(codexHome, 'skills', 'query-user', 'agents', 'openai.yaml'), 'utf-8'),
      ).toContain('Query User')
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
      expect(script).toContain('runOneWorkflowItem')
      expect(script).not.toContain('taskQueue.run')
      expect(script).not.toContain('approval.captureAndSubmit')
      expect(script).toContain('const items')
      expect(capability?.manifest.tags).toEqual(
        expect.arrayContaining(['workflow', 'recording-derived', 'recording:recording-456']),
      )
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

      expect(script).toContain('const finalRequest = undefined')
      expect(script).toContain('if (!finalRequest || !finalRequest.trigger)')
      expect(script).not.toContain('approval.captureAndSubmit')
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
      expect(prepared.code).toContain('const __playwriterCapabilityMatch = ["https://admin.example.com/*"];')
      expect(prepared.code).toContain('playwriter-capability://lookup-user')
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
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
})
