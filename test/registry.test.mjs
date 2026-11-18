import assert from 'node:assert/strict'
import test from 'node:test'
import { indexRegistry } from '../src/client/registry.ts'

test('decodes the real Harness RemoteResult shape without unsupported arguments', async () => {
  const calls = []
  const source = { url: 'https://publisher.example/index.json' }
  const registry = indexRegistry({
    async listIndexes(...args) {
      calls.push(['list', ...args])
      return { ok: true, value: [source] }
    },
    async setIndexes(...args) {
      calls.push(['set', ...args])
      return { ok: true, value: undefined }
    },
  }, async signal => !signal.aborted)
  assert.equal(await registry.isAvailable(new AbortController().signal), true)
  assert.deepEqual(await registry.listIndexes(), [source])
  await registry.setIndexes([source.url])
  assert.deepEqual(calls, [['list'], ['set', [source.url]]])
})

test('never converts Remote failures into empty listings or successful writes', async () => {
  const failure = { code: 'plugin-market/settings-unavailable', message: 'Profile settings are unavailable.', details: {} }
  const registry = indexRegistry({
    listIndexes: async () => ({ ok: false, error: failure }),
    setIndexes: async () => ({ ok: false, error: failure }),
  }, async () => true)
  await assert.rejects(registry.listIndexes(), error => error === failure)
  await assert.rejects(registry.setIndexes([]), error => error === failure)
})

test('preserves an unavailable registry and errors from its availability check', async () => {
  let fail = false
  const registry = indexRegistry({
    listIndexes: async () => { throw new Error('must not call') },
    setIndexes: async () => { throw new Error('must not call') },
  }, async () => {
    if (fail) throw new Error('Status request failed')
    return false
  })
  const signal = new AbortController().signal
  assert.equal(await registry.isAvailable(signal), false)
  fail = true
  await assert.rejects(registry.isAvailable(signal), /Status request failed/)
})
