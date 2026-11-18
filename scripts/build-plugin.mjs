import { readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { build, transform } from 'esbuild'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const icon = await readFile(new URL(`../${manifest.icon}`, import.meta.url))
const stylesheet = await readFile(new URL('../src/client/styles.css', import.meta.url), 'utf8')
const css = await transform(stylesheet, { loader: 'css', minify: true, target: 'chrome120' })
const baseline = new Set([
  'react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives',
])
const bundled = new Set(['@deepseek-ai/dsh-plugin-market-index', 'semver'])
const require = createRequire(import.meta.url)
const validator = require.resolve('@deepseek-ai/dsh-plugin-market-index/package.json')
const semver = createRequire(validator).resolve('semver/package.json')
const notices = await Promise.all([validator, semver].map(async path => {
  const { name, version } = JSON.parse(await readFile(path, 'utf8'))
  const license = await readFile(join(dirname(path), 'LICENSE'), 'utf8')
  return `${name} ${version}\n\n${license.trimEnd()}`
}))

await rm(new URL('../lib/', import.meta.url), { recursive: true, force: true })
await Promise.all([
  build({
    entryPoints: ['src/index.ts'], outfile: 'lib/index.js',
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22',
    sourcemap: true,
  }),
  build({
    entryPoints: ['src/client/index.ts'], outfile: 'lib/client.js',
    bundle: true, platform: 'browser', format: 'cjs', target: 'chrome120', jsx: 'automatic',
    sourcemap: 'external',
    define: {
      __DSH_PLUGIN_ACADEMY_CSS__: JSON.stringify(css.code),
      __DSH_PLUGIN_ACADEMY_ICON__: JSON.stringify(`data:image/svg+xml;base64,${icon.toString('base64')}`),
    },
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} };`,
    },
    footer: {
      js: 'return module.exports; } });',
    },
    plugins: [{
      name: 'dsh-shared-modules',
      setup(builder) {
        builder.onResolve({ filter: /^[^./]/ }, args => {
          if (bundled.has(args.path)) return
          if (!baseline.has(args.path)) throw new Error(`Unexpected browser runtime dependency: ${args.path}`)
          return { path: args.path, external: true }
        })
      },
    }],
  }),
])
await writeFile(new URL('../lib/THIRD_PARTY_NOTICES.txt', import.meta.url), `${notices.join('\n\n')}\n`)
