import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { loadIndexes } from '../scripts/validate.mjs'

test('emits a lazy Harness factory with shared runtime imports', async () => {
  let registration
  const [source, manifest] = await Promise.all([
    readFile(new URL('../lib/client.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  const icon = await readFile(new URL(`../${manifest.icon}`, import.meta.url))
  assert.ok(source.includes(`data:image/svg+xml;base64,${icon.toString('base64')}`), 'The tab uses the packaged plugin icon.')
  runInNewContext(source, { window: { __ModuleLoader__: { load: value => { registration = value } } } })
  assert.equal(registration.id, '@plugin-academy/dsh-plugin-academy')
  const imports = []
  const entry = registration.factory(specifier => {
    imports.push(specifier)
    return {}
  })
  assert.deepEqual(Object.keys(entry).sort(), ['apply', 'inject'])
  assert.equal(typeof entry.apply, 'function')
  assert.deepEqual(new Set(imports), new Set([
    'react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives',
  ]))
  assert.equal(registration.meta, undefined)
  assert.doesNotMatch(source, /node:fs|node:http|node:path|@deepseek-ai\/schemastery/)
})

test('registers the Plugin Academy tab with the shared profile form and its own stylesheet', async () => {
  let registration
  let observed = false
  const catalogForm = {
    getSnapshot: () => ({ status: 'ready', value: {} }),
    subscribe(listener) {
      assert.equal(typeof listener, 'function')
      observed = true
      return () => { observed = false }
    },
  }
  const existing = { textContent: 'body { margin: 0 }' }
  const styles = [existing]
  const document = {
    createElement(name) {
      assert.equal(name, 'style')
      return {
        dataset: {}, textContent: '',
        remove() { styles.splice(styles.indexOf(this), 1) },
      }
    },
    head: { appendChild(element) { styles.push(element) } },
  }
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  runInNewContext(source, { window: { __ModuleLoader__: { load: value => { registration = value } } }, document })
  assert.deepEqual(styles, [existing])
  const entry = registration.factory(specifier => {
    if (specifier !== '@deepseek-ai/dsh-client-store') return {}
    return { createSnapshotStore: initial => {
      let snapshot = initial
      return { getSnapshot: () => snapshot, set: next => { snapshot = next } }
    } }
  })
  assert.deepEqual(styles, [existing])
  const disposers = []
  const dictionaries = new Map()
  const registrations = []
  entry.apply({
    effect(callback) { disposers.push(callback()) },
    inject() {},
    on() {},
    configForms: { get(id) {
      assert.equal(id, 'dsh-plugin-academy')
      return catalogForm
    } },
    locale: {
      register(namespace, dictionary) {
        dictionaries.set(namespace, dictionary)
        return () => dictionaries.delete(namespace)
      },
      bind: namespace => key => dictionaries.get(namespace).en[key],
      resolveText: text => text,
    },
    slots: {
      inject(_name, register) { disposers.push(register()) },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  })
  assert.equal(dictionaries.size, 1)
  assert.equal(dictionaries.get('dshPluginAcademy').en.title, 'Plugin Academy')
  assert.equal(dictionaries.get('dshPluginAcademy').zh.title, 'Plugin Academy')
  assert.equal(dictionaries.get('dshPluginAcademy').en.browseCatalog, 'Browse Plugin Indexes')
  assert.equal(dictionaries.get('dshPluginAcademy').zh.browseCatalog, '\u6d4f\u89c8\u63d2\u4ef6\u7d22\u5f15')
  assert.equal(dictionaries.get('dshPluginAcademy').en.previewPlugins, 'View Plugins')
  const tabs = registrations.filter(value => value.options.name === 'plugins.tab')
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].options.id, 'plugin-indexes')
  assert.equal(tabs[0].options.label(), 'Plugin Academy')
  assert.equal(tabs[0].options.locale, 'dshPluginAcademy')
  assert.equal(tabs[0].component.name, 'PluginIndexesTab')
  assert.deepEqual(Object.keys(tabs[0].options.inject().hooks), ['pluginIndexes'])
  assert.equal(tabs[0].options.inject().catalogForm, catalogForm)
  assert.equal(observed, true)
  const configs = registrations.filter(value => value.options.name === 'plugins.row.config')
  assert.equal(configs.length, 1)
  assert.equal(configs[0].options.key, '@plugin-academy/dsh-plugin-academy#dsh-plugin-academy')
  assert.equal(styles.length, 2)
  assert.equal(styles[1].dataset.plugin, '@plugin-academy/dsh-plugin-academy')
  assert.equal(styles[1].dataset.pluginCss, '@plugin-academy/dsh-plugin-academy:src/client/styles.css')
  assert.match(styles[1].textContent, /\.dsh-plugin-academy-cards[^}]*display:grid/)
  for (const dispose of disposers.toReversed()) dispose()
  assert.deepEqual(styles, [existing])
  assert.equal(observed, false)
})

test('publishes a closed installable bundle without development dependencies or build state', async () => {
  const destination = process.env.NPM_PACK_DESTINATION
  const mode = destination ? ['--pack-destination', destination] : ['--dry-run']
  const result = spawnSync('npm', ['pack', ...mode, '--json', '--ignore-scripts'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const [manifest] = JSON.parse(result.stdout)
  assert.equal(manifest.name, '@plugin-academy/dsh-plugin-academy')
  assert.equal(manifest.filename, `plugin-academy-dsh-plugin-academy-${manifest.version}.tgz`)
  const [lock, patch, packageJson] = await Promise.all([
    readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
    readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ])
  const packageConfig = JSON.parse(packageJson)
  assert.equal(packageConfig.private, undefined)
  assert.equal(packageConfig.workspaces, undefined)
  assert.equal(packageConfig.publishConfig.access, 'public')
  assert.equal(manifest.version, packageConfig.version)
  assert.equal(packageConfig.repository.url, 'git+https://github.com/plugin-academy/dsh-plugin-academy.git')
  assert.equal(packageConfig.main, 'lib/index.js')
  assert.equal(packageConfig.exports['.'].default, './lib/index.js')
  const host = await import(new URL('../lib/index.js', import.meta.url))
  assert.equal(host.name, 'dsh-plugin-academy')
  const lockfile = JSON.parse(lock)
  assert.equal(lockfile.name, manifest.name)
  assert.equal(lockfile.version, manifest.version)
  assert.equal(lockfile.packages[''].name, manifest.name)
  assert.equal(lockfile.packages[''].version, manifest.version)
  assert.match(patch, /- id: dsh-plugin-academy\n\s+name: '@plugin-academy\/dsh-plugin-academy'/)
  assert.equal(patch.match(/^\s+- id:/gm).length, 1)
  const files = new Set(manifest.files.map(file => file.path))
  assert.ok(packageConfig.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  for (const path of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/types/index.d.ts', 'lib/types/client/index.d.ts', 'locale/en.json', 'locale/zh.json', 'README.md', 'LICENSE', 'icon.svg', 'docs/catalogs.md', 'docs/indexes.md', 'CONTRIBUTING.md', 'GOVERNANCE.md']) {
    assert.ok(files.has(path), `Missing published file: ${path}`)
  }
  assert.ok(files.has('lib/THIRD_PARTY_NOTICES.txt'))
  const notices = await readFile(new URL('../lib/THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8')
  assert.match(notices, /^@deepseek-ai\/dsh-plugin-market-index \S+\s+MIT License\b/)
  assert.match(notices, /\nsemver \S+\s+The ISC License\b/)
  const excluded = ['dist/', 'official/', 'community/', 'schema/', 'src/', 'scripts/', '.github/', 'test/']
  assert.ok([...files].every(path => !path.includes('node_modules') && !path.endsWith('.tsbuildinfo')
    && path !== 'indexes.json' && excluded.every(prefix => !path.startsWith(prefix))))
  assert.equal(files.has('lib/types/client/IndexSourcesTab.d.ts'), false)
  const [en, zh] = await Promise.all([
    readFile(new URL('../locale/en.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../locale/zh.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  assert.equal(en.meta.title, 'Plugin Academy')
  assert.equal(zh.meta.title, 'Plugin Academy')
})

test('root build emits native distribution alongside the installable plugin', async () => {
  const [entries, report, schema] = await Promise.all([
    loadIndexes(),
    readFile(new URL('../dist/catalog-updates.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../dist/dsh/schema/dsh-index.schema.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.indexes.length, entries.length)
  assert.equal(schema.$id, 'https://plugin.academy/dsh/schema/dsh-index.schema.json')
  for (const entry of entries) {
    const body = await readFile(new URL(`../dist${entry.route}`, import.meta.url), 'utf8')
    assert.deepEqual(JSON.parse(body), entry.value)
    assert.deepEqual(report.indexes.find(value => value.url === entry.url), {
      url: entry.url, pluginCount: entry.index.plugins.length, updatedAt: entry.updatedAt,
      resourceNames: entry.index.plugins.map(plugin => plugin.name).sort(),
      sha256: createHash('sha256').update(body).digest('hex'),
    })
  }
})
