import fs from 'node:fs'
import path from 'node:path'
import {
  getCapabilityExecutionConfig,
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
  const useChinese = usesChineseAgentCopy(capability)
  const description = buildSkillDescription(capability)
  const execution = getCapabilityExecutionConfig(capability)
  const whenNotToUse =
    capability.manifest.whenNotToUse.length > 0
      ? capability.manifest.whenNotToUse
      : [
          useChinese
            ? '请求操作超出内置运行契约时，不要使用本技能。'
            : 'Do not use this skill when the requested action is outside the bundled runtime contract.',
        ]
  const operations = Object.keys(capability.manifest.operations)
  const requiresConfirmation =
    operations.length > 0
      ? Object.values(capability.manifest.operations).some((operation) => {
          return operation.requiresConfirmation
        })
      : capability.manifest.requiresConfirmation
  const confirmationToken =
    operations.length > 0
      ? useChinese
        ? '<所选操作的确认令牌>'
        : '<confirmation-token-for-selected-action>'
      : capability.manifest.id
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
    useChinese ? '## 适用边界' : '## Scope Limits',
    '',
    ...whenNotToUse.map((item) => {
      return `- ${item}`
    }),
    '',
    useChinese ? '## 操作流程' : '## Workflow',
    '',
    ...(operations.length > 0
      ? [
          useChinese
            ? `1. 选择一个运行操作并将其填入 \`input.action\`：${operations.join(', ')}。`
            : `1. Select one runtime action and include it as \`input.action\`: ${operations.join(', ')}.`,
        ]
      : [
          useChinese
            ? '1. 按内置运行时的输入 Schema 组装参数。'
            : '1. Build input that matches the bundled runtime input schema.',
        ]),
    requiresConfirmation
      ? useChinese
        ? '2. 如操作需要确认，先暂停并展示具体输入及影响，获得用户明确同意后才能使用对应的确认令牌。'
        : '2. For a confirmation-required action, stop and obtain explicit user approval for the concrete input and side effect. Use the exact confirmation token only after approval.'
      : useChinese
        ? '2. 确认请求参数在本技能的适用范围内。'
        : '2. Confirm the requested input is within the skill scope.',
    ...(execution.humanAssistance === 'none'
      ? []
      : [
          execution.humanAssistance === 'required'
            ? useChinese
              ? '3. 此流程需要用户在浏览器中参与。请暂停，请用户完成指定检查点后再继续。'
              : '3. This workflow requires a person in the user browser. Pause and ask the user to complete the indicated checkpoint before continuing.'
            : useChinese
              ? '3. 如运行时返回 `status: "needs_human"`，请暂停，请用户在已打开的浏览器中完成验证，然后使用相同的已确认输入重新执行。'
              : '3. If the runtime returns `status: "needs_human"`, pause. Ask the user to complete the verification in the open browser, then rerun the same approved input.',
        ]),
    `${execution.humanAssistance === 'none' ? '3' : '4'}. ${useChinese ? '执行能力：' : 'Run the capability:'}`,
    '',
    '```bash',
    runCommand,
    '```',
    '',
    `${execution.humanAssistance === 'none' ? '4' : '5'}. ${
      useChinese
        ? '简洁返回结果。如原始输出较大，指向运行产物，不要直接粘贴全部内容。'
        : 'Return a concise result. Point to runtime artifacts instead of pasting large raw output.'
    }`,
    '',
  ].join('\n')
}

function buildSkillDescription(capability: CapabilityRecord): string {
  const useChinese = usesChineseAgentCopy(capability)
  const triggers = capability.manifest.whenToUse.join(useChinese ? '；' : '; ')
  const base = capability.manifest.description || capability.manifest.title
  if (useChinese) {
    return triggers ? `${base}。适用于：${triggers}` : `${base}。用于与此能力匹配的任务。`
  }
  return triggers ? `${base}. Use when: ${triggers}` : `${base}. Use for tasks that match this capability.`
}

function buildOpenAiAgentMetadata(capability: CapabilityRecord): string {
  const defaultPrompt = usesChineseAgentCopy(capability)
    ? `使用 $${capability.manifest.id} 完成匹配任务，并通过其内置的 Tabwright 运行环境执行。`
    : `Use $${capability.manifest.id} to complete the matching task with its bundled Tabwright runtime.`
  return [
    'interface:',
    `  display_name: ${quoteYamlString(capability.manifest.title)}`,
    `  short_description: ${quoteYamlString(buildOpenAiShortDescription(capability))}`,
    `  default_prompt: ${quoteYamlString(defaultPrompt)}`,
    '',
  ].join('\n')
}

function buildOpenAiShortDescription(capability: CapabilityRecord): string {
  const useChinese = usesChineseAgentCopy(capability)
  const description =
    capability.manifest.description ||
    (useChinese
      ? `使用 ${capability.manifest.title} 安全执行匹配工作流`
      : `Run ${capability.manifest.title} workflows safely`)
  if (description.length >= 25 && description.length <= 64) {
    return description
  }
  const fallback = useChinese
    ? `${capability.manifest.title}，通过 Tabwright 安全执行对应工作流`
    : `${capability.manifest.title} capability using the Tabwright runtime`
  const expanded = fallback.length < 25 ? `${fallback}${useChinese ? '并返回结果' : ' safely'}` : fallback
  return expanded.length <= 64 ? expanded : `${expanded.slice(0, 63).trimEnd()}…`
}

function usesChineseAgentCopy(capability: CapabilityRecord): boolean {
  return /[\u3400-\u9fff]/u.test(
    [capability.manifest.title, capability.manifest.description, ...capability.manifest.whenToUse].join(' '),
  )
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
  const runtimeSection: string[] = usesChineseAgentCopy(options.capability)
    ? [
        '## Tabwright 运行环境',
        '',
        '将本 `SKILL.md` 同级的 `runtime/` 目录解析为绝对路径，并通过 `tabwright capability run "<技能绝对路径>/runtime" ...` 直接执行。不要将运行目录复制或安装到 Tabwright 数据目录。',
        '',
        '优先使用 `tabwright`。如命令不存在或不支持技能运行目录，改用 `npm exec --yes --package=tabwright@latest -- tabwright`。仅当 Node.js 或 npm 不可用时才询问用户。',
        '',
        `Tabwright 每次执行都会校验 \`runtime/capability.json\` 和 \`runtime/${options.capability.manifest.entry}\`，并按需自动刷新已声明的浏览器认证。不要将 \`describe\`、\`trust\`、\`--force\` 或 \`refresh-auth\` 作为初始化步骤。仅当 Tabwright 报告浏览器登录不可用，或所选操作需要明确确认时才暂停。`,
        '',
      ]
    : [
        '## Tabwright Runtime',
        '',
        'Resolve the absolute `runtime/` directory next to this `SKILL.md` and execute it directly with `tabwright capability run "<absolute-skill-directory>/runtime" ...`. Never copy or install the runtime into a Tabwright data directory.',
        '',
        'Use `tabwright` when available. If the command is missing or rejects a Skill runtime directory, use `npm exec --yes --package=tabwright@latest -- tabwright` in its place. Ask the user only when Node.js or npm is unavailable.',
        '',
        `Tabwright validates \`runtime/capability.json\` and \`runtime/${options.capability.manifest.entry}\` on every run and automatically refreshes declared browser authentication when needed. Do not run \`describe\`, \`trust\`, \`--force\`, or \`refresh-auth\` as setup steps. Pause only when Tabwright reports that browser login is unavailable or the selected operation requires explicit confirmation.`,
        '',
      ]
  return `${portableFrontmatter}\n---\n\n${body}\n\n${runtimeSection.join('\n')}\n`
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value)
}
