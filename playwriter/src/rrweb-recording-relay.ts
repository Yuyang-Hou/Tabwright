import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import pc from 'picocolors'
import type {
  CancelRrwebRecordingParams,
  CancelRrwebRecordingResult,
  IsRrwebRecordingParams,
  IsRrwebRecordingResult,
  ExtensionStopRrwebRecordingResult,
  RrwebEvent,
  RrwebRecordingCancelledMessage,
  RrwebRecordingDataMessage,
  StartRrwebRecordingBody,
  StartRrwebRecordingParams,
  StartRrwebRecordingResult,
  StopRrwebRecordingParams,
  StopRrwebRecordingResult,
} from './protocol.js'

export interface ActiveRrwebRecording {
  id: string
  tabId: number
  sessionId?: string
  outputPath: string
  events: RrwebEvent[]
  startedAt: number
  url?: string
  resolveStop?: (result: StopRrwebRecordingResult) => void
}

export interface SavedRrwebRecording {
  id: string
  path: string
  startedAt: number
  savedAt: number
  duration: number
  size: number
  eventCount: number
  tabId: number
  sessionId?: string
  url?: string
}

export interface SavedRrwebRecordingWithEvents {
  recording: SavedRrwebRecording
  events: RrwebEvent[]
}

function getRrwebRecordingsDir(): string {
  return path.join(os.homedir(), '.playwriter', 'rrweb-recordings')
}

function getRrwebRecordingsIndexPath(): string {
  return path.join(getRrwebRecordingsDir(), 'index.json')
}

function createRrwebRecordingId(): string {
  const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${safeTimestamp}-${crypto.randomUUID().slice(0, 8)}`
}

function createDefaultRrwebRecordingOutputPath(recordingId: string): string {
  return path.join(getRrwebRecordingsDir(), `${recordingId}.json`)
}

export function isRrwebEvent(value: unknown): value is RrwebEvent {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringOrUndefined(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isSavedRrwebRecording(value: unknown): value is SavedRrwebRecording {
  if (!value || typeof value !== 'object') return false
  const candidate = value as {
    id?: unknown
    path?: unknown
    startedAt?: unknown
    savedAt?: unknown
    duration?: unknown
    size?: unknown
    eventCount?: unknown
    tabId?: unknown
    sessionId?: unknown
    url?: unknown
  }
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.startedAt === 'number' &&
    typeof candidate.savedAt === 'number' &&
    typeof candidate.duration === 'number' &&
    typeof candidate.size === 'number' &&
    typeof candidate.eventCount === 'number' &&
    typeof candidate.tabId === 'number' &&
    isStringOrUndefined(candidate.sessionId) &&
    isStringOrUndefined(candidate.url)
  )
}

function readSavedRrwebRecordings(): SavedRrwebRecording[] {
  const indexPath = getRrwebRecordingsIndexPath()
  if (!fs.existsSync(indexPath)) return []

  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedRrwebRecording)
  } catch {
    return []
  }
}

function writeSavedRrwebRecordings(recordings: SavedRrwebRecording[]): void {
  const dir = getRrwebRecordingsDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(getRrwebRecordingsIndexPath(), `${JSON.stringify(recordings, null, 2)}\n`)
}

function saveRrwebRecordingMetadata(recording: ActiveRrwebRecording, options: { duration: number; size: number }): SavedRrwebRecording {
  const savedRecording: SavedRrwebRecording = {
    id: recording.id,
    path: recording.outputPath,
    startedAt: recording.startedAt,
    savedAt: Date.now(),
    duration: options.duration,
    size: options.size,
    eventCount: recording.events.length,
    tabId: recording.tabId,
    sessionId: recording.sessionId,
    url: recording.url,
  }
  const recordings = readSavedRrwebRecordings().filter((item) => {
    return item.id !== savedRecording.id
  })
  recordings.unshift(savedRecording)
  writeSavedRrwebRecordings(recordings.slice(0, 200))
  return savedRecording
}

export function listSavedRrwebRecordings(options: { limit?: number } = {}): SavedRrwebRecording[] {
  const limit = options.limit ?? 50
  return readSavedRrwebRecordings()
    .filter((recording) => {
      return fs.existsSync(recording.path)
    })
    .sort((a, b) => {
      return b.savedAt - a.savedAt
    })
    .slice(0, limit)
}

export function getSavedRrwebRecording(recordingId: string): SavedRrwebRecording | null {
  return (
    readSavedRrwebRecordings().find((recording) => {
      return recording.id === recordingId && fs.existsSync(recording.path)
    }) || null
  )
}

export function getSavedRrwebRecordingWithEvents(recordingId: string): SavedRrwebRecordingWithEvents | null {
  const recording = getSavedRrwebRecording(recordingId)
  if (!recording) return null

  try {
    const parsed = JSON.parse(fs.readFileSync(recording.path, 'utf-8')) as unknown
    if (!Array.isArray(parsed)) return { recording, events: [] }
    return {
      recording,
      events: parsed.filter(isRrwebEvent),
    }
  } catch {
    return { recording, events: [] }
  }
}

export class RrwebRecordingRelay {
  private activeRecordings = new Map<number, ActiveRrwebRecording>()
  private sendToExtension: (params: { method: string; params?: unknown; timeout?: number }) => Promise<unknown>
  private isExtensionConnected: () => boolean
  private logger?: { log(...args: unknown[]): void; error(...args: unknown[]): void }

  constructor(
    sendToExtension: (params: { method: string; params?: unknown; timeout?: number }) => Promise<unknown>,
    isExtensionConnected: () => boolean,
    logger?: { log(...args: unknown[]): void; error(...args: unknown[]): void },
  ) {
    this.sendToExtension = sendToExtension
    this.isExtensionConnected = isExtensionConnected
    this.logger = logger
  }

  handleRrwebRecordingData(message: RrwebRecordingDataMessage): void {
    const { tabId, events, final } = message.params
    const recording = this.activeRecordings.get(tabId)
    if (!recording) {
      this.logger?.log(pc.yellow(`Received rrweb events for unknown tab ${tabId}, ignoring`))
      return
    }

    recording.events.push(...events.filter(isRrwebEvent))

    if (!final) {
      return
    }

    try {
      const dir = path.dirname(recording.outputPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      const payload = `${JSON.stringify(recording.events)}\n`
      fs.writeFileSync(recording.outputPath, payload)

      const size = Buffer.byteLength(payload)
      const duration = Date.now() - recording.startedAt
      const savedRecording = saveRrwebRecordingMetadata(recording, { duration, size })
      this.logger?.log(
        pc.green(
          `rrweb recording saved: ${recording.outputPath} (${size} bytes, ${duration}ms, ${recording.events.length} events)`,
        ),
      )

      if (recording.resolveStop) {
        recording.resolveStop({
          success: true,
          id: savedRecording.id,
          tabId,
          duration,
          path: recording.outputPath,
          size,
          eventCount: recording.events.length,
        })
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger?.error('Failed to write rrweb recording:', error)
      if (recording.resolveStop) {
        recording.resolveStop({ success: false, error: errorMessage })
      }
    }

    this.activeRecordings.delete(tabId)
  }

  handleRrwebRecordingCancelled(message: RrwebRecordingCancelledMessage): void {
    const { tabId } = message.params
    const recording = this.activeRecordings.get(tabId)
    if (!recording) return

    this.logger?.log(pc.yellow(`rrweb recording cancelled for tab ${tabId}`))
    if (recording.resolveStop) {
      recording.resolveStop({ success: false, error: 'rrweb recording was cancelled' })
    }
    this.activeRecordings.delete(tabId)
  }

  async startRecording(params: StartRrwebRecordingParams & { outputPath?: string }): Promise<StartRrwebRecordingResult> {
    const id = createRrwebRecordingId()
    const { outputPath: requestedOutputPath, ...recordingParams } = params
    const outputPath = requestedOutputPath || createDefaultRrwebRecordingOutputPath(id)

    if (!this.isExtensionConnected()) {
      return { success: false, error: 'Extension not connected' }
    }

    try {
      const result = (await this.sendToExtension({
        method: 'startRrwebRecording',
        params: recordingParams,
        timeout: 10000,
      })) as StartRrwebRecordingResult

      if (!result) {
        return { success: false, error: 'Extension returned empty result' }
      }

      if (result.success) {
        this.activeRecordings.set(result.tabId, {
          id,
          tabId: result.tabId,
          sessionId: recordingParams.sessionId,
          outputPath,
          events: [],
          startedAt: result.startedAt,
          url: result.url,
        })
        this.logger?.log(
          pc.green(
            `rrweb recording started for tab ${result.tabId} (sessionId: ${recordingParams.sessionId || 'none'}), output: ${outputPath}`,
          ),
        )
      }

      return result
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger?.error('Start rrweb recording error:', error)
      return { success: false, error: errorMessage }
    }
  }

  async stopRecording(params: StopRrwebRecordingParams): Promise<StopRrwebRecordingResult> {
    if (!this.isExtensionConnected()) {
      return { success: false, error: 'Extension not connected' }
    }

    const findRecording = (): ActiveRrwebRecording | undefined => {
      if (params.sessionId) {
        return Array.from(this.activeRecordings.values()).find((recording) => {
          return recording.sessionId === params.sessionId
        })
      }
      return this.activeRecordings.values().next().value
    }

    const recording = findRecording()
    if (!recording) {
      const errorMsg = params.sessionId
        ? `No active rrweb recording found for sessionId: ${params.sessionId}`
        : 'No active rrweb recording found'
      return { success: false, error: errorMsg }
    }

    let timeoutId: ReturnType<typeof setTimeout>
    const finalPromise = new Promise<StopRrwebRecordingResult>((resolve) => {
      const wrappedResolve = (result: StopRrwebRecordingResult) => {
        clearTimeout(timeoutId)
        resolve(result)
      }
      recording.resolveStop = wrappedResolve
      timeoutId = setTimeout(() => {
        if (recording.resolveStop) {
          recording.resolveStop = undefined
          resolve({ success: false, error: 'Timeout waiting for rrweb recording data' })
        }
      }, 30000)
    })

    try {
      const result = (await this.sendToExtension({
        method: 'stopRrwebRecording',
        params,
        timeout: 10000,
      })) as ExtensionStopRrwebRecordingResult

      if (!result.success) {
        recording.resolveStop = undefined
        this.activeRecordings.delete(recording.tabId)
        return result
      }

      return await finalPromise
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger?.error('Stop rrweb recording error:', error)
      return { success: false, error: errorMessage }
    }
  }

  async isRecording(params: IsRrwebRecordingParams): Promise<IsRrwebRecordingResult> {
    if (!this.isExtensionConnected()) {
      return { isRecording: false }
    }

    try {
      return (await this.sendToExtension({
        method: 'isRrwebRecording',
        params,
        timeout: 5000,
      })) as IsRrwebRecordingResult
    } catch {
      return { isRecording: false }
    }
  }

  async cancelRecording(params: CancelRrwebRecordingParams): Promise<CancelRrwebRecordingResult> {
    if (!this.isExtensionConnected()) {
      return { success: false, error: 'Extension not connected' }
    }

    try {
      return (await this.sendToExtension({
        method: 'cancelRrwebRecording',
        params,
        timeout: 5000,
      })) as CancelRrwebRecordingResult
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger?.error('Cancel rrweb recording error:', error)
      return { success: false, error: errorMessage }
    }
  }
}
