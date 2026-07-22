import fs from 'node:fs'
import path from 'node:path'
import { getTabwrightUserDataDir } from './product-paths.js'
import crypto from 'node:crypto'
import pc from 'picocolors'
import type {
  CancelRrwebRecordingParams,
  CancelRrwebRecordingResult,
  IsRrwebRecordingParams,
  IsRrwebRecordingResult,
  ExtensionStopRrwebRecordingResult,
  FlushRrwebRecordingResult,
  RrwebEvent,
  RrwebRecordingCancelledMessage,
  RrwebRecordingDataMessage,
  StartRrwebRecordingBody,
  StartRrwebRecordingParams,
  StartRrwebRecordingResult,
  StopRrwebRecordingParams,
  StopRrwebRecordingResult,
  RrwebRecordingMode,
} from './protocol.js'

export const DEFAULT_ACTIVITY_WINDOW_MS = 15 * 60 * 1000
export const DEFAULT_ACTIVITY_CLIP_MS = 5 * 60 * 1000
export const ACTIVITY_CHECKOUT_INTERVAL_MS = 60 * 1000

export interface ActiveRrwebRecording {
  id: string
  tabId: number
  sessionId?: string
  outputPath: string
  events: RrwebEvent[]
  startedAt: number
  url?: string
  mode: RrwebRecordingMode
  maxDurationMs?: number
  resolveStop?: (result: StopRrwebRecordingResult) => void
}

export interface RecentActivitySnapshot {
  tabId: number
  sessionId?: string
  url?: string
  observingSince: number
  availableFrom: number
  availableTo: number
  eventCount: number
  events: RrwebEvent[]
  selectionStart: number
  selectionEnd: number
}

type ManualSelection = {
  startedAt: number
  outputPath?: string
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
  source?: RrwebRecordingMode
  selectionStart?: number
  selectionEnd?: number
}

export interface SavedRrwebRecordingWithEvents {
  recording: SavedRrwebRecording
  events: RrwebEvent[]
}

function getRrwebRecordingsDir(): string {
  return path.join(getTabwrightUserDataDir(), 'rrweb-recordings')
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

function isNumberOrUndefined(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isRrwebRecordingModeOrUndefined(value: unknown): value is RrwebRecordingMode | undefined {
  return value === undefined || value === 'manual' || value === 'activity'
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
    source?: unknown
    selectionStart?: unknown
    selectionEnd?: unknown
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
    isStringOrUndefined(candidate.url) &&
    isRrwebRecordingModeOrUndefined(candidate.source) &&
    isNumberOrUndefined(candidate.selectionStart) &&
    isNumberOrUndefined(candidate.selectionEnd)
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

function saveRrwebRecordingMetadata(
  recording: ActiveRrwebRecording,
  options: { duration: number; size: number; selectionStart?: number; selectionEnd?: number },
): SavedRrwebRecording {
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
    source: recording.mode,
    selectionStart: options.selectionStart,
    selectionEnd: options.selectionEnd,
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

function rrwebEventTimestamp(event: RrwebEvent): number | undefined {
  return typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) ? event.timestamp : undefined
}

function isFullSnapshotEvent(event: RrwebEvent): boolean {
  return event.type === 2 && rrwebEventTimestamp(event) !== undefined
}

function latestEventUrl(events: RrwebEvent[]): string | undefined {
  return events.reduce<string | undefined>((url, event) => {
    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
      return url
    }
    const data = event.data as Record<string, unknown>
    if (typeof data.href === 'string') {
      return data.href
    }
    return typeof data.url === 'string' ? data.url : url
  }, undefined)
}

function eventRange(events: RrwebEvent[]): { from: number; to: number } | null {
  const timestamps: number[] = events
    .map((event) => {
      return rrwebEventTimestamp(event)
    })
    .filter((timestamp): timestamp is number => {
      return timestamp !== undefined
    })
  const from = timestamps[0]
  const to = timestamps[timestamps.length - 1]
  if (from === undefined || to === undefined) {
    return null
  }
  return { from, to }
}

function sliceActivityEvents(options: {
  events: RrwebEvent[]
  selectionStart: number
  selectionEnd: number
}): RrwebEvent[] {
  const snapshotIndex = options.events.reduce((selectedIndex, event, index) => {
    const timestamp = rrwebEventTimestamp(event)
    if (!isFullSnapshotEvent(event) || timestamp === undefined || timestamp > options.selectionStart) {
      return selectedIndex
    }
    return index
  }, -1)
  const startIndex = snapshotIndex >= 0 ? snapshotIndex : 0
  return options.events.slice(startIndex).filter((event) => {
    const timestamp = rrwebEventTimestamp(event)
    return timestamp === undefined || timestamp <= options.selectionEnd
  })
}

function persistRrwebRecording(options: {
  recording: ActiveRrwebRecording
  duration: number
  selectionStart?: number
  selectionEnd?: number
}): SavedRrwebRecording {
  const dir = path.dirname(options.recording.outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const payload = `${JSON.stringify(options.recording.events)}\n`
  fs.writeFileSync(options.recording.outputPath, payload)
  return saveRrwebRecordingMetadata(options.recording, {
    duration: options.duration,
    size: Buffer.byteLength(payload),
    selectionStart: options.selectionStart,
    selectionEnd: options.selectionEnd,
  })
}

export class RrwebRecordingRelay {
  private activeRecordings = new Map<number, ActiveRrwebRecording>()
  private manualSelections = new Map<number, ManualSelection>()
  private activityStartRequests = new Map<string, Promise<StartRrwebRecordingResult>>()
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

    const validEvents = events.filter(isRrwebEvent)
    recording.events.push(...validEvents)
    recording.url = latestEventUrl(validEvents) || recording.url

    if (recording.mode === 'activity' && !final) {
      this.trimActivityEvents(recording)
    }

    if (!final) {
      return
    }

    try {
      const duration = Date.now() - recording.startedAt
      const savedRecording = persistRrwebRecording({ recording, duration })
      this.logger?.log(
        pc.green(
          `rrweb recording saved: ${recording.outputPath} (${savedRecording.size} bytes, ${duration}ms, ${recording.events.length} events)`,
        ),
      )

      if (recording.resolveStop) {
        recording.resolveStop({
          success: true,
          id: savedRecording.id,
          tabId,
          duration,
          path: recording.outputPath,
          size: savedRecording.size,
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
    this.manualSelections.delete(tabId)
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
    this.manualSelections.delete(tabId)
  }

  private trimActivityEvents(recording: ActiveRrwebRecording): void {
    const cutoff = Date.now() - (recording.maxDurationMs || DEFAULT_ACTIVITY_WINDOW_MS)
    const nextSnapshotIndex = recording.events.findIndex((event) => {
      const timestamp = rrwebEventTimestamp(event)
      return isFullSnapshotEvent(event) && timestamp !== undefined && timestamp >= cutoff
    })
    if (nextSnapshotIndex <= 0) {
      return
    }
    recording.events = recording.events.slice(nextSnapshotIndex)
  }

  private findRecording(options: { sessionId?: string; mode?: RrwebRecordingMode }): ActiveRrwebRecording | undefined {
    const recordings = Array.from(this.activeRecordings.values()).filter((recording) => {
      if (options.sessionId && recording.sessionId !== options.sessionId) {
        return false
      }
      return !options.mode || recording.mode === options.mode
    })
    return recordings.length === 1 ? recordings[0] : undefined
  }

  listRecentActivities(): Array<Omit<RecentActivitySnapshot, 'events' | 'selectionStart' | 'selectionEnd'>> {
    return Array.from(this.activeRecordings.values())
      .filter((recording) => {
        return recording.mode === 'activity'
      })
      .map((recording) => {
        const range = eventRange(recording.events)
        return {
          tabId: recording.tabId,
          sessionId: recording.sessionId,
          url: recording.url,
          observingSince: recording.startedAt,
          availableFrom: range?.from || recording.startedAt,
          availableTo: range?.to || recording.startedAt,
          eventCount: recording.events.length,
        }
      })
  }

  async ensureActivityRecording(options: { sessionId: string }): Promise<StartRrwebRecordingResult> {
    const existing = this.findRecording({ sessionId: options.sessionId, mode: 'activity' })
    if (existing) {
      return {
        success: true,
        tabId: existing.tabId,
        startedAt: existing.startedAt,
        url: existing.url,
      }
    }
    const pending = this.activityStartRequests.get(options.sessionId)
    if (pending) {
      return await pending
    }
    const startRequest = this.startRecording({
      sessionId: options.sessionId,
      mode: 'activity',
      checkoutEveryNms: ACTIVITY_CHECKOUT_INTERVAL_MS,
      maxDurationMs: DEFAULT_ACTIVITY_WINDOW_MS,
      maskAllInputs: false,
    }).finally(() => {
      this.activityStartRequests.delete(options.sessionId)
    })
    this.activityStartRequests.set(options.sessionId, startRequest)
    return await startRequest
  }

  async getRecentActivity(options: {
    sessionId?: string
    from?: number
    to?: number
    lastMs?: number
  }): Promise<RecentActivitySnapshot> {
    const recording = this.findRecording({ sessionId: options.sessionId, mode: 'activity' })
    if (!recording) {
      const activities = this.listRecentActivities()
      const suffix = activities.length > 1 ? ' Pass a sessionId from the available activities.' : ''
      throw new Error(`No unique attached activity stream found.${suffix}`)
    }
    const flushResult = (await this.sendToExtension({
      method: 'flushRrwebRecording',
      params: recording.sessionId ? { sessionId: recording.sessionId } : {},
      timeout: 10000,
    })) as FlushRrwebRecordingResult
    if (!flushResult.success) {
      throw new Error('Could not flush recent browser activity', { cause: new Error(flushResult.error) })
    }

    const range = eventRange(recording.events)
    if (!range) {
      throw new Error('No browser activity events are available yet')
    }
    const selectionEnd = Math.min(options.to ?? range.to, range.to)
    const requestedStart = options.from ?? selectionEnd - (options.lastMs || DEFAULT_ACTIVITY_CLIP_MS)
    const selectionStart = Math.max(requestedStart, range.from)
    if (selectionStart > selectionEnd) {
      throw new Error('Activity selection starts after it ends')
    }
    return {
      tabId: recording.tabId,
      sessionId: recording.sessionId,
      url: recording.url,
      observingSince: recording.startedAt,
      availableFrom: range.from,
      availableTo: range.to,
      eventCount: recording.events.length,
      events: [...recording.events],
      selectionStart,
      selectionEnd,
    }
  }

  async saveRecentActivity(options: {
    sessionId?: string
    from?: number
    to?: number
    lastMs?: number
    outputPath?: string
  }): Promise<StopRrwebRecordingResult> {
    const activity = await this.getRecentActivity(options)
    const sourceRecording = this.findRecording({ sessionId: activity.sessionId, mode: 'activity' })
    if (!sourceRecording) {
      return { success: false, error: 'Attached activity stream ended before it could be saved' }
    }
    const id = createRrwebRecordingId()
    const events = sliceActivityEvents({
      events: activity.events,
      selectionStart: activity.selectionStart,
      selectionEnd: activity.selectionEnd,
    })
    const clip: ActiveRrwebRecording = {
      ...sourceRecording,
      id,
      outputPath: options.outputPath || createDefaultRrwebRecordingOutputPath(id),
      events,
      startedAt: activity.selectionStart,
      mode: 'activity',
      resolveStop: undefined,
    }
    try {
      const duration = activity.selectionEnd - activity.selectionStart
      const saved = persistRrwebRecording({
        recording: clip,
        duration,
        selectionStart: activity.selectionStart,
        selectionEnd: activity.selectionEnd,
      })
      return {
        success: true,
        id: saved.id,
        tabId: saved.tabId,
        duration: saved.duration,
        path: saved.path,
        size: saved.size,
        eventCount: saved.eventCount,
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  }

  async startRecording(params: StartRrwebRecordingParams & { outputPath?: string }): Promise<StartRrwebRecordingResult> {
    const mode = params.mode || 'manual'
    const existingActivity = this.findRecording({ sessionId: params.sessionId, mode: 'activity' })
    if (mode === 'manual' && existingActivity) {
      if (this.manualSelections.has(existingActivity.tabId)) {
        return { success: false, error: 'Manual replay selection already in progress for this tab' }
      }
      const startedAt = Date.now()
      this.manualSelections.set(existingActivity.tabId, { startedAt, outputPath: params.outputPath })
      return { success: true, tabId: existingActivity.tabId, startedAt, url: existingActivity.url }
    }
    if (this.findRecording({ sessionId: params.sessionId, mode })) {
      return { success: false, error: `${mode} rrweb recording already in progress for this tab` }
    }
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
          mode,
          maxDurationMs: recordingParams.maxDurationMs,
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

    const activity = this.findRecording({ sessionId: params.sessionId, mode: 'activity' })
    const manualSelection = activity ? this.manualSelections.get(activity.tabId) : undefined
    if (activity && manualSelection) {
      this.manualSelections.delete(activity.tabId)
      return await this.saveRecentActivity({
        sessionId: activity.sessionId,
        from: manualSelection.startedAt,
        to: Date.now(),
        outputPath: manualSelection.outputPath,
      })
    }

    const recording = this.findRecording({ sessionId: params.sessionId })
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
        params: recording.sessionId ? { sessionId: recording.sessionId } : {},
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

    const activity = this.findRecording({ sessionId: params.sessionId, mode: 'activity' })
    if (activity) {
      const startedAt = this.manualSelections.get(activity.tabId)?.startedAt
      return {
        isRecording: startedAt !== undefined,
        startedAt,
        tabId: activity.tabId,
        url: activity.url,
      }
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

    const activity = this.findRecording({ sessionId: params.sessionId, mode: 'activity' })
    if (activity && this.manualSelections.has(activity.tabId)) {
      this.manualSelections.delete(activity.tabId)
      return { success: true }
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
