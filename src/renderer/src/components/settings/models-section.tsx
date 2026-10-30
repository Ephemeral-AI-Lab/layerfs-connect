import { Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { AgentModels, AgentProvider } from '@shared/agent-api'

import { CustomProviderCard } from '@/components/settings/custom-provider'
import { SmallModal } from '@/components/settings/parts'
import { providerLabel, providerName, ProviderEditor } from '@/components/settings/provider-editor'
import { publishModels } from '@/components/settings/settings-context'
import { agentHost } from '@/host/agent-client'
import { useI18n } from '@/i18n'

type AddMode = 'catalog' | 'custom'

const configured = (p: AgentProvider) => p.custom || p.hasKey
const builtInCount = (catalog: AgentModels, p: AgentProvider) => Math.max(0, catalog.models.filter((m) => m.provider === p.id).length - (p.savedModels?.length ?? 0))

/**
 * Settings → Models, after DeepSeek Harness: one card per configured provider
 * (its name, a Custom tag, a configured / missing dot or "Signed in", Edit and
 * Delete), one editor open at a time, and a dashed "Add model provider" that
 * opens a card with two ways to add one: a third-party provider Pi ships, or
 * a custom model API.
 */
export function ModelsSection() {
  const { t } = useI18n()
  const [catalog, setCatalog] = useState<AgentModels>()
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState<string>()
  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<AddMode>('catalog')
  const [visited, setVisited] = useState<ReadonlySet<AddMode>>(() => new Set())
  const [adding, setAdding] = useState<string>()
  const [addBusy, setAddBusy] = useState(false)
  const [saved, setSaved] = useState<AgentProvider>()
  const [deleteTarget, setDeleteTarget] = useState<AgentProvider>()
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState('')
  const addId = useId()
  /** The catalog the add card's last save returned, to name what it added. */
  const addSaved = useRef<AgentModels | undefined>(undefined)

  async function load() {
    setLoadError('')
    try {
      setCatalog(await agentHost.models())
    } catch (error) {
      setLoadError((error as Error).message)
    }
  }
  useEffect(() => { void load() }, [])

  /** A saved catalog: shown here, and handed to every open chat. */
  function apply(next: AgentModels) {
    setCatalog(next)
    publishModels(next)
  }

  /** With no model chosen yet, new chats use the first model of the provider just set up. */
  async function chooseFirstModel(next: AgentModels, provider: string) {
    const first = next.models.find((model) => model.provider === provider)
    if (next.selected || !first) return
    try {
      apply(await agentHost.saveModels({ provider, modelId: first.id, thinkingLevel: 'off' }))
    } catch {
      // the provider is saved either way; a model can be chosen in the chat
    }
  }

  function announce(next: AgentModels, id: string) {
    const provider = next.providers.find((p) => p.id === id)
    if (provider) setSaved(provider)
    void chooseFirstModel(next, id)
  }

  function closeAdd() {
    setAddOpen(false)
    setAdding(undefined)
    setAddBusy(false)
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setDeleteFailure('')
    try {
      apply(await agentHost.removeProvider(deleteTarget.id))
      if (editing === deleteTarget.id) setEditing(undefined)
      setDeleteTarget(undefined)
    } catch (error) {
      setDeleteFailure(t((error as Error).message))
    } finally {
      setDeleting(false)
    }
  }

  if (!catalog) {
    return <div className="st-section">
      <h2 className="st-title">{t('Models')}</h2>
      <p className="st-intro">{t('Enter your API keys to use models from the following providers.')}</p>
      {loadError && <>
        <p className="st-error">{t('Loading the provider directory failed')}: {t(loadError)}</p>
        <div><button type="button" className="st-btn" onClick={() => void load()}>{t('Retry')}</button></div>
      </>}
    </div>
  }

  const rows = catalog.providers.filter(configured)
  const addable = catalog.providers.filter((p) => !configured(p) && p.builtIn !== false).sort((a, b) => providerName(a).localeCompare(providerName(b)))
  const catalogEnabled = addable.length > 0
  const mode: AddMode = catalogEnabled ? addMode : 'custom'
  const draft = addable.find((p) => p.id === adding) ?? addable[0]
  const mounted = (candidate: AddMode) => mode === candidate || visited.has(candidate)
  const deleteSignsOut = Boolean(deleteTarget?.signedIn)

  return <div className="st-section">
    <h2 className="st-title">{t('Models')}</h2>
    <p className="st-intro">{t('Enter your API keys to use models from the following providers.')}</p>
    {saved && <p className="st-saved" role="status" aria-live="polite">{t('Saved {provider}.', { provider: providerLabel(saved) })}</p>}

    <ul className="st-rows">
      {rows.map((p) => {
        const open = !addOpen && editing === p.id
        return <li key={p.id} className="st-row" data-provider={p.id}>
          <div className="st-row-head">
            <span className="st-row-identity">
              <span className="st-row-name" title={providerLabel(p)}>{providerName(p)}</span>
              {p.builtIn === false && <span className="st-tag">{t('Custom')}</span>}
              {p.signedIn
                ? <span className="st-status"><span className="st-dot st-dot-ok" aria-hidden="true" />{t('Signed in')}</span>
                : p.hasKey
                  ? <span className="st-dot st-dot-ok" role="img" aria-label={t('API key configured')} title={t('API key configured')} />
                  : <span className="st-dot st-dot-missing" role="img" aria-label={t('API key missing')} title={t('API key missing')} />}
            </span>
            <span className="st-row-actions">
              <button
                type="button"
                className="st-btn st-sm"
                aria-label={t('Edit {provider}', { provider: providerLabel(p) })}
                aria-expanded={open}
                onClick={() => {
                  setSaved(undefined)
                  closeAdd()
                  setEditing(open ? undefined : p.id)
                }}
              >
                {t('Edit')}
              </button>
              <button
                type="button"
                className="st-btn-danger st-sm"
                aria-label={(p.signedIn ? t('Sign out of {provider}', { provider: providerLabel(p) }) : t('Delete {provider}', { provider: providerLabel(p) }))}
                onClick={() => {
                  setSaved(undefined)
                  setDeleteFailure('')
                  setDeleteTarget(p)
                }}
              >
                {p.signedIn ? t('Sign out') : t('Delete')}
              </button>
            </span>
          </div>
          {open && <ProviderEditor
            key={p.id}
            provider={p}
            builtInCount={builtInCount(catalog, p)}
            onSaved={apply}
            onClose={(changed) => {
              setEditing(undefined)
              if (changed) setSaved(p)
            }}
            onSignOut={() => setDeleteTarget(p)}
          />}
        </li>
      })}
    </ul>

    {addOpen ? <div className="st-add-card">
      <div className="st-add-modes">
        <div className="st-seg" role="tablist" aria-label={t('How to add')}>
          {(['catalog', 'custom'] as const).map((value) => <button
            key={value}
            id={`${addId}-${value}`}
            type="button"
            role="tab"
            aria-selected={mode === value}
            aria-controls={`${addId}-${value}-panel`}
            disabled={addBusy || (value === 'catalog' && !catalogEnabled)}
            title={value === 'catalog' && !catalogEnabled ? t('Every catalog provider is already configured.') : undefined}
            onClick={() => {
              setAddMode(value)
              setVisited((current) => new Set([...current, value]))
            }}
          >
            {value === 'catalog' ? t('Third-party model provider') : t('Custom model API')}
          </button>)}
        </div>
        <p className="st-hint">{mode === 'catalog'
          ? t('Pick OpenAI, Anthropic, Kimi, or another provider from the built-in catalog and enter its API key.')
          : t('Connect a relay, a self-hosted server, or any other OpenAI- or Anthropic-compatible endpoint by its base URL, protocol, and models.')}</p>
      </div>

      {mounted('catalog') && draft && <div id={`${addId}-catalog-panel`} role="tabpanel" aria-labelledby={`${addId}-catalog`} hidden={mode !== 'catalog'} className="st-add-panel">
        <div className="st-field">
          <span className="st-label">{t('Provider')}</span>
          <select className="st-input" value={draft.id} aria-label={t('Provider')} disabled={addBusy} onChange={(event) => setAdding(event.target.value)}>
            {addable.map((p) => <option key={p.id} value={p.id}>{providerName(p)}</option>)}
          </select>
        </div>
        <ProviderEditor
          key={draft.id}
          provider={draft}
          builtInCount={builtInCount(catalog, draft)}
          adding
          hideTitle
          onBusyChange={setAddBusy}
          onSaved={(next) => {
            addSaved.current = next
            apply(next)
          }}
          onClose={(changed) => {
            closeAdd()
            if (changed && addSaved.current) announce(addSaved.current, draft.id)
          }}
          onSignOut={() => setDeleteTarget(draft)}
        />
      </div>}

      {mounted('custom') && <div id={`${addId}-custom-panel`} role="tabpanel" aria-labelledby={`${addId}-custom`} hidden={mode !== 'custom'} className="st-add-panel">
        <CustomProviderCard
          taken={catalog.providers.map((p) => p.id)}
          onBusyChange={setAddBusy}
          onClose={closeAdd}
          onCreated={(next, id) => {
            apply(next)
            closeAdd()
            announce(next, id)
          }}
        />
      </div>}
    </div> : <div style={{ display: 'flex' }}>
      <button
        type="button"
        className="st-add"
        onClick={() => {
          const initial: AddMode = catalogEnabled ? 'catalog' : 'custom'
          setSaved(undefined)
          setEditing(undefined)
          setAdding(addable[0]?.id)
          setAddMode(initial)
          setVisited(new Set([initial]))
          setAddOpen(true)
        }}
      >
        <Plus className="size-3.5" />
        {t('Add model provider')}
      </button>
    </div>}

    <SmallModal
      open={deleteTarget !== undefined}
      role="alertdialog"
      onClose={() => { if (!deleting) setDeleteTarget(undefined) }}
      title={deleteTarget ? (deleteSignsOut ? t('Sign out of {provider}?', { provider: providerLabel(deleteTarget) }) : t('Delete {provider}?', { provider: providerLabel(deleteTarget) })) : ''}
      description={deleteTarget ? (deleteSignsOut
        ? t('Signing out removes Connect’s sign-in for {provider} and its saved settings. Other apps on this machine stay signed in.', { provider: providerLabel(deleteTarget) })
        : deleteTarget.hasKey
          ? t('Deleting {provider} removes its configuration and stored API key.', { provider: providerLabel(deleteTarget) })
          : t('Deleting {provider} removes its configuration.', { provider: providerLabel(deleteTarget) })) : ''}
      footer={<>
        <button type="button" className="st-btn" disabled={deleting} onClick={() => setDeleteTarget(undefined)}>{t('Cancel')}</button>
        <button type="button" className="st-btn st-btn-danger st-outlined" disabled={deleting} onClick={() => void confirmDelete()}>
          {deleteTarget && (deleteSignsOut
            ? (deleting ? t('Signing out…') : t('Sign out'))
            : deleting ? t('Deleting {provider}…', { provider: providerLabel(deleteTarget) }) : t('Delete {provider}', { provider: providerLabel(deleteTarget) }))}
        </button>
      </>}
    >
      {deleteFailure && <p className="st-error">{deleteFailure}</p>}
    </SmallModal>
  </div>
}
