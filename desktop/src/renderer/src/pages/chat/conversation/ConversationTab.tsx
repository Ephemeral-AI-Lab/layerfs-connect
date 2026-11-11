import { PiContext } from './PiContext'
import { readDraft, saveDraft } from '@/layerfs/chat-drafts'
// The Chat tab: the conversation in a centred column, and at the bottom what
// is happening now (approval, status, queue) over the message box. It stays
// pinned to the newest line while the agent writes, unless you scroll up.
// ?at=<tool call id> (from the Trace) opens that step and scrolls to it.
import { ArrowDown, CircleCheck, CircleX, SquareDashed } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Composer } from '@/components/chat/Composer'
import { LfsProject } from '@/components/layerfs/LfsIcons'
import { chatHost, chatProject, type ChatDetail, type ChildRun } from '@/layerfs/agent-api'
import { splitProjectKey } from '@/layerfs/chat-groups'
import { ChatDock } from './ChatDock'
import { ScopeContext, ScopeChildrenContext } from './scope'
import { Transcript } from './Transcript'
import { parseSimulationCommand } from '@/layerfs/simulation-command'
import { useSimulationLaunch } from '../simulation/use-simulation'
import { SimulationCommandHelp } from '../simulation/SimulationCommandHelp'
import { SimulationLaunchStatus } from '../simulation/SimulationLaunchStatus'
import { SimulationStatus } from '../simulation/SimulationStatus'
import './chat.css'

export function ConversationTab({ chat: sourceChat, onChange, shown, child, loading, loadError }: {
  chat: ChatDetail
  onChange: (next: ChatDetail) => void
  shown: boolean
  child?: ChildRun
  loading?: boolean
  loadError?: string | null
}) {
  const [params] = useSearchParams()
  const simulation = useSimulationLaunch()
  const chat = sourceChat
  const running = chat.state === 'running'
  const focus = shown ? params.get('at') : null
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [away, setAway] = useState(false)
  const draftId = child ? `${chat.id}/children/${encodeURIComponent(child.id)}` : chat.id
  const [text, setText] = useState(() => readDraft(draftId))
  useEffect(() => saveDraft(draftId, text), [draftId, text])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const scripted = chat.provider === 'scenario' || chat.provider === 'simulation' || !!chat.simulation
  const scope = useMemo(() => ({ chatId: chat.id, focus, inChild: !!child, childId: child?.id }), [chat.id, focus, child?.id])
  const readOnly = child ? 'This delegated run is read-only. Continue the task in the main chat.' : null

  // keep to the bottom while pinned; open at the bottom
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && shown && pinned.current && !focus) el.scrollTop = el.scrollHeight
  }, [chat.messages, focus, shown])
  useEffect(() => {
    const el = scroller.current
    if (el && !focus) el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // a step opened from the Trace: stop following the bottom
  useEffect(() => {
    if (focus) pinned.current = false
  }, [focus])

  function onScroll() {
    const el = scroller.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    pinned.current = atBottom
    setAway(!atBottom)
  }

  function jump() {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    pinned.current = true
  }

  async function send() {
    const message = text.trim()
    if (!message || sending || simulation.busy || readOnly) return
    const command = parseSimulationCommand(message)
    if (command) {
      setSendError(null)
      if (!command.ok) { setSendError(command.error); return }
      if (await simulation.start(command.input)) setText('')
      return
    }
    if (scripted) return
    setSending(true)
    setSendError(null)
    try {
      onChange(await chatHost.message(chat.id, message))
      setText('')
      pinned.current = true
    } catch (cause) {
      setSendError((cause as Error).message)
    } finally {
      setSending(false)
    }
  }

  const simulationCommand = parseSimulationCommand(text) !== null
  const project = chatProject(chat)
  const where = project ? splitProjectKey(project) : null

  return (
    <ScopeContext.Provider value={scope}>
      <ScopeChildrenContext.Provider value={chat.children}>
      <div ref={scroller} data-agent-conversation={child?.id ?? 'main'} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[780px] flex-col gap-4 px-5 pb-8 pt-6">
          {loading && <p role="status" className="text-13 text-[var(--text-tertiary)]">Loading conversation…</p>}
          {loadError && <p role="alert" className="text-13 text-destructive">The conversation could not load: {loadError}</p>}
          <Transcript messages={chat.messages} running={running} opener={child ? 'task' : 'user'} />
          {chat.error && !running && (
            <p role="alert" className="rounded-xs bg-[color-mix(in_srgb,var(--destructive)_7%,transparent)] px-3 py-2 text-13 text-destructive">
              Stopped: {chat.error}
            </p>
          )}
          {chat.scenario && <ScenarioResult chat={chat} />}
          {!child && chat.simulation && <SimulationStatus id={chat.simulation.id} shown={shown} />}
        </div>
      </div>
      <div className="relative mx-auto w-full max-w-[780px] px-5 pb-4">
        {away && (
          <button
            type="button"
            onClick={jump}
            className="absolute -top-11 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--card)] px-3 text-12 text-[var(--text-secondary)] shadow-[0_2px_8px_rgb(20_40_80/0.08)] hover:text-[var(--text-primary)]"
          >
            <ArrowDown className="size-3.5" /> Jump to latest
          </button>
        )}
        <PiContext chat={chat} onChange={onChange} readOnly={!!child || scripted} />
        {!chat.simulation && <ChatDock chat={chat} onChange={onChange} child={child} />}
        <Composer
          value={text}
          onChange={setText}
          onSend={() => void send()}
          busy={sending || simulation.busy}
          sendBlocked={readOnly ?? (scripted && !simulationCommand ? 'Scripted chats accept /simulation to start a new run' : null)}
          placeholder={readOnly ? 'Read-only delegated run' : scripted ? 'Scripted conversation. /simulation starts a new run.' : running ? 'Queue a follow-up…' : 'Reply…'}
          chips={
            <span className="flex items-center gap-1.5 text-12 text-[var(--text-tertiary)]">
              {where ? <LfsProject className="size-3.5" /> : <SquareDashed className="size-3.5" />}
              {where ? `${where.name} · ${where.store}` : 'Scratch'}
              {child?.model && <span className="ml-2">{child.model}</span>}
            </span>
          }
        />
        {!child && <SimulationCommandHelp text={text} onChange={setText} />}
        <SimulationLaunchStatus launch={simulation} />
        {readOnly && <p className="mt-1.5 px-1 text-12 text-[var(--text-tertiary)]">{readOnly}</p>}
        {sendError && <p role="alert" className="mt-1.5 px-1 text-12 text-destructive">{sendError}</p>}
      </div>
      </ScopeChildrenContext.Provider>
    </ScopeContext.Provider>
  )
}

/** A scenario chat's ending: its final checks. */
function ScenarioResult({ chat }: { chat: ChatDetail }) {
  const scenario = chat.scenario as NonNullable<ChatDetail['scenario']> & { checks?: { name: string; ok: boolean; detail: string }[] }
  const checks = scenario.checks ?? []
  if (!checks.length && !scenario.error) return null
  return (
    <div className="rounded-md border border-[var(--border-default)] bg-[var(--card)] px-4 py-3 text-13">
      <p className="mb-1.5 font-medium text-[var(--text-primary)]">
        Scenario {scenario.title}: {scenario.state}
      </p>
      {scenario.error && <p className="mb-1.5 text-destructive">{scenario.error}</p>}
      <ul className="flex flex-col gap-1">
        {checks.map((check) => (
          <li key={check.name} className="flex gap-2 leading-5">
            {check.ok ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" /> : <CircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
            <span className="shrink-0 font-mono text-12 text-[var(--text-secondary)]">{check.name}</span>
            <span className="min-w-0 text-[var(--text-tertiary)]">{check.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
