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
  test('lists capabilities with read-only agent skill status', () => {
    const cwd = createTempDir('capability-options-')
    try {
      const capability = createCapability({
        id: 'options-tool',
        title: 'Options Tool',
        location: 'project',
        cwd,
      })
      const skillPath = path.join(capability.dir, 'agent-skills', 'codex', 'SKILL.md')
      fs.mkdirSync(path.dirname(skillPath), { recursive: true })
      fs.writeFileSync(skillPath, '---\nname: options-tool\n---\n')

      const response = listCapabilityOptions({ cwd })
      expect(response.cwd).toBe(cwd)
      expect(response.capabilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'options-tool',
            title: 'Options Tool',
            agentSkill: expect.objectContaining({
              draftExists: true,
              initCommand: 'playwriter capability skill init options-tool',
              installCommand: 'playwriter capability skill install options-tool',
            }),
          }),
        ]),
      )
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
})
