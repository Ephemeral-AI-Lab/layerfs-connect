import { useState } from 'react'
import type { AgentExtensionInfo } from '@shared/agent-api'

import { CapabilityRow, CapabilityStatus, Facts } from '@/components/settings/capability-parts'
import { SmallModal } from '@/components/settings/parts'
import { useCapabilities } from '@/components/settings/use-capabilities'
import { useI18n } from '@/i18n'

/**
 * Settings → Extensions: the Pi extensions Connect loads into every chat.
 * LayerFS Connect is locked on; turning pi-subagents off asks first, since
 * its tools and hooks go with it.
 */
export function ExtensionsSection() {
  const { t } = useI18n()
  const caps = useCapabilities()
  const { data, pending } = caps
  const [confirm, setConfirm] = useState<AgentExtensionInfo>()
  return <div className="st-section" data-testid="extensions-section">
    <h2 className="st-title">{t('Extensions')}</h2>
    <p className="st-intro">{t('Pi extensions loaded into every chat. Each one brings tools, hooks and commands; turning one off removes all of them.')}</p>
    <CapabilityStatus caps={caps} />
    {data && <ul className="st-rows">
      {data.extensions.map((extension) => <CapabilityRow
        key={extension.id}
        id={extension.id}
        name={t(extension.title)}
        tags={<>
          {extension.version && <span className="st-tag st-mono">{extension.version}</span>}
          {extension.builtin && <span className="st-tag">{t('Built in')}</span>}
        </>}
        description={t(extension.description)}
        enabled={extension.enabled}
        locked={extension.locked}
        disabled={data.busy.length > 0 || !!pending}
        busy={pending === `extension:${extension.id}`}
        onChange={(enabled) => enabled ? void caps.change({ kind: 'extension', id: extension.id, enabled }) : setConfirm(extension)}
      >
        <Facts label="Tools" items={extension.tools} empty="None" />
        <Facts label="Hooks" items={extension.hooks.length ? [t('{count} events', { count: extension.hooks.length })] : []} empty="None" />
        <Facts label="Commands" items={extension.commands.map((name) => `/${name}`)} empty={extension.commandsNote ?? 'None'} />
      </CapabilityRow>)}
    </ul>}
    <SmallModal
      open={!!confirm}
      role="alertdialog"
      title={t('Turn off {name}?', { name: confirm?.title ?? '' })}
      description={confirm ? t('Chats lose its tools ({tools}) and its {hooks} hooks. Each chat starts its agent again on its next message; history and files stay as they are.', { tools: confirm.tools.join(', '), hooks: confirm.hooks.length }) : undefined}
      onClose={() => setConfirm(undefined)}
      footer={<>
        <button type="button" className="st-btn" onClick={() => setConfirm(undefined)}>{t('Cancel')}</button>
        <button type="button" className="st-btn-danger" data-confirm-off onClick={() => {
          const target = confirm
          setConfirm(undefined)
          if (target) void caps.change({ kind: 'extension', id: target.id, enabled: false })
        }}>{t('Turn off')}</button>
      </>}
    />
  </div>
}
