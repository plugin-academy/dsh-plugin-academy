import assert from 'node:assert/strict'
import { test } from 'node:test'
import { marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index'
import { loadIndexes, validateIndex, validateManifest, verifyRemote } from '../scripts/validate.mjs'

const [entry] = await loadIndexes()
test('Featured is natively installable without rewriting author provenance', () => {
  const [plugin] = entry.index.plugins
  assert.equal(entry.index.plugins.length, 1)
  assert.equal(plugin.author, 'bowenliang123')
  assert.equal(plugin.repository.url, 'https://github.com/bowenliang123/dsh-context')
  assert.deepEqual(marketInstallTarget(plugin.name, plugin.versions[0]), {
    spec: 'dsh-context@0.85.1', registry: 'https://registry.npmjs.org/',
  })
  assert.equal(entry.url, 'https://plugin.academy/dsh/featured/index.json')
})
test('remote validation accepts an omitted manifestVersion only with a DSH bundle', async t => {
  const [plugin] = entry.index.plugins
  const [version] = plugin.versions
  const manifest = {
    name: plugin.name,
    version: version.version,
    repository: { url: `git+${plugin.repository.url}.git` },
    author: plugin.author,
    engines: version.engines,
    dist: { integrity: 'sha512-fixture', tarball: 'https://registry.npmjs.org/example.tgz' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'HEAD') {
      assert.equal(url, plugin.repository.url)
      return new Response()
    }
    assert.equal(url.href, `https://registry.npmjs.org/${plugin.name}/${version.version}`)
    return Response.json(manifest)
  })
  await verifyRemote([entry])
  manifest.dsh = { manifestVersion: 1, bundle: { patch: ['./cordis.patch.yml'] } }
  await verifyRemote([entry])
  for (const dsh of [
    { bundle: { patch: './cordis.patch.yml' }, manifestVersion: 2 },
    { manifestVersion: 1 },
    { bundle: { patch: [] } },
  ]) {
    manifest.dsh = dsh
    await assert.rejects(verifyRemote([entry]), /not the expected DSH package/)
  }
})
test('native validator rejects bad versions, duplicate plugins, and mutable git refs', () => {
  for (const mutate of [
    value => { value.plugins[0].versions[0].version = 'latest' },
    value => { value.plugins.push(value.plugins[0]) },
    value => { value.plugins[0].versions[0].source = { type: 'git', url: 'https://github.com/example/plugin', commit: 'main' } },
    value => { delete value.plugins[0].repository },
    value => { value.plugins[0].versions[0].source.registry = 'http://example.com/' },
  ]) {
    const value = structuredClone(entry.value)
    mutate(value)
    assert.throws(() => validateIndex(value, entry.url))
  }
})
test('publication routes are stable and cannot escape artifact roots', () => {
  for (const patch of [
    { source: '../index.json' }, { route: '/dsh/../../index.json' },
    { route: '/dsh/community/featured/index.json' }, { updatedAt: 'yesterday' },
  ]) assert.throws(() => validateManifest({ schemaVersion: 1, indexes: [{ ...entry, ...patch }] }))
  assert.throws(() => validateManifest({ schemaVersion: 1, indexes: [entry, entry] }))
})
