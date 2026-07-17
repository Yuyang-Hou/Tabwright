import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { createCapability } from './capability-registry.js'
import { listCapabilityOptions } from './capability-options.js'

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

describe('capability options view', () => {
  test('lists runtime capability contracts without agent-manager state', () => {
    const cwd = createTempDir('capability-options-')
    try {
      createCapability({
        id: 'options-tool',
        title: 'Options Tool',
        location: 'project',
        cwd,
      })
      const response = listCapabilityOptions({ cwd })
      expect(response.cwd).toBe(cwd)
      expect(response.capabilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'options-tool',
            title: 'Options Tool',
          }),
        ]),
      )
      expect(response.capabilities[0]).not.toHaveProperty('agentSkill')
      expect(response.capabilities[0]).not.toHaveProperty('authState')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('keeps the capability list available when run logs or entry scripts are damaged', () => {
    const cwd = createTempDir('capability-options-damaged-')
    try {
      const damagedRuns = createCapability({
        id: 'damaged-runs',
        title: 'Damaged Runs',
        location: 'project',
        cwd,
      })
      fs.writeFileSync(path.join(damagedRuns.dir, 'runs.jsonl'), '{"id":\n')

      const missingScript = createCapability({
        id: 'missing-script',
        title: 'Missing Script',
        location: 'project',
        cwd,
      })
      fs.rmSync(missingScript.scriptPath)

      const response = listCapabilityOptions({ cwd })
      const damagedRunsItem = response.capabilities.find((capability) => capability.id === 'damaged-runs')
      const missingScriptItem = response.capabilities.find((capability) => capability.id === 'missing-script')

      expect(damagedRunsItem).toEqual(expect.objectContaining({ recentRuns: [] }))
      expect(missingScriptItem).toEqual(
        expect.objectContaining({
          lifecycle: expect.objectContaining({
            stage: 'drifted',
            contractHealth: expect.objectContaining({
              state: 'drifted',
              reasons: expect.arrayContaining([expect.stringContaining('Cannot validate the capability entry script')]),
            }),
          }),
          autonomousInvocation: expect.objectContaining({
            allowed: false,
          }),
        }),
      )
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
})
