import type { DemoDetail, SegmentKind } from '@shared/host-api'
import { RotateCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { AgentSwitcher, type SwitcherAgent } from '@/components/runs/agent-switcher'
import { Conversation } from '@/components/runs/conversation'
import { KindLegend } from '@/components/runs/run-badges'
import { agentColors, plural, stepKey } from '@/components/runs/run-format'
import { type Entry, buildThread, targetOf, threadSize } from '@/components/runs/thread'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'

/** Who starts whom: a subagent step's segment names the child. */
function spawnParents(demo: DemoDetail): Map<string, string | null> {
  const parents = new Map<string, string | null>(demo.agents.map((a) => [a.name, null]))
  for (const [agent, steps] of Object.entries(demo.script))
    for (const s of steps) {
      const child = s.tool === 'subagent' ? targetOf(s) : undefined
      if (child && parents.has(child) && parents.get(child) === null && child !== agent) parents.set(child, agent)
    }
  return parents
}

const FRAME = 'flex h-full min-h-0 flex-col'

/** A demo's script before any run: one agent's thread at a time, in the run view's folded-turn look. */
export function DemoScript({ demo }: { demo: string }) {
  const loaded = useHostQuery(() => host.demo(demo), [demo])
  if (loaded.data && loaded.data.id === demo) return <Script key={demo} demo={loaded.data} />
  if (loaded.error)
    return (
      <div className="mx-auto mt-8 flex w-full max-w-[1000px] flex-col items-center gap-2 rounded-xl border border-dashed px-5 py-12 text-center">
        <p className="text-sm font-medium">Could not load the script</p>
        <p className="max-w-sm text-xs text-muted-foreground">{loaded.error.message}</p>
        <Button variant="outline" size="sm" onClick={loaded.reload}>
          <RotateCw /> Try again
        </Button>
      </div>
    )
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-[1000px] flex-col gap-4 px-8 py-8">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  )
}

function Script({ demo }: { demo: DemoDetail }) {
  const parents = useMemo(() => spawnParents(demo), [demo])
  const agents = useMemo<SwitcherAgent[]>(
    () => demo.agents.map((a) => ({ name: a.name, parent: parents.get(a.name) ?? null, of: a.steps })),
    [demo, parents],
  )
  const root = agents.find((a) => a.parent === null)?.name ?? agents[0]?.name ?? 'root'
  const [agent, setAgent] = useState(root)
  const colorOf = useMemo(() => agentColors(demo.agents.map((a) => a.name)), [demo])

  const steps = demo.script[agent] ?? []
  const turns = useMemo(() => {
    const entries: Entry[] = steps.map((v) => ({ key: stepKey(agent, v.index), agent, index: v.index, view: v }))
    const prompt = demo.agents.find((a) => a.name === agent)?.prompt
    const parent = parents.get(agent) ?? null
    return buildThread({
      agent,
      parent,
      children: new Set(agents.filter((a) => a.parent === agent).map((a) => a.name)),
      entries,
      incoming: prompt ? [{ at: 0, from: parent ?? 'root', to: agent, text: prompt }] : [],
      // a demo of several sessions: each session's root opens with what the user asked it
      prompt: demo.sessions?.find((s) => s.name === agent)?.prompt ?? null,
    })
  }, [steps, agent, demo, parents, agents])

  return (
    <div className={FRAME}>
      <header className="mx-auto flex w-full max-w-[1000px] min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-8 pt-3 text-sm">
        <AgentSwitcher agents={agents} value={agent} onChange={setAgent} colorOf={colorOf} />
        <span className="text-xs text-faint">
          {plural(demo.agents.length, 'agent')} · {plural(demo.steps, 'step')}
        </span>
        <KindLegend
          kinds={Object.keys(demo.kinds) as SegmentKind[]}
          counts={demo.kinds}
          className="ml-auto gap-x-3 [&_li]:text-[11px]"
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <Conversation
          key={agent}
          turns={turns}
          colorOf={colorOf}
          onOpenAgent={setAgent}
          live={false}
          script
          empty={<p className="py-16 text-center text-sm text-muted-foreground">{agent} has no steps.</p>}
          footer={<p className="text-center text-xs text-faint tabular-nums">{threadSize(turns, steps.length)}</p>}
        />
      </div>
    </div>
  )
}
