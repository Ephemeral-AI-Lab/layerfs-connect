import { readDraft, saveDraft } from '@/layerfs/chat-drafts'
// The app's start page: a new chat. The composer picks the chat's LayerFS
// project (or none), where it works (a new scratch folder by default) and its
// model; sending makes the chat, sends the first message and opens it.
// `?project=<store/name>` (a project group's + in the sidebar) chooses the project.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Composer } from '@/components/chat/Composer'
import { ModelPicker, ProjectPicker, WorkspacePicker, type WorkspaceChoice } from '@/components/chat/Pickers'
import { chatHost, type ChatModel, type ChatModels } from '@/layerfs/agent-api'
import { connectBridge } from '@/layerfs/bridge'
import { splitProjectKey } from '@/layerfs/chat-groups'
import { upsertChat } from '@/layerfs/use-chats'
import { useProjects } from '@/layerfs/use-projects'
import { useLayout } from '@/components/shell/layout-context'
import { CHROME_CLUSTER_PX, macChrome, TRAFFIC_LIGHTS_PX } from '@/lib/platform'

import { parseSimulationCommand } from '@/layerfs/simulation-command'
import { SavedConversations } from '@/components/chat/SavedConversations'
import { useSimulationLaunch } from './simulation/use-simulation'
import { SimulationCommandHelp } from './simulation/SimulationCommandHelp'
import { SimulationLaunchStatus } from './simulation/SimulationLaunchStatus'

const MODEL_KEY = 'lfs.chat.model'
type ModelChoice = { provider: string; modelId: string; thinkingLevel: string }

function savedModel(): ModelChoice | null {
  try {
    return JSON.parse(localStorage.getItem(MODEL_KEY) ?? 'null') as ModelChoice | null
  } catch {
    return null
  }
}

/** A chat's first title: its first line, cut at a word near 60 characters. */
function titleFrom(text: string) {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ')
  if (line.length <= 60) return line
  const cut = line.slice(0, 60)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`
}

export function NewChatPage() {
  const navigate = useNavigate()
  const simulation = useSimulationLaunch()
  const [params] = useSearchParams()
  const catalog = useProjects()
  const { sidebarOpen } = useLayout()
  const [text, setText] = useState(() => readDraft('new'))
  useEffect(() => saveDraft('new', text), [text])
  const [project, setProject] = useState(params.get('project') ?? '')
  const [workspace, setWorkspace] = useState<WorkspaceChoice>({ kind: 'scratch' })
  const [catalogModels, setCatalogModels] = useState<ChatModels | null>(null)
  const [model, setModel] = useState<ModelChoice | null>(savedModel)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // a project group's + opens this page with its project chosen
  useEffect(() => setProject(params.get('project') ?? ''), [params])

  useEffect(() => {
    void chatHost.models().then(
      (snapshot) => {
        setCatalogModels(snapshot)
        setModel((current) => {
          const ready = snapshot.models.filter((m) => snapshot.providers.some((p) => p.id === m.provider && p.hasKey))
          const valid = (choice: ModelChoice | null) => choice && ready.some((m) => m.provider === choice.provider && m.id === choice.modelId)
          return valid(current) ? current : valid(snapshot.selected) ? snapshot.selected : ready[0] ? { provider: ready[0].provider, modelId: ready[0].id, thinkingLevel: 'off' } : null
        })
      },
      (cause: Error) => { setError(`Could not load Pi models: ${cause.message}`); setCatalogModels({ models: [], selected: null, providers: [] }) },
    )
  }, [])

  // only providers with a key or sign-in can answer
  const models = useMemo(() => {
    const keyed = new Set(catalogModels?.providers.filter((p) => p.hasKey).map((p) => p.id))
    return (catalogModels?.models ?? []).filter((m) => keyed.has(m.provider))
  }, [catalogModels])

  const projects = catalog.data ?? []
  const chosen = project ? splitProjectKey(project) : null
  // a project chat runs in a mounted Workspace of its own new branch; its conversation is saved to the project
  const where = chosen
    ? `Works in a mounted LayerFS Workspace of a new branch of ${chosen.name} from ${chosen.store}; the conversation is saved to that project.`
    : workspace.kind === 'scratch' ? 'Works in a new scratch folder.' : `Works in ${workspace.path}.`

  function chooseModel(m: ChatModel) {
    const next = { provider: m.provider, modelId: m.id, thinkingLevel: m.thinkingLevels?.includes('medium') ? 'medium' : 'off' }
    setModel(next)
    try {
      localStorage.setItem(MODEL_KEY, JSON.stringify(next))
    } catch {
      // a private window: keep the choice for this page only
    }
  }

  async function chooseFolder() {
    const path = await connectBridge.chooseDirectory()
    if (path) setWorkspace({ kind: 'folder', path })
  }

  async function send() {
    const message = text.trim()
    if (!message || busy || simulation.busy) return
    const command = parseSimulationCommand(message)
    if (command) {
      setError(null)
      if (!command.ok) { setError(command.error); return }
      if (await simulation.start(command.input)) setText('')
      return
    }
    if (!model) return
    setBusy(true)
    setError(null)
    let made: string | null = null
    try {
      const cwd = workspace.kind === 'scratch' ? await connectBridge.makeScratch() : workspace.path
      const chat = await chatHost.create({ cwd, project: project || undefined, title: titleFrom(message), ...model })
      made = chat.id
      upsertChat(chat)
      upsertChat(await chatHost.send(chat.id, message))
      setText('')
      navigate(`/chat/${encodeURIComponent(chat.id)}`)
    } catch (cause) {
      const reason = (cause as Error).message
      setError(made ? `The chat was made, but its first message was not sent: ${reason}` : reason)
    } finally {
      setBusy(false)
    }
  }

  const simulationCommand = parseSimulationCommand(text) !== null
  const lead = sidebarOpen ? 0 : (macChrome ? TRAFFIC_LIGHTS_PX : 8) + CHROME_CLUSTER_PX
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="drag h-[46px] shrink-0" style={{ marginLeft: lead }} />
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col px-5 pb-16 pt-[14vh]">
        <h1 className="mb-6 text-center text-20 font-medium leading-7 text-[var(--text-primary)]">What should we work on?</h1>
        {!simulationCommand && catalogModels && !models.length && <div className="mb-4 flex items-center justify-between gap-3 rounded-xs border border-[var(--border-default)] px-4 py-3 text-13">
          <div><p className="font-medium">Connect a model to start</p><p className="mt-1 text-12 text-[var(--text-secondary)]">Sign in to a provider or add an API key. Pi will run your chat and tools.</p></div>
          <button type="button" onClick={() => navigate('/settings')} className="shrink-0 rounded-full bg-primary px-3 py-2 text-primary-foreground">Connect model</button>
        </div>}
        <Composer
          value={text}
          onChange={setText}
          onSend={() => void send()}
          busy={busy || simulation.busy}
          sendBlocked={simulationCommand || model ? null : 'Choose a model first'}
          placeholder={chosen ? `Ask about ${chosen.name}, or give it a task…` : 'Ask anything, or give it a task…'}
          chips={
            <>
              <ProjectPicker value={project} projects={projects} onChange={setProject} />
              <WorkspacePicker
                value={workspace}
                canChoose={!!window.desktop}
                onChange={setWorkspace}
                onChoose={() => void chooseFolder()}
              />
            </>
          }
          end={<ModelPicker value={model} models={models} onChange={chooseModel} />}
        />
        <p className="mt-2.5 px-1 text-12 text-[var(--text-tertiary)]">{where}</p>
        {project && !simulationCommand && <SavedConversations project={project} />}
        {simulationCommand && <p className="mt-1 px-1 text-12 text-[var(--text-tertiary)]">Scripted simulation · fresh SQLite Store · no model required</p>}
        <SimulationCommandHelp text={text} onChange={setText} />
        <SimulationLaunchStatus launch={simulation} />
        {!simulationCommand && model && <p className="mt-1 px-1 text-12 text-[var(--text-tertiary)]">Pi agent · {model.provider} / {model.modelId}</p>}
        {error && <p role="alert" className="mt-2 px-1 text-12 text-destructive">{error}</p>}
      </div>
    </div>
  )
}
