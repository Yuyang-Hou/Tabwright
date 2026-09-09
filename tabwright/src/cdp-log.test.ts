import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createCdpLogger, type CdpLogEntry } from './cdp-log.js'

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-log-test-'))
}

function makeEntry(i: number): CdpLogEntry {
  return {
    timestamp: new Date().toISOString(),
    direction: 'from-extension',
    message: { method: `Test.method${i}`, id: i },
  }
}

function readIds(logFile: string): number[] {
  return fs
    .readFileSync(logFile, 'utf-8')
    .trim()
    .split('\n')
    .filter((l) => {
      return l.length > 0
    })
    .map((l) => {
      return JSON.parse(l).message.id as number
    })
}

describe('CDP log rotation', () => {
  it('redacts credential fields and cookie responses before truncating, without changing source data', async () => {
    const tmpDir = makeTmpDir()
    const logFile = path.join(tmpDir, 'cdp.jsonl')
    const logger = createCdpLogger({ logFilePath: logFile, maxStringLength: 200 })
    const message = {
      id: 1,
      result: { cookies: [{ name: 'session', value: 'cookie-secret', domain: 'example.com' }] },
      params: {
        request: {
          url: 'https://example.com/api',
          method: 'POST',
          headers: { Cookie: 'cookie-header-secret', Authorization: 'Bearer auth-secret', 'Content-Type': 'application/json' },
          headersText: 'HTTP/1.1 200 OK\r\nSet-Cookie: raw-cookie-secret\r\nX-Api-Key: raw-key-secret\r\nContent-Type: application/json',
        },
        headers: [{ name: 'Proxy-Authorization', value: 'proxy-secret' }, { name: 'Accept', value: 'application/json' }],
        payload: { access_token: 'token-secret', clientSecret: 'client-secret', password: 'password-secret', message: 'x'.repeat(250) },
      },
    }
    try {
      logger.log({ ...makeEntry(1), message })
      await logger.flush()
      const text = fs.readFileSync(logFile, 'utf-8')
      expect(text).not.toContain('secret')
      expect(text).toContain('[REDACTED]')
      expect(text).toContain('https://example.com/api')
      expect(text).toContain('application/json')
      expect(text).toContain('[truncated 50 chars]')
      expect(message.result.cookies[0]?.value).toBe('cookie-secret')
      expect(message.params.request.headers.Authorization).toBe('Bearer auth-secret')
    } finally {
      fs.rmSync(tmpDir, { recursive: true })
    }
  })

  it('rotates when lineCount exceeds maxEntries, keeping last half', async () => {
    const tmpDir = makeTmpDir()
    const logFile = path.join(tmpDir, 'cdp.jsonl')
    const logger = createCdpLogger({ logFilePath: logFile, maxEntries: 20 })

    // Write 25 entries to trigger rotation (threshold is 20)
    for (let i = 0; i < 25; i++) {
      logger.log(makeEntry(i))
    }
    await logger.flush()

    const ids = readIds(logFile)

    // Rotation triggers after entry 20 is written (lineCount becomes 21 > 20).
    // It keeps last 10 (entries 11-20), then entries 21-24 are appended.
    expect(ids).toMatchInlineSnapshot(`
      [
        11,
        12,
        13,
        14,
        15,
        16,
        17,
        18,
        19,
        20,
        21,
        22,
        23,
        24,
      ]
    `)

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('does not rotate when under maxEntries', async () => {
    const tmpDir = makeTmpDir()
    const logFile = path.join(tmpDir, 'cdp.jsonl')
    const logger = createCdpLogger({ logFilePath: logFile, maxEntries: 50 })

    for (let i = 0; i < 30; i++) {
      logger.log(makeEntry(i))
    }
    await logger.flush()

    const ids = readIds(logFile)
    expect(ids.length).toBe(30)
    expect(ids[0]).toBe(0)
    expect(ids[29]).toBe(29)

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('handles multiple rotations', async () => {
    const tmpDir = makeTmpDir()
    const logFile = path.join(tmpDir, 'cdp.jsonl')
    const logger = createCdpLogger({ logFilePath: logFile, maxEntries: 10 })

    // Write 35 entries, should trigger multiple rotations
    for (let i = 0; i < 35; i++) {
      logger.log(makeEntry(i))
    }
    await logger.flush()

    const ids = readIds(logFile)

    // File should never exceed maxEntries
    expect(ids.length).toBeLessThanOrEqual(15)
    expect(ids.length).toBeGreaterThanOrEqual(5)

    // Last entry should always be the most recent
    expect(ids[ids.length - 1]).toBe(34)
    // No entries from the very beginning should survive multiple rotations
    expect(ids[0]).toBeGreaterThan(10)

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('uses atomic rename for rotation', async () => {
    const tmpDir = makeTmpDir()
    const logFile = path.join(tmpDir, 'cdp.jsonl')
    const logger = createCdpLogger({ logFilePath: logFile, maxEntries: 10 })

    for (let i = 0; i < 15; i++) {
      logger.log(makeEntry(i))
    }
    await logger.flush()

    // Temp file should not remain after successful rotation
    expect(fs.existsSync(`${logFile}.tmp`)).toBe(false)

    const ids = readIds(logFile)
    expect(ids[ids.length - 1]).toBe(14)

    fs.rmSync(tmpDir, { recursive: true })
  })
})
