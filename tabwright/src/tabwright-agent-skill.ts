import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getInstalledTabwrightPackageDir } from './package-paths.js'

export type TabwrightAgentSkillTarget = 'agents' | 'codex' | 'claude'
export type TabwrightAgentSkillState = 'missing' | 'current' | 'outdated' | 'modified'

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

interface TabwrightAgentSkillMetadata {
  schemaVersion: 1
  managedBy: 'tabwright'
  installedSha256: string
}

const INSTALL_METADATA_FILE = '.tabwright-install.json'

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

export function getTabwrightAgentSkillStatus(
  options: {
    target?: TabwrightAgentSkillTarget
    homeDir?: string
    skillRoot?: string
    bundledSkillPath?: string
  } = {},
): TabwrightAgentSkillStatus {
  const target = options.target || 'agents'
  const bundledPath = getBundledTabwrightAgentSkillPath({ bundledSkillPath: options.bundledSkillPath })
  const installedDir = path.join(getAgentSkillRoot(options), 'tabwright')
  const installedPath = path.join(installedDir, 'SKILL.md')
  const bundledContent = fs.readFileSync(bundledPath, 'utf-8')
  const installedContent = fs.existsSync(installedPath) ? fs.readFileSync(installedPath, 'utf-8') : undefined
  const bundledSha256 = sha256(bundledContent)
  const installedSha256 = installedContent === undefined ? undefined : sha256(installedContent)
  const metadata = readInstallMetadata(installedDir)
  const state: TabwrightAgentSkillState = (() => {
    if (installedSha256 === undefined) {
      return 'missing'
    }
    if (installedSha256 === bundledSha256) {
      return 'current'
    }
    if (metadata?.installedSha256 === installedSha256) {
      return 'outdated'
    }
    return 'modified'
  })()
  return {
    target,
    state,
    bundledPath,
    installedPath,
    bundledSha256,
    ...(installedSha256 === undefined ? {} : { installedSha256 }),
    installCommand: `tabwright skill install --target ${target}${state === 'modified' ? ' --force' : ''}`,
  }
}

export function installTabwrightAgentSkill(
  options: {
    target?: TabwrightAgentSkillTarget
    homeDir?: string
    skillRoot?: string
    bundledSkillPath?: string
    overwrite?: boolean
  } = {},
): TabwrightAgentSkillInstallResult {
  const before = getTabwrightAgentSkillStatus(options)
  if (before.state === 'modified' && !options.overwrite) {
    throw new Error(
      `Installed Tabwright skill contains unmanaged changes: ${before.installedPath}. Use --force to overwrite it.`,
    )
  }
  const installedDir = path.dirname(before.installedPath)
  fs.mkdirSync(installedDir, { recursive: true })
  if (before.state !== 'current') {
    fs.copyFileSync(before.bundledPath, before.installedPath)
  }
  writeInstallMetadata({ installedDir, installedSha256: before.bundledSha256 })
  const after = getTabwrightAgentSkillStatus(options)
  return {
    ...after,
    fileStatus: (() => {
      if (before.state === 'missing') {
        return 'created'
      }
      if (before.state === 'current') {
        return 'unchanged'
      }
      return 'updated'
    })(),
    next: ['Restart or open a new agent task so it can load the Tabwright skill.'],
  }
}

function getAgentSkillRoot(options: {
  target?: TabwrightAgentSkillTarget
  homeDir?: string
  skillRoot?: string
}): string {
  if (options.skillRoot) {
    return path.resolve(options.skillRoot)
  }
  const target = options.target || 'agents'
  const homeDir = path.resolve(options.homeDir || os.homedir())
  if (target === 'codex') {
    return path.join(process.env.CODEX_HOME?.trim() || path.join(homeDir, '.codex'), 'skills')
  }
  return path.join(homeDir, `.${target}`, 'skills')
}

function readInstallMetadata(installedDir: string): TabwrightAgentSkillMetadata | null {
  const metadataPath = path.join(installedDir, INSTALL_METADATA_FILE)
  if (!fs.existsSync(metadataPath)) {
    return null
  }
  try {
    const value: unknown = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
    if (!isRecord(value)) {
      return null
    }
    if (value.schemaVersion !== 1 || value.managedBy !== 'tabwright' || typeof value.installedSha256 !== 'string') {
      return null
    }
    return {
      schemaVersion: 1,
      managedBy: 'tabwright',
      installedSha256: value.installedSha256,
    }
  } catch {
    // Invalid metadata means the existing Skill is unrecognized and must not be auto-replaced.
    return null
  }
}

function writeInstallMetadata(options: { installedDir: string; installedSha256: string }): void {
  const metadata: TabwrightAgentSkillMetadata = {
    schemaVersion: 1,
    managedBy: 'tabwright',
    installedSha256: options.installedSha256,
  }
  fs.writeFileSync(path.join(options.installedDir, INSTALL_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`)
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
