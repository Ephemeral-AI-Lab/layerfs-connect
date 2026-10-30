import { useState } from 'react'
import type { AgentModels } from '@shared/agent-api'

import { fromDrafts, modelListProblem, ModelListEditor, type ModelDraft } from '@/components/settings/model-list'
import { ApiKeyInput, EditorFooter, PROTOCOLS } from '@/components/settings/parts'
import { validUrl } from '@/components/settings/provider-editor'
import { agentHost } from '@/host/agent-client'
import { useI18n } from '@/i18n'

const ROUTE = /^[a-z][a-z0-9-]*$/

/**
 * Declares a provider Pi does not ship: a relay, a self-hosted server, or any
 * OpenAI-, Anthropic- or Gemini-compatible endpoint, by its ID, base URL,
 * protocol and models.
 */
export function CustomProviderCard({ taken, onCreated, onClose, onBusyChange }: {
  /** Provider IDs already in use. */
  taken: string[]
  onCreated: (catalog: AgentModels, provider: string) => void
  onClose: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const { t } = useI18n()
  const [route, setRoute] = useState('')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [api, setApi] = useState<string>('openai-completions')
  const [key, setKey] = useState('')
  const [models, setModels] = useState<ModelDraft[]>([])
  const [busy, setBusyState] = useState(false)
  const [failure, setFailure] = useState('')
  const setBusy = (next: boolean) => { setBusyState(next); onBusyChange?.(next) }

  const id = route.trim()
  const routeInvalid = id.length > 0 && !ROUTE.test(id)
  const routeTaken = taken.includes(id)
  const urlInvalid = baseUrl.trim().length > 0 && !validUrl(baseUrl)
  const problem = modelListProblem(models)
  const hint = !baseUrl.trim() ? t('A custom provider needs a base URL.')
    : models.length === 0 ? t('A custom provider needs at least one model.')
    : problem ? t('Model {position}: {problem}', { position: problem.position, problem: t(problem.message) }) : undefined
  const ready = id.length > 0 && !routeInvalid && !routeTaken && baseUrl.trim().length > 0 && !urlInvalid && models.length > 0 && !problem

  async function create() {
    setBusy(true)
    setFailure('')
    try {
      const catalog = await agentHost.saveProvider({
        provider: id,
        name: name.trim() || undefined,
        baseUrl: baseUrl.trim(),
        api,
        headers: {},
        models: fromDrafts(models),
        ...(key.trim() ? { apiKey: key.trim() } : {}),
      })
      onCreated(catalog, id)
    } catch (error) {
      setFailure(t((error as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return <div className="st-editor">
    <div className="st-field">
      <span className="st-label">{t('Provider ID')}</span>
      <input className="st-input" type="text" spellCheck={false} value={route} placeholder="acme-gateway" aria-label={t('Provider ID')} aria-invalid={routeInvalid || routeTaken} disabled={busy} onChange={(event) => setRoute(event.target.value)} />
    </div>
    {routeInvalid || routeTaken
      ? <p className="st-error">{routeInvalid ? t('Start with a lowercase letter; then lowercase letters, digits, and dashes.') : t('A provider already uses this ID.')}</p>
      : <p className="st-hint">{t('Lowercase identifier, starting with a letter, that uniquely names this provider in requests and as its credential name.')}</p>}
    <div className="st-field">
      <span className="st-label">{t('Display name')}</span>
      <input className="st-input" type="text" value={name} placeholder={id || t('Display name')} aria-label={t('Display name')} disabled={busy} onChange={(event) => setName(event.target.value)} />
    </div>
    <div className="st-field">
      <span className="st-label">{t('Base URL')}</span>
      <input className="st-input" type="text" spellCheck={false} value={baseUrl} placeholder={api === 'anthropic-messages' ? 'https://gateway.example' : 'https://gateway.example/v1'} aria-label={t('Base URL')} aria-invalid={urlInvalid} disabled={busy} onChange={(event) => setBaseUrl(event.target.value)} />
    </div>
    {urlInvalid && <p className="st-error">{t('Enter a valid HTTP or HTTPS URL.')}</p>}
    <div className="st-field">
      <span className="st-label">{t('API protocol')}</span>
      <select className="st-input" value={api} aria-label={t('API protocol')} disabled={busy} onChange={(event) => setApi(event.target.value)}>
        {PROTOCOLS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
    <div className="st-field">
      <span className="st-label">{t('API key')}</span>
      <ApiKeyInput value={key} onChange={setKey} placeholder={t('Enter your API key')} aria-label={t('API key')} disabled={busy} />
    </div>
    <ModelListEditor
      models={models}
      onChange={setModels}
      disabled={busy}
      probe={baseUrl.trim() && !urlInvalid ? { provider: id || 'custom', baseUrl: baseUrl.trim(), api, ...(key.trim() ? { apiKey: key.trim() } : {}) } : undefined}
      probeBlocked={!baseUrl.trim() ? 'Enter the base URL first, then fetch.' : urlInvalid ? 'Enter a valid HTTP or HTTPS URL.' : undefined}
    />
    {failure && <p className="st-error" role="alert">{failure}</p>}
    {!failure && hint && <p className="st-hint">{hint}</p>}
    <EditorFooter busy={busy} submitDisabled={!ready} label={t('Create provider')} busyLabel={t('Creating…')} onCancel={onClose} onSubmit={() => void create()} />
  </div>
}
