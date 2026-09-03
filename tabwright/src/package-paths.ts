import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function getInstalledTabwrightPackageDir(): string {
  const localPackageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const localPackageJsonPath = path.join(localPackageDir, 'package.json')
  if (fs.existsSync(localPackageJsonPath)) {
    return localPackageDir
  }

  const packageJsonPath = require.resolve('tabwright/package.json')
  return path.dirname(packageJsonPath)
}

export function getBundledExtensionPath(): string {
  const packageDir = getInstalledTabwrightPackageDir()
  const candidates = [
    path.join(packageDir, 'dist', 'extension'),
    path.join(packageDir, '..', 'extension', 'dist'),
  ]

  for (const extensionPath of candidates) {
    const manifestPath = path.join(extensionPath, 'manifest.json')
    if (fs.existsSync(manifestPath)) {
      return extensionPath
    }
  }

  throw new Error(
    `Bundled Tabwright extension not found under ${packageDir}. Rebuild or reinstall the tabwright package.`,
  )
}

export function getInstalledWakaruCliPath(): string {
  const packageJsonPath = require.resolve('@wakaru/cli/package.json')
  return path.join(path.dirname(packageJsonPath), 'bin', 'wakaru')
}

export function getInstalledWakaruVersion(): string {
  const packageJsonPath = require.resolve('@wakaru/cli/package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
  if (typeof packageJson.version !== 'string') {
    throw new Error(`Wakaru package version is missing: ${packageJsonPath}`)
  }
  return packageJson.version
}

export const getInstalledPlaywriterPackageDir = getInstalledTabwrightPackageDir
