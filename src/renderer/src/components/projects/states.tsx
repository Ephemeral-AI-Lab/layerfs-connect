import { LoaderCircle, RotateCw, Unplug } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { HostError } from '@/host/client'
import { cn } from '@/lib/utils'

/** True when the host itself could not be reached, not when it refused. */
export const unreachable = (error: Error) =>
  (error instanceof HostError && error.code === 'no-host') || error instanceof TypeError

/** What went wrong, in one line the reader can act on. */
export function explain(error: Error, what = 'it'): { title: string; detail: string } {
  if (unreachable(error))
    return {
      title: 'The Connect host is not reachable',
      detail:
        error instanceof HostError
          ? error.message
          : 'Connect could not talk to its host process. Restart Connect; if it keeps happening, check its log.',
    }
  return { title: `Could not read ${what}`, detail: error.message }
}

export function Loading({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground', className)}>
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-faint" />
      {label}…
    </div>
  )
}

interface LoadErrorProps {
  error: Error
  /** "this project's history", "the Sandboxes" … */
  what: string
  onRetry?: () => void
  className?: string
}

export function LoadError({ error, what, onRetry, className }: LoadErrorProps) {
  const { title, detail } = explain(error, what)
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center', className)}
    >
      <Unplug aria-hidden="true" className="size-6 text-faint" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-lg text-xs break-words text-muted-foreground">{detail}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      )}
    </div>
  )
}

interface EmptyProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export function Empty({ icon: Icon, title, children, action, className }: EmptyProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center', className)}>
      <Icon aria-hidden="true" className="size-6 text-faint" />
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="max-w-sm text-xs text-muted-foreground">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
