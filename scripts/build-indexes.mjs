import { createHash } from 'node:crypto'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { loadIndexes, root } from './validate.mjs'

const indexes = await loadIndexes()
const out = new URL('dist/', root)
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await mkdir(new URL('dsh/schema/', out), { recursive: true })
await cp(new URL('schema/dsh-index.schema.json', root), new URL('dsh/schema/dsh-index.schema.json', out))
const reports = []
for (const entry of indexes) {
  const target = new URL(entry.route.slice(1), out)
  await mkdir(new URL('./', target), { recursive: true })
  const body = JSON.stringify(entry.value, null, 2) + '\n'
  await writeFile(target, body)
  reports.push({
    url: entry.url, pluginCount: entry.index.plugins.length, updatedAt: entry.updatedAt,
    resourceNames: entry.index.plugins.map(plugin => plugin.name).sort(),
    sha256: createHash('sha256').update(body).digest('hex'),
  })
}
await writeFile(new URL('catalog-updates.json', out), JSON.stringify({ schemaVersion: 1, indexes: reports }, null, 2) + '\n')
await writeFile(new URL('_headers', out), '/dsh/*\n  Content-Type: application/json; charset=utf-8\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n  X-Content-Type-Options: nosniff\n')
console.log('Built native index artifacts and reviewable metadata handoff in dist/.')
