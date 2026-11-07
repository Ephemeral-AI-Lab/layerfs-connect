// The chat's subagents, newest last as they were started: state, agent,
// the task it was given and its numbers. The chosen one is marked.
import { NavLink } from 'react-router-dom'
import type { ChildRun } from '@/layerfs/agent-api'
import { cn } from '@/lib/utils'
import { ChildDot } from '../conversation/steps/SubagentStep'
import { childFacts } from './facts'

export function ChildList({ chatId, children, compact }: { chatId: string; children: ChildRun[]; compact: boolean }) {
  return (
    <ul className="flex flex-col gap-1">
      {children.map((child) => (
        <li key={child.id}>
          <NavLink
            to={`/chat/${encodeURIComponent(chatId)}/subagents/${encodeURIComponent(child.id)}`}
            className={({ isActive }) =>
              cn(
                'flex flex-col gap-1 rounded-md px-3 py-2.5 text-13 transition-colors hover:bg-[var(--surface-hover)]',
                !compact && 'border border-[var(--border-default)] bg-[var(--card)]',
                isActive && 'bg-[var(--sidebar-item-active,#E3ECF8)] hover:bg-[var(--sidebar-item-active,#E3ECF8)]',
              )
            }
          >
            <span className="flex min-w-0 items-center gap-2">
              <ChildDot child={child} />
              <span className="min-w-0 truncate font-medium text-[var(--text-primary)]">{child.agent}</span>
              <span className="ml-auto shrink-0 text-12 text-[var(--text-tertiary)]">{child.state}</span>
            </span>
            {child.task && <span className="line-clamp-2 text-12 leading-[18px] text-[var(--text-secondary)]">{child.task}</span>}
            <span className="flex flex-wrap gap-x-2 text-11 tabular-nums text-[var(--text-tertiary)]">
              {childFacts(child).map((f) => (
                <span key={f}>{f}</span>
              ))}
            </span>
          </NavLink>
        </li>
      ))}
    </ul>
  )
}
