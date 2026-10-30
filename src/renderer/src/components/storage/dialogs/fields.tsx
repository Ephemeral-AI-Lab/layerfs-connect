// Small form parts the Storage dialogs share: a labelled field and an error line.
import { TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function Field({ id, label, hint, problem, className, children }: { id: string; label: React.ReactNode; hint?: React.ReactNode; problem?: string | null; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      {children}
      {problem ? <p className="text-[12px] text-destructive">{problem}</p> : hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** A refused request, beside the control that sent it. */
export function FormError({ error, className }: { error?: string | null; className?: string }) {
  if (!error) return null
  return (
    <div role="alert" className={cn('flex items-start gap-2 text-[13px] text-destructive', className)}>
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{error}</span>
    </div>
  )
}
