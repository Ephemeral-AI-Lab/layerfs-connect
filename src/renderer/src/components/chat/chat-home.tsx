import { useI18n } from '@/i18n'
import { Archive, ArchiveRestore, CircleHelp, Clipboard, CopyPlus, FileJson, FileText, LoaderCircle, MoreHorizontal, Pencil, Play, ShieldQuestion, WifiOff, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AgentModels, AgentSessionDetail, AgentSessionSummary, ChatScenario, ModelSelection } from '@shared/agent-api'
import { projectKey, projectLabel, projectRef } from '@shared/host-api'

import { ConnectMark } from '@/components/connect-mark'
import { LfsProject } from '@/components/lfs-icons'
import { ConversationMessages } from '@/components/chat/conversation-messages'
import { ChildConversationView, SubagentsMenu, SubagentsSummary } from '@/components/chat/subagents'
import { attachmentPayload, hydrateMessageAttachments } from '@/components/chat/attachments'
import { newDraftKey, sessionDraftKey, useChatDraft } from '@/components/chat/chat-drafts'
import { SessionSettingsDialog, type SessionSettingsTarget } from '@/components/chat/session-settings'
import { conversationMarkdown, exportConversation } from '@/components/chat/transcript-export'
import { Composer, type ComposerCommand } from '@/components/chat/composer'
import { ConversationActionDialog, type ConversationActionTarget } from '@/components/chat/conversation-actions'
import { ContextMeter } from '@/components/chat/context-meter'
import { useModelsChanged, useSettings } from '@/components/settings/settings-context'
import { ModelSelector } from '@/components/chat/model-selector'
import { TraceView } from '@/components/chat/trace-view'
import { ApprovalPanel } from '@/components/chat/permissions'
import { QueuedMessages } from '@/components/chat/queued-messages'
import { WorkspaceMenus } from '@/components/chat/workspace-picker'
import { WorkspaceStatus } from '@/components/chat/workspace-status'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { ProjectView, type EmbeddedProjectView } from '@/components/projects/project-view'
import { Tab, TabBar } from '@/components/motion/tabs'
import { ThinkingLine } from '@/components/chat/markdown'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { agentHost, isChatRemoved, onChatRemoved } from '@/host/agent-client'
import { onHostConnection, onHostEvent, type HostConnection } from '@/host/client'
import type { ProjectCatalog } from '@/host/use-projects'
import { cn, sortByLabelLength } from '@/lib/utils'
import { imageInputSupport } from '@/lib/model-input'
import { canCollapseLatestTask } from '@/lib/conversation-tasks'
import './chat.css'

const LAST_SESSION = 'connect.agent.last-session'
const LAST_CWD = 'connect.agent.cwd'
const LAST_PROJECT = 'connect.agent.project'
/** A scenario chat's provider: its model is the scenario's script (host/agents/scenario-model.js). */
const SCENARIO_PROVIDER = 'scenario'
const byUpdated = (a: AgentSessionSummary, b: AgentSessionSummary) => b.updated - a.updated
const mergeHistory = (current: AgentSessionSummary[], incoming: AgentSessionSummary[], deleted: ReadonlySet<string>) => {
  const all = new Map(current.filter((session) => !deleted.has(session.id) && !isChatRemoved(session.id)).map((session) => [session.id, session]))
  for (const session of incoming) {
    if (deleted.has(session.id) || isChatRemoved(session.id)) continue
    if (!all.has(session.id) || all.get(session.id)!.updated <= session.updated) all.set(session.id, session)
  }
  return [...all.values()].sort(byUpdated)
}

interface ChatHomeProps {
  projects: ProjectCatalog
  initialProject?: string
  /** A conversation to open (from the sidebar); a new one opens when absent. */
  initialSession?: string
  /** Opens a new chat even when no session is given, instead of the last one used. */
  startNew?: boolean
  /** Opens the project page; `from` names this chat, for the way back. */
  onOpenProject?: (project: string, branch?: string, from?: string) => void
  /** The view to open on (Chat, Trace, Files…), and each view opened after. */
  initialView?: string
  onView?: (view: string) => void
  /** Says which conversation is open now (null for a new one), for the sidebar. */
  onActiveSession?: (id: string | null) => void
}

/** The chat page's views: the conversation, the agent's Trace, and its project's Files, Sandboxes and History. */
type ChatView = 'chat' | 'trace' | EmbeddedProjectView
const CHAT_VIEWS = ['chat', 'trace', 'files', 'sandboxes', 'history'] as const
const PROJECT_VIEWS: { id: EmbeddedProjectView; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'sandboxes', label: 'Sandboxes' },
  { id: 'history', label: 'History' },
]

export function ChatHome({ projects, initialProject, initialSession, startNew, onOpenProject: openProjectPage, initialView, onView, onActiveSession }: ChatHomeProps) {
  const { t } = useI18n()
  const [models, setModels] = useState<AgentModels>()
  const [selection, setSelection] = useState<ModelSelection | null>(null)
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [session, setSession] = useState<AgentSessionDetail | null>(null)
  const [cwd, setCwd] = useState(() => localStorage.getItem(LAST_CWD) ?? '')
  const [project, setProject] = useState(() => initialProject ?? localStorage.getItem(LAST_PROJECT) ?? '')
  const drafts = useChatDraft(newDraftKey(project, cwd))
  const { input, setInput, attachments, setAttachments } = drafts
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const settings = useSettings()
  const [modelBusy, setModelBusy] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  /** The subagent whose conversation shows in place of the chat's, and the header's list of them. */
  const [childView, setChildView] = useState<string | null>(null)
  const [subagentsOpen, setSubagentsOpen] = useState(false)
  useEffect(() => { setChildView(null) }, [session?.id])
  const [view, setView] = useState<ChatView>(() => (CHAT_VIEWS as readonly string[]).includes(initialView ?? '') ? initialView as ChatView : 'chat')
  useEffect(() => { onView?.(view) }, [view]) // eslint-disable-line react-hooks/exhaustive-deps
  /** The Branch the Project tab opens on (a Trace link). */
  const [projectBranch, setProjectBranch] = useState<string | undefined>()
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [sessionSettings, setSessionSettings] = useState<SessionSettingsTarget | null>(null)
  const [connection, setConnection] = useState<HostConnection>('connecting')
  const [conversationAction, setConversationAction] = useState<ConversationActionTarget | null>(null)
  const activeId = useRef<string | null>(null)
  const navigation = useRef(0)
  const skipRestore = useRef(initialProject !== undefined || !!startNew)
  const [scenarios, setScenarios] = useState<ChatScenario[]>()
  const sendInFlight = useRef(false)
  const conversationInFlight = useRef(false)
  const conversationTrigger = useRef<HTMLButtonElement>(null)
  const catalogRequest = useRef(0)
  // Settings → Models saved the catalog: this chat's model list follows it
  useModelsChanged((catalog) => {
    catalogRequest.current += 1
    setModels(catalog)
    setSelection(catalog.selected)
    setError('')
  })
  // The mount-only SSE listener must see the current catalog when switching sessions.
  const modelCatalog = useRef(models)
  modelCatalog.current = models
  const nativeNavigation = useRef<{
    sequence: number
    links: Map<string, { sessionId: string; sequence: number }>
    pending: { fromId: string; view: number; targetId: string } | null
  }>({ sequence: 0, links: new Map(), pending: null })
  const deletedIds = useRef(new Set<string>())
  const resetAfterRemoval = useRef(newSession)
  resetAfterRemoval.current = newSession
  const scroller = useRef<HTMLDivElement>(null)
  const approvalsAnchor = useRef<HTMLDivElement>(null)
  const followBottom = useRef(true)
  const agentRunning = session?.state === 'running'
  const running = agentRunning || session?.execution?.phase === 'children' || !!session?.children.some((child) => /^(running|pending|queued|paused)$/.test(child.state))
  const openChild = (childView && session?.children.find((child) => child.id === childView)) || null

  function update(detail: AgentSessionDetail) {
    if (deletedIds.current.has(detail.id) || isChatRemoved(detail.id)) return
    const { messages: _messages, queued: _queued, tools: _tools, children: _children, approvals: _approvals, ...summary } = detail
    setSessions((all) => mergeHistory(all, [summary], deletedIds.current))
    if (activeId.current === detail.id) {
      setSession((current) => current && current.id === detail.id && current.updated > detail.updated ? current : { ...detail, messages: hydrateMessageAttachments(detail.messages, current?.id === detail.id ? current.messages : []) })
    }
  }

  function activate(detail: AgentSessionDetail, useSessionModel = true, catalog = modelCatalog.current) {
    if (deletedIds.current.has(detail.id) || isChatRemoved(detail.id)) return
    activeId.current = detail.id
    localStorage.setItem(LAST_SESSION, detail.id)
    if (!detail.project) setCwd(detail.cwd)
    setProject(detail.project ?? '')
    const configured = catalog?.providers.some((provider) => provider.id === detail.provider && (provider.custom || provider.hasKey))
    const available = configured && catalog?.models.some((model) => model.provider === detail.provider && model.id === detail.modelId)
    if (useSessionModel && available && detail.provider && detail.modelId && detail.provider !== SCENARIO_PROVIDER) setSelection({ provider: detail.provider, modelId: detail.modelId, thinkingLevel: detail.thinkingLevel })
    followBottom.current = true
    drafts.open(sessionDraftKey(detail.id))
    update(detail)
  }

  function activateReplacement(detail: AgentSessionDetail, fromId: string, view: number) {
    update(detail)
    // HTTP and SSE can race; only the first result still on the source may navigate.
    if (detail.id === fromId || deletedIds.current.has(detail.id) || isChatRemoved(detail.id) || activeId.current !== fromId || navigation.current !== view) return
    nativeNavigation.current.pending = null
    navigation.current += 1
    skipRestore.current = true
    setConversationAction(null)
    setError('')
    setNotice('')
    setLoading(false)
    activate(detail)
  }

  function replacementTarget(fromId: string) {
    let id = fromId
    let sequence = 0
    let next = nativeNavigation.current.links.get(id)
    // A native switch may reuse an old session; its past outgoing edge is stale.
    while (next && next.sequence > sequence) {
      sequence = next.sequence
      id = next.sessionId
      next = nativeNavigation.current.links.get(id)
    }
    return id
  }

  function navigateNative(fromId: string, sessionId: string) {
    const state = nativeNavigation.current
    state.links.set(fromId, { sessionId, sequence: ++state.sequence })
    if (activeId.current === fromId) state.pending = { fromId, view: navigation.current, targetId: '' }
    const intent = state.pending
    if (!intent || activeId.current !== intent.fromId || navigation.current !== intent.view) return
    const targetId = replacementTarget(intent.fromId)
    if (targetId === intent.fromId) { state.pending = null; return }
    if (intent.targetId === targetId) return
    intent.targetId = targetId
    void agentHost.session(targetId).then((detail) => {
      if (state.pending === intent && replacementTarget(intent.fromId) === targetId) activateReplacement(detail, intent.fromId, intent.view)
    }, (e: Error) => {
      if (state.pending === intent && replacementTarget(intent.fromId) === targetId && activeId.current === intent.fromId && navigation.current === intent.view) setError(e.message)
    })
  }

  async function load() {
    const view = navigation.current
    setLoading(true)
    setError('')
    try {
      const [catalog, history] = await Promise.all([agentHost.models(), agentHost.sessions()])
      if (view !== navigation.current) return
      setModels(catalog)
      setSelection(catalog.selected)
      setCwd((value) => value || catalog.defaultCwd)
      setSessions((all) => mergeHistory(all, history, deletedIds.current))
      const last = activeId.current ?? initialSession ?? (skipRestore.current ? null : localStorage.getItem(LAST_SESSION))
      if (last && !isChatRemoved(last) && history.some((s) => s.id === last && !s.archived)) {
        const detail = await agentHost.session(last)
        if (view === navigation.current) activate(detail, !catalog.selected, catalog)
      } else drafts.open(newDraftKey(project, cwd || catalog.defaultCwd))
    } catch (e) {
      if (view === navigation.current) setError((e as Error).message)
    } finally {
      if (view === navigation.current) setLoading(false)
    }
  }

  function refreshSession(id: string) {
    void agentHost.session(id).then(update, (e: Error) => {
      if (!deletedIds.current.has(id) && !isChatRemoved(id) && activeId.current === id) setError(e.message)
    })
  }

  useEffect(() => {
    if (initialSession && !isChatRemoved(initialSession)) localStorage.setItem(LAST_SESSION, initialSession)
    else if (initialProject !== undefined) {
      localStorage.removeItem(LAST_SESSION)
      localStorage.setItem(LAST_PROJECT, initialProject)
    }
    void load()
    const removalOff = onChatRemoved((id) => {
      deletedIds.current.add(id)
      setSessions((all) => all.filter((item) => item.id !== id))
      drafts.clear(sessionDraftKey(id))
      if (activeId.current === id) resetAfterRemoval.current()
    })
    const connectionOff = onHostConnection(setConnection)
    const unsubscribe = onHostEvent((event) => {
      if (event.type === 'chat') update(event.session)
      if (event.type === 'chat-navigate' && !isChatRemoved(event.fromId) && !isChatRemoved(event.sessionId)) navigateNative(event.fromId, event.sessionId)
    }, () => {
      // Events are live, so read the current snapshot after a reconnect.
      const id = activeId.current
      if (id) refreshSession(id)
    })
    return () => {
      navigation.current += 1
      activeId.current = null
      unsubscribe()
      removalOff()
      connectionOff()
    }
  }, [])

  const reportSession = useRef(onActiveSession)
  reportSession.current = onActiveSession
  const shownId = session?.id ?? null
  useEffect(() => {
    if (!loading) reportSession.current?.(shownId)
  }, [shownId, loading])

  useEffect(() => {
    if (followBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [session, pending, notice])

  function changeDirectory(value: string) {
    if (!activeId.current) drafts.open(newDraftKey(project, value))
    setCwd(value)
    localStorage.setItem(LAST_CWD, value)
  }

  function changeProject(value: string) {
    const next = projects.removed.has(value) ? '' : value
    if (!activeId.current) drafts.open(newDraftKey(next, cwd))
    setProject(next)
    localStorage.setItem(LAST_PROJECT, next)
  }

  useEffect(() => {
    if (projects.removed.has(project)) changeProject('')
  }, [project, projects.removed])

  // A project goes by its key (`store/name` in a shared Store, layerfs#506): a draft that kept a bare
  // name (an older Connect) moves to the key of the one project with that name.
  useEffect(() => {
    const list = projects.data
    if (!project || !list || activeId.current || list.some((item) => projectKey(item) === project)) return
    const named = list.filter((item) => item.name === project)
    if (named.length === 1) changeProject(projectKey(named[0]))
  }, [project, projects.data])

  function newSession() {
    setConversationAction(null)
    skipRestore.current = true
    changeDirectory(cwd)
    changeProject(project)
    navigation.current += 1
    setLoading(false)
    activeId.current = null
    localStorage.removeItem(LAST_SESSION)
    setSession(null)
    drafts.open(newDraftKey(project, cwd))
    setError('')
    setNotice('')
    setSelection(models?.selected ?? null)
    setWorkspaceOpen(false)
    followBottom.current = true
  }

  async function openSession(id: string) {
    if (isChatRemoved(id)) return
    setConversationAction(null)
    const view = ++navigation.current
    activeId.current = id
    setLoading(true)
    drafts.open(sessionDraftKey(id))
    setError('')
    setNotice('')
    try {
      const detail = await agentHost.session(id)
      if (view === navigation.current) activate(detail)
    } catch (e) {
      if (view === navigation.current) setError((e as Error).message)
    } finally {
      if (view === navigation.current) setLoading(false)
    }
  }

  async function send(text = input) {
    const prompt = text.trim()
    if ((!prompt && !attachments.length) || !drafts.ready || pending || sendInFlight.current || conversationInFlight.current) return
    // `/scenario …` never goes to the model; without a LayerFS project it only explains
    const scenario = /^\/scenario(?:\s+(\S+))?\s*$/.exec(prompt)
    if (scenario) {
      if (!(session ? session.project ?? session.scenario?.project : project)) setNotice(t("/scenario plays on a LayerFS project. Choose a project in Workspace, then try again."))
      else if (scenario[1]) { setInput(''); void playScenario(scenario[1]) }
      else setInput('/scenario ')
      return
    }
    // a scenario chat answers with its own script, whatever the composer's model is
    const scripted = !!session?.scenario
    if (!selection && !scripted) {
      setInput(prompt)
      settings.open('models')
      return
    }
    const chosenModel = scripted ? undefined : currentModelMeta
    if (attachments.some((item) => item.mimeType.startsWith('image/')) && imageInputSupport(chosenModel?.input) === false) { setError("Choose a model that supports images, or remove the image attachments."); return }
    const sentDraft = drafts.snapshot()
    const sentKey = drafts.key()
    sendInFlight.current = true
    const view = navigation.current
    setPending(true)
    setError('')
    setNotice('')
    followBottom.current = true
    try {
      let target = session
      if (!target) {
        target = await agentHost.create({ ...(project ? { project } : {}), cwd: cwd.trim() || undefined, ...selection, permissionMode: 'full', ...(sentDraft.limits?.instructions ? { limits: { instructions: sentDraft.limits.instructions } } : {}) })
        if (view !== navigation.current) {
          update(target)
          return
        }
        activate(target)
        drafts.open(sessionDraftKey(target.id), sentDraft)
        if (!target.project) localStorage.setItem(LAST_CWD, target.cwd)
        setWorkspaceOpen(false)
      }
      const detail = await agentHost.send(target.id, { text: prompt, attachments: attachmentPayload(sentDraft.attachments), mode: 'followUp', ...(target.state === 'running' || target.scenario || !selection ? {} : selection) })
      if (detail.id === target.id) update(detail)
      else activateReplacement(detail, target.id, view)
      drafts.clear(sentKey, sentDraft)
      drafts.clear(sessionDraftKey(target.id), sentDraft)
    } catch (e) {
      if (view === navigation.current) setError((e as Error).message)
    } finally {
      sendInFlight.current = false
      setPending(false)
    }
  }

  async function sessionAction(action: 'stop' | 'compact') {
    if (!session || conversationInFlight.current || pending) return
    const view = navigation.current
    setPending(true)
    setError('')
    setNotice('')
    try {
      update(await agentHost[action](session.id))
      if (view === navigation.current) setNotice(action === 'compact' ? "Conversation context compacted." : session.queued?.length ? "Agent stopped and queued messages cleared." : "Agent stopped. Send another message to continue.")
    } catch (e) {
      if (view === navigation.current) setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  async function changeQueuedMessage(messageId: string, action: 'steerQueued' | 'removeQueued') {
    if (!session) return
    const id = session.id
    try {
      update(await agentHost[action](id, messageId))
    } catch (e) {
      refreshSession(id)
      throw e
    }
  }

  async function changeConversation(target: ConversationActionTarget, text: string) {
    if (conversationInFlight.current || sendInFlight.current) throw new Error(t("Wait for the current action to finish."))
    conversationInFlight.current = true
    const view = navigation.current
    setPending(true)
    setError('')
    setNotice('')
    try {
      if (target.action === 'duplicate' || target.action === 'fork') {
        const result = await agentHost.fork(target.session.id, target.message?.entryId)
        update(result.session)
        if (view === navigation.current) {
          // A copied session is a separate navigation target. Late reads of the
          // source session must not reopen it after this result arrives.
          navigation.current += 1
          skipRestore.current = true
          activate(result.session)
          drafts.open(sessionDraftKey(result.session.id), { text: result.draft ?? '', attachments: result.attachments ?? [] })
          setWorkspaceOpen(false)
          setNotice('Conversation copied. Send a message when you are ready to continue.')
        }
      } else {
        const entryId = target.message?.entryId
        if (!entryId) throw new Error('A saved restore point is not available for this message.')
        const result = target.action === 'rollback'
          ? await agentHost.rollback(target.session.id, entryId)
          : { session: await agentHost.editMessage(target.session.id, entryId, { text: text.trim(), attachments: attachmentPayload(target.message?.attachments ?? []), ...(selection ?? {}) }), draft: undefined }
        update(result.session)
        if (view === navigation.current && activeId.current === target.session.id) {
          if (result.draft !== undefined) drafts.open(sessionDraftKey(result.session.id), { text: result.draft, attachments: 'attachments' in result ? result.attachments ?? [] : [] })
          followBottom.current = true
          setNotice(target.action === 'rollback' ? "Conversation restored. Review the original message below before sending." : "Message updated and sent from its saved restore point.")
        }
      }
    } finally {
      conversationInFlight.current = false
      setPending(false)
    }
  }

  async function updateMetadata(target: AgentSessionSummary, patch: { title?: string; archived?: boolean }) {
    const detail = await agentHost.update(target.id, patch)
    update(detail)
    if (patch.archived && activeId.current === target.id) newSession()
    return detail
  }

  async function archiveSession(target: AgentSessionSummary) {
    if (pending || target.state === 'running' || target.execution?.phase === 'children') return
    setPending(true); setError('')
    try { await updateMetadata(target, { archived: !target.archived }); setNotice(target.archived ? "Conversation restored." : "Conversation archived.") }
    catch (e) { setError((e as Error).message) }
    finally { setPending(false) }
  }

  async function exportSession(target: AgentSessionSummary, format: 'copy' | 'md' | 'json') {
    try {
      const detail = await agentHost.session(target.id)
      if (format === 'copy') { await navigator.clipboard.writeText(conversationMarkdown(detail)); setNotice('Conversation copied.') }
      else exportConversation(detail, format)
    } catch (e) { setError((e as Error).message) }
  }

  async function continueSession() {
    if (!session || pending || agentRunning || !session.recovery?.canContinue) return
    setPending(true); setError(''); setNotice('')
    try { update(await agentHost.continue(session.id, selection ?? undefined)) }
    catch (e) { setError((e as Error).message) }
    finally { setPending(false) }
  }

  async function decideApproval(requestId: string, decision: 'approve' | 'reject') {
    if (!session) return
    setError('')
    try {
      update(await agentHost.approve(session.id, requestId, decision))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const messages = session?.messages ?? []
  const visibleError = error || session?.error
  const scenario = session?.scenario ?? null
  const ownModel = running || !!scenario
  const activeProvider = ownModel ? session?.provider : selection?.provider
  const modelLabel = ownModel ? session?.modelId : selection?.modelId
  // a scenario chat is on its project like any project chat
  const activeProject = session ? session.project ?? scenario?.project ?? '' : project
  const currentModelMeta = models?.models.find((m) => m.provider === activeProvider && m.id === modelLabel)
  const thinkingOptions = currentModelMeta?.thinkingLevels ?? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const activeThinking = (running ? session?.thinkingLevel : selection?.thinkingLevel) ?? 'off'
  const approvals = session?.approvals ?? []
  const pendingApprovals = approvals.filter((request) => request.status === 'pending').length
  const reviewingApprovals = approvals.filter((request) => request.status === 'reviewing').length
  const waitingApprovals = pendingApprovals + reviewingApprovals

  // The header owns model selection and settings for configured providers.
  const configuredProviderIds = new Set((models?.providers ?? []).filter((p) => p.hasKey || p.custom).map((p) => p.id))
  // a scenario's model plays only in its own chat (/scenario)
  const selectableModels = (models?.models ?? []).filter((m) => configuredProviderIds.has(m.provider) && m.provider !== SCENARIO_PROVIDER)

  async function saveSelection(next: ModelSelection) {
    setModelBusy(true)
    setError('')
    try {
      const catalog = await agentHost.saveModels(next)
      catalogRequest.current += 1
      setModels(catalog)
      setSelection(catalog.selected)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setModelBusy(false)
    }
  }

  function selectModelChoice(provider: string, modelId: string) {
    if (running) return
    void saveSelection({ provider, modelId, thinkingLevel: selection?.thinkingLevel ?? 'off' })
  }

  function selectThinkingLevel(level: string) {
    if (!selection || running) return
    void saveSelection({ ...selection, thinkingLevel: level })
  }

  // `/scenario <name>` opens a new chat whose model is the scenario's script, on the chat's
  // LayerFS project, in a folder of its own; it is stopped like any chat, with Stop.
  // `/scenario all` starts one such chat per scenario, all at once, and opens the first.
  async function playScenario(name: string) {
    const target = activeProject
    if (!target) return
    setError('')
    setNotice('')
    if (name.toLowerCase() === 'all') return playAllScenarios(target)
    try {
      const detail = await agentHost.create({ scenario: name, project: target })
      navigation.current += 1
      setConversationAction(null)
      setLoading(false)
      activate(detail)
    } catch (e) {
      setError(t("Could not start the scenario: {message}", { message: (e as Error).message }))
    }
  }
  async function playAllScenarios(target: string) {
    const ids = playable.map((item) => item.id)
    if (!ids.length) return setNotice(t("No scenario plays in a chat yet."))
    const started = await Promise.allSettled(ids.map((id) => agentHost.create({ scenario: id, project: target })))
    const first = started.find((result) => result.status === 'fulfilled')
    const failed = started.flatMap((result, i) => result.status === 'rejected' ? [`${ids[i]}: ${(result.reason as Error).message}`] : [])
    if (first) {
      navigation.current += 1
      setConversationAction(null)
      setLoading(false)
      activate(first.value)
    }
    if (failed.length) setError(t("Could not start {count} of {total} scenarios: {message}", { count: failed.length, total: ids.length, message: failed.join('; ') }))
    else setNotice(t("Started {count} scenarios, each in a chat of its own.", { count: ids.length }))
  }
  useEffect(() => {
    let live = true
    agentHost.scenarios().then((all) => live && setScenarios(all), () => live && setScenarios([]))
    return () => { live = false }
  }, [])
  const playable = (scenarios ?? []).filter((item) => !item.notInChat)
  const scenarioCommand: ComposerCommand = activeProject
    ? {
        id: 'scenario',
        label: t("Play scenario"),
        description: t("A new chat plays a scenario’s script here, in a folder of its own"),
        onSelect: () => {},
        options: [
          ...(playable.length > 1 ? [{ id: 'all', label: t("All scenarios"), description: t("{count} at once, each in a chat and folder of its own", { count: playable.length }) }] : []),
          ...playable.map((item) => ({ id: item.id, label: item.title, description: item.blurb || undefined })),
        ],
        onArgument: (name) => void playScenario(name),
      }
    : {
        id: 'scenario',
        label: t("Play scenario"),
        description: t("Needs a LayerFS project: choose one in Workspace first"),
        onSelect: () => setNotice(t("/scenario plays on a LayerFS project. Choose a project in Workspace, then try again.")),
      }

  const commands: ComposerCommand[] = [
    { id: 'new', label: t("New session"), description: t("Start a fresh conversation in this workspace"), onSelect: newSession },
    { id: 'model', label: t("Select model"), description: running ? t("Available after the current turn") : t("Choose the model for your next message"), disabled: running, onSelect: () => setModelMenuOpen(true) },
    { id: 'workspace', label: t("Workspace"), description: t("Working directory, project and recent folders"), onSelect: () => setWorkspaceOpen(true) },
    { id: 'compact', label: t("Compact context"), description: running ? t("Stop the agent before compacting") : !messages.length ? t("Start a conversation first") : t("Summarize earlier turns to free context"), disabled: !messages.length || running, onSelect: () => void sessionAction('compact') },
    { id: 'stop', label: t("Stop agent"), description: running ? t("Stop the current turn") : t("No agent is running"), disabled: !running, onSelect: () => void sessionAction('stop') },
    scenarioCommand,
  ]

  /** The project page, in this tab: its back link returns here, named by this chat's title. */
  const onOpenProject = openProjectPage && ((project: string, branch?: string) => openProjectPage(project, branch, session?.title ?? t("New chat")))
  const projectView = view === 'files' || view === 'history' || view === 'sandboxes'
  const shown: ChatView = (projectView && !activeProject) || (view === 'trace' && !session) ? 'chat' : view
  const viewButtons = sortByLabelLength<{ id: ChatView; label: string }>([
    { id: 'chat' as const, label: 'Chat' },
    ...(session ? [{ id: 'trace' as const, label: 'Trace' }] : []),
    ...(activeProject ? PROJECT_VIEWS : []),
  ].map((item) => ({ ...item, label: t(item.label) })))
  // Leave the welcome layout as soon as submission starts, before the session is created.
  const fresh = !session && !loading && !pending && messages.length === 0 && shown === 'chat'
  const workspaceMenus = () => (
    <WorkspaceMenus
      cwd={session?.cwd ?? cwd}
      project={activeProject}
      workspace={session?.workspace ?? null}
      locked={!!session}
      disabled={loading || pending}
      sessions={sessions}
      projects={projects.data ?? []}
      projectsLoading={projects.loading}
      projectError={projects.error?.message ?? ''}
      open={workspaceOpen}
      onOpenChange={setWorkspaceOpen}
      onDirectory={changeDirectory}
      onProject={changeProject}
      onRefresh={projects.reload}
      onNewProject={() => setNewProjectOpen(true)}
      onOpenProject={onOpenProject}
      onError={setError}
    />
  )

  return (
    <div className="relative flex h-svh min-h-0 flex-col overflow-hidden">
      {/* the chat's name and project, then its views */}
      <header className={cn('chat-content-gutter w-full shrink-0 pt-1.5', fresh && 'hidden')}>
        <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 py-1.5">
          {/* the project, then this chat: a breadcrumb */}
          {activeProject && onOpenProject && (
            <>
              <button
                type="button"
                data-open-project
                onClick={() => onOpenProject(activeProject)}
                title={t("Open {name}", { name: projectLabel(activeProject) })}
                className="-ml-1.5 inline-flex h-7 min-w-0 max-w-[28%] items-center gap-1.5 rounded-lg px-1.5 text-[15px] font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LfsProject className="size-4 shrink-0 text-primary/80" />
                <span className="min-w-0 truncate">{projectRef(activeProject).name}</span>
              </button>
              <span aria-hidden="true" className="shrink-0 text-[15px] text-faint">/</span>
            </>
          )}
          {openChild
            ? <button type="button" onClick={() => setChildView(null)} className="min-w-0 max-w-[28%] truncate rounded-md text-[15px] font-medium tracking-tight text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{session?.title ?? t("New chat")}</button>
            : <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-foreground">{session?.title ?? t("New chat")}</h1>}
          {openChild && <><span aria-hidden="true" className="shrink-0 text-[15px] text-faint">›</span><h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-foreground">{openChild.agent}</h1></>}
          {session && <SubagentsMenu children={session.children} open={subagentsOpen} onOpenChange={setSubagentsOpen} current={childView} onOpen={(id) => { setChildView(id); setView('chat') }} />}
          {connection !== 'connected' && <span role="status" title={connection === 'reconnecting' ? t("Connection lost. Reconnecting to the host…") : t("Connecting to the host…")} className="order-2 inline-flex max-w-full items-center gap-1 text-[11px] text-muted-foreground @min-[42rem]/workspace:order-none"><WifiOff className="size-3 shrink-0" /><span>{connection === 'reconnecting' ? t("Reconnecting") : t("Connecting")}</span></span>}
          {running && connection === 'connected' && (
            <span className="order-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] leading-4 font-medium text-primary @min-[42rem]/workspace:order-none">
              <LoaderCircle className="size-3 shrink-0 animate-spin" />
              {pendingApprovals ? t("Waiting for approval {count}", { count: pendingApprovals }) : reviewingApprovals ? t("Reviewing {count}", { count: reviewingApprovals }) : session?.execution?.phase === 'retrying' ? t("Retrying {count}", { count: session?.execution?.retryAttempt ?? 0 }) : session?.execution?.phase === 'children' ? t("Subagents working") : session?.execution?.phase === 'tool' ? t("Running tool") : session?.execution?.phase === 'stopping' ? t("Stopping") : t("Working")}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {session && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button ref={conversationTrigger} data-conversation-actions variant="ghost" size="icon-sm" aria-label={t("Conversation actions")} title={t("Conversation actions")} disabled={pending || loading} className="shrink-0 rounded-xl text-muted-foreground"><MoreHorizontal className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} collisionPadding={16} className="chat-choice-menu chat-actions-menu">
                <DropdownMenuItem onSelect={() => setSessionSettings({ mode: 'rename', session, returnFocus: conversationTrigger.current })}>
                  <Pencil />{t("Rename chat")}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={running || !messages.length} onSelect={() => setConversationAction({ action: 'duplicate', session, returnFocus: conversationTrigger.current })}>
                  <CopyPlus />{t("Duplicate chat")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportSession(session, 'copy')}>
                  <Clipboard />{t("Copy to clipboard")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportSession(session, 'md')}>
                  <FileText />{t("Export Markdown")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportSession(session, 'json')}>
                  <FileJson />{t("Export JSON")}
                </DropdownMenuItem>
                <DropdownMenuItem className="chat-actions-archive" disabled={running} onSelect={() => void archiveSession(session)}>
                  {session.archived ? <ArchiveRestore /> : <Archive />}{session.archived ? t("Restore chat") : t("Archive chat")}
                </DropdownMenuItem>
                {running && <p className="chat-actions-hint">{t("Stop the agent before duplicating or archiving.")}</p>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          </div>
        </div>
        <TabBar aria-label={t("Chat views")}>
          {viewButtons.map(({ id, label }) => (
            <Tab
              key={id}
              active={shown === id}
              title={id === 'files' && activeProject ? projectLabel(activeProject) : undefined}
              onClick={() => setView(id)}
            >
              <span data-chat-view={id}>{label}</span>
            </Tab>
          ))}
        </TabBar>
      </header>

      {projectView && shown === view && activeProject && (
        <ProjectView
          key={`${activeProject}:${projectBranch ?? ''}`}
          project={activeProject}
          initialBranch={projectBranch}
          embedded={view}
          onEmbeddedView={setView}
          onBack={() => setView('chat')}
          onNewChat={() => setView('chat')}
          onOpenChat={(id) => { void openSession(id); setView('chat') }}
        />
      )}
      {shown === 'trace' && session && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TraceView
            source={session.id}
            load={(o) => agentHost.trace(session.id, o)}
            watch={(e) => e.type === 'chat' && e.session.id === session.id}
            live={running}
            started={session.created}
            // a checkpoint's Commit or Branch opens in the Project tab's History
            onOpenHistory={activeProject ? (at) => { setProjectBranch(at.branch); setView('history') } : undefined}
          />
        </div>
      )}

      <div className={cn('flex min-h-0 flex-1 flex-col', shown !== 'chat' && 'hidden')}>
      {/* only a chat with a LayerFS mount has a branch to report; a project chat made now runs in its folder */}
      {activeProject && !scenario && !fresh && session?.workspace && <WorkspaceStatus project={activeProject} workspace={session?.workspace ?? null} started={!!session} onOpenProject={onOpenProject} />}


      {/* Main Conversation Canvas */}
      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current
          if (el) followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
        }}
        className={cn('min-h-0 flex-1 overflow-y-auto pt-3', fresh ? 'flex flex-col px-6 pb-7' : 'chat-content-gutter chat-conversation-scroll', openChild && 'hidden')}
      >
        <div className={cn('flex w-full min-w-0 flex-col gap-5', fresh && 'mx-auto mt-auto max-w-3xl')}>
          {loading ? (
            <div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin text-primary" />  {t("Loading…")}
            </div>
          ) : fresh ? (
            <h2 className="flex items-center justify-center gap-3 text-center text-[26px] font-semibold tracking-[-0.025em] text-foreground">
              <ConnectMark className="size-9 shrink-0" />
              {t("What would you like to build?")}
            </h2>
          ) : messages.length > 0 ? (
            <ConversationMessages
              key={session?.id}
              sessionId={session?.id}
              messages={messages}
              latestTaskComplete={!!session && canCollapseLatestTask(session)}
              disabled={pending || loading}
              running={running}
              onProcessToggle={() => { followBottom.current = false }}
              onAction={(action, target, returnFocus) => { if (session) setConversationAction({ action, session, message: target, returnFocus }) }}
            />
          ) : null}

          {running && waitingApprovals === 0 && messages.at(-1)?.status !== 'running' && (
            <div className="flex min-h-8 items-center py-1">
              <ThinkingLine />
            </div>
          )}

          {!!session?.children.length && <SubagentsSummary children={session.children} onOpen={() => setSubagentsOpen(true)} />}

          {session && !agentRunning && session.recovery?.canContinue && (session.recovery.required || session.state === 'error') && <div className="glass-liquid flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-xs">
            <span className="min-w-0 flex-1 text-muted-foreground">{session.execution?.reason || t("This run was interrupted. Continue from its saved context.")}</span>
            <Button size="sm" disabled={pending || loading} onClick={() => void continueSession()}><Play className="size-3.5" />{session.state === 'error' ? t("Retry") : t("Continue")}</Button>
          </div>}
          <div ref={approvalsAnchor}>
            <ApprovalPanel approvals={approvals} onDecision={decideApproval} />
          </div>

          {visibleError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-4 py-3 text-xs text-destructive"
            >
              <CircleHelp className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words leading-relaxed">{t(visibleError)}</span>
              {!models && (
                <Button size="xs" variant="ghost" onClick={() => void load()}>

                  {t("Reload")}
                </Button>
              )}
            </div>
          )}

          {notice && (
            <div
              role="status"
              className="glass-liquid flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs text-muted-foreground"
            >
              <span className="flex-1">{t(notice)}</span>
              <button
                type="button"
                aria-label={t("Dismiss notification")}
                onClick={() => setNotice('')}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-faint outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Composer */}
      {openChild && session && <ChildConversationView
        key={openChild.id}
        sessionId={session.id}
        child={openChild}
        onBack={() => setChildView(null)}
        onStop={async (runId) => update(await agentHost.stopChild(session.id, runId))}
      />}
      <div className={cn('shrink-0 pt-1 pb-5', fresh ? 'px-6' : 'chat-content-gutter', openChild && 'hidden')}>
        <div className={cn('w-full', fresh && 'mx-auto max-w-3xl')}>
          <div className="chat-composer-meta">
            {workspaceMenus()}
            <div className="chat-composer-status">
              {waitingApprovals > 0 && (
                <button
                  type="button"
                  onClick={() => approvalsAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-warning/15 px-2 text-[11px] font-semibold text-warning"
                  aria-label={t("{pending} pending approvals, {reviewing} under review", { pending: pendingApprovals, reviewing: reviewingApprovals })}
                >
                  <ShieldQuestion className="size-3" />
                  {pendingApprovals ? t("Pending approval {count}", { count: pendingApprovals }) : t("Reviewing {count}", { count: reviewingApprovals })}
                </button>
              )}
              {session && <ContextMeter usage={session.contextUsage} recorded={session.usage} execution={session.execution} />}
              {pending && <LoaderCircle className="size-3 shrink-0 animate-spin text-primary" />}
              {fresh && connection !== 'connected' && <span role="status" className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"><WifiOff className="size-3" />{connection === 'reconnecting' ? t("Reconnecting") : t("Connecting")}</span>}
            </div>
          </div>
          {drafts.storageError && <p role="alert" className="mb-2 text-xs text-destructive">{t(drafts.storageError)}</p>}
          {session && (
            <QueuedMessages
              key={session.id}
              messages={session.queued ?? []}
              disabled={pending || loading}
              onSteer={(id) => changeQueuedMessage(id, 'steerQueued')}
              onRemove={(id) => changeQueuedMessage(id, 'removeQueued')}
            />
          )}
          <Composer
            key={drafts.key()}
            className="z-10"
            value={input}
            attachments={attachments}
            onAttachments={setAttachments}
            supportsImages={imageInputSupport(currentModelMeta?.input)}
            commands={commands}
            onChange={setInput}
            onSend={() => void send()}
            onStop={() => void sessionAction('stop')}
            disabled={pending || loading || modelBusy || !drafts.ready}
            loading={running}
            placeholder={agentRunning ? t("Add a follow-up — it will run after this task…") : t("Ask the agent to work on your project… (/ for commands)")}
            sendLabel={agentRunning ? t("Queue follow-up") : t("Send message")}
            controls={
              <ModelSelector
                open={modelMenuOpen}
                onOpenChange={setModelMenuOpen}
                models={selectableModels}
                provider={activeProvider}
                modelId={modelLabel}
                thinking={activeThinking}
                thinkingOptions={thinkingOptions}
                disabled={running || pending || loading}
                busy={modelBusy}
                onModel={selectModelChoice}
                onThinking={selectThinkingLevel}
                onManage={() => settings.open('models')}
              />
            }
          />
        </div>
      </div>
      {/* below the composer: half the free height while the chat is new, so the title and composer sit in the middle */}
      {fresh && <div aria-hidden="true" className="grow shrink-0" />}

      </div>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        initialFolder={cwd}
        onCreated={(created) => {
          projects.add(created)
          const key = projectKey(created)
          setProject(key)
          drafts.open(newDraftKey(key, created.source || cwd))
          localStorage.setItem(LAST_PROJECT, key)
          if (created.source) changeDirectory(created.source)
        }}
      />
      {sessionSettings && <SessionSettingsDialog key={`${sessionSettings.session?.id ?? drafts.key()}:${sessionSettings.mode}`} target={sessionSettings} onClose={() => setSessionSettings(null)} onSave={async (value) => {
        if ('title' in value) { if (sessionSettings.session) await updateMetadata(sessionSettings.session, value) }
        else if (sessionSettings.session) update(await agentHost.limits(sessionSettings.session.id, value))
        else drafts.setLimits(value)
      }} />}
      {conversationAction && <ConversationActionDialog
        key={`${conversationAction.session.id}:${conversationAction.action}:${conversationAction.message?.entryId ?? ''}`}
        target={conversationAction}
        hasDraft={!!input.trim() || !!attachments.length}
        unavailable={sessions.some((item) => item.id === conversationAction.session.id && (item.state === 'running' || item.execution?.phase === 'children')) && !conversationInFlight.current ? t("Stop the agent before changing this conversation.") : undefined}
        onClose={() => setConversationAction(null)}
        onConfirm={(text) => changeConversation(conversationAction, text)}
      />}
    </div>
  )
}
