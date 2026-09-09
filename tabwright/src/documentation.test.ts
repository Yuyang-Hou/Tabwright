import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { readDocumentation } from './documentation.js'

const fixtureRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'tmp')
const fixtureDirectories: string[] = []

function createDocumentationPackage(): string {
  fs.mkdirSync(fixtureRoot, { recursive: true })
  const packageDir = fs.mkdtempSync(path.join(fixtureRoot, 'documentation-'))
  fixtureDirectories.push(packageDir)
  fs.mkdirSync(path.join(packageDir, 'dist'))
  fs.writeFileSync(
    path.join(packageDir, 'dist', 'network-api.md'),
    'First line\nSecond line\nThird line\nFourth line\n',
  )
  return packageDir
}

afterEach(() => {
  fixtureDirectories.splice(0).map((directory) => {
    fs.rmSync(directory, { recursive: true, force: true })
  })
})

describe('local documentation', () => {
  test('reads a bundled reference from a real package directory', () => {
    const packageDir = createDocumentationPackage()

    expect(readDocumentation({ packageDir, topic: 'network' })).toEqual({
      topic: 'network',
      content: 'First line\nSecond line\nThird line\nFourth line',
      offset: 0,
      end: 4,
      totalLines: 4,
      truncated: false,
    })
  })

  test('returns bounded pages and a continuation command until the end', () => {
    const packageDir = createDocumentationPackage()

    expect(readDocumentation({ packageDir, topic: 'network', limit: 2 })).toEqual({
      topic: 'network',
      content: 'First line\nSecond line',
      offset: 0,
      end: 2,
      totalLines: 4,
      truncated: true,
      nextCommand: 'tabwright docs network --offset 2 --limit 2',
    })
    expect(readDocumentation({ packageDir, topic: 'network', offset: 1, limit: 2 })).toEqual({
      topic: 'network',
      content: 'Second line\nThird line',
      offset: 1,
      end: 3,
      totalLines: 4,
      truncated: true,
      nextCommand: 'tabwright docs network --offset 3 --limit 2',
    })
    expect(readDocumentation({ packageDir, topic: 'network', offset: 3, limit: 2 })).toEqual({
      topic: 'network',
      content: 'Fourth line',
      offset: 3,
      end: 4,
      totalLines: 4,
      truncated: true,
    })
  })

  test('clamps an offset beyond the end without a continuation command', () => {
    const packageDir = createDocumentationPackage()

    expect(readDocumentation({ packageDir, topic: 'network', offset: 99, limit: 500 })).toEqual({
      topic: 'network',
      content: '',
      offset: 4,
      end: 4,
      totalLines: 4,
      truncated: true,
    })
  })

  test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid offset %s',
    (offset) => {
      const packageDir = createDocumentationPackage()

      expect(() => {
        readDocumentation({ packageDir, topic: 'network', offset })
      }).toThrow('Documentation offset must be a non-negative integer')
    },
  )

  test.each([0, -1, 0.5, 501, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid limit %s', (limit) => {
    const packageDir = createDocumentationPackage()

    expect(() => {
      readDocumentation({ packageDir, topic: 'network', limit })
    }).toThrow('limit must be between 1 and 500 lines')
  })

  test.each(['unknown', '../network-api.md', ''])(
    'rejects an unknown topic %s instead of treating it as a path',
    (topic) => {
      const packageDir = createDocumentationPackage()

      expect(() => {
        readDocumentation({ packageDir, topic })
      }).toThrow(`Unknown documentation topic: ${topic}. Run 'tabwright docs' to list topics.`)
    },
  )

  test('explains how to recover a missing bundled reference', () => {
    const packageDir = createDocumentationPackage()

    expect(() => {
      readDocumentation({ packageDir, topic: 'debugger' })
    }).toThrow('Bundled debugger reference is missing. Rebuild or reinstall this Tabwright package.')
  })
})
