import assert from 'node:assert/strict'
import test from 'node:test'
import { readIndexPreview, PreviewError } from '../src/client/preview.ts'

const url = 'https://publisher.example/index.json'
const plugin = {
  name: 'dsh-example',
  title: { en: 'Example', zh: '示例' },
  description: { en: 'An example plugin.', zh: '示例插件。' },
  author: 'Example Publisher',
  homepage: 'https://publisher.example/example',
  repository: { url: 'https://github.com/example/dsh-example' },
  versions: ['0.9.0', '0.10.0'].map(version => ({
    version, publishTimestamp: 1794990000, source: { type: 'npm' },
  })),
}
const index = { format: 1, title: 'Example index', plugins: [plugin] }
const invalid = code => error => error instanceof PreviewError && error.code === code
const preview = address => readIndexPreview(address ?? url, new AbortController().signal)

test('loads only the requested index and preserves native localized metadata and sorted versions', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (address, options) => {
    assert.equal(address, url)
    assert.equal(options.credentials, 'omit')
    assert.equal(options.mode, 'cors')
    assert.equal(options.redirect, 'error')
    assert.equal(options.referrerPolicy, 'no-referrer')
    return Response.json(index)
  })
  const [result] = await preview()
  assert.deepEqual(result.title, plugin.title)
  assert.deepEqual(result.description, plugin.description)
  assert.equal(result.author, plugin.author)
  assert.equal(result.homepage, plugin.homepage)
  assert.deepEqual(result.repository, plugin.repository)
  assert.deepEqual(result.versions.map(version => version.version), ['0.10.0', '0.9.0'])
  assert.equal(fetch.mock.callCount(), 1)
})

test('requires HTTPS other than loopback and never fetches invalid URLs', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ ...index, plugins: [] }))
  for (const address of ['http://publisher.example/index.json', 'https://user:pass@publisher.example/index.json', 'https://publisher.example/index.json#fragment']) {
    await assert.rejects(preview(address), invalid('previewNeedsHttps'))
  }
  assert.equal(fetch.mock.callCount(), 0)
  assert.deepEqual(await preview('http://127.0.0.1:4173/dsh/featured/index.json'), [])
  assert.equal(fetch.mock.callCount(), 1)
})

test('distinguishes unavailable responses from invalid native indexes', async t => {
  const replies = [
    () => { throw new TypeError('Browser blocked the request') },
    () => new Response(null, { status: 404 }),
    () => new Response('{bad json'),
    () => new Response(new Uint8Array([0xff])),
    () => Response.json({ format: 1, sources: [] }),
    () => Response.json({ ...index, plugins: [{ ...plugin, versions: [] }] }),
  ]
  t.mock.method(globalThis, 'fetch', async () => replies.shift()())
  for (const code of ['previewUnavailable', 'previewUnavailable', 'previewInvalid', 'previewInvalid', 'previewInvalid', 'previewInvalid']) {
    await assert.rejects(preview(), invalid(code))
  }
})

test('enforces the decoded preview limit and cancels oversized responses', async t => {
  const maxBytes = 16 * 1024 * 1024
  let cancelled = false
  t.mock.method(globalThis, 'fetch', async () => new Response(
    new ReadableStream({ cancel: () => { cancelled = true } }),
    { headers: { 'Content-Length': String(maxBytes + 1) } },
  ))
  await assert.rejects(preview(), invalid('previewTooLarge'))
  assert.equal(cancelled, true)
  t.mock.restoreAll()

  const json = new TextEncoder().encode(JSON.stringify(index))
  let bytes = maxBytes
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(json)
      controller.enqueue(new Uint8Array(bytes - json.length).fill(32))
      controller.close()
    },
  })))
  assert.equal((await preview()).length, 1)
  bytes += 1
  await assert.rejects(preview(), invalid('previewTooLarge'))
})

test('aborts on close and reports deadline expiry separately', async t => {
  const request = new AbortController()
  const deadline = new AbortController()
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    assert.equal(ms, 15000)
    return deadline.signal
  })
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    signal.throwIfAborted()
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  const closed = readIndexPreview(url, request.signal)
  request.abort()
  await assert.rejects(closed, error => error.name === 'AbortError')
  const timedOut = preview()
  deadline.abort()
  await assert.rejects(timedOut, invalid('previewTimedOut'))
})
