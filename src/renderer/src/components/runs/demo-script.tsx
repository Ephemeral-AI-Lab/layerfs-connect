import type { DemoDetail, StepView } from '@shared/host-api'
import { CornerDownRight, MessageSquareReply, MoveRight, RotateCw, SquareTerminal, Wrench } from 'lucide-react'
import { memo, useMemo, useState } from 'react'

import { treeOrder } from '@/components/runs/agent-tree'
import { KindChip, KindLegend } from '@/components/runs/run-badges'
import { type AgentColor, agentColors, plural, stepNo } from '@/components/runs/run-format'
import { SegmentList } from '@/components/runs/segments'
import { AgentAvatar } from '@/components/runs/step-card'
import { Windowed } from '@/components/runs/windowed-list'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'

const target = (step: StepView) => step.segments.find((s) => s.detail)?.detail

/** Who starts whom: a subagent step's segment names the child. */
function spawnParents(demo: DemoDetail): Map<string, string | null> {
  const parents = new Map<string, string | null>(demo.agents.map((a) => [a.name, null]))
  for (const [agent, steps] of Object.entries(demo.script))
    for (const s of steps) {
      const child = s.tool === 'subagent' ? target(s) : undefined
      if (child && parents.has(child) && parents.get(child) === null && child !== agent) parents.set(child, agent)
    }
  return parents
}

/** A demo's script before any run: its agents as a tree, and each agent's steps. */
export function DemoScript({ demo }: { demo: string }) {
  const loaded = useHostQuery(() => host.demo(demo), [demo])
  if (loaded.data && loaded.data.id === demo) return <Script key={demo} demo={loaded.data} />
  if (loaded.error)
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border bg-card px-5 py-8 text-center">
        <p className="text-sm font-medium">Could not load the script</p>
        <p className="max-w-sm text-xs text-muted-foreground">{loaded.error.message}</p>
        <Button variant="outline" size="sm" onClick={loaded.reload}>
          <RotateCw /> Try again
        </Button>
      </div>
    )
  return (
    <div aria-busy="true" className="grid grid-cols-[14rem_minmax(0,1fr)] gap-4">
      <Skeleton className="h-48 rounded-xl" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

function Script({ demo }: { demo: DemoDetail }) {
  const parents = useMemo(() => spawnParents(demo), [demo])
  const nodes = useMemo(() => treeOrder(demo.agents, (a) => a.name, (a) => parents.get(a.name) ?? null), [demo, parents])
  const colorOf = useMemo(() => agentColors(nodes.map((n) => n.item.name)), [nodes])
  const [agent, setAgent] = useState(nodes[0]?.item.name ?? '')
  const steps = demo.script[agent] ?? []
  const prompt = demo.agents.find((a) => a.name === agent)?.prompt

  return (
    <div className="grid grid-cols-[14rem_minmax(0,1fr)] items-start gap-5">
      <aside aria-label="Agents" className="sticky top-4 flex flex-col gap-3 rounded-xl border bg-card p-2">
        <div className="flex items-baseline gap-2 px-2 pt-1.5 text-xs text-faint">
          <span className="font-medium">Agents</span> {demo.agents.length}
          <span className="ml-auto">{plural(demo.steps, 'step')}</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {nodes.map(({ item: a, depth }) => (
            <button
              key={a.name}
              type="button"
              aria-pressed={agent === a.name}
              onClick={() => setAgent(a.name)}
              style={{ paddingLeft: 8 + depth * 14 }}
              className={cn(
                'relative flex h-9 items-center gap-2 rounded-lg pr-2 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                agent === a.name && 'bg-muted font-semibold',
              )}
            >
              {depth > 0 && (
                <span aria-hidden="true" className="absolute top-0 bottom-1/2 border-b border-l border-border" style={{ left: depth * 14 - 3, width: 8 }} />
              )}
              <AgentAvatar name={a.name} color={colorOf(a.name)} />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="text-[11px] font-normal text-faint tabular-nums">{a.steps}</span>
            </button>
          ))}
        </nav>
        <div className="flex flex-col gap-2 border-t px-2 pt-3 pb-1.5">
          <span className="text-[11px] font-medium text-faint">Call kinds in this demo</span>
          <KindLegend kinds={Object.keys(demo.kinds) as (keyof typeof demo.kinds)[]} counts={demo.kinds} className="flex-col gap-y-1" />
        </div>
      </aside>

      <section aria-label={`${agent}'s steps`} className="flex min-w-0 flex-col gap-4">
        <header className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <AgentAvatar name={agent} color={colorOf(agent)} />
            <h3 className={cn('text-sm font-semibold', colorOf(agent).text)}>{agent}</h3>
            <span className="text-xs text-faint">{plural(steps.length, 'step')}</span>
            {parents.get(agent) && <span className="text-xs text-muted-foreground">· started by {parents.get(agent)}</span>}
          </div>
          {prompt && <p className="rounded-lg bg-muted/50 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{prompt}</p>}
        </header>
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">This agent has no steps.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {steps.map((step) => (
              <li key={`${agent}:${step.index}`}>
                {step.phase && <Phase name={step.phase} />}
                <Windowed id={`script:${demo.id}:${agent}:${step.index}`} estimate={160}>
                  <ScriptStep step={step} color={colorOf(agent)} colorOf={colorOf} />
                </Windowed>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function Phase({ name }: { name: string }) {
  return (
    <div role="separator" className="flex items-center gap-3 pt-2 pb-3">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{name}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

const ScriptStep = memo(function ScriptStep({ step, color, colorOf }: { step: StepView; color: AgentColor; colorOf: (n: string) => AgentColor }) {
  const other = target(step)
  const Icon = step.tool === 'bash' ? SquareTerminal : step.tool === 'subagent' ? CornerDownRight : step.tool === 'send_message' ? MoveRight : step.tool === 'reply' ? MessageSquareReply : Wrench
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-6 shrink-0 text-right text-[11px] text-faint tabular-nums">{stepNo(step.index)}</span>
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {step.tool === 'subagent' ? (
            <>
              spawns <span className={colorOf(other ?? '').text}>{other}</span>
            </>
          ) : step.tool === 'send_message' ? (
            <>
              message to <span className={colorOf(other ?? '').text}>{other}</span>
            </>
          ) : step.tool === 'reply' ? (
            <>reply{step.until?.length ? <span className="font-normal text-muted-foreground"> after {step.until.join(', ')}</span> : null}</>
          ) : (
            (step.description ?? step.tool)
          )}
        </span>
        {step.exit !== undefined && step.exit !== 0 && <span className="font-mono text-[11px] text-warning">want exit {step.exit}</span>}
        <KindChip kind={step.kind} />
      </div>
      {step.say && <p className="pl-8 text-sm leading-relaxed text-foreground/90">{step.say}</p>}
      {step.note && <p className="pl-8 text-xs text-muted-foreground italic">{step.note}</p>}
      {step.tool === 'bash' ? (
        <SegmentList segments={step.segments} className="ml-8" />
      ) : step.text ? (
        <p className={cn('ml-8 w-fit max-w-[90%] rounded-2xl rounded-tl-md px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ring-1 ring-inset', color.soft, color.ring, step.tool === 'subagent' && 'line-clamp-6')}>
          {step.text}
        </p>
      ) : null}
      {step.expect && step.expect.length > 0 && (
        <div className="ml-8 flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[11px] text-faint">expects</span>
          {step.expect.map((e) => (
            <span key={e} className="rounded-md bg-muted px-1.5 font-mono text-[11px] leading-5 text-muted-foreground ring-1 ring-foreground/10 ring-inset">
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  )
})
