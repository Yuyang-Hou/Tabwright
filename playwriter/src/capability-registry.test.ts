import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createCapability,
  getProjectCapabilitiesDir,
  listCapabilities,
  readCapabilityScript,
  searchCapabilities,
  toCapabilityContract,
  updateCapabilityManifest,
  updateCapabilityScript,
  validateJsonAgainstSchema,
  writeCapabilitySecrets,
} from './capability-registry.js'
import { refreshCapabilityAuthWithExecutor } from './capability-auth.js'
import { prepareCapabilityRun, runNodeCapability } from './capability-runner.js'

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
        sideEffect: 'read',
        autonomousInvocation: { allowed: true },
      })
      expect(searchCapabilities({ query: '当前 Bilibili 登录账号', cwd }).map((result) => result.capability.manifest.id)).toEqual([
        'bilibili-current-user',
      ])
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
