import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import {
  createCapability,
  getProjectCapabilitiesDir,
  listCapabilities,
  readCapabilityRuns,
  readCapabilityScript,
  routeCapabilities,
  searchCapabilities,
  toCapabilityContract,
  updateCapabilityManifest as updateCapabilityManifestRecord,
  updateCapabilityScript,
  validateJsonAgainstSchema,
  writeCapabilitySecrets,
} from './capability-registry.js'
import { refreshCapabilityAuthWithExecutor } from './capability-auth.js'
import { installBuiltinCapabilitySuite } from './builtin-capabilities.js'
import {
  initCapabilityAgentSkill,
  installCapabilityAgentSkill,
  showCapabilityAgentSkill,
} from './capability-agent-skill.js'
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

      expect(installed.capabilities.map((capability) => capability.manifest.id)).toEqual(['conan-config'])
      expect(installed.agentSkills.map((agentSkill) => agentSkill.name)).toEqual(['conan-config'])
      expect(installed.agentSkills[0]?.target).toBe('codex')
      expect(fs.readFileSync(path.join(codexHome, 'skills', 'conan-config', 'SKILL.md'), 'utf-8')).toContain(
        '--confirm conan-config:apply-change',
      )
      expect(
        fs.readFileSync(path.join(codexHome, 'skills', 'conan-config', 'agents', 'openai.yaml'), 'utf-8'),
      ).toContain('Conan 文案配置')
      const projectCapabilityIds = listCapabilities({ cwd })
        .filter((capability) => {
          return capability.location === 'project'
        })
        .map((item) => item.manifest.id)
      expect(projectCapabilityIds).toEqual(['conan-config'])
      const query = listCapabilities({ cwd }).find((capability) => {
        return capability.manifest.id === 'conan-config'
      })
      if (!query) {
        throw new Error('Expected conan-config to be installed')
      }
      expect(query.manifest).toMatchObject({
        runtime: 'node',
        status: 'trusted',
        sideEffect: 'write',
        requiresConfirmation: true,
        operations: {
          search: { sideEffect: 'read', requiresConfirmation: false },
          get: { routingHint: 'exact-match-direct-run', sideEffect: 'read', requiresConfirmation: false },
          history: { sideEffect: 'read', requiresConfirmation: false },
          'get-schema': { sideEffect: 'read', requiresConfirmation: false },
          'prepare-change': { sideEffect: 'read', requiresConfirmation: false },
          'apply-change': { sideEffect: 'write', requiresConfirmation: true },
          'save-draft': { sideEffect: 'write', requiresConfirmation: true },
          'publish-draft': { sideEffect: 'write', requiresConfirmation: true },
          'discard-draft': { sideEffect: 'write', requiresConfirmation: true },
          create: { sideEffect: 'write', requiresConfirmation: true },
          copy: { sideEffect: 'write', requiresConfirmation: true },
          rollback: { sideEffect: 'write', requiresConfirmation: true },
        },
        auth: {
          type: 'cookie',
          refresh: 'from-browser',
          secretKey: 'cookieHeader',
        },
      })
      expect(toCapabilityContract(query)).toMatchObject({
        id: 'conan-config',
        autonomousInvocation: { allowed: false },
        operations: {
          get: { autonomousInvocation: { allowed: true } },
          'apply-change': {
            confirmationToken: 'conan-config:apply-change',
            autonomousInvocation: { allowed: false },
          },
          'save-draft': {
            confirmationToken: 'conan-config:save-draft',
            autonomousInvocation: { allowed: false },
          },
        },
      })
      expect(query.manifest.whenToUse.join('\n')).toContain('Space_Enhanced_Config')
      expect(readCapabilityScript({ id: 'conan-config', cwd })).toContain('/conan-config/api/newConfigs/')
      expect(readCapabilityScript({ id: 'conan-config', cwd })).toContain('saveConfigArtifacts')
      expect(readCapabilityScript({ id: 'conan-config', cwd })).toContain('source_changed_after_validation')
      expect(query.manifest.operations.get?.inputSchema.properties).toMatchObject({
        environment: { enum: ['cn-prod', 'cn-test'] },
        saveArtifacts: { type: 'boolean' },
      })
      expect(query.manifest.operations.get?.outputSchema.properties).toMatchObject({
        artifacts: { type: 'object' },
      })
      expect(
        searchCapabilities({
          cwd,
          query:
            'https://buff.zhenguanyu.com/buff-army/#/buff-oversea-designer/Space_Enhanced_Config?key=wareLandingPageSendCouponConfig&rootGroupingKey=Space_Pedia',
        })[0]?.capability.manifest.id,
      ).toBe('conan-config')
      const routes = routeCapabilities({
        cwd,
        task: '查这个配置 https://buff.zhenguanyu.com/buff-army/#/buff-oversea-designer/Space_Enhanced_Config?key=wareLandingPageSendCouponConfig&rootGroupingKey=Space_Pedia&config=%E5%8F%91%E5%88%B8',
      })
      expect(routes[0]?.capability.manifest.id).toBe('conan-config')
      expect(routes[0]?.operation).toBe('get')
      expect(routes[0]?.input).toEqual({
        action: 'get',
        url: 'https://buff.zhenguanyu.com/buff-army/#/buff-oversea-designer/Space_Enhanced_Config?key=wareLandingPageSendCouponConfig&rootGroupingKey=Space_Pedia&config=%E5%8F%91%E5%88%B8',
      })
      expect(routes[0]?.command).toContain('playwriter capability run conan-config')
      expect(routes[0]?.shellCommand).toBe(routes[0]?.command)
      expect(routes[0]?.commandWarning).toContain('not a shell command')
      expect(routes[0]?.commandWarning).toContain('run shellCommand exactly')
      expect(routes[0]?.executionHint).toMatchObject({
        routeCanRunSandboxed: true,
        runRequiresEscalatedSandbox: true,
        commandMustStartWith: 'playwriter capability run ',
      })
      const testRoute = routeCapabilities({
        cwd,
        task: 'https://buff-test.zhenguanyu.com/micro-buff/#/buff-oversea-designer/Space_Enhanced_Config?key=demoConfig&rootGroupingKey=Space_Pedia',
      })
      expect(testRoute[0]?.operation).toBe('get')
      expect(routeCapabilities({ cwd, task: 'https://example.com/not-a-known-config' })).toEqual([])
      expect(
        searchCapabilities({ cwd, query: '文案配置 查询 配置' }).some((result) => {
          return result.capability.manifest.id === 'conan-config'
        }),
      ).toBe(true)
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('runs unified Conan config read and confirmed publish operations', async () => {
    const cwd = createTempDir('capability-conan-config-run-')
    const currentValue = { title: 'before', items: [{ enabled: false }] }
    const targetValue = { title: 'after', items: [{ enabled: true }] }
    let publishedValue = currentValue
    let pendingValue = currentValue
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      const body = typeof init?.body === 'string' ? init.body : ''
      const responseBody: unknown = (() => {
        if (url.pathname.endsWith('/enhancedConfigs/searchTree')) {
          return { code: 0, data: { configBases: [] } }
        }
        if (url.pathname.includes('/enhancedConfigs/detail/')) {
          return {
            code: 0,
            data: {
              config: {
                id: 42,
                namespace: 'Space_Pedia',
                key: 'demo',
                desc: 'Demo config',
                name: 'Demo',
                groupingId: 7,
                schemaId: 9,
                updatedTime: 123,
                value: JSON.stringify(currentValue),
              },
              configDraft: null,
            },
          }
        }
        if (url.pathname.endsWith('/schema')) {
          return [
            {
              schemaJson: JSON.stringify({
                schema: {
                  type: 'object',
                  properties: {
                    title: { name: 'title', title: '标题', type: 'string', 'x-index': 0 },
                    items: { name: 'items', title: '列表', type: 'array', 'x-index': 1 },
                  },
                },
                form: {},
              }),
            },
          ]
        }
        if (url.pathname.endsWith('/enhancedConfigs/update')) {
          const payload = JSON.parse(body) as { value: string }
          pendingValue = JSON.parse(payload.value) as typeof currentValue
          return { code: 0, data: 88 }
        }
        if (url.pathname.endsWith('/enhancedConfigs/publish')) {
          publishedValue = pendingValue
          return { code: 0, data: true }
        }
        if (url.pathname.includes('/newConfigs/')) {
          return {
            id: 42,
            namespace: 'Space_Pedia',
            key: 'demo',
            desc: 'Demo config',
            updatedTime: 123,
            value: JSON.stringify(publishedValue),
          }
        }
        throw new Error(`Unexpected Conan test request: ${url.toString()}`)
      })()
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    try {
      const installed = installBuiltinCapabilitySuite({
        suite: 'conan-config',
        location: 'project',
        cwd,
        installAgentSkills: false,
      })
      const capability = installed.capabilities[0]
      if (!capability) {
        throw new Error('Expected unified Conan config capability')
      }
      writeCapabilitySecrets({ capability, secrets: { cookieHeader: 'session=test' } })

      await expect(
        runNodeCapability({ id: 'conan-config', cwd, input: { action: 'search', query: 'demo' } }),
      ).resolves.toMatchObject({ output: { action: 'search', resultCount: 0 } })

      const prepared = await runNodeCapability({
        id: 'conan-config',
        cwd,
        input: {
          action: 'prepare-change',
          namespace: 'Space_Pedia',
          key: 'demo',
          value: targetValue,
          changeSummary: '更新标题并启用第一项',
        },
      })
      const preparedOutput = prepared.output as {
        schemaId: number
        updatedTime: number
        sourceSha256: string
        targetSha256: string
        diff: unknown[]
      }
      expect(preparedOutput.diff.length).toBeGreaterThan(0)

      const applyInput = {
        action: 'apply-change',
        namespace: 'Space_Pedia',
        key: 'demo',
        value: targetValue,
        changeSummary: '更新标题并启用第一项',
        validationReport: {
          passed: true,
          errors: [],
          warnings: [],
          warningsAccepted: true,
          environment: 'cn-prod',
          schemaId: preparedOutput.schemaId,
          updatedTime: preparedOutput.updatedTime,
          sourceSha256: preparedOutput.sourceSha256,
          targetSha256: preparedOutput.targetSha256,
          summary: '校验通过',
        },
      }
      await expect(runNodeCapability({ id: 'conan-config', cwd, input: applyInput })).rejects.toThrow(
        'rerun with --confirm conan-config:apply-change',
      )
      await expect(
        runNodeCapability({
          id: 'conan-config',
          cwd,
          input: applyInput,
          confirmation: 'conan-config:apply-change',
        }),
      ).resolves.toMatchObject({ output: { status: 'published', submitted: true, verified: true } })
      expect(publishedValue).toEqual(targetValue)
    } finally {
      vi.unstubAllGlobals()
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('runs Conan config draft, create, copy, history, and rollback operations in cn-test', async () => {
    const cwd = createTempDir('capability-conan-config-lifecycle-')
    type TestConfig = {
      id: number
      namespace: string
      rootGroupingKey: string
      key: string
      name: string
      desc: string
      groupingId: number
      schemaId: number
      updatedTime: number
      value: string
    }
    type TestDraft = {
      id: number
      opLdap: string
      config: TestConfig
    }
    const initialValue = { title: 'current', enabled: false }
    const draftValue = { title: 'draft', enabled: true }
    const discardedValue = { title: 'discard me', enabled: true }
    const historicalValue = { title: 'historical', enabled: false }
    const configs = new Map<string, TestConfig>()
    configs.set('Space_Pedia/demo_config', {
      id: 42,
      namespace: 'Space_Pedia',
      rootGroupingKey: 'Space_Pedia',
      key: 'demo_config',
      name: 'Demo',
      desc: 'Demo config',
      groupingId: 7,
      schemaId: 9,
      updatedTime: 123,
      value: JSON.stringify(initialValue),
    })
    let configDraft: TestDraft | null = null
    let nextConfigId = 43
    let nextDraftId = 88
    const requestedHosts = new Set<string>()
    const schemaRow = {
      id: 9,
      name: 'Demo schema',
      schemaJson: JSON.stringify({
        schema: {
          type: 'object',
          properties: {
            title: { name: 'title', title: '标题', type: 'string', required: true, 'x-index': 0 },
            enabled: { name: 'enabled', title: '启用', type: 'boolean', 'x-index': 1 },
          },
        },
        form: {},
      }),
    }
    const buildTree = () => {
      return [
        {
          id: 1,
          type: 2,
          name: 'Space Pedia',
          groupingKey: 'Space_Pedia',
          updatedTime: 200,
          children: [
            {
              id: 7,
              type: 2,
              name: 'Target group',
              groupingKey: 'target_group',
              updatedTime: 201,
              children: Array.from(configs.values()).map((config) => {
                return {
                  id: config.id,
                  type: 1,
                  name: config.name,
                  key: config.key,
                  rootGroupingKey: config.rootGroupingKey,
                  groupingId: config.groupingId,
                  schemaId: config.schemaId,
                }
              }),
            },
          ],
        },
      ]
    }
    const findConfigById = (id: number) => {
      return Array.from(configs.values()).find((config) => {
        return config.id === id
      })
    }
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      requestedHosts.add(url.origin)
      const body = typeof init?.body === 'string' ? init.body : ''
      const responseBody: unknown = await (async () => {
        if (url.pathname.endsWith('/enhancedConfigGroupings/rootGrouping')) {
          return { code: 0, data: buildTree() }
        }
        if (url.pathname.endsWith('/enhancedConfigs/searchTree')) {
          return { code: 0, data: { configBases: buildTree() } }
        }
        if (url.pathname.endsWith('/enhancedConfigs/detailHistory')) {
          return {
            code: 0,
            data: [
              {
                id: 501,
                configId: 42,
                config: {
                  ...configs.get('Space_Pedia/demo_config'),
                  schemaId: 9,
                  value: JSON.stringify(historicalValue),
                },
              },
            ],
          }
        }
        if (url.pathname.endsWith('/enhancedConfigs/detail') && url.searchParams.has('id')) {
          const config = findConfigById(Number(url.searchParams.get('id')))
          return { code: 0, data: { config, configDraft: config?.id === 42 ? configDraft : null } }
        }
        if (url.pathname.includes('/enhancedConfigs/detail/')) {
          const [, namespace, key] = url.pathname.match(/\/enhancedConfigs\/detail\/([^/]+)\/([^/]+)$/) || []
          const config = configs.get(`${decodeURIComponent(namespace || '')}/${decodeURIComponent(key || '')}`)
          return {
            code: 0,
            data: {
              config,
              configDraft: config?.id === 42 ? configDraft : null,
              configHistories: config?.id === 42 ? [{ id: 501, configId: 42, opType: 3 }] : [],
            },
          }
        }
        if (url.pathname.endsWith('/schema')) {
          return [schemaRow]
        }
        if (url.pathname.endsWith('/enhancedConfigs/update')) {
          const payload = JSON.parse(body) as {
            id: number
            name: string
            desc: string
            groupingId: number
            schemaId: number
            value: string
          }
          const config = findConfigById(payload.id)
          if (!config) {
            throw new Error(`Missing config for update: ${payload.id}`)
          }
          configDraft = {
            id: nextDraftId,
            opLdap: 'tester',
            config: { ...config, ...payload },
          }
          nextDraftId += 1
          return { code: 0, data: configDraft.id }
        }
        if (url.pathname.endsWith('/enhancedConfigs/publish')) {
          if (!configDraft) {
            throw new Error('Missing draft for publish')
          }
          const config = findConfigById(configDraft.config.id)
          if (!config) {
            throw new Error(`Missing config for publish: ${configDraft.config.id}`)
          }
          Object.assign(config, configDraft.config, { updatedTime: config.updatedTime + 1 })
          configDraft = null
          return { code: 0, data: true }
        }
        if (url.pathname.endsWith('/enhancedConfigs/unPublish')) {
          configDraft = null
          return { code: 0, data: true }
        }
        if (url.pathname.endsWith('/enhancedConfigs/add')) {
          const payload = JSON.parse(body) as {
            groupingId: number
            key: string
            name: string
            desc: string
            schemaId: number
          }
          const config: TestConfig = {
            id: nextConfigId,
            namespace: 'Space_Pedia',
            rootGroupingKey: 'Space_Pedia',
            key: payload.key,
            name: payload.name,
            desc: payload.desc,
            groupingId: payload.groupingId,
            schemaId: payload.schemaId,
            updatedTime: 300,
            value: '{}',
          }
          nextConfigId += 1
          configs.set(`Space_Pedia/${config.key}`, config)
          return {
            code: 0,
            data: { id: config.id, rootGroupingKey: config.rootGroupingKey, key: config.key },
          }
        }
        if (url.pathname.includes('/newConfigs/')) {
          const [, namespace, key] = url.pathname.match(/\/newConfigs\/([^/]+)\/([^/]+)$/) || []
          return configs.get(`${decodeURIComponent(namespace || '')}/${decodeURIComponent(key || '')}`)
        }
        throw new Error(`Unexpected Conan lifecycle test request: ${url.toString()}`)
      })()
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      const installed = installBuiltinCapabilitySuite({
        suite: 'conan-config',
        location: 'project',
        cwd,
        installAgentSkills: false,
      })
      const capability = installed.capabilities[0]
      if (!capability) {
        throw new Error('Expected unified Conan config capability')
      }
      writeCapabilitySecrets({ capability, secrets: { cookieHeader: 'session=test' } })

      await expect(
        runNodeCapability({ id: 'conan-config', cwd, input: { action: 'list-spaces', environment: 'cn-test' } }),
      ).resolves.toMatchObject({ output: { environment: 'cn-test', count: 1 } })
      await expect(
        runNodeCapability({
          id: 'conan-config',
          cwd,
          input: { action: 'get-schema', environment: 'cn-test', schemaId: 9 },
        }),
      ).resolves.toMatchObject({ output: { environment: 'cn-test', schemaId: 9 } })
      await expect(
        runNodeCapability({
          id: 'conan-config',
          cwd,
          input: {
            action: 'history',
            environment: 'cn-test',
            namespace: 'Space_Pedia',
            key: 'demo_config',
            historyIds: [501],
          },
        }),
      ).resolves.toMatchObject({ output: { historyCount: 1, details: [{ id: 501 }] } })

      const prepared = await runNodeCapability({
        id: 'conan-config',
        cwd,
        input: {
          action: 'prepare-change',
          environment: 'cn-test',
          namespace: 'Space_Pedia',
          key: 'demo_config',
          value: draftValue,
          changeSummary: 'save a test draft',
        },
      })
      const preparedOutput = prepared.output as {
        environment: string
        schemaId: number
        updatedTime: number
        sourceSha256: string
        targetSha256: string
      }
      const changeReport = {
        passed: true,
        errors: [],
        warnings: [],
        warningsAccepted: true,
        environment: preparedOutput.environment,
        schemaId: preparedOutput.schemaId,
        updatedTime: preparedOutput.updatedTime,
        sourceSha256: preparedOutput.sourceSha256,
        targetSha256: preparedOutput.targetSha256,
        summary: 'validated',
      }
      await expect(
        runNodeCapability({
          id: 'conan-config',
          cwd,
          input: {
            action: 'save-draft',
            environment: 'cn-test',
            namespace: 'Space_Pedia',
            key: 'demo_config',
            value: draftValue,
            changeSummary: 'save a test draft',
            validationReport: changeReport,
          },
          confirmation: 'conan-config:save-draft',
        }),
      ).resolves.toMatchObject({ output: { status: 'draft_saved', published: false, verified: true } })

      const publishPrepared = await runNodeCapability({
        id: 'conan-config',
        cwd,
        input: {
          action: 'prepare-publish-draft',
          environment: 'cn-test',
          namespace: 'Space_Pedia',
          key: 'demo_config',
        },
      })
      const publishOutput = publishPrepared.output as {
        environment: string
        configDraftId: number
        schemaId: number
        updatedTime: number
        sourceSha256: string
        draftSha256: string
      }
      await expect(
        runNodeCapability({
          id: 'conan-config',
          cwd,
          input: {
            action: 'publish-draft',
            environment: 'cn-test',
            namespace: 'Space_Pedia',
            key: 'demo_config',
            validationReport: {
              passed: true,
              errors: [],
              warnings: [],
              warningsAccepted: true,
              ...publishOutput,
              summary: 'publish validated draft',
            },
          },
          confirmation: 'conan-config:publish-draft',
        }),
      ).resolves.toMatchObject({ output: { status: 'published', published: true, verified: true } })

      const discardPrepared = await runNodeCapability({
        id: 'conan-config',
        cwd,
        input: {
          action: 'prepare-change',
          environment: 'cn-test',
          namespace: 'Space_Pedia',
          key: 'demo_config',
          value: discardedValue,
          changeSummary: 'discard this draft',
        },
      })
      const discardChangeOutput = discardPrepared.output as {
        environment: string
        schemaId: number
        updatedTime: number
        sourceSha256: string
        targetSha256: string
      }
      await runNodeCapability({
        id: 'conan-config',
        cwd,
        input: {
          action: 'save-draft',
          environment: 'cn-test',
          namespace: 'Space_Pedia',
          key: 'demo_config',
          value: discardedValue,
          changeSummary: 'discard this draft',
          validationReport: {
            passed: true,
            errors: [],
            warnings: [],
            warningsAccepted: true,
            ...discardChangeOutput,
            summary: 'validated',
          },
        },
        confirmation: 'conan-config:save-draft',
      })
      const discardInspection = await runNodeCapability({
        id: 'conan-config',
        cwd,
        input: {
          action: 'prepare-publish-draft',
          environment: 'cn-test',
          namespace: 'Space_Pedia',
          key: 'demo_config',
        },
      })
      const discardInspectionOutput = discardInspection.output as { configDraftId: number; draftSha256: string }
      await expect(
        runNodeCapability({
          id: 'conan-config',
          cwd,
          input: {
            action: 'discard-draft',
            environment: 'cn-test',
            namespace: 'Space_Pedia',
            key: 'demo_config',
            configDraftId: discardInspectionOutput.configDraftId,
            draftSha256: discardInspectionOutput.draftSha256,
          },
          confirmation: 'conan-config:discard-draft',
        }),
      ).resolves.toMatchObject({ output: { status: 'draft_discarded', verified: true } })

      const rollbackPrepared = await runNodeCapability({
        id: 'conan-config',
        cwd,
        input: {
          action: 'prepare-rollback',
          environment: 'cn-test',
          namespace: 'Space_Pedia',
          key: 'demo_config',
          historyId: 501,
        },
      })
      const rollbackOutput = rollbackPrepared.output as {
        environment: string
        historyId: number
        schemaId: number
        updatedTime: number
        sourceSha256: string
        historicalSha256: string
      }
      await expect(
        runNodeCapability({
          id: 'conan-config',
          cwd,
          input: {
            action: 'rollback',
            environment: 'cn-test',
            namespace: 'Space_Pedia',
            key: 'demo_config',
            historyId: 501,
            validationReport: {
              passed: true,
              errors: [],
              warnings: [],
              warningsAccepted: true,
              ...rollbackOutput,
              summary: 'rollback validated',
            },
          },
          confirmation: 'conan-config:rollback',
        }),
      ).resolves.toMatchObject({ output: { status: 'rolled_back', published: true, verified: true } })

      const createInput = {
        action: 'prepare-create',
        environment: 'cn-test',
        groupingId: 7,
        key: 'new_config',
        name: 'New config',
        desc: 'New config description',
        schemaId: 9,
      }
      const createPrepared = await runNodeCapability({ id: 'conan-config', cwd, input: createInput })
      const createOutput = createPrepared.output as {
        environment: string
        groupingUpdatedTime: number
        targetSha256: string
      }
      await expect(
        runNodeCapability({
          id: 'conan-config',
          cwd,
          input: {
            ...createInput,
            action: 'create',
            preparationReport: createOutput,
          },
          confirmation: 'conan-config:create',
        }),
      ).resolves.toMatchObject({ output: { status: 'created', published: true, verified: true } })

      const copyInput = {
        action: 'prepare-copy',
        environment: 'cn-test',
        sourceNamespace: 'Space_Pedia',
        sourceKey: 'demo_config',
        groupingId: 7,
        targetKey: 'copy_config',
      }
      const copyPrepared = await runNodeCapability({ id: 'conan-config', cwd, input: copyInput })
      const copyOutput = copyPrepared.output as {
        environment: string
        groupingUpdatedTime: number
        targetSha256: string
        sourceDefinitionSha256: string
      }
      await expect(
        runNodeCapability({
          id: 'conan-config',
          cwd,
          input: {
            ...copyInput,
            action: 'copy',
            preparationReport: copyOutput,
          },
          confirmation: 'conan-config:copy',
        }),
      ).resolves.toMatchObject({
        output: { status: 'copied', contentCopied: false, published: true, verified: true },
      })

      expect(requestedHosts).toEqual(new Set(['https://ytkconan.zhenguanyu.com']))
    } finally {
      vi.unstubAllGlobals()
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
        .replace(
          'TODO: Explain when agents should use the query-user Playwriter capability. Mention concrete user phrasing, exact-match signals, and when not to use it.',
          'Use when the user asks to look up an admin user by email.',
        )
        .replace(
          '- TODO: Describe the concrete user intent, URL pattern, page state, or data shape that should trigger this capability.',
          '- Use for admin user lookup requests that include an email address.',
        )
        .replace('- TODO: State when this capability should not be used.', '- Do not use for public profile lookup.')
        .replace('- TODO: Define the default answer shape.', '- Return user id, email, and status.')
        .replace(
          '- TODO: Say when to show a short summary versus when to point to artifacts.',
          '- Keep chat output short and point to artifacts for raw API output.',
        )
        .replace(
          '- TODO: Say whether large outputs should be saved, filtered, or exported only on request.',
          '- Export only when the user asks.',
        )
      fs.writeFileSync(skillPath, editedSkill)

      const installed = installCapabilityAgentSkill({ id: 'query-user', cwd, codexHome })
      expect(installed.dir).toBe(path.join(codexHome, 'skills', 'query-user'))
      expect(fs.readFileSync(path.join(codexHome, 'skills', 'query-user', 'SKILL.md'), 'utf-8')).toContain(
        'Use when the user asks to look up an admin user by email.',
      )
      expect(fs.readFileSync(path.join(codexHome, 'skills', 'query-user', 'agents', 'openai.yaml'), 'utf-8')).toContain(
        'Query User',
      )

      createCapability({ id: 'update-user', location: 'project', cwd, runtime: 'browser' })
      updateCapabilityManifest({
        id: 'update-user',
        cwd,
        patch: { sideEffect: 'write', requiresConfirmation: true },
      })
      const writeSkill = initCapabilityAgentSkill({ id: 'update-user', cwd })
      const writeSkillContent = fs.readFileSync(path.join(writeSkill.dir, 'SKILL.md'), 'utf-8')
      expect(writeSkillContent).toContain('--browser user')
      expect(writeSkillContent).toContain('--force')
      expect(writeSkillContent).toContain('--confirm update-user')
      expect(writeSkillContent).toContain('Stop and obtain explicit user approval')
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
              text: '[return value] { __playwriterCapabilityEnvelope: 1, output: { ok: true } }',
              images: [],
              screenshots: [],
              isError: false,
              structuredResult: {
                __playwriterCapabilityEnvelope: 1,
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
      expect(result.executeResult.text).not.toContain('__playwriterCapabilityEnvelope')
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
                text: '[return value] { __playwriterCapabilityEnvelope: 1 }',
                images: [],
                screenshots: [],
                isError: false,
                structuredResult: {
                  __playwriterCapabilityEnvelope: 1,
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
