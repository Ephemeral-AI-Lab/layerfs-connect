import { useMemo, useState } from 'react'
import type { AgentModels, AgentProvider } from '@shared/agent-api'

import { ModelSignIn } from '@/components/chat/model-sign-in'
import { RequestHeaders, type RequestHeaderRow } from '@/components/chat/request-headers'
import { fromDrafts, modelListProblem, ModelListEditor, toDraft, type ModelDraft } from '@/components/settings/model-list'
import { ApiKeyInput, EditorFooter, PROTOCOLS } from '@/components/settings/parts'
import { agentHost } from '@/host/agent-client'
import { useI18n } from '@/i18n'

export const providerName = (p: Pick<AgentProvider, 'id' | 'name'>) => p.name || p.id

/** "Name (id)" when the two differ, for copy that names a provider. */
export const providerLabel = (p: Pick<AgentProvider, 'id' | 'name'>) => !p.name || p.name === p.id ? p.id : `${p.name} (${p.id})`

export const headersOf = (rows: RequestHeaderRow[]) => Object.fromEntries(rows
  .filter((row) => row.name.trim() || row.value)
  .map((row) => [row.name.trim(), row.value]))

export const validUrl = (value: string) => {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * One provider's card body: the subscription sign-in when it offers one, its
 * API key, then "Customized settings" (display name and protocol for a
 * declared provider, base URL, request headers, the model list), and
 * Cancel / Save. The same card adds a catalog provider (`adding`).
 */
export function ProviderEditor({ provider: p, builtInCount, adding, hideTitle, onSaved, onClose, onSignOut, onBusyChange }: {
  provider: AgentProvider
  /** How many models Pi ships for it, beside the saved ones. */
  builtInCount: number
  /** Adding a catalog provider: Save needs a key or a customization. */
  adding?: boolean
  hideTitle?: boolean
  onSaved: (catalog: AgentModels) => void
  onClose: (changed: boolean) => void
  onSignOut: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const { t } = useI18n()
  const declared = p.builtIn === false
  const [key, setKey] = useState('')
  const [name, setName] = useState(declared && p.name && p.name !== p.id ? p.name : '')
  const [baseUrl, setBaseUrl] = useState(declared ? p.baseUrl ?? '' : '')
  const [api, setApi] = useState(p.api ?? 'openai-completions')
  const [headerRows, setHeaderRows] = useState<RequestHeaderRow[]>(() => Object.entries(p.headers ?? {}).map(([name, value]) => ({ id: crypto.randomUUID(), name, value })))
  const [models, setModels] = useState<ModelDraft[]>(() => (p.savedModels ?? []).map(toDraft))
  const [busy, setBusyState] = useState(false)
  const [failure, setFailure] = useState('')
  const headers = useMemo(() => headersOf(headerRows), [headerRows])

  const setBusy = (next: boolean) => { setBusyState(next); onBusyChange?.(next) }
  const problem = modelListProblem(models)
  const keySaved = p.hasKey && !p.signedIn
  const urlProblem = declared && !baseUrl.trim() ? 'A custom provider needs a base URL.'
    : baseUrl.trim() && !validUrl(baseUrl) ? 'Enter a valid HTTP or HTTPS URL.' : undefined
  const listProblem = declared && models.length === 0 ? 'A custom provider needs at least one model.' : undefined
  const nothingToAdd = adding && !key.trim() && !baseUrl.trim() && models.length === 0 && headerRows.length === 0
  const shownProblem = urlProblem ? t(urlProblem)
    : problem ? t('Model {position}: {problem}', { position: problem.position, problem: t(problem.message) })
    : listProblem ? t(listProblem) : undefined

  async function save() {
    setBusy(true)
    setFailure('')
    try {
      const catalog = await agentHost.saveProvider({
        provider: p.id,
        headers,
        models: fromDrafts(models),
        ...(declared ? { name: name.trim() || undefined, api } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(key.trim() ? { apiKey: key.trim() } : {}),
      })
      setKey('')
      onSaved(catalog)
      onClose(true)
    } catch (error) {
      setFailure(t((error as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return <div className="st-editor">
    {!hideTitle && <div className="st-editor-head">
      <span className="st-editor-title">{providerName(p)}</span>
      {p.name && p.name !== p.id && <span className="st-editor-route">{p.id}</span>}
    </div>}

    {p.signIn && <div className="st-embedded">
      <ModelSignIn
        provider={p}
        disabled={busy}
        onSignedIn={(catalog) => {
          onSaved(catalog)
          if (adding) onClose(true)
        }}
        onSignOut={onSignOut}
      />
    </div>}

    <div className="st-field">
      <span className="st-label">{p.signIn ? t('Or use an API key') : t('API key')}</span>
      <ApiKeyInput
        value={key}
        onChange={setKey}
        placeholder={keySaved ? t('Leave blank to use saved credentials') : t('Enter your API key')}
        aria-label={t('API key')}
        disabled={busy}
      />
      {keySaved && !key && <p className="st-saved">{t('API key configured')}</p>}
    </div>

    <details className="st-customized" open={declared && adding ? true : undefined}>
      <summary className="st-summary">{t('Customized settings')}</summary>
      <div className="st-customized-body">
        {declared && <div className="st-field">
          <span className="st-label">{t('Display name')}</span>
          <input className="st-input" type="text" value={name} placeholder={p.id} aria-label={t('Display name')} disabled={busy} onChange={(event) => setName(event.target.value)} />
        </div>}
        <div className="st-field">
          <span className="st-label">{t('Base URL')}</span>
          <input
            className="st-input"
            type="text"
            spellCheck={false}
            value={baseUrl}
            placeholder={declared ? 'https://gateway.example/v1' : p.baseUrl ?? t('No default endpoint')}
            aria-label={t('Base URL')}
            aria-invalid={Boolean(urlProblem && baseUrl.trim())}
            disabled={busy}
            onChange={(event) => {
              setBaseUrl(event.target.value)
              setModels((current) => current.map((model) => ({ ...model, input: undefined })))
            }}
          />
          {!declared && <span className="st-hint">{t('Leave blank to use the provider’s endpoint.')}</span>}
        </div>
        {declared && <div className="st-field">
          <span className="st-label">{t('API protocol')}</span>
          <select className="st-input" value={api} aria-label={t('API protocol')} disabled={busy} onChange={(event) => {
            setApi(event.target.value)
            setModels((current) => current.map((model) => ({ ...model, input: undefined })))
          }}>
            {!PROTOCOLS.some((option) => option.value === api) && <option value={api}>{api}</option>}
            {PROTOCOLS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>}
        <RequestHeaders rows={headerRows} disabled={busy} onChange={setHeaderRows} />
        <ModelListEditor
          key={`${baseUrl.trim() || p.baseUrl}:${declared ? api : p.api}`}
          models={models}
          onChange={setModels}
          disabled={busy}
          meta={!declared ? t('{count} built-in models are always available; models listed here are added to them.', { count: builtInCount }) : undefined}
          probe={{ provider: p.id, baseUrl: baseUrl.trim() || p.baseUrl, api: declared ? api : p.api, headers, ...(key.trim() ? { apiKey: key.trim() } : {}) }}
          probeBlocked={!(baseUrl.trim() || p.baseUrl) ? 'Enter the base URL first, then fetch.' : undefined}
        />
      </div>
    </details>

    {(failure || shownProblem) && <p className="st-error" role="alert">{failure || shownProblem}</p>}
    <EditorFooter
      busy={busy}
      submitDisabled={Boolean(urlProblem || problem || listProblem || nothingToAdd)}
      label={t('Save')}
      busyLabel={t('Saving…')}
      onCancel={() => onClose(false)}
      onSubmit={() => void save()}
    />
  </div>
}
