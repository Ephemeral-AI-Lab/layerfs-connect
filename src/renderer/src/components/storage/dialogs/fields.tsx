// Small parts the Storage dialogs share, in the branch's dialog style
// (projects/delete-project-dialog.tsx): a rounded-3xl glass sheet, a title
// with its icon on a tinted tile, a labelled field, an error line, and the
// footer's buttons.
import { type LucideIcon, TriangleAlert } from 'lucide-react'

import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The dialog sheet: big radius, generous inset, scrolls when tall. */
export const SHEET = 'max-h-[calc(100dvh-3rem)] gap-5 overflow-y-auto rounded-3xl [--dialog-inset:1.5rem]'
/** A footer button. */
export const BTN = 'h-8 rounded-xl px-3.5'

const TONE = {
  brand: 'bg-primary/[0.08] text-primary',
  danger: 'bg-destructive/[0.07] text-destructive',
  warning: 'bg-warning/[0.08] text-warning',
}

/** The dialog's title with its icon on a tinted tile, and its description. */
export function SheetHeader({ icon: Icon, mark, tone = 'brand', title, children }: { icon?: LucideIcon; mark?: React.ReactNode; tone?: keyof typeof TONE; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <DialogHeader className="gap-3 pr-8">
      <DialogTitle className="flex items-start gap-2.5 text-base font-semibold">
        {mark ?? (Icon && (
          <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', TONE[tone])}>
            <Icon className="size-4" />
          </span>
        ))}
        <span className="min-w-0 pt-0.5 [overflow-wrap:anywhere]">{title}</span>
      </DialogTitle>
      {children && <DialogDescription className="text-xs leading-relaxed text-pretty">{children}</DialogDescription>}
    </DialogHeader>
  )
}

export function Field({ id, label, hint, problem, className, children }: { id: string; label: React.ReactNode; hint?: React.ReactNode; problem?: string | null; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-semibold text-foreground/90">
        {label}
      </label>
      {children}
      {problem ? <p className="text-[11.5px] text-destructive">{problem}</p> : hint && <p className="text-[11.5px] break-words text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** A refused request, beside the control that sent it. */
export function FormError({ error, className }: { error?: string | null; className?: string }) {
  if (!error) return null
  return (
    <div role="alert" className={cn('flex items-start gap-2 rounded-xl bg-destructive/[0.06] px-3.5 py-3 text-xs leading-relaxed text-destructive', className)}>
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{error}</span>
    </div>
  )
}

/** A quiet inset box inside a dialog: the subject, facts, a running job. */
export const INSET = '@container/tray rounded-2xl border border-foreground/[0.06] bg-background/40 px-3.5 py-3'

/** The dialog's buttons, right-aligned; `left` sits at the start. */
export function SheetFooter({ left, children }: { left?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {left && <div className="mr-auto flex flex-wrap gap-2">{left}</div>}
      {children}
    </div>
  )
}
