import fs from 'node:fs'
import path from 'node:path'
import { LOG_CDP_FILE_PATH } from './utils.js'

export type CdpLogEntry = {
  timestamp: string
  direction: 'from-playwright' | 'to-playwright' | 'from-extension' | 'to-extension'
  clientId?: string
  source?: 'extension' | 'server'
  message: unknown
}

export type CdpLogger = {
  log(entry: CdpLogEntry): void
  /** Wait for all pending writes (and any in-flight rotation) to complete */
  flush(): Promise<void>
  logFilePath: string
}

const DEFAULT_MAX_STRING_LENGTH = Number(
  process.env.TABWRIGHT_CDP_LOG_MAX_STRING_LENGTH || process.env.PLAYWRITER_CDP_LOG_MAX_STRING_LENGTH || 2000,
)

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  const truncatedCount = value.length - maxLength
  return `${value.slice(0, maxLength)}…[truncated ${truncatedCount} chars]`
}

function isCredentialField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return /^(cookies?|setcookie|authorization|proxyauthorization)$|(?:token|secret|password|passwd|apikey|credentials?)$/.test(normalized)
}

function createTruncatingReplacer({ maxStringLength }: { maxStringLength: number }) {
  const seen = new WeakSet<object>()
  return function (this: unknown, key: string, value: unknown): unknown {
    if (isCredentialField(key)) {
      return '[REDACTED]'
    }
    // CDP also represents headers as { name, value } pairs and raw header text.
    if (key === 'value' && typeof this === 'object' && this !== null) {
      const entry = this as { name?: unknown }
      if (typeof entry.name === 'string' && isCredentialField(entry.name)) {
        return '[REDACTED]'
      }
    }
    if (typeof value === 'string') {
      const redacted = key.toLowerCase().endsWith('headerstext')
        ? value.replace(/^([^:\r\n]+):[^\r\n]*/gm, (line: string, name: string) => {
            return isCredentialField(name) ? `${name}: [REDACTED]` : line
          })
        : value
      return truncateString(redacted, maxStringLength)
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }
    return value
  }
}

const DEFAULT_MAX_ENTRIES = 10_000

function resolvePositiveInt(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value < 2) {
    return fallback
  }
  return Math.floor(value)
}

export function createCdpLogger({
  logFilePath,
  maxStringLength,
  maxEntries,
}: { logFilePath?: string; maxStringLength?: number; maxEntries?: number } = {}): CdpLogger {
  const resolvedLogFilePath = logFilePath || LOG_CDP_FILE_PATH
  const logDir = path.dirname(resolvedLogFilePath)
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  fs.writeFileSync(resolvedLogFilePath, '')

  let queue: Promise<void> = Promise.resolve()
  let lineCount = 0
  const maxLength = maxStringLength ?? DEFAULT_MAX_STRING_LENGTH
  const envMaxEntries = Number(process.env.TABWRIGHT_CDP_LOG_MAX_ENTRIES || process.env.PLAYWRITER_CDP_LOG_MAX_ENTRIES)
  const resolvedMaxEntries = resolvePositiveInt(maxEntries, resolvePositiveInt(envMaxEntries, DEFAULT_MAX_ENTRIES))
  // Keep half the entries after rotation so we don't rotate on every write
  const keepAfterRotation = Math.floor(resolvedMaxEntries / 2)

  // Atomic rotation: write to temp file then rename to avoid corruption on crash
  const rotate = async (): Promise<void> => {
    try {
      const content = await fs.promises.readFile(resolvedLogFilePath, 'utf-8')
      const lines = content.split('\n').filter((l) => {
        return l.length > 0
      })
      const kept = lines.slice(-keepAfterRotation)
      const tmpPath = `${resolvedLogFilePath}.tmp`
      await fs.promises.writeFile(tmpPath, kept.join('\n') + '\n')
      await fs.promises.rename(tmpPath, resolvedLogFilePath)
      lineCount = kept.length
    } catch {
      // If rotation fails (disk error, permissions), keep logging without rotation.
      // lineCount stays high so rotation will be retried on next write.
    }
  }

  const log = (entry: CdpLogEntry): void => {
    const replacer = createTruncatingReplacer({ maxStringLength: maxLength })
    const line = JSON.stringify(entry, replacer)
    queue = queue.then(async () => {
      await fs.promises.appendFile(resolvedLogFilePath, `${line}\n`)
      lineCount++
      if (lineCount > resolvedMaxEntries) {
        await rotate()
      }
    })
  }

  return {
    log,
    flush: () => queue,
    logFilePath: resolvedLogFilePath,
  }
}
