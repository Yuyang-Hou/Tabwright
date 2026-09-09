import { describe, expect, test } from 'vitest'
import type { Protocol } from 'devtools-protocol'
import { reduceNetworkEvent, sliceNetworkBody, type NetworkCaptureState } from './network-inspector.js'

function response({
  url = 'https://example.com/items',
  status = 200,
  headers = {},
}: {
  url?: string
  status?: number
  headers?: Record<string, string>
} = {}): Protocol.Network.Response {
  return {
    url,
    status,
    statusText: '',
    headers,
    mimeType: 'application/json',
    charset: 'utf-8',
    connectionReused: false,
    connectionId: 1,
    encodedDataLength: 42,
    securityState: 'secure',
  }
}

function request({
  id = 'cdp-1',
  url = 'https://example.com/items',
  timestamp = 1,
  redirectResponse,
  initiator,
}: {
  id?: string
  url?: string
  timestamp?: number
  redirectResponse?: Protocol.Network.Response
  initiator?: Protocol.Network.Initiator
} = {}): Protocol.Network.RequestWillBeSentEvent {
  return {
    requestId: id,
    loaderId: 'loader-1',
    documentURL: 'https://example.com',
    timestamp,
    wallTime: timestamp,
    redirectHasExtraInfo: false,
    redirectResponse,
    request: {
      url,
      method: 'GET',
      headers: { Authorization: 'Bearer secret', Cookie: 'session=secret', Accept: 'application/json' },
      postData: 'must not be retained',
      initialPriority: 'High',
      referrerPolicy: 'no-referrer',
    },
    initiator: initiator || { type: 'other' },
    type: 'Fetch',
  }
}

describe('network capture', () => {
  test('redacts known credentials in relative headers, fragments and encoded names without dropping URL context', () => {
    const params = request({
      url: 'https://example.com/callback#access_token=fragment-private&view=details',
      initiator: { type: 'parser', url: 'https://example.com/#/screen?auth_token=initiator-private&tab=2' },
    })
    params.request.headers = {
      Referer: '/previous?%61ccess_token=referer-private&tab=2#section',
    }
    const started = reduceNetworkEvent({
      state: { entries: [], nextId: 1 },
      maxEntries: 20,
      event: { method: 'Network.requestWillBeSent', params },
    })
    const received = reduceNetworkEvent({
      state: started,
      maxEntries: 20,
      event: {
        method: 'Network.responseReceived',
        params: {
          requestId: 'cdp-1',
          loaderId: 'loader-1',
          timestamp: 2,
          type: 'Fetch',
          hasExtraInfo: false,
          response: response({
            status: 302,
            headers: { Location: '/callback?access_token=location-private&view=list#section' },
          }),
        },
      },
    })
    const entry = received.entries[0]
    expect(entry.url).toBe('https://example.com/callback#access_token=[redacted]&view=details')
    expect(entry.initiator.url).toBe('https://example.com/#/screen?auth_token=[redacted]&tab=2')
    expect(entry.requestHeaders.Referer).toBe('/previous?%61ccess_token=[redacted]&tab=2#section')
    expect(entry.responseHeaders?.Location).toBe('/callback?access_token=[redacted]&view=list#section')
    expect(JSON.stringify(received)).not.toContain('-private')
  })

  test('keeps redirect hops distinct, redacts metadata, and records final response without body', () => {
    const initial: NetworkCaptureState = { entries: [], nextId: 1 }
    const first = reduceNetworkEvent({
      state: initial,
      maxEntries: 200,
      event: {
        method: 'Network.requestWillBeSent',
        params: request({
          url: 'https://example.com/start?token=private&view=list',
          initiator: {
            type: 'script',
            stack: {
              callFrames: [
                {
                  scriptId: '7',
                  url: 'https://example.com/app.js',
                  functionName: 'load',
                  lineNumber: 12,
                  columnNumber: 3,
                },
              ],
            },
          },
        }),
      },
    })
    const redirect = reduceNetworkEvent({
      state: first,
      maxEntries: 200,
      event: {
        method: 'Network.requestWillBeSent',
        params: request({
          timestamp: 2,
          redirectResponse: response({ status: 302, headers: { 'Set-Cookie': 'secret', 'X-Auth-Token': 'secret' } }),
        }),
      },
    })
    const received = reduceNetworkEvent({
      state: redirect,
      maxEntries: 200,
      event: {
        method: 'Network.responseReceived',
        params: {
          requestId: 'cdp-1',
          loaderId: 'loader-1',
          timestamp: 3,
          type: 'Fetch',
          hasExtraInfo: false,
          response: response({ status: 503, headers: { 'content-type': 'application/json', 'x-api-key': 'secret' } }),
        },
      },
    })
    const finished = reduceNetworkEvent({
      state: received,
      maxEntries: 200,
      event: {
        method: 'Network.loadingFinished',
        params: { requestId: 'cdp-1', timestamp: 4, encodedDataLength: 123 },
      },
    })
    expect(initial.entries).toEqual([])
    expect(first.entries[0].state).toBe('pending')
    expect(
      finished.entries.map((entry) => {
        return {
          requestId: entry.requestId,
          cdpRequestId: entry.cdpRequestId,
          state: entry.state,
          status: entry.status,
          redirectedFrom: entry.redirectedFrom,
          redirectedTo: entry.redirectedTo,
        }
      }),
    ).toEqual([
      {
        requestId: 'request-1',
        cdpRequestId: 'cdp-1',
        state: 'redirected',
        status: 302,
        redirectedFrom: undefined,
        redirectedTo: 'request-2',
      },
      {
        requestId: 'request-2',
        cdpRequestId: 'cdp-1',
        state: 'complete',
        status: 503,
        redirectedFrom: 'request-1',
        redirectedTo: undefined,
      },
    ])
    expect(JSON.stringify(finished)).not.toMatch(/Bearer secret|session=secret|must not be retained|private/)
    expect(finished.entries[0].requestHeaders).toEqual({
      Authorization: '[redacted]',
      Cookie: '[redacted]',
      Accept: 'application/json',
    })
    expect(finished.entries[0].responseHeaders).toEqual({ 'Set-Cookie': '[redacted]', 'X-Auth-Token': '[redacted]' })
    expect(finished.entries[0].initiator.callFrames[0]).toMatchObject({
      scriptId: '7',
      lineNumber: 12,
      columnNumber: 3,
    })
    expect(finished.entries[1]).toMatchObject({ durationMs: 2000, encodedDataLength: 123 })
  })

  test('bounds capture, ignores evicted traffic, and preserves CORS failures', () => {
    const state = ['cdp-1', 'cdp-2', 'cdp-3'].reduce<NetworkCaptureState>(
      (state, id) => {
        return reduceNetworkEvent({
          state,
          maxEntries: 2,
          event: { method: 'Network.requestWillBeSent', params: request({ id }) },
        })
      },
      { entries: [], nextId: 1 },
    )
    const orphan = reduceNetworkEvent({
      state,
      maxEntries: 2,
      event: {
        method: 'Network.loadingFinished',
        params: { requestId: 'cdp-1', timestamp: 2, encodedDataLength: 12 },
      },
    })
    const failed = reduceNetworkEvent({
      state: orphan,
      maxEntries: 2,
      event: {
        method: 'Network.loadingFailed',
        params: {
          requestId: 'cdp-3',
          timestamp: 2,
          type: 'Fetch',
          errorText: 'net::ERR_FAILED',
          corsErrorStatus: { corsError: 'MissingAllowOriginHeader', failedParameter: '' },
        },
      },
    })
    expect(orphan).toBe(state)
    expect(
      failed.entries.map((entry) => {
        return entry.requestId
      }),
    ).toEqual(['request-2', 'request-3'])
    expect(failed.entries[1]).toMatchObject({
      state: 'failed',
      durationMs: 1000,
      errorText: 'net::ERR_FAILED',
      corsErrorStatus: { corsError: 'MissingAllowOriginHeader' },
    })
  })

  test('caps retained metadata and flags truncated initiator stacks', () => {
    const callFrames: Protocol.Runtime.CallFrame[] = Array.from({ length: 15 }, () => {
      return { scriptId: '7', url: 'https://example.com/app.js', functionName: 'load', lineNumber: 1, columnNumber: 1 }
    })
    const params = request({ initiator: { type: 'script', stack: { callFrames, parent: { callFrames } } } })
    params.request.headers = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => {
        return [`header-${index}`, 'x'.repeat(3000)]
      }),
    )
    const state = reduceNetworkEvent({
      state: { entries: [], nextId: 1 },
      maxEntries: 200,
      event: { method: 'Network.requestWillBeSent', params },
    })
    expect(state.entries[0].initiator.callFrames).toHaveLength(20)
    expect(state.entries[0].initiator.stackTruncated).toBe(true)
    expect(Object.keys(state.entries[0].requestHeaders)).toHaveLength(64)
    expect(state.entries[0].requestHeaders['header-0']).toHaveLength(2049)
  })

  test('slices body in the original encoding with explicit continuation and validated bounds', () => {
    expect(
      sliceNetworkBody({ requestId: 'request-1', body: 'YWJjZGVm', base64Encoded: true, offset: 1, limit: 3 }),
    ).toEqual({
      requestId: 'request-1',
      available: true,
      body: 'WJj',
      base64Encoded: true,
      offset: 1,
      totalLength: 8,
      truncated: true,
      nextOffset: 4,
    })
    expect(sliceNetworkBody({ requestId: 'request-1', body: 'hello', base64Encoded: false })).toMatchObject({
      body: 'hello',
      truncated: false,
      totalLength: 5,
    })
    expect(sliceNetworkBody({ requestId: 'request-1', body: '', base64Encoded: false })).toMatchObject({
      body: '',
      truncated: false,
      totalLength: 0,
    })
    expect(() => {
      sliceNetworkBody({ requestId: 'request-1', body: '', base64Encoded: false, limit: 65537 })
    }).toThrow('limit')
    expect(() => {
      sliceNetworkBody({ requestId: 'request-1', body: '', base64Encoded: false, offset: -1 })
    }).toThrow('offset')
  })
})
