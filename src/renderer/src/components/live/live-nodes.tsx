// Live's cards: the sessions and their agents on the left, the project with
// its Store and Branch rows in the middle, the Sandboxes with their mounted
// Workspaces on the right. Each card carries a data-anchor, so the flow
// engine (live-flow.ts) can draw lanes to it and ring it when a call lands.
import type { AgentRun, BranchInfo, ProjectState, RunLive, RunningCall } from '@shared/host-api'
import { projectRef } from '@shared/host-api'
import { Check, ChevronRight, SquareArrowOutUpRight, X } from 'lucide-react'
import { useMemo } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { LfsAgent, LfsBranch, LfsSandbox, LfsWorkspace } from '@/components/lfs-icons'
import type { StoreFacts } from '@/components/projects/store-facts'
import { bytes } from '@/data/format'
import { branchRun, isTrunk } from '@/components/live/live-data'
import { colorVar } from '@/components/live/live-flow'
import { type Group, type GroupLayout, type HubRows, type SandboxView, type TreeNode, type WsView, shownCommand } from '@/components/live/live-model'
import { RunDot, Spinner } from '@/components/live/run-badges'
import { type AgentColor, activity, ago, duration, isLive } from '@/components/live/run-format'
import { Chip } from '@/components/storage/chips'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** Indent per tree level; the guide to a subagent runs in this gutter. */
const INDENT = 24
/** Levels drawn indented; deeper ones line up with the last. */
const MAX_INDENT = 4

/** Flow cards share the live diagram's theme-aware surface. */
const CARD = 'live-node relative min-w-0 rounded-xl'
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** "1 agent" / "3 agents", through the dictionary. */
export function count(t: (s: string, v?: Record<string, string | number>) => string, n: number, one: string, many: string) {
  return t(n === 1 ? one : many, { n })
}

export function ZoneLabel({ label, count: n }: { label: string; count?: number }) {
  return (
    <div className="flex h-5 items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {n !== undefined && <span className="rounded-full bg-foreground/[0.05] px-1.5 text-[10px] leading-4 tracking-normal tabular-nums">{n}</span>}
    </div>
  )
}

/** No session working: where agents will show, joined to the project by a faint line. */
export function IdleAgents({ note }: { note: string }) {
  const { t } = useI18n()
  return (
    <div data-anchor="ghost-agents" className="live-node rounded-2xl border-dashed p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04] text-muted-foreground ring-1 ring-foreground/[0.06] ring-inset">
          <LfsAgent className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('No agent working')}</p>
          <p className="truncate text-xs text-muted-foreground">{note}</p>
        </div>
      </div>
    </div>
  )
}

export function IdleSandboxes() {
  const { t } = useI18n()
  return (
    <div data-anchor="ghost-sandboxes" className="live-node flex items-center gap-3 rounded-2xl border-dashed p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04] text-muted-foreground ring-1 ring-foreground/[0.06] ring-inset">
        <LfsSandbox className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{t('No Sandbox open')}</p>
      </div>
    </div>
  )
}

/** A tinted avatar retains the agent's colour without overpowering the name. */
function Avatar({ name, color, small, working }: { name: string; color: AgentColor; small?: boolean; working?: boolean }) {
  if (small)
    return (
      <span
        title={name}
        className={cn(
          'flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-medium uppercase transition-opacity duration-(--dur-base)',
          color.soft, color.text,
          !working && 'opacity-40',
        )}
      >
        {name.slice(0, 1)}
      </span>
    )
  return (
    <span className={cn('relative flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium uppercase', color.soft, color.text)}>
      {name.slice(0, 1)}
      {working && <span aria-hidden="true" className={cn('live-spin', color.text)} />}
    </span>
  )
}

/** A row of small avatars, the busy ones lit. */
function Avatars({ agents, colorOf, working, max = 6 }: { agents: AgentRun[]; colorOf: (name: string) => AgentColor; working: ReadonlySet<string>; max?: number }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {agents.slice(0, max).map((a) => (
        <Avatar key={a.name} name={a.name} color={colorOf(a.name)} small working={working.has(a.name)} />
      ))}
      {agents.length > max && <span className="ml-0.5 text-[11px] text-muted-foreground tabular-nums">+{agents.length - max}</span>}
    </span>
  )
}

/** A session's progress: a thin bar and "done/of", or "waiting its turn", or how it ended. */
function Progress({ run }: { run: Group['session']['run'] }) {
  const { t } = useI18n()
  if (run.queued)
    return (
      <span className="shrink-0 text-muted-foreground" title={run.phase ?? undefined}>
        {t('waiting its turn')}
      </span>
    )
  if (!isLive(run.state)) return <span className={cn('shrink-0', run.state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{t(run.state === 'failed' ? 'Failed' : run.state === 'stopped' ? 'Stopped' : 'Ended')}</span>
  if (run.of === 0) return null
  const ratio = run.of > 0 ? Math.min(1, run.done / run.of) : 0
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={t('{done} of {of} steps', { done: run.done, of: run.of })}>
      <span aria-hidden="true" className="h-1 w-10 overflow-hidden rounded-full bg-foreground/[0.07]">
        <span className="block h-full rounded-full bg-primary transition-[width] duration-(--dur-slow)" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
      <span className="tabular-nums">
        {run.done}/{run.of}
      </span>
    </span>
  )
}

interface SessionProps {
  layout: GroupLayout
  /** Many sessions: folded, this one is a single line. */
  dense: boolean
  now: number
  onOpen: (agent?: string) => void
  onFold: (key: string, folded: boolean) => void
}

/** One session: its run's header and its agents' cards, or folded to one card that stands in for them. */
export function SessionGroup({ layout, dense, now, onOpen, onFold }: SessionProps) {
  const { t } = useI18n()
  const { group, folded, nodes } = layout
  const { run, live } = group.session
  const runningOf = useMemo(() => {
    const map = new Map<string, RunningCall[]>()
    for (const c of live.running) map.set(c.agent, [...(map.get(c.agent) ?? []), c])
    return map
  }, [live.running])
  const calling = useMemo(() => new Set(live.running.map((call) => call.agent)), [live.running])
  const working = calling.size
  const fold = () => onFold(`s:${run.id}`, !folded)
  const agentsLine = t('{agents} · {n} calling', { agents: count(t, nodes.length, '{n} agent', '{n} agents'), n: working })

  const head = (
    <>
      <ChevronRight aria-hidden="true" className="chevron size-3.5 shrink-0 text-muted-foreground" />
      <RunDot state={run.state} />
      <span className={cn('min-w-0 flex-1 truncate text-[13px] font-medium text-foreground', run.folder && 'font-mono')} title={group.name}>
        {run.folder ? '/' : ''}{group.name}
      </span>
    </>
  )

  if (folded && dense)
    return (
      <button
        type="button"
        data-anchor={`session-${run.id}`}
        data-busy={working > 0 || undefined}
        onClick={fold}
        aria-expanded={false}
        title={`${run.demo} · ${agentsLine}`}
        className={cn(CARD, FOCUS, 'flex items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground', !isLive(run.state) && 'opacity-75 hover:opacity-100')}
      >
        <span aria-hidden="true" className="live-ring text-(--icon-accent)" />
        {head}
        <span className="min-w-0 flex-1" />
        <Progress run={run} />
      </button>
    )

  if (folded)
    return (
      <button
        type="button"
        data-anchor={`session-${run.id}`}
        data-busy={working > 0 || undefined}
        onClick={fold}
        aria-expanded={false}
        className={cn(CARD, FOCUS, 'flex flex-col gap-2 px-3 py-2.5 text-left text-xs text-muted-foreground')}
      >
        <span aria-hidden="true" className="live-ring text-(--icon-accent)" />
        <span className="flex min-w-0 items-center gap-2">
          {head}
          <Progress run={run} />
        </span>
        <span className="flex min-w-0 items-center gap-2 pl-5.5">
          <span className="min-w-0 flex-1 truncate tabular-nums">{agentsLine}</span>
          <Avatars agents={nodes.map((n) => n.agent)} colorOf={group.colorOf} working={calling} />
        </span>
      </button>
    )

  return (
    <div data-anchor={`session-${run.id}`} className="flex flex-col gap-1 rounded-2xl p-1.5 ring-1 ring-foreground/[0.06] ring-inset">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={fold}
          aria-expanded
          className={cn(FOCUS, 'flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-foreground/[0.04] hover:text-foreground')}
        >
          {head}
          <Progress run={run} />
        </button>
        <button
          type="button"
          onClick={() => onOpen()}
          aria-label={t('Open chat {name}', { name: group.name })}
          title={t('Open chat {name}', { name: group.name })}
          className={cn(FOCUS, 'flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground')}
        >
          <SquareArrowOutUpRight className="size-3.5" />
        </button>
      </div>
      {run.error && <p role="alert" className="px-2 py-1 text-xs leading-relaxed break-words text-destructive">{run.error}</p>}
      {nodes
        .filter((n) => n.visible)
        .map((n) => (
          <AgentNode
            key={n.key}
            group={group}
            node={n}
            calls={runningOf.get(n.agent.name) ?? []}
            last={live.last[n.agent.name]}
            calling={calling}
            now={now}
            onOpen={() => onOpen(n.agent.name)}
            onFold={() => onFold(`a:${run.demo}:${n.agent.name}`, !n.folded)}
          />
        ))}
    </div>
  )
}

function callTarget(c: { branch?: string | null; path?: string | null; sandbox?: string | null; command?: string | null }) {
  if (c.command) return shownCommand(c.command)
  if (c.sandbox && c.path) return `${c.sandbox}:${c.path}`
  return c.branch ?? c.path ?? null
}

/** Short actions for the diagram; the exact API method remains in the tooltip. */
const CALL_LABEL: Record<string, string> = {
  'workspace.exec': 'Run command',
  'workspace.mount': 'Mount workspace',
  'workspace.unmount': 'Unmount workspace',
  'workspace.commit': 'Save changes',
  'workspace.status': 'Check workspace',
  'fs.read': 'Read file',
  'fs.write': 'Write file',
  'fs.edit': 'Edit file',
  'fs.list': 'List files',
  'branch.fork': 'Create branch',
  'branch.merge': 'Merge branch',
  'branch.commit': 'Save changes',
  'branch.publish': 'Publish branch',
  'sandbox.create': 'Create sandbox',
  'sandbox.close': 'Close sandbox',
}

interface AgentProps {
  group: Group
  node: TreeNode
  calls: RunningCall[]
  last: RunLive['last'][string] | undefined
  calling: ReadonlySet<string>
  now: number
  onOpen: () => void
  onFold: () => void
}

function AgentNode({ group, node, calls, last, calling, now, onOpen, onFold }: AgentProps) {
  const { t } = useI18n()
  const { agent, depth, folded, below, hasKids } = node
  const call = calls[0]
  const active = calls.length > 0
  const busyBelow = below.filter((a) => calling.has(a.name)).length
  const color = group.colorOf(agent.name)
  const failed = !active && !agent.thinking && (agent.state === 'failed' || last?.ok === false)
  const status = active ? 'Calling' : agent.thinking ? 'Thinking' : failed ? 'Call failed' : agent.state === 'stopped' ? 'Stopped' : agent.state === 'done' ? 'Done' : 'Between calls'
  return (
    <div
      data-anchor={`agent-${node.key}`}
      data-busy={active || (folded && busyBelow > 0) || undefined}
      style={{ marginLeft: Math.min(depth, MAX_INDENT) * INDENT }}
      className="relative min-w-0 rounded-xl transition-colors duration-(--dur-base) hover:bg-foreground/[0.035] data-[busy]:bg-foreground/[0.025]"
    >
      <button
        type="button"
        onClick={onOpen}
        title={t('{agent} in chat {run}', { agent: agent.name, run: group.name })}
        className={cn(FOCUS, 'relative z-[2] flex w-full min-w-0 flex-col gap-1 rounded-xl py-2 pr-3 pl-2 text-left')}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={agent.name} color={color} working={active} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
          <span className={cn('shrink-0 text-[10px] font-normal', active ? color.text : failed ? 'text-destructive' : 'text-muted-foreground')}>{t(status)}</span>
          {hasKids && <span aria-hidden="true" className="w-7 shrink-0" />}
        </span>
        <span className="flex h-4 min-w-0 items-center gap-1.5 pl-10.5 text-xs text-muted-foreground">
          {call ? (
            <>
              <Spinner className={cn('size-3', color.text)} />
              <span className="shrink-0 text-[11px] text-foreground" title={call.method}>{t(CALL_LABEL[call.method] ?? call.method)}</span>
              <span className="min-w-0 truncate font-mono text-[11px]" title={callTarget(call) ?? undefined}>{callTarget(call)}</span>
              <span className="ml-auto shrink-0 tabular-nums">{duration(now - call.start)}</span>
            </>
          ) : agent.thinking || !last ? (
            <span className="truncate tabular-nums">{agent.thinking ? activity(agent, undefined, now) : t('No call yet')}</span>
          ) : (
            <>
              {last.ok ? <Check aria-label={t('Succeeded')} className="size-3 shrink-0 text-success" /> : <X aria-label={t('Failed')} className="size-3 shrink-0 text-destructive" />}
              <span className={cn('min-w-0 truncate text-[11px]', !last.ok && 'text-destructive')} title={`${last.method}${last.code ? ` · ${last.code}` : ''}`}>{t(CALL_LABEL[last.method] ?? last.method)}</span>
              <span className="ml-auto shrink-0 tabular-nums">{ago(last.at, now)}</span>
            </>
          )}
        </span>
        {calls.slice(1).map((running) => (
          <span key={running.id} className="flex min-w-0 items-center gap-1.5 pl-10.5 text-xs text-muted-foreground">
            <Spinner className={cn('size-3', color.text)} />
            <span className="shrink-0 text-[11px] text-foreground" title={running.method}>{t(CALL_LABEL[running.method] ?? running.method)}</span>
            <span className="min-w-0 truncate font-mono text-[11px]" title={callTarget(running) ?? undefined}>{callTarget(running)}</span>
            <span className="ml-auto shrink-0 tabular-nums">{duration(now - running.start)}</span>
          </span>
        ))}
        {folded && below.length > 0 && (
          <span className="flex min-w-0 items-center gap-1.5 pl-10.5 text-[11px] text-muted-foreground">
            <Avatars agents={below} colorOf={group.colorOf} working={calling} />
            <span className="truncate tabular-nums">{t('{agents} · {n} calling', { agents: count(t, below.length, '{n} subagent', '{n} subagents'), n: busyBelow })}</span>
          </span>
        )}
      </button>
      {hasKids && (
        <button
          type="button"
          onClick={onFold}
          aria-expanded={!folded}
          aria-label={t(folded ? "Show {agent}'s subagents" : "Fold {agent}'s subagents", { agent: agent.name })}
          className={cn(FOCUS, 'absolute top-[13px] right-3 z-[2] flex h-5 items-center gap-0.5 rounded-md px-1 text-[11px] text-muted-foreground tabular-nums transition-colors duration-(--dur-fast) hover:bg-foreground/5 hover:text-foreground')}
        >
          {below.length}
          <ChevronRight aria-hidden="true" className="chevron size-3" />
        </button>
      )}
    </div>
  )
}

/** A Branch's name with its run's folder dimmed: `crew_2.` lead. */
export function BranchName({ name, folders, className }: { name: string; folders: readonly string[]; className?: string }) {
  const at = branchRun(name, folders)
  return (
    <span title={name} className={cn('min-w-0 truncate', className)}>
      {at ? (
        <>
          <span className="text-muted-foreground">{at.folder}.</span>
          {at.name}
        </>
      ) : (
        name
      )}
    </span>
  )
}

/** A Branch as a pill the lanes plug into: outlined in the colour of the agent working on it. */
function BranchRow({ branch, label, trunk, owner }: { branch: BranchInfo; label: string; trunk?: boolean; owner?: string }) {
  const { t } = useI18n()
  return (
    <li
      data-anchor={`branch-${branch.name}`}
      title={trunk ? t('{name}: this run’s trunk, standing for main', { name: branch.name }) : branch.name}
      style={owner ? ({ '--pill': colorVar(owner) } as React.CSSProperties) : undefined}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-lg border bg-card/70 py-1.5 pr-1.5 pl-2.5 text-xs transition-colors duration-(--dur-fast)',
        owner ? 'border-[color-mix(in_oklab,var(--pill)_30%,transparent)]' : 'border-foreground/[0.06] hover:border-foreground/15',
      )}
    >
      <LfsBranch className={cn('size-3.5 shrink-0', owner ?? (trunk ? 'text-primary' : 'text-muted-foreground'))} />
      <span className={cn('min-w-0 flex-1 truncate', branch.name === 'main' || trunk || owner ? 'font-medium' : 'text-foreground/85')}>{label}</span>
      <span className="min-w-5 shrink-0 rounded-full bg-foreground/[0.05] px-1.5 text-center text-[10.5px] leading-[18px] text-muted-foreground tabular-nums">{branch.commits}</span>
    </li>
  )
}

interface HubProps {
  project: string
  state: ProjectState | undefined
  store: StoreFacts | undefined
  rows: HubRows
  /** Branch name → the text colour class of the agent working on it. */
  owners: ReadonlyMap<string, string>
  live: boolean
  busy: boolean
}

/** The project: its mark, name and Store, main's Layer and counts, and the open Branches by run. */
export function HubNode({ project, state, store, rows, owners, live, busy }: HubProps) {
  const { t } = useI18n()
  const layers = state?.layers.length ?? 0
  return (
    <div className="relative" data-live={live || undefined} data-busy={busy || undefined}>
      <div data-anchor="hub" className="live-node relative flex flex-col rounded-2xl p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span data-anchor="hub-core" className="live-core flex size-10 shrink-0 items-center justify-center rounded-xl bg-card ring-1 ring-foreground/[0.07]">
            <LayerfsMark className="size-7" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={project}>{projectRef(project).name}</p>
            {store && <p className="mt-0.5 text-[11px] text-muted-foreground">
              {store.family === 'postgresql' ? 'PostgreSQL' : 'SQLite'}{store.size !== null && ` · ${bytes(store.size)}`}
            </p>}
          </div>
        </div>
        {state ? (
          <dl className="mt-4 grid w-full grid-cols-3 gap-2 border-b border-foreground/[0.06] pb-3">
            <div className="flex flex-col-reverse items-center">
              <dt className="text-[10px] text-muted-foreground">{t('main')}</dt>
              <dd className="text-sm font-medium tabular-nums">
                L{Math.max(0, layers - 1)}
              </dd>
            </div>
            <div className="flex flex-col-reverse items-center">
              <dt className="text-[10px] text-muted-foreground">{t(state.branches.length === 1 ? 'Branch' : 'Branches')}</dt>
              <dd className="text-sm font-medium tabular-nums">
                {state.branches.length}
              </dd>
            </div>
            <div className="flex flex-col-reverse items-center">
              <dt className="text-[10px] text-muted-foreground">{t(state.commits === 1 ? 'Commit' : 'Commits')}</dt>
              <dd className="text-sm font-medium tabular-nums">
                {state.commits}
              </dd>
            </div>
          </dl>
        ) : (
          <span className="mt-3 flex h-[42px] w-full items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">{t('Reading…')}</span>
        )}
        {(rows.main || rows.runs.length > 0) && (
          <ul data-anchor="hub-rows" aria-label={t('Open Branches')} className="mt-3 flex max-h-56 w-full flex-col gap-1.5 overflow-y-auto text-left">
            {rows.main && <BranchRow branch={rows.main} label="main" owner={owners.get(rows.main.name)} />}
            {rows.runs.map(({ group, rows: list }) => (
              <li key={group.session.run.id} className="mt-1.5 flex flex-col gap-1">
                <span className="flex items-center gap-1.5 px-2 pb-0.5 text-[10.5px] font-medium text-muted-foreground">
                  <RunDot state={group.session.run.state} className="scale-75" />
                  <span className="truncate">{group.session.run.folder ? '/' : ''}{group.name}</span>
                </span>
                <ul className="flex flex-col gap-1">
                  {list.map((r) => (
                    <BranchRow key={r.branch.name} branch={r.branch} label={r.name} trunk={isTrunk(r.name)} owner={owners.get(r.branch.name)} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {rows.others > 0 && (
          <span className="mt-1.5 w-full px-2 text-left text-[11px] text-muted-foreground">
            {count(t, rows.others, '+{n} other open Branch', '+{n} other open Branches')}
          </span>
        )}
      </div>
    </div>
  )
}

interface SandboxProps {
  index: number
  sandbox: SandboxView
  groups: Group[]
  folders: readonly string[]
  now: number
}

/** An open Sandbox: who made it, and each Workspace mounted in it, with the exec running there. */
export function SandboxNode({ sandbox, groups, folders, now }: SandboxProps) {
  const { t } = useI18n()
  const groupOf = (rid: string) => groups.find((g) => g.session.run.id === rid)
  const calls = groups.flatMap((group) => group.session.live.running).filter((call) => call.sandbox === sandbox.id)
  const execOf = (w: WsView) => {
    for (const g of groups)
      for (const c of g.session.live.running)
        if ((c.method === 'workspace.exec' || c.command) && c.sandbox === w.sandbox && c.path === w.path) return { call: c, group: g }
    return undefined
  }
  const execs = sandbox.workspaces.map(execOf)
  const first = execs.find((e) => e)
  const maker = sandbox.madeBy && groupOf(sandbox.madeBy.run)
  return (
    <div
      data-anchor={`sandbox-${sandbox.id}`}
      data-busy={calls.length > 0 || undefined}
      className={CARD}
    >
      <span aria-hidden="true" className={cn('live-ring', first ? first.group.colorOf(first.call.agent).text : 'text-(--icon-accent)')} />
      <div className="relative z-[2] flex min-w-0 items-center gap-2.5 px-3 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground ring-1 ring-foreground/[0.08] ring-inset">
          <LfsSandbox className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-sm font-medium">{t('Sandbox {id}', { id: sandbox.id })}</span>
            {sandbox.name && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{sandbox.name}</span>}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {sandbox.madeBy ? (
              <>
                {t('made by {agent}', { agent: sandbox.madeBy.agent })}
                {maker ? ` · ${maker.session.run.folder ? '/' : ''}${maker.name}` : ''}
              </>
            ) : (
              t(sandbox.state)
            )}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{t('{n} mounted', { n: sandbox.workspaces.length })}</span>
      </div>
      {sandbox.workspaces.length === 0 ? (
        <div className="relative z-[2] flex items-center gap-2 border-t border-foreground/[0.06] px-3 py-2 text-xs text-muted-foreground italic">
          <LfsWorkspace className="size-3.5" />
          {t('No mounted workspaces')}
        </div>
      ) : (
        sandbox.workspaces.map((w, i) => {
          const exec = execs[i]
          const mount = w.mount
          const owner = mount && groupOf(mount.run)
          const ownerColor = mount && owner ? owner.colorOf(mount.agent) : null
          const execColor = exec ? exec.group.colorOf(exec.call.agent) : null
          return (
            <div
              key={w.key}
              data-anchor={`ws-${w.key}`}
              className={cn(
                'relative z-[2] flex flex-col gap-1 border-t border-foreground/[0.06] px-3 py-2 text-xs transition-colors duration-(--dur-base) last:rounded-b-xl',
                exec ? 'bg-card' : 'bg-card/55',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <LfsWorkspace className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-mono text-[11px]">{w.path}</span>
                {w.branch && (
                  <span className="flex min-w-0 items-center gap-1 rounded-md bg-card/80 px-1.5 py-px ring-1 ring-foreground/10 ring-inset">
                    <LfsBranch className="size-3 shrink-0 text-muted-foreground" />
                    <BranchName name={w.branch} folders={folders} className="text-[11px]" />
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  {mount ? (
                    <>
                      <span aria-hidden="true" className={cn('size-2 rounded-full', ownerColor?.dot ?? 'bg-idle')} />
                      <span className="text-foreground/85">{mount.agent}</span>
                    </>
                  ) : (
                    <span>{t('mounted')}</span>
                  )}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 pl-5.5 text-muted-foreground">
                {exec ? (
                  <>
                    <Spinner className={cn('size-3', execColor?.text)} />
                    <Chip tone="info" className="h-[18px] px-1.5 font-mono text-[10.5px]">
                      exec
                    </Chip>
                    <span className="min-w-0 truncate font-mono text-[11px] text-foreground/85">{shownCommand(exec.call.command) ?? ''}</span>
                    {exec.call.agent !== mount?.agent && <span className="shrink-0">{t('by {agent}', { agent: exec.call.agent })}</span>}
                    <span className="ml-auto shrink-0 tabular-nums">{duration(now - exec.call.start)}</span>
                  </>
                ) : mount?.last ? (
                  <>
                    <span className="shrink-0">{t('idle · last')}</span>
                    <span className="min-w-0 truncate font-mono text-[11px]">{shownCommand(mount.last.command) ?? 'exec'}</span>
                    <span className={cn('ml-auto shrink-0 font-mono text-[11px]', mount.last.kind && mount.last.kind !== 'exit:0' && 'text-warning')}>{mount.last.kind ?? ''}</span>
                  </>
                ) : (
                  <span className="tabular-nums">{mount ? t('idle · mounted {time}', { time: ago(mount.since, now) }) : t('idle')}</span>
                )}
                {mount && mount.commits > 0 && <span className="shrink-0 tabular-nums">· {count(t, mount.commits, '{n} Commit', '{n} Commits')}</span>}
              </span>
            </div>
          )
        })
      )}
      {calls.filter((call) => !sandbox.workspaces.some((workspace) => workspace.path === call.path)).map((call) => (
        <div key={call.id} className="relative z-[2] flex min-w-0 items-center gap-2 border-t border-foreground/[0.06] px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate font-mono" title={callTarget(call) ?? undefined}>{call.method}</span>
          <span className="shrink-0 tabular-nums">{duration(now - call.start)}</span>
        </div>
      ))}
    </div>
  )
}

/** A quiet Sandbox when there are many: one line, its Workspaces' anchors on it, so calls still reach it; a click shows its card. */
export function SandboxLine({ sandbox, groups, onOpen }: { index: number; sandbox: SandboxView; groups: Group[]; onOpen: () => void }) {
  const { t } = useI18n()
  const maker = sandbox.madeBy && groups.find((g) => g.session.run.id === sandbox.madeBy?.run)
  const n = sandbox.workspaces.length
  return (
    <button
      type="button"
      data-anchor={`sandbox-${sandbox.id}`}
      onClick={onOpen}
      title={sandbox.name ?? undefined}
      className={cn(CARD, FOCUS, 'flex items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground')}
    >
      {sandbox.workspaces.map((w) => (
        <span key={w.key} data-anchor={`ws-${w.key}`} aria-hidden="true" className="pointer-events-none absolute inset-0" />
      ))}
      <LfsSandbox className="size-3.5 shrink-0" />
      <span className="shrink-0 font-medium text-foreground">{t('Sandbox {id}', { id: sandbox.id })}</span>
      <span className={cn('min-w-0 flex-1 truncate', maker?.session.run.folder && 'font-mono')}>{maker ? `${maker.session.run.folder ? '/' : ''}${maker.name}` : t(sandbox.state)}</span>
      <span className="shrink-0 tabular-nums">{n ? count(t, n, '{n} Workspace', '{n} Workspaces') : t('no Workspace')}</span>
    </button>
  )
}
