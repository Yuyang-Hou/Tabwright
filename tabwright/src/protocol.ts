import { CDPEventFor, ProtocolMapping } from './cdp-types.js'

export const VERSION = 1

export const EXTENSION_FEATURE = {
  heartbeat: 'heartbeat-v1',
  createInitialTab: 'create-initial-tab-v1',
  rrwebRecording: 'rrweb-recording-v1',
  toolbarRecording: 'toolbar-recording-v1',
  multiExtension: 'multi-extension-v1',
  activityObservation: 'activity-observation-v1',
} as const

export type ExtensionFeature = (typeof EXTENSION_FEATURE)[keyof typeof EXTENSION_FEATURE]

export const CURRENT_EXTENSION_FEATURES: ExtensionFeature[] = Object.values(EXTENSION_FEATURE)

export const RELAY_FEATURE = {
  extensionFeatureNegotiation: 'extension-feature-negotiation-v1',
  capabilityOptions: 'capability-options-v1',
  capabilityAuth: 'capability-auth-v1',
  capabilityAuthAutoTab: 'capability-auth-auto-tab-v1',
  rrwebRecording: 'rrweb-recording-v1',
  multiExtension: 'multi-extension-v1',
  activityObservation: 'activity-observation-v1',
} as const

export type RelayFeature = (typeof RELAY_FEATURE)[keyof typeof RELAY_FEATURE]

export const RELAY_FEATURES: RelayFeature[] = Object.values(RELAY_FEATURE)
export const RELAY_REVIEW_FEATURES: RelayFeature[] = [
  RELAY_FEATURE.capabilityOptions,
  RELAY_FEATURE.capabilityAuth,
  RELAY_FEATURE.capabilityAuthAutoTab,
  RELAY_FEATURE.rrwebRecording,
  RELAY_FEATURE.activityObservation,
]

export function supportsExtensionFeature(options: {
  features: readonly string[] | undefined
  feature: ExtensionFeature
}): boolean {
  return options.features?.includes(options.feature) || false
}

export function allowsExtensionFeature(options: {
  features: readonly string[] | undefined
  feature: ExtensionFeature
}): boolean {
  if (options.features === undefined) {
    return true
  }
  return supportsExtensionFeature(options)
}

export function parseExtensionFeatures(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined
  }
  return [
    ...new Set(
      value
        .split(',')
        .map((feature) => feature.trim())
        .filter((feature) => {
          return feature.length > 0
        }),
    ),
  ]
}

export function requiredExtensionFeatureForMethod(method: string): ExtensionFeature | undefined {
  if (method === 'createInitialTab') {
    return EXTENSION_FEATURE.createInitialTab
  }
  if (method === 'flushRrwebRecording') {
    return EXTENSION_FEATURE.activityObservation
  }
  if (
    method === 'startRrwebRecording' ||
    method === 'stopRrwebRecording' ||
    method === 'isRrwebRecording' ||
    method === 'cancelRrwebRecording'
  ) {
    return EXTENSION_FEATURE.rrwebRecording
  }
  return undefined
}

type ForwardCDPCommand = {
  [K in keyof ProtocolMapping.Commands]: {
    id: number
    method: 'forwardCDPCommand'
    params: {
      method: K
      sessionId?: string
      params?: ProtocolMapping.Commands[K]['paramsType'][0]
      source?: 'playwriter'
    }
  }
}[keyof ProtocolMapping.Commands]

export type ExtensionCommandMessage = ForwardCDPCommand

export type ExtensionResponseMessage = {
  id: number
  method?: undefined
  result?: any
  error?: string
}

/**
 * This produces a discriminated union for narrowing, similar to ForwardCDPCommand,
 * but for forwarded CDP events. Uses CDPEvent to maintain proper type extraction.
 */
export type ExtensionEventMessage = {
  [K in keyof ProtocolMapping.Events]: {
    id?: undefined
    method: 'forwardCDPEvent'
    params: {
      method: CDPEventFor<K>['method']
      sessionId?: string
      params?: CDPEventFor<K>['params']
    }
  }
}[keyof ProtocolMapping.Events]

export type ExtensionLogMessage = {
  id?: undefined
  method: 'log'
  params: {
    level: 'log' | 'debug' | 'info' | 'warn' | 'error'
    args: string[]
  }
}

export type ExtensionPongMessage = {
  id?: undefined
  method: 'pong'
}

export type ServerPingMessage = {
  method: 'ping'
  id?: undefined
}

export type RrwebEvent = Record<string, unknown>

export type RrwebRecordingDataMessage = {
  id?: undefined
  method: 'rrwebRecordingData'
  params: {
    tabId: number
    events: RrwebEvent[]
    final?: boolean
  }
}

export type RrwebRecordingCancelledMessage = {
  id?: undefined
  method: 'rrwebRecordingCancelled'
  params: {
    tabId: number
  }
}

export type ToolbarRecordingAction = 'status' | 'toggle'

export type ToolbarRecordingResult =
  | {
      success: true
      isRecording: boolean
      mode?: RrwebRecordingMode
      startedAt?: number
      tabId?: number
      id?: string
      path?: string
      duration?: number
      size?: number
      replayId?: string
      replayPath?: string
      replayDuration?: number
      replaySize?: number
      replayEventCount?: number
      warning?: string
    }
  | {
      success: false
      isRecording?: boolean
      error: string
    }

export type ToolbarRecordingRequestMessage = {
  id?: undefined
  method: 'toolbarRecordingRequest'
  params: {
    requestId: string
    action: ToolbarRecordingAction
    sessionId?: string
  }
}

export type ToolbarRecordingResponseMessage = {
  id?: undefined
  method: 'toolbarRecordingResponse'
  params: {
    requestId: string
    result: ToolbarRecordingResult
  }
}

export type ExtensionMessage =
  | ExtensionResponseMessage
  | ExtensionEventMessage
  | ExtensionLogMessage
  | ExtensionPongMessage
  | RrwebRecordingDataMessage
  | RrwebRecordingCancelledMessage
  | ToolbarRecordingRequestMessage

// rrweb DOM replay command messages (MCP -> Extension via relay)
export type StartRrwebRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to record. */
  sessionId?: string
  /** Milliseconds between full snapshot checkouts. Use 0 to disable periodic checkouts. */
  checkoutEveryNms?: number
  maskAllInputs?: boolean
  recordCanvas?: boolean
  inlineImages?: boolean
  collectFonts?: boolean
  mousemoveWait?: number
  /** Manual demonstrations stop after one save; activity recordings resume after an Agent checkpoint. */
  mode?: RrwebRecordingMode
  /** Relay-side rolling window for attached activity. The extension ignores this field. */
  maxDurationMs?: number
}

export type RrwebRecordingMode = 'manual' | 'activity'

/** HTTP body for /rrweb-recording/start endpoint */
export type StartRrwebRecordingBody = StartRrwebRecordingParams & {
  outputPath?: string
}

export type StopRrwebRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to stop recording. */
  sessionId?: string
}

export type IsRrwebRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to check. */
  sessionId?: string
}

export type CancelRrwebRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to cancel. */
  sessionId?: string
}

export type FlushRrwebRecordingParams = {
  /** CDP tab session ID (pw-tab-*) whose pending events should be flushed. */
  sessionId?: string
}

export type StartRrwebRecordingMessage = {
  id: number
  method: 'startRrwebRecording'
  params: StartRrwebRecordingParams
}

export type StopRrwebRecordingMessage = {
  id: number
  method: 'stopRrwebRecording'
  params: StopRrwebRecordingParams
}

export type IsRrwebRecordingMessage = {
  id: number
  method: 'isRrwebRecording'
  params: IsRrwebRecordingParams
}

export type CancelRrwebRecordingMessage = {
  id: number
  method: 'cancelRrwebRecording'
  params: CancelRrwebRecordingParams
}

export type FlushRrwebRecordingMessage = {
  id: number
  method: 'flushRrwebRecording'
  params: FlushRrwebRecordingParams
}

export type RrwebRecordingCommandMessage =
  | StartRrwebRecordingMessage
  | StopRrwebRecordingMessage
  | IsRrwebRecordingMessage
  | CancelRrwebRecordingMessage
  | FlushRrwebRecordingMessage

export type FlushRrwebRecordingResult =
  | {
      success: true
      tabId: number
      eventCount: number
    }
  | {
      success: false
      error: string
    }

export type StartRrwebRecordingResult =
  | {
      success: true
      tabId: number
      startedAt: number
      url?: string
    }
  | {
      success: false
      error: string
    }

/** Result from extension - doesn't include path/size since relay writes the file */
export type ExtensionStopRrwebRecordingResult =
  | {
      success: true
      tabId: number
      duration: number
    }
  | {
      success: false
      error: string
    }

/** Final result from relay - includes path/size after file is written */
export type StopRrwebRecordingResult =
  | {
      success: true
      id?: string
      tabId: number
      duration: number
      path: string
      size: number
      eventCount: number
    }
  | {
      success: false
      error: string
    }

export type IsRrwebRecordingResult = {
  isRecording: boolean
  tabId?: number
  startedAt?: number
  url?: string
}

export type CancelRrwebRecordingResult = {
  success: boolean
  error?: string
}

// Ghost Browser API command message (for Ghost Browser integration)
export type GhostBrowserCommandMessage = {
  id: number
  method: 'ghost-browser'
  params: {
    /** API namespace: 'ghostPublicAPI' | 'ghostProxies' | 'projects' */
    namespace: 'ghostPublicAPI' | 'ghostProxies' | 'projects'
    /** Method name within the namespace */
    method: string
    /** Arguments to pass to the method */
    args: unknown[]
  }
}

export type GhostBrowserCommandResult =
  | {
      success: true
      result: unknown
    }
  | {
      success: false
      error: string
    }
