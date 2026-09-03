import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getTabwrightProjectDataDir } from './product-paths.js'

export interface SavedJavaScriptArtifact {
  sha256: string
  bytes: number
  path: string
  cacheHit: boolean
}

const MAX_SOURCE_BYTES = 50 * 1024 * 1024

export function saveJavaScriptArtifact(options: { source: string; cwd?: string }): SavedJavaScriptArtifact {
  if (!options.source.trim()) {
    throw new Error('JavaScript source must not be empty')
  }

  const bytes = Buffer.byteLength(options.source)
  if (bytes > MAX_SOURCE_BYTES) {
    throw new Error(`JavaScript source exceeds the ${MAX_SOURCE_BYTES} byte limit`)
  }

  const sha256 = crypto.createHash('sha256').update(options.source).digest('hex')
  const directory = path.join(getTabwrightProjectDataDir({ cwd: options.cwd }), 'artifacts', 'web', 'blobs')
  const artifactPath = path.join(directory, `${sha256}.js`)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })

  if (fs.existsSync(artifactPath)) {
    const cachedSource = fs.readFileSync(artifactPath, 'utf8')
    if (cachedSource !== options.source) {
      throw new Error(`Cached JavaScript does not match its content hash: ${artifactPath}`)
    }
    return { sha256, bytes, path: artifactPath, cacheHit: true }
  }

  fs.writeFileSync(artifactPath, options.source, { encoding: 'utf8', mode: 0o600 })
  return { sha256, bytes, path: artifactPath, cacheHit: false }
}
