import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { exportCapabilityAgentSkill } from './capability-agent-skill.js'
import { createCapability } from './capability-registry.js'
import { getCapabilityOptionsDetail, listCapabilityOptions } from './capability-options.js'
import type { AgentSkillRoot } from './agent-skill-discovery.js'

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

describe('capability options view', () => {
  test('lists legacy runtime capability contracts without agent-manager metadata', () => {
    const cwd = createTempDir('capability-options-')
    try {
      createCapability({
        id: 'options-tool',
        title: 'Options Tool',
        location: 'project',
        cwd,
      })
      const response = listCapabilityOptions({ cwd, agentSkillRoots: [] })
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

  test('discovers and deduplicates agent-managed Tabwright Skills with safe local state', () => {
    const cwd = createTempDir('capability-options-skills-')
    try {
      createCapability({
        id: 'installed-options-skill',
        title: 'Installed Options Skill',
        location: 'project',
        cwd,
      })
      const codexRoot = path.join(cwd, 'codex-skills')
      const claudeRoot = path.join(cwd, 'claude-skills')
      exportCapabilityAgentSkill({
        id: 'installed-options-skill',
        cwd,
        output: path.join(codexRoot, 'installed-options-skill'),
      })
      exportCapabilityAgentSkill({
        id: 'installed-options-skill',
        cwd,
        output: path.join(claudeRoot, 'installed-options-skill'),
      })
      fs.appendFileSync(path.join(claudeRoot, 'installed-options-skill', 'runtime', 'script.js'), '\n// Different installed copy.\n')
      const agentSkillRoots: AgentSkillRoot[] = [
        { dir: codexRoot, manager: 'codex', scope: 'user' },
        { dir: claudeRoot, manager: 'claude', scope: 'user' },
      ]

      const response = listCapabilityOptions({ cwd, agentSkillRoots })
      const installedSkills = response.capabilities.filter((capability) => {
        return capability.id === 'installed-options-skill'
      })
      expect(installedSkills).toHaveLength(1)
      expect(installedSkills[0]).toEqual(
        expect.objectContaining({
          location: 'skill',
          description: expect.stringContaining('Installed Options Skill'),
          agentSkill: {
            installations: [
              expect.objectContaining({ manager: 'codex', scope: 'user' }),
              expect.objectContaining({ manager: 'claude', scope: 'user' }),
            ],
            hasRuntimeConflict: true,
            localState: expect.objectContaining({
              auth: {
                type: 'none',
                status: 'not-required',
                canRefresh: false,
              },
              artifactCount: 0,
            }),
          },
        }),
      )
      expect(installedSkills[0]?.agentSkill).not.toHaveProperty('secrets')
      expect(installedSkills[0]?.agentSkill).not.toHaveProperty('cookieNames')

      const detail = getCapabilityOptionsDetail({ cwd, id: 'installed-options-skill', agentSkillRoots })
      expect(detail?.capability).toEqual(installedSkills[0])
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

      const response = listCapabilityOptions({ cwd, agentSkillRoots: [] })
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
