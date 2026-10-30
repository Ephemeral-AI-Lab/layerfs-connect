// A scenario's script before any run plays it: one agent's thread at a time,
// in the run page's look, under a card that names the agents and counts the
// script's LayerFS calls by kind.
import type { DemoDetail, SegmentKind } from '@shared/host-api'
import { ScrollText } from 'lucide-react'
import { useMemo, useState } from 'react'

import { spotlight } from '@/components/motion/spotlight'
import { Empty, LoadError, Loading } from '@/components/projects/states'
import { AgentRail, AgentSwitcher, type SwitcherAgent } from '@/components/runs/agent-switcher'
import { Conversation } from '@/components/runs/conversation'
import { KindLegend } from '@/components/runs/run-badges'
import { KIND, KIND_ORDER, agentColors, plural, stepKey } from '@/components/runs/run-format'
import { type Entry, buildThread, targetOf, threadSize } from '@/components/runs/thread'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

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

/** Up to this many agents fit the rail; more get the dropdown. */
const RAIL = 8

/** The script's calls by kind, one bar of proportional segments. */
function KindBar({ counts }: { counts: Partial<Record<SegmentKind, number>> }) {
  const kinds = KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0)
  if (!kinds.length) return null
  return (
    <div aria-hidden="true" className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-foreground/[0.05]">
      {kinds.map((k) => (
        <span key={k} title={`${KIND[k].label} ${counts[k]}`} className={cn('h-full min-w-[3px] opacity-80', KIND[k].dot)} style={{ flexGrow: counts[k] }} />
      ))}
    </div>
  )
}

/** Scenario `demo`'s script. */
export function DemoScript({ demo }: { demo: string }) {
  const { t } = useI18n()
  const loaded = useHostQuery(() => host.demo(demo), [demo], `demo:${demo}`)
  if (loaded.data && loaded.data.id === demo) return <Script key={demo} demo={loaded.data} />
  if (loaded.error) return <LoadError error={loaded.error} what={t('the script')} onRetry={loaded.reload} className="mx-auto mt-6 w-full max-w-3xl" />
  return <Loading label={t('Reading the script')} />
}

function Script({ demo }: { demo: DemoDetail }) {
  const { t } = useI18n()
  const parents = useMemo(() => spawnParents(demo), [demo])
  const agents = useMemo<SwitcherAgent[]>(
    () => demo.agents.map((a) => ({ name: a.name, parent: parents.get(a.name) ?? null, of: a.steps })),
    [demo, parents],
  )
  const root = agents.find((a) => a.parent === null)?.name ?? agents[0]?.name ?? 'root'
  const [agent, setAgent] = useState(root)
  const colorOf = useMemo(() => agentColors(demo.agents.map((a) => a.name)), [demo])

  const steps = useMemo(() => demo.script[agent] ?? [], [demo, agent])
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
      // root opens with what the user asked it; in a demo of several sessions, each session's root with its own
      prompt: agent === root && !demo.sessions?.length ? demo.prompt : (demo.sessions?.find((s) => s.name === agent)?.prompt ?? null),
    })
  }, [steps, agent, demo, parents, agents, root])

  if (!agents.length) return <Empty icon={ScrollText} title={t('This scenario has no agents')} className="mx-auto mt-6 w-full max-w-3xl" />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mx-auto w-full max-w-3xl min-w-0 shrink-0 px-6 pt-1">
        <div onPointerMove={spotlight} className="glass-liquid spotlight reveal flex flex-col gap-3 rounded-2xl px-4 pt-3.5 pb-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <ScrollText aria-hidden="true" className="size-3.5" />
              {t('Script')}
            </span>
            {agents.length <= RAIL ? (
              <AgentRail agents={agents} value={agent} onChange={setAgent} colorOf={colorOf} />
            ) : (
              <AgentSwitcher agents={agents} value={agent} onChange={setAgent} colorOf={colorOf} />
            )}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {plural(demo.agents.length, 'agent')} · {plural(demo.steps, 'step')}
            </span>
          </div>
          {demo.blurb && <p className="text-[13px] leading-relaxed text-muted-foreground">{demo.blurb}</p>}
          <div className="flex flex-col gap-2">
            <KindBar counts={demo.kinds} />
            <KindLegend kinds={Object.keys(demo.kinds) as SegmentKind[]} counts={demo.kinds} className="gap-x-3.5 [&_li]:text-[11px]" />
          </div>
        </div>
      </header>
      <Conversation
        key={agent}
        turns={turns}
        colorOf={colorOf}
        onOpenAgent={setAgent}
        live={false}
        script
        empty={<p className="py-16 text-center text-sm text-muted-foreground">{t('{name} has no steps.', { name: agent })}</p>}
        footer={<p className="text-center text-xs text-muted-foreground tabular-nums">{threadSize(turns, steps.length)}</p>}
      />
    </div>
  )
}
