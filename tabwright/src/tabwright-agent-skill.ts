import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getInstalledTabwrightPackageDir } from './package-paths.js'

export type TabwrightAgentSkillTarget = 'codex'
export type TabwrightAgentSkillState = 'missing' | 'current' | 'outdated'

export interface TabwrightAgentSkillStatus {
  target: TabwrightAgentSkillTarget
  state: TabwrightAgentSkillState
  bundledPath: string
  installedPath: string
  bundledSha256: string
  installedSha256?: string
  installCommand: string
}

export interface TabwrightAgentSkillInstallResult extends TabwrightAgentSkillStatus {
  fileStatus: 'created' | 'updated' | 'unchanged'
  next: string[]
}

export function getBundledTabwrightAgentSkillPath(options: { bundledSkillPath?: string } = {}): string {
  if (options.bundledSkillPath) {
    return options.bundledSkillPath
  }
  const packageDir = getInstalledTabwrightPackageDir()
  const repositoryRoot = path.join(packageDir, '..')
  const packagedSkillPath = path.join(packageDir, 'dist', 'agent-skills', 'tabwright', 'SKILL.md')
  const repositorySkillPath = path.join(repositoryRoot, 'skills', 'tabwright', 'SKILL.md')
  const candidates = fs.existsSync(path.join(repositoryRoot, '.git'))
    ? [repositorySkillPath, packagedSkillPath]
    : [packagedSkillPath]
  const bundledPath = candidates.find((candidate) => {
    return fs.existsSync(candidate)
  })
  if (!bundledPath) {
    throw new Error(`Bundled Tabwright skill not found under ${packageDir}. Rebuild or reinstall the CLI.`)
  }
  return bundledPath
}

export function getTabwrightAgentSkillStatus(options: {
  target?: TabwrightAgentSkillTarget
  codexHome?: string
  bundledSkillPath?: string
} = {}): TabwrightAgentSkillStatus {
  const target = options.target || 'codex'
  const bundledPath = getBundledTabwrightAgentSkillPath({ bundledSkillPath: options.bundledSkillPath })
  const installedPath = path.join(getCodexHome(options.codexHome), 'skills', 'tabwright', 'SKILL.md')
  const bundledContent = fs.readFileSync(bundledPath, 'utf-8')
  const installedContent = fs.existsSync(installedPath) ? fs.readFileSync(installedPath, 'utf-8') : undefined
  const state: TabwrightAgentSkillState = (() => {
    if (installedContent === undefined) {
      return 'missing'
    }
    return installedContent === bundledContent ? 'current' : 'outdated'
  })()
  return {
    target,
    state,
    bundledPath,
    installedPath,
    bundledSha256: sha256(bundledContent),
    ...(installedContent === undefined ? {} : { installedSha256: sha256(installedContent) }),
    installCommand: `tabwright skill install --target ${target}${state === 'outdated' ? ' --force' : ''}`,
  }
}

export function installTabwrightAgentSkill(options: {
  target?: TabwrightAgentSkillTarget
  codexHome?: string
  bundledSkillPath?: string
  overwrite?: boolean
} = {}): TabwrightAgentSkillInstallResult {
  const before = getTabwrightAgentSkillStatus(options)
  if (before.state === 'current') {
    return {
      ...before,
      fileStatus: 'unchanged',
      next: ['Restart or open a new Codex thread so it can load the Tabwright skill.'],
    }
  }
  if (before.state === 'outdated' && !options.overwrite) {
    throw new Error(`Installed Tabwright skill differs from this CLI: ${before.installedPath}. Use --force to overwrite.`)
  }
  fs.mkdirSync(path.dirname(before.installedPath), { recursive: true })
  fs.copyFileSync(before.bundledPath, before.installedPath)
  const after = getTabwrightAgentSkillStatus(options)
  return {
    ...after,
    fileStatus: before.state === 'missing' ? 'created' : 'updated',
    next: ['Restart or open a new Codex thread so it can load the Tabwright skill.'],
  }
}

function getCodexHome(codexHome?: string): string {
  return path.resolve(codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'))
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}
