import { useI18n } from '@/i18n'
import { Archive, ArchiveRestore, ChevronDown, CircleHelp, Copy, Download, FolderOpen, History, LoaderCircle, MoreHorizontal, Pencil, Play, Plus, Settings2, ShieldQuestion, WifiOff, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AgentModels, AgentSessionDetail, AgentSessionSummary, ModelSelection } from '@shared/agent-api'

import { ConnectMark } from '@/components/connect-mark'
import { AgentMessage, ChildRuns } from '@/components/chat/agent-messages'
import { attachmentPayload, hydrateMessageAttachments } from '@/components/chat/attachments'
import { newDraftKey, sessionDraftKey, useChatDraft } from '@/components/chat/chat-drafts'
import { SessionSettingsDialog, type SessionSettingsTarget } from '@/components/chat/session-settings'
import { conversationMarkdown, exportConversation } from '@/components/chat/transcript-export'
import { Composer } from '@/components/chat/composer'
import { ConversationActionDialog, type ConversationActionTarget } from '@/components/chat/conversation-actions'
import { ContextMeter } from '@/components/chat/context-meter'
import { ModelSettingsDialog } from '@/components/chat/model-settings'
import { ModelSelector } from '@/components/chat/model-selector'
import { ApprovalPanel } from '@/components/chat/permissions'
import { QueuedMessages } from '@/components/chat/queued-messages'
import { SessionHistory } from '@/components/chat/session-history'
import { Suggestions } from '@/components/chat/suggestions'
import { WorkspacePicker } from '@/components/chat/workspace-picker'
import { WorkspaceStatus } from '@/components/chat/workspace-status'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { spotlight } from '@/components/motion/spotlight'
import { ThinkingLine } from '@/components/runs/thread-items'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { agentHost } from '@/host/agent-client'
import { onHostConnection, onHostEvent, type HostConnection } from '@/host/client'
import type { ProjectCatalog } from '@/host/use-projects'
import { cn } from '@/lib/utils'
import './chat.css'

const isMac = window.connect.platform === 'darwin'
const LAST_SESSION = 'connect.agent.last-session'
const LAST_CWD = 'connect.agent.cwd'
const LAST_PROJECT = 'connect.agent.project'
const byUpdated = (a: AgentSessionSummary, b: AgentSessionSummary) => b.updated - a.updated
const mergeHistory = (current: AgentSessionSummary[], incoming: AgentSessionSummary[], deleted: ReadonlySet<string>) => {
  const all = new Map(current.filter((session) => !deleted.has(session.id)).map((session) => [session.id, session]))
  for (const session of incoming) {
    if (deleted.has(session.id)) continue
    if (!all.has(session.id) || all.get(session.id)!.updated <= session.updated) all.set(session.id, session)
  }
  return [...all.values()].sort(byUpdated)
}

interface ChatHomeProps {
  projects: ProjectCatalog
  initialProject?: string
  onOpenProject?: (project: string, branch?: string) => void
}

export function ChatHome({ projects, initialProject, onOpenProject }: ChatHomeProps) {
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
  const [modelsOpen, setModelsOpen] = useState(false)
  const [modelBusy, setModelBusy] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [sessionSettings, setSessionSettings] = useState<SessionSettingsTarget | null>(null)
  const [connection, setConnection] = useState<HostConnection>('connecting')
  const [conversationAction, setConversationAction] = useState<ConversationActionTarget | null>(null)
  const activeId = useRef<string | null>(null)
  const navigation = useRef(0)
  const skipRestore = useRef(initialProject !== undefined)
  const sendInFlight = useRef(false)
  const conversationInFlight = useRef(false)
  const conversationTrigger = useRef<HTMLButtonElement>(null)
  const catalogRequest = useRef(0)
  // The mount-only SSE listener must see the current catalog when switching sessions.
  const modelCatalog = useRef(models)
  modelCatalog.current = models
  const nativeNavigation = useRef<{
    sequence: number
    links: Map<string, { sessionId: string; sequence: number }>
    pending: { fromId: string; view: number; targetId: string } | null
  }>({ sequence: 0, links: new Map(), pending: null })
  const deletedIds = useRef(new Set<string>())
  const scroller = useRef<HTMLDivElement>(null)
  const approvalsAnchor = useRef<HTMLDivElement>(null)
  const followBottom = useRef(true)
  const agentRunning = session?.state === 'running'
  const running = agentRunning || session?.execution?.phase === 'children' || !!session?.children.some((child) => /^(running|pending|queued|paused)$/.test(child.state))

  function update(detail: AgentSessionDetail) {
    if (deletedIds.current.has(detail.id)) return
    const { messages: _messages, queued: _queued, tools: _tools, children: _children, approvals: _approvals, ...summary } = detail
    setSessions((all) => mergeHistory(all, [summary], deletedIds.current))
    if (activeId.current === detail.id) {
      setSession((current) => current && current.id === detail.id && current.updated > detail.updated ? current : { ...detail, messages: hydrateMessageAttachments(detail.messages, current?.id === detail.id ? current.messages : []) })
    }
  }

  function activate(detail: AgentSessionDetail, useSessionModel = true, catalog = modelCatalog.current) {
    if (deletedIds.current.has(detail.id)) return
    activeId.current = detail.id
    localStorage.setItem(LAST_SESSION, detail.id)
    if (!detail.project) setCwd(detail.cwd)
    setProject(detail.project ?? '')
    const configured = catalog?.providers.some((provider) => provider.id === detail.provider && (provider.custom || provider.hasKey))
    const available = configured && catalog?.models.some((model) => model.provider === detail.provider && model.id === detail.modelId)
    if (useSessionModel && available && detail.provider && detail.modelId) setSelection({ provider: detail.provider, modelId: detail.modelId, thinkingLevel: detail.thinkingLevel })
    followBottom.current = true
    drafts.open(sessionDraftKey(detail.id))
    update(detail)
  }

  function activateReplacement(detail: AgentSessionDetail, fromId: string, view: number) {
    update(detail)
    // HTTP and SSE can race; only the first result still on the source may navigate.
    if (detail.id === fromId || deletedIds.current.has(detail.id) || activeId.current !== fromId || navigation.current !== view) return
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
      const last = activeId.current ?? (skipRestore.current ? null : localStorage.getItem(LAST_SESSION))
      if (last && history.some((s) => s.id === last && !s.archived)) {
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
      if (!deletedIds.current.has(id) && activeId.current === id) setError(e.message)
    })
  }

  useEffect(() => {
    if (initialProject !== undefined) {
      localStorage.removeItem(LAST_SESSION)
      localStorage.setItem(LAST_PROJECT, initialProject)
    }
    void load()
    const connectionOff = onHostConnection(setConnection)
    const unsubscribe = onHostEvent((event) => {
      if (event.type === 'chat') update(event.session)
      if (event.type === 'chat-navigate') navigateNative(event.fromId, event.sessionId)
    }, () => {
      // Events are live, so read the current snapshot after a reconnect.
      const id = activeId.current
      if (id) refreshSession(id)
    })
    return () => {
      navigation.current += 1
      activeId.current = null
      unsubscribe()
      connectionOff()
    }
  }, [])

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
    if (!selection) {
      setInput(prompt)
      setModelsOpen(true)
      return
    }
    const chosenModel = models?.models.find((item) => item.provider === selection.provider && item.id === selection.modelId)
    if (attachments.some((item) => item.mimeType.startsWith('image/')) && !chosenModel?.input?.includes('image')) { setError("Choose a model that supports images, or remove the image attachments."); return }
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
        target = await agentHost.create({ ...(project ? { project } : { cwd: cwd.trim() || undefined }), ...selection, permissionMode: 'full', limits: sentDraft.limits })
        if (view !== navigation.current) {
          update(target)
          return
        }
        activate(target)
        drafts.open(sessionDraftKey(target.id), sentDraft)
        if (!target.project) localStorage.setItem(LAST_CWD, target.cwd)
        setWorkspaceOpen(false)
      }
      const detail = await agentHost.send(target.id, { text: prompt, attachments: attachmentPayload(sentDraft.attachments), mode: 'followUp', ...(target.state === 'running' ? {} : selection) })
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

  async function removeSession(id: string) {
    await agentHost.remove(id)
    drafts.clear(sessionDraftKey(id))
    // In-flight history reads and the stop event can arrive after DELETE.
    deletedIds.current.add(id)
    setSessions((all) => all.filter((s) => s.id !== id))
    if (activeId.current === id) newSession()
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
          setHistoryOpen(false)
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
    try { await updateMetadata(target, { archived: !target.archived }); setNotice(target.archived ? "Conversation restored." : "Conversation archived. Find it under Archived in History.") }
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
  const totalCost = session?.usage?.cost ?? messages.reduce((sum, message) => sum + (message.usage?.cost ?? 0), 0)
  const activeProvider = running ? session?.provider : selection?.provider
  const modelLabel = running ? session?.modelId : selection?.modelId
  const activeProject = session ? session.project ?? '' : project
  const activeCwd = activeProject ? session?.workspace?.path ?? t("Managed LayerFS workspace") : session?.cwd ?? (cwd || t("Choose directory"))
  const folderShort = activeProject ? t("LayerFS workspace") : activeCwd.split('/').filter(Boolean).slice(-2).join('/') || activeCwd
  const currentModelMeta = models?.models.find((m) => m.provider === activeProvider && m.id === modelLabel)
  const thinkingOptions = currentModelMeta?.thinkingLevels ?? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const activeThinking = (running ? session?.thinkingLevel : selection?.thinkingLevel) ?? 'off'
  const approvals = session?.approvals ?? []
  const pendingApprovals = approvals.filter((request) => request.status === 'pending').length
  const reviewingApprovals = approvals.filter((request) => request.status === 'reviewing').length
  const waitingApprovals = pendingApprovals + reviewingApprovals

  // The header owns model selection and settings for configured providers.
  const configuredProviderIds = new Set((models?.providers ?? []).filter((p) => p.hasKey || p.custom).map((p) => p.id))
  const selectableModels = (models?.models ?? []).filter((m) => configuredProviderIds.has(m.provider))

  function openHistoryDrawer() {
    setHistoryOpen(true)
    void agentHost.sessions().then((h) => setSessions((all) => mergeHistory(all, h, deletedIds.current)), (e: Error) => setError(e.message))
    if (activeId.current) {
      refreshSession(activeId.current)
    }
  }

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

  async function refreshSyncedModels() {
    // Read the latest catalog rather than applying a delayed sync response.
    const request = ++catalogRequest.current
    const catalog = await agentHost.models()
    if (request === catalogRequest.current) setModels(catalog)
  }

  function selectModelChoice(provider: string, modelId: string) {
    if (running) return
    void saveSelection({ provider, modelId, thinkingLevel: selection?.thinkingLevel ?? 'off' })
  }

  function selectThinkingLevel(level: string) {
    if (!selection || running) return
    void saveSelection({ ...selection, thinkingLevel: level })
  }

  const commands = [
    { id: 'new', label: t("New session"), description: t("Start a fresh conversation in this workspace"), onSelect: newSession },
    { id: 'history', label: t("History & context"), description: t("Find a session or inspect its saved context"), onSelect: openHistoryDrawer },
    { id: 'model', label: t("Select model"), description: running ? t("Available after the current turn") : t("Choose the model for your next message"), disabled: running, onSelect: () => setModelMenuOpen(true) },
    { id: 'workspace', label: t("Workspace"), description: t("Working directory, project and recent folders"), onSelect: () => setWorkspaceOpen(true) },
    { id: 'compact', label: t("Compact context"), description: running ? t("Stop the agent before compacting") : !messages.length ? t("Start a conversation first") : t("Summarize earlier turns to free context"), disabled: !messages.length || running, onSelect: () => void sessionAction('compact') },
    { id: 'stop', label: t("Stop agent"), description: running ? t("Stop the current turn") : t("No agent is running"), disabled: !running, onSelect: () => void sessionAction('stop') },
  ]

  return (
    <div className="relative flex h-svh min-h-0 flex-col overflow-hidden">
      <div className={cn('h-10 shrink-0 app-drag', !isMac && 'pr-36')} />

      {/* Unified Top Bar */}
      <header className="mx-auto flex w-full max-w-4xl shrink-0 items-center justify-between gap-3 px-6 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("History & conversation context")}
            data-session-history aria-label={t("Session history")}
            disabled={pending || loading}
            onClick={openHistoryDrawer}
            className="shrink-0 rounded-xl text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <History className="size-4" />
          </Button>
          <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
            {session?.title ?? t("New session")}
          </h1>
          {connection !== 'connected' && <span role="status" title={connection === 'reconnecting' ? t("Connection lost. Reconnecting to the host…") : t("Connecting to the host…")} className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"><WifiOff className="size-3" /><span>{connection === 'reconnecting' ? t("Reconnecting") : t("Connecting")}</span></span>}
          {running && connection === 'connected' && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-primary">
              <LoaderCircle className="size-3 animate-spin" />
              {pendingApprovals ? t("Waiting for approval {count}", { count: pendingApprovals }) : reviewingApprovals ? t("Reviewing {count}", { count: reviewingApprovals }) : session?.execution?.phase === 'retrying' ? t("Retrying {count}", { count: session?.execution?.retryAttempt ?? 0 }) : session?.execution?.phase === 'children' ? t("Subagents working") : session?.execution?.phase === 'tool' ? t("Running tool") : session?.execution?.phase === 'stopping' ? t("Stopping") : t("Working")}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-expanded={workspaceOpen}
            aria-label={t("Workspace settings")}
            onClick={() => setWorkspaceOpen(!workspaceOpen)}
            title={activeCwd}
            className={cn(
              'flex h-8 max-w-64 items-center gap-1.5 overflow-hidden rounded-full px-3 text-xs font-medium transition-colors outline-none',
              workspaceOpen
                ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                : 'bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground',
            )}
          >
            <FolderOpen className="size-3.5 shrink-0 opacity-75" />
            <span className="hidden min-w-0 truncate font-mono text-[11.5px] xl:block">{folderShort}</span>
            {activeProject && (
              <span title={activeProject} className="hidden max-w-24 shrink-0 truncate rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-semibold text-primary xl:block">
                {activeProject}
              </span>
            )}
            <ChevronDown className={cn('size-3 shrink-0 opacity-60 transition-transform duration-(--dur-base)', workspaceOpen && 'rotate-180')} />
          </button>

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
            onManage={() => setModelsOpen(true)}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={newSession}
            disabled={pending || loading}
            className="h-8 rounded-full bg-foreground/[0.04] px-3 text-xs font-medium text-foreground/85 hover:bg-foreground/[0.08] hover:text-foreground"
          >
            <Plus className="size-3.5" />

            {t("New")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button ref={conversationTrigger} data-conversation-actions variant="ghost" size="icon-sm" aria-label={t("Conversation actions")} title={t("Conversation actions")} disabled={pending || loading} className="shrink-0 rounded-xl text-muted-foreground"><MoreHorizontal className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="chat-popover w-56">
              {session && <DropdownMenuItem className="text-xs" onSelect={() => setSessionSettings({ mode: 'rename', session, returnFocus: conversationTrigger.current })}><Pencil className="size-3.5" />{t("Rename chat")}</DropdownMenuItem>}
              <DropdownMenuItem className="text-xs" disabled={running} onSelect={() => setSessionSettings({ mode: 'limits', session: session ?? undefined, limits: drafts.snapshot().limits, returnFocus: conversationTrigger.current })}><Settings2 className="size-3.5" />{t("Run settings")}</DropdownMenuItem>
              {session && <><DropdownMenuSeparator />
              <DropdownMenuItem disabled={running || !messages.length} className="text-xs" onSelect={() => setConversationAction({ action: 'duplicate', session, returnFocus: conversationTrigger.current })}><Copy className="size-3.5" />{t("Duplicate chat")}</DropdownMenuItem>
              {running && <p className="px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">{t("Stop the agent before copying or archiving.")}</p>}
              <DropdownMenuItem className="text-xs" onSelect={() => void exportSession(session, 'copy')}><Copy className="size-3.5" />{t("Copy conversation")}</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onSelect={() => void exportSession(session, 'md')}><Download className="size-3.5" />{t("Export Markdown")}</DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onSelect={() => void exportSession(session, 'json')}><Download className="size-3.5" />{t("Export JSON")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs" disabled={running} onSelect={() => void archiveSession(session)}>{session.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}{session.archived ? t("Restore chat") : t("Archive chat")}</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {activeProject && <WorkspaceStatus project={activeProject} workspace={session?.workspace ?? null} started={!!session} onOpenProject={onOpenProject} />}

      {workspaceOpen && (
        <WorkspacePicker
          cwd={activeProject ? cwd : session?.cwd ?? cwd}
          project={activeProject}
          workspace={session?.workspace ?? null}
          locked={!!session}
          disabled={loading || pending}
          sessions={sessions}
          projects={projects.data ?? []}
          projectsLoading={projects.loading}
          projectError={projects.error?.message ?? ''}
          onDirectory={changeDirectory}
          onProject={changeProject}
          onRefresh={projects.reload}
          onNewProject={() => setNewProjectOpen(true)}
          onOpenProject={onOpenProject}
        />
      )}

      {/* Main Conversation Canvas */}
      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current
          if (el) followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
        }}
        className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-8"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {loading ? (
            <div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin text-primary" />  {t("Loading…")}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-16 pb-6 text-center sm:pt-24 [@media(max-height:700px)]:pt-10">
              <span
                onPointerMove={spotlight}
                className="glass-liquid spotlight mb-5 flex size-14 items-center justify-center rounded-2xl"
              >
                <ConnectMark className="size-8" />
              </span>
              <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-[26px]">

                {t("What would you like to build?")}
              </h2>
              <div className="mt-7 w-full">
                <Suggestions onSelect={(prompt) => setInput(prompt)} />
              </div>
            </div>
          ) : (
            messages.map((message) => <AgentMessage key={message.id} sessionId={session?.id} message={message} disabled={pending || loading} running={running} onAction={(action, target, returnFocus) => { if (session) setConversationAction({ action, session, message: target, returnFocus }) }} />)
          )}

          {running && waitingApprovals === 0 && messages.at(-1)?.status !== 'running' && (
            <div className="flex items-center gap-3.5">
              <div className="glass-liquid flex size-8 shrink-0 items-center justify-center rounded-xl">
                <ConnectMark className="size-4.5" />
              </div>
              <ThinkingLine />
            </div>
          )}

          {!!session?.children.length && <ChildRuns children={session.children} onStop={async (id) => update(await agentHost.stopChild(session.id, id))} />}

          {session && !agentRunning && session.recovery?.canContinue && <div className="glass-liquid flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-xs">
            <span className="min-w-0 flex-1 text-muted-foreground">{session?.execution?.reason || (session.recovery.required ? t("This run was interrupted. Continue from its saved context.") : t("Continue working from the current context."))}</span>
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
      <div className="shrink-0 px-6 pt-1 pb-5">
        <div className="mx-auto w-full max-w-3xl">
          {session && (
            <QueuedMessages
              key={session.id}
              messages={session.queued ?? []}
              disabled={pending || loading}
              onSteer={(id) => changeQueuedMessage(id, 'steerQueued')}
              onRemove={(id) => changeQueuedMessage(id, 'removeQueued')}
            />
          )}
          {drafts.storageError && <p role="alert" className="mb-2 text-xs text-destructive">{t(drafts.storageError)}</p>}
          <Composer
            key={drafts.key()}
            className="z-10"
            value={input}
            attachments={attachments}
            onAttachments={setAttachments}
            supportsImages={!!currentModelMeta?.input?.includes('image')}
            commands={commands}
            onChange={setInput}
            onSend={() => void send()}
            onStop={() => void sessionAction('stop')}
            disabled={pending || loading || modelBusy || !drafts.ready}
            loading={running}
            placeholder={agentRunning ? t("Add a follow-up — it will run after this task…") : t("Ask the agent to work on your project… (/ for commands)")}
            sendLabel={agentRunning ? t("Queue follow-up") : t("Send message")}
            controls={
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {waitingApprovals > 0 && (
                  <button
                    type="button"
                    onClick={() => approvalsAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
                    className="inline-flex h-6.5 items-center gap-1 rounded-full bg-warning/15 px-2.5 text-[11px] font-semibold text-warning"
                    aria-label={t("{pending} pending approvals, {reviewing} under review", { pending: pendingApprovals, reviewing: reviewingApprovals })}
                  >
                    <ShieldQuestion className="size-3" />
                    {pendingApprovals ? t("Pending approval {count}", { count: pendingApprovals }) : t("Reviewing {count}", { count: reviewingApprovals })}
                  </button>
                )}

                {session && <ContextMeter usage={session.contextUsage} recorded={session.usage} execution={session.execution} />}
                {totalCost > 0 && <span title={t("Recorded agent history cost; includes copied and branched history")} className="font-mono text-[11px] text-faint tabular-nums">${totalCost.toFixed(4)}</span>}
                {pending && <LoaderCircle className="size-3 shrink-0 animate-spin text-primary" />}
              </div>
            }
          />
        </div>
      </div>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        initialFolder={cwd}
        onCreated={(created) => {
          projects.add(created)
          setProject(created.name)
          drafts.open(newDraftKey(created.name, created.source || cwd))
          localStorage.setItem(LAST_PROJECT, created.name)
          if (created.source) changeDirectory(created.source)
        }}
      />
      <ModelSettingsDialog
        open={modelsOpen}
        onOpenChange={setModelsOpen}
        models={models ? { ...models, selected: selection } : undefined}
        onSynced={refreshSyncedModels}
        onSaved={(catalog) => {
          catalogRequest.current += 1
          setModels(catalog)
          setSelection(catalog.selected)
          setError('')
        }}
      />
      <SessionHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        sessions={sessions}
        activeSession={session}
        selectedId={activeId.current}
        compacting={pending}
        actionMessage={notice}
        actionError={visibleError || undefined}
        onSelect={(id) => void openSession(id)}
        onNew={newSession}
        onCompact={() => void sessionAction('compact')}
        onRemove={removeSession}
        hasDraft={drafts.has}
        onRename={(target) => { setHistoryOpen(false); setSessionSettings({ mode: 'rename', session: target }) }}
        onArchive={archiveSession}
        onExport={(target, format) => void exportSession(target, format)}
        onDuplicate={(target) => { setHistoryOpen(false); setConversationAction({ action: 'duplicate', session: target }) }}
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
