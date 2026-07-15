const REPLAYER_CONSOLE_PREFIX = '[replayer]'
const MISSING_NODE_WARNING = /^Node with id '-?\d+' not found\.\s*$/

export interface ReplayLogger {
  log: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

export interface ReplayLoggerController {
  logger: ReplayLogger
  dispose: () => void
}

export function isMissingReplayNodeWarning(args: readonly unknown[]): boolean {
  return (
    args[0] === REPLAYER_CONSOLE_PREFIX &&
    typeof args[1] === 'string' &&
    MISSING_NODE_WARNING.test(args[1])
  )
}

function missingReplayNodeWarningKey(args: readonly unknown[]): string {
  const message = typeof args[1] === 'string' ? args[1].trim() : ''
  const detail = args[2]
  if (detail === undefined) {
    return message
  }
  try {
    return `${message}:${JSON.stringify(detail)}`
  } catch {
    return message
  }
}

export function createReplayLogger(options: {
  logger: ReplayLogger
  onMissingNodeWarning: () => void
}): ReplayLoggerController {
  let disposed = false
  const seenMissingNodeWarnings: Set<string> = new Set()
  return {
    logger: {
      log: (...args: unknown[]) => {
        if (!disposed) {
          options.logger.log(...args)
        }
      },
      warn: (...args: unknown[]) => {
        if (disposed) {
          return
        }
        if (isMissingReplayNodeWarning(args)) {
          const key = missingReplayNodeWarningKey(args)
          if (!seenMissingNodeWarnings.has(key)) {
            seenMissingNodeWarnings.add(key)
            options.onMissingNodeWarning()
          }
          return
        }
        options.logger.warn(...args)
      },
    },
    dispose: () => {
      disposed = true
      seenMissingNodeWarnings.clear()
    },
  }
}
