import type { AgentState } from '@shared/host-api'
import { Check, ChevronsUpDown } from 'lucide-react'

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

/** The agent in the breadcrumb, opening to every agent of the run (parent → child). */
export function AgentSwitcher({ agents, value, onChange, colorOf }: AgentSwitcherProps) {
  const nodes = treeOrder(agents, (a) => a.name, (a) => a.parent)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Agent"
        className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
      >
        {value}
        <ChevronsUpDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-faint">
          {agents.length} agent{agents.length === 1 ? '' : 's'}
        </DropdownMenuLabel>
        {nodes.map(({ item: a, depth }) => (
          <DropdownMenuItem key={a.name} onSelect={() => onChange(a.name)} className="gap-2 py-1.5" style={{ paddingLeft: 6 + depth * 16 }}>
            <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', colorOf(a.name).dot)} />
            <span className={cn('min-w-0 flex-1 truncate', a.name === value && 'font-medium')}>{a.name}</span>
            {a.state && <AgentDot state={a.state} />}
            <span className="max-w-48 truncate text-[11px] text-faint tabular-nums">{a.state ? (a.activity ?? '') : plural(a.of, 'step')}</span>
            <Check aria-hidden="true" className={cn('size-3.5', a.name === value ? 'text-foreground' : 'invisible')} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
