import { t, useI18n } from '@/i18n'
// The Projects list (docs/ui/layerfs-projects.md): one row per project with
// the Store it is stored in, the machines it runs on, its chats and its last
// activity. A Store's state shows beside its chip only when it is not plainly
// usable (busy, down, unresolved). Under 44 rem a row folds into two lines.
import { ChevronRight } from 'lucide-react'
import { projectKey, type ProjectSummary } from '@shared/host-api'

import { revealStyle } from '@/components/motion/reveal'
import type { StoreFacts } from '@/components/projects/store-facts'
import { type RunsOn, RunsOnChips, StoreChip } from '@/components/projects/where-chips'
import { StateChip } from '@/components/state-chip'
import { ago, when } from '@/data/format'
import { cn } from '@/lib/utils'

/** Store states that need no word on a project's row. */
const QUIET = new Set(['idle', 'in_use', 'ready'])
/** Whether a project's Store needs its state shown. */
export const storeNeedsWord = (facts: StoreFacts) => (!!facts.state && !QUIET.has(facts.state)) || !!facts.op

/** A project's chats as the list counts them: open ones, working ones, and the newest activity. */
export interface ProjectChats {
  count: number
  working: number
  updated: number | null
}

export interface ProjectRowData {
  project: ProjectSummary
  facts: StoreFacts
  chats: ProjectChats | undefined
  /** The machines its Sandboxes run on; null when the machines were not read. */
  runs: RunsOn[] | null
  /** The newest chat's activity, else when the project was made. */
  activity: number | null
}

/** Columns: Project, Stored in, Runs on, Chats, Last activity, the opener. */
const COLS = '@min-[44rem]/projects:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.75fr)_1rem]'

export function ProjectTable({ rows, now, onOpen }: { rows: ProjectRowData[]; now: number; onOpen: (key: string) => void }) {
  useI18n()
  return (
    <div role="table" aria-label={t('Projects')} className="@container/projects glass-liquid overflow-hidden rounded-2xl">
      <div role="row" className={cn('hidden gap-x-3 border-b px-4 py-2 text-[11px] font-medium text-faint @min-[44rem]/projects:grid', COLS)}>
        <span role="columnheader">{t('Project')}</span>
        <span role="columnheader">{t('Stored in')}</span>
        <span role="columnheader">{t('Runs on')}</span>
        <span role="columnheader">{t('Chats')}</span>
        <span role="columnheader">{t('Last activity')}</span>
        <span />
      </div>
      {rows.map((row, i) => <ProjectRow key={projectKey(row.project)} row={row} index={i} now={now} onOpen={onOpen} />)}
    </div>
  )
}

function ProjectRow({ row, index, now, onOpen }: { row: ProjectRowData; index: number; now: number; onOpen: (key: string) => void }) {
  const { project, facts, chats, runs, activity } = row
  const key = projectKey(project)
  const open = () => onOpen(key)
  const word = storeNeedsWord(facts)
  return (
    // a row of link chips: a div that opens, so the chips stay buttons of their own
    <div
      role="row"
      tabIndex={0}
      aria-label={t('Open {name}', { name: key })}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          open()
        }
      }}
      style={revealStyle(index)}
      className={cn(
        'reveal group/row grid cursor-pointer grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        index > 0 && 'border-t',
        COLS,
      )}
    >
      <span role="cell" className="min-w-0 truncate text-[13.5px] font-semibold tracking-tight" title={key}>{project.name}</span>
      {/* narrow: one second line; wide: four cells of the grid */}
      <span className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @min-[44rem]/projects:contents">
        <span role="cell" className="flex min-w-0 max-w-full flex-col items-start gap-0.5">
          <span className="flex min-w-0 max-w-full items-center gap-1.5">
            <StoreChip store={facts.name} className="shrink" />
            {word && <StateChip entity="store" state={facts.state} op={facts.op} className="max-w-40 shrink-[2]" />}
          </span>
          {project.storeDown && <span className="max-w-full truncate text-[11px] text-muted-foreground" title={project.storeDown}>{project.storeDown}</span>}
        </span>
        <span role="cell" className="min-w-0 max-w-full"><RunsOnChips runs={runs} /></span>
        <span role="cell" className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">
          {!chats?.count ? '—' : (
            <>
              <span className="text-foreground/85">{chats.count}</span>
              {chats.working > 0 && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-primary">
                  <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />
                  {t('{n} working', { n: chats.working })}
                </span>
              )}
            </>
          )}
        </span>
        <span role="cell" className="min-w-0 truncate text-xs tabular-nums text-muted-foreground" title={activity !== null ? when(activity) : undefined}>
          {activity !== null ? ago(activity, now) : '—'}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="col-start-2 row-start-1 size-4 text-faint transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-foreground @min-[44rem]/projects:col-start-auto @min-[44rem]/projects:row-start-auto" />
    </div>
  )
}
