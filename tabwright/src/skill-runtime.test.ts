import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { prepareSkillRuntimeRun } from './skill-runtime-runner.js'

function createRuntime(options: {
  id: string
  sideEffect?: 'read' | 'write'
  requiresConfirmation?: boolean
  inputSchema?: Record<string, unknown>
}): { root: string; runtimeDir: string } {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  const root = fs.mkdtempSync(path.join(tempRoot, 'skill-runtime-'))
  const runtimeDir = path.join(root, options.id, 'runtime')
  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.writeFileSync(
    path.join(runtimeDir, 'capability.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: options.id,
        title: options.id,
        entry: 'script.js',
        runtime: 'node',
        sideEffect: options.sideEffect || 'read',
        requiresConfirmation: options.requiresConfirmation || false,
        inputSchema: options.inputSchema || { type: 'object' },
      },
      null,
      2,
    )}\n`,
  )
  fs.writeFileSync(path.join(runtimeDir, 'script.js'), 'return { ok: true }\n')
  return { root, runtimeDir }
}

describe('Skill runtime safety', () => {
  test('requires the exact confirmation token even when force is set', () => {
    const runtime = createRuntime({ id: 'confirmed-runtime', sideEffect: 'write', requiresConfirmation: true })
    try {
      expect(() => {
        prepareSkillRuntimeRun({ id: runtime.runtimeDir, input: {}, force: true })
      }).toThrow('requires explicit user confirmation')
      expect(() => {
        prepareSkillRuntimeRun({ id: runtime.runtimeDir, input: {}, force: true, confirmation: 'wrong' })
      }).toThrow('requires explicit user confirmation')
      expect(
        prepareSkillRuntimeRun({
          id: runtime.runtimeDir,
          input: {},
          force: true,
          confirmation: 'confirmed-runtime',
        }).operation.confirmationToken,
      ).toBe('confirmed-runtime')
    } finally {
      fs.rmSync(runtime.root, { recursive: true, force: true })
    }
  })

  test('validates runtime input before execution', () => {
    const runtime = createRuntime({
      id: 'schema-runtime',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    })
    try {
      expect(() => {
        prepareSkillRuntimeRun({ id: runtime.runtimeDir, input: {} })
      }).toThrow('Invalid Skill runtime input')
      expect(prepareSkillRuntimeRun({ id: runtime.runtimeDir, input: { query: 'ok' } }).operation.sideEffect).toBe(
        'read',
      )
    } finally {
      fs.rmSync(runtime.root, { recursive: true, force: true })
    }
  })
})
