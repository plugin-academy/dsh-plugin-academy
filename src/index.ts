import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-plugin-market'
import Schema from '@deepseek-ai/schemastery'
import { CatalogError, DEFAULT_CATALOG_URL, PLUGIN_ID, errorMessage, normalizeCatalogUrl, parseCatalog, type Catalog } from './catalog.ts'

export const name = PLUGIN_ID
export const inject = ['connection']

export const Config = Schema.object({
  catalogUrl: Schema.string().volatile().description('Public catalog JSON endpoint. HTTPS is required except for loopback development. Defaults to DSH_PLUGIN_ACADEMY_CATALOG_URL, then Plugin Academy. An empty string disables discovery.'),
  fetchTimeoutMs: Schema.natural().min(100).max(120000).default(15000).description('Deadline for fetching the catalog, including its body.'),
  maxBytes: Schema.natural().min(1).max(10485760).default(1048576).description('Maximum decoded catalog body size in bytes.'),
})

export type Config = ReturnType<typeof Config>

const PATH = '/api/dsh-plugin-academy/catalog'
const HEADERS = { 'Cache-Control': 'no-store' }
const STATUS: Record<CatalogError['code'], number> = {
  'not-configured': 503, 'invalid-catalog': 502, 'fetch-failed': 502,
  'too-large': 502, timeout: 504, cancelled: 503,
}

async function boundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > maxBytes) {
    await response.body?.cancel()
    throw new CatalogError('too-large', `Catalog exceeds the ${maxBytes}-byte limit.`)
  }
  if (response.body === null) throw new CatalogError('invalid-catalog', 'Catalog endpoint returned an empty body.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new CatalogError('too-large', `Catalog exceeds the ${maxBytes}-byte limit.`)
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

async function fetchCatalog(url: string, config: Config, signal: AbortSignal): Promise<Catalog> {
  const timeout = new AbortController()
  const combined = AbortSignal.any([signal, timeout.signal])
  const timer = setTimeout(() => timeout.abort(new Error('Catalog request timed out.')), config.fetchTimeoutMs)
  let body: Uint8Array
  try {
    const response = await fetch(url, { signal: combined, redirect: 'manual', credentials: 'omit' })
    if (!response.ok) {
      await response.body?.cancel()
      const redirect = response.status >= 300 && response.status < 400 ? ' Redirects are not allowed.' : ''
      throw new CatalogError('fetch-failed', `Catalog endpoint returned HTTP ${response.status}.${redirect}`)
    }
    body = await boundedBody(response, config.maxBytes)
  } catch (error) {
    if (error instanceof CatalogError) throw error
    if (timeout.signal.aborted) throw new CatalogError('timeout', `Catalog request exceeded ${config.fetchTimeoutMs} ms.`, { cause: error })
    if (signal.aborted) throw new CatalogError('cancelled', 'Catalog request was cancelled.', { cause: error })
    throw new CatalogError('fetch-failed', `Could not fetch catalog: ${errorMessage(error)}`, { cause: error })
  } finally {
    clearTimeout(timer)
  }
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    throw new CatalogError('invalid-catalog', 'Catalog must be valid UTF-8.', { cause: error })
  }
  let json: unknown
  try {
    json = JSON.parse(decoded)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new CatalogError('invalid-catalog', `Catalog is not valid JSON: ${error.message}`, { cause: error })
  }
  return parseCatalog(json)
}

export function apply(ctx: Context, config: Config): void {
  const lifetime = new AbortController()
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dsh-plugin-academy/status',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => Response.json({ available: ctx.get('pluginMarket') !== undefined }, { headers: HEADERS }),
  }), 'dsh-plugin-academy: registry status')
  ctx.effect(() => {
    const unregister = ctx.connection.fetch.register({
      path: PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const input = config.catalogUrl.get() ?? process.env.DSH_PLUGIN_ACADEMY_CATALOG_URL ?? DEFAULT_CATALOG_URL
          if (input.trim() === '') {
            throw new CatalogError('not-configured', 'No catalog endpoint is configured. Set catalogUrl in this plugin\'s configuration.')
          }
          const url = normalizeCatalogUrl(input)
          const catalog = await fetchCatalog(url, config, AbortSignal.any([lifetime.signal, request.signal]))
          return Response.json(catalog, { headers: HEADERS })
        } catch (error) {
          if (!(error instanceof CatalogError)) throw error
          return Response.json({ code: error.code, error: error.message }, { status: STATUS[error.code], headers: HEADERS })
        }
      },
    })
    return async () => {
      lifetime.abort(new Error('Plugin Academy plugin disposed.'))
      await unregister()
    }
  }, 'dsh-plugin-academy: catalog route')
}
