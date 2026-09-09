import { CDPEventFor, ProtocolMapping } from './cdp-types.js'

export const VERSION = 1

export const EXTENSION_FEATURE = {
  heartbeat: 'heartbeat-v1',
  createInitialTab: 'create-initial-tab-v1',
  multiExtension: 'multi-extension-v1',
} as const

export type ExtensionFeature = (typeof EXTENSION_FEATURE)[keyof typeof EXTENSION_FEATURE]

export const CURRENT_EXTENSION_FEATURES: ExtensionFeature[] = Object.values(EXTENSION_FEATURE)

export const RELAY_FEATURE = {
  extensionFeatureNegotiation: 'extension-feature-negotiation-v1',
  multiExtension: 'multi-extension-v1',
} as const

export type RelayFeature = (typeof RELAY_FEATURE)[keyof typeof RELAY_FEATURE]

export const RELAY_FEATURES: RelayFeature[] = Object.values(RELAY_FEATURE)
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

// Legacy messages are accepted only to discard data or return a retirement reply.
export type ToolbarRecordingRequestMessage = {
  id?: undefined
  method: 'toolbarRecordingRequest'
  params: { requestId: string; action: 'status' | 'toggle'; sessionId?: string }
}

type RetiredRecordingEvent = {
  id?: undefined
  method: 'rrwebRecordingData' | 'rrwebRecordingCancelled'
  params: unknown
}

export type ExtensionMessage =
  | ExtensionResponseMessage
  | ExtensionEventMessage
  | ExtensionLogMessage
  | ExtensionPongMessage
  | RetiredRecordingEvent
  | ToolbarRecordingRequestMessage

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
