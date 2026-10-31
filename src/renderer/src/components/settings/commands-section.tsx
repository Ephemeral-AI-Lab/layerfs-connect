import { CapabilityStatus, ExtensionGroup } from '@/components/settings/capability-parts'
import { useCapabilities } from '@/components/settings/use-capabilities'
import { useI18n } from '@/i18n'

/** Connect's own commands, as the chat's message box offers them (chat-home.tsx `commands`). */
const CONNECT_COMMANDS: { name: string; description: string }[] = [
  { name: 'new', description: 'Start a fresh conversation in this workspace' },
  { name: 'model', description: 'Choose the model for your next message' },
  { name: 'workspace', description: 'Working directory, project and recent folders' },
  { name: 'compact', description: 'Summarize earlier turns to free context' },
  { name: 'stop', description: 'Stop the current turn' },
  { name: 'scenario <name>', description: 'A new chat plays a scenario’s script here, in a folder of its own' },
]

/** Settings → Commands: the slash commands a chat's message box runs, grouped by the extension that brings them. */
export function CommandsSection() {
  const { t } = useI18n()
  const caps = useCapabilities()
  const { data } = caps
  return <div className="st-section" data-testid="commands-section">
    <p className="st-intro">{t('Type / in a chat’s message box to run one.')}</p>
    <CapabilityStatus caps={caps} switches={false} />
    {data?.extensions.map((extension) => {
      const commands = extension.id === 'layerfs-connect'
        ? CONNECT_COMMANDS
        : data.commands.filter((command) => command.extension === extension.id)
      return <ExtensionGroup key={extension.id} extension={extension} count={commands.length}>
        {commands.length
          ? <div className="st-card">
              {commands.map((command) => <div key={command.name} className="st-card-row" data-command={command.name}>
                <code className="st-command">/{command.name}</code>
                <span className="st-card-desc st-card-text">{command.description ? t(command.description) : t('No description')}</span>
              </div>)}
            </div>
          : <p className="st-empty-line">{t(extension.commandsNote ?? 'No commands.')}</p>}
      </ExtensionGroup>
    })}
  </div>
}
