import type { ReplayAiIndex } from './replay-ai-index.js'

export type CompactReplayAiIndex = Omit<ReplayAiIndex, 'interactiveElements' | 'pageText'> & {
  selectorHints: string[]
  omitted: {
    interactiveElements: number
    pageText: number
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function replayCapabilityId(replayId: string): string {
  const normalized = replayId
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const suffix = normalized.slice(-28).replace(/^-+|-+$/g, '') || 'workflow'
  return `replay-${suffix}`
}

export function buildReplayIndexCommand(options: { replayId: string; full?: boolean }): string {
  return ['tabwright replay index', shellQuote(options.replayId), ...(options.full ? ['--full'] : []), '--json'].join(
    ' ',
  )
}

export function buildReplayCreateCommand(options: {
  capabilityId: string
  title?: string
  description?: string
}): string {
  const titleArgs: string[] = options.title?.trim() ? ['--title', shellQuote(options.title)] : []
  const descriptionArgs: string[] = options.description?.trim() ? ['--description', shellQuote(options.description)] : []
  return [
    'tabwright capability create',
    shellQuote(options.capabilityId),
    '--project',
    '--runtime browser',
    '--force',
    ...titleArgs,
    ...descriptionArgs,
    '--json',
  ].join(' ')
}

export function buildReplayMakeCommand(options: { replayId: string; capabilityId?: string; goal?: string }): string {
  const capabilityId = options.capabilityId || replayCapabilityId(options.replayId)
  const goalArgs: string[] = options.goal?.trim() ? ['--goal', shellQuote(options.goal)] : []
  return [
    'tabwright replay make',
    shellQuote(options.replayId),
    shellQuote(capabilityId),
    '--force',
    ...goalArgs,
    '--json',
  ].join(' ')
}

export function buildReplayRunCommand(options: { capabilityId: string; input?: Record<string, unknown> }): string {
  const input = options.input || { value: '...' }
  return [
    'tabwright capability run',
    shellQuote(options.capabilityId),
    '--browser user',
    '--force',
    '--confirm',
    shellQuote(options.capabilityId),
    '--input-json',
    shellQuote(JSON.stringify(input)),
    '--json',
  ].join(' ')
}

export function toCompactReplayAiIndex(index: ReplayAiIndex): CompactReplayAiIndex {
  const { interactiveElements, pageText, ...core } = index
  const selectorHints: string[] = Array.from(
    new Set(
      [
        ...index.actions.flatMap((action) => {
          return action.node?.selectorHints || []
        }),
        ...index.fields.flatMap((field) => {
          return field.selectorHints
        }),
        ...index.annotations.flatMap((annotation) => {
          return annotation.target?.selectorHints || []
        }),
        ...interactiveElements.flatMap((element) => {
          return element.selectorHints
        }),
      ].filter((hint) => {
        return hint.length > 0
      }),
    ),
  )

  return {
    ...core,
    selectorHints,
    omitted: {
      interactiveElements: interactiveElements.length,
      pageText: pageText.length,
    },
  }
}
