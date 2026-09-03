import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { saveJavaScriptArtifact } from './javascript-artifacts.js'
import { getInstalledWakaruCliPath, getInstalledWakaruVersion } from './package-paths.js'
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
  wakaruVersion: string
  cacheHit: boolean
  root: string
  inputPath: string
  outputPath: string
  reportPath: string
  manifestPath: string
  files: string[]
  warnings: string[]
}

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
  const level = options.level || 'minimal'
  const unpack = options.unpack ?? true
  const timeout = Math.min(Math.max(options.timeout || DEFAULT_TIMEOUT, 1), MAX_TIMEOUT)
  const sourceArtifact = saveJavaScriptArtifact({ source: options.source, cwd: options.cwd })
  const { sha256, bytes: sourceBytes, path: inputPath } = sourceArtifact
  const wakaruVersion = getInstalledWakaruVersion()
  const artifactsRoot = path.join(getTabwrightProjectDataDir({ cwd: options.cwd }), 'artifacts', 'wakaru')
  fs.mkdirSync(artifactsRoot, { recursive: true, mode: 0o700 })
  const cacheKey = `${sha256}-${wakaruVersion}-${level}-${unpack ? 'unpack' : 'single'}`
  const root = path.join(artifactsRoot, cacheKey)
  const outputPath = path.join(root, unpack ? 'output' : 'output.js')
  const reportPath = path.join(root, 'wakaru-report.json')
  const manifestPath = path.join(root, 'manifest.json')

  if (fs.existsSync(manifestPath) && fs.existsSync(outputPath) && fs.existsSync(reportPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { warnings?: unknown }
    const warnings = Array.isArray(manifest.warnings)
      ? manifest.warnings.filter((warning): warning is string => typeof warning === 'string')
      : []
    const files = listArtifactFiles({ root, directory: root })
      .map((filePath) => path.relative(root, filePath))
      .filter((filePath) => filePath !== 'manifest.json')
    return {
      sourceUrl: options.sourceUrl,
      sha256,
      level,
      unpack,
      wakaruVersion,
      cacheHit: true,
      root,
      inputPath,
      outputPath,
      reportPath,
      manifestPath,
      files,
      warnings,
    }
  }

  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })

  try {
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
      wakaruVersion,
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
      wakaruVersion,
      cacheHit: false,
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
