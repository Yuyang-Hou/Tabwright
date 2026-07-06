import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { RrwebRecordingRelay, getSavedRrwebRecordingWithEvents, listSavedRrwebRecordings } from './rrweb-recording-relay.js'
import type { RrwebEvent } from './protocol.js'

let previousHome: string | undefined
let testHome: string | null = null

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

function useTempHome(): string {
  previousHome = process.env.HOME
  testHome = createTempDir('rrweb-recording-relay-home-')
  process.env.HOME = testHome
  return testHome
}

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = previousHome
  }
  previousHome = undefined

  if (testHome) {
    fs.rmSync(testHome, { recursive: true, force: true })
    testHome = null
  }
})

describe('RrwebRecordingRelay', () => {
  test('saves finalized rrweb events metadata and payload', async () => {
    useTempHome()

    const startedAt = Date.now() - 1000
    const events: RrwebEvent[] = [
      {
        type: 4,
        timestamp: startedAt + 200,
        data: {
          href: 'https://example.com/materials/new',
          width: 1280,
          height: 720,
        },
      },
    ]

    const relayRef: { current?: RrwebRecordingRelay } = {}
    const relay = new RrwebRecordingRelay(
      async ({ method }) => {
        if (method === 'startRrwebRecording') {
          return { success: true, tabId: 42, startedAt, url: 'https://example.com/materials/new' }
        }
        if (method === 'stopRrwebRecording') {
          queueMicrotask(() => {
            const currentRelay = relayRef.current
            if (!currentRelay) {
              throw new Error('Rrweb recording relay ref is not initialized')
            }
            currentRelay.handleRrwebRecordingData({
              method: 'rrwebRecordingData',
              params: {
                tabId: 42,
                events,
                final: true,
              },
            })
          })
          return { success: true, tabId: 42, duration: 1000 }
        }
        throw new Error(`Unexpected method: ${method}`)
      },
      () => {
        return true
      },
    )
    relayRef.current = relay

    const startResult = await relay.startRecording({ sessionId: 'pw-tab-rrweb' })
    expect(startResult.success).toBe(true)

    const stopResult = await relay.stopRecording({ sessionId: 'pw-tab-rrweb' })
    expect(stopResult.success).toBe(true)

    const saved = listSavedRrwebRecordings({ limit: 1 })
    expect(saved).toHaveLength(1)
    expect(saved[0].eventCount).toBe(1)
    expect(saved[0].url).toBe('https://example.com/materials/new')

    const replay = getSavedRrwebRecordingWithEvents(saved[0].id)
    expect(replay?.events).toEqual(events)
  })
})
