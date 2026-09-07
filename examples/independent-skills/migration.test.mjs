import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import * as config from './conan-config/scripts/run.mjs'
import * as cms from './conan-pedia-cms/scripts/run.mjs'
import * as refund from './cozy-pedia-order-refund/scripts/run.mjs'

test('independent scripts reject invalid or unconfirmed writes without sending a request', async () => {
  const cases = [
    { api: config, input: { action: 'apply-change', value: {}, changeSummary: 'test', validationReport: {} } },
    { api: cms, input: { action: 'medal-config-delete', params: { id: 123 } } },
    { api: refund, input: { uid: '123' } },
  ]
  for (const { api, input } of cases) {
    let requests = 0
    const request = async () => {
      requests += 1
      throw new Error('No network allowed in this test')
    }
    const preview = api.prepare(input)
    assert.equal(preview.requiresConfirmation, true)
    assert.throws(() => {
      api.prepare({})
    })
    await assert.rejects(api.run({ input, request }), /approval/)
    await assert.rejects(api.run({ input, confirmation: 'old-static-token', request }), /approval/)
    const changedInput = { ...input, ...(input.uid ? { uid: '456' } : { environment: 'cn-test' }) }
    assert.notEqual(api.prepare(changedInput).confirmation, preview.confirmation)
    await assert.rejects(api.run({ input: changedInput, confirmation: preview.confirmation, request }), /approval/)
    await assert.rejects(api.run({ input, confirmation: preview.confirmation, request }), /SKILL_COOKIE_HEADER/)
    assert.equal(requests, 0)
  }
})

test('Node transport is explicitly scoped and never retries an uncertain request', async () => {
  const input = { action: 'medal-config-delete', environment: 'cn-test', params: { id: 123 } }
  const confirmation = cms.prepare(input).confirmation
  let requests = 0
  const request = async (target, options) => {
    requests += 1
    assert.equal(new URL(target).origin, 'https://ytkconan.zhenguanyu.com')
    assert.equal(options.redirect, 'error')
    throw new Error('Unknown backend outcome')
  }
  await assert.rejects(
    cms.run({
      input,
      confirmation,
      request,
      cookieHeader: 'fake=test-only',
      cookieOrigin: 'https://conan.zhenguanyu.com',
    }),
    /approved credential scope/,
  )
  assert.equal(requests, 0)
  await assert.rejects(
    cms.run({
      input,
      confirmation,
      request,
      cookieHeader: 'fake=test-only',
      cookieOrigin: 'https://ytkconan.zhenguanyu.com',
    }),
    /Unknown backend outcome/,
  )
  assert.equal(requests, 1)
})

test('browser scripts are ordinary snippets and fail before navigation without a selected page', async () => {
  for (const name of ['conan-commerce', 'zgy-conan-webapp-release-list']) {
    const source = fs.readFileSync(new URL('./' + name + '/scripts/run.js', import.meta.url), 'utf8')
    const script = new vm.Script('(async () => {\n' + source + '\n})()')
    await assert.rejects(script.runInNewContext({ state: {}, structuredClone }), /state.page/)
    assert.equal(source.includes('secrets.cookieHeader'), false)
    assert.match(source, /credentials:\s*['"]include['"]/)
  }
})
