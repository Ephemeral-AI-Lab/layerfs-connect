// What every Storage detail page is made of: a header with its mark in brand
// light, sections on lit cards, facts in a row, and the "gone" state.
import { ArrowLeft, SearchX } from 'lucide-react'
import type { CSSProperties } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { useStorage } from '@/components/storage/actions'
import { Empty } from '@/components/projects/states'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
      <span className="relative shrink-0">
        <span aria-hidden="true" className="bg-brand absolute -inset-3 rounded-full opacity-[0.18] blur-xl dark:opacity-25" />
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">{eyebrow}</p>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1 className="min-w-0 truncate text-[22px] leading-8 font-semibold tracking-[-0.02em]">{title}</h1>
          {badges}
        </div>
        {children && <div className="mt-1 flex flex-col gap-0.5 text-[13px] text-muted-foreground">{children}</div>}
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
  quiet?: boolean
  className?: string
  children: React.ReactNode
  'aria-label'?: string
}

export function Section({ title, note, aside, index = 2, quiet, className, children, ...aria }: SectionProps) {
  return (
    <section aria-label={aria['aria-label'] ?? (typeof title === 'string' ? title : undefined)} className={cn('reveal rounded-xl', quiet ? 'sc-soon' : 'surface', className)} style={i(index)}>
      {(title || aside) && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {note && <p className="min-w-0 flex-1 text-xs text-muted-foreground">{note}</p>}
          {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

/** One labelled fact. */
export function Fact({ label, children, mono, title }: { label: string; children: React.ReactNode; mono?: boolean; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-[0.05em] text-faint uppercase">{label}</dt>
      <dd title={title} className={cn('mt-1 truncate', mono ? 'font-mono text-[12.5px]' : 'text-sm')}>
        {children}
      </dd>
    </div>
  )
}

/** A page whose subject is gone: removed or renamed elsewhere. */
export function Gone({ what }: { what: string }) {
  const s = useStorage()
  return (
    <Empty
      icon={SearchX}
      title={`${what} is gone`}
      action={
        <Button size="sm" variant="outline" onClick={() => s.open({ view: 'overview' })}>
          <ArrowLeft /> Back to Storage
        </Button>
      }
    >
      It was removed or renamed.
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
      <span className="flex size-5 items-center justify-center rounded bg-card ring-1 ring-foreground/[0.06] ring-inset">
        <LayerfsMark className="size-3" />
      </span>
      <span className="truncate">{name}</span>
    </>
  )
  const cls = 'inline-flex max-w-56 items-center gap-1.5 rounded-lg bg-muted/70 py-1 pr-2.5 pl-1 text-[13px] font-medium ring-1 ring-foreground/[0.05] ring-inset'
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'outline-none transition-colors hover:bg-muted hover:text-primary focus-visible:ring-2 focus-visible:ring-ring')}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  )
}
