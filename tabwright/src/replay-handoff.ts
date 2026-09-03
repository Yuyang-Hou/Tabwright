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

export function buildReplayIndexCommand(options: { replayId: string; full?: boolean }): string {
  return ['tabwright replay index', shellQuote(options.replayId), ...(options.full ? ['--full'] : []), '--json'].join(
    ' ',
  )
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
