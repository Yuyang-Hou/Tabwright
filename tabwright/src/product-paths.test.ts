import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { getTabwrightProjectDataDir, getTabwrightUserDataDir } from './product-paths.js'

const testDirs: string[] = []

function createTestDir(name: string): string {
  const root = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(root, { recursive: true })
  const dir = fs.mkdtempSync(path.join(root, `${name}-`))
  testDirs.push(dir)
  return dir
}

afterEach(() => {
  testDirs.map((dir) => {
    fs.rmSync(dir, { recursive: true, force: true })
    return dir
  })
})

describe('Tabwright data paths', () => {
  test('uses the Tabwright user and project directories by default', () => {
    const root = createTestDir('tabwright-paths')

    expect(getTabwrightUserDataDir({ homeDir: root })).toBe(path.join(root, '.tabwright'))
    expect(getTabwrightProjectDataDir({ cwd: root })).toBe(path.join(root, '.tabwright'))
  })

  test('does not fall back to legacy Playwriter data', () => {
    const root = createTestDir('tabwright-legacy-paths')
    fs.mkdirSync(path.join(root, '.playwriter'))

    expect(getTabwrightUserDataDir({ homeDir: root })).toBe(path.join(root, '.tabwright'))
    expect(getTabwrightProjectDataDir({ cwd: root })).toBe(path.join(root, '.tabwright'))
  })

  test('prefers the Tabwright directory when both directories exist', () => {
    const root = createTestDir('tabwright-current-paths')
    fs.mkdirSync(path.join(root, '.playwriter'))
    fs.mkdirSync(path.join(root, '.tabwright'))

    expect(getTabwrightUserDataDir({ homeDir: root })).toBe(path.join(root, '.tabwright'))
    expect(getTabwrightProjectDataDir({ cwd: root })).toBe(path.join(root, '.tabwright'))
  })
})
