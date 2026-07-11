import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const skillPath = path.resolve(currentDir, '..', '..', 'skills', 'playwriter', 'SKILL.md')

describe('Playwriter installed skill', () => {
  test('keeps the mandatory browser protocol compact and self-contained', () => {
    const content = fs.readFileSync(skillPath, 'utf-8')
    const words = content.split(/\s+/).filter((word) => {
      return word.length > 0
    })

    expect(words.length).toBeLessThan(2500)
    expect(content).toContain('## Browser Core Protocol')
    expect(content).toContain('Never reuse an existing session')
    expect(content).toContain('Never call `browser.close()` or `context.close()`')
    expect(content).toContain("playwriter skill | rg -n -C 20")
    expect(content).toContain("playwriter skill | Select-String")
    expect(content).not.toContain('Read the ENTIRE output')
  })
})
