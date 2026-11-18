import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigPageForm } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_CATALOG_URL, errorMessage, normalizeCatalogUrl } from '../catalog.ts'

type Localized = PropsLocale<'dshPluginAcademy'>
export type CatalogForm = ConfigForm<Record<string, unknown>>

export function CatalogSettings({ t, view, form }: PropsRuntime<'plugins.row.config'> & Localized) {
  if (view === 'summary') return t('description')
  return <CatalogUrlEditor t={t} form={form} />
}

export function CatalogSettingsDialog({ t, catalogForm, close }: Localized & {
  catalogForm: CatalogForm
  close: () => void
}) {
  const subscribe = useCallback((listener: () => void) => catalogForm.subscribe(listener), [catalogForm])
  const getSnapshot = useCallback(() => catalogForm.getSnapshot(), [catalogForm])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  return <CatalogUrlEditor t={t} form={{ state, mutate: (ops, revision) => catalogForm.mutate(ops, revision) }} close={close} />
}

function CatalogUrlEditor({ t, form, close }: Localized & {
  form: ConfigPageForm | undefined
  close?: () => void
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const choiceRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<{ value: string; addedOnly: boolean; revision: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'saveFailed' | null>(null)
  const [invalid, setInvalid] = useState<'catalogUrlRequired' | 'invalidCatalogUrl' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const dirty = draft !== null
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const state = form?.state
  const accepted = typeof state?.value?.catalogUrl === 'string' ? state.value.catalogUrl : undefined
  const acceptedAddedOnly = accepted?.trim() === ''
  const acceptedUrl = acceptedAddedOnly ? '' : accepted ?? ''
  const addedOnly = draft?.addedOnly ?? acceptedAddedOnly
  const value = draft?.value ?? acceptedUrl
  const revision = state?.revision
  const stale = draft !== null && draft.revision !== revision
  const blocked = saving || state?.writable !== true

  function edit(value: string, addedOnly = false) {
    if (revision === undefined) return
    const unchanged = addedOnly === acceptedAddedOnly && (addedOnly || value === acceptedUrl)
    setDraft(unchanged ? null : { value, addedOnly, revision: draft?.revision ?? revision })
    setNotice(null)
    setInvalid(null)
    setFailure(null)
  }

  async function save() {
    if (blocked || stale || draft === null || form === undefined) return
    let url = ''
    if (!draft.addedOnly) {
      const input = draft.value.trim()
      try {
        url = normalizeCatalogUrl(input)
      } catch {
        setInvalid(input === '' ? 'catalogUrlRequired' : 'invalidCatalogUrl')
        inputRef.current?.focus()
        return
      }
    }

    setSaving(true)
    setNotice(null)
    setFailure(null)
    try {
      if (await form.mutate([{ op: 'set', path: ['catalogUrl'], value: url }], draft.revision)) {
        setDraft(null)
        setNotice('saved')
      } else {
        setNotice('saveFailed')
      }
    } catch (error) {
      setNotice('saveFailed')
      setFailure(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const body = state === undefined || state.status === 'unavailable' ? (
    <p role="status">{t('settingsUnavailable')}</p>
  ) : state.status === 'loading' || revision === undefined ? (
    <p role="status">{t('settingsLoading')}</p>
  ) : (
    <form className="dsh-plugin-academy dsh-plugin-academy-settings" noValidate onSubmit={event => {
      event.preventDefault()
      void save()
    }}>
      <label className="dsh-plugin-academy-settings-choice">
        <input ref={choiceRef} type="checkbox" name="addedIndexesOnly" checked={addedOnly} disabled={blocked}
          aria-labelledby={`${id}-choice`} aria-describedby={`${id}-choice-hint`}
          onChange={event => edit(value, event.currentTarget.checked)} />
        <span>
          <strong id={`${id}-choice`}>{t('addedIndexesOnly')}</strong>
          <span className="dsh-plugin-academy-muted" id={`${id}-choice-hint`}>{t('addedIndexesOnlyHint')}</span>
        </span>
      </label>
      {addedOnly ? null : (
        <>
          <div className="dsh-plugin-academy-field">
            <label htmlFor={id}>{t('catalogUrl')}</label>
            <Input ref={inputRef} id={id} name="catalogUrl" type="url" inputMode="url" autoComplete="off"
              spellCheck={false} autoCapitalize="none" translate="no" value={value}
              disabled={blocked} placeholder={`${DEFAULT_CATALOG_URL}\u2026`} aria-describedby={`${id}-hint ${id}-error`}
              aria-invalid={invalid !== null} onChange={event => edit(event.target.value)} />
            <p className="dsh-plugin-academy-muted" id={`${id}-hint`}>{t('catalogHint')}</p>
            <p className="dsh-plugin-academy-error" id={`${id}-error`} aria-live="polite">
              {invalid === null ? null : t(invalid)}
            </p>
          </div>
          {accepted === undefined && !dirty ? <p className="dsh-plugin-academy-muted">{t('catalogInherited')}</p> : null}
          <div className="dsh-plugin-academy-actions">
            <Button size="sm" variant="outline" type="button" disabled={blocked || stale}
              onClick={() => edit(DEFAULT_CATALOG_URL)}>{t('useAcademy')}</Button>
          </div>
        </>
      )}
      {!state.writable ? <p role="status">{t('settingsUnavailable')}</p> : null}
      <div className="dsh-plugin-academy-feedback" role="status" aria-live="polite">
        {stale ? t('settingsChanged') : notice === null ? null : t(notice)}
        {failure === null ? null : <p className="dsh-plugin-academy-error">{failure}</p>}
      </div>
      <div className="dsh-plugin-academy-actions dsh-plugin-academy-settings-footer">
        {close === undefined ? null : <Button variant="outline" type="button" disabled={saving} onClick={close}>
          {draft === null ? t('close') : t('cancel')}
        </Button>}
        {stale ? (
          <Button type="button" disabled={saving} onClick={() => {
            setDraft(null)
            setNotice(null)
            setInvalid(null)
            setFailure(null)
            choiceRef.current?.focus()
          }}>{t('reloadSavedSettings')}</Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={blocked || !dirty || stale}
          icon={saving ? <span className="dsh-plugin-academy-spinner" aria-hidden="true" /> : undefined}>
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  )

  return close === undefined ? body : (
    <Modal open closeLabel={t('close')} title={t('configure')} description={t('settingsDescription')}
      className="dsh-plugin-academy-settings-dialog" contentClassName="dsh-plugin-academy-modal-scroll"
      onClose={() => { if (!saving) close() }}>
      {body}
    </Modal>
  )
}
