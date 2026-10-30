import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AgentExtensionInfo } from '@shared/agent-api'

import type { Capabilities } from '@/components/settings/use-capabilities'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'

/** Loading and failure, chats that hold changes back, and the last change's outcome. */
export function CapabilityStatus({ caps, switches = true }: { caps: Capabilities; switches?: boolean }) {
  const { t } = useI18n()
  const { data, error, reload, changeError, saved } = caps
  if (error) return <>
    <p className="st-error" role="alert">{t('Could not load the agent setup')}: {t(error)}</p>
    <div><button type="button" className="st-btn st-sm" onClick={() => void reload()}>{t('Retry')}</button></div>
  </>
  if (!data) return <p className="st-hint" role="status">{t('Loading…')}</p>
  return <>
    {switches && data.busy.length > 0 && <p className="st-notice" role="status">
      {data.busy.length === 1
        ? t('“{chat}” is working. Switches wait until it finishes or you stop it.', { chat: data.busy[0] })
        : t('{count} chats are working. Switches wait until they finish or you stop them.', { count: data.busy.length })}
    </p>}
    {changeError && <p className="st-error" role="alert">{t(changeError)}</p>}
    {saved && !changeError && <p className="st-saved" role="status" aria-live="polite">{t('Saved. Each chat uses the new setup from its next message.')}</p>}
  </>
}

/** A group of rows under the extension that brings them: its name, version, and Off when it is off. */
export function ExtensionGroup({ extension, count, children }: { extension: AgentExtensionInfo; count: number; children: ReactNode }) {
  const { t } = useI18n()
  return <section className="st-group" data-group={extension.id}>
    <h3 className="st-group-title">
      <span className="st-group-name">{t(extension.title)}</span>
      {extension.version && <span className="st-group-count">{extension.version}</span>}
      {!extension.enabled && <span className="st-tag st-tag-off">{t('Off')}</span>}
      <span className="st-group-count st-group-total">{count}</span>
    </h3>
    {children}
  </section>
}

/**
 * One extension, tool or hook: its name and tags, what it is, facts, and a
 * switch. A locked switch shows why it cannot be used.
 */
export function CapabilityRow({ id, name, mono, tags, description, children, enabled, locked, disabled, busy, onChange }: {
  id: string
  name: string
  mono?: boolean
  tags?: ReactNode
  description?: ReactNode
  children?: ReactNode
  enabled: boolean
  locked?: string | null
  /** Changes wait (a chat is working, or another change is in flight). */
  disabled?: boolean
  busy?: boolean
  onChange?: (enabled: boolean) => void
}) {
  const { t } = useI18n()
  return <li className="st-row st-row-dense" data-item={id} data-enabled={enabled}>
    <div className="st-row-head">
      <span className="st-row-identity">
        {mono ? <code className="st-row-name st-mono">{name}</code> : <span className="st-row-name">{name}</span>}
        {tags}
      </span>
      <span className="st-row-actions">
        {locked && <Lock className="st-lock" aria-hidden="true" />}
        <Switch
          checked={enabled}
          disabled={!!locked || disabled || busy || !onChange}
          aria-label={t(enabled ? 'Turn off {name}' : 'Turn on {name}', { name })}
          title={locked ? t(locked) : undefined}
          onCheckedChange={(next) => onChange?.(next)}
        />
      </span>
    </div>
    {description && <p className="st-row-desc">{description}</p>}
    {children}
    {locked && <p className="st-lock-line">{t(locked)}</p>}
  </li>
}

/** A labelled run of small mono tags: a tool's parameters, an extension's tools. */
export function Facts({ label, items, empty, plain, lead }: {
  label: string
  items: string[]
  empty?: string
  /** Sentences, not names: plain text instead of mono tags. */
  plain?: boolean
  /** A word before the tags (whose they are). */
  lead?: string
}) {
  const { t } = useI18n()
  if (!items.length && !empty) return null
  return <div className="st-facts">
    <span className="st-facts-label">{label && t(label)}</span>
    {!items.length
      ? <span className="st-hint">{t(empty!)}</span>
      : plain
        ? <span className="st-facts-text">{items.join(' · ')}</span>
        : <span className="st-chips">{lead && <span className="st-facts-lead">{lead}</span>}{items.map((item) => <code key={item} className="st-chip">{item}</code>)}</span>}
  </div>
}

/**
 * A labelled list of small switches: an agent's tools or hooks. A locked one
 * shows a lock and why; `folded` shows a long, all-locked list as one line.
 */
export function SwitchList({ label, lead, items, folded, disabled, pending, pendingKey, onChange }: {
  label: string
  lead?: string
  items: { key: string; name: string; note?: string; enabled: boolean; locked: string | null }[]
  folded?: string
  disabled?: boolean
  pending?: string | null
  pendingKey: (key: string) => string
  onChange: (key: string, enabled: boolean) => void
}) {
  const { t } = useI18n()
  if (!items.length) return null
  return <div className="st-facts">
    <span className="st-facts-label">{label && t(label)}</span>
    <div className="st-switches">
      {lead && <span className="st-facts-lead">{lead}</span>}
      {folded
        ? <span className="st-switch-row"><span className="st-hint">{folded}</span></span>
        : items.map((item) => <div key={item.key} className="st-switch-row" data-switch={item.key} data-enabled={item.enabled}>
            <code className="st-chip">{item.name}</code>
            {item.note && <span className="st-switch-note">{t(item.note)}</span>}
            <span className="st-switch-end">
              {item.locked && <Lock className="st-lock" aria-hidden="true" />}
              <Switch
                size="sm"
                checked={item.enabled}
                disabled={!!item.locked || disabled || pending === pendingKey(item.key)}
                title={item.locked ? t(item.locked) : undefined}
                aria-label={t(item.enabled ? 'Turn off {name}' : 'Turn on {name}', { name: item.name })}
                onCheckedChange={(next) => onChange(item.key, next)}
              />
            </span>
          </div>)}
    </div>
  </div>
}
