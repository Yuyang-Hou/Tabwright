import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { decompileJavaScript } from './wakaru.js'

const testDirs: string[] = []

function createTestDir(): string {
  const root = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(root, { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, 'wakaru-test-'))
  testDirs.push(directory)
  return directory
}

afterEach(() => {
  testDirs.map((directory) => {
    fs.rmSync(directory, { recursive: true, force: true })
    return directory
  })
})

describe('decompileJavaScript', () => {
  test('writes readable Wakaru artifacts without executing the bundle', async () => {
    const cwd = createTestDir()
    const source = `(()=>{var __webpack_modules__={123:(module)=>{module.exports={modes:["none","global","disabled","unavailable"],load:function(){return fetch("/notifications/indicator",{headers:{"X-Requested-With":"XMLHttpRequest"}})}}}};var __webpack_module_cache__={};function __webpack_require__(moduleId){var cached=__webpack_module_cache__[moduleId];if(cached!==undefined){return cached.exports}var module=__webpack_module_cache__[moduleId]={exports:{}};__webpack_modules__[moduleId](module,module.exports,__webpack_require__);return module.exports}globalThis.__wakaruTest=__webpack_require__(123)})();`

    const result = await decompileJavaScript({
      source,
      sourceUrl: 'https://example.com/assets/app.min.js',
      cwd,
      timeout: 30_000,
    })

    const recovered = result.files
      .filter((filename) => filename.startsWith('output'))
      .map((filename) => fs.readFileSync(path.join(result.root, filename), 'utf8'))
      .join('\n')

    expect(result.sourceUrl).toBe('https://example.com/assets/app.min.js')
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.level).toBe('minimal')
    expect(result.unpack).toBe(true)
    expect(result.wakaruVersion).toBe('1.10.0')
    expect(result.cacheHit).toBe(false)
    expect(result.root.startsWith(path.join(cwd, '.tabwright', 'artifacts', 'wakaru'))).toBe(true)
    expect(result.inputPath.startsWith(path.join(cwd, '.tabwright', 'artifacts', 'web', 'blobs'))).toBe(true)
    expect(fs.readFileSync(result.inputPath, 'utf8')).toBe(source)
    expect(recovered).toContain('/notifications/indicator')
    expect(recovered).toContain('X-Requested-With')
    expect(recovered).toContain('unavailable')
    expect(fs.existsSync(result.manifestPath)).toBe(true)

    const cached = await decompileJavaScript({
      source,
      sourceUrl: 'https://cdn.example.com/same-content.js',
      cwd,
      timeout: 30_000,
    })
    expect(cached.root).toBe(result.root)
    expect(cached.inputPath).toBe(result.inputPath)
    expect(cached.sourceUrl).toBe('https://cdn.example.com/same-content.js')
    expect(cached.cacheHit).toBe(true)
  })

  test('rejects empty input before creating artifacts', async () => {
    const cwd = createTestDir()

    await expect(decompileJavaScript({ source: '  ', cwd })).rejects.toThrow('must not be empty')
    expect(fs.existsSync(path.join(cwd, '.tabwright'))).toBe(false)
  })
})
