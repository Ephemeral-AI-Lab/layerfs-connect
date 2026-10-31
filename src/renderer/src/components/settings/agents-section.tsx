import type { AgentInfo, AgentKind } from '@shared/agent-api'

import { CapabilityRow, CapabilityStatus, Facts, SwitchList } from '@/components/settings/capability-parts'
import { useCapabilities, type Capabilities } from '@/components/settings/use-capabilities'
import { useI18n } from '@/i18n'

/**
 * Settings → Agents: the chat's own agent and the two subagents it can start,
 * each with its own tool and hook switches. A tool or hook turned off in
 * Tools or Hooks is off for every agent, and its switch here waits for it.
 */
export function AgentsSection() {
  const { t } = useI18n()
  const caps = useCapabilities()
  const { data, pending } = caps
  const titles = Object.fromEntries((data?.extensions ?? []).map((extension) => [extension.id, extension.title]))
  const waiting = !!data?.busy.length || !!pending
  return <div className="st-section" data-testid="agents-section">
    <p className="st-intro">{t('Who does the work in a chat, and what each one gets. Switches here apply to one agent; Tools and Hooks switch them for all agents.')}</p>
    <CapabilityStatus caps={caps} />
    {data && <ul className="st-rows">
      {data.agents.map((agent) => <CapabilityRow
        key={agent.id}
        id={agent.id}
        name={t(agent.title)}
        tags={agent.name && <code className="st-tag st-mono">{agent.name}</code>}
        description={t(agent.description)}
        enabled={agent.enabled}
        locked={agent.locked}
        disabled={waiting}
        busy={pending === `agent:${agent.id}`}
        onChange={(enabled) => void caps.change({ kind: 'agent', id: agent.id, enabled })}
      >
        <Facts label="Started by" items={[t(agent.startedBy)]} plain />
        <Facts label="Model" items={[t(agent.model)]} plain />
        <Facts label="Instructions" items={[t(agent.instructions)]} plain />
        <Facts label="Extensions" items={agent.extensions.map((id) => t(titles[id] ?? id))} />
        <SwitchList
          label="Tools"
          items={agent.tools.map((tool) => ({ key: tool.name, name: tool.name, enabled: tool.enabled, locked: tool.locked }))}
          disabled={waiting}
          pending={pending}
          pendingKey={(key) => `tool:${key}`}
          onChange={(key, enabled) => void caps.change({ kind: 'tool', id: key, agent: agent.id, enabled })}
        />
        <AgentHooks agent={agent} titles={titles} caps={caps} disabled={waiting} />
      </CapabilityRow>)}
    </ul>}
  </div>
}

/** An agent's hooks by extension, each with its switch; a long locked group folds into a count. */
function AgentHooks({ agent, titles, caps, disabled }: { agent: AgentInfo; titles: Record<string, string>; caps: Capabilities; disabled: boolean }) {
  const { t } = useI18n()
  const groups = [...new Set(agent.hooks.map((hook) => hook.extension))]
  return <>
    {groups.map((extension, index) => {
      const hooks = agent.hooks.filter((hook) => hook.extension === extension)
      return <SwitchList
        key={extension}
        label={index === 0 ? 'Hooks' : ''}
        lead={t(titles[extension] ?? extension)}
        folded={hooks.length > 6 && hooks.every((hook) => hook.locked) ? t('{count} events · {reason}', { count: hooks.length, reason: t(hooks[0].locked!) }) : undefined}
        items={hooks.map((hook) => ({ key: hook.id, name: hook.event, note: hook.purpose ?? undefined, enabled: hook.enabled, locked: hook.locked }))}
        disabled={disabled}
        pending={caps.pending}
        pendingKey={(key) => `hook:${key}`}
        onChange={(key, enabled) => void caps.change({ kind: 'hook', id: key, agent: agent.id as AgentKind, enabled })}
      />
    })}
    {agent.hooksNote && <p className="st-lock-line">{t(agent.hooksNote)}</p>}
  </>
}
