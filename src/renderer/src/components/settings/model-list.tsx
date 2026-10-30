import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DiscoveredModel, ModelDiscoveryInput, ProviderModel } from '@shared/agent-api'

import { SmallModal } from '@/components/settings/parts'
import { agentHost } from '@/host/agent-client'
import { useI18n } from '@/i18n'

/** One model row as typed: capacities stay text until saved ("256K", "1M"). */
export interface ModelDraft {
  key: string
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  reasoning: boolean
  input?: ('text' | 'image')[]
}

const capacityText = (value?: number) => value === undefined ? '' : String(value)

export const toDraft = (model: Partial<ProviderModel> & { id: string }): ModelDraft => ({
  key: crypto.randomUUID(),
  id: model.id,
  name: model.name ?? '',
  contextWindow: capacityText(model.contextWindow),
  maxTokens: capacityText(model.maxTokens),
  reasoning: model.reasoning ?? false,
  input: model.input,
})

/** "131072", "256K" or "1M" as a token count; undefined for blank, NaN for anything else. */
export function parseCapacity(text: string): number | undefined {
  const value = text.trim()
  if (!value) return undefined
  const match = /^(\d+(?:\.\d+)?)\s*([kKmM]?)$/.exec(value)
  if (!match) return Number.NaN
  const count = Number(match[1]) * (match[2].toLowerCase() === 'k' ? 1024 : match[2].toLowerCase() === 'm' ? 1024 * 1024 : 1)
  return count > 0 ? Math.round(count) : Number.NaN
}

/** The first thing wrong with the list: the row (from 1) and the interface copy saying what. */
export function modelListProblem(models: ModelDraft[]): { position: number; message: string } | undefined {
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    const id = model.id.trim()
    const position = index + 1
    if (!id) return { position, message: 'Model ID is required.' }
    if (seen.has(id)) return { position, message: 'Model ID must be unique.' }
    seen.add(id)
    if (Number.isNaN(parseCapacity(model.contextWindow))) return { position, message: 'Context window must be a positive count, like 131072, 256K, or 1M.' }
    if (Number.isNaN(parseCapacity(model.maxTokens))) return { position, message: 'Max output tokens must be a positive count, like 8192, 64K, or 1M.' }
  }
  return undefined
}

export const fromDrafts = (models: ModelDraft[]): ProviderModel[] => models.map((model) => ({
  id: model.id.trim(),
  ...(model.name.trim() ? { name: model.name.trim() } : {}),
  ...(parseCapacity(model.contextWindow) ? { contextWindow: parseCapacity(model.contextWindow) } : {}),
  ...(parseCapacity(model.maxTokens) ? { maxTokens: parseCapacity(model.maxTokens) } : {}),
  ...(model.reasoning ? { reasoning: true } : {}),
  ...(model.input ? { input: model.input } : {}),
}))

/**
 * A provider's model list: one row per model (ID, display name, options,
 * delete), "Add model", and "Fetch available models", which asks the provider
 * and lets you pick the ones to add.
 */
export function ModelListEditor({ models, onChange, probe, probeBlocked, meta, disabled }: {
  models: ModelDraft[]
  onChange: (models: ModelDraft[]) => void
  /** What to ask the provider with; undefined while there is nothing to ask. */
  probe?: ModelDiscoveryInput
  /** Why the provider cannot be asked yet. */
  probeBlocked?: string
  meta?: string
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [fetching, setFetching] = useState(false)
  const [failure, setFailure] = useState('')
  const [candidates, setCandidates] = useState<DiscoveredModel[]>()
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')
  /** A row "Add model" just made: its Model ID takes the focus. */
  const [added, setAdded] = useState<string>()

  const patch = (key: string, change: Partial<ModelDraft>) => onChange(models.map((model) => model.key === key ? { ...model, ...change } : model))

  async function fetchModels() {
    if (!probe) return
    setFetching(true)
    setFailure('')
    try {
      const result = await agentHost.discoverModels(probe)
      const have = new Set(models.map((model) => model.id.trim()))
      const fresh = result.models.filter((model) => !have.has(model.id))
      if (!result.models.length) setFailure(t('The provider listed no models. Add them by hand.'))
      else if (!fresh.length) setFailure(t('Every model the provider lists is already here.'))
      else {
        setCandidates(fresh)
        setPicked(new Set())
        setQuery('')
      }
    } catch (error) {
      setFailure(t((error as Error).message))
    } finally {
      setFetching(false)
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (candidates ?? []).filter((model) => !needle || model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle))
  }, [candidates, query])
  const allPicked = visible.length > 0 && visible.every((model) => picked.has(model.id))

  function adopt() {
    const chosen = (candidates ?? []).filter((model) => picked.has(model.id))
    onChange([...models, ...chosen.map((model) => toDraft({ ...model, name: model.name !== model.id ? model.name : undefined }))])
    setCandidates(undefined)
  }

  return <section className="st-models" aria-label={t('Model list')}>
    <div className="st-models-head">
      <div className="st-models-heading">
        <span className="st-models-title">{t('Model list')}</span>
        {meta && <span className="st-models-meta">{meta}</span>}
      </div>
      <button
        type="button"
        className="st-link"
        disabled={disabled || fetching || !probe || Boolean(probeBlocked)}
        title={probeBlocked ? t(probeBlocked) : undefined}
        onClick={() => void fetchModels()}
      >
        {fetching ? t('Asking the provider…') : t('Fetch available models')}
      </button>
    </div>
    {models.length === 0 && <p className="st-models-empty">{t('No models will be shown in the selector.')}</p>}
    <div className="st-model-list">
      {models.map((model, index) => {
        const open = expanded.has(model.key)
        const position = index + 1
        return <div key={model.key} className="st-model">
          <div className="st-model-row">
            <input className="st-input" type="text" spellCheck={false} autoFocus={model.key === added} value={model.id} placeholder={t('Model ID')} aria-label={`${t('Model ID')} ${position}`} disabled={disabled} onChange={(event) => patch(model.key, { id: event.target.value })} />
            <input className="st-input" type="text" value={model.name} placeholder={t('Display name')} aria-label={`${t('Display name')} ${position}`} disabled={disabled} onChange={(event) => patch(model.key, { name: event.target.value })} />
            <button
              type="button"
              className="st-icon-btn"
              aria-label={`${t('Model options')} ${position}`}
              aria-expanded={open}
              title={t('Model options')}
              onClick={() => setExpanded((current) => {
                const next = new Set(current)
                if (open) next.delete(model.key)
                else next.add(model.key)
                return next
              })}
            >
              {open ? <ChevronDown /> : <ChevronRight />}
            </button>
            <button type="button" className="st-icon-btn st-icon-danger" aria-label={`${t('Delete model')} ${position}`} title={t('Delete model')} disabled={disabled} onClick={() => onChange(models.filter((row) => row.key !== model.key))}>
              <Trash2 />
            </button>
          </div>
          {open && <div className="st-model-advanced">
            <label className="st-model-field">
              <span className="st-model-label">{t('Context window')}</span>
              <input className="st-input" type="text" inputMode="numeric" value={model.contextWindow} placeholder={t('Uses the provider default')} aria-label={`${t('Context window')} ${position}`} disabled={disabled} onChange={(event) => patch(model.key, { contextWindow: event.target.value })} />
            </label>
            <label className="st-model-field">
              <span className="st-model-label">{t('Max output tokens')}</span>
              <input className="st-input" type="text" inputMode="numeric" value={model.maxTokens} placeholder={t('Uses the provider default')} aria-label={`${t('Max output tokens')} ${position}`} disabled={disabled} onChange={(event) => patch(model.key, { maxTokens: event.target.value })} />
            </label>
            <fieldset className="st-checks">
              <legend className="st-model-label">{t('Input types')}</legend>
              {(['text', 'image'] as const).map((type) => {
                const current = model.input ?? ['text']
                return <label key={type} className="st-check">
                  <input
                    type="checkbox"
                    checked={current.includes(type)}
                    disabled={disabled || (type === 'text' && current.length === 1 && current[0] === 'text')}
                    onChange={(event) => patch(model.key, { input: event.target.checked ? [...current, type] : current.filter((item) => item !== type) })}
                  />
                  {type === 'text' ? t('Text') : t('Images')}
                </label>
              })}
              <label className="st-check">
                <input type="checkbox" checked={model.reasoning} disabled={disabled} onChange={(event) => patch(model.key, { reasoning: event.target.checked })} />
                {t('Supports reasoning')}
              </label>
            </fieldset>
          </div>}
        </div>
      })}
    </div>
    <button type="button" className="st-add-model" disabled={disabled} onClick={() => {
      const row = toDraft({ id: '' })
      setAdded(row.key)
      onChange([...models, row])
    }}>
      <Plus /> {t('Add model')}
    </button>
    {failure && <p className="st-error">{failure}</p>}
    <SmallModal
      open={candidates !== undefined}
      title={t('Choose models to add')}
      description={t('These are the models this provider has available. Choose the ones to add.')}
      onClose={() => setCandidates(undefined)}
      footer={<>
        <button type="button" className="st-btn" onClick={() => setCandidates(undefined)}>{t('Cancel')}</button>
        <button type="button" className="st-btn-primary" disabled={picked.size === 0} onClick={adopt}>{t('Add selected')}</button>
      </>}
    >
      <div className="st-candidates-bar">
        <input className="st-input" type="search" value={query} placeholder={t('Search models')} aria-label={t('Search models')} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="st-link" disabled={visible.length === 0} onClick={() => setPicked((current) => {
          const next = new Set(current)
          for (const model of visible) {
            if (allPicked) next.delete(model.id)
            else next.add(model.id)
          }
          return next
        })}>{allPicked ? t('Deselect all') : t('Select all')}</button>
      </div>
      {visible.length === 0
        ? <p className="st-candidates-empty" role="status">{t('No matching models.')}</p>
        : <ul className="st-candidates">
          {visible.map((model) => <li key={model.id}>
            <label className="st-candidate">
              <input type="checkbox" checked={picked.has(model.id)} onChange={() => setPicked((current) => {
                const next = new Set(current)
                if (next.has(model.id)) next.delete(model.id)
                else next.add(model.id)
                return next
              })} />
              <span className="st-candidate-id" title={model.name}>{model.id}</span>
            </label>
          </li>)}
        </ul>}
    </SmallModal>
  </section>
}
