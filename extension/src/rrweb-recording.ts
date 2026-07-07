import type {
  CancelRrwebRecordingParams,
  CancelRrwebRecordingResult,
  ExtensionStopRrwebRecordingResult,
  IsRrwebRecordingParams,
  IsRrwebRecordingResult,
  RrwebEvent,
  StartRrwebRecordingParams,
  StartRrwebRecordingResult,
  StopRrwebRecordingParams,
} from 'playwriter/src/protocol'
import { connectionManager, getTabBySessionId, logger, sendMessage, store } from './background'

type RrwebRecordingInfo = {
  tabId: number
  startedAt: number
  options: StartRrwebRecordingParams
  url?: string
}

type RrwebRecorderResponse =
  | {
      success: true
      isRecording?: boolean
      startedAt?: number
      duration?: number
      url?: string
      eventCount?: number
    }
  | {
      success: false
      error: string
      isRecording?: boolean
    }

export type RrwebEventBatchMessage = {
  action: 'playwriterRrwebEvents'
  events: RrwebEvent[]
  final?: boolean
}

export type RrwebCancelledMessage = {
  action: 'playwriterRrwebCancelled'
}

const activeRrwebRecordings = new Map<number, RrwebRecordingInfo>()

export function getActiveRrwebRecordings(): Map<number, RrwebRecordingInfo> {
  return activeRrwebRecordings
}

type RrwebFrameMessageResult = {
  frameId: number
  response: RrwebRecorderResponse
}

type FailedRrwebFrameMessageResult = RrwebFrameMessageResult & {
  response: Extract<RrwebRecorderResponse, { success: false }>
}

function resolveTabIdFromSessionId(sessionId?: string): number | undefined {
  if (!sessionId) {
    for (const [tabId, tab] of store.getState().tabs) {
      if (tab.state === 'connected') {
        return tabId
      }
    }
    return undefined
  }

  const found = getTabBySessionId(sessionId)
  return found?.tabId
}

function isRrwebRecorderResponse(value: unknown): value is RrwebRecorderResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as {
    success?: unknown
    error?: unknown
    isRecording?: unknown
    startedAt?: unknown
    duration?: unknown
    url?: unknown
    eventCount?: unknown
  }
  return (
    typeof candidate.success === 'boolean' &&
    (candidate.error === undefined || typeof candidate.error === 'string') &&
    (candidate.isRecording === undefined || typeof candidate.isRecording === 'boolean') &&
    (candidate.startedAt === undefined || typeof candidate.startedAt === 'number') &&
    (candidate.duration === undefined || typeof candidate.duration === 'number') &&
    (candidate.url === undefined || typeof candidate.url === 'string') &&
    (candidate.eventCount === undefined || typeof candidate.eventCount === 'number')
  )
}

function isRrwebEvent(value: unknown): value is RrwebEvent {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isRrwebEventBatchMessage(value: unknown): value is RrwebEventBatchMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { action?: unknown; events?: unknown; final?: unknown }
  return (
    candidate.action === 'playwriterRrwebEvents' &&
    Array.isArray(candidate.events) &&
    candidate.events.every(isRrwebEvent) &&
    (candidate.final === undefined || typeof candidate.final === 'boolean')
  )
}

export function isRrwebCancelledMessage(value: unknown): value is RrwebCancelledMessage {
  if (!value || typeof value !== 'object') return false
  return (value as { action?: unknown }).action === 'playwriterRrwebCancelled'
}

function isFailedRrwebFrameMessageResult(result: RrwebFrameMessageResult): result is FailedRrwebFrameMessageResult {
  return !result.response.success
}

async function getRrwebFrameIds(tabId: number): Promise<number[]> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId })
    return Array.from(
      new Set([
        0,
        ...(frames || []).map((frame) => {
          return frame.frameId
        }),
      ]),
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.debug('Could not enumerate rrweb recorder frames:', tabId, message)
    return [0]
  }
}

async function sendFrameMessage(options: {
  tabId: number
  frameId: number
  message: unknown
}): Promise<RrwebRecorderResponse> {
  const response = (await chrome.tabs.sendMessage(options.tabId, options.message, {
    frameId: options.frameId,
  })) as unknown
  if (!isRrwebRecorderResponse(response)) {
    return { success: false, error: 'Invalid rrweb recorder response' }
  }
  return response
}

async function sendTabMessage(options: { tabId: number; message: unknown }): Promise<RrwebRecorderResponse> {
  return await sendFrameMessage({
    tabId: options.tabId,
    frameId: 0,
    message: options.message,
  })
}

async function sendTabMessageToAllFrames(options: {
  tabId: number
  message: unknown
}): Promise<RrwebFrameMessageResult[]> {
  const frameIds = await getRrwebFrameIds(options.tabId)
  return await Promise.all(
    frameIds.map(async (frameId) => {
      try {
        return {
          frameId,
          response: await sendFrameMessage({
            tabId: options.tabId,
            frameId,
            message: options.message,
          }),
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.debug('rrweb recorder frame message failed:', options.tabId, frameId, message)
        return {
          frameId,
          response: { success: false, error: message },
        }
      }
    }),
  )
}

function pickPrimaryRecorderResponse(results: RrwebFrameMessageResult[]): RrwebRecorderResponse {
  const topFrameResponse = results.find((result) => {
    return result.frameId === 0 && result.response.success
  })?.response
  if (topFrameResponse) {
    return topFrameResponse
  }

  const firstSuccessfulResponse = results.find((result) => {
    return result.response.success
  })?.response
  if (firstSuccessfulResponse) {
    return firstSuccessfulResponse
  }

  const firstError = results.find(isFailedRrwebFrameMessageResult)?.response.error || 'No rrweb recorder frame responded'
  return { success: false, error: firstError }
}

async function injectRrwebRecorder(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['rrweb-recorder.js'],
  })
}

async function ensureRrwebRecorderReady(tabId: number): Promise<void> {
  try {
    await injectRrwebRecorder(tabId)
  } catch (error: unknown) {
    logger.debug('rrweb recorder all-frame injection failed before status check:', error)
  }

  try {
    const response = await sendTabMessage({ tabId, message: { action: 'playwriterRrwebStatus' } })
    if (response.success) {
      return
    }
    throw new Error(response.error)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error('rrweb recorder content script is not available for this tab.', { cause: new Error(message) })
  }
}

async function startRecorderInTab(options: {
  tabId: number
  startedAt: number
  params: StartRrwebRecordingParams
}): Promise<RrwebRecorderResponse> {
  await ensureRrwebRecorderReady(options.tabId)
  const results = await sendTabMessageToAllFrames({
    tabId: options.tabId,
    message: {
      action: 'playwriterRrwebStart',
      params: {
        ...options.params,
        startedAt: options.startedAt,
      },
    },
  })
  return pickPrimaryRecorderResponse(results)
}

export async function handleStartRrwebRecording(params: StartRrwebRecordingParams): Promise<StartRrwebRecordingResult> {
  const tabId = resolveTabIdFromSessionId(params.sessionId)
  if (!tabId) {
    return {
      success: false,
      error: 'No connected tab found for rrweb recording. Click the Playwriter extension icon on the tab you want to record.',
    }
  }

  if (activeRrwebRecordings.has(tabId)) {
    return { success: false, error: 'rrweb recording already in progress for this tab' }
  }

  const tabInfo = store.getState().tabs.get(tabId)
  if (!tabInfo || tabInfo.state !== 'connected') {
    return { success: false, error: 'Tab is not connected' }
  }

  const startedAt = Date.now()
  logger.debug('Starting rrweb recording for tab:', tabId, 'params:', params)

  try {
    const response = await startRecorderInTab({ tabId, startedAt, params })
    if (!response.success) {
      return { success: false, error: response.error || 'Failed to start rrweb recorder' }
    }

    activeRrwebRecordings.set(tabId, {
      tabId,
      startedAt,
      options: params,
      url: response.url,
    })

    logger.debug('rrweb recording started for tab:', tabId, 'url:', response.url)
    return { success: true, tabId, startedAt, url: response.url }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to start rrweb recording:', error)
    return { success: false, error: errorMessage }
  }
}

export async function handleStopRrwebRecording(params: StopRrwebRecordingParams): Promise<ExtensionStopRrwebRecordingResult> {
  const tabId = resolveTabIdFromSessionId(params.sessionId)
  if (!tabId) {
    return { success: false, error: 'No connected tab found' }
  }

  const recording = activeRrwebRecordings.get(tabId)
  if (!recording) {
    return { success: false, error: 'No active rrweb recording for this tab' }
  }

  logger.debug('Stopping rrweb recording for tab:', tabId)

  try {
    const results = await sendTabMessageToAllFrames({ tabId, message: { action: 'playwriterRrwebStop' } })
    const response = pickPrimaryRecorderResponse(results)
    if (!response.success) {
      return { success: false, error: response.error || 'Failed to stop rrweb recorder' }
    }

    activeRrwebRecordings.delete(tabId)
    const duration = response.duration || Date.now() - recording.startedAt
    logger.debug('rrweb recording stopped for tab:', tabId, 'duration:', duration)
    return { success: true, tabId, duration }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to stop rrweb recording:', error)
    return { success: false, error: errorMessage }
  }
}

export async function handleIsRrwebRecording(params: IsRrwebRecordingParams): Promise<IsRrwebRecordingResult> {
  const tabId = resolveTabIdFromSessionId(params.sessionId)
  if (!tabId) {
    return { isRecording: false }
  }

  const recording = activeRrwebRecordings.get(tabId)
  if (!recording) {
    return { isRecording: false, tabId }
  }

  try {
    const response = await sendTabMessage({ tabId, message: { action: 'playwriterRrwebStatus' } })
    return {
      isRecording: response.success ? Boolean(response.isRecording) : false,
      tabId,
      startedAt: recording.startedAt,
      url: response.success ? response.url || recording.url : recording.url,
    }
  } catch {
    return { isRecording: false, tabId }
  }
}

export async function handleCancelRrwebRecording(params: CancelRrwebRecordingParams): Promise<CancelRrwebRecordingResult> {
  const tabId = resolveTabIdFromSessionId(params.sessionId)
  if (!tabId) {
    return { success: false, error: 'No connected tab found' }
  }

  const recording = activeRrwebRecordings.get(tabId)
  if (!recording) {
    return { success: true }
  }

  logger.debug('Cancelling rrweb recording for tab:', tabId)

  try {
    await sendTabMessageToAllFrames({ tabId, message: { action: 'playwriterRrwebCancel' } })
    activeRrwebRecordings.delete(tabId)

    if (connectionManager.ws?.readyState === WebSocket.OPEN) {
      sendMessage({
        method: 'rrwebRecordingCancelled',
        params: { tabId },
      })
    }

    return { success: true }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to cancel rrweb recording:', error)
    return { success: false, error: errorMessage }
  }
}

export async function resumeRrwebRecordingForNavigation(tabId: number): Promise<void> {
  const recording = activeRrwebRecordings.get(tabId)
  if (!recording) return

  try {
    const response = await startRecorderInTab({
      tabId,
      startedAt: recording.startedAt,
      params: recording.options,
    })
    if (response.success) {
      activeRrwebRecordings.set(tabId, { ...recording, url: response.url || recording.url })
    } else {
      logger.debug('Could not resume rrweb recorder after navigation:', response.error)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.debug('Could not resume rrweb recorder after navigation:', message)
  }
}

export async function cleanupRrwebRecordingForTab(tabId: number): Promise<void> {
  if (!activeRrwebRecordings.has(tabId)) return
  try {
    await sendTabMessageToAllFrames({ tabId, message: { action: 'playwriterRrwebCancel' } })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.debug('Failed to cancel rrweb recorder during tab cleanup:', tabId, message)
  }
  activeRrwebRecordings.delete(tabId)
  if (connectionManager.ws?.readyState === WebSocket.OPEN) {
    sendMessage({
      method: 'rrwebRecordingCancelled',
      params: { tabId },
    })
  }
}
