import type { AgentKind } from '@shared/agent-api'

import { CapabilityRow, CapabilityStatus, ExtensionGroup, Facts } from '@/components/settings/capability-parts'
import { useCapabilities } from '@/components/settings/use-capabilities'
import { useI18n } from '@/i18n'

const AGENTS: Record<AgentKind, string> = { main: 'Main agent', worker: 'Worker', lead: 'Lead' }

/** Settings → Tools: what the agents can call, grouped by the extension that brings it. */
export function ToolsSection() {
  const { t } = useI18n()
  const caps = useCapabilities()
  const { data, pending } = caps
  return <div className="st-section" data-testid="tools-section">
    <h2 className="st-title">{t('Tools')}</h2>
    <p className="st-intro">{t('What the agents can call. A switch here applies to all agents; one agent’s switches are in Agents.')}</p>
    <CapabilityStatus caps={caps} />
    {data?.extensions.map((extension) => {
      const tools = data.tools.filter((tool) => tool.extension === extension.id)
      if (!tools.length) return null
      return <ExtensionGroup key={extension.id} extension={extension} count={tools.length}>
        <ul className="st-rows">
          {tools.map((tool) => <CapabilityRow
            key={tool.name}
            id={tool.name}
            name={tool.name}
            mono
            tags={tool.offFor.length > 0 ? <span className="st-tag st-tag-off">{t('Off for {agents}', { agents: tool.offFor.map((agent) => t(AGENTS[agent])).join(', ') })}</span> : undefined}
            description={t(tool.description)}
            enabled={tool.enabled}
            locked={tool.locked}
            disabled={data.busy.length > 0 || !!pending}
            busy={pending === `tool:${tool.name}`}
            onChange={(enabled) => void caps.change({ kind: 'tool', id: tool.name, enabled })}
          >
            <Facts label="Used by" items={tool.agents.map((agent) => t(AGENTS[agent]))} />
            <Facts label="Parameters" items={tool.parameters} />
          </CapabilityRow>)}
        </ul>
      </ExtensionGroup>
    })}
  </div>
}
