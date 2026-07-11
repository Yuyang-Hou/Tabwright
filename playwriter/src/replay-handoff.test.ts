import { describe, expect, test } from 'vitest'
import type { ReplayAiIndex } from './replay-ai-index.js'
import {
  buildReplayCreateCommand,
  buildReplayIndexCommand,
  buildReplayMakeCommand,
  buildReplayRunCommand,
  replayCapabilityId,
  toCompactReplayAiIndex,
} from './replay-handoff.js'

describe('replay handoff', () => {
  test('builds one canonical capability id from a replay id', () => {
    expect(replayCapabilityId('2026-07-11T08-09-10-123Z-ABC12345')).toBe('replay-07-11t08-09-10-123z-abc12345')
    expect(replayCapabilityId('  Demo__Replay / With Spaces  ')).toBe('replay-demo-replay-with-spaces')
    expect(replayCapabilityId('演示')).toBe('replay-workflow')
    expect(replayCapabilityId('prefix-abcdefghijklmnopqrstuvwxyz-123456789')).toBe(
      'replay-ijklmnopqrstuvwxyz-123456789',
    )
  })

  test('builds a shell-safe make command with force and json output', () => {
    expect(
      buildReplayMakeCommand({
        replayId: "demo ' $(touch should-not-run)",
        capabilityId: "capability ' safe",
        goal: "Repeat user's $(unsafe) workflow",
      }),
    ).toBe(
      "playwriter replay make 'demo '\\'' $(touch should-not-run)' 'capability '\\'' safe' --force --goal 'Repeat user'\\''s $(unsafe) workflow' --json",
    )
  })

  test('uses the canonical id and omits goal when none is supplied', () => {
    expect(buildReplayMakeCommand({ replayId: 'Replay One' })).toBe(
      "playwriter replay make 'Replay One' 'replay-replay-one' --force --json",
    )
    expect(buildReplayMakeCommand({ replayId: 'Replay One', goal: '   ' })).toBe(
      "playwriter replay make 'Replay One' 'replay-replay-one' --force --json",
    )
  })

  test('builds compact and full replay index commands', () => {
    expect(buildReplayIndexCommand({ replayId: "replay ' one" })).toBe(
      "playwriter replay index 'replay '\\'' one' --json",
    )
    expect(buildReplayIndexCommand({ replayId: 'replay-one', full: true })).toBe(
      "playwriter replay index 'replay-one' --full --json",
    )
  })

  test('builds a shell-safe browser capability scaffold command', () => {
    expect(buildReplayCreateCommand({ capabilityId: 'replay-one' })).toBe(
      "playwriter capability create 'replay-one' --project --runtime browser --force --json",
    )
    expect(
      buildReplayCreateCommand({
        capabilityId: "replay-user's-flow",
        title: "User's workflow",
        description: 'Repeat $(unsafe) work',
      }),
    ).toBe(
      "playwriter capability create 'replay-user'\\''s-flow' --project --runtime browser --force --title 'User'\\''s workflow' --description 'Repeat $(unsafe) work' --json",
    )
  })

  test('builds a confirmed user-browser run command with the exact capability id', () => {
    expect(
      buildReplayRunCommand({
        capabilityId: "replay-user's-flow",
        input: { value: "$(echo unsafe) user's value" },
      }),
    ).toBe(
      "playwriter capability run 'replay-user'\\''s-flow' --browser user --force --confirm 'replay-user'\\''s-flow' --input-json '{\"value\":\"$(echo unsafe) user'\\''s value\"}' --json",
    )
    expect(buildReplayRunCommand({ capabilityId: 'replay-default' })).toContain('--input-json \'{"value":"..."}\'')
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
