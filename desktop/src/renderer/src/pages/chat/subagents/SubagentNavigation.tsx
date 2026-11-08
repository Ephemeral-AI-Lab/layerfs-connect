import { Check, ChevronDown, PanelRightOpen, Users } from 'lucide-react'
import type { Ref } from 'react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { childActive, type ChildRun } from '@/layerfs/agent-api'
import { ChildDot } from '../conversation/steps/SubagentStep'
import { childFacts } from './facts'

type Props = {
  children: ChildRun[]
  current?: ChildRun
  onOpen: (childId: string) => void
  onOpenAside?: (childId: string) => void
  onParent?: () => void
  onOverview?: () => void
  triggerRef?: Ref<HTMLButtonElement>
}

/** The same child catalog drives the parent's count and a child's sibling switcher. */
export function SubagentNavigation({ children, current, onOpen, onOpenAside, onParent, onOverview, triggerRef }: Props) {
  const working = children.filter(childActive).length
  const count = `${children.length} ${children.length === 1 ? 'subagent' : 'subagents'}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={current ? `Switch subagent: ${current.agent}` : count}
          title={current?.task || `${count}${working ? ` · ${working} active` : ''}`}
          className="no-drag flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-12 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {current ? <ChildDot child={current} /> : <Users className="size-3.5 shrink-0" />}
          <span className={current ? 'max-w-48 truncate text-14 font-medium text-[var(--text-primary)]' : 'hidden @min-[560px]/chat:inline'}>{current?.agent ?? count}</span>
          {!current && working > 0 && <span aria-label={`${working} active`} className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--ring)]" />}
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="no-drag w-[360px] max-w-[calc(100vw-32px)] rounded-lg" aria-label="Subagent navigation">
        <DropdownMenuLabel className="flex items-center justify-between text-12 text-[var(--text-tertiary)]">
          <span>Subagents</span><span>{working ? `${working} active · ` : ''}{count}</span>
        </DropdownMenuLabel>
        {onParent && <DropdownMenuItem onSelect={onParent} className="text-13">Back to main chat</DropdownMenuItem>}
        {!children.length && <p className="px-2 py-3 text-13 text-[var(--text-tertiary)]">No subagents yet. Delegated tasks appear here.</p>}
        {children.map(child => (
          <DropdownMenuGroup key={child.id} className="flex items-stretch gap-0.5">
            <DropdownMenuItem
              onSelect={() => onOpen(child.id)}
              aria-current={child.id === current?.id ? 'page' : undefined}
              className="min-w-0 flex-1 items-start gap-2 py-2 text-13"
            >
              <span className="mt-1.5"><ChildDot child={child} /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="whitespace-normal break-words leading-5 text-[var(--text-primary)]">{child.task || child.agent}</span>
                <span className="text-12 text-[var(--text-tertiary)]">{child.agent} · {child.state}</span>
                <span className="text-11 tabular-nums text-[var(--text-tertiary)]">{childFacts(child).join(' · ')}</span>
              </span>
              {child.id === current?.id && <Check className="mt-1 size-3.5" aria-label="Current subagent" />}
            </DropdownMenuItem>
            {onOpenAside && (
              <DropdownMenuItem
                onSelect={() => onOpenAside(child.id)}
                aria-label={`Open ${child.agent} in side panel`}
                title={`Open ${child.agent} in side panel`}
                className="shrink-0 justify-center self-start px-2 py-3"
              >
                <PanelRightOpen className="size-3.5" />
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        ))}
        {onOverview && children.length > 0 && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOverview} className="text-13">All subagents</DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
