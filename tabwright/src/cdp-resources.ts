import type { ICDPSession } from './cdp-session.js'
import type { ScriptInfo } from './debugger.js'

export interface ScriptRecord extends ScriptInfo {
  executionContextId: number
  sourceMapURL?: string
}

interface StyleSheetRecord {
  styleSheetId: string
  url: string
}

export interface CDPResources {
  scripts: Map<string, ScriptRecord>
  stylesheets: Map<string, StyleSheetRecord>
  revision: number
}

const resourcesBySession = new WeakMap<ICDPSession, CDPResources>()

/** Metadata only: repeated CDP enable calls do not replay existing resources. */
export function getCDPResources(cdp: ICDPSession): CDPResources {
  const existing = resourcesBySession.get(cdp)
  if (existing) {
    return existing
  }
  const resources: CDPResources = {
    scripts: new Map<string, ScriptRecord>(),
    stylesheets: new Map<string, StyleSheetRecord>(),
    revision: 0,
  }
  resourcesBySession.set(cdp, resources)
  cdp.on('Debugger.scriptParsed', (params) => {
    if (params.url.startsWith('chrome') || params.url.startsWith('devtools')) {
      return
    }
    resources.scripts.set(params.scriptId, {
      scriptId: params.scriptId,
      url: params.url || `inline://${params.scriptId}`,
      executionContextId: params.executionContextId,
      sourceMapURL: params.sourceMapURL || undefined,
    })
    resources.revision += 1
  })
  cdp.on('CSS.styleSheetAdded', ({ header }) => {
    if (header.sourceURL?.startsWith('chrome') || header.sourceURL?.startsWith('devtools')) {
      return
    }
    resources.stylesheets.set(header.styleSheetId, {
      styleSheetId: header.styleSheetId,
      url: header.sourceURL || `inline-css://${header.styleSheetId}`,
    })
    resources.revision += 1
  })
  cdp.on('CSS.styleSheetRemoved', ({ styleSheetId }) => {
    resources.stylesheets.delete(styleSheetId)
    resources.revision += 1
  })
  cdp.on('CSS.styleSheetChanged', () => {
    resources.revision += 1
  })
  cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => {
    Array.from(resources.scripts.values())
      .filter((script) => {
        return script.executionContextId === executionContextId
      })
      .map((script) => {
        return resources.scripts.delete(script.scriptId)
      })
    resources.revision += 1
  })
  cdp.on('Runtime.executionContextsCleared', () => {
    // Navigation can replace stylesheets without emitting styleSheetRemoved.
    resources.scripts.clear()
    resources.stylesheets.clear()
    resources.revision += 1
  })
  return resources
}
