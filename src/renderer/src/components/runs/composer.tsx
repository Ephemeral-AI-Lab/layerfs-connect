// The box under a conversation: what the user says to the project's agent.
// In a live session a message is its next turn; anywhere else (a replay, or
// a new conversation not started yet) it starts a live session on the
// project. `/scenario <name>` plays that scenario on the project, in a folder
// /<scenario>_<n>/ of its own, as a session of its own; `/scenario all` plays
// every scenario there at once. The model chip picks the model of the
// next message; Stop ends a live session's turn.
import type { DemoSummary, ModelsView, RunSummary } from '@shared/host-api'
import { ArrowUp, Check, ChevronDown, Clapperboard, Layers, Settings2, Sparkles, Square, TriangleAlert } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { ModelsDialog } from '@/components/models/models-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { modelLabel } from '@/components/runs/run-format'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'

interface ComposerProps {
  /** The LayerFS project the conversation is on. */
  project: string
  /** The session typed into; none for a new conversation. */
  run?: RunSummary
  /** Opens a session this box started (a live session, or a scenario's replay). */
  onOpenRun: (run: RunSummary) => void
  autoFocus?: boolean
  /** Small text on the right of the hint row (the thread's size). */
  aside?: ReactNode
}

type Choice = { provider: string; model: string }

/** One row of the slash menu: a command to complete, a scenario to play, or all of them. */
type MenuRow = { kind: 'command'; name: string; about: string } | { kind: 'scenario'; demo: DemoSummary } | { kind: 'all'; count: number }

const COMMANDS = [{ name: 'scenario', about: 'Play a scenario here, in a folder of its own' }]

export function Composer({ project, run, onOpenRun, autoFocus, aside }: ComposerProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [picked, setPicked] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [modelsOpen, setModelsOpen] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const demos = useHostQuery(() => host.demos(), [])
  const models = useHostQuery(() => host.models(), [modelsOpen])
  const live = run?.kind === 'live'
  const working = live && (run.state === 'running' || run.state === 'starting')

  // the slash menu: commands while the first word is typed, then scenarios
  const rows = useMemo<MenuRow[]>(() => {
    const m = /^\/(\S*)(\s+(.*))?$/s.exec(text)
    if (!m || dismissed) return []
    const [, word, rest, arg = ''] = m
    if (!rest) return COMMANDS.filter((c) => c.name.startsWith(word.toLowerCase())).map((c) => ({ kind: 'command', ...c }))
    if (word !== 'scenario') return []
    const q = arg.trim().toLowerCase()
    const all = demos.data?.length && 'all'.startsWith(q) ? [{ kind: 'all' as const, count: demos.data.length }] : []
    return [...all, ...(demos.data ?? []).filter((d) => !q || d.id.includes(q) || d.title.toLowerCase().includes(q)).map((demo) => ({ kind: 'scenario' as const, demo }))]
  }, [text, dismissed, demos.data])
  useEffect(() => setPicked(0), [rows.length])

  // grows with its text, up to a third of the window
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight / 3))}px`
  }, [text])
  useEffect(() => {
    if (autoFocus) box.current?.focus()
  }, [autoFocus])

  const act = async (work: () => Promise<void>) => {
    setSending(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  // a scenario plays in a folder of its own: the project's files and other sessions are left as they are
  const playScenario = (id: string) =>
    act(async () => {
      const started = await host.startRun(id, project)
      setText('')
      onOpenRun(started)
    })
  const playAll = () =>
    act(async () => {
      const started = await host.startAll(project)
      setText('')
      if (started[0]) onOpenRun(started[0])
    })

  const submit = () => {
    const body = text.trim()
    if (!body || sending || working) return
    const command = /^\/(\S+)\s*(.*)$/s.exec(body)
    if (command) {
      const [, name, arg] = command
      if (name !== 'scenario') return setError(`Unknown command /${name}. Try /scenario <name>.`)
      const id = arg.trim()
      if (!id) return setError('Name the scenario: /scenario <name>, or /scenario all.')
      if (id.toLowerCase() === 'all') return void playAll()
      const demo = demos.data?.find((d) => d.id === id || d.title.toLowerCase() === id.toLowerCase())
      if (!demo) return setError(`No scenario named ${id}.`)
      return void playScenario(demo.id)
    }
    void act(async () => {
      if (live) {
        await host.sendMessage(run.id, { text: body, ...choice })
        setText('')
        setChoice(null)
      } else {
        const started = await host.startSession(project, { text: body, ...choice })
        setText('')
        onOpenRun(started)
      }
    })
  }

  const choose = (row: MenuRow) => {
    if (row.kind === 'command') {
      setText(`/${row.name} `)
      box.current?.focus()
    } else if (row.kind === 'all') void playAll()
    else void playScenario(row.demo.id)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (rows.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPicked((i) => (i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        choose(rows[Math.min(picked, rows.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const stop = () => run && void act(async () => void (await host.stopRun(run.id)))

  return (
    <div className="relative">
      {rows.length > 0 && (
        <SlashMenu rows={rows} picked={picked} project={project} onPick={choose} onHover={setPicked} />
      )}
      <div
        className={cn(
          'surface rounded-2xl px-3 pt-2.5 pb-2 shadow-[var(--elev-2)] transition-[border-color,box-shadow] duration-(--dur-base) focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_14%,transparent),var(--elev-2)]',
        )}
      >
        <label htmlFor="composer" className="sr-only">
          Message
        </label>
        <textarea
          id="composer"
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setDismissed(false)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          placeholder={live ? (working ? 'The agent is working… Stop it to send another message' : 'Reply to the agent…') : `Ask an agent to work on ${project}…  (/ for commands)`}
          className="block max-h-[33vh] min-h-[44px] w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-relaxed outline-none placeholder:text-faint"
          aria-describedby="composer-hint"
        />
        <div className="mt-1 flex items-center gap-2">
          <ModelChip models={models.data} run={run} choice={choice} onChoose={setChoice} onManage={() => setModelsOpen(true)} />
          <span id="composer-hint" className="ml-auto hidden truncate text-[11.5px] text-faint sm:inline">
            {aside}
            {aside ? ' · ' : ''}Enter to send · Shift+Enter for a new line · / for commands
          </span>
          {working ? (
            <Button type="button" size="sm" variant="outline" onClick={stop} disabled={sending} className="h-8 rounded-full px-3" aria-label="Stop the agent">
              <Square aria-hidden="true" className="size-3 fill-current" /> Stop
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={submit}
              disabled={!text.trim() || sending}
              className="size-8 rounded-full"
              aria-label={text.trim().startsWith('/') ? 'Run the command' : 'Send'}
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="mt-2 flex items-start gap-2 px-1 text-[13px] text-destructive animate-in fade-in">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          {/no model|no key or sign-in/i.test(error) && (
            <button type="button" onClick={() => setModelsOpen(true)} className="shrink-0 font-medium underline-offset-2 hover:underline">
              Open Models
            </button>
          )}
        </div>
      )}
      <ModelsDialog open={modelsOpen} onOpenChange={setModelsOpen} />
    </div>
  )
}

function SlashMenu({ rows, picked, project, onPick, onHover }: { rows: MenuRow[]; picked: number; project: string; onPick: (row: MenuRow) => void; onHover: (i: number) => void }) {
  const scenarios = rows[0]?.kind !== 'command'
  return (
    <div
      role="listbox"
      aria-label={scenarios ? 'Scenarios' : 'Commands'}
      className="surface absolute inset-x-0 bottom-full z-20 mb-2 max-h-72 overflow-y-auto rounded-xl p-1 shadow-[var(--elev-3)] animate-in fade-in slide-in-from-bottom-1"
    >
      <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">
        {scenarios ? `Play on ${project}, each in a folder of its own` : 'Commands'}
      </div>
      {rows.map((row, i) => (
        <button
          key={row.kind === 'command' ? row.name : row.kind === 'all' ? '*all' : row.demo.id}
          type="button"
          role="option"
          aria-selected={i === picked}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(row)}
          onMouseEnter={() => onHover(i)}
          className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px]', i === picked ? 'bg-accent text-accent-foreground' : 'text-foreground')}
        >
          {row.kind === 'command' ? (
            <>
              <span className="font-mono text-[13px] font-medium">/{row.name}</span>
              <span className="font-mono text-[12px] text-faint">&lt;name&gt;</span>
              <span className="min-w-0 flex-1 truncate text-right text-[12.5px] text-muted-foreground">{row.about}</span>
            </>
          ) : row.kind === 'all' ? (
            <>
              <Layers aria-hidden="true" className="size-4 shrink-0 text-primary" />
              <span className="font-medium">All scenarios</span>
              <span className="font-mono text-[12px] text-faint">all</span>
              <span className="min-w-0 flex-1 truncate text-right text-[12.5px] text-muted-foreground">{row.count} at once, each in its own folder and Branches</span>
            </>
          ) : (
            <>
              <Clapperboard aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium">{row.demo.title}</span>
              <span className="font-mono text-[12px] text-faint">{row.demo.id}</span>
              <span className="min-w-0 flex-1 truncate text-right text-[12.5px] text-muted-foreground">{row.demo.blurb}</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
}

/** The model of the next message: the session's (or the default), unless one is picked here. */
function ModelChip({ models, run, choice, onChoose, onManage }: { models?: ModelsView; run?: RunSummary; choice: Choice | null; onChoose: (c: Choice | null) => void; onManage: () => void }) {
  const current = choice ? `${choice.provider}/${choice.model}` : (run?.model ?? (models?.default ? `${models.default.provider}/${models.default.model}` : null))
  const usable = (models?.providers ?? []).filter((p) => p.configured && p.models.length)
  const label = current ? modelLabel(current) : null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 max-w-[55%] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium ring-1 ring-border ring-inset transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
            current ? 'text-muted-foreground' : 'text-warning',
          )}
          title={current ? `Model: ${current}` : 'Choose a model'}
        >
          <Sparkles aria-hidden="true" className="size-3.5 shrink-0" />
          {label ? (
            <span className="truncate">
              <span className="font-normal text-faint">{label.provider} · </span>
              {label.model}
            </span>
          ) : (
            <span className="truncate">No model</span>
          )}
          {choice && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="changed for the next message" />}
          <ChevronDown aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-h-80 w-72 overflow-y-auto">
        {usable.length === 0 ? (
          <DropdownMenuLabel className="font-normal text-muted-foreground">No provider has a key or sign-in yet.</DropdownMenuLabel>
        ) : (
          usable.map((p) => (
            <DropdownMenuGroup key={p.id}>
              <DropdownMenuLabel className="text-[11px] tracking-[0.06em] text-faint uppercase">{p.name}</DropdownMenuLabel>
              {p.models.map((m) => {
                const value = `${p.id}/${m.id}`
                return (
                  <DropdownMenuItem key={value} onSelect={() => onChoose(value === run?.model && !choice ? null : { provider: p.id, model: m.id })}>
                    <Check aria-hidden="true" className={cn('size-3.5', value === current ? 'text-primary' : 'invisible')} />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onManage}>
          <Settings2 aria-hidden="true" className="size-3.5" /> Manage models…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
