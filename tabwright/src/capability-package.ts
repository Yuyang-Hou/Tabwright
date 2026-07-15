import crypto from 'node:crypto'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import zlib from 'node:zlib'
import * as tar from 'tar-stream'
import { z } from 'zod'
import {
  getCapabilityDir,
  parseCapabilityManifest,
  readCapability,
  requireCapability,
  type CapabilityLocation,
  type CapabilityManifest,
  type CapabilityRecord,
} from './capability-registry.js'
import { removeCapabilityAuthFiles } from './capability-auth-state.js'

const PACKAGE_METADATA_PATH = 'tabwright-package.json'
const LEGACY_PACKAGE_METADATA_PATH = 'playwriter-package.json'
const PACKAGE_ROOT = 'package'
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 20 * 1024 * 1024
const MAX_PACKAGE_FILES = 100

const CapabilityPackageMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  capabilityId: z.string(),
  packedAt: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      sha256: z.string(),
    }),
  ),
})

interface CapabilityPackageFile {
  path: string
  content: Buffer
}

interface GitCapabilitySource {
  remote: string
  ref: string
  capabilityPath: string
}

export interface PackedCapability {
  capabilityId: string
  path: string
  files: string[]
  integrity: string
}

export interface InstalledCapabilityPackage {
  source: string
  capability: CapabilityRecord
  files: string[]
  integrity: string
  agentSkillAvailable: boolean
}

export async function packCapability(options: {
  id: string
  cwd?: string
  output?: string
  overwrite?: boolean
}): Promise<PackedCapability> {
  const capability = requireCapability({ id: options.id, cwd: options.cwd })
  const files = readCapabilityPackageFiles({
    sourceDir: capability.dir,
    manifest: {
      ...capability.manifest,
      status: 'draft',
    },
  })
  const metadata = buildPackageMetadata({ capabilityId: capability.manifest.id, files })
  const archiveFiles: CapabilityPackageFile[] = [
    ...files,
    {
      path: PACKAGE_METADATA_PATH,
      content: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`),
    },
  ]
  const outputPath = path.resolve(options.cwd || process.cwd(), options.output || `${capability.manifest.id}.tgz`)
  if (fs.existsSync(outputPath) && !options.overwrite) {
    throw new Error(`Capability package already exists: ${outputPath}. Use --force to overwrite it.`)
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.partial-${process.pid}`

  try {
    await writeArchive({ outputPath: temporaryPath, files: archiveFiles })
    if (options.overwrite) {
      fs.rmSync(outputPath, { force: true })
    }
    fs.renameSync(temporaryPath, outputPath)
  } catch (error) {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true })
    }
    throw new Error(`Failed to pack capability ${capability.manifest.id}`, { cause: error })
  }

  return {
    capabilityId: capability.manifest.id,
    path: outputPath,
    files: files.map((file) => {
      return file.path
    }),
    integrity: fileIntegrity(outputPath),
  }
}

export async function installCapabilityPackage(options: {
  source: string
  cwd?: string
  location?: CapabilityLocation
  overwrite?: boolean
}): Promise<InstalledCapabilityPackage> {
  const cwd = options.cwd || process.cwd()
  const source = await readPackageSource({ source: options.source, cwd })
  const manifestFile = requirePackageFile({ files: source.files, filePath: 'capability.json' })
  const manifest = parsePackageManifest(manifestFile.content)
  validatePackageMetadata({ files: source.files, metadataFile: source.metadataFile, manifest })
  const files = normalizeInstallFiles({ files: source.files, manifest })

  const location = options.location || 'user'
  const capabilityDir = getCapabilityDir({ id: manifest.id, location, cwd })
  if (fs.existsSync(capabilityDir) && !options.overwrite) {
    throw new Error(`Capability already exists: ${manifest.id}. Use --force to overwrite package files.`)
  }
  if (options.overwrite) {
    fs.rmSync(path.join(capabilityDir, 'agent-skills'), { recursive: true, force: true })
    removeCapabilityAuthFiles({ capabilityDir })
  }
  fs.mkdirSync(capabilityDir, { recursive: true })
  files.map((file) => {
    const destination = resolvePackageDestination({ capabilityDir, filePath: file.path })
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, file.content)
    return destination
  })

  const capability = readCapability({ dir: capabilityDir, location })
  return {
    source: source.label,
    capability,
    files: files.map((file) => {
      return file.path
    }),
    integrity: source.integrity,
    agentSkillAvailable: fs.existsSync(path.join(capabilityDir, 'agent-skills', 'codex', 'SKILL.md')),
  }
}

function readCapabilityPackageFiles(options: {
  sourceDir: string
  manifest: CapabilityManifest
}): CapabilityPackageFile[] {
  const entryPath = normalizeRelativePath(options.manifest.entry)
  const requiredPaths = ['capability.json', entryPath]
  const missing = requiredPaths.filter((filePath) => {
    return !fs.existsSync(path.join(options.sourceDir, ...filePath.split('/')))
  })
  if (missing.length > 0) {
    throw new Error(`Capability package is missing required files: ${missing.join(', ')}`)
  }
  const optionalPaths = ['README.md'].filter((filePath) => {
    return fs.existsSync(path.join(options.sourceDir, filePath))
  })
  const agentSkillDir = path.join(options.sourceDir, 'agent-skills')
  const agentSkillPaths = fs.existsSync(agentSkillDir)
    ? listRegularFiles({ dir: agentSkillDir }).map((filePath) => {
        return path.posix.join('agent-skills', filePath)
      })
    : []
  const packagePaths = [...new Set([...requiredPaths, ...optionalPaths, ...agentSkillPaths])].sort()
  assertPackageLimits({ paths: packagePaths })

  const files = packagePaths.map((filePath) => {
    if (filePath === 'capability.json') {
      return {
        path: filePath,
        content: Buffer.from(`${JSON.stringify(options.manifest, null, 2)}\n`),
      }
    }
    const sourcePath = resolvePackageDestination({ capabilityDir: options.sourceDir, filePath })
    const sourceStat = fs.lstatSync(sourcePath)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Capability packages can only contain regular files: ${filePath}`)
    }
    return { path: filePath, content: fs.readFileSync(sourcePath) }
  })
  assertExtractedSize(files)
  return files
}

function listRegularFiles(options: { dir: string; prefix?: string }): string[] {
  return fs.readdirSync(options.dir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(options.prefix || '', entry.name)
    const absolutePath = path.join(options.dir, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Capability packages cannot contain symbolic links: ${relativePath}`)
    }
    if (entry.isDirectory()) {
      return listRegularFiles({ dir: absolutePath, prefix: relativePath })
    }
    if (!entry.isFile()) {
      throw new Error(`Capability packages can only contain regular files: ${relativePath}`)
    }
    return [relativePath]
  })
}

function buildPackageMetadata(options: {
  capabilityId: string
  files: CapabilityPackageFile[]
}): z.infer<typeof CapabilityPackageMetadataSchema> {
  return {
    schemaVersion: 1,
    capabilityId: options.capabilityId,
    packedAt: new Date().toISOString(),
    files: options.files.map((file) => {
      return { path: file.path, sha256: bufferSha256(file.content) }
    }),
  }
}

async function writeArchive(options: { outputPath: string; files: CapabilityPackageFile[] }): Promise<void> {
  const archive = tar.pack()
  const output = pipeline(archive, zlib.createGzip({ level: 9 }), fs.createWriteStream(options.outputPath))
  await Promise.all(
    options.files.map((file) => {
      return new Promise<void>((resolve, reject) => {
        archive.entry(
          {
            name: path.posix.join(PACKAGE_ROOT, file.path),
            size: file.content.length,
            mode: 0o644,
            mtime: new Date(0),
            type: 'file',
          },
          file.content,
          (error) => {
            if (error) {
              reject(error)
              return
            }
            resolve()
          },
        )
      })
    }),
  )
  archive.finalize()
  await output
}

async function readPackageSource(options: { source: string; cwd: string }): Promise<{
  label: string
  files: CapabilityPackageFile[]
  metadataFile?: CapabilityPackageFile
  integrity: string
}> {
  const localPath = path.resolve(options.cwd, options.source)
  if (fs.existsSync(localPath)) {
    if (fs.statSync(localPath).isDirectory()) {
      const manifestPath = path.join(localPath, 'capability.json')
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`Capability directory is missing capability.json: ${localPath}`)
      }
      const manifest = parsePackageManifest(fs.readFileSync(manifestPath))
      const files = readCapabilityPackageFiles({ sourceDir: localPath, manifest: { ...manifest, status: 'draft' } })
      return {
        label: localPath,
        files,
        integrity: filesIntegrity(files),
      }
    }
    const archive = fs.readFileSync(localPath)
    assertArchiveSize({ size: archive.length, label: localPath })
    const extracted = await readArchive(archive)
    return {
      label: localPath,
      files: extracted.files,
      metadataFile: extracted.metadataFile,
      integrity: bufferIntegrity(archive),
    }
  }

  const gitSource = parseGitCapabilitySource(options.source)
  if (gitSource) {
    return readGitCapabilitySource({ source: options.source, gitSource })
  }

  if (!/^https?:\/\//.test(options.source)) {
    throw new Error(`Capability source not found: ${options.source}`)
  }
  const response = await fetch(options.source, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Failed to download capability package: ${response.status} ${response.statusText}`)
  }
  const contentLength = Number(response.headers.get('content-length') || 0)
  assertArchiveSize({ size: contentLength, label: options.source })
  const archive = Buffer.from(await response.arrayBuffer())
  assertArchiveSize({ size: archive.length, label: options.source })
  const extracted = await readArchive(archive)
  return {
    label: options.source,
    files: extracted.files,
    metadataFile: extracted.metadataFile,
    integrity: bufferIntegrity(archive),
  }
}

function parseGitCapabilitySource(source: string): GitCapabilitySource | null {
  const fragmentIndex = source.indexOf('#')
  if (fragmentIndex <= 0) {
    return null
  }
  const remote = source.slice(0, fragmentIndex)
  const isSupportedRemote =
    /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:.+/.test(remote) || remote.startsWith('ssh://') || remote.startsWith('file://')
  if (!isSupportedRemote) {
    return null
  }
  const selector = source.slice(fragmentIndex + 1)
  const pathSeparatorIndex = selector.indexOf(':')
  if (pathSeparatorIndex <= 0 || pathSeparatorIndex === selector.length - 1) {
    throw new Error('Git capability source must use <remote>#<ref>:<capability-path>')
  }
  const ref = selector.slice(0, pathSeparatorIndex)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/@-]*$/.test(ref)) {
    throw new Error(`Git capability source has an invalid ref: ${ref}`)
  }
  const capabilityPath = normalizeRelativePath(selector.slice(pathSeparatorIndex + 1))
  return { remote, ref, capabilityPath }
}

async function readGitCapabilitySource(options: { source: string; gitSource: GitCapabilitySource }): Promise<{
  label: string
  files: CapabilityPackageFile[]
  integrity: string
}> {
  const treeish = `${options.gitSource.ref}:${options.gitSource.capabilityPath}`
  const archive = await new Promise<Buffer>((resolve, reject) => {
    childProcess.execFile(
      'git',
      ['archive', '--format=tar.gz', '--prefix=package/', `--remote=${options.gitSource.remote}`, treeish],
      { encoding: 'buffer', maxBuffer: MAX_ARCHIVE_BYTES },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.toString('utf-8').trim()
          reject(new Error(detail || `Failed to read Git capability source: ${options.source}`, { cause: error }))
          return
        }
        resolve(stdout)
      },
    )
  })
  assertArchiveSize({ size: archive.length, label: options.source })
  return {
    label: options.source,
    files: await extractArchiveFiles(archive),
    integrity: bufferIntegrity(archive),
  }
}

async function readArchive(archive: Buffer): Promise<{
  files: CapabilityPackageFile[]
  metadataFile: CapabilityPackageFile
}> {
  const extracted = await extractArchiveFiles(archive)
  const metadataFile =
    extracted.find((file) => {
      return file.path === PACKAGE_METADATA_PATH
    }) || requirePackageFile({ files: extracted, filePath: LEGACY_PACKAGE_METADATA_PATH })
  const files = extracted.filter((file) => {
    return file.path !== PACKAGE_METADATA_PATH && file.path !== LEGACY_PACKAGE_METADATA_PATH
  })
  return { files, metadataFile }
}

async function extractArchiveFiles(archive: Buffer): Promise<CapabilityPackageFile[]> {
  const extractor = tar.extract()
  const files: CapabilityPackageFile[] = []
  let totalBytes = 0
  const extraction = new Promise<void>((resolve, reject) => {
    extractor.on('entry', (header, stream, next) => {
      if (header.type === 'directory') {
        stream.resume()
        next()
        return
      }
      const relativePath = normalizeArchiveEntryPath(header.name)
      if (header.type !== 'file' && header.type !== null && header.type !== undefined) {
        stream.resume()
        next(new Error(`Capability archives cannot contain ${header.type} entries: ${header.name}`))
        return
      }
      readStreamWithLimit({ stream, limit: MAX_EXTRACTED_BYTES })
        .then((content) => {
          if (files.some((file) => file.path === relativePath)) {
            next(new Error(`Capability package contains duplicate path: ${relativePath}`))
            return
          }
          totalBytes += content.length
          if (totalBytes > MAX_EXTRACTED_BYTES) {
            next(new Error(`Capability package expands beyond ${MAX_EXTRACTED_BYTES} bytes`))
            return
          }
          files.push({ path: relativePath, content })
          if (files.length > MAX_PACKAGE_FILES) {
            next(new Error(`Capability package exceeds ${MAX_PACKAGE_FILES} files`))
            return
          }
          next()
        })
        .catch((error: unknown) => {
          next(error)
        })
    })
    extractor.on('finish', resolve)
    extractor.on('error', reject)
  })
  await pipeline(Readable.from(archive), zlib.createGunzip(), extractor)
  await extraction
  assertExtractedSize(files, totalBytes)
  return files
}

async function readStreamWithLimit(options: { stream: Readable; limit: number }): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const rawChunk of options.stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    size += chunk.length
    if (size > options.limit) {
      throw new Error(`Capability package entry exceeds ${options.limit} bytes`)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function parsePackageManifest(content: Buffer): CapabilityManifest {
  const raw: unknown = (() => {
    try {
      return JSON.parse(content.toString('utf-8'))
    } catch (error) {
      throw new Error('Capability package has invalid capability.json', { cause: error })
    }
  })()
  return parseCapabilityManifest({
    ...assertJsonObject(raw),
    status: 'draft',
  })
}

function normalizeInstallFiles(options: {
  files: CapabilityPackageFile[]
  manifest: CapabilityManifest
}): CapabilityPackageFile[] {
  const entryPath = normalizeRelativePath(options.manifest.entry)
  const allowed = options.files.filter((file) => {
    return (
      file.path === 'capability.json' ||
      file.path === entryPath ||
      file.path === 'README.md' ||
      file.path.startsWith('agent-skills/')
    )
  })
  requirePackageFile({ files: allowed, filePath: entryPath })
  const normalizedManifest = {
    ...options.manifest,
    status: 'draft' as const,
    updatedAt: new Date().toISOString(),
  }
  return allowed.map((file) => {
    if (file.path !== 'capability.json') {
      return file
    }
    return {
      path: file.path,
      content: Buffer.from(`${JSON.stringify(normalizedManifest, null, 2)}\n`),
    }
  })
}

function validatePackageMetadata(options: {
  files: CapabilityPackageFile[]
  metadataFile?: CapabilityPackageFile
  manifest: CapabilityManifest
}): void {
  if (!options.metadataFile) {
    return
  }
  const metadata = CapabilityPackageMetadataSchema.parse(JSON.parse(options.metadataFile.content.toString('utf-8')))
  if (metadata.capabilityId !== options.manifest.id) {
    throw new Error(`Capability package id mismatch: ${metadata.capabilityId} !== ${options.manifest.id}`)
  }
  const actualHashes = new Map(
    options.files.map((file) => {
      return [file.path, bufferSha256(file.content)]
    }),
  )
  const mismatches = metadata.files.filter((file) => {
    return actualHashes.get(file.path) !== file.sha256
  })
  if (mismatches.length > 0 || metadata.files.length !== options.files.length) {
    const detail = mismatches.length > 0 ? mismatches.map((file) => file.path).join(', ') : 'file count mismatch'
    throw new Error(`Capability package integrity check failed: ${detail}`)
  }
}

function requirePackageFile(options: { files: CapabilityPackageFile[]; filePath: string }): CapabilityPackageFile {
  const file = options.files.find((candidate) => {
    return candidate.path === options.filePath
  })
  if (!file) {
    throw new Error(`Capability package is missing ${options.filePath}`)
  }
  return file
}

function normalizeArchiveEntryPath(entryPath: string): string {
  const normalized = normalizeRelativePath(entryPath)
  if (!normalized.startsWith(`${PACKAGE_ROOT}/`)) {
    throw new Error(`Capability archive entries must stay under ${PACKAGE_ROOT}/: ${entryPath}`)
  }
  return normalizeRelativePath(normalized.slice(PACKAGE_ROOT.length + 1))
}

function normalizeRelativePath(filePath: string): string {
  const slashPath = filePath.replaceAll('\\', '/')
  const normalized = path.posix.normalize(slashPath)
  if (
    normalized === '.' ||
    normalized.startsWith('/') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('\0')
  ) {
    throw new Error(`Capability package path must be relative and stay inside the package: ${filePath}`)
  }
  return normalized
}

function resolvePackageDestination(options: { capabilityDir: string; filePath: string }): string {
  const normalized = normalizeRelativePath(options.filePath)
  const root = path.resolve(options.capabilityDir)
  const destination = path.resolve(root, ...normalized.split('/'))
  if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Capability package path escapes its destination: ${options.filePath}`)
  }
  return destination
}

function assertPackageLimits(options: { paths: string[] }): void {
  if (options.paths.length > MAX_PACKAGE_FILES) {
    throw new Error(`Capability package exceeds ${MAX_PACKAGE_FILES} files`)
  }
}

function assertArchiveSize(options: { size: number; label: string }): void {
  if (options.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`Capability package exceeds ${MAX_ARCHIVE_BYTES} bytes: ${options.label}`)
  }
}

function assertExtractedSize(files: CapabilityPackageFile[], knownSize?: number): void {
  const totalBytes =
    knownSize ??
    files.reduce((total, file) => {
      return total + file.content.length
    }, 0)
  if (totalBytes > MAX_EXTRACTED_BYTES) {
    throw new Error(`Capability package expands beyond ${MAX_EXTRACTED_BYTES} bytes`)
  }
}

function assertJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Capability package manifest must be an object')
  }
  return value as Record<string, unknown>
}

function bufferSha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function bufferIntegrity(content: Buffer): string {
  return `sha256-${crypto.createHash('sha256').update(content).digest('base64')}`
}

function fileIntegrity(filePath: string): string {
  return bufferIntegrity(fs.readFileSync(filePath))
}

function filesIntegrity(files: CapabilityPackageFile[]): string {
  const hash = crypto.createHash('sha256')
  files.map((file) => {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.content)
    return file.path
  })
  return `sha256-${hash.digest('base64')}`
}
