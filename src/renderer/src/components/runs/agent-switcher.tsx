import type { AgentState } from '@shared/host-api'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { useIndicator } from '@/components/motion/indicator'
import { Segmented } from '@/components/motion/tabs'
import { AgentDot } from '@/components/runs/run-badges'
import { type AgentColor, plural } from '@/components/runs/run-format'
import { treeOrder } from '@/components/runs/thread'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface SwitcherAgent {
  name: string
  parent: string | null
  /** A run's agent: its state, and what it is doing now (run-format's activity). A script's: its step count. */
  state?: AgentState
  done?: number
  of: number
  since?: number
  thinking?: number | null
  activity?: string
}

interface AgentSwitcherProps {
  agents: SwitcherAgent[]
  value: string
  onChange: (name: string) => void
  colorOf: (name: string) => AgentColor
}

/** An agent's colour dot; it pulses while the agent runs. */
function ColorDot({ color, live, className }: { color: AgentColor; live?: boolean; className?: string }) {
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', color.dot, color.text, live && 'pulse-ring', className)} />
}

/** The agent in the breadcrumb, opening to every agent of the run (parent → child). */
export function AgentSwitcher({ agents, value, onChange, colorOf }: AgentSwitcherProps) {
  const nodes = treeOrder(agents, (a) => a.name, (a) => a.parent)
  const current = agents.find((a) => a.name === value)
  // A highlight that glides from item to item. Radix marks the item under the
  // pointer or keyboard `data-highlighted` as it takes focus: follow that.
  const { container, indicator, place } = useIndicator<HTMLDivElement>({ selector: '[data-highlighted]' })
  const follow = useCallback(() => requestAnimationFrame(place), [place])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Agent"
        className="group/agent flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm font-medium text-foreground outline-none transition-colors duration-(--dur-fast) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
      >
        <ColorDot color={colorOf(value)} live={current?.state === 'running'} />
        {value}
        <ChevronsUpDown
          aria-hidden="true"
          className="size-3.5 text-muted-foreground transition-transform duration-(--dur-base) ease-out-expo group-hover/agent:scale-110 group-data-[state=open]/agent:text-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={container}
        align="start"
        onFocusCapture={follow}
        onBlurCapture={follow}
        className="relative isolate w-64 shadow-[var(--highlight),var(--elev-3)]"
      >
        <span ref={indicator} aria-hidden="true" className="indicator -z-10 rounded-md bg-accent" />
        <DropdownMenuLabel className="text-xs font-normal text-faint">
          {agents.length} agent{agents.length === 1 ? '' : 's'}
        </DropdownMenuLabel>
        {nodes.map(({ item: a, depth }) => {
          const on = a.name === value
          return (
            <DropdownMenuItem
              key={a.name}
              onSelect={() => onChange(a.name)}
              className="gap-2 py-1.5 transition-colors duration-(--dur-fast) focus:bg-transparent"
              style={{ paddingLeft: 6 + depth * 16 }}
            >
              <ColorDot color={colorOf(a.name)} className={cn(on && 'ring-2 ring-offset-1 ring-offset-popover', on && colorOf(a.name).ring)} />
              <span className={cn('min-w-0 flex-1 truncate', on && 'font-medium')}>{a.name}</span>
              {a.state && <AgentDot state={a.state} />}
              <span className="max-w-48 truncate text-[11px] text-faint tabular-nums">{a.state ? (a.activity ?? '') : plural(a.of, 'step')}</span>
              <Check aria-hidden="true" className={cn('size-3.5 transition-opacity duration-(--dur-fast)', on ? 'text-foreground' : 'opacity-0')} />
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Every agent in a row (parent → child), a pill gliding to the one shown. For a script, where the agents fit on a line or two. */
export function AgentRail({ agents, value, onChange, colorOf }: AgentSwitcherProps) {
  const options = useMemo(
    () =>
      treeOrder(agents, (a) => a.name, (a) => a.parent).map(({ item: a }) => ({
        value: a.name,
        title: a.parent ? `${a.name}, started by ${a.parent}` : a.name,
        count: a.of,
        label: (
          <>
            <ColorDot color={colorOf(a.name)} />
            {a.name}
          </>
        ),
      })),
    [agents, colorOf],
  )
  return <Segmented aria-label="Agent" value={value} onChange={onChange} options={options} className="flex-wrap" />
}
