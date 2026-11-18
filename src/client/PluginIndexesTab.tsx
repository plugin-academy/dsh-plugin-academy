import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button, IconCheckOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  IconSearchOutlineRegular, IconSettingsOutlineRegular, Input, Modal, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketPlugin } from '@deepseek-ai/dsh-plugin-market-index'
import { configuredIndexKey, normalizeIndexUrl, type IndexSource, type TopPlugin } from '../catalog.ts'
import { CatalogSettingsDialog, type CatalogForm } from './CatalogSettings.tsx'
import { collectionIds, groupCollections } from './collections.ts'
import type { PluginIndexesFace, PluginIndexesState } from './controller.ts'
import { PreviewError, readIndexPreview } from './preview.ts'

type Localized = PropsLocale<'dshPluginAcademy'>
type Props = PropsRuntime<'plugins.tab'> & Localized & InjectFace<PluginIndexesFace & { catalogForm: CatalogForm }>

declare const __DSH_PLUGIN_ACADEMY_ICON__: string

const noSources: readonly IndexSource[] = []
const fold = (text: string) => text.normalize('NFKC').toLowerCase()
const collectionCopy = {
  academy: { title: 'academyCollection', description: 'academyCollectionDescription' },
  community: { title: 'communityCollection', description: 'communityCollectionDescription' },
  official: { title: 'officialCollection', description: 'officialCollectionDescription' },
  other: { title: 'otherCollections', description: 'otherCollectionsDescription' },
} as const

function searchText(source: IndexSource): string {
  return fold([
    source.title, source.description, source.url, source.publisher.name, source.publisher.id, ...source.tags,
    ...(source.pluginAcademy?.resourceNames ?? []),
    ...source.topPlugins.flatMap(plugin => [plugin.name, plugin.title, plugin.description]),
  ].join(' '))
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>
}

export function PluginIndexesTab(props: Props) {
  const { t } = props
  const state = props.usePluginIndexes(snapshot => snapshot)
  const id = useId()
  const browseHeading = useRef<HTMLHeadingElement>(null)
  const locale = props.getLocale()
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<'catalog' | 'custom' | null>(null)
  const [removing, setRemoving] = useState<{ url: string; title: string } | null>(null)
  const [previewSource, setPreviewSource] = useState<IndexSource | null>(null)
  useEffect(() => { props.load() }, [props.load])

  const sources = state.catalog?.sources ?? noSources
  const searchable = useMemo(() => sources.map(source => ({ source, text: searchText(source) })), [sources])
  const { groups, matchCount } = useMemo(() => {
    const terms = fold(query).trim().split(/\s+/).filter(Boolean)
    const matches = searchable.filter(({ text }) => terms.every(term => text.includes(term))).map(({ source }) => source)
    return { groups: groupCollections(matches), matchCount: matches.length }
  }, [searchable, query])
  const formats = useMemo(() => ({
    number: new Intl.NumberFormat(locale),
    date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }),
  }), [locale])
  const added = new Map(state.indexes.map(index => [configuredIndexKey(index.url), index]))
  const catalogKeys = new Set(sources.map(source => source.url))
  const other = state.indexes.filter(index => !catalogKeys.has(configuredIndexKey(index.url)))
  const canEdit = state.indexesStatus === 'ready' && state.pending === null
  const loadingCatalog = state.catalogStatus === 'idle' || state.catalogStatus === 'loading'
  const openSettings = () => setDialog('catalog')

  return (
    <section className="dsh-plugin-academy" aria-labelledby={`${id}-title`}>
      <header className="dsh-plugin-academy-hero">
        <div className="dsh-plugin-academy-intro">
          <img className="dsh-plugin-academy-mark" src={__DSH_PLUGIN_ACADEMY_ICON__} alt="" width={44} height={44} />
          <div className="dsh-plugin-academy-main">
            <p className="dsh-plugin-academy-eyebrow">{t('eyebrow')}</p>
            <h2 id={`${id}-title`}>{t('title')}</h2>
            <p className="dsh-plugin-academy-muted">{t('description')}</p>
          </div>
        </div>
        <div className="dsh-plugin-academy-actions">
          <Button variant="outline" icon={<IconSettingsOutlineRegular size={16} aria-hidden="true" />}
            aria-haspopup="dialog" onClick={openSettings}>{t('configure')}</Button>
          <Button variant="primary" icon={<IconPlusOutlineRegular size={16} aria-hidden="true" />}
            aria-haspopup="dialog" disabled={!canEdit} onClick={() => setDialog('custom')}>{t('addByUrl')}</Button>
        </div>
      </header>

      <div className="dsh-plugin-academy-feedback" role="status" aria-live="polite">
        {state.indexesStatus === 'unavailable' ? <p className="dsh-plugin-academy-notice">{t('unavailable')}</p> : null}
        {state.indexesStatus === 'loading' && state.indexes.length === 0 ? <p>{t('loadingIndexes')}</p> : null}
        {state.mutationError === null ? null : <p className="dsh-plugin-academy-error">{state.mutationError}</p>}
      </div>
      <div className="dsh-plugin-academy-success" data-visible={state.changed !== null || undefined}>
        <p className="dsh-plugin-academy-feedback dsh-plugin-academy-main" role="status" aria-live="polite">
          {state.changed === null ? null : t(state.changed.kind === 'add' ? 'addedNotice' : 'removedNotice')}
        </p>
        {state.changed === null ? null : (
          <Button variant="outline" size="sm" aria-label={t('closeIndexNotice')} onClick={() => {
            browseHeading.current?.focus()
            props.dismissChange()
          }}>{t('close')}</Button>
        )}
      </div>
      {state.indexesError === null ? null : (
        <div className="dsh-plugin-academy-notice dsh-plugin-academy-actions">
          <p role="status">{t('indexesFailed')} {state.indexesError}</p>
          <Button variant="outline" size="sm" onClick={props.reloadIndexes}>{t('retry')}</Button>
        </div>
      )}

      <section className="dsh-plugin-academy-group" aria-labelledby={`${id}-browse`}>
        <div className="dsh-plugin-academy-section-head">
          <div>
            <h3 id={`${id}-browse`} ref={browseHeading} tabIndex={-1}>{t('browseCatalog')}</h3>
            <p className="dsh-plugin-academy-muted" role="status">
              {state.catalog === null ? null : t('results', {
                count: formats.number.format(matchCount), total: formats.number.format(sources.length),
              })}
            </p>
          </div>
          {state.catalogStatus === 'disabled' ? null : (
            <Button variant="outline" size="sm" icon={loadingCatalog
              ? <span className="dsh-plugin-academy-spinner" aria-hidden="true" />
              : <IconRefreshOutlineRegular size={16} aria-hidden="true" />}
            onClick={props.reloadCatalog} disabled={loadingCatalog}>
              {loadingCatalog ? t('refreshing') : t('refresh')}
            </Button>
          )}
        </div>
        {sources.length === 0 ? null : (
          <Input type="search" name="indexSearch" value={query} autoComplete="off" spellCheck={false}
            icon={<IconSearchOutlineRegular size={16} aria-hidden="true" />}
            aria-label={t('search')} placeholder={t('searchPlaceholder')} onChange={event => setQuery(event.target.value)} />
        )}

        <div className="dsh-plugin-academy-feedback" role="status" aria-live="polite">
          {loadingCatalog && state.catalog === null ? <p className="dsh-plugin-academy-empty">{t('loadingCatalog')}</p> : null}
          {state.catalogStatus === 'ready' && sources.length === 0
            ? <p className="dsh-plugin-academy-empty">{t('empty')}</p> : null}
          {sources.length > 0 && matchCount === 0 ? <p className="dsh-plugin-academy-empty">{t('noMatches')}</p> : null}
        </div>
        {state.catalogStatus === 'disabled' || state.catalogError !== null ? (
          <div className="dsh-plugin-academy-notice dsh-plugin-academy-actions">
            <div className="dsh-plugin-academy-main" role="status">
              <p>{t(state.catalogStatus === 'disabled' ? 'catalogDisabled' : 'catalogFailed')}</p>
              {state.catalogError === null ? null : <p className="dsh-plugin-academy-error">{state.catalogError}</p>}
              {state.catalog !== null ? <p className="dsh-plugin-academy-muted">{t('previousCatalog')}</p> : null}
            </div>
            <Button variant="outline" size="sm" aria-haspopup="dialog" onClick={openSettings}>{t('configure')}</Button>
          </div>
        ) : null}
        {collectionIds.map(collection => {
          const matches = groups[collection]
          if (matches.length === 0) return null
          const heading = `${id}-${collection}`
          const copy = collectionCopy[collection]
          return (
            <section key={collection} className="dsh-plugin-academy-collection" data-collection={collection} aria-labelledby={heading}>
              <div className="dsh-plugin-academy-collection-heading">
                <h4 id={heading}>{t(copy.title)}</h4>
                <p className="dsh-plugin-academy-muted">{t(copy.description)}</p>
              </div>
              <ul className="dsh-plugin-academy-cards" role="list" data-many={matches.length > 50 || undefined}>
                {matches.map(source => {
                  const configured = added.get(source.url)
                  return <CatalogCard key={source.url} source={source} t={t} formats={formats}
                    onPreview={() => setPreviewSource(source)}
                    configured={configured} pending={state.pending !== null && configuredIndexKey(state.pending) === source.url}
                    disabled={!canEdit} onToggle={() => {
                      if (configured === undefined) void props.add(source.url)
                      else setRemoving({ url: configured.url, title: source.title })
                    }} />
                })}
              </ul>
            </section>
          )
        })}
      </section>

      {other.length === 0 ? null : (
        <section className="dsh-plugin-academy-group" aria-labelledby={`${id}-added`}>
          <div>
            <h3 id={`${id}-added`}>{t(state.catalogStatus === 'disabled' ? 'addedSources' : 'otherSources')}</h3>
            {state.catalogStatus === 'disabled' ? null : <p className="dsh-plugin-academy-muted">{t('otherDescription')}</p>}
          </div>
          <ul className="dsh-plugin-academy-cards" data-many={other.length > 50 || undefined}>
            {other.map(index => {
              const title = index.title === undefined ? index.url : props.resolveText(index.title)
              return (
                <li key={index.url} className="dsh-plugin-academy-card">
                  <h4>{title}</h4>
                  {index.title === undefined ? null : <code className="dsh-plugin-academy-url" translate="no">{index.url}</code>}
                  {index.error === undefined ? null : <p className="dsh-plugin-academy-error">{index.error}</p>}
                  <IndexCardFooter t={t} added>
                    <Button variant="outline" size="sm" disabled={!canEdit} aria-label={t('removeNamed', { name: title })}
                      aria-haspopup="dialog" onClick={() => setRemoving({ url: index.url, title })}>
                      {state.pending === index.url ? t('saving') : t('remove')}
                    </Button>
                  </IndexCardFooter>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <p className="dsh-plugin-academy-trust">{t('trust')}</p>
      {previewSource === null ? null : (
        <IndexPreviewDialog key={previewSource.url} t={t} source={previewSource} number={formats.number}
          locale={locale} resolveText={props.resolveText} close={() => setPreviewSource(null)} />
      )}
      {dialog === 'catalog' ? <CatalogSettingsDialog t={t} catalogForm={props.catalogForm} close={() => setDialog(null)} /> : null}
      {dialog === 'custom' ? (
        <CustomIndexDialog t={t} close={() => setDialog(null)} add={props.add} added={added}
          disabled={!canEdit} failure={state.mutationError} />
      ) : null}
      {removing === null ? null : (
        <Modal open title={t('removeTitle')} tone="warning" closeLabel={t('close')} onClose={() => setRemoving(null)}
          footer={(
            <>
              <Button variant="outline" data-modal-autofocus onClick={() => setRemoving(null)}>{t('cancel')}</Button>
              <Button variant="primary" disabled={!canEdit} onClick={() => {
                props.remove(removing.url)
                setRemoving(null)
              }}>{t('remove')}</Button>
            </>
          )}>
          <p>{t('removeDescription', { name: removing.title })}</p>
        </Modal>
      )}
    </section>
  )
}

function CatalogCard({ t, source, formats, configured, pending, disabled, onToggle, onPreview }: Localized & {
  source: IndexSource
  formats: { number: Intl.NumberFormat; date: Intl.DateTimeFormat }
  configured: PluginIndexesState['indexes'][number] | undefined
  pending: boolean
  disabled: boolean
  onToggle: () => void
  onPreview: () => void
}) {
  const names = source.pluginAcademy?.resourceNames ?? []
  const preview = names.slice(0, 5)
  const insecure = source.url.startsWith('http:')
  return (
    <li className="dsh-plugin-academy-card">
      <div className="dsh-plugin-academy-card-heading">
        <div className="dsh-plugin-academy-card-identity">
          <h5 translate="no">{source.title}</h5>
          <p className="dsh-plugin-academy-muted">
            {t('publisher')}{' '}
            {source.publisher.url === undefined ? source.publisher.name : (
              <ExternalLink href={source.publisher.url}>{source.publisher.name}</ExternalLink>
            )}
          </p>
        </div>
        <p className="dsh-plugin-academy-count">
          <strong>{formats.number.format(source.pluginCount)}</strong>{' '}
          <span>{t(source.pluginCount === 1 ? 'pluginCountUnit' : 'pluginCountPluralUnit')}</span>
        </p>
      </div>
      {source.description === undefined ? null : <p className="dsh-plugin-academy-description">{source.description}</p>}
      {source.updatedAt === undefined && !insecure ? null : (
        <div className="dsh-plugin-academy-meta">
          {source.updatedAt === undefined ? null : (
            <time dateTime={source.updatedAt}>{t('updated', { date: formats.date.format(new Date(source.updatedAt)) })}</time>
          )}
          {insecure ? <Tag tone="warning">{t('insecure')}</Tag> : null}
        </div>
      )}
      {source.tags.length === 0 ? null : (
        <div className="dsh-plugin-academy-meta">{source.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>
      )}
      {preview.length === 0 ? null : (
        <div className="dsh-plugin-academy-meta">
          <span>{t('packages')}</span>
          {preview.map(name => <code key={name} className="dsh-plugin-academy-package" translate="no">{name}</code>)}
          {names.length === preview.length ? null : t('morePackages', { count: formats.number.format(names.length - preview.length) })}
        </div>
      )}
      {configured?.error === undefined ? null : <p className="dsh-plugin-academy-error">{configured.error}</p>}
      <details className="dsh-plugin-academy-details">
        <summary>{t('indexDetails')}</summary>
        {source.publisher.id === undefined ? null : <p>{t('publisherId')} <code translate="no">{source.publisher.id}</code></p>}
        <p><ExternalLink href={source.url}><code translate="no">{source.url}</code></ExternalLink></p>
      </details>
      <IndexCardFooter t={t} added={configured !== undefined}>
        <Button variant="outline" size="sm" aria-haspopup="dialog"
          aria-label={t('previewNamed', { name: source.title })} onClick={onPreview}>{t('previewPlugins')}</Button>
        <Button variant={configured === undefined ? 'primary' : 'outline'} size="sm" disabled={disabled}
          aria-label={pending ? t('saving') : t(configured === undefined ? 'addNamed' : 'removeNamed', { name: source.title })}
          aria-haspopup={configured === undefined ? undefined : 'dialog'} onClick={onToggle}>
          {pending ? t('saving') : t(configured === undefined ? 'add' : 'remove')}
        </Button>
      </IndexCardFooter>
    </li>
  )
}

function IndexCardFooter({ t, added, children }: Localized & { added: boolean; children: ReactNode }) {
  return (
    <div className="dsh-plugin-academy-card-footer">
      {added ? (
        <Tag tone="success" className="dsh-plugin-academy-added">
          <IconCheckOutlineRegular size={12} aria-hidden="true" />{t('added')}
        </Tag>
      ) : null}
      <div className="dsh-plugin-academy-actions">{children}</div>
    </div>
  )
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; plugins: readonly MarketPlugin[] }
  | { status: 'error'; error: PreviewError['code'] }

const pageSize = 12

function IndexPreviewDialog({ t, source, number, locale, resolveText, close }: Localized & {
  source: IndexSource
  number: Intl.NumberFormat
  locale: string
  resolveText: PluginIndexesFace['resolveText']
  close: () => void
}) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const request = new AbortController()
    void readIndexPreview(source.url, request.signal).then(plugins => {
      if (!request.signal.aborted) setState({ status: 'ready', plugins })
    }, error => {
      if (!request.signal.aborted) {
        setState({ status: 'error', error: error instanceof PreviewError ? error.code : 'previewUnavailable' })
      }
    })
    return () => request.abort()
  }, [source.url, attempt])
  const searchable = useMemo(() => state.status !== 'ready' ? [] : state.plugins.map(plugin => ({
    plugin, text: fold([
      plugin.name, plugin.title === undefined ? '' : resolveText(plugin.title), plugin.author,
      plugin.description === undefined ? '' : resolveText(plugin.description), ...plugin.metadata.keywords,
    ].join(' ')),
  })), [state, resolveText, locale])
  const matches = useMemo(() => {
    const terms = fold(query).trim().split(/\s+/).filter(Boolean)
    return terms.length === 0 ? searchable : searchable.filter(({ text }) => terms.every(term => text.includes(term)))
  }, [query, searchable])
  const page = matches.slice(offset, offset + pageSize)

  return (
    <Modal open title={t('previewTitle', { name: source.title })} description={t('previewIntro')} closeLabel={t('close')}
      className="dsh-plugin-academy-preview-dialog" contentClassName="dsh-plugin-academy-modal-scroll" onClose={close}>
      <div className="dsh-plugin-academy dsh-plugin-academy-preview">
        <p className="dsh-plugin-academy-muted"><ExternalLink href={source.url}>{t('openIndex')}</ExternalLink></p>
        {state.status === 'loading' ? (
          <div className="dsh-plugin-academy-actions dsh-plugin-academy-notice" role="status">
            <span className="dsh-plugin-academy-spinner" aria-hidden="true" />{t('previewLoading')}
          </div>
        ) : state.status === 'error' ? (
          <div className="dsh-plugin-academy-actions dsh-plugin-academy-notice">
            <p className="dsh-plugin-academy-main" role="status">{t(state.error)}</p>
            {state.error === 'previewUnavailable' || state.error === 'previewTimedOut' ? (
              <Button variant="outline" size="sm" onClick={() => {
                setState({ status: 'loading' })
                setAttempt(value => value + 1)
              }}>{t('retry')}</Button>
            ) : null}
          </div>
        ) : state.plugins.length === 0 ? (
          <p className="dsh-plugin-academy-empty" role="status">{t('previewEmpty')}</p>
        ) : (
          <>
            {state.plugins.length > 1 ? (
              <Input type="search" name="pluginPreviewSearch" value={query} autoComplete="off" spellCheck={false}
                icon={<IconSearchOutlineRegular size={16} aria-hidden="true" />}
                aria-label={t('previewSearch')} placeholder={t('previewPlaceholder')} onChange={event => {
                  setQuery(event.target.value)
                  setOffset(0)
                }} />
            ) : null}
            <div className="dsh-plugin-academy-section-head">
              <p className="dsh-plugin-academy-muted" role="status">
                {matches.length === 0 ? t('previewNoMatches') : matches.length <= pageSize
                  ? t(matches.length === 1 ? 'onePlugin' : 'plugins', { count: number.format(matches.length) })
                  : t('previewResults', {
                    start: number.format(offset + 1), end: number.format(offset + page.length), total: number.format(matches.length),
                  })}
              </p>
              {matches.length <= pageSize ? null : (
                <div className="dsh-plugin-academy-actions">
                  <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(offset - pageSize)}>
                    {t('previewPrevious')}
                  </Button>
                  <Button variant="outline" size="sm" disabled={offset + pageSize >= matches.length}
                    onClick={() => setOffset(offset + pageSize)}>{t('previewNext')}</Button>
                </div>
              )}
            </div>
            {page.length === 0 ? null : (
              <PluginPreviewList plugins={page.map(({ plugin }) => plugin)} t={t} resolveText={resolveText} />
            )}
          </>
        )}
        {state.status === 'ready' || source.topPlugins.length === 0 ? null : (
          <section className="dsh-plugin-academy-group">
            <h3>{t('topPlugins')}</h3>
            <p className="dsh-plugin-academy-muted">{t('previewHighlights')}</p>
            <PluginPreviewList plugins={source.topPlugins} t={t} resolveText={resolveText} />
          </section>
        )}
      </div>
    </Modal>
  )
}

function PluginPreviewList({ t, plugins, resolveText }: Localized & {
  plugins: readonly (MarketPlugin | TopPlugin)[]
  resolveText: PluginIndexesFace['resolveText']
}) {
  return (
    <ul className="dsh-plugin-academy-preview-list">
      {plugins.map(plugin => {
        const title = plugin.title === undefined ? plugin.name : resolveText(plugin.title) || plugin.name
        const description = plugin.description === undefined ? undefined : resolveText(plugin.description)
        const version = 'versions' in plugin ? plugin.versions[0]?.version : plugin.version
        const author = 'author' in plugin ? plugin.author : undefined
        const repository = 'repository' in plugin ? plugin.repository?.url : undefined
        return (
          <li key={plugin.name}>
            <div className="dsh-plugin-academy-title-row">
              <strong>{title}</strong>
              {version === undefined ? null : <code className="dsh-plugin-academy-package" translate="no">{version}</code>}
            </div>
            {title === plugin.name && author === undefined ? null : (
              <p className="dsh-plugin-academy-muted">
                {title === plugin.name ? null : <code translate="no">{plugin.name}</code>}
                {title === plugin.name || author === undefined ? null : ' \u00b7 '}
                {author === undefined ? null : t('previewAuthor', { name: author })}
              </p>
            )}
            {description ? <p>{description}</p> : null}
            {plugin.homepage === undefined && repository === undefined ? null : (
              <div className="dsh-plugin-academy-meta">
                {plugin.homepage === undefined || plugin.homepage === repository ? null : (
                  <ExternalLink href={plugin.homepage}>{t('previewHomepage')}</ExternalLink>
                )}
                {repository === undefined ? null : <ExternalLink href={repository}>{t('previewRepository')}</ExternalLink>}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function CustomIndexDialog({ t, close, add, added, disabled, failure }: Localized & {
  close: () => void
  add: PluginIndexesFace['add']
  added: ReadonlyMap<string, unknown>
  disabled: boolean
  failure: string | null
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<'invalidIndexUrl' | 'alreadyAdded' | null>(null)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function submit(value: string) {
    if (disabled || saving) return
    let url: string
    try {
      url = normalizeIndexUrl(value)
    } catch {
      setError('invalidIndexUrl')
      inputRef.current?.focus()
      return
    }
    if (added.has(url)) {
      setError('alreadyAdded')
      inputRef.current?.focus()
      return
    }
    setError(null)
    setSubmitted(true)
    setSaving(true)
    try {
      if (await add(url)) close()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open title={t('addByUrl')} description={t('customIndexHint')} closeLabel={t('close')}
      onClose={() => { if (!saving) close() }}>
      <form className="dsh-plugin-academy dsh-plugin-academy-settings" noValidate onSubmit={event => {
        event.preventDefault()
        void submit(inputRef.current?.value ?? '')
      }}>
        <div className="dsh-plugin-academy-field">
          <label htmlFor={id}>{t('customIndex')}</label>
          <Input ref={inputRef} id={id} name="indexUrl" type="url" inputMode="url" autoComplete="off" spellCheck={false}
            autoCapitalize="none" translate="no" placeholder={t('indexPlaceholder')} required readOnly={saving}
            aria-describedby={`${id}-error`} aria-invalid={error !== null} onChange={() => {
              setError(null)
              setSubmitted(false)
            }} />
          <p id={`${id}-error`} className="dsh-plugin-academy-error" aria-live="polite">
            {error === null ? submitted ? failure : null : t(error)}
          </p>
        </div>
        <div className="dsh-plugin-academy-actions dsh-plugin-academy-settings-footer">
          <Button variant="outline" disabled={saving} onClick={close}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={disabled || saving}
            icon={saving ? <span className="dsh-plugin-academy-spinner" aria-hidden="true" /> : undefined}>
            {saving ? t('saving') : t('add')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
