// Compact rows for live conversations, their agents and mounted workspaces.
import type { RunLive, RunningCall } from '@shared/host-api'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { useMemo } from 'react'

import { LfsSandbox, LfsWorkspace } from '@/components/lfs-icons'
import { type Group, type GroupLayout, type SandboxView, type TreeNode, shownCommand } from '@/components/live/live-model'
import { AgentDot, RunDot } from '@/components/live/run-badges'
import { activity, ago, duration, isLive } from '@/components/live/run-format'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export function count(t: (s: string, v?: Record<string, string | number>) => string, n: number, one: string, many: string) {
  return t(n === 1 ? one : many, { n })
}

export function ZoneLabel({ label, count: n }: { label: string; count?: number }) {
  return <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
    {label}{n !== undefined && <span className="tabular-nums">{n}</span>}
  </h3>
}

interface SessionProps {
  layout: GroupLayout
  now: number
  onOpen: (agent?: string) => void
  onFold: (key: string, folded: boolean) => void
}

export function SessionGroup({ layout, now, onOpen, onFold }: SessionProps) {
  const { t } = useI18n()
  const { group, folded, nodes } = layout
  const { run, live } = group.session
  const runningOf = useMemo(() => {
    const map = new Map<string, RunningCall[]>()
    for (const call of live.running) map.set(call.agent, [...(map.get(call.agent) ?? []), call])
    return map
  }, [live.running])
  const status = run.queued ? t('Queued') : run.state === 'failed' ? t('Failed') : run.state === 'stopped' ? t('Stopped') : isLive(run.state) ? t('Running') : t('Ended')

  return <div className="live-session">
    <div className="live-session-heading">
      <button type="button" aria-expanded={!folded} onClick={() => onFold(`s:${run.id}`, !folded)} className="live-session-toggle">
        <ChevronRight aria-hidden="true" className={cn('size-3.5 shrink-0 text-muted-foreground', !folded && 'rotate-90')} />
        <RunDot state={run.state} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={group.name}>{group.name}</span>
        <span className={cn('shrink-0 text-xs', run.state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
          {status}{isLive(run.state) && run.of > 0 && <span className="ml-2 tabular-nums">{run.done}/{run.of}</span>}
        </span>
      </button>
      <button type="button" className="live-open" onClick={() => onOpen()} title={t('Open chat {name}', { name: group.name })} aria-label={t('Open chat {name}', { name: group.name })}>
        <ArrowUpRight aria-hidden="true" className="size-4" />
      </button>
    </div>
    {run.error && <p role="alert" className="live-run-error">{run.error}</p>}
    {!folded && <div className="live-agents">
      {nodes.filter((node) => node.visible).map((node) => <AgentNode
        key={node.key} group={group} node={node} calls={runningOf.get(node.agent.name) ?? []}
        last={live.last[node.agent.name]} now={now} onOpen={() => onOpen(node.agent.name)}
        onFold={() => onFold(`a:${run.demo}:${node.agent.name}`, !node.folded)}
      />)}
    </div>}
  </div>
}

function callTarget(call: { branch?: string | null; path?: string | null; sandbox?: string | null; command?: string | null }) {
  if (call.command) return shownCommand(call.command)
  if (call.sandbox && call.path) return `${call.sandbox}:${call.path}`
  return call.branch ?? call.path ?? null
}

function AgentNode({ group, node, calls, last, now, onOpen, onFold }: {
  group: Group; node: TreeNode; calls: RunningCall[]; last: RunLive['last'][string] | undefined
  now: number; onOpen: () => void; onFold: () => void
}) {
  const { t } = useI18n()
  const { agent, depth, folded, below, hasKids } = node
  return <div className="live-agent" style={{ marginLeft: Math.min(depth, 3) * 16 }}>
    <div className="live-agent-heading">
      <AgentDot state={agent.state} />
      <button type="button" onClick={onOpen} className="live-agent-name" title={t('{agent} in chat {run}', { agent: agent.name, run: group.name })}>{agent.name}</button>
      {hasKids && <button type="button" aria-expanded={!folded} onClick={onFold} className="live-agent-fold" aria-label={t(folded ? "Show {agent}'s subagents" : "Fold {agent}'s subagents", { agent: agent.name })}>
        <span className="tabular-nums">{count(t, below.length, '{n} subagent', '{n} subagents')}</span>
        <ChevronRight aria-hidden="true" className={cn('size-3', !folded && 'rotate-90')} />
      </button>}
    </div>
    <div className="live-agent-activity">
      {calls.length ? calls.map((call) => <div key={call.id} className="live-call">
        <span className="shrink-0 text-foreground">{call.method}</span>
        <span className="min-w-0 flex-1 truncate" title={callTarget(call) ?? undefined}>{callTarget(call)}</span>
        <span className="shrink-0 tabular-nums">{duration(now - call.start)}</span>
      </div>) : agent.thinking || agent.state === 'running' || agent.state === 'idle' || !last ? (
        <span>{activity(agent, undefined, now)}</span>
      ) : <div className="live-call">
        <span className={last.ok ? 'text-foreground' : 'text-destructive'}>{last.method}</span>
        {!last.ok && <span className="text-destructive">{last.code ?? t('Failed')}</span>}
        <span className="ml-auto tabular-nums">{ago(last.at, now)}</span>
      </div>}
    </div>
  </div>
}

export function SandboxNode({ sandbox, groups, now }: { sandbox: SandboxView; groups: Group[]; now: number }) {
  const { t } = useI18n()
  const calls = groups.flatMap((group) => group.session.live.running).filter((call) => call.sandbox === sandbox.id)
  return <details className="live-sandbox">
    <summary className="live-sandbox-heading">
      <ChevronRight aria-hidden="true" className="live-disclosure size-3.5 shrink-0 text-muted-foreground" />
      <LfsSandbox className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={sandbox.name ?? sandbox.id}>{sandbox.name || t('Sandbox {id}', { id: sandbox.id })}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{calls.length ? t('Running') : count(t, sandbox.workspaces.length, '{n} Workspace', '{n} Workspaces')}</span>
    </summary>
    <div className="live-workspaces">
      {!sandbox.workspaces.length && <p className="live-empty-row">{t('No mounted workspaces')}</p>}
      {sandbox.workspaces.map((workspace) => {
        const exec = calls.find((call) => call.path === workspace.path && call.command)
        const last = workspace.mount?.last
        return <div key={workspace.key} className="live-workspace">
          <div className="flex min-w-0 items-center gap-2">
            <LfsWorkspace className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs" title={workspace.path}>{workspace.path}</span>
            {workspace.branch && <span className="max-w-[45%] truncate text-xs text-muted-foreground" title={workspace.branch}>{workspace.branch}</span>}
          </div>
          {(exec || last) && <div className="live-call pl-5.5">
            <span className="min-w-0 flex-1 truncate" title={shownCommand(exec?.command ?? last?.command) ?? undefined}>{shownCommand(exec?.command ?? last?.command)}</span>
            <span className={cn('shrink-0 tabular-nums', !exec && last?.kind && last.kind !== 'exit:0' && 'text-destructive')}>
              {exec ? duration(now - exec.start) : last?.kind}
            </span>
          </div>}
          {workspace.mount && <p className="mt-1 pl-5.5 text-xs text-muted-foreground">{workspace.mount.agent}{workspace.mount.commits > 0 && ` · ${count(t, workspace.mount.commits, '{n} Commit', '{n} Commits')}`}</p>}
        </div>
      })}
      {calls.filter((call) => !sandbox.workspaces.some((workspace) => workspace.path === call.path)).map((call) => <div key={call.id} className="live-call px-3 py-2">
        <span className="min-w-0 flex-1 truncate">{call.method}</span><span className="tabular-nums">{duration(now - call.start)}</span>
      </div>)}
    </div>
  </details>
}
