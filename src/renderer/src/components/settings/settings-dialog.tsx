import { Bot, Database, Gauge, Package, Puzzle, Settings, SquareSlash, Webhook, Wrench, X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useState } from 'react'

import { AgentsSection } from '@/components/settings/agents-section'
import { CommandsSection } from '@/components/settings/commands-section'
import { ExtensionsSection } from '@/components/settings/extensions-section'
import { HooksSection } from '@/components/settings/hooks-section'
import { ModelsSection } from '@/components/settings/models-section'
import { RunsSection } from '@/components/settings/runs-section'
import { OpenSdkConfigAction, SdksSection } from '@/components/settings/sdks-section'
import { ToolsSection } from '@/components/settings/tools-section'
import type { SettingsSection } from '@/components/settings/settings-context'
import { agentHost } from '@/host/agent-client'
import { useI18n, type Locale } from '@/i18n'
import './settings.css'

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'models', label: 'Models', icon: Database },
  { id: 'runs', label: 'Runs', icon: Gauge },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'extensions', label: 'Extensions', icon: Puzzle },
  { id: 'sdks', label: 'SDKs', icon: Package },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'hooks', label: 'Hooks', icon: Webhook },
  { id: 'commands', label: 'Commands', icon: SquareSlash },
]

/**
 * The Settings dialog, after DeepSeek Harness's settings shell: a centered
 * 800x800 panel with the section nav on the left, the page's action and
 * Close at the top right, and the page below, scrolling on its own.
 */
export function SettingsDialog({ open, section, onOpenChange, onSection }: {
  open: boolean
  section: SettingsSection
  onOpenChange: (open: boolean) => void
  onSection: (section: SettingsSection) => void
}) {
  const { t } = useI18n()
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="st-mask" />
      {/* A menu that opens Settings ("Manage models…") gives focus back to its trigger as it
          closes; that must not read as focus leaving the dialog and close it again. */}
      <DialogPrimitive.Content className="st-root st-panel" data-testid="settings-dialog" aria-describedby={undefined} onFocusOutside={(event) => event.preventDefault()}>
        <nav className="st-nav" aria-label={t('Settings')}>
          <DialogPrimitive.Title className="st-nav-title">{t('Settings')}</DialogPrimitive.Title>
          <div className="st-nav-list">
            {SECTIONS.map(({ id, label, icon: Icon }) => <button
              key={id}
              type="button"
              className="st-nav-cell"
              data-section={id}
              aria-current={id === section ? 'true' : undefined}
              onClick={() => onSection(id)}
            >
              <Icon strokeWidth={1.7} />
              <span>{t(label)}</span>
            </button>)}
          </div>
        </nav>
        <div className="st-content">
          <div className="st-header">
            <div className="st-header-actions">{section === 'models' && <OpenConfigAction />}{section === 'sdks' && <OpenSdkConfigAction />}</div>
            <DialogPrimitive.Close className="st-close" aria-label={t('Close')}><X className="size-3.5" /></DialogPrimitive.Close>
          </div>
          <div className="st-options">
            {section === 'general' ? <GeneralSection />
              : section === 'runs' ? <RunsSection />
              : section === 'tools' ? <ToolsSection />
              : section === 'agents' ? <AgentsSection />
              : section === 'extensions' ? <ExtensionsSection />
              : section === 'sdks' ? <SdksSection />
              : section === 'hooks' ? <HooksSection />
              : section === 'commands' ? <CommandsSection />
              : <ModelsSection />}
          </div>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

/** Opens models.json, where providers and their models are kept. */
function OpenConfigAction() {
  const { t } = useI18n()
  const [error, setError] = useState('')
  return <>
    {error && <span className="st-error" title={error} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('Could not open the config file')}</span>}
    <button type="button" className="st-btn st-sm" onClick={() => {
      setError('')
      agentHost.openModelConfig().catch((cause: Error) => setError(cause.message))
    }}>{t('Open config file')}</button>
  </>
}

const LANGUAGES: { value: Locale; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
]

function GeneralSection() {
  const { t, locale, setLocale } = useI18n()
  return <div className="st-section">
    <h2 className="st-title">{t('General')}</h2>
    <div className="st-card">
      <div className="st-card-row">
        <div className="st-card-text">
          <span className="st-card-label">{t('Language')}</span>
          <span className="st-card-desc">{t('Interface language')}</span>
        </div>
        <select className="st-input" style={{ width: 160 }} value={locale} aria-label={t('Interface language')} data-testid="language-switcher" onChange={(event) => setLocale(event.target.value as Locale)}>
          {LANGUAGES.map((language) => <option key={language.value} value={language.value} lang={language.value}>{language.label}</option>)}
        </select>
      </div>
    </div>
  </div>
}
