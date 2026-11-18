import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MarketIndexSummary } from '@deepseek-ai/dsh-api-remotes/client'
import { CatalogError, configuredIndexKey, errorMessage, normalizeIndexUrl, type Catalog } from '../catalog.ts'
import type { IndexRegistry } from './registry.ts'

type ReadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PluginIndexesState {
  catalog: Catalog | null
  catalogStatus: ReadStatus | 'disabled'
  catalogError: string | null
  indexes: readonly MarketIndexSummary[]
  indexesStatus: ReadStatus | 'unavailable'
  indexesError: string | null
  pending: string | null
  mutationError: string | null
  changed: { kind: 'add' | 'remove'; url: string } | null
}

export interface PluginIndexesFace {
  hooks: { pluginIndexes: SnapshotStore<PluginIndexesState> }
  load: () => void
  reloadCatalog: () => void
  reloadIndexes: () => void
  add: (url: string) => Promise<boolean>
  remove: (url: string) => void
  resolveText: (text: NonNullable<MarketIndexSummary['title']>) => string
  getLocale: () => string
}

export class PluginIndexesController {
  readonly state: SnapshotStore<PluginIndexesState>
  private readCatalog: (signal: AbortSignal) => Promise<Catalog>
  private registry: IndexRegistry | undefined
  private started = false
  private disposed = false
  private catalogRevision = 0
  private indexRevision = 0
  private catalogRequest: AbortController | undefined
  private indexRequest: AbortController | undefined
  private mutationRequest: AbortController | undefined

  constructor(readCatalog: (signal: AbortSignal) => Promise<Catalog>) {
    this.readCatalog = readCatalog
    this.state = createSnapshotStore<PluginIndexesState>({
      catalog: null, catalogStatus: 'idle', catalogError: null,
      indexes: [], indexesStatus: 'unavailable', indexesError: null,
      pending: null, mutationError: null, changed: null,
    })
  }

  private publish(patch: Partial<PluginIndexesState>): void {
    if (!this.disposed) this.state.set({ ...this.state.getSnapshot(), ...patch })
  }

  attachRegistry(registry: IndexRegistry): () => void {
    this.registry = registry
    this.publish({ indexesStatus: 'idle', indexesError: null })
    if (this.started) void this.reloadIndexes()
    return () => {
      if (this.registry !== registry) return
      this.registry = undefined
      ++this.indexRevision
      this.indexRequest?.abort()
      this.mutationRequest?.abort()
      this.publish({
        indexes: [], indexesStatus: 'unavailable', indexesError: null, pending: null,
        mutationError: this.mutationRequest ? 'The Harness connection changed while saving. Refresh before retrying.' : null,
      })
    }
  }

  async load(): Promise<void> {
    this.started = true
    await Promise.all([
      this.state.getSnapshot().catalogStatus === 'idle' ? this.reloadCatalog() : undefined,
      this.state.getSnapshot().indexesStatus === 'idle' ? this.reloadIndexes() : undefined,
    ])
  }

  async refresh(): Promise<void> {
    this.started = true
    await Promise.all([this.reloadCatalog(), this.reloadIndexes()])
  }

  async reset(): Promise<void> {
    if (!this.started) return
    this.publish({ catalog: null, indexes: [], changed: null })
    await this.refresh()
  }

  async catalogSettingsChanged(): Promise<void> {
    if (this.started) await this.reloadCatalog(true)
  }

  async reloadCatalog(clear = false): Promise<void> {
    if (this.disposed) return
    this.catalogRequest?.abort()
    const request = new AbortController()
    this.catalogRequest = request
    const revision = ++this.catalogRevision
    this.publish({ catalogStatus: 'loading', catalogError: null, ...(clear ? { catalog: null } : {}) })
    try {
      const catalog = await this.readCatalog(request.signal)
      if (revision === this.catalogRevision && !request.signal.aborted) {
        this.publish({ catalog, catalogStatus: 'ready' })
      }
    } catch (error) {
      if (revision === this.catalogRevision && !request.signal.aborted) {
        if (error instanceof CatalogError && error.code === 'not-configured') {
          this.publish({ catalog: null, catalogStatus: 'disabled', catalogError: null })
        } else {
          this.publish({ catalogStatus: 'error', catalogError: errorMessage(error) })
        }
      }
    }
  }

  async reloadIndexes(): Promise<void> {
    const registry = this.registry
    if (registry === undefined || this.disposed) return
    this.indexRequest?.abort()
    const request = new AbortController()
    this.indexRequest = request
    const revision = ++this.indexRevision
    this.publish({ indexesStatus: 'loading', indexesError: null })
    try {
      const available = await registry.isAvailable(request.signal)
      if (revision !== this.indexRevision || request.signal.aborted) return
      if (!available) {
        this.publish({ indexes: [], indexesStatus: 'unavailable', indexesError: null })
        return
      }
      const indexes = await registry.listIndexes()
      if (revision === this.indexRevision && !request.signal.aborted) {
        this.publish({ indexes, indexesStatus: 'ready' })
      }
    } catch (error) {
      if (revision === this.indexRevision && !request.signal.aborted) {
        this.publish({ indexesStatus: 'error', indexesError: errorMessage(error) })
      }
    }
  }

  async add(url: string): Promise<boolean> {
    return this.mutate('add', url)
  }

  async remove(url: string): Promise<void> {
    await this.mutate('remove', url)
  }

  private async mutate(kind: 'add' | 'remove', input: string): Promise<boolean> {
    const registry = this.registry
    if (registry === undefined || this.disposed) {
      this.publish({ mutationError: 'Enable Custom plugin indexes in the Harness Plugins page before changing sources.' })
      return false
    }
    if (this.state.getSnapshot().pending !== null) {
      this.publish({ mutationError: 'Another index source change is still in progress.' })
      return false
    }
    const request = new AbortController()
    this.mutationRequest = request
    this.publish({ pending: input, mutationError: null, changed: null })
    try {
      const url = kind === 'add' ? normalizeIndexUrl(input) : input
      const available = await registry.isAvailable(request.signal)
      if (this.registry !== registry || request.signal.aborted) return false
      if (!available) {
        ++this.indexRevision
        this.indexRequest?.abort()
        this.publish({ indexes: [], indexesStatus: 'unavailable', indexesError: null })
        throw new Error('Enable Custom plugin indexes in the Harness Plugins page before changing sources.')
      }
      const indexes = await registry.listIndexes()
      const key = configuredIndexKey(url)
      const found = indexes.some(index => configuredIndexKey(index.url) === key)
      const urls = indexes.map(index => index.url)
      const next = kind === 'add'
        ? found ? urls : [...urls, url]
        : urls.filter(value => configuredIndexKey(value) !== key)
      if (this.registry !== registry || request.signal.aborted) return false
      if ((kind === 'add' && !found) || (kind === 'remove' && found)) {
        await registry.setIndexes(next)
      }
      if (this.registry !== registry || request.signal.aborted) return false
      ++this.indexRevision
      this.indexRequest?.abort()
      this.publish({
        indexes: next.map(value => indexes.find(index => index.url === value) ?? { url: value }),
        indexesStatus: 'ready', indexesError: null, changed: { kind, url },
      })
      await this.reloadIndexes()
      return !request.signal.aborted
    } catch (error) {
      if (!request.signal.aborted) this.publish({ mutationError: errorMessage(error) })
      return false
    } finally {
      if (this.mutationRequest === request) {
        this.mutationRequest = undefined
        this.publish({ pending: null })
      }
    }
  }

  face(resolveText: PluginIndexesFace['resolveText'], getLocale: PluginIndexesFace['getLocale']): PluginIndexesFace {
    return {
      hooks: { pluginIndexes: this.state },
      load: () => { void this.load() },
      reloadCatalog: () => { void this.reloadCatalog() },
      reloadIndexes: () => { void this.reloadIndexes() },
      add: url => this.add(url),
      remove: url => { void this.remove(url) },
      resolveText,
      getLocale,
    }
  }

  dispose(): void {
    this.disposed = true
    this.catalogRequest?.abort()
    this.indexRequest?.abort()
    this.mutationRequest?.abort()
  }
}
