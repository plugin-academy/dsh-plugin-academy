export interface TopPlugin {
  name: string
  title?: string
  description?: string
  version?: string
  homepage?: string
}

export interface IndexSource {
  id?: string
  url: string
  title: string
  description?: string
  publisher: { id?: string; name: string; url?: string }
  pluginCount: number
  topPlugins: TopPlugin[]
  tags: string[]
  updatedAt?: string
  curation?: 'official' | 'community'
  pluginAcademy?: { resourceNames: string[] }
}

export interface Catalog {
  format: 1
  sources: IndexSource[]
}

export type CatalogErrorCode =
  | 'invalid-catalog' | 'not-configured' | 'fetch-failed' | 'too-large' | 'timeout' | 'cancelled'

export class CatalogError extends Error {
  readonly code: CatalogErrorCode

  constructor(code: CatalogErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CatalogError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new CatalogError('invalid-catalog', `${path} must be an object.`)
  return value
}

function text(value: unknown, path: string, max = 160): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new CatalogError('invalid-catalog', `${path} must be a non-empty string of at most ${max} characters.`)
  }
  return value.trim()
}

function httpUrl(value: unknown, path: string, fragment = false): URL {
  const input = text(value, path, 2048)
  if (!URL.canParse(input)) throw new CatalogError('invalid-catalog', `${path} must be an absolute URL.`)
  const url = new URL(input)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CatalogError('invalid-catalog', `${path} must use HTTP or HTTPS.`)
  }
  if (url.username !== '' || url.password !== '' || (!fragment && url.href.includes('#'))) {
    throw new CatalogError('invalid-catalog', `${path} must not contain credentials${fragment ? '' : ' or a fragment'}.`)
  }
  return url
}

export function normalizeCatalogUrl(value: string): string {
  const url = httpUrl(value, 'catalogUrl')
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new CatalogError('invalid-catalog', 'catalogUrl must use HTTPS, except localhost, 127.0.0.1, or ::1 for development.')
  }
  return url.href
}

export function normalizeIndexUrl(value: string): string {
  return httpUrl(value, 'Index URL').href
}

// Configured sources may already be invalid; retain their exact spelling so they can still be removed.
export function configuredIndexKey(value: string): string {
  return URL.canParse(value) ? new URL(value).href : value
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return String(error)
}

function topPlugin(value: unknown, path: string): TopPlugin {
  const input = record(value, path)
  const plugin: TopPlugin = { name: text(input.name, `${path}.name`, 214) }
  for (const key of ['title', 'description', 'version'] as const) {
    if (input[key] !== undefined) plugin[key] = text(input[key], `${path}.${key}`, key === 'description' ? 2000 : 160)
  }
  if (input.homepage !== undefined) plugin.homepage = httpUrl(input.homepage, `${path}.homepage`, true).href
  return plugin
}

function indexSource(value: unknown, position: number): IndexSource {
  const path = `sources[${position}]`
  const input = record(value, path)
  const publisher = record(input.publisher, `${path}.publisher`)
  if (!Number.isSafeInteger(input.pluginCount) || typeof input.pluginCount !== 'number' || input.pluginCount < 0) {
    throw new CatalogError('invalid-catalog', `${path}.pluginCount must be a non-negative safe integer.`)
  }
  const highlights = input.topPlugins === undefined ? [] : input.topPlugins
  if (!Array.isArray(highlights) || highlights.length > 10 || highlights.length > input.pluginCount) {
    throw new CatalogError('invalid-catalog', `${path}.topPlugins must be an array with at most 10 entries and no more than pluginCount.`)
  }
  const tags = input.tags === undefined ? [] : input.tags
  if (!Array.isArray(tags) || tags.length > 20) {
    throw new CatalogError('invalid-catalog', `${path}.tags must be an array with at most 20 entries.`)
  }
  const source: IndexSource = {
    url: httpUrl(input.url, `${path}.url`).href,
    title: text(input.title, `${path}.title`),
    publisher: { name: text(publisher.name, `${path}.publisher.name`) },
    pluginCount: input.pluginCount,
    topPlugins: highlights.map((plugin, index) => topPlugin(plugin, `${path}.topPlugins[${index}]`)),
    tags: tags.map((tag, index) => text(tag, `${path}.tags[${index}]`, 48)),
  }
  if (input.id !== undefined) source.id = httpUrl(input.id, `${path}.id`).href
  if (publisher.id !== undefined) source.publisher.id = text(publisher.id, `${path}.publisher.id`, 253)
  if (publisher.url !== undefined) source.publisher.url = httpUrl(publisher.url, `${path}.publisher.url`, true).href
  if (input.description !== undefined) source.description = text(input.description, `${path}.description`, 2000)
  if (input.curation !== undefined) {
    if (input.curation !== 'official' && input.curation !== 'community') {
      throw new CatalogError('invalid-catalog', `${path}.curation must be official or community.`)
    }
    source.curation = input.curation
  }
  if (input.pluginAcademy !== undefined) {
    const metadata = record(input.pluginAcademy, `${path}.pluginAcademy`)
    const names = metadata.resourceNames
    if (names !== undefined) {
      const field = `${path}.pluginAcademy.resourceNames`
      if (!Array.isArray(names) || names.length !== source.pluginCount) {
        throw new CatalogError('invalid-catalog', `${field} must have one name per plugin.`)
      }
      const resourceNames = names.map((name, index) => text(name, `${field}[${index}]`, 214))
      if (new Set(resourceNames).size !== resourceNames.length) {
        throw new CatalogError('invalid-catalog', `${field} contains duplicate package names.`)
      }
      source.pluginAcademy = { resourceNames }
    }
  }
  if (input.updatedAt !== undefined) {
    const timestamp = text(input.updatedAt, `${path}.updatedAt`, 64)
    const time = Date.parse(timestamp)
    if (!Number.isFinite(time) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)) {
      throw new CatalogError('invalid-catalog', `${path}.updatedAt must be an ISO 8601 timestamp with a timezone.`)
    }
    source.updatedAt = new Date(time).toISOString()
  }
  const names = source.topPlugins.map(plugin => plugin.name)
  if (new Set(names).size !== names.length) {
    throw new CatalogError('invalid-catalog', `${path}.topPlugins contains duplicate plugin names.`)
  }
  if (new Set(source.tags).size !== source.tags.length) {
    throw new CatalogError('invalid-catalog', `${path}.tags contains duplicate tags.`)
  }
  return source
}

export function parseCatalog(value: unknown): Catalog {
  const input = record(value, 'Catalog')
  if (input.format !== 1) throw new CatalogError('invalid-catalog', 'Catalog.format must be 1.')
  if (!Array.isArray(input.sources) || input.sources.length > 500) {
    throw new CatalogError('invalid-catalog', 'Catalog.sources must be an array with at most 500 entries.')
  }
  const sources = input.sources.map(indexSource)
  const urls = sources.map(source => source.url)
  if (new Set(urls).size !== urls.length) {
    throw new CatalogError('invalid-catalog', 'Catalog.sources contains duplicate index URLs.')
  }
  return { format: 1, sources }
}
export const PLUGIN_ID = 'dsh-plugin-academy'
export const DEFAULT_CATALOG_URL = 'https://plugin.academy/catalogs/dsh/catalog.json'
