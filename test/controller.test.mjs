import assert from 'node:assert/strict'
import test from 'node:test'
import { CatalogError } from '../src/catalog.ts'
import { PluginIndexesController } from '../src/client/controller.ts'

const a = 'https://publisher.example/a.json'
const b = 'https://publisher.example/b.json'
const c = 'https://publisher.example/c.json'
const emptyCatalog = { format: 1, sources: [] }

function registry(initial = []) {
  let indexes = initial.map(url => typeof url === 'string' ? { url } : url)
  const writes = []
  return {
    writes,
    isAvailable: async () => true,
    listIndexes: async () => structuredClone(indexes),
    setIndexes: async urls => {
      writes.push([...urls])
      indexes = urls.map(url => indexes.find(index => index.url === url) ?? { url })
    },
    replace: urls => { indexes = urls.map(url => ({ url })) },
    urls: () => indexes.map(index => index.url),
  }
}

function controller(t, readCatalog = async () => emptyCatalog) {
  const result = new PluginIndexesController(readCatalog)
  t.after(() => result.dispose())
  return result
}

test('shows the remote catalog independently of optional Discover availability', async t => {
  const value = controller(t)
  await value.load()
  assert.equal(value.state.getSnapshot().catalogStatus, 'ready')
  assert.equal(value.state.getSnapshot().indexesStatus, 'unavailable')
  await value.add(a)
  assert.match(value.state.getSnapshot().mutationError, /Enable Custom plugin indexes/)
  const sources = registry()
  value.attachRegistry(sources)
  await value.reloadIndexes()
  assert.equal(value.state.getSnapshot().indexesStatus, 'ready')
})

test('reads the latest registry before writes and preserves unrelated sources', async t => {
  const value = controller(t)
  const sources = registry([a])
  value.attachRegistry(sources)
  await value.load()
  sources.replace([a, c])
  assert.equal(await value.add(b), true)
  assert.deepEqual(sources.writes, [[a, c, b]])
  assert.deepEqual(value.state.getSnapshot().indexes.map(index => index.url), [a, c, b])
  assert.deepEqual(value.state.getSnapshot().changed, { kind: 'add', url: b })
  await value.remove(a)
  assert.deepEqual(sources.urls(), [c, b])
  assert.deepEqual(value.state.getSnapshot().changed, { kind: 'remove', url: a })
})

test('checks actual host availability before calling declared Remote facades', async t => {
  const value = controller(t)
  const sources = registry([a])
  let available = false
  const list = sources.listIndexes
  sources.isAvailable = async () => available
  sources.listIndexes = async () => {
    assert.equal(available, true, 'must not call an unavailable Remote namespace')
    return list()
  }
  value.attachRegistry(sources)
  await value.load()
  assert.equal(value.state.getSnapshot().catalogStatus, 'ready')
  assert.equal(value.state.getSnapshot().indexesStatus, 'unavailable')
  assert.equal(value.state.getSnapshot().indexesError, null)
  await value.add(b)
  assert.match(value.state.getSnapshot().mutationError, /Enable Custom plugin indexes/)
  assert.deepEqual(sources.writes, [])
  available = true
  await value.reloadIndexes()
  assert.equal(value.state.getSnapshot().indexesStatus, 'ready')
  await value.add(b)
  assert.deepEqual(sources.urls(), [a, b])
  available = false
  await value.reloadIndexes()
  assert.equal(value.state.getSnapshot().indexesStatus, 'unavailable')
  assert.deepEqual(value.state.getSnapshot().indexes, [])
})

test('does not disguise availability request failures as a disabled registry', async t => {
  const value = controller(t)
  const sources = registry()
  sources.isAvailable = async () => { throw new Error('Status request failed') }
  value.attachRegistry(sources)
  await value.load()
  assert.equal(value.state.getSnapshot().indexesStatus, 'error')
  assert.equal(value.state.getSnapshot().indexesError, 'Status request failed')
})

test('ignores stale availability responses before they can read or clear sources', async t => {
  const value = controller(t)
  const older = Promise.withResolvers()
  const sources = registry([b])
  let reads = 0
  sources.isAvailable = async () => ++reads === 1 ? older.promise : true
  value.attachRegistry(sources)
  const initial = value.load()
  await value.reloadIndexes()
  older.resolve(false)
  await initial
  assert.equal(value.state.getSnapshot().indexesStatus, 'ready')
  assert.deepEqual(value.state.getSnapshot().indexes, [{ url: b }])
})

test('makes duplicate additions and missing removals idempotent', async t => {
  const value = controller(t)
  const sources = registry(['https://PUBLISHER.example:443/a.json'])
  value.attachRegistry(sources)
  await value.load()
  await value.add(a)
  await value.remove(b)
  assert.deepEqual(sources.writes, [])
  assert.deepEqual(sources.urls(), ['https://PUBLISHER.example:443/a.json'])
})

test('rejects an invalid addition and keeps stored invalid sources removable', async t => {
  const value = controller(t)
  const sources = registry([{ url: 'broken source', error: 'Invalid URL' }, a])
  value.attachRegistry(sources)
  await value.load()
  await value.add('javascript:alert(1)')
  assert.match(value.state.getSnapshot().mutationError, /HTTP or HTTPS/)
  assert.deepEqual(sources.writes, [])
  await value.add(b)
  assert.deepEqual(sources.urls(), ['broken source', a, b])
  await value.remove('broken source')
  assert.deepEqual(sources.urls(), [a, b])
})

test('never marks a source added until persistence succeeds', async t => {
  const value = controller(t)
  const sources = registry([a])
  sources.setIndexes = async () => { throw { message: 'Permission denied' } }
  value.attachRegistry(sources)
  await value.load()
  assert.equal(await value.add(b), false)
  assert.deepEqual(sources.urls(), [a])
  assert.deepEqual(value.state.getSnapshot().indexes.map(index => index.url), [a])
  assert.equal(value.state.getSnapshot().changed, null)
  assert.equal(value.state.getSnapshot().pending, null)
  assert.equal(value.state.getSnapshot().mutationError, 'Permission denied')
})

test('retains a known committed change if the follow-up registry read fails', async t => {
  const value = controller(t)
  const sources = registry([a])
  const list = sources.listIndexes
  let committed = false
  sources.listIndexes = async () => {
    if (committed) throw new Error('Reload failed')
    return list()
  }
  const write = sources.setIndexes
  sources.setIndexes = async urls => { await write(urls); committed = true }
  value.attachRegistry(sources)
  await value.load()
  await value.add(b)
  assert.deepEqual(value.state.getSnapshot().indexes.map(index => index.url), [a, b])
  assert.equal(value.state.getSnapshot().indexesStatus, 'error')
  assert.equal(value.state.getSnapshot().indexesError, 'Reload failed')
  assert.equal(value.state.getSnapshot().changed.kind, 'add')
})

test('keeps existing sources editable when the catalog fails', async t => {
  const value = controller(t, async () => { throw new Error('Catalog offline') })
  const sources = registry([a])
  value.attachRegistry(sources)
  await value.load()
  assert.equal(value.state.getSnapshot().catalogStatus, 'error')
  assert.equal(value.state.getSnapshot().catalogError, 'Catalog offline')
  assert.equal(value.state.getSnapshot().indexesStatus, 'ready')
  await value.remove(a)
  assert.deepEqual(sources.urls(), [])
})

test('retains the last good catalog with an explicit refresh error', async t => {
  let fail = false
  const value = controller(t, async () => {
    if (fail) throw new Error('Refresh failed')
    return emptyCatalog
  })
  await value.load()
  fail = true
  await value.reloadCatalog()
  assert.deepEqual(value.state.getSnapshot().catalog, emptyCatalog)
  assert.equal(value.state.getSnapshot().catalogStatus, 'error')
  assert.equal(value.state.getSnapshot().catalogError, 'Refresh failed')
})

test('clears the previous provider on a saved URL change, leaving added indexes in place', async t => {
  let requests = 0
  const next = Promise.withResolvers()
  const value = controller(t, () => ++requests === 1 ? Promise.resolve(emptyCatalog) : next.promise)
  value.attachRegistry(registry([a]))
  await value.catalogSettingsChanged()
  assert.equal(requests, 0)
  await value.load()
  assert.equal(value.state.getSnapshot().catalog, emptyCatalog)
  const switching = value.catalogSettingsChanged()
  assert.equal(value.state.getSnapshot().catalogStatus, 'loading')
  assert.equal(value.state.getSnapshot().catalog, null)
  next.reject(new Error('New catalog is offline'))
  await switching
  assert.equal(value.state.getSnapshot().catalogStatus, 'error')
  assert.equal(value.state.getSnapshot().catalog, null)
  assert.deepEqual(value.state.getSnapshot().indexes, [{ url: a }])
})

test('disabling discovery clears the catalog without turning off index management', async t => {
  let enabled = true
  const value = controller(t, async () => {
    if (!enabled) throw new CatalogError('not-configured', 'Catalog is off.')
    return emptyCatalog
  })
  const sources = registry([a])
  value.attachRegistry(sources)
  await value.load()
  enabled = false
  await value.reloadCatalog()
  assert.equal(value.state.getSnapshot().catalogStatus, 'disabled')
  assert.equal(value.state.getSnapshot().catalogError, null)
  assert.equal(value.state.getSnapshot().catalog, null)
  assert.equal(await value.add(b), true)
  assert.deepEqual(sources.urls(), [a, b])
})

test('ignores stale catalog and registry responses', async t => {
  const olderCatalog = Promise.withResolvers()
  let catalogReads = 0
  const value = controller(t, async () => ++catalogReads === 1 ? olderCatalog.promise : emptyCatalog)
  const olderIndexes = Promise.withResolvers()
  let indexReads = 0
  value.attachRegistry({
    isAvailable: async () => true,
    listIndexes: async () => ++indexReads === 1 ? olderIndexes.promise : [{ url: b }],
    setIndexes: async () => {},
  })
  const initial = value.load()
  await Promise.resolve()
  await value.refresh()
  olderCatalog.resolve({ format: 1, sources: [{ title: 'Stale' }] })
  olderIndexes.resolve([{ url: a }])
  await initial
  assert.deepEqual(value.state.getSnapshot().catalog, emptyCatalog)
  assert.deepEqual(value.state.getSnapshot().indexes, [{ url: b }])
})

test('serializes user gestures and prevents a second in-flight mutation', async t => {
  const value = controller(t)
  const sources = registry()
  value.attachRegistry(sources)
  await value.load()
  const gate = Promise.withResolvers()
  const write = sources.setIndexes
  sources.setIndexes = async urls => { await gate.promise; await write(urls) }
  const first = value.add(a)
  assert.equal(value.state.getSnapshot().pending, a)
  await value.add(b)
  gate.resolve()
  await first
  assert.deepEqual(sources.writes, [[a]])
  assert.equal(value.state.getSnapshot().pending, null)
})

test('remounts against a fresh registry and does not publish after disposal', async t => {
  const value = controller(t)
  const sources = registry([a])
  const detach = value.attachRegistry(sources)
  await value.load()
  detach()
  assert.equal(value.state.getSnapshot().indexesStatus, 'unavailable')
  const next = registry([b])
  value.attachRegistry(next)
  await value.reloadIndexes()
  assert.deepEqual(value.state.getSnapshot().indexes, [{ url: b }])
  const read = Promise.withResolvers()
  const disposed = controller(t, () => read.promise)
  const pending = disposed.load()
  const before = disposed.state.getSnapshot()
  disposed.dispose()
  read.resolve(emptyCatalog)
  await pending
  assert.equal(disposed.state.getSnapshot(), before)
})
