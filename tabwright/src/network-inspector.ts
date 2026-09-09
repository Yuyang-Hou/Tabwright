import type { Protocol } from 'devtools-protocol'
import type { ICDPSession } from './cdp-session.js'
import { getCDPResources } from './cdp-resources.js'

export interface NetworkRequestSummary {
  /** Inspector-owned ID, unique for each redirect hop; use this with inspect/responseBody. */
  requestId: string
  cdpRequestId: string
  url: string
  method: string
  type?: Protocol.Network.ResourceType
  state: 'pending' | 'complete' | 'failed' | 'redirected'
  status?: number
  mimeType?: string
  durationMs?: number
  encodedDataLength?: number
  redirectedFrom?: string
  redirectedTo?: string
  errorText?: string
}

export interface NetworkRequestDetails extends NetworkRequestSummary {
  timestamp: number
  requestHeaders: Record<string, string>
  responseHeaders?: Record<string, string>
  fromDiskCache?: boolean
  fromServiceWorker?: boolean
  canceled?: boolean
  blockedReason?: Protocol.Network.BlockedReason
  corsErrorStatus?: Protocol.Network.CorsErrorStatus
  /** Locations use CDP's zero-based lineNumber/columnNumber. */
  initiator: {
    type: Protocol.Network.Initiator['type']
    url?: string
    lineNumber?: number
    columnNumber?: number
    callFrames: Protocol.Runtime.CallFrame[]
    stackTruncated: boolean
  }
}

export type NetworkResponseBody =
  | {
      requestId: string
      available: true
      body: string
      base64Encoded: boolean
      /** Offsets and lengths count characters in the returned encoding, not decoded bytes. */
      offset: number
      totalLength: number
      truncated: boolean
      nextOffset?: number
    }
  | { requestId: string; available: false; reason: string }

type NetworkEvent =
  | { method: 'Network.requestWillBeSent'; params: Protocol.Network.RequestWillBeSentEvent }
  | { method: 'Network.responseReceived'; params: Protocol.Network.ResponseReceivedEvent }
  | { method: 'Network.loadingFinished'; params: Protocol.Network.LoadingFinishedEvent }
  | { method: 'Network.loadingFailed'; params: Protocol.Network.LoadingFailedEvent }

export type NetworkCaptureState = { entries: NetworkRequestDetails[]; nextId: number }

const SENSITIVE_NAME = /cookie|auth|token|secret|api[-_]?key|session|csrf|xsrf|password/i

function boundedText(value: string): string {
  return value.length > 2048 ? `${value.slice(0, 2048)}…` : value
}

function safeUrl(value: string): string {
  // Redact parameters before URL parsing so relative Location and OAuth fragments are covered too.
  const redacted = value.replace(/([?#&])([^=&#?]+)=([^&#]*)/g, (match, separator: string, name: string) => {
    const decodedName = new URLSearchParams(`${name}=`).keys().next().value || name
    return SENSITIVE_NAME.test(decodedName) ? `${separator}${name}=[redacted]` : match
  })
  try {
    const url = new URL(redacted)
    if (url.username) {
      url.username = '[redacted]'
    }
    if (url.password) {
      url.password = '[redacted]'
    }
    return boundedText(url.toString())
  } catch {
    return boundedText(redacted)
  }
}

function safeHeaders(headers: Protocol.Network.Headers): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .slice(0, 64)
      .map(([key, value]) => {
        const safeValue = SENSITIVE_NAME.test(key)
          ? '[redacted]'
          : /^(location|referer)$/i.test(key)
            ? safeUrl(value)
            : boundedText(value)
        return [boundedText(key), safeValue]
      }),
  )
}

function initiatorDetails(initiator: Protocol.Network.Initiator): NetworkRequestDetails['initiator'] {
  const callFrames: Protocol.Runtime.CallFrame[] = []
  let stack = initiator.stack
  let stackTruncated = false
  let depth = 0
  while (stack && callFrames.length < 20 && depth < 20) {
    const remaining = 20 - callFrames.length
    callFrames.push(
      ...stack.callFrames.slice(0, remaining).map((frame) => {
        return {
          ...frame,
          scriptId: boundedText(frame.scriptId),
          functionName: boundedText(frame.functionName),
          url: safeUrl(frame.url),
        }
      }),
    )
    if (stack.callFrames.length > remaining || stack.parentId) {
      stackTruncated = true
      break
    }
    stack = stack.parent
    depth++
  }
  return {
    type: initiator.type,
    ...(initiator.url ? { url: safeUrl(initiator.url) } : {}),
    ...(initiator.lineNumber !== undefined ? { lineNumber: initiator.lineNumber } : {}),
    ...(initiator.columnNumber !== undefined ? { columnNumber: initiator.columnNumber } : {}),
    callFrames,
    stackTruncated: stackTruncated || Boolean(stack),
  }
}

function responseDetails(response: Protocol.Network.Response): Partial<NetworkRequestDetails> {
  return {
    status: response.status,
    mimeType: boundedText(response.mimeType),
    responseHeaders: safeHeaders(response.headers),
    fromDiskCache: response.fromDiskCache || false,
    fromServiceWorker: response.fromServiceWorker || false,
    encodedDataLength: response.encodedDataLength,
  }
}

/** Deterministic event reduction keeps redirect IDs and bounded capture independently testable. */
export function reduceNetworkEvent({
  state,
  event,
  maxEntries,
}: {
  state: NetworkCaptureState
  event: NetworkEvent
  maxEntries: number
}): NetworkCaptureState {
  // ponytail: linear scan of the bounded capture; index by CDP ID if large captures become necessary.
  const previous = state.entries.findLast((entry) => {
    return entry.cdpRequestId === event.params.requestId
  })
  if (event.method === 'Network.requestWillBeSent') {
    const { params } = event
    const requestId = `request-${state.nextId}`
    const redirect = params.redirectResponse && previous
    const entries = state.entries.map((entry) => {
      if (entry !== previous || !redirect || !params.redirectResponse) {
        return entry
      }
      return {
        ...entry,
        ...responseDetails(params.redirectResponse),
        state: 'redirected' as const,
        durationMs: Math.max(0, (params.timestamp - entry.timestamp) * 1000),
        redirectedTo: requestId,
      }
    })
    entries.push({
      requestId,
      cdpRequestId: params.requestId,
      url: safeUrl(params.request.url),
      method: boundedText(params.request.method),
      type: params.type,
      state: 'pending',
      timestamp: params.timestamp,
      requestHeaders: safeHeaders(params.request.headers),
      initiator: initiatorDetails(params.initiator),
      ...(redirect ? { redirectedFrom: previous.requestId } : {}),
    })
    return { entries: entries.slice(-maxEntries), nextId: state.nextId + 1 }
  }
  if (!previous || previous.state !== 'pending') {
    return state
  }
  const update: Partial<NetworkRequestDetails> = (() => {
    if (event.method === 'Network.responseReceived') {
      return responseDetails(event.params.response)
    }
    const durationMs = Math.max(0, (event.params.timestamp - previous.timestamp) * 1000)
    if (event.method === 'Network.loadingFinished') {
      return { state: 'complete', durationMs, encodedDataLength: event.params.encodedDataLength }
    }
    return {
      state: 'failed',
      durationMs,
      errorText: boundedText(event.params.errorText),
      canceled: event.params.canceled || false,
      blockedReason: event.params.blockedReason,
      corsErrorStatus: event.params.corsErrorStatus
        ? {
            ...event.params.corsErrorStatus,
            failedParameter: boundedText(event.params.corsErrorStatus.failedParameter),
          }
        : undefined,
    }
  })()
  return {
    ...state,
    entries: state.entries.map((entry) => {
      return entry === previous ? { ...entry, ...update } : entry
    }),
  }
}

function checkedInteger({
  value,
  name,
  minimum,
  maximum,
}: {
  value: number
  name: string
  minimum: number
  maximum: number
}): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

/** Body slices preserve CDP encoding; a base64 slice is not independently decodable. */
export function sliceNetworkBody({
  requestId,
  body,
  base64Encoded,
  offset = 0,
  limit = 8192,
}: {
  requestId: string
  body: string
  base64Encoded: boolean
  offset?: number
  limit?: number
}): NetworkResponseBody {
  checkedInteger({ value: offset, name: 'offset', minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  checkedInteger({ value: limit, name: 'limit', minimum: 1, maximum: 65536 })
  const start = Math.min(offset, body.length)
  const end = Math.min(start + limit, body.length)
  return {
    requestId,
    available: true,
    body: body.slice(start, end),
    base64Encoded,
    offset: start,
    totalLength: body.length,
    truncated: start > 0 || end < body.length,
    ...(end < body.length ? { nextOffset: end } : {}),
  }
}

/**
 * Opt-in, memory-bounded request metadata for one CDP target. No request/response bodies
 * are retained. Headers are a redacted, bounded CDP view, not a complete wire capture.
 * Enable before reproducing the request; existing traffic is not replayed.
 */
export class NetworkInspector {
  private cdp: ICDPSession
  private maxEntries: number
  private capture: NetworkCaptureState = { entries: [], nextId: 1 }
  private enabling: Promise<void> | null = null
  private disposed = false
  private onRequest = (params: Protocol.Network.RequestWillBeSentEvent) => {
    this.record({ method: 'Network.requestWillBeSent', params })
  }
  private onResponse = (params: Protocol.Network.ResponseReceivedEvent) => {
    this.record({ method: 'Network.responseReceived', params })
  }
  private onFinished = (params: Protocol.Network.LoadingFinishedEvent) => {
    this.record({ method: 'Network.loadingFinished', params })
  }
  private onFailed = (params: Protocol.Network.LoadingFailedEvent) => {
    this.record({ method: 'Network.loadingFailed', params })
  }

  constructor({ cdp, maxEntries = 200 }: { cdp: ICDPSession; maxEntries?: number }) {
    this.cdp = cdp
    this.maxEntries = checkedInteger({ value: maxEntries, name: 'maxEntries', minimum: 1, maximum: 1000 })
  }

  private record(event: NetworkEvent): void {
    this.capture = reduceNetworkEvent({ state: this.capture, event, maxEntries: this.maxEntries })
  }

  async enable(): Promise<void> {
    if (this.disposed) {
      throw new Error('NetworkInspector is disposed; create a new inspector')
    }
    if (!this.enabling) {
      getCDPResources(this.cdp)
      this.cdp.on('Network.requestWillBeSent', this.onRequest)
      this.cdp.on('Network.responseReceived', this.onResponse)
      this.cdp.on('Network.loadingFinished', this.onFinished)
      this.cdp.on('Network.loadingFailed', this.onFailed)
      this.enabling = Promise.resolve().then(async () => {
        try {
          // CDP requires Debugger for initiator stacks; never reset shared domains.
          await this.cdp.send('Runtime.enable')
          await this.cdp.send('Debugger.enable')
          if (this.disposed) {
            return
          }
          await this.cdp.send('Network.enable')
        } catch (error) {
          this.removeListeners()
          this.enabling = null
          throw new Error('Could not enable NetworkInspector', { cause: error })
        }
      })
    }
    await this.enabling
    if (this.disposed) {
      throw new Error('NetworkInspector was disposed while enabling')
    }
  }

  list({
    search,
    method,
    status,
    limit = 50,
  }: {
    search?: string
    method?: string
    status?: number | 'failed'
    limit?: number
  } = {}): NetworkRequestSummary[] {
    checkedInteger({ value: limit, name: 'limit', minimum: 1, maximum: 1000 })
    return this.capture.entries
      .filter((entry) => {
        return (
          (!search || entry.url.toLowerCase().includes(search.toLowerCase())) &&
          (!method || entry.method.toUpperCase() === method.toUpperCase()) &&
          (status === undefined ||
            (status === 'failed' ? entry.state === 'failed' || (entry.status || 0) >= 400 : entry.status === status))
        )
      })
      .slice(-limit)
      .reverse()
      .map((entry) => {
        const {
          timestamp,
          requestHeaders,
          responseHeaders,
          initiator,
          fromDiskCache,
          fromServiceWorker,
          canceled,
          blockedReason,
          corsErrorStatus,
          ...summary
        } = entry
        return summary
      })
  }

  inspect({ requestId }: { requestId: string }): NetworkRequestDetails | null {
    const entry = this.capture.entries.find((entry) => {
      return entry.requestId === requestId
    })
    return entry ? structuredClone(entry) : null
  }

  async responseBody({
    requestId,
    offset = 0,
    limit = 8192,
  }: {
    requestId: string
    offset?: number
    limit?: number
  }): Promise<NetworkResponseBody> {
    checkedInteger({ value: offset, name: 'offset', minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
    checkedInteger({ value: limit, name: 'limit', minimum: 1, maximum: 65536 })
    const entry = this.capture.entries.find((entry) => {
      return entry.requestId === requestId
    })
    const unavailable = (reason: string): NetworkResponseBody => {
      return { requestId, available: false, reason }
    }
    if (!entry) {
      return unavailable('Request was not captured or has been cleared/evicted')
    }
    if (entry.state !== 'complete') {
      return unavailable(`Response body is unavailable while request state is ${entry.state}`)
    }
    const isCurrent = () => {
      return (
        this.capture.entries.findLast((item) => {
          return item.cdpRequestId === entry.cdpRequestId
        })?.requestId === requestId
      )
    }
    if (!isCurrent()) {
      return unavailable('CDP request ID was reused; the historical body cannot be read safely')
    }
    try {
      // ponytail: CDP transfers the complete body; slice output without retaining it.
      // Streaming/artifact transport is needed if full-body transfer becomes too expensive.
      const response = await this.cdp.send('Network.getResponseBody', { requestId: entry.cdpRequestId })
      if (!isCurrent()) {
        return unavailable('Capture changed while reading the body; retry with a current request ID')
      }
      return sliceNetworkBody({ requestId, ...response, offset, limit })
    } catch {
      return unavailable('CDP could not provide the body; it may have been evicted or the target disconnected')
    }
  }

  clear(): void {
    this.capture = { entries: [], nextId: this.capture.nextId }
  }

  private removeListeners(): void {
    this.cdp.off('Network.requestWillBeSent', this.onRequest)
    this.cdp.off('Network.responseReceived', this.onResponse)
    this.cdp.off('Network.loadingFinished', this.onFinished)
    this.cdp.off('Network.loadingFailed', this.onFailed)
  }

  /** Remove only this inspector's listeners; other consumers own the shared CDP domains. */
  dispose(): void {
    this.disposed = true
    this.removeListeners()
    this.clear()
  }
}
