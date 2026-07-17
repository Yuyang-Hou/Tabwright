import os from 'node:os'
import path from 'node:path'

export const TABWRIGHT_DATA_DIR_NAME = '.tabwright'

export function getTabwrightUserDataDir(options: { homeDir?: string } = {}): string {
  const homeDir = options.homeDir || os.homedir()
  return path.join(homeDir, TABWRIGHT_DATA_DIR_NAME)
}

export function getTabwrightProjectDataDir(options: { cwd?: string } = {}): string {
  const cwd = options.cwd || process.cwd()
  return path.join(cwd, TABWRIGHT_DATA_DIR_NAME)
}
