import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index'

export const root = new URL('../', import.meta.url)
const ajv = new Ajv({ allErrors: true })
addFormats(ajv)
const validate = ajv.compile(JSON.parse(await readFile(new URL('schema/dsh-index.schema.json', root), 'utf8')))

export function validateIndex(value, url) {
  if (!validate(value)) throw new Error(`${url}: ${ajv.errorsText(validate.errors)}`)
  const index = parseMarketIndex(value, url)
  for (const plugin of index.plugins) {
    if (!plugin.repository?.url.startsWith('https://')) throw new Error(`${plugin.name}: source repository must use HTTPS.`)
    for (const version of plugin.versions) {
      if (version.source.type === 'npm' && version.source.registry && !version.source.registry.startsWith('https://')) {
        throw new Error(`${plugin.name}: publication requires an HTTPS installation registry.`)
      }
      marketInstallTarget(plugin.name, version)
    }
  }
  return index
}

export function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.indexes) || !manifest.indexes.length) throw new Error('Invalid publication manifest.')
  const sources = new Set()
  const routes = new Set()
  for (const entry of manifest.indexes) {
    if (typeof entry.source !== 'string' || !/^(?:official|community)\/[a-z0-9-]+\/index\.json$/.test(entry.source)) throw new Error('Invalid index source path.')
    if (typeof entry.route !== 'string' || !/^\/dsh\/(?:community\/)?[a-z0-9-]+\/index\.json$/.test(entry.route)) throw new Error('Invalid stable index route.')
    if (entry.source.startsWith('community/') !== entry.route.startsWith('/dsh/community/')) throw new Error('Community routes must retain their classification.')
    if (!ajv.formats['date-time'].validate(entry.updatedAt)) throw new Error('Invalid publication timestamp.')
    if (sources.has(entry.source) || routes.has(entry.route)) throw new Error('Duplicate index source or route.')
    sources.add(entry.source)
    routes.add(entry.route)
  }
}

export async function loadIndexes() {
  const manifest = JSON.parse(await readFile(new URL('indexes.json', root), 'utf8'))
  validateManifest(manifest)
  return Promise.all(manifest.indexes.map(async entry => {
    const value = JSON.parse(await readFile(new URL(entry.source, root), 'utf8'))
    const url = `https://plugin.academy${entry.route}`
    return { ...entry, url, value, index: validateIndex(value, url) }
  }))
}

function repositoryUrl(value) {
  const input = typeof value === 'string' ? value : value?.url
  if (typeof input !== 'string') throw new Error('Published package has no source repository.')
  return input.replace(/^git\+/, '').replace(/\.git$/, '')
}

function declaresDshBundle(dsh) {
  if (dsh?.manifestVersion !== undefined && dsh.manifestVersion !== 1) return false
  const patch = dsh?.bundle?.patch
  const paths = Array.isArray(patch) ? patch : [patch]
  return paths.length > 0 && paths.every(path => typeof path === 'string' && path.trim().length > 0)
}

export async function verifyRemote(indexes) {
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    return response
  }
  for (const { index } of indexes) {
    for (const plugin of index.plugins) {
      await request(plugin.repository.url, { method: 'HEAD' })
      for (const version of plugin.versions) {
        if (version.source.type === 'git') {
          const url = new URL(version.source.url)
          if (url.hostname !== 'github.com') throw new Error(`${plugin.name}: add a reviewed commit-verification adapter for this Git host before publishing.`)
          const repo = url.pathname.replace(/\.git$/, '')
          await request(`https://api.github.com/repos${repo}/commits/${version.source.commit}`)
          continue
        }
        const registry = new URL(version.source.registry ?? 'https://registry.npmjs.org/')
        if (!registry.pathname.endsWith('/')) registry.pathname += '/'
        const endpoint = new URL(`${encodeURIComponent(plugin.name)}/${encodeURIComponent(version.version)}`, registry)
        const manifest = await (await request(endpoint)).json()
        if (manifest.name !== plugin.name || manifest.version !== version.version || !declaresDshBundle(manifest.dsh)) {
          throw new Error(`${plugin.name}@${version.version}: not the expected DSH package.`)
        }
        if (repositoryUrl(manifest.repository) !== plugin.repository.url) throw new Error(`${plugin.name}: repository provenance differs from npm metadata.`)
        const author = typeof manifest.author === 'string' ? manifest.author.split(/[<(]/, 1)[0].trim() : manifest.author?.name
        if (plugin.author !== undefined && plugin.author !== author) throw new Error(`${plugin.name}: author attribution differs from npm metadata.`)
        if (version.engines.dsh !== manifest.engines?.dsh) throw new Error(`${plugin.name}: DSH runtime requirements differ from npm metadata.`)
        if (!manifest.dist?.integrity || !manifest.dist?.tarball?.startsWith('https://')) throw new Error(`${plugin.name}: missing integrity or HTTPS tarball.`)
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const indexes = await loadIndexes()
  if (process.argv.includes('--remote')) await verifyRemote(indexes)
  console.log(`Validated ${indexes.length} native DSH indexes${process.argv.includes('--remote') ? ' and remote installation provenance' : ''}.`)
}
