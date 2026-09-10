import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const skillPath = path.resolve(currentDir, '..', '..', 'skills', 'tabwright', 'SKILL.md')

describe('Tabwright installed skill', () => {
  test('keeps the browser capability guide compact and self-contained', () => {
    const content = fs.readFileSync(skillPath, 'utf-8')
    const words = content.split(/\s+/).filter((word) => {
      return word.length > 0
    })

    expect(words.length).toBeLessThan(2500)
    expect(content).toContain('## Capability guide')
    expect(content).toContain('Never reuse an existing session')
    expect(content).toContain('Never call `browser.close()` or `context.close()`')
    expect(content).toContain('tabwright docs network')
    expect(content).toContain('tabwright docs editor')
    expect(content).toContain('tabwright docs debugger')
    expect(content).toContain('`--offset` and `--limit`')
    expect(content).toContain('tabwright page inspect')
    expect(content).toContain('## Independent scripts')
    expect(content).toContain('There is no business manifest')
    expect(content).not.toContain('Read the ENTIRE output')
  })
})
