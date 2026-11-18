import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { apply } from '../src/index.ts'
import { parseCatalog } from '../src/catalog.ts'
import { PluginIndexesController } from '../src/client/controller.ts'
import { readIndexPreview } from '../src/client/preview.ts'

test('published catalog -> native preview -> Add Index -> durable Added state -> native install target', async t => {
  const origin = new URL(process.env.ACADEMY_ORIGIN ?? 'http://127.0.0.1:4173')
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Use the isolated loopback preview for this integration check.')
  const routes = new Map()
  const disposers = []
  apply({
    get: () => ({}),
    effect: callback => { disposers.push(callback()) },
    connection: { fetch: { register: route => {
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    } } },
  }, {
    catalogUrl: { get: () => new URL('/catalogs/dsh/catalog.json', origin).href },
    fetchTimeoutMs: 15000, maxBytes: 1048576,
  })
  t.after(async () => { for (const dispose of disposers.toReversed()) await dispose() })
  async function catalog(signal) {
    const response = await routes.get('/api/dsh-plugin-academy/catalog').fetch(new Request('http://harness.example/catalog', { signal }))
    assert.equal(response.status, 200, await response.clone().text())
    return parseCatalog(await response.json())
  }
  const data = await catalog()
  const source = data.sources.find(entry => entry.id === 'https://plugin.academy/catalogs/dsh/featured')
  assert.ok(source, 'The website must include the Featured collection from agent-resources.')
  assert.equal(source.publisher.name, 'Plugin Academy')
  assert.equal(source.publisher.id, 'plugin.academy')
  assert.equal(source.id, 'https://plugin.academy/catalogs/dsh/featured')
  assert.equal(source.curation, 'official')
  assert.equal(new URL(source.url).origin, origin.origin, 'Start preview with LOCAL_INDEX_URLS=true to test adding real loopback indexes.')
  const nativeResponse = await fetch(source.url, { redirect: 'manual' })
  assert.equal(nativeResponse.status, 200)
  assert.equal(nativeResponse.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(nativeResponse.headers.get('access-control-allow-origin'), '*')
  const index = parseMarketIndex(await nativeResponse.json(), source.url)
  assert.equal(index.plugins.length, source.pluginCount)
  assert.deepEqual(source.pluginAcademy.resourceNames.toSorted(), index.plugins.map(plugin => plugin.name).sort())
  assert.deepEqual(await readIndexPreview(source.url, new AbortController().signal), index.plugins)
  for (const plugin of index.plugins) {
    assert.ok(marketInstallTarget(plugin.name, plugin.versions[0]).spec.includes(plugin.versions[0].version))
  }

  const directory = await mkdtemp(join(tmpdir(), 'academy-index-registry-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'indexes.json')
  await writeFile(file, '[]')
  let writes = 0
  const registry = {
    isAvailable: async () => true,
    listIndexes: async () => JSON.parse(await readFile(file, 'utf8')).map(url => ({ url })),
    setIndexes: async urls => {
      ++writes
      await writeFile(file, JSON.stringify(urls))
    },
  }
  const controller = new PluginIndexesController(catalog)
  t.after(() => controller.dispose())
  controller.attachRegistry(registry)
  await controller.load()
  assert.equal(controller.state.getSnapshot().indexes.length, 0)
  await controller.add(source.url)
  assert.equal(controller.state.getSnapshot().mutationError, null)
  assert.equal(controller.state.getSnapshot().changed.kind, 'add')
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [source.url])
  await controller.add(source.url.replace(/^http:/, 'HTTP:'))
  assert.equal(writes, 1, 'Canonical duplicate additions must not rewrite the registry.')
  controller.dispose()

  const reopened = new PluginIndexesController(catalog)
  t.after(() => reopened.dispose())
  reopened.attachRegistry(registry)
  await reopened.load()
  assert.equal(reopened.state.getSnapshot().indexes[0].url, source.url, 'Added state survives reopening the controller.')
  await reopened.remove(source.url)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [])
})
