import { RotateCw, Unplug } from 'lucide-react'

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

/** Something being read: three shimmering lines over the label, which stays the status's text. */
export function Loading({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn('flex flex-col items-center justify-center gap-4 py-14', className)}>
      <div aria-hidden="true" className="flex w-full max-w-xs flex-col items-center gap-2 animate-in fade-in duration-500">
        <span className="shimmer h-2 w-full rounded-full" />
        <span className="shimmer h-2 w-4/5 rounded-full [animation-delay:120ms]" />
        <span className="shimmer h-2 w-3/5 rounded-full [animation-delay:240ms]" />
      </div>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />
        {label}…
      </span>
    </div>
  )
}

/** The icon of an Empty or LoadError: a lit tile, with a soft light behind it. */
function StateIcon({ icon: Icon, tone = 'quiet', still }: { icon: React.ComponentType<{ className?: string }>; tone?: 'quiet' | 'danger'; still?: boolean }) {
  return (
    <span className={cn('relative mb-1 flex', !still && 'drift')}>
      <span
        aria-hidden="true"
        className={cn('absolute -inset-3 rounded-full opacity-60 blur-xl', tone === 'danger' ? 'bg-destructive/15' : 'bg-brand opacity-25 dark:opacity-30')}
      />
      <span
        className={cn(
          'surface relative flex size-11 items-center justify-center rounded-xl',
          tone === 'danger' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        <Icon aria-hidden="true" className="size-5" />
      </span>
    </span>
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
      className={cn(
        'reveal flex flex-col items-center gap-2 rounded-xl border border-dashed border-destructive/25 bg-destructive/[0.03] px-6 py-12 text-center',
        className,
      )}
    >
      <StateIcon icon={Unplug} tone="danger" still />
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

/** Nothing here yet: a gently drifting icon, a title, a line of help and an action. */
export function Empty({ icon, title, children, action, className }: EmptyProps) {
  return (
    <div className={cn('reveal flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card/40 px-6 py-14 text-center', className)}>
      <StateIcon icon={icon} />
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="max-w-sm text-xs text-pretty text-muted-foreground">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
