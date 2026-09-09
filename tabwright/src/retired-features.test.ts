import fs from 'node:fs'
import path from 'node:path'
import events from 'node:events'
import WebSocket from 'ws'
import { expect, test } from 'vitest'
import { startTabwrightCDPRelayServer } from './cdp-relay.js'
import { createCdpLogger } from './cdp-log.js'
import { EXTENSION_IDS } from './utils.js'

test('retires recording without disconnecting legacy extensions or reading old data', async () => {
  const root = path.resolve('tmp')
  fs.mkdirSync(root, { recursive: true })
  const dir = fs.mkdtempSync(path.join(root, 'retired-features-'))
  const cdpLogger = createCdpLogger({ logFilePath: path.join(dir, 'cdp.jsonl') })
  const server = await startTabwrightCDPRelayServer({ port: 19981, cdpLogger })
  const extension = new WebSocket('ws://127.0.0.1:19981/extension?browser=Chrome&protocolVersion=1', {
    headers: { Origin: 'chrome-extension://' + EXTENSION_IDS[0] },
  })
  try {
    await events.once(extension, 'open')
    extension.send(Buffer.from('legacy-private-recording-bytes'))
    extension.send(JSON.stringify({ method: 'rrwebRecordingData', params: { events: ['legacy-private-dom'] } }))
    const reply = events.once(extension, 'message')
    extension.send(
      JSON.stringify({ method: 'toolbarRecordingRequest', params: { requestId: 'legacy-1', action: 'toggle' } }),
    )
    const [message] = await reply
    expect(JSON.parse(String(message))).toMatchObject({
      method: 'toolbarRecordingResponse',
      params: { requestId: 'legacy-1', result: { success: false, isRecording: false } },
    })
    expect(extension.readyState).toBe(WebSocket.OPEN)
    for (const pathname of ['/activity/list', '/rrweb-recordings', '/capabilities', '/recording/start']) {
      const response = await fetch('http://127.0.0.1:19981' + pathname)
      expect(response.status).toBe(410)
    }
    const client = new WebSocket('ws://127.0.0.1:19981/cdp/compatibility-test')
    try {
      await events.once(client, 'open')
      const cdpReply = events.once(client, 'message')
      client.send(JSON.stringify({ id: 42, method: 'Browser.getVersion' }))
      const [response] = await cdpReply
      expect(JSON.parse(String(response))).toMatchObject({ id: 42, result: { protocolVersion: '1.3' } })
    } finally {
      client.close()
    }
    await cdpLogger.flush()
    expect(fs.readFileSync(cdpLogger.logFilePath, 'utf8')).not.toContain('legacy-private')
  } finally {
    extension.close()
    server.close()
    await cdpLogger.flush()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
