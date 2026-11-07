// One subagent: a card with its state, numbers and task (Stop run while it
// works), then its own conversation, read-only, drawn as the chat's is.
import { ArrowLeft, LoaderCircle, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { chatHost, childActive, type ChatDetail, type ChildRun } from '@/layerfs/agent-api'
import { useChild } from '@/layerfs/use-child'
import { cn } from '@/lib/utils'
import { ScopeContext } from '../conversation/scope'
import { ChildDot } from '../conversation/steps/SubagentStep'
import { Transcript } from '../conversation/Transcript'
import '../conversation/chat.css'
import { childFacts } from './facts'

export function ChildView({ chat, child: summary, onChange }: { chat: ChatDetail; child: ChildRun; onChange: (next: ChatDetail) => void }) {
  const { data, error } = useChild(chat.id, summary.id)
  // the chat's own entry is the freshest for state; the conversation read adds the numbers from its file
  const child = { ...data?.child, ...summary, ...(data?.child.tokens ? { tokens: data.child.tokens, turns: data.child.turns, toolCount: data.child.toolCount, cost: data.child.cost } : {}) }
  const active = childActive(child)
  const [taskOpen, setTaskOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)
  const scope = useMemo(() => ({ chatId: chat.id, children: [], focus: null, inChild: true }), [chat.id])

  async function stop() {
    setStopping(true)
    setStopError(null)
    try {
      onChange(await chatHost.stopChild(chat.id, child.id))
    } catch (cause) {
      setStopError((cause as Error).message)
    } finally {
      setStopping(false)
    }
  }

  const messages = data?.messages ?? []
  // its conversation opens with the task; the card repeats it only while there is none
  const showTask = !!child.task && messages[0]?.role !== 'user'
  return (
    <div className="mx-auto flex w-full max-w-[780px] flex-col gap-4 px-5 pb-10 pt-5">
      {/* wide, the list stays beside it */}
      <Link to={`/chat/${encodeURIComponent(chat.id)}/subagents`} className="flex w-fit items-center gap-1 text-12 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] @min-[900px]/chat:hidden">
        <ArrowLeft className="size-3.5" /> All subagents
      </Link>
      <div className="flex flex-col gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--card)] px-4 py-3 text-13">
        <div className="flex min-w-0 items-center gap-2">
          <ChildDot child={child} />
          <span className="truncate text-14 font-medium text-[var(--text-primary)]">{child.agent}</span>
          <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-11 text-[var(--text-secondary)]">{child.state}</span>
          {active && child.currentTool && <span className="truncate text-12 text-[var(--text-tertiary)]">in {child.currentTool}</span>}
          {active && (
            <Button size="xs" variant="outline" className="ml-auto rounded-md" onClick={() => void stop()} disabled={stopping}>
              {stopping ? <LoaderCircle className="animate-spin" /> : <Square />} Stop run
            </Button>
          )}
        </div>
        <p className="flex flex-wrap gap-x-2.5 text-12 tabular-nums text-[var(--text-tertiary)]">
          {childFacts(child).map((f) => (
            <span key={f}>{f}</span>
          ))}
        </p>
        {showTask && (
          <button type="button" onClick={() => setTaskOpen((v) => !v)} className="text-left text-13 leading-5 text-[var(--text-secondary)]">
            <span className="text-[var(--text-tertiary)]">Task: </span>
            <span className={cn('whitespace-pre-wrap', !taskOpen && 'line-clamp-2')}>{child.task}</span>
          </button>
        )}
        {child.error && <p className="text-12 text-destructive">{child.error}</p>}
        {stopError && <p role="alert" className="text-12 text-destructive">{stopError}</p>}
      </div>
      {error && <p role="alert" className="text-12 text-destructive">Its conversation could not load: {error}</p>}
      {!data && !error ? (
        <p className="flex items-center gap-2 text-13 text-[var(--text-tertiary)]">
          <LoaderCircle className="size-3.5 animate-spin" /> Loading…
        </p>
      ) : data && messages.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border-default)] px-4 py-5 text-13 text-[var(--text-tertiary)]">
          {active ? "This subagent's conversation shows here once it saves; its latest output is below." : 'This subagent left no conversation to show.'}
          {child.text && <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-12 text-[var(--text-secondary)]">{child.text}</pre>}
        </div>
      ) : (
        <ScopeContext.Provider value={scope}>
          <div className="flex flex-col gap-4">
            <Transcript messages={messages} running={active} opener="task" />
          </div>
        </ScopeContext.Provider>
      )}
    </div>
  )
}
