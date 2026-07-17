import fs from 'node:fs'
import path from 'node:path'
import {
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

export function exportCapabilityAgentSkill(options: {
  id: string
  cwd?: string
  output?: string
}): ExportedCapabilityAgentSkill {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  const skillContent = buildStandardSkillContent(capability)
  assertSkillReadyToExport({ capability, content: skillContent })

  const cwd = options.cwd || process.cwd()
  const outputDir = path.resolve(cwd, options.output || capability.manifest.id)
  if (path.basename(outputDir) !== capability.manifest.id) {
    throw new Error(`Agent Skill directory name must match its skill name (${capability.manifest.id}): ${outputDir}`)
  }
  assertSkillExportDestination(outputDir)

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
  return {
    capabilityId: capability.manifest.id,
    dir: outputDir,
    files: files.sort(),
    next: [
      `Install or distribute ${outputDir} with an Agent Skills-compatible agent or plugin manager.`,
      'The installed skill runs its bundled runtime directly; Tabwright stores only local state.',
    ],
  }
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
    '"<absolute-skill-directory>/runtime"',
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

function assertSkillExportDestination(outputDir: string): void {
  if (!fs.existsSync(outputDir)) {
    return
  }
  const entries = fs.readdirSync(outputDir)
  if (entries.length === 0) {
    return
  }
  throw new Error(`Agent Skill export directory already exists: ${outputDir}. Manage updates with the agent's skill tooling.`)
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
  const runtimeSection: string[] = [
    '## Tabwright Runtime',
    '',
    'Resolve the absolute `runtime/` directory next to this `SKILL.md` and execute it directly with `tabwright capability run "<absolute-skill-directory>/runtime" ...`. Never copy or install the runtime into a Tabwright data directory.',
    '',
    'Use `tabwright` when available. If the command is missing or rejects a Skill runtime directory, use `npm exec --yes --package=tabwright@latest -- tabwright` in its place. Ask the user only when Node.js or npm is unavailable.',
    '',
    `Tabwright validates \`runtime/capability.json\` and \`runtime/${options.capability.manifest.entry}\` on every run and automatically refreshes declared browser authentication when needed. Do not run \`describe\`, \`trust\`, \`--force\`, or \`refresh-auth\` as setup steps. Pause only when Tabwright reports that browser login is unavailable or the selected operation requires explicit confirmation.`,
    '',
  ]
  return `${portableFrontmatter}\n---\n\n${runtimeSection.join('\n')}\n${body}\n`
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value)
}
