import assert from 'node:assert/strict'
import { after, before, mock, test } from 'node:test'
import { apply, Config, name } from '../src/index.ts'
import { DEFAULT_CATALOG_URL, parseCatalog } from '../src/catalog.ts'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { startCatalogServer } from './catalog-server.mjs'

let fixture
before(async () => { fixture = await startCatalogServer() })
after(async () => { await fixture.close() })

function host(url, options = {}) {
  const routes = new Map()
  const disposers = []
  let market
  const config = {
    catalogUrl: { get: () => url },
    fetchTimeoutMs: 15000, maxBytes: 1048576, ...options,
  }
  const ctx = {
    connection: { fetch: { register(value) {
      routes.set(value.path, value)
      return async () => { routes.delete(value.path) }
    } } },
    get(name) {
      assert.equal(name, 'pluginMarket')
      return market
    },
    effect(callback) { disposers.push(callback()) },
  }
  apply(ctx, config)
  return {
    config,
    paths: () => [...routes.keys()].sort(),
    route: routes.get('/api/dsh-plugin-academy/catalog'),
    read: (signal) => routes.get('/api/dsh-plugin-academy/catalog').fetch(new Request('http://harness.example/api/dsh-plugin-academy/catalog', { signal })),
    readStatus: () => routes.get('/api/dsh-plugin-academy/status').fetch(new Request('http://harness.example/api/dsh-plugin-academy/status')),
    setAvailable: value => { market = value ? {} : undefined },
    dispose: async () => { for (const dispose of disposers.toReversed()) await dispose() },
    removed: () => routes.size === 0,
  }
}

test('declares defaults, limits and a volatile catalog endpoint', () => {
  assert.equal(name, 'dsh-plugin-academy')
  assert.equal(Config.dict.fetchTimeoutMs.meta.default, 15000)
  assert.equal(Config.dict.maxBytes.meta.default, 1048576)
  assert.equal(Config.dict.catalogUrl.meta.volatile, true)
})

test('registers only the consolidated plugin API namespace', async t => {
  const plugin = host('')
  t.after(() => plugin.dispose())
  assert.deepEqual(plugin.paths(), [
    '/api/dsh-plugin-academy/catalog',
    '/api/dsh-plugin-academy/status',
  ])
})

test('fixture sources publish valid Harness indexes matching catalog highlights', async () => {
  for (const source of fixture.catalog().sources) {
    const response = await fetch(source.url)
    assert.equal(response.status, 200)
    const index = parseMarketIndex(await response.json(), source.url)
    assert.equal(index.title, source.title)
    assert.equal(index.plugins.length, source.pluginCount)
    assert.deepEqual(index.plugins.map(plugin => plugin.name), source.topPlugins.map(plugin => plugin.name))
  }
})

test('reports live registry availability without needing or fetching a catalog', async t => {
  const plugin = host('')
  t.after(() => plugin.dispose())
  const fetchMock = mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch') })
  t.after(() => fetchMock.mock.restore())
  let response = await plugin.readStatus()
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { available: false })
  plugin.setAvailable(true)
  response = await plugin.readStatus()
  assert.deepEqual(await response.json(), { available: true })
  plugin.setAvailable(false)
  response = await plugin.readStatus()
  assert.deepEqual(await response.json(), { available: false })
  assert.equal(fetchMock.mock.calls.length, 0)
})

test('fetches and validates the actual remote HTTP catalog', async t => {
  const plugin = host(`${fixture.url}/catalog.json`)
  t.after(() => plugin.dispose())
  assert.equal(plugin.route.path, '/api/dsh-plugin-academy/catalog')
  assert.deepEqual(plugin.route.methods, ['GET'])
  const response = await plugin.read()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), parseCatalog(fixture.catalog()))
})

test('reports unconfigured and invalid endpoints without fetching anything', async t => {
  const plugin = host('')
  t.after(() => plugin.dispose())
  const fetchMock = mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch') })
  t.after(() => fetchMock.mock.restore())
  const response = await plugin.read()
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'not-configured')
  plugin.config.catalogUrl = { get: () => 'http://publisher.example/catalog.json' }
  assert.equal((await (await plugin.read()).json()).code, 'invalid-catalog')
  assert.equal(fetchMock.mock.calls.length, 0)
})

test('resolves environment fallback only for an absent endpoint', async t => {
  const previous = process.env.DSH_PLUGIN_ACADEMY_CATALOG_URL
  process.env.DSH_PLUGIN_ACADEMY_CATALOG_URL = `${fixture.url}/empty.json`
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_PLUGIN_ACADEMY_CATALOG_URL
    else process.env.DSH_PLUGIN_ACADEMY_CATALOG_URL = previous
  })

  const plugin = host(undefined)
  t.after(() => plugin.dispose())
  assert.deepEqual(await (await plugin.read()).json(), { format: 1, sources: [] })
  plugin.config.catalogUrl = { get: () => '' }
  assert.equal((await plugin.read()).status, 503)
})

test('recommends Plugin Academy only when config and environment are absent', async t => {
  const previous = process.env.DSH_PLUGIN_ACADEMY_CATALOG_URL
  delete process.env.DSH_PLUGIN_ACADEMY_CATALOG_URL
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_PLUGIN_ACADEMY_CATALOG_URL
    else process.env.DSH_PLUGIN_ACADEMY_CATALOG_URL = previous
  })
  const fetchMock = mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, DEFAULT_CATALOG_URL)
    return Response.json({ format: 1, sources: [] })
  })
  t.after(() => fetchMock.mock.restore())
  const plugin = host(undefined)
  t.after(() => plugin.dispose())
  assert.equal((await plugin.read()).status, 200)
  assert.equal(fetchMock.mock.calls.length, 1)
  plugin.config.catalogUrl = { get: () => '' }
  assert.equal((await plugin.read()).status, 503)
  assert.equal(fetchMock.mock.calls.length, 1)
})

test('reads updated volatile configuration without re-registering the route', async t => {
  const plugin = host(`${fixture.url}/catalog.json`)
  t.after(() => plugin.dispose())
  assert.equal((await (await plugin.read()).json()).sources.length, 2)
  plugin.config.catalogUrl = { get: () => `${fixture.url}/empty.json` }
  assert.deepEqual(await (await plugin.read()).json(), { format: 1, sources: [] })
})

test('reports HTTP failures, redirects, malformed JSON, invalid metadata and invalid UTF-8', async t => {
  for (const [path, code, reason] of [
    ['/error.json', 'fetch-failed', /503/],
    ['/redirect.json', 'fetch-failed', /Redirects/],
    ['/malformed.json', 'invalid-catalog', /JSON/],
    ['/invalid.json', 'invalid-catalog', /sources\[0\]/],
    ['/utf8.json', 'invalid-catalog', /UTF-8/],
  ]) {
    await t.test(path, async t => {
      const plugin = host(`${fixture.url}${path}`)
      t.after(() => plugin.dispose())
      const response = await plugin.read()
      const payload = await response.json()
      assert.equal(response.status, 502)
      assert.equal(payload.code, code)
      assert.match(payload.error, reason)
    })
  }
})

test('accepts the exact byte limit and rejects one byte over, including chunked bodies', async t => {
  const length = Buffer.byteLength(JSON.stringify(fixture.catalog()))
  for (const path of ['/catalog.json', '/chunked.json']) {
    const plugin = host(`${fixture.url}${path}`, { maxBytes: length })
    t.after(() => plugin.dispose())
    assert.equal((await plugin.read()).status, 200)
    plugin.config.maxBytes = length - 1
    const response = await plugin.read()
    assert.equal(response.status, 502)
    assert.equal((await response.json()).code, 'too-large')
  }
})

test('times out while reading the body, not just the response headers', async t => {
  const plugin = host(`${fixture.url}/slow.json`, { fetchTimeoutMs: 100 })
  t.after(() => plugin.dispose())
  const start = performance.now()
  const response = await plugin.read()
  assert.equal(response.status, 504)
  assert.equal((await response.json()).code, 'timeout')
  assert.ok(performance.now() - start < 700)
})

test('cancels pending reads and removes its route on disposal', async () => {
  const plugin = host(`${fixture.url}/slow.json`)
  const pending = plugin.read()
  await plugin.dispose()
  assert.equal(plugin.removed(), true)
  const response = await pending
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'cancelled')
})
