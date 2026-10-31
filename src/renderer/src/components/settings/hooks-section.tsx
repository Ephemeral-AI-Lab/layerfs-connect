import type { AgentKind } from '@shared/agent-api'

import { CapabilityRow, CapabilityStatus, ExtensionGroup } from '@/components/settings/capability-parts'
import { useCapabilities } from '@/components/settings/use-capabilities'
import { useI18n } from '@/i18n'

const AGENT_TITLES: Record<AgentKind, string> = { main: 'Main agent', worker: 'Worker', lead: 'Lead' }
const EVENT_TITLES: Record<string, string> = {
  session_start: 'Start or resume a chat',
  session_shutdown: 'Close a chat',
  session_tree: 'Navigate history',
  session_before_switch: 'Before switching chats',
  session_before_fork: 'Before copying a chat',
  session_before_compact: 'Before summarizing context',
  session_compact: 'Context summarized',
  before_agent_start: 'Prepare a run',
  agent_start: 'Run started',
  agent_end: 'Run ended',
  agent_settled: 'Follow-ups completed',
  turn_start: 'Model turn started',
  turn_end: 'Model turn ended',
  message_start: 'Message received',
  input: 'Process your input',
  tool_result: 'Tool result received',
  model_select: 'Model changed',
  context_with_system: 'Build model context',
  before_provider_request: 'Before sending a request',
}

/**
 * Settings → Hooks: the Pi events each extension handles. Connect's project
 * instructions hook has a switch, for all agents (one agent's is in Agents);
 * Connect's other hooks are required, and pi-subagents' switch with it,
 * since turning off part of it can leave subagents half-working.
 */
export function HooksSection() {
  const { t } = useI18n()
  const caps = useCapabilities()
  const { data, pending } = caps
  return <div className="st-section" data-testid="hooks-section">
    <p className="st-intro">{t('The agent events each extension handles. A switch here applies to all agents; pi-subagents’ hooks switch with it in Extensions.')}</p>
    <CapabilityStatus caps={caps} />
    {data?.extensions.map((extension) => {
      const hooks = data.hooks.filter((hook) => hook.extension === extension.id)
      if (!hooks.length) return null
      return <ExtensionGroup key={extension.id} extension={extension} count={hooks.length}>
        <ul className="st-rows">
          {hooks.map((hook) => <CapabilityRow
            key={`${hook.extension}:${hook.event}`}
            id={hook.event}
            name={t(EVENT_TITLES[hook.event] ?? hook.event)}
            identifier={hook.event}
            tags={<>
              {hook.handlers && hook.handlers > 1 ? <span className="st-tag">{t('{count} handlers', { count: hook.handlers })}</span> : null}
              {hook.offFor.length > 0 && <span className="st-tag st-tag-off">{t('Off for {agents}', { agents: hook.offFor.map((agent) => t(AGENT_TITLES[agent])).join(', ') })}</span>}
            </>}
            description={t(hook.purpose || hook.description)}
            enabled={hook.enabled}
            locked={hook.locked}
            disabled={data.busy.length > 0 || !!pending}
            busy={pending === `hook:${hook.id}`}
            onChange={hook.locked ? undefined : (enabled) => void caps.change({ kind: 'hook', id: hook.id, enabled })}
          />)}
        </ul>
      </ExtensionGroup>
    })}
  </div>
}
