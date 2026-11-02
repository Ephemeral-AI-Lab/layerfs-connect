import { t, useI18n } from '@/i18n'
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
      title: t('The Connect host is not reachable'),
      detail:
        error instanceof HostError
          ? error.message
          : t('Connect could not talk to its host process. Restart Connect; if it keeps happening, check its log.'),
    }
  return { title: t('Could not read {what}', { what }), detail: error.message }
}

/** A compact loading indicator, shown only while a read is pending. */
export function Loading({ label, className }: { label: string; className?: string }) {
  useI18n()
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground', className)}>
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
      <span>{label}</span>
    </div>
  )
}

/** Empty and error states use one still, neutral icon. */
function StateIcon({ icon: Icon, tone = 'quiet' }: { icon: React.ComponentType<{ className?: string }>; tone?: 'quiet' | 'danger' }) {
  useI18n()
  return (
    <span className={cn('mb-1 flex size-9 items-center justify-center rounded-xl bg-muted/60', tone === 'danger' ? 'text-destructive' : 'text-muted-foreground')}>
      <Icon aria-hidden="true" className="size-4" />
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
  useI18n()
  const { title, detail } = explain(error, what)
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/[0.03] px-6 py-8 text-center',
        className,
      )}
    >
      <StateIcon icon={Unplug} tone="danger" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-lg text-xs break-words text-muted-foreground">{detail}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RotateCw />{t("Try again")}</Button>
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

/** A short empty state with an optional next action. */
export function Empty({ icon, title, children, action, className }: EmptyProps) {
  useI18n()
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-xl border bg-card/40 px-6 py-10 text-center', className)}>
      <StateIcon icon={icon} />
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="max-w-sm text-xs text-pretty text-muted-foreground">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
