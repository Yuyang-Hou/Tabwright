import { record, type eventWithTime, type recordOptions } from 'rrweb'
import type { RrwebEvent, StartRrwebRecordingParams } from 'playwriter/src/protocol'

declare global {
  var __playwriterRrwebRecorderInstalled: boolean | undefined
}

type RrwebRecorderStartMessage = {
  action: 'playwriterRrwebStart'
  params: StartRrwebRecordingParams & {
    startedAt: number
  }
}

type RrwebRecorderStopMessage = {
  action: 'playwriterRrwebStop'
}

type RrwebRecorderStatusMessage = {
  action: 'playwriterRrwebStatus'
}

type RrwebRecorderCancelMessage = {
  action: 'playwriterRrwebCancel'
}

type PlaywriterAnnotationMessage = {
  source: 'playwriter-toolbar'
  type: 'recording-annotation' | 'recording-annotation-delete'
  annotation: Record<string, unknown>
}

type RrwebRecorderMessage =
  | RrwebRecorderStartMessage
  | RrwebRecorderStopMessage
  | RrwebRecorderStatusMessage
  | RrwebRecorderCancelMessage

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

type ActiveRrwebRecorder = {
  startedAt: number
  eventCount: number
  stopRecorder: ReturnType<typeof record>
  flushTimer: ReturnType<typeof setTimeout> | null
}

const FLUSH_INTERVAL_MS = 1000
const MAX_BATCH_EVENTS = 25

if (!globalThis.__playwriterRrwebRecorderInstalled) {
  globalThis.__playwriterRrwebRecorderInstalled = true

  let activeRecorder: ActiveRrwebRecorder | null = null
  let pendingEvents: RrwebEvent[] = []

  function isRecorderMessage(value: unknown): value is RrwebRecorderMessage {
    if (!value || typeof value !== 'object') return false
    const candidate = value as { action?: unknown }
    return (
      candidate.action === 'playwriterRrwebStart' ||
      candidate.action === 'playwriterRrwebStop' ||
      candidate.action === 'playwriterRrwebStatus' ||
      candidate.action === 'playwriterRrwebCancel'
    )
  }

  function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  function isAnnotationMessage(value: unknown): value is PlaywriterAnnotationMessage {
    if (!isRecord(value)) return false
    return (
      value.source === 'playwriter-toolbar' &&
      (value.type === 'recording-annotation' || value.type === 'recording-annotation-delete') &&
      isRecord(value.annotation)
    )
  }

  function scheduleFlush(): void {
    if (!activeRecorder) return
    if (activeRecorder.flushTimer) return
    activeRecorder.flushTimer = setTimeout(() => {
      if (activeRecorder) {
        activeRecorder.flushTimer = null
      }
      flushEvents({ final: false }).catch((error: unknown) => {
        console.warn('[Playwriter rrweb] event flush failed', error)
      })
    }, FLUSH_INTERVAL_MS)
  }

  async function flushEvents(options: { final: boolean }): Promise<void> {
    if (activeRecorder?.flushTimer) {
      clearTimeout(activeRecorder.flushTimer)
      activeRecorder.flushTimer = null
    }
    if (pendingEvents.length === 0 && !options.final) {
      return
    }
    const events = pendingEvents
    pendingEvents = []
    await chrome.runtime.sendMessage({
      action: 'playwriterRrwebEvents',
      events,
      final: options.final,
    })
  }

  function buildRecordOptions(params: StartRrwebRecordingParams): recordOptions<eventWithTime> {
    return {
      emit: (event) => {
        pendingEvents.push(event as unknown as RrwebEvent)
        if (activeRecorder) {
          activeRecorder.eventCount += 1
        }
        if (pendingEvents.length >= MAX_BATCH_EVENTS) {
          flushEvents({ final: false }).catch((error: unknown) => {
            console.warn('[Playwriter rrweb] event flush failed', error)
          })
          return
        }
        scheduleFlush()
      },
      checkoutEveryNms: params.checkoutEveryNms ?? 10000,
      maskAllInputs: params.maskAllInputs ?? false,
      recordCanvas: params.recordCanvas ?? false,
      inlineImages: params.inlineImages ?? false,
      collectFonts: params.collectFonts ?? false,
      mousemoveWait: params.mousemoveWait ?? 50,
      recordCrossOriginIframes: false,
    }
  }

  async function startRecording(message: RrwebRecorderStartMessage): Promise<RrwebRecorderResponse> {
    if (activeRecorder) {
      return {
        success: true,
        isRecording: true,
        startedAt: activeRecorder.startedAt,
        url: location.href,
        eventCount: activeRecorder.eventCount,
      }
    }

    pendingEvents = []
    const stopRecorder = record<eventWithTime>(buildRecordOptions(message.params))
    if (!stopRecorder) {
      return { success: false, error: 'rrweb recorder did not start', isRecording: false }
    }

    activeRecorder = {
      startedAt: message.params.startedAt,
      eventCount: 0,
      stopRecorder,
      flushTimer: null,
    }

    return {
      success: true,
      isRecording: true,
      startedAt: activeRecorder.startedAt,
      url: location.href,
      eventCount: activeRecorder.eventCount,
    }
  }

  async function stopRecording(): Promise<RrwebRecorderResponse> {
    const recorder = activeRecorder
    if (!recorder) {
      await flushEvents({ final: true })
      return { success: true, isRecording: false, duration: 0, eventCount: 0, url: location.href }
    }

    activeRecorder = null
    if (recorder.flushTimer) {
      clearTimeout(recorder.flushTimer)
    }
    recorder.stopRecorder?.()
    await flushEvents({ final: true })

    return {
      success: true,
      isRecording: false,
      startedAt: recorder.startedAt,
      duration: Date.now() - recorder.startedAt,
      url: location.href,
      eventCount: recorder.eventCount,
    }
  }

  async function cancelRecording(): Promise<RrwebRecorderResponse> {
    const recorder = activeRecorder
    activeRecorder = null
    pendingEvents = []
    if (recorder?.flushTimer) {
      clearTimeout(recorder.flushTimer)
    }
    recorder?.stopRecorder?.()
    await chrome.runtime.sendMessage({ action: 'playwriterRrwebCancelled' })
    return { success: true, isRecording: false }
  }

  function recordingStatus(): RrwebRecorderResponse {
    if (!activeRecorder) {
      return { success: true, isRecording: false, url: location.href, eventCount: 0 }
    }
    return {
      success: true,
      isRecording: true,
      startedAt: activeRecorder.startedAt,
      url: location.href,
      eventCount: activeRecorder.eventCount,
    }
  }

  window.addEventListener('pagehide', () => {
    if (!activeRecorder || pendingEvents.length === 0) return
    flushEvents({ final: false }).catch(() => {})
  })

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!activeRecorder || event.source !== window || !isAnnotationMessage(event.data)) {
      return
    }
    try {
      const tag =
        event.data.type === 'recording-annotation-delete' ? 'playwriter.annotation.delete' : 'playwriter.annotation'
      record.addCustomEvent(tag, event.data.annotation)
    } catch (error: unknown) {
      console.warn('[Playwriter rrweb] annotation event failed', error)
    }
  })

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isRecorderMessage(message)) return false

    const run = async (): Promise<void> => {
      try {
        const response = await (async (): Promise<RrwebRecorderResponse> => {
          if (message.action === 'playwriterRrwebStart') {
            return await startRecording(message)
          }
          if (message.action === 'playwriterRrwebStop') {
            return await stopRecording()
          }
          if (message.action === 'playwriterRrwebCancel') {
            return await cancelRecording()
          }
          return recordingStatus()
        })()
        sendResponse(response)
      } catch (error: unknown) {
        sendResponse({ success: false, error: getErrorMessage(error), isRecording: Boolean(activeRecorder) })
      }
    }

    void run()
    return true
  })
}
