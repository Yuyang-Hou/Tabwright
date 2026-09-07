import fs from 'node:fs'
import path from 'node:path'
import { getInstalledTabwrightPackageDir } from './package-paths.js'

export const documentationTopics = [
  {
    topic: 'browser',
    file: 'prompt.md',
    description: 'Browser context, evidence helpers, and actual execution limits',
  },
  { topic: 'network', file: 'network-api.md', description: 'Requests, failures, initiators, and response excerpts' },
  { topic: 'editor', file: 'editor-api.md', description: 'Search, read, save, and live-edit deployed source' },
  { topic: 'debugger', file: 'debugger-api.md', description: 'Breakpoints, call frames, scopes, and stepping' },
  { topic: 'styles', file: 'styles-api.md', description: 'Inspect CSS rules and styling provenance' },
  { topic: 'performance', file: 'performance-profiling.md', description: 'Investigate browser timing and CPU work' },
] as const

export function readDocumentation({
  topic,
  offset = 0,
  limit = 160,
  packageDir = getInstalledTabwrightPackageDir(),
}: {
  topic: string
  offset?: number
  limit?: number
  packageDir?: string
}): {
  topic: string
  content: string
  offset: number
  end: number
  totalLines: number
  truncated: boolean
  nextCommand?: string
} {
  const reference = documentationTopics.find((item) => {
    return item.topic === topic
  })
  if (!reference) {
    throw new Error(`Unknown documentation topic: ${topic}. Run 'tabwright docs' to list topics.`)
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Documentation offset must be a non-negative integer and limit must be between 1 and 500 lines')
  }
  const filePath = path.join(packageDir, 'dist', reference.file)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Bundled ${topic} reference is missing. Rebuild or reinstall this Tabwright package.`)
  }
  const lines = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n')
  const start = Math.min(offset, lines.length)
  const end = Math.min(start + limit, lines.length)
  return {
    topic,
    content: lines.slice(start, end).join('\n'),
    offset: start,
    end,
    totalLines: lines.length,
    truncated: start > 0 || end < lines.length,
    ...(end < lines.length ? { nextCommand: `tabwright docs ${topic} --offset ${end} --limit ${limit}` } : {}),
  }
}
