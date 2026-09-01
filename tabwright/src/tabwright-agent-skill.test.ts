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

function createFixture(): { bundledSkillPath: string; homeDir: string } {
  const tmpRoot = path.resolve(process.cwd(), '..', 'tmp')
  fs.mkdirSync(tmpRoot, { recursive: true })
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'tabwright-agent-skill-test-'))
  tempDirs.push(dir)
  const bundledSkillPath = path.join(dir, 'bundled', 'SKILL.md')
  fs.mkdirSync(path.dirname(bundledSkillPath), { recursive: true })
  fs.writeFileSync(bundledSkillPath, '---\nname: tabwright\ndescription: Test skill\n---\n\nUse Tabwright.\n')
  return { bundledSkillPath, homeDir: path.join(dir, 'home') }
}

describe('Tabwright agent skill installation', () => {
  test('installs the bundled skill into the shared Agent Skills directory', () => {
    const fixture = createFixture()
    const missing = getTabwrightAgentSkillStatus(fixture)
    expect(missing.state).toBe('missing')
    expect(missing.installedPath).toBe(path.join(fixture.homeDir, '.agents', 'skills', 'tabwright', 'SKILL.md'))

    const installed = installTabwrightAgentSkill(fixture)
    expect(installed.fileStatus).toBe('created')
    expect(installed.state).toBe('current')
    expect(fs.readFileSync(installed.installedPath, 'utf-8')).toBe(fs.readFileSync(fixture.bundledSkillPath, 'utf-8'))

    const unchanged = installTabwrightAgentSkill(fixture)
    expect(unchanged.fileStatus).toBe('unchanged')
  })

  test('updates a managed copy when the bundled skill changes', () => {
    const fixture = createFixture()
    const installed = installTabwrightAgentSkill(fixture)
    fs.writeFileSync(fixture.bundledSkillPath, '---\nname: tabwright\ndescription: Updated\n---\n\nUpdated.\n')

    expect(getTabwrightAgentSkillStatus(fixture).state).toBe('outdated')
    const updated = installTabwrightAgentSkill(fixture)
    expect(updated.fileStatus).toBe('updated')
    expect(fs.readFileSync(installed.installedPath, 'utf-8')).toContain('description: Updated')
  })

  test('resolves Codex and Claude user Skill directories explicitly', () => {
    const fixture = createFixture()
    const codex = getTabwrightAgentSkillStatus({ ...fixture, target: 'codex' })
    const claude = getTabwrightAgentSkillStatus({ ...fixture, target: 'claude' })

    expect(codex.installedPath).toBe(path.join(fixture.homeDir, '.codex', 'skills', 'tabwright', 'SKILL.md'))
    expect(claude.installedPath).toBe(path.join(fixture.homeDir, '.claude', 'skills', 'tabwright', 'SKILL.md'))
  })

  test('preserves a user-modified copy unless force is explicit', () => {
    const fixture = createFixture()
    const installed = installTabwrightAgentSkill(fixture)
    fs.appendFileSync(installed.installedPath, '\nUser notes.\n')

    expect(getTabwrightAgentSkillStatus(fixture).state).toBe('modified')
    expect(() => {
      installTabwrightAgentSkill(fixture)
    }).toThrow(/Use --force to overwrite/)
    expect(fs.readFileSync(installed.installedPath, 'utf-8')).toContain('User notes.')

    const replaced = installTabwrightAgentSkill({ ...fixture, overwrite: true })
    expect(replaced.fileStatus).toBe('updated')
    expect(fs.readFileSync(installed.installedPath, 'utf-8')).not.toContain('User notes.')
  })

  test('preserves an unrecognized existing Skill', () => {
    const fixture = createFixture()
    const status = getTabwrightAgentSkillStatus(fixture)
    fs.mkdirSync(path.dirname(status.installedPath), { recursive: true })
    fs.writeFileSync(status.installedPath, 'User-owned Tabwright instructions.\n')

    expect(getTabwrightAgentSkillStatus(fixture).state).toBe('modified')
    expect(() => {
      installTabwrightAgentSkill(fixture)
    }).toThrow(/unmanaged changes/)
    expect(fs.readFileSync(status.installedPath, 'utf-8')).toBe('User-owned Tabwright instructions.\n')
  })
})
