import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { getSkillRuntimeOptionsDetail, listSkillRuntimeOptions } from './skill-runtime-options.js'
import type { AgentSkillRoot } from './agent-skill-discovery.js'

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

function writeSkillRuntime(options: { root: string; id: string; script?: string }): void {
  const skillDir = path.join(options.root, options.id)
  const runtimeDir = path.join(skillDir, 'runtime')
  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${options.id}\ndescription: Installed ${options.id} Skill.\n---\n`,
  )
  fs.writeFileSync(
    path.join(runtimeDir, 'capability.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: options.id,
        title: options.id,
        entry: 'script.js',
        runtime: 'node',
        sideEffect: 'read',
        requiresConfirmation: false,
      },
      null,
      2,
    )}\n`,
  )
  fs.writeFileSync(path.join(runtimeDir, 'script.js'), options.script || 'return { ok: true }\n')
}

describe('Skill runtime options view', () => {
  test('discovers and deduplicates installed Skills without reading a Tabwright registry', () => {
    const cwd = createTempDir('skill-runtime-options-')
    try {
      const codexRoot = path.join(cwd, 'codex-skills')
      const claudeRoot = path.join(cwd, 'claude-skills')
      writeSkillRuntime({ root: codexRoot, id: 'installed-options-skill' })
      writeSkillRuntime({
        root: claudeRoot,
        id: 'installed-options-skill',
        script: 'return { source: "different installation" }\n',
      })
      const agentSkillRoots: AgentSkillRoot[] = [
        { dir: codexRoot, manager: 'codex', scope: 'user' },
        { dir: claudeRoot, manager: 'claude', scope: 'user' },
      ]

      const response = listSkillRuntimeOptions({ cwd, agentSkillRoots })
      expect(response.capabilities).toHaveLength(1)
      expect(response.capabilities[0]).toEqual(
        expect.objectContaining({
          id: 'installed-options-skill',
          location: 'skill',
          description: 'Installed installed-options-skill Skill.',
          agentSkill: {
            installations: [
              expect.objectContaining({ manager: 'codex', scope: 'user' }),
              expect.objectContaining({ manager: 'claude', scope: 'user' }),
            ],
            hasRuntimeConflict: true,
            localState: expect.objectContaining({
              auth: { type: 'none', status: 'not-required', canRefresh: false },
              artifactCount: 0,
            }),
          },
        }),
      )
      expect(response.capabilities[0]?.agentSkill).not.toHaveProperty('secrets')

      const detail = getSkillRuntimeOptionsDetail({
        cwd,
        id: 'installed-options-skill',
        agentSkillRoots,
      })
      expect(detail?.capability).toEqual(response.capabilities[0])
      expect(fs.existsSync(path.join(cwd, '.tabwright', 'capabilities'))).toBe(false)
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
})
