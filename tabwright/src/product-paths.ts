import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const TABWRIGHT_DATA_DIR_NAME = '.tabwright'
export const LEGACY_PLAYWRITER_DATA_DIR_NAME = '.playwriter'

export function getTabwrightUserDataDir(options: { homeDir?: string } = {}): string {
  const homeDir = options.homeDir || os.homedir()
  const currentDir = path.join(homeDir, TABWRIGHT_DATA_DIR_NAME)
  const legacyDir = path.join(homeDir, LEGACY_PLAYWRITER_DATA_DIR_NAME)

  if (!fs.existsSync(currentDir) && fs.existsSync(legacyDir)) {
    return legacyDir
  }
  return currentDir
}

export function getTabwrightProjectDataDir(options: { cwd?: string } = {}): string {
  const cwd = options.cwd || process.cwd()
  const currentDir = path.join(cwd, TABWRIGHT_DATA_DIR_NAME)
  const legacyDir = path.join(cwd, LEGACY_PLAYWRITER_DATA_DIR_NAME)

  if (!fs.existsSync(currentDir) && fs.existsSync(legacyDir)) {
    return legacyDir
  }
  return currentDir
}
