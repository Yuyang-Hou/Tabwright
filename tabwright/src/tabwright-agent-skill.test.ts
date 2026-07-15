import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { getTabwrightAgentSkillStatus, installTabwrightAgentSkill } from './tabwright-agent-skill.js'

const tempDirs: string[] = []

afterEach(() => {
  tempDirs.splice(0).map((dir) => {
    fs.rmSync(dir, { recursive: true, force: true })
    return dir
  })
})

function createFixture(): { bundledSkillPath: string; codexHome: string } {
  const tmpRoot = path.resolve(process.cwd(), '..', 'tmp')
  fs.mkdirSync(tmpRoot, { recursive: true })
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'tabwright-agent-skill-test-'))
  tempDirs.push(dir)
  const bundledSkillPath = path.join(dir, 'bundled', 'SKILL.md')
  fs.mkdirSync(path.dirname(bundledSkillPath), { recursive: true })
  fs.writeFileSync(bundledSkillPath, '---\nname: tabwright\ndescription: Test skill\n---\n\nUse Tabwright.\n')
  return { bundledSkillPath, codexHome: path.join(dir, 'codex-home') }
}

describe('Tabwright agent skill installation', () => {
  test('installs the bundled skill and reports it current', () => {
    const fixture = createFixture()
    const missing = getTabwrightAgentSkillStatus(fixture)
    expect(missing.state).toBe('missing')
    expect(missing.installCommand).toBe('tabwright skill install --target codex')

    const installed = installTabwrightAgentSkill(fixture)
    expect(installed.fileStatus).toBe('created')
    expect(installed.state).toBe('current')
    expect(fs.readFileSync(installed.installedPath, 'utf-8')).toBe(
      fs.readFileSync(fixture.bundledSkillPath, 'utf-8'),
    )

    const unchanged = installTabwrightAgentSkill(fixture)
    expect(unchanged.fileStatus).toBe('unchanged')
  })

  test('requires force before replacing a different installed skill', () => {
    const fixture = createFixture()
    const installedPath = path.join(fixture.codexHome, 'skills', 'tabwright', 'SKILL.md')
    fs.mkdirSync(path.dirname(installedPath), { recursive: true })
    fs.writeFileSync(installedPath, 'locally edited skill\n')

    const outdated = getTabwrightAgentSkillStatus(fixture)
    expect(outdated.state).toBe('outdated')
    expect(outdated.installCommand).toBe('tabwright skill install --target codex --force')
    expect(() => {
      installTabwrightAgentSkill(fixture)
    }).toThrow(/Use --force to overwrite/)

    const updated = installTabwrightAgentSkill({ ...fixture, overwrite: true })
    expect(updated.fileStatus).toBe('updated')
    expect(updated.state).toBe('current')
  })
})
