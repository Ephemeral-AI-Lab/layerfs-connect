from pathlib import Path
import shutil
root=Path('/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect')
ui=root/'desktop/src/renderer/src'

p=root/'host/agents/extensions.js';s=p.read_text()
s=s.replace('function workerDefinition(setup) {','export function workerDefinition(setup) {').replace('function leadDefinition(setup) {','export function leadDefinition(setup) {')
p.write_text(s)
p=root/'host/agents/capabilities.js';s=p.read_text()
s=s.replace('instructionsOn, leadsAllowed, toolState }', 'instructionsOn, leadsAllowed, toolState, workerDefinition, leadDefinition }')
s=s.replace("const fail = (status, message)", "import { connectPrompt } from './prompt.js'\n\nconst fail = (status, message)")
needle='''      ...agent,
      enabled: usable,'''
assert needle in s
s=s.replace(needle,'''      ...agent,
      prompt: {
        source: agent.id === 'main' ? 'Connect base system prompt' : `${agent.name} definition`,
        text: agent.id === 'main'
          ? connectPrompt({ cwd: '<working folder>' }, names.filter((name) => agentToolState(name, agent.id, setup).on))
          : agent.id === 'worker' ? workerDefinition(setup) : leadDefinition(setup),
        note: 'Configured template. Project, conversation and SDK instructions are added when the agent starts.',
      },
      enabled: usable,''')
s=s.replace('''    live: !!session,
    agents,''','''    live: !!session,
    runtime: { name: 'Pi', version: packageVersion('@earendil-works/pi-coding-agent') },
    agents,''')
p.write_text(s)

p=root/'src/shared/agent-api.ts';s=p.read_text()
needle='''  instructions: string
  /** It can run now. */'''
assert needle in s
s=s.replace(needle,'''  instructions: string
  /** The actual configured base prompt/definition, before dynamic workspace context. */
  prompt: { source: string; text: string; note: string }
  /** It can run now. */''')
s=s.replace('''export interface AgentCapabilities {
  live: boolean''','''export interface AgentCapabilities {
  runtime: { name: string; version: string | null }
  live: boolean''')
p.write_text(s)

(ui/'layerfs/capabilities-api.ts').write_text('''import { call } from './client'
import type { AgentCapabilities, AgentCapabilityChange } from '../../../../../src/shared/agent-api'

export type { AgentCapabilities, AgentCapabilityChange, AgentKind } from '../../../../../src/shared/agent-api'

export const capabilityHost = {
  get: () => call<AgentCapabilities>('GET', '/api/agent/capabilities'),
  change: (input: AgentCapabilityChange) => call<AgentCapabilities>('POST', '/api/agent/capabilities', input),
}
''')
shutil.copyfile(Path(__file__).parent/'CapabilitiesPage.tsx',ui/'pages/settings/CapabilitiesPage.tsx')

p=ui/'components/shell/Sidebar.tsx';s=p.read_text()
s=s.replace('import { ArrowLeft, Cpu,', 'import { Bot, Wrench, Workflow, ArrowLeft, Cpu,')
s=s.replace('<NavRow to="/settings" icon={Cpu} label="Models" />', '''<NavRow to="/settings/models" icon={Cpu} label="Models" />
            <NavRow to="/settings/tools" icon={Wrench} label="Tools" />
            <NavRow to="/settings/agents" icon={Bot} label="Agents" />
            <NavRow to="/settings/hooks" icon={Workflow} label="Hooks" />''')
p.write_text(s)
p=ui/'router.tsx';s=p.read_text()
s=s.replace("import { createHashRouter }", "import { createHashRouter, Navigate }")
s=s.replace("import { ModelsPage } from '@/pages/settings/ModelsPage'", "import { ModelsPage } from '@/pages/settings/ModelsPage'\nimport { ToolsPage, AgentsPage, HooksPage } from '@/pages/settings/CapabilitiesPage'")
s=s.replace("{ path: 'settings', element: <ModelsPage /> },", "{ path: 'settings', element: <Navigate to=\"/settings/models\" replace /> },")
s=s.replace("{ path: 'settings/models', element: <ModelsPage /> },", "{ path: 'settings/models', element: <ModelsPage /> },\n      { path: 'settings/tools', element: <ToolsPage /> },\n      { path: 'settings/agents', element: <AgentsPage /> },\n      { path: 'settings/hooks', element: <HooksPage /> },")
p.write_text(s)

p=root/'docs/ui/settings.md';s=p.read_text()+'''

## Desktop Tools, Agents and Hooks

Source: desktop/src/renderer/src/pages/settings/CapabilitiesPage.tsx
Opens from: the secondary Settings sidebar.

```text
+-Settings sidebar---+--[1] Tools / Agents / Hooks ----------------------------+
| Models            | [2] Pi version - Configured setup / Live session        |
| Tools             |     pi-subagents <installed version> - Enabled / Off   |
| Agents            |     Active chats prevent configuration changes         |
| Hooks             |                                                        |
|                   | [3] Tools: extension groups, descriptions, parameters   |
|                   |     Used by: Main agent / Worker / Lead     [On / Off] |
|                   | [4] Agents: Main agent / Worker / Lead                 |
|                   |     Model, instructions, extensions         [On / Off] |
|                   |     > Tools      (individual switches)                 |
|                   |     > Prompt     (configured template, read-only)      |
|                   |     > Hooks      (individual switches)                 |
|                   | [5] Hooks: extension, event, purpose         [On / Off] |
|                   |     Live handler count, or configured-event label      |
+-------------------+--------------------------------------------------------+
```

| Region | Data and behavior |
|---|---|
| [2] | Host capabilities report the installed Pi and subagent package versions |
| [3] | Tool and extension switches use the existing capability configuration API |
| [4] | Prompt text comes from the same builders used to start agents; workspace context is added later |
| [5] | Required hooks are locked; subagent lifecycle hooks switch with pi-subagents |

The Tools page shows pi-subagents installation and extension state. Connect
loads its own connect-worker and connect-lead definitions; packaged workflow
shortcuts and skills are not automatically enabled. The configured setup is
distinct from the live session's tool parameters and hook registrations.
Busy chats disable switches. Server refusals remain visible. No changes are
applied to active agents, and required bash/checkpoint controls stay locked.
'''
p.write_text(s)
p=root/'docs/ui/shell.md';s=p.read_text().replace('| ( Models )                  |','| ( Models / Tools / Agents / Hooks ) |')
s += '\nThe secondary sidebar also links Tools, Agents and Hooks to their Pi configuration panels.\n'
p.write_text(s)
print('Added Pi Tools, Agents (with prompts), and Hooks settings panels.')
