import assert from 'node:assert/strict'
import test from 'node:test'
import { createReplayLogger } from '../src/replay-logger'

test('deduplicates missing-node warnings and isolates disposed replayers', () => {
  const logs: unknown[][] = []
  const warnings: unknown[][] = []
  let missingNodeWarnings = 0
  const controller = createReplayLogger({
    logger: {
      log: (...args: unknown[]) => {
        logs.push(args)
      },
      warn: (...args: unknown[]) => {
        warnings.push(args)
      },
    },
    onMissingNodeWarning: () => {
      missingNodeWarnings += 1
    },
  })
  const firstMutation = { source: 0, adds: [{ id: 42 }] }

  controller.logger.warn('[replayer]', "Node with id '42' not found. ", firstMutation)
  controller.logger.warn('[replayer]', "Node with id '42' not found. ", { ...firstMutation })
  controller.logger.warn('[replayer]', "Node with id '42' not found. ", { source: 1 })
  controller.logger.warn('[replayer]', 'Looks like your replayer has been destroyed.')

  assert.equal(missingNodeWarnings, 2)
  assert.deepEqual(warnings, [['[replayer]', 'Looks like your replayer has been destroyed.']])
  assert.deepEqual(logs, [])

  controller.dispose()
  controller.logger.warn('[replayer]', "Node with id '-2' not found.", { source: 0 })
  controller.logger.warn('[replayer]', 'Looks like your replayer has been destroyed.')
  controller.logger.log('[replayer]', 'late replay log')

  assert.equal(missingNodeWarnings, 2)
  assert.equal(warnings.length, 1)
  assert.deepEqual(logs, [])
})

test('passes unrelated replay warnings and logs through unchanged', () => {
  const logs: unknown[][] = []
  const warnings: unknown[][] = []
  let missingNodeWarnings = 0
  const controller = createReplayLogger({
    logger: {
      log: (...args: unknown[]) => {
        logs.push(args)
      },
      warn: (...args: unknown[]) => {
        warnings.push(args)
      },
    },
    onMissingNodeWarning: () => {
      missingNodeWarnings += 1
    },
  })
  const canvasError = new Error('canvas failed')

  controller.logger.warn('[replayer]', 'Has error on canvas update', canvasError)
  controller.logger.warn('Node with id \'42\' not found. ')
  controller.logger.log('[replayer]', "Node with id '42' not found. ")

  assert.equal(missingNodeWarnings, 0)
  assert.deepEqual(warnings, [
    ['[replayer]', 'Has error on canvas update', canvasError],
    ["Node with id '42' not found. "],
  ])
  assert.deepEqual(logs, [['[replayer]', "Node with id '42' not found. "]])
})
