import { describe, expect, test } from 'vitest'
import type { ReplayAiIndex } from './replay-ai-index.js'
import { buildReplayIndexCommand, toCompactReplayAiIndex } from './replay-handoff.js'

describe('replay handoff', () => {
  test('builds compact and full replay index commands', () => {
    expect(buildReplayIndexCommand({ replayId: "replay ' one" })).toBe(
      "tabwright replay index 'replay '\\'' one' --json",
    )
    expect(buildReplayIndexCommand({ replayId: 'replay-one', full: true })).toBe(
      "tabwright replay index 'replay-one' --full --json",
    )
  })


  test('keeps actionable evidence while replacing bulky replay context with counts', () => {
    const index: ReplayAiIndex = {
      schemaVersion: 1,
      replayId: 'replay-one',
      url: 'https://example.com/form',
      generatedAt: 123,
      stats: {
        eventCount: 12,
        fullSnapshotCount: 1,
        mutationEventCount: 2,
        clickEventCount: 1,
        inputEventCount: 1,
        annotationCount: 1,
      },
      actions: [
        {
          kind: 'click',
          timestamp: 124,
          label: 'Save',
          node: {
            id: 7,
            type: 'element',
            tagName: 'button',
            label: 'Save',
            selectorHints: ['button[data-action="save"]'],
            ancestorText: [],
          },
        },
      ],
      fields: [
        {
          key: 'title',
          label: 'Title',
          selectorHints: ['input[name="title"]'],
          actionCount: 1,
          updatedAt: 125,
        },
      ],
      annotations: [
        {
          id: 'annotation-one',
          text: 'This value changes each run.',
          timestamp: 126,
          target: {
            selectorHints: ['input[name="title"]', '[data-testid="title"]'],
          },
        },
      ],
      interactiveElements: [
        {
          id: 8,
          type: 'element',
          selectorHints: ['button[data-action="save"]', 'button.primary'],
          ancestorText: ['Editor'],
        },
        {
          id: 9,
          type: 'element',
          selectorHints: [],
          ancestorText: [],
        },
      ],
      pageText: ['A very large page text block', 'Another large block'],
      warnings: ['The page changed during the replay.'],
    }

    const compact = toCompactReplayAiIndex(index)

    expect(compact).toMatchObject({
      replayId: 'replay-one',
      stats: index.stats,
      actions: index.actions,
      fields: index.fields,
      annotations: index.annotations,
      warnings: index.warnings,
      selectorHints: ['button[data-action="save"]', 'input[name="title"]', '[data-testid="title"]', 'button.primary'],
      omitted: {
        interactiveElements: 2,
        pageText: 2,
      },
    })
    expect(compact).not.toHaveProperty('interactiveElements')
    expect(compact).not.toHaveProperty('pageText')
  })
})
