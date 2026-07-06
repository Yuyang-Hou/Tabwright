import path from 'node:path'
import type { BrowserContext, Page } from '@xmorse/playwright-core'
import { getLocalRelayHttpBaseUrl } from './relay-client.js'
import type {
  CancelRrwebRecordingResult,
  IsRrwebRecordingResult,
  RrwebEvent,
  StartRrwebRecordingResult,
  StopRrwebRecordingResult,
} from './protocol.js'

function replayHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = process.env.PLAYWRITER_TOKEN
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

async function getReplayRelayBaseUrl(relayPort: number): Promise<string> {
  return await getLocalRelayHttpBaseUrl(relayPort)
}

export interface StartReplayOptions {
  page: Page
  sessionId?: string
  outputPath?: string
  relayPort?: number
  checkoutEveryNms?: number
  maskAllInputs?: boolean
  recordCanvas?: boolean
  inlineImages?: boolean
  collectFonts?: boolean
  mousemoveWait?: number
}

export interface StopReplayOptions {
  page: Page
  sessionId?: string
  relayPort?: number
}

export interface ReplayState {
  isRecording: boolean
  startedAt?: number
  tabId?: number
  url?: string
}

export interface SavedReplayRecording {
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

interface ListReplayRecordingsResponse {
  recordings: SavedReplayRecording[]
}

interface ReplayRecordingEventsResponse {
  recording: SavedReplayRecording
  events: RrwebEvent[]
}

interface ReplayTargetOptions {
  page?: Page
  sessionId?: string
}

interface CreateReplayApiOptions {
  context: BrowserContext
  defaultPage: Page
  relayPort: number
}

interface StartReplayWithDefaultsOptions extends Omit<StartReplayOptions, 'relayPort' | 'page' | 'sessionId'>, ReplayTargetOptions {}
interface StopReplayWithDefaultsOptions extends Omit<StopReplayOptions, 'relayPort' | 'page' | 'sessionId'>, ReplayTargetOptions {}
interface IsReplayWithDefaultsOptions extends ReplayTargetOptions {}
interface CancelReplayWithDefaultsOptions extends ReplayTargetOptions {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringOrUndefined(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isRrwebEvent(value: unknown): value is RrwebEvent {
  return isRecord(value)
}

function isSavedReplayRecording(value: unknown): value is SavedReplayRecording {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.path === 'string' &&
    typeof value.startedAt === 'number' &&
    typeof value.savedAt === 'number' &&
    typeof value.duration === 'number' &&
    typeof value.size === 'number' &&
    typeof value.eventCount === 'number' &&
    typeof value.tabId === 'number' &&
    isStringOrUndefined(value.sessionId) &&
    isStringOrUndefined(value.url)
  )
}

function isListReplayRecordingsResponse(value: unknown): value is ListReplayRecordingsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.recordings) &&
    value.recordings.every((recording) => {
      return isSavedReplayRecording(recording)
    })
  )
}

function isReplayRecordingEventsResponse(value: unknown): value is ReplayRecordingEventsResponse {
  return (
    isRecord(value) &&
    isSavedReplayRecording(value.recording) &&
    Array.isArray(value.events) &&
    value.events.every(isRrwebEvent)
  )
}

function withReplayDefaults<T extends ReplayTargetOptions, R>(options: {
  relayPort: number
  defaultPage: Page
  fn: (opts: T & { page: Page; relayPort: number; sessionId?: string }) => Promise<R>
}): (input?: T) => Promise<R> {
  const { relayPort, defaultPage, fn } = options
  return async (input: T = {} as T) => {
    const targetPage = input.page || defaultPage
    const sessionId = input.sessionId || targetPage.sessionId() || undefined
    return await fn({ page: targetPage, sessionId, relayPort, ...input })
  }
}

export function createReplayApi(options: CreateReplayApiOptions): {
  start: (opts?: StartReplayWithDefaultsOptions) => Promise<ReplayState>
  stop: (opts?: StopReplayWithDefaultsOptions) => Promise<{
    id?: string
    path: string
    duration: number
    size: number
    eventCount: number
  }>
  isRecording: (opts?: IsReplayWithDefaultsOptions) => Promise<ReplayState>
  cancel: (opts?: CancelReplayWithDefaultsOptions) => Promise<void>
  list: (opts?: { limit?: number }) => Promise<SavedReplayRecording[]>
  events: (opts: { id: string }) => Promise<ReplayRecordingEventsResponse>
} {
  const { relayPort, defaultPage } = options
  return {
    start: withReplayDefaults<StartReplayWithDefaultsOptions, ReplayState>({
      relayPort,
      defaultPage,
      fn: startReplayRecording,
    }),
    stop: withReplayDefaults<
      StopReplayWithDefaultsOptions,
      { id?: string; path: string; duration: number; size: number; eventCount: number }
    >({
      relayPort,
      defaultPage,
      fn: stopReplayRecording,
    }),
    isRecording: withReplayDefaults<IsReplayWithDefaultsOptions, ReplayState>({
      relayPort,
      defaultPage,
      fn: isReplayRecording,
    }),
    cancel: withReplayDefaults<CancelReplayWithDefaultsOptions, void>({
      relayPort,
      defaultPage,
      fn: cancelReplayRecording,
    }),
    list: async (opts) => {
      return await listReplayRecordings({ ...opts, relayPort })
    },
    events: async (opts) => {
      return await getReplayRecordingEvents({ ...opts, relayPort })
    },
  }
}

export async function startReplayRecording(options: StartReplayOptions): Promise<ReplayState> {
  const {
    sessionId,
    outputPath,
    relayPort = 19988,
    checkoutEveryNms,
    maskAllInputs,
    recordCanvas,
    inlineImages,
    collectFonts,
    mousemoveWait,
  } = options
  const absoluteOutputPath = outputPath ? path.resolve(outputPath) : undefined
  const relayBaseUrl = await getReplayRelayBaseUrl(relayPort)

  const response = await fetch(`${relayBaseUrl}/rrweb-recording/start`, {
    method: 'POST',
    headers: replayHeaders(),
    body: JSON.stringify({
      sessionId,
      outputPath: absoluteOutputPath,
      checkoutEveryNms,
      maskAllInputs,
      recordCanvas,
      inlineImages,
      collectFonts,
      mousemoveWait,
    }),
  })
  const result = (await response.json()) as StartRrwebRecordingResult
  if (!result.success) {
    throw new Error(`Failed to start replay recording: ${result.error}`)
  }
  return {
    isRecording: true,
    startedAt: result.startedAt,
    tabId: result.tabId,
    url: result.url,
  }
}

export async function stopReplayRecording(
  options: StopReplayOptions,
): Promise<{ id?: string; path: string; duration: number; size: number; eventCount: number }> {
  const { sessionId, relayPort = 19988 } = options
  const relayBaseUrl = await getReplayRelayBaseUrl(relayPort)

  const response = await fetch(`${relayBaseUrl}/rrweb-recording/stop`, {
    method: 'POST',
    headers: replayHeaders(),
    body: JSON.stringify({ sessionId }),
  })
  const result = (await response.json()) as StopRrwebRecordingResult
  if (!result.success) {
    throw new Error(`Failed to stop replay recording: ${result.error}`)
  }
  return { id: result.id, path: result.path, duration: result.duration, size: result.size, eventCount: result.eventCount }
}

export async function isReplayRecording(options: {
  page: Page
  sessionId?: string
  relayPort?: number
}): Promise<ReplayState> {
  const { sessionId, relayPort = 19988 } = options
  const relayBaseUrl = await getReplayRelayBaseUrl(relayPort)
  const url = new URL(`${relayBaseUrl}/rrweb-recording/status`)
  if (sessionId) {
    url.searchParams.set('sessionId', sessionId)
  }
  const response = await fetch(url.toString(), { headers: replayHeaders() })
  const result = (await response.json()) as IsRrwebRecordingResult
  return { isRecording: result.isRecording, startedAt: result.startedAt, tabId: result.tabId, url: result.url }
}

export async function cancelReplayRecording(options: {
  page: Page
  sessionId?: string
  relayPort?: number
}): Promise<void> {
  const { sessionId, relayPort = 19988 } = options
  const relayBaseUrl = await getReplayRelayBaseUrl(relayPort)

  const response = await fetch(`${relayBaseUrl}/rrweb-recording/cancel`, {
    method: 'POST',
    headers: replayHeaders(),
    body: JSON.stringify({ sessionId }),
  })
  const result = (await response.json()) as CancelRrwebRecordingResult
  if (!result.success) {
    throw new Error(`Failed to cancel replay recording: ${result.error}`)
  }
}

export async function listReplayRecordings(options: {
  relayPort?: number
  limit?: number
} = {}): Promise<SavedReplayRecording[]> {
  const { relayPort = 19988, limit = 50 } = options
  const relayBaseUrl = await getReplayRelayBaseUrl(relayPort)
  const url = new URL(`${relayBaseUrl}/rrweb-recordings`)
  url.searchParams.set('limit', String(limit))

  const response = await fetch(url.toString(), { headers: replayHeaders() })
  const result = (await response.json()) as unknown
  if (!response.ok || !isListReplayRecordingsResponse(result)) {
    throw new Error(`Failed to list replay recordings: ${response.status}`)
  }
  return result.recordings
}

export async function getReplayRecordingEvents(options: {
  id: string
  relayPort?: number
}): Promise<ReplayRecordingEventsResponse> {
  const { id, relayPort = 19988 } = options
  const relayBaseUrl = await getReplayRelayBaseUrl(relayPort)
  const response = await fetch(`${relayBaseUrl}/rrweb-recordings/${encodeURIComponent(id)}/events`, {
    headers: replayHeaders(),
  })
  const result = (await response.json()) as unknown
  if (!response.ok || !isReplayRecordingEventsResponse(result)) {
    throw new Error(`Failed to load replay recording events: ${response.status}`)
  }
  return result
}
