import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { requireCapability, type CapabilityRecord } from './capability-registry.js'

export type AgentSkillTarget = 'codex'
export type AgentSkillFileStatus = 'created' | 'updated' | 'unchanged'

export interface AgentSkillFileResult {
  relativePath: string
  path: string
  status: AgentSkillFileStatus
}

export interface CapabilityAgentSkillResult {
  target: AgentSkillTarget
  capabilityId: string
  dir: string
  files: AgentSkillFileResult[]
  next: string[]
}

export interface CapabilityAgentSkillShowResult {
  target: AgentSkillTarget
  capabilityId: string
  dir: string
  files: Array<{
    relativePath: string
    path: string
    content: string
  }>
}

export interface CapabilityAgentSkillStatus {
  target: AgentSkillTarget
  draftExists: boolean
  draftPath: string
  installedExists: boolean
  installedPath: string
  initCommand: string
  showCommand: string
  installCommand: string
}

const SKILL_TEMPLATE_MARKER = '<!-- PLAYWRITER_AGENT_SKILL_TEMPLATE: edit before install -->'

export function initCapabilityAgentSkill(options: {
  id: string
  cwd?: string
  target?: AgentSkillTarget
  overwrite?: boolean
}): CapabilityAgentSkillResult {
  const target = options.target || 'codex'
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  const dir = getCapabilityAgentSkillDir({ capability, target })
  const files = [
    writeSkillFile({
      filePath: path.join(dir, 'SKILL.md'),
      relativePath: 'SKILL.md',
      content: buildCodexSkillTemplate(capability),
      overwrite: options.overwrite,
    }),
    writeSkillFile({
      filePath: path.join(dir, 'agents', 'openai.yaml'),
      relativePath: 'agents/openai.yaml',
      content: buildOpenAiAgentTemplate(capability),
      overwrite: options.overwrite,
    }),
  ]
  return {
    target,
    capabilityId: capability.manifest.id,
    dir,
    files,
    next: [
      `Edit ${path.join(dir, 'SKILL.md')} with the real usage workflow and display rules.`,
      `playwriter capability skill install ${capability.manifest.id}`,
    ],
  }
}

export function installCapabilityAgentSkill(options: {
  id: string
  cwd?: string
  target?: AgentSkillTarget
  overwrite?: boolean
  codexHome?: string
  capability?: CapabilityRecord
}): CapabilityAgentSkillResult {
  const target = options.target || 'codex'
  const capability = options.capability || requireCapability({ id: options.id, cwd: options.cwd })
  const dir = getCapabilityAgentSkillDir({ capability, target })
  const skillPath = path.join(dir, 'SKILL.md')
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Agent skill draft not found for ${capability.manifest.id}. Run: playwriter capability skill init ${capability.manifest.id}`)
  }
  const skillContent = fs.readFileSync(skillPath, 'utf-8')
  assertSkillReadyToInstall({ capability, content: skillContent, filePath: skillPath })
  const sourceFiles = getExistingAgentSkillFiles(dir)
  const codexSkillDir = path.join(getCodexHome(options.codexHome), 'skills', capability.manifest.id)
  const files = sourceFiles.map((file) => {
    return writeSkillFile({
      filePath: path.join(codexSkillDir, ...file.relativePath.split('/')),
      relativePath: file.relativePath,
      content: fs.readFileSync(file.path, 'utf-8'),
      overwrite: options.overwrite,
    })
  })
  return {
    target,
    capabilityId: capability.manifest.id,
    dir: codexSkillDir,
    files,
    next: [`Restart or open a new agent thread so it can load the ${capability.manifest.id} skill.`],
  }
}

export function showCapabilityAgentSkill(options: {
  id: string
  cwd?: string
  target?: AgentSkillTarget
}): CapabilityAgentSkillShowResult {
  const target = options.target || 'codex'
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  const dir = getCapabilityAgentSkillDir({ capability, target })
  const files = getExistingAgentSkillFiles(dir).map((file) => {
    return {
      relativePath: file.relativePath,
      path: file.path,
      content: fs.readFileSync(file.path, 'utf-8'),
    }
  })
  if (!files.some((file) => {
    return file.relativePath === 'SKILL.md'
  })) {
    throw new Error(`Agent skill draft not found for ${capability.manifest.id}. Run: playwriter capability skill init ${capability.manifest.id}`)
  }
  return {
    target,
    capabilityId: capability.manifest.id,
    dir,
    files,
  }
}

export function getCapabilityAgentSkillStatus(options: {
  capability: CapabilityRecord
  target?: AgentSkillTarget
  codexHome?: string
}): CapabilityAgentSkillStatus {
  const target = options.target || 'codex'
  const draftDir = getCapabilityAgentSkillDir({ capability: options.capability, target })
  const installedDir = path.join(getCodexHome(options.codexHome), 'skills', options.capability.manifest.id)
  return {
    target,
    draftExists: fs.existsSync(path.join(draftDir, 'SKILL.md')),
    draftPath: path.join(draftDir, 'SKILL.md'),
    installedExists: fs.existsSync(path.join(installedDir, 'SKILL.md')),
    installedPath: path.join(installedDir, 'SKILL.md'),
    initCommand: `playwriter capability skill init ${options.capability.manifest.id}`,
    showCommand: `playwriter capability skill show ${options.capability.manifest.id}`,
    installCommand: `playwriter capability skill install ${options.capability.manifest.id}`,
  }
}

function getCapabilityAgentSkillDir(options: { capability: CapabilityRecord; target: AgentSkillTarget }): string {
  return path.join(options.capability.dir, 'agent-skills', options.target)
}

function getCodexHome(codexHome?: string): string {
  return codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
}

function getExistingAgentSkillFiles(dir: string): Array<{ relativePath: string; path: string }> {
  const skillPath = path.join(dir, 'SKILL.md')
  const openAiPath = path.join(dir, 'agents', 'openai.yaml')
  const files: Array<{ relativePath: string; path: string }> = []
  if (fs.existsSync(skillPath)) {
    files.push({ relativePath: 'SKILL.md', path: skillPath })
  }
  if (fs.existsSync(openAiPath)) {
    files.push({ relativePath: 'agents/openai.yaml', path: openAiPath })
  }
  return files
}

function writeSkillFile(options: {
  filePath: string
  relativePath: string
  content: string
  overwrite?: boolean
}): AgentSkillFileResult {
  if (fs.existsSync(options.filePath)) {
    const existing = fs.readFileSync(options.filePath, 'utf-8')
    if (existing === options.content) {
      return { relativePath: options.relativePath, path: options.filePath, status: 'unchanged' }
    }
    if (!options.overwrite) {
      throw new Error(`Agent skill file already exists with different content: ${options.filePath}. Use --force to overwrite.`)
    }
  }
  fs.mkdirSync(path.dirname(options.filePath), { recursive: true })
  const status = fs.existsSync(options.filePath) ? 'updated' : 'created'
  fs.writeFileSync(options.filePath, options.content)
  return { relativePath: options.relativePath, path: options.filePath, status }
}

function assertSkillReadyToInstall(options: {
  capability: CapabilityRecord
  content: string
  filePath: string
}): void {
  if (options.content.includes(SKILL_TEMPLATE_MARKER)) {
    throw new Error(`Agent skill still contains the scaffold marker: ${options.filePath}. Edit the skill content before installing it.`)
  }
  if (!options.content.includes(`name: ${options.capability.manifest.id}`)) {
    throw new Error(`Agent skill frontmatter must include name: ${options.capability.manifest.id}`)
  }
}

function buildCodexSkillTemplate(capability: CapabilityRecord): string {
  const operationIds = Object.keys(capability.manifest.operations)
  const hasOperations = operationIds.length > 0
  const requiresConfirmation = hasOperations
    ? Object.values(capability.manifest.operations).some((operation) => {
        return operation.requiresConfirmation
      })
    : capability.manifest.requiresConfirmation
  const description = [
    `TODO: Explain when agents should use the ${capability.manifest.id} Playwriter capability.`,
    'Mention concrete user phrasing, exact-match signals, and when not to use it.',
  ].join(' ')
  const routeCommand = `playwriter capability route "<user-task-or-url>" --json`
  const runCommand = [
    'playwriter capability run',
    capability.manifest.id,
    capability.manifest.runtime === 'browser' ? '--browser user' : '',
    "--input-json '<json-input>'",
    '--json',
    capability.manifest.status === 'trusted' ? '' : '--force',
    requiresConfirmation
      ? hasOperations
        ? '--confirm <confirmation-token>'
        : `--confirm ${capability.manifest.id}`
      : '',
  ]
    .filter((part) => {
      return part.length > 0
    })
    .join(' ')
  return [
    '---',
    `name: ${capability.manifest.id}`,
    `description: ${quoteYamlString(description)}`,
    '---',
    '',
    SKILL_TEMPLATE_MARKER,
    '',
    '## When To Use',
    '',
    '- TODO: Describe the concrete user intent, URL pattern, page state, or data shape that should trigger this capability.',
    '- TODO: State when this capability should not be used.',
    '',
    '## Workflow',
    '',
    '1. Use route when exact-match metadata may apply:',
    '',
    '```bash',
    routeCommand,
    '```',
    '',
    requiresConfirmation
      ? hasOperations
        ? `2. Select one operation (${operationIds.join(', ')}). Read operations may run directly; for a confirmation-required operation, stop for approval and use its exact confirmationToken:`
        : '2. Stop and obtain explicit user approval for the concrete input and side effect. Only then run with structured input:'
      : '2. Run the returned `shellCommand` exactly, or run the capability with structured input:',
    '',
    '```bash',
    runCommand,
    '```',
    '',
    '3. If the capability requires browser/session/auth state, describe the required refresh or browser command.',
    '',
    '## Output And Display',
    '',
    '- TODO: Define the default answer shape.',
    '- TODO: Say when to show a short summary versus when to point to artifacts.',
    '- TODO: Say whether large outputs should be saved, filtered, or exported only on request.',
    '',
  ].join('\n')
}

function buildOpenAiAgentTemplate(capability: CapabilityRecord): string {
  return [
    'interface:',
    `  display_name: ${quoteYamlString(capability.manifest.title)}`,
    `  short_description: ${quoteYamlString(capability.manifest.description || capability.manifest.title)}`,
    `  default_prompt: ${quoteYamlString(`Use ${capability.manifest.id} for <task>`)}`,
    '',
  ].join('\n')
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value)
}
