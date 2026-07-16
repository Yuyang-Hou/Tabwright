import fs from 'node:fs'
import path from 'node:path'
import {
  listCapabilities,
  requireCapability,
  type CapabilityManifest,
  type CapabilityOperation,
  type CapabilityRecord,
} from './capability-registry.js'

export interface ExportedCapabilityAgentSkill {
  capabilityId: string
  dir: string
  files: string[]
  next: string[]
}

export interface ExportedCapabilityAgentSkillBatch {
  dir: string
  skills: ExportedCapabilityAgentSkill[]
}

const LEGACY_SKILL_TEMPLATE_MARKER = '<!-- TABWRIGHT_AGENT_SKILL_TEMPLATE: edit before install -->'
const SKILL_EXPORT_METADATA_FILENAME = '.tabwright-skill-export.json'

export function exportCapabilityAgentSkill(options: {
  id: string
  cwd?: string
  output?: string
  overwrite?: boolean
}): ExportedCapabilityAgentSkill {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  const sourceFiles = getLegacyAgentSkillFiles(capability)
  const legacySkillFile = sourceFiles.find((file) => {
    return file.relativePath === 'SKILL.md'
  })
  const legacySkillContent = legacySkillFile ? fs.readFileSync(legacySkillFile.path, 'utf-8') : ''
  const skillContent =
    legacySkillContent && !legacySkillContent.includes(LEGACY_SKILL_TEMPLATE_MARKER)
      ? legacySkillContent
      : buildStandardSkillContent(capability)
  assertSkillReadyToExport({ capability, content: skillContent })

  const cwd = options.cwd || process.cwd()
  const outputDir = path.resolve(cwd, options.output || capability.manifest.id)
  if (path.basename(outputDir) !== capability.manifest.id) {
    throw new Error(`Agent Skill directory name must match its skill name (${capability.manifest.id}): ${outputDir}`)
  }
  assertSkillExportDestination({ outputDir, capabilityId: capability.manifest.id, overwrite: options.overwrite })

  const runtimeManifest = buildRuntimeOnlyManifest(capability.manifest)
  const exportedFiles: Array<{ relativePath: string; content: string | Buffer }> = [
    {
      relativePath: 'SKILL.md',
      content: buildPortableSkillContent({ capability, content: skillContent }),
    },
    {
      relativePath: 'capability.json',
      content: `${JSON.stringify(runtimeManifest, null, 2)}\n`,
    },
    {
      relativePath: capability.manifest.entry,
      content: fs.readFileSync(capability.scriptPath),
    },
  ]
  exportedFiles.push({
    relativePath: 'agents/openai.yaml',
    content: buildOpenAiAgentMetadata(capability),
  })

  fs.mkdirSync(outputDir, { recursive: true })
  const files = exportedFiles.map((file) => {
    const relativePath =
      file.relativePath === 'SKILL.md' || file.relativePath.startsWith('agents/')
        ? file.relativePath
        : path.posix.join('runtime', file.relativePath)
    const destination = resolveExportDestination({ outputDir, relativePath })
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, file.content)
    return relativePath
  })
  const metadata = {
    schemaVersion: 1,
    capabilityId: capability.manifest.id,
    files,
  }
  fs.writeFileSync(path.join(outputDir, SKILL_EXPORT_METADATA_FILENAME), `${JSON.stringify(metadata, null, 2)}\n`)

  return {
    capabilityId: capability.manifest.id,
    dir: outputDir,
    files: [...files, SKILL_EXPORT_METADATA_FILENAME].sort(),
    next: [
      `Install or distribute ${outputDir} with an Agent Skills-compatible agent or plugin manager.`,
      'The installed skill uses Tabwright only for runtime installation and execution.',
    ],
  }
}

export function exportAllCapabilityAgentSkills(options: {
  cwd?: string
  output?: string
  overwrite?: boolean
}): ExportedCapabilityAgentSkillBatch {
  const cwd = options.cwd || process.cwd()
  const outputDir = path.resolve(cwd, options.output || 'skills')
  const capabilities = listCapabilities({ cwd }).filter((capability, index, all) => {
    return (
      all.findIndex((candidate) => {
        return candidate.manifest.id === capability.manifest.id
      }) === index
    )
  })
  const skills = capabilities.map((capability) => {
    return exportCapabilityAgentSkill({
      id: capability.manifest.id,
      cwd,
      output: path.join(outputDir, capability.manifest.id),
      overwrite: options.overwrite,
    })
  })
  return { dir: outputDir, skills }
}

function getLegacyAgentSkillFiles(capability: CapabilityRecord): Array<{ relativePath: string; path: string }> {
  const dir = path.join(capability.dir, 'agent-skills', 'codex')
  const candidates: Array<{ relativePath: string; path: string }> = [
    { relativePath: 'SKILL.md', path: path.join(dir, 'SKILL.md') },
  ]
  return candidates.filter((file) => {
    return fs.existsSync(file.path)
  })
}

function buildRuntimeOnlyManifest(manifest: CapabilityManifest): CapabilityManifest {
  const operations: Record<string, CapabilityOperation> = Object.fromEntries(
    Object.entries(manifest.operations).map(([id, operation]) => {
      return [
        id,
        {
          ...operation,
          match: [],
          routingHint: 'search-first' as const,
        },
      ]
    }),
  )
  return {
    ...manifest,
    description: '',
    whenToUse: [],
    whenNotToUse: [],
    tags: [],
    match: [],
    routingHint: 'search-first',
    operations,
    status: 'draft',
  }
}

function buildStandardSkillContent(capability: CapabilityRecord): string {
  const description = buildSkillDescription(capability)
  const whenNotToUse =
    capability.manifest.whenNotToUse.length > 0
      ? capability.manifest.whenNotToUse
      : ['Do not use this skill when the requested action is outside the bundled runtime contract.']
  const operations = Object.keys(capability.manifest.operations)
  const requiresConfirmation =
    operations.length > 0
      ? Object.values(capability.manifest.operations).some((operation) => {
          return operation.requiresConfirmation
        })
      : capability.manifest.requiresConfirmation
  const confirmationToken = operations.length > 0 ? '<confirmation-token-for-selected-action>' : capability.manifest.id
  const runCommand = [
    'tabwright capability run',
    capability.manifest.id,
    capability.manifest.runtime === 'browser' ? '--browser user' : '',
    "--input-json '<json-input>'",
    requiresConfirmation ? `--confirm ${confirmationToken}` : '',
    '--json',
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
    '## Scope Limits',
    '',
    ...whenNotToUse.map((item) => {
      return `- ${item}`
    }),
    '',
    '## Workflow',
    '',
    ...(operations.length > 0
      ? [`1. Select one runtime action and include it as \`input.action\`: ${operations.join(', ')}.`]
      : ['1. Build input that matches the bundled runtime input schema.']),
    requiresConfirmation
      ? '2. For a confirmation-required action, stop and obtain explicit user approval for the concrete input and side effect. Use the exact confirmation token only after approval.'
      : '2. Confirm the requested input is within the skill scope.',
    '3. Run the capability:',
    '',
    '```bash',
    runCommand,
    '```',
    '',
    '4. Return a concise result. Point to runtime artifacts instead of pasting large raw output.',
    '',
  ].join('\n')
}

function buildSkillDescription(capability: CapabilityRecord): string {
  const triggers = capability.manifest.whenToUse.join('; ')
  const base = capability.manifest.description || capability.manifest.title
  return triggers ? `${base}. Use when: ${triggers}` : `${base}. Use for tasks that match this capability.`
}

function buildOpenAiAgentMetadata(capability: CapabilityRecord): string {
  return [
    'interface:',
    `  display_name: ${quoteYamlString(capability.manifest.title)}`,
    `  short_description: ${quoteYamlString(buildOpenAiShortDescription(capability))}`,
    `  default_prompt: ${quoteYamlString(`Use $${capability.manifest.id} to complete the matching task with its bundled Tabwright runtime.`)}`,
    '',
  ].join('\n')
}

function buildOpenAiShortDescription(capability: CapabilityRecord): string {
  const description = capability.manifest.description || `Run ${capability.manifest.title} workflows safely`
  if (description.length >= 25 && description.length <= 64) {
    return description
  }
  const fallback = `${capability.manifest.title} capability using the Tabwright runtime`
  const expanded = fallback.length < 25 ? `${fallback} safely` : fallback
  return expanded.length <= 64 ? expanded : `${expanded.slice(0, 63).trimEnd()}…`
}

function assertSkillReadyToExport(options: { capability: CapabilityRecord; content: string }): void {
  if (!options.content.startsWith('---\n')) {
    throw new Error(`Agent skill must start with YAML frontmatter: ${options.capability.manifest.id}`)
  }
  if (!options.content.includes(`name: ${options.capability.manifest.id}`)) {
    throw new Error(`Agent skill frontmatter must include name: ${options.capability.manifest.id}`)
  }
}

function assertSkillExportDestination(options: {
  outputDir: string
  capabilityId: string
  overwrite?: boolean
}): void {
  if (!fs.existsSync(options.outputDir)) {
    return
  }
  const entries = fs.readdirSync(options.outputDir)
  if (entries.length === 0) {
    return
  }
  if (!options.overwrite) {
    throw new Error(`Agent Skill export directory already exists: ${options.outputDir}. Use --force to overwrite it.`)
  }
  const metadataPath = path.join(options.outputDir, SKILL_EXPORT_METADATA_FILENAME)
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Refusing to overwrite a directory that was not created by Tabwright: ${options.outputDir}`)
  }
  const metadata: unknown = (() => {
    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
    } catch (error) {
      throw new Error(`Invalid Tabwright Agent Skill export metadata: ${metadataPath}`, { cause: error })
    }
  })()
  const capabilityId = typeof metadata === 'object' && metadata !== null ? Reflect.get(metadata, 'capabilityId') : null
  if (capabilityId !== options.capabilityId) {
    throw new Error(`Agent Skill export metadata does not match ${options.capabilityId}: ${metadataPath}`)
  }
}

function resolveExportDestination(options: { outputDir: string; relativePath: string }): string {
  const root = path.resolve(options.outputDir)
  const destination = path.resolve(root, ...options.relativePath.split('/'))
  if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Agent Skill export path escapes its destination: ${options.relativePath}`)
  }
  return destination
}

function buildPortableSkillContent(options: { capability: CapabilityRecord; content: string }): string {
  const frontmatterEnd = options.content.indexOf('\n---\n', 4)
  if (frontmatterEnd === -1) {
    throw new Error(`Agent skill has invalid YAML frontmatter: ${options.capability.manifest.id}`)
  }
  const frontmatter = options.content.slice(0, frontmatterEnd)
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1] || quoteYamlString(buildSkillDescription(options.capability))
  const portableFrontmatter = ['---', `name: ${options.capability.manifest.id}`, `description: ${description}`].join('\n')
  const body = options.content.slice(frontmatterEnd + '\n---\n'.length).trim()
  const authRefreshSteps: string[] =
    options.capability.manifest.auth.refresh === 'from-browser'
      ? [
          `5. If authentication is missing or expired, obtain approval and run \`tabwright capability refresh-auth ${options.capability.manifest.id} --browser user --json\`.`,
          '',
        ]
      : []
  const runtimeSection: string[] = [
    '## Tabwright Runtime Dependency',
    '',
    'The agent skill manager owns this skill. Tabwright is only the deterministic runtime for execution, authentication, confirmation gates, and local run history.',
    '',
    'Bundled paths relative to this `SKILL.md`:',
    '',
    '- Runtime contract: `runtime/capability.json`',
    `- Entry script: \`runtime/${options.capability.manifest.entry}\``,
    '',
    'Never resolve these paths from the process working directory. Resolve the absolute skill directory from this `SKILL.md` first.',
    '',
    '1. Run `tabwright --version` to check the runtime dependency.',
    '2. If `tabwright` is unavailable, use `npm exec --yes --package=tabwright@latest -- tabwright` in place of `tabwright` below. If Node.js or npm is unavailable, pause and ask the user to install Node.js 18 or newer.',
    `3. Check whether the runtime is installed with \`tabwright capability describe ${options.capability.manifest.id} --json\`.`,
    '4. If missing, run `tabwright capability install "<absolute-skill-directory>/runtime" --json`. Never add `--force` automatically. The runtime installs as draft: inspect the bundled contract and entry script, validate with `capability run --force`, and trust it only after the user accepts it.',
    ...authRefreshSteps,
    '',
  ]
  return `${portableFrontmatter}\n---\n\n${runtimeSection.join('\n')}\n${body}\n`
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value)
}
