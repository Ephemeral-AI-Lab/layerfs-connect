import { useEffect, useState } from 'react'
import type { RunLimitSettings } from '@shared/agent-api'

import { agentHost } from '@/host/agent-client'
import { useI18n } from '@/i18n'

type Limits = RunLimitSettings['limits']
type Field = keyof Limits

/** The host's ranges (host/agents/runtime.js). */
const FIELDS: { key: Field; label: string; help: string; min: number; max: number }[] = [
  { key: 'bashTimeoutSeconds', label: 'Command timeout (seconds)', help: 'Default for a shell command that sets no timeout of its own.', min: 1, max: 86400 },
  { key: 'maxRetries', label: 'Automatic retries', help: 'Retries after a failed model request. 0 turns retries off.', min: 0, max: 5 },
]

const text = (limits: Limits) => Object.fromEntries(FIELDS.map(({ key }) => [key, String(limits[key])])) as Record<Field, string>
const parse = (value: string, min: number, max: number) => /^\d+$/.test(value.trim()) && Number(value) >= min && Number(value) <= max ? Number(value) : null

/** Settings → Runs: the command timeout and retries every chat's runs use. */
export function RunsSection() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<RunLimitSettings | null>(null)
  const [draft, setDraft] = useState<Record<Field, string> | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = () => agentHost.runLimits().then((next) => { setSettings(next); setDraft((current) => current ?? text(next.limits)) }).catch((cause: Error) => setError(cause.message))
  useEffect(() => { void load() }, [])
  // while chats work, check back so Save comes on once they finish
  const waiting = !!settings?.busy.length
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => { void load() }, 2000)
    return () => clearInterval(timer)
  }, [waiting])

  if (!settings || !draft) return <div className="st-section" data-testid="runs-section">
    <h2 className="st-title">{t('Runs')}</h2>
    {error ? <p className="st-error" role="alert">{error}</p> : <p className="st-hint">{t('Loading…')}</p>}
  </div>

  const values = Object.fromEntries(FIELDS.map(({ key, min, max }) => [key, parse(draft[key], min, max)])) as Record<Field, number | null>
  const invalid = FIELDS.some(({ key }) => values[key] === null)
  const changed = FIELDS.some(({ key }) => values[key] !== settings.limits[key])
  const isDefault = FIELDS.every(({ key }) => values[key] === settings.defaults[key])
  const busy = settings.busy.length > 0

  const edit = (key: Field, value: string) => { setSaved(false); setError(''); setDraft({ ...draft, [key]: value }) }
  const save = async () => {
    setSaving(true); setError(''); setSaved(false)
    try {
      const next = await agentHost.setRunLimits(values as Limits)
      setSettings(next); setDraft(text(next.limits)); setSaved(true)
    } catch (cause) {
      setError((cause as Error).message)
      void load()
    } finally { setSaving(false) }
  }

  return <div className="st-section" data-testid="runs-section">
    <h2 className="st-title">{t('Runs')}</h2>
    <p className="st-intro">{t('How every chat’s runs handle slow commands and failed model requests. Changes apply to each chat’s next run.')}</p>
    <div className="st-card">
      {FIELDS.map(({ key, label, help, min, max }) => <label key={key} className="st-card-row">
        <span className="st-card-text">
          <span className="st-card-label">{t(label)}</span>
          <span className="st-card-desc">{t(help)} {t('Default')} {settings.defaults[key]}.</span>
        </span>
        <input
          className="st-input"
          style={{ width: 112, textAlign: 'right' }}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={draft[key]}
          disabled={saving}
          aria-label={t(label)}
          aria-invalid={values[key] === null}
          data-field={key}
          onChange={(event) => edit(key, event.target.value)}
        />
      </label>)}
    </div>
    {invalid && <p className="st-error" role="alert">{t('Use whole numbers within each field’s range.')}</p>}
    {busy && <p className="st-notice">{t('Wait for running chats to finish, or stop them, before changing run limits.')}</p>}
    {error && <p className="st-error" role="alert">{error}</p>}
    {saved && !changed && <p className="st-saved">{t('Run limits saved')}</p>}
    <div className="st-actions">
      <button type="button" className="st-btn" disabled={saving || isDefault} onClick={() => { setSaved(false); setError(''); setDraft(text(settings.defaults)) }}>{t('Reset to defaults')}</button>
      <button type="button" className="st-btn-primary" disabled={saving || busy || invalid || !changed} onClick={() => void save()}>{saving ? t('Saving…') : t('Save')}</button>
    </div>
  </div>
}
