import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { createCapability, searchCapabilities, updateCapabilityManifest } from './capability-registry.js'

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

describe('capability search relevance', () => {
  test('ignores English stop words instead of routing unrelated write capabilities', () => {
    const cwd = createTempDir('capability-search-relevance-')
    try {
      createCapability({ id: 'github-intent-tool', location: 'project', cwd, runtime: 'node' })
      updateCapabilityManifest({
        id: 'github-intent-tool',
        cwd,
        patch: {
          title: 'GitHub repository summary',
          description: 'Summarize a public GitHub repository.',
          whenToUse: ['Use for public GitHub repository summaries.'],
          tags: ['github', 'repository', 'summary'],
        },
      })
      createCapability({ id: 'refund-intent-tool', location: 'project', cwd, runtime: 'node' })
      updateCapabilityManifest({
        id: 'refund-intent-tool',
        cwd,
        patch: {
          title: 'Refund an order',
          description: 'Refund an encyclopedia order for a user.',
          whenToUse: ['Use only for an explicitly approved refund.'],
          sideEffect: 'write',
          requiresConfirmation: true,
        },
      })
      createCapability({ id: 'public-video-intent-tool', location: 'project', cwd, runtime: 'node' })
      updateCapabilityManifest({
        id: 'public-video-intent-tool',
        cwd,
        patch: {
          title: 'Public videos',
          description: 'List public videos.',
          tags: ['public', 'video'],
        },
      })

      const results = searchCapabilities({ query: 'read-only summarize a public GitHub repository', cwd })
      const ids = results.map((result) => {
        return result.capability.manifest.id
      })

      expect(ids).toContain('github-intent-tool')
      expect(ids).not.toContain('refund-intent-tool')
      expect(ids).not.toContain('public-video-intent-tool')
      expect(
        results.flatMap((result) => {
          return result.reasons
        }),
      ).not.toContain('id: a')
      expect(
        searchCapabilities({ query: 'public', cwd }).map((result) => {
          return result.capability.manifest.id
        }),
      ).toContain('public-video-intent-tool')
      expect(searchCapabilities({ query: 'please use a', cwd })).toEqual([])
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
})
