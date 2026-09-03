import childProcess from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getInstalledWakaruCliPath } from './package-paths.js'
import { getTabwrightProjectDataDir } from './product-paths.js'

export type WakaruLevel = 'minimal' | 'standard' | 'aggressive'

export interface DecompileJavaScriptOptions {
  source: string
  sourceUrl?: string
  level?: WakaruLevel
  unpack?: boolean
  timeout?: number
  cwd?: string
}

export interface DecompileJavaScriptResult {
  sourceUrl?: string
  sha256: string
  level: WakaruLevel
  unpack: boolean
  root: string
  inputPath: string
  outputPath: string
  reportPath: string
  manifestPath: string
  files: string[]
  warnings: string[]
}

const MAX_SOURCE_BYTES = 50 * 1024 * 1024
const MAX_OUTPUT_BYTES = 200 * 1024 * 1024
const DEFAULT_TIMEOUT = 8_000
const MAX_TIMEOUT = 120_000

function runWakaru(options: { args: string[]; timeout: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      process.execPath,
      [getInstalledWakaruCliPath(), ...options.args],
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: options.timeout,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || 'Wakaru could not decompile the supplied JavaScript', { cause: error }))
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

function listArtifactFiles(options: { root: string; directory: string }): string[] {
  return fs.readdirSync(options.directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(options.directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Wakaru output must not contain symbolic links: ${entryPath}`)
    }
    const realPath = fs.realpathSync(entryPath)
    const root = fs.realpathSync(options.root)
    if (realPath !== root && !realPath.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Wakaru output escaped its artifact directory: ${entryPath}`)
    }
    if (entry.isDirectory()) {
      return listArtifactFiles({ root: options.root, directory: entryPath })
    }
    return [entryPath]
  })
}

export async function decompileJavaScript(options: DecompileJavaScriptOptions): Promise<DecompileJavaScriptResult> {
  if (!options.source.trim()) {
    throw new Error('JavaScript source must not be empty')
  }
  const sourceBytes = Buffer.byteLength(options.source)
  if (sourceBytes > MAX_SOURCE_BYTES) {
    throw new Error(`JavaScript source exceeds the ${MAX_SOURCE_BYTES} byte limit`)
  }

  const level = options.level || 'minimal'
  const unpack = options.unpack ?? true
  const timeout = Math.min(Math.max(options.timeout || DEFAULT_TIMEOUT, 1), MAX_TIMEOUT)
  const sha256 = crypto.createHash('sha256').update(options.source).digest('hex')
  const artifactsRoot = path.join(getTabwrightProjectDataDir({ cwd: options.cwd }), 'artifacts', 'wakaru')
  fs.mkdirSync(artifactsRoot, { recursive: true, mode: 0o700 })
  const root = fs.mkdtempSync(path.join(artifactsRoot, `${sha256.slice(0, 12)}-`))
  const inputPath = path.join(root, 'input.js')
  const outputPath = path.join(root, unpack ? 'output' : 'output.js')
  const reportPath = path.join(root, 'wakaru-report.json')
  const manifestPath = path.join(root, 'manifest.json')

  try {
    fs.writeFileSync(inputPath, options.source, { encoding: 'utf8', mode: 0o600 })
    const result = await runWakaru({
      args: [inputPath, ...(unpack ? ['--unpack'] : []), '--level', level, '--json', '-o', outputPath],
      timeout,
    })
    fs.writeFileSync(reportPath, result.stdout, { encoding: 'utf8', mode: 0o600 })

    const files = listArtifactFiles({ root, directory: root })
    const outputBytes = files.reduce((total, filePath) => total + fs.statSync(filePath).size, 0)
    if (outputBytes > MAX_OUTPUT_BYTES) {
      throw new Error(`Wakaru output exceeds the ${MAX_OUTPUT_BYTES} byte limit`)
    }
    const warnings = result.stderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => Boolean(line))
    const manifest = {
      sourceUrl: options.sourceUrl,
      sha256,
      sourceBytes,
      level,
      unpack,
      inputPath,
      outputPath,
      reportPath,
      files: files.map((filePath) => path.relative(root, filePath)),
      warnings,
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })

    return {
      sourceUrl: options.sourceUrl,
      sha256,
      level,
      unpack,
      root,
      inputPath,
      outputPath,
      reportPath,
      manifestPath,
      files: manifest.files,
      warnings,
    }
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true })
    throw error
  }
}
