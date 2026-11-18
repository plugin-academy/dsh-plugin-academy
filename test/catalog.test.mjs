import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { CatalogError, configuredIndexKey, normalizeCatalogUrl, normalizeIndexUrl, parseCatalog } from '../src/catalog.ts'

const source = (overrides = {}) => ({
  url: 'https://publisher.example/index.json',
  title: 'Publisher plugins',
  publisher: { name: 'Publisher' },
  pluginCount: 1,
  ...overrides,
})
const catalog = (...sources) => ({ format: 1, sources })

test('accepts the documented example and preserves publisher and highlight metadata', async () => {
  const input = JSON.parse(await readFile(new URL('../examples/catalog.json', import.meta.url)))
  const result = parseCatalog(input)
  assert.equal(result.format, 1)
  assert.equal(result.sources[0].publisher.name, 'Example Publisher')
  assert.equal(result.sources[0].pluginCount, 2)
  assert.equal(result.sources[0].topPlugins[0].name, '@example/dsh-tools')
  assert.equal(result.sources[0].updatedAt, '2026-11-16T00:00:00.000Z')
})

test('normalizes URLs and produces the exact minimal output shape', () => {
  assert.deepEqual(parseCatalog(catalog(source({ url: ' HTTPS://Publisher.example:443/a/../index.json ', extra: true }))), {
    format: 1,
    sources: [{
      url: 'https://publisher.example/index.json', title: 'Publisher plugins',
      publisher: { name: 'Publisher' }, pluginCount: 1, topPlugins: [], tags: [],
    }],
  })

  assert.deepEqual(parseCatalog(catalog()), { format: 1, sources: [] })
})

test('preserves explicit curation without inferring trust for other catalogs', () => {
  for (const curation of ['official', 'community']) {
    assert.equal(parseCatalog(catalog(source({ curation }))).sources[0].curation, curation)
  }
  assert.equal(parseCatalog(catalog(source())).sources[0].curation, undefined)
  assert.throws(() => parseCatalog(catalog(source({ curation: 'safe' }))), /curation/)
})

test('preserves canonical catalog and publisher identities independently of display metadata', () => {
  const id = 'https://plugin.academy/catalogs/dsh/featured'
  const value = parseCatalog(catalog(source({
    id, publisher: { id: 'plugin.academy', name: 'Plugin Academy', url: 'https://plugin.academy' },
  }))).sources[0]
  assert.equal(value.id, id)
  assert.equal(value.publisher.id, 'plugin.academy')
  assert.equal(value.publisher.name, 'Plugin Academy')
  assert.throws(() => parseCatalog(catalog(source({ id: 'file:///catalog.json' }))), /sources\[0\].id/)
})

test('preserves Academy package membership through both host and browser parsing', () => {
  const parsed = parseCatalog(catalog(source({
    pluginCount: 2,
    pluginAcademy: { hosting: 'plugin-academy', status: 'validated', resourceNames: ['dsh-context', '@publisher/tools'] },
  })))
  assert.deepEqual(parsed.sources[0].pluginAcademy, { resourceNames: ['dsh-context', '@publisher/tools'] })
  assert.deepEqual(parseCatalog(parsed), parsed)
  assert.equal(parseCatalog(catalog(source({ pluginAcademy: { hosting: 'external' } }))).sources[0].pluginAcademy, undefined)
})

test('requires declared membership to contain one distinct package name per plugin', () => {
  for (const resourceNames of [null, [], ['context'], ['context', ' context '], ['context', ' ']]) {
    assert.throws(() => parseCatalog(catalog(source({
      pluginCount: 2, pluginAcademy: { resourceNames },
    }))), /sources\[0\]\.pluginAcademy\.resourceNames/)
  }
})

test('rejects invalid known fields with their JSON paths', async t => {
  for (const [overrides, path] of [
    [{ title: '' }, 'sources[0].title'],
    [{ publisher: {} }, 'sources[0].publisher.name'],
    [{ publisher: null }, 'sources[0].publisher'],
    [{ pluginCount: -1 }, 'sources[0].pluginCount'],
    [{ pluginCount: 1.5 }, 'sources[0].pluginCount'],
    [{ pluginCount: '1' }, 'sources[0].pluginCount'],
    [{ pluginCount: Number.MAX_SAFE_INTEGER + 1 }, 'sources[0].pluginCount'],
    [{ topPlugins: null }, 'sources[0].topPlugins'],
    [{ tags: null }, 'sources[0].tags'],
    [{ description: null }, 'sources[0].description'],
    [{ topPlugins: [{}] }, 'sources[0].topPlugins[0].name'],
    [{ topPlugins: [{ name: 'plugin', homepage: 'javascript:alert(1)' }] }, 'sources[0].topPlugins[0].homepage'],
    [{ updatedAt: '2026-11-16' }, 'sources[0].updatedAt'],
  ]) {
    await t.test(path, () => {
      assert.throws(() => parseCatalog(catalog(source(overrides))), error => {
        assert.ok(error instanceof CatalogError)
        assert.equal(error.code, 'invalid-catalog')
        assert.ok(error.message.includes(path), error.message)
        return true
      })
    })
  }
})

test('enforces catalog, highlight, count and string limits at the exact boundaries', () => {
  const sources = Array.from({ length: 500 }, (_, index) => source({ url: `https://publisher.example/${index}.json` }))
  assert.equal(parseCatalog(catalog(...sources)).sources.length, 500)
  assert.throws(() => parseCatalog(catalog(...sources, source({ url: 'https://publisher.example/501.json' }))), /500/)
  const topPlugins = Array.from({ length: 10 }, (_, index) => ({ name: `plugin-${index}` }))
  assert.equal(parseCatalog(catalog(source({ pluginCount: 10, topPlugins }))).sources[0].topPlugins.length, 10)
  assert.throws(() => parseCatalog(catalog(source({ pluginCount: 11, topPlugins: [...topPlugins, { name: 'eleven' }] }))), /10/)
  assert.throws(() => parseCatalog(catalog(source({ pluginCount: 0, topPlugins: [{ name: 'plugin' }] }))), /pluginCount/)
  assert.equal(parseCatalog(catalog(source({ title: 'x'.repeat(160) }))).sources[0].title.length, 160)
  assert.throws(() => parseCatalog(catalog(source({ title: 'x'.repeat(161) }))), /160/)
  const tags = Array.from({ length: 20 }, (_, index) => `tag-${index}`)
  assert.equal(parseCatalog(catalog(source({ tags }))).sources[0].tags.length, 20)
  assert.throws(() => parseCatalog(catalog(source({ tags: [...tags, 'more'] }))), /20/)
})

test('rejects duplicate canonical URLs, tags and highlight names', () => {
  assert.throws(() => parseCatalog(catalog(source(), source({ url: 'https://PUBLISHER.example:443/index.json' }))), /duplicate index URLs/)
  assert.throws(() => parseCatalog(catalog(source({ tags: ['tools', 'tools'] }))), /duplicate tags/)
  assert.throws(() => parseCatalog(catalog(source({ pluginCount: 2, topPlugins: [{ name: 'p' }, { name: 'p' }] }))), /duplicate plugin names/)
  assert.throws(() => parseCatalog({ format: 2, sources: [] }), /format/)
  assert.throws(() => parseCatalog({ format: 1, sources: null }), /sources/)
})

test('uses the Harness index URL rules, including an empty fragment marker', () => {
  assert.equal(normalizeIndexUrl('http://publisher.example/index.json'), 'http://publisher.example/index.json')
  for (const url of ['relative.json', 'file:///tmp/index.json', 'javascript:alert(1)', 'https://user:pass@publisher.example/', 'https://publisher.example/#']) {
    assert.throws(() => normalizeIndexUrl(url), CatalogError)
  }
  assert.equal(configuredIndexKey('not a URL'), 'not a URL')
  assert.equal(configuredIndexKey('https://PUBLISHER.example:443/index.json'), 'https://publisher.example/index.json')
})

test('requires HTTPS for catalogs, except explicit loopback development hosts', () => {
  for (const url of ['https://publisher.example/catalog.json', 'http://localhost:8000/catalog.json', 'http://127.0.0.1:8000/catalog.json', 'http://[::1]:8000/catalog.json']) {
    assert.equal(normalizeCatalogUrl(url), new URL(url).href)
  }
  for (const url of ['http://publisher.example/catalog.json', 'http://localhost.publisher.example/catalog.json', 'https://publisher.example/catalog.json#']) {
    assert.throws(() => normalizeCatalogUrl(url), CatalogError)
  }
})
