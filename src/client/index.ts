import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { CatalogError, PLUGIN_ID, parseCatalog, type Catalog } from '../catalog.ts'
import { PluginIndexesController } from './controller.ts'
import { indexRegistry } from './registry.ts'
import { PluginIndexesTab } from './PluginIndexesTab.tsx'
import { CatalogSettings } from './CatalogSettings.tsx'
import { en, zh, type LocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    dshPluginAcademy: LocaleKey
  }
}

export const inject = ['slots', 'locale', 'remote', 'configForms']

declare const __DSH_PLUGIN_ACADEMY_CSS__: string

async function readJson(path: 'catalog' | 'status', signal: AbortSignal): Promise<unknown> {
  const response = await fetch(new URL(`api/dsh-plugin-academy/${path}`, document.baseURI), {
    signal, credentials: 'same-origin', cache: 'no-store',
  })
  if (!response.ok) {
    let reason = `${path === 'catalog' ? 'Catalog' : 'Index registry status'} request failed: HTTP ${response.status}.`
    if (response.headers.get('content-type')?.includes('application/json')) {
      const payload: unknown = await response.json()
      if (payload !== null && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
        reason = payload.error
        if (path === 'catalog' && 'code' in payload && payload.code === 'not-configured') {
          throw new CatalogError('not-configured', reason)
        }
      }
    }
    throw new Error(reason)
  }
  return response.json()
}

async function readCatalog(signal: AbortSignal): Promise<Catalog> {
  return parseCatalog(await readJson('catalog', signal))
}

async function readAvailability(signal: AbortSignal): Promise<boolean> {
  const payload = await readJson('status', signal)
  if (payload !== null && typeof payload === 'object' && 'available' in payload && typeof payload.available === 'boolean') {
    return payload.available
  }
  throw new Error('Harness returned an invalid index registry status.')
}

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const stylesheet = document.createElement('style')
    stylesheet.dataset.plugin = '@plugin-academy/dsh-plugin-academy'
    stylesheet.dataset.pluginCss = '@plugin-academy/dsh-plugin-academy:src/client/styles.css'
    stylesheet.textContent = __DSH_PLUGIN_ACADEMY_CSS__
    document.head.appendChild(stylesheet)
    return () => stylesheet.remove()
  }, 'dsh-plugin-academy: styles')
  ctx.effect(() => ctx.locale.register('dshPluginAcademy', { en, zh }), 'dsh-plugin-academy: dictionary')
  const controller = new PluginIndexesController(readCatalog)
  const catalogForm = ctx.configForms.get<Record<string, unknown>>(PLUGIN_ID)
  ctx.effect(() => () => controller.dispose(), 'dsh-plugin-academy: controller')
  ctx.effect(() => {
    let ready = false
    let catalogUrl: unknown
    const sync = () => {
      const current = catalogForm.getSnapshot()
      if (current.status !== 'ready') return
      const next = current.value?.catalogUrl
      if (ready && catalogUrl !== next) void controller.catalogSettingsChanged()
      ready = true
      catalogUrl = next
    }
    sync()
    return catalogForm.subscribe(sync)
  }, 'dsh-plugin-academy: follow saved catalog URL')
  ctx.inject(['remote.pluginMarket'], (scope) => {
    scope.effect(() => controller.attachRegistry(indexRegistry(scope.remote.pluginMarket, readAvailability)), 'dsh-plugin-academy: source registry')
    const reloadIfStarted = () => {
      if (controller.state.getSnapshot().indexesStatus !== 'idle') void controller.reloadIndexes()
    }
    scope.effect(() => scope.remote.$on('plugin-market/changed', reloadIfStarted), 'dsh-plugin-academy: source changes')
    scope.effect(() => scope.remote.$on('plugin-manager/changed', reloadIfStarted), 'dsh-plugin-academy: registry availability')
  })
  ctx.on('connection/reset', () => { void controller.reset() })
  const face = controller.face(text => ctx.locale.resolveText(text), () => ctx.locale.getSnapshot().active)
  const t = ctx.locale.bind('dshPluginAcademy')
  ctx.slots.inject('plugins.tab', () => ctx.slots.register({
    name: 'plugins.tab', id: 'plugin-indexes', order: 100,
    label: () => t('title'), locale: 'dshPluginAcademy', inject: () => ({ ...face, catalogForm }),
  }, PluginIndexesTab))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config', key: `@plugin-academy/dsh-plugin-academy#${PLUGIN_ID}`,
    locale: 'dshPluginAcademy',
  }, CatalogSettings))
}
