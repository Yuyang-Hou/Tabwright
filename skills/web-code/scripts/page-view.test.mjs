import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { pageView } from './page-view.mjs'

async function fixture(t) {
  await fs.mkdir(path.resolve('tmp'), { recursive: true })
  const root = await fs.mkdtemp(path.resolve('tmp', 'page-view-test-'))
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })
  const add = async ({ name, descriptor }) => {
    const directory = path.join(root, name)
    await fs.mkdir(directory)
    await fs.writeFile(path.join(directory, 'SKILL.md'), 'Fixture only')
    await fs.writeFile(path.join(directory, 'read.js'), 'throw new Error("must not execute")')
    if (descriptor) await fs.writeFile(path.join(directory, 'page.json'), JSON.stringify(descriptor))
    return directory
  }
  return { root, add }
}

const description = {
  version: 1,
  title: 'Test page',
  summary: 'Known meaning, unknown live state',
  pages: [{ origin: 'https://example.test', path: '/app', route: '/settings' }],
  actions: [{ id: 'read', label: 'List', effect: 'read', file: 'read.js', guide: 'Read the Skill first' }],
}

test('exact URL matching, multiple candidates, private query stripping and no execution', async (t) => {
  const { root, add } = await fixture(t)
  await add({ name: 'one', descriptor: description })
  await add({ name: 'two', descriptor: description })
  const found = await pageView({
    pageUrl: 'https://example.test/app?token=private#/settings?secret=private',
    roots: [root, root],
  })
  assert.equal(found.status, 'MATCHES_FOUND')
  assert.equal(found.matches.length, 2)
  assert.ok(
    found.matches.every((match) => {
      return match.state === 'UNVERIFIED'
    }),
  )
  assert.equal(JSON.stringify(found).includes('private'), false)
  assert.equal(found.matches[0].actions[0].effect, 'read')
  for (const pageUrl of [
    'https://example.test.evil/app#/settings',
    'http://example.test/app#/settings',
    'https://example.test/application#/settings',
    'https://example.test/app#/other',
  ]) {
    assert.equal((await pageView({ pageUrl, roots: [root] })).matches.length, 0)
  }
  await assert.rejects(pageView({ pageUrl: 'https://user:password@example.test/app', roots: [root] }))
  await assert.rejects(pageView({ pageUrl: 'file:///etc/passwd', roots: [root] }))
})

test('legacy skills and unreadable roots remain explicit coverage gaps, not no-skill claims', async (t) => {
  const { root, add } = await fixture(t)
  await add({ name: 'legacy' })
  await add({ name: 'broken', descriptor: { version: 99 } })
  const result = await pageView({
    pageUrl: 'https://example.test/app#/settings',
    roots: [root, path.join(root, 'missing')],
  })
  assert.equal(result.status, 'NO_INDEXED_MATCH')
  assert.deepEqual(
    result.unindexed.map((item) => {
      return item.name
    }),
    ['legacy'],
  )
  assert.ok(
    result.issues.some((item) => {
      return item.code === 'ROOT_MISSING'
    }),
  )
  assert.ok(
    result.issues.some((item) => {
      return item.code === 'INVALID_PAGE_DESCRIPTION'
    }),
  )
})

test('action references cannot escape their skill or silently reference missing files', async (t) => {
  const { root, add } = await fixture(t)
  await fs.writeFile(path.join(root, 'outside.js'), 'throw new Error("must not execute")')
  for (const [name, file] of [
    ['escape', '../outside.js'],
    ['absent', 'absent.js'],
  ]) {
    await add({ name, descriptor: { ...description, actions: [{ ...description.actions[0], file }] } })
  }
  const result = await pageView({ pageUrl: 'https://example.test/app#/settings', roots: [root] })
  assert.equal(result.matches.length, 0)
  assert.equal(result.issues.length, 2)
  assert.equal(result.unindexed.length, 0)
})

test('linked skill directories are reported as skipped', { skip: process.platform === 'win32' }, async (t) => {
  const { root, add } = await fixture(t)
  const directory = await add({ name: 'original', descriptor: description })
  await fs.symlink(directory, path.join(root, 'linked'))
  const result = await pageView({ pageUrl: 'https://example.test/app#/settings', roots: [root] })
  assert.equal(result.matches.length, 1)
  assert.ok(
    result.issues.some((item) => {
      return item.code === 'SYMLINK_SKIPPED'
    }),
  )
})
