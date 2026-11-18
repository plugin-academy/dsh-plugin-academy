import assert from 'node:assert/strict'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { DEFAULT_CATALOG_URL, parseCatalog } from '../src/catalog.ts'

const featuredUrl = new URL('/dsh/featured/index.json', DEFAULT_CATALOG_URL).href

async function fetchJson(url) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
  if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error(`${url}: expected HTTP 200 JSON, got HTTP ${response.status} (${response.headers.get('content-type')}).`)
  }
  if (response.headers.get('access-control-allow-origin') !== '*') throw new Error(`${url}: missing public CORS header.`)
  return response.json()
}

const catalog = parseCatalog(await fetchJson(DEFAULT_CATALOG_URL))
const featured = catalog.sources.find(source => source.url === featuredUrl)
assert.ok(featured?.pluginCount, `${DEFAULT_CATALOG_URL}: expected a nonempty Featured collection at ${featuredUrl}.`)

const index = parseMarketIndex(await fetchJson(featuredUrl), featuredUrl)
assert.equal(index.plugins.length, featured.pluginCount, `${featuredUrl}: plugin count differs from the catalog.`)
if (featured.pluginAcademy) {
  assert.deepEqual(index.plugins.map(plugin => plugin.name).sort(), featured.pluginAcademy.resourceNames.toSorted(),
    `${featuredUrl}: plugin membership differs from the catalog.`)
}
console.log(`Verified ${DEFAULT_CATALOG_URL} and ${featuredUrl}.`)
