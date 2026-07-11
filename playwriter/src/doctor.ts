import { compareVersions, type ExtensionStatus } from './relay-client.js'

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail' | 'info'

export interface DoctorSession {
  id: string
  browser: string | null
  extensionId: string | null
  cwd: string | null
  connected?: boolean
  pageUrl?: string | null
  pagesCount?: number
}

export interface DoctorCheck {
  id: 'relay' | 'extension' | 'session' | 'capabilities'
  status: DoctorCheckStatus
  message: string
  detail?: string
}

export interface DoctorNextStep {
  title: string
  command?: string
  fallbackCommand?: string
}

export interface DoctorReport {
  ready: boolean
  version: string
  cwd: string
  checks: DoctorCheck[]
  next: DoctorNextStep
}

export function buildDoctorReport(options: {
  version: string
  cwd: string
  remote: boolean
  relayVersion: string | null
  relayError?: string | null
  extensions: ExtensionStatus[]
  sessions: DoctorSession[]
  capabilityCount: number
}): DoctorReport {
  const usableSessions = options.sessions.filter((session) => {
    if (session.connected === false) {
      return false
    }
    if (!session.extensionId) {
      return true
    }
    return options.extensions.some((extension) => {
      return (
        (extension.extensionId === session.extensionId || extension.stableKey === session.extensionId) &&
        extension.activeTargets > 0
      )
    })
  })
  const incompatibleExtension = options.extensions.find((extension) => {
    return extension.playwriterVersion && compareVersions(extension.playwriterVersion, options.version) > 0
  })
  const relayCheck: DoctorCheck = (() => {
    if (!options.relayVersion) {
      return {
        id: 'relay',
        status: 'fail',
        message: `${options.remote ? 'Remote' : 'Local'} relay is not reachable.`,
        detail:
          options.relayError ||
          (options.remote
            ? 'Check the relay host, token, and network path.'
            : 'Playwriter could not start or reach the relay. Read the relay log for the underlying error.'),
      }
    }
    if (compareVersions(options.relayVersion, options.version) < 0) {
      return {
        id: 'relay',
        status: 'warn',
        message: `Relay ${options.relayVersion} is older than CLI ${options.version}.`,
        detail: 'Restart Playwriter so the CLI can replace the older relay.',
      }
    }
    return {
      id: 'relay',
      status: 'pass',
      message: `Relay ${options.relayVersion} is reachable.`,
    }
  })()

  const extensionCheck: DoctorCheck = (() => {
    if (options.extensions.length === 0) {
      return {
        id: 'extension',
        status: usableSessions.length > 0 ? 'info' : 'fail',
        message: 'No Chrome extension connection was found.',
        detail:
          'User-Chrome workflows and replay recording require the extension; direct, headless, and cloud sessions do not.',
      }
    }

    if (incompatibleExtension?.playwriterVersion) {
      return {
        id: 'extension',
        status: 'fail',
        message: `The extension requires Playwriter ${incompatibleExtension.playwriterVersion}, but the CLI is ${options.version}.`,
        detail: 'Update the Playwriter CLI before using this extension build.',
      }
    }

    const activeTargets = options.extensions.reduce((total, extension) => {
      return total + extension.activeTargets
    }, 0)
    if (activeTargets === 0) {
      return {
        id: 'extension',
        status: 'warn',
        message: `${options.extensions.length} extension connection(s) found, but no tab is enabled.`,
        detail: 'Open the target tab and click the Playwriter extension icon until it turns green.',
      }
    }

    return {
      id: 'extension',
      status: 'pass',
      message: `${options.extensions.length} extension connection(s), ${activeTargets} enabled tab(s).`,
    }
  })()

  const sessionCheck: DoctorCheck =
    usableSessions.length > 0
      ? {
          id: 'session',
          status: 'pass',
          message: `${usableSessions.length} usable session(s).`,
          detail: `Healthy session: ${usableSessions[0]!.id}. Only reuse a session you created for this task.`,
        }
      : {
          id: 'session',
          status: 'warn',
          message:
            options.sessions.length > 0
              ? 'Session records exist, but none are currently usable.'
              : 'No active session exists yet.',
          detail:
            options.sessions.length > 0
              ? 'Reconnect or enable the matching browser before reusing a session.'
              : 'Create one before running Playwright code.',
        }

  const capabilityCheck: DoctorCheck =
    options.capabilityCount > 0
      ? {
          id: 'capabilities',
          status: 'pass',
          message: `${options.capabilityCount} saved ${options.capabilityCount === 1 ? 'capability is' : 'capabilities are'} discoverable from this directory.`,
        }
      : {
          id: 'capabilities',
          status: 'info',
          message: 'No saved capabilities are discoverable from this directory yet.',
          detail: 'This does not block browser control. Record or create a capability after the first successful task.',
        }

  const next: DoctorNextStep = (() => {
    if (!options.relayVersion) {
      return {
        title: options.remote
          ? 'Check the remote relay host, token, and network path, then run doctor again.'
          : 'Read the relay log, fix the startup error, then run doctor again.',
        ...(options.remote ? {} : { command: 'playwriter logfile' }),
      }
    }

    if (incompatibleExtension) {
      return {
        title: 'Update the Playwriter CLI before creating a session.',
        command: 'npm install -g playwriter@latest',
      }
    }

    const enabledExtension = options.extensions.find((extension) => {
      return extension.activeTargets > 0
    })
    if (enabledExtension) {
      return {
        title: 'Create a task-owned session for the enabled Chrome tab.',
        command: enabledExtension.stableKey
          ? `playwriter session new --browser ${enabledExtension.stableKey}`
          : 'playwriter session new',
      }
    }

    if (usableSessions.length > 0) {
      return {
        title: 'Create a task-owned headless session instead of reusing another agent session.',
        command: 'playwriter session new --browser headless',
      }
    }

    if (options.extensions.length > 0) {
      return {
        title: 'Open the target tab and click the Playwriter extension icon until it turns green.',
        fallbackCommand: 'playwriter session new --browser headless',
      }
    }

    return {
      title: 'Connect your Chrome extension, or start a standalone headless session.',
      command: 'playwriter session new --browser headless',
    }
  })()

  return {
    ready: relayCheck.status !== 'fail' && extensionCheck.status !== 'fail' && sessionCheck.status === 'pass',
    version: options.version,
    cwd: options.cwd,
    checks: [relayCheck, extensionCheck, sessionCheck, capabilityCheck],
    next,
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const symbols: Record<DoctorCheckStatus, string> = {
    pass: 'PASS',
    warn: 'WARN',
    fail: 'FAIL',
    info: 'INFO',
  }
  const checks = report.checks.flatMap((check) => {
    return [`[${symbols[check.status]}] ${check.message}`, ...(check.detail ? [`       ${check.detail}`] : [])]
  })
  return [
    `Playwriter doctor ${report.version}`,
    `Directory: ${report.cwd}`,
    '',
    ...checks,
    '',
    `Next: ${report.next.title}`,
    ...(report.next.command ? [`  ${report.next.command}`] : []),
    ...(report.next.fallbackCommand ? [`Fallback: ${report.next.fallbackCommand}`] : []),
  ].join('\n')
}
