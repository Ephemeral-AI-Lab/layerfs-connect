// What every Storage detail page is made of: a header with its mark on a lit
// tile, sections on liquid glass cards, facts in a row, and the "gone" state.
import { ArrowLeft, SearchX } from 'lucide-react'
import type { CSSProperties } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { spotlight } from '@/components/motion'
import { Empty } from '@/components/projects/states'
import { useStorage } from '@/components/storage/actions'
import { Button } from '@/components/ui/button'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export { Fact } from '@/components/storage/machine/worker'

const i = (n: number) => ({ '--i': n }) as CSSProperties

interface DetailHeaderProps {
  icon: React.ReactNode
  eyebrow: string
  title: React.ReactNode
  /** Beside the title: a pill, chips. */
  badges?: React.ReactNode
  /** Lines under the title. */
  children?: React.ReactNode
  actions?: React.ReactNode
}

export function DetailHeader({ icon, eyebrow, title, badges, children, actions }: DetailHeaderProps) {
  return (
    <header className="reveal flex flex-wrap items-start gap-x-4 gap-y-3" style={i(1)}>
      <span className="glass-liquid flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border/50 shadow-xs">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-semibold tracking-wider text-muted-foreground/80 uppercase">{eyebrow}</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 className="min-w-0 truncate text-xl font-semibold tracking-tight">{title}</h2>
          {badges}
        </div>
        {children && <div className="mt-1 flex flex-col gap-0.5 text-xs font-medium text-muted-foreground">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 @max-[759px]/storage:w-full">{actions}</div>}
    </header>
  )
}

interface SectionProps {
  title?: React.ReactNode
  /** A line beside the title. */
  note?: React.ReactNode
  /** Buttons on the right of the header. */
  aside?: React.ReactNode
  index?: number
  /** A calm, dashed "not live" card. */
  quiet?: boolean
  className?: string
  children: React.ReactNode
  'aria-label'?: string
}

export function Section({ title, note, aside, index = 2, quiet, className, children, ...aria }: SectionProps) {
  return (
    <section
      aria-label={aria['aria-label'] ?? (typeof title === 'string' ? title : undefined)}
      onPointerMove={quiet ? undefined : spotlight}
      className={cn('reveal min-w-0', quiet ? 'sc-soon' : 'glass-liquid spotlight rounded-2xl shadow-xs', className)}
      style={i(index)}
    >
      {(title || aside) && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4">
          {title && <h3 className="text-sm font-semibold tracking-tight">{title}</h3>}
          {note && <p className="min-w-0 flex-1 text-xs text-muted-foreground">{note}</p>}
          {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

/** A count beside a section's title. */
export function CountBadge({ n }: { n: number }) {
  return <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums ring-1 ring-border/50">{n}</span>
}

/** A table's header row in a section: faint upper-case labels on a hairline band. */
export const TABLE_HEAD = 'border-y border-foreground/[0.06] bg-foreground/[0.015] px-5 py-2 text-[10.5px] font-semibold tracking-wider text-muted-foreground/80 uppercase @max-[759px]/storage:hidden'

/** A page whose subject is gone: removed or renamed elsewhere. */
export function Gone({ what }: { what: string }) {
  useI18n()
  const s = useStorage()
  return (
    <Empty
      icon={SearchX}
      title={t('{what} is gone', { what })}
      action={
        <Button size="sm" variant="outline" className="rounded-xl" onClick={() => s.open({ view: 'overview' })}>
          <ArrowLeft /> {t('Back to Storage')}
        </Button>
      }
    >
      {t('It was removed or renamed.')}
    </Empty>
  )
}

/** Project chips that open the project page. */
export function ProjectChips({ store, projects }: { store: string; projects: string[] }) {
  const s = useStorage()
  return (
    <ul className="flex flex-wrap gap-1.5">
      {projects.map((p) => (
        <li key={p}>
          <ProjectChip name={p} onClick={s.openProject ? () => s.openProject!(store, p) : undefined} />
        </li>
      ))}
    </ul>
  )
}

function ProjectChip({ name, onClick }: { name: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex size-5 items-center justify-center rounded-md bg-card ring-1 ring-foreground/[0.06] ring-inset">
        <LayerfsMark className="size-3" />
      </span>
      <span className="truncate">{name}</span>
    </>
  )
  const cls = 'inline-flex max-w-56 items-center gap-1.5 rounded-xl bg-muted/70 py-1 pr-2.5 pl-1 text-[13px] font-medium ring-1 ring-foreground/[0.06] ring-inset'
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'outline-none transition-colors hover:bg-muted hover:text-primary focus-visible:ring-2 focus-visible:ring-ring')}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  )
}
