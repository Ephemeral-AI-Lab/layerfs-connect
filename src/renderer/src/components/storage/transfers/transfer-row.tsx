// One job, in three forms (storage-redesign §5.3): compact (a Store row's
// status cell, a project card), row (the transfer tray) and card (a Store's
// job card, the Publish, Load and Import dialogs). The bar fills with the
// current phase's bytes; a phase without a size shimmers. Screen readers hear
// only phase changes and the end, never byte updates.
import { CircleCheck, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { siPostgresql } from 'simple-icons'

import { Mark } from '@/components/storage/icons'
import { ProviderMark } from '@/components/storage/identity/store-icon'
import { Bar } from '@/components/storage/meters'
import { RefusalCard, type RefusalActions } from '@/components/storage/transfers/refusal'
import {
  compactLabel,
  duration,
  endedSentence,
  etaSpoken,
  etaText,
  isFailed,
  isRunning,
  KIND,
  phaseLabel,
  rateText,
  share,
  stepIndex,
  STEPS,
  targetName,
  useNow,
} from '@/components/storage/transfers/phases'
import { Button } from '@/components/ui/button'
import { ago, bytes, when } from '@/data/format'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { SyncJob } from '@shared/host-api'

/** The phase's bar: filled by bytes / total, or a shimmering track without a total. Restarts from 0 on a phase change. */
export function JobBar({ job, thin, className }: { job: SyncJob; thin?: boolean; className?: string }) {
  const s = share(job)
  const label = phaseLabel(job) ?? t(KIND[job.kind].doing)
  const text = [label, s !== null ? t('{done} of {total}', { done: bytes(job.bytes), total: bytes(job.total) }) : null, etaSpoken(job.eta)].filter(Boolean).join(', ')
  return (
    <span
      role="progressbar"
      aria-label={`${t(KIND[job.kind].verb)} ${job.store}`}
      aria-valuemin={s === null ? undefined : 0}
      aria-valuemax={s === null ? undefined : 100}
      aria-valuenow={s === null ? undefined : Math.round(s * 100)}
      aria-valuetext={text}
      className={cn('block', className)}
    >
      {s === null ? (
        <span className={cn('relative block overflow-hidden rounded-full bg-muted/90 ring-1 ring-foreground/[0.06] ring-inset', thin ? 'h-0.5' : 'h-1.5')}>
          <span className="shimmer absolute inset-0" />
        </span>
      ) : (
        <Bar key={job.phase ?? 'none'} share={s} live className={cn('motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150', thin && 'h-0.5 ring-0')} />
      )}
    </span>
  )
}

/** The kind's steps: done ones checked, the current one a soft brand dot, later ones hollow. Labels always show. */
export function Stepper({ job, className }: { job: SyncJob; className?: string }) {
  const steps = STEPS[job.kind] ?? []
  const done = !isRunning(job) && !isFailed(job)
  const at = done ? steps.length : stepIndex(job)
  return (
    <ol aria-label={t('Steps')} className={cn('flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px]', className)}>
      {steps.map((s, i) => {
        const state = i < at ? 'done' : i === at ? (isFailed(job) ? 'failed' : 'now') : 'later'
        return (
          <li key={s.label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true" className={cn('h-px w-3', i <= at ? 'bg-primary/40' : 'bg-foreground/15')} />}
            <span className={cn('flex items-center gap-1', state === 'later' ? 'text-faint' : state === 'now' ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              {state === 'done' ? (
                <CircleCheck aria-hidden="true" className="size-3 text-success" />
              ) : state === 'failed' ? (
                <TriangleAlert aria-hidden="true" className="size-3 text-destructive" />
              ) : (
                <span aria-hidden="true" className="sc-step-dot" data-state={state} />
              )}
              {t(s.label)}
              <span className="sr-only">{state === 'done' ? ` (${t('done')})` : state === 'now' ? ` (${t('now')})` : state === 'failed' ? ` (${t('failed')})` : ''}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** The target's mark: the provider's, or PostgreSQL's for an import. */
function TargetMark({ job }: { job: SyncJob }) {
  return job.kind === 'import' || job.provider === 'postgresql' ? <Mark icon={siPostgresql} className="size-3.5 shrink-0" /> : <ProviderMark provider={job.provider} className="size-3.5 shrink-0" />
}

/** What changes for screen readers: the phase, and the end. */
function announcement(job: SyncJob): string {
  if (!isRunning(job)) return `${job.store}: ${endedSentence(job)}`
  const p = phaseLabel(job)
  return `${job.store}: ${p ?? t(KIND[job.kind].doing)}`
}

/** "12.4 MB/s · about 47 s left", or the elapsed time without a rate (§10.4). */
function Pace({ job, now }: { job: SyncJob; now: number }) {
  const parts = [rateText(job.rate), etaText(job.eta)].filter(Boolean)
  return <span className="tabular-nums">{parts.length ? parts.join(' · ') : t('{time} so far', { time: duration(now - job.started) })}</span>
}

function Sizes({ job }: { job: SyncJob }) {
  if (job.total !== null && job.total > 0)
    return (
      <span className="tabular-nums">
        {bytes(job.bytes ?? 0)} / {bytes(job.total)}
      </span>
    )
  if (job.bytes !== null) return <span className="tabular-nums">{bytes(job.bytes)}</span>
  return null
}

interface TransferRowProps {
  job: SyncJob
  form: 'compact' | 'row' | 'card'
  /** The row form's dismiss button. */
  onDismiss?: () => void
  /** Buttons of the card form's refusal block. */
  actions?: RefusalActions
  className?: string
}

export function TransferRow({ job, form, onDismiss, actions, className }: TransferRowProps) {
  useI18n()
  const running = isRunning(job)
  const failed = isFailed(job)
  const now = useNow(running && form !== 'compact')
  const k = KIND[job.kind]
  const Icon = k.icon

  if (form === 'compact') {
    return (
      <span className={cn('flex min-w-0 flex-col gap-1', className)}>
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-primary">
          <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 motion-safe:animate-spin" />
          <span className="truncate tabular-nums">{compactLabel(job)}</span>
        </span>
        <JobBar job={job} thin className="w-full max-w-36" />
      </span>
    )
  }

  const ended = !running
  const took = job.ended !== null ? duration(job.ended - job.started) : null
  const moved = job.result?.bytes ?? job.bytes
  return (
    <div className={cn('min-w-0', className)} data-running={running || undefined}>
      <span className="sr-only" aria-live="polite">
        {announcement(job)}
      </span>
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
            failed ? 'bg-destructive/10 text-destructive ring-destructive/25' : ended ? 'bg-success/10 text-success ring-success/25' : 'bg-primary/10 text-primary ring-primary/25',
          )}
        >
          {failed ? <TriangleAlert className="size-3.5" /> : ended ? <CircleCheck className="size-3.5" /> : <Icon className="size-3.5" />}
        </span>
        <span className="flex min-w-[7.5rem] shrink items-center gap-1.5 text-[13px]">
          <span className="truncate font-semibold tracking-tight">{job.store}</span>
          <span aria-hidden="true" className="text-faint">
            {job.kind === 'pull' || job.kind === 'load' ? '←' : '→'}
          </span>
          <TargetMark job={job} />
          <span className="truncate text-[12px] text-muted-foreground">
            {targetName(job)}
            {job.kind === 'import' && job.from ? ` / ${job.from}` : job.file ? <> / <span className="font-mono">{job.file}</span></> : ''}
          </span>
          {job.force && <span className="shrink-0 rounded-full bg-warning/10 px-1.5 text-[10.5px] font-semibold text-warning ring-1 ring-warning/25 ring-inset">{t('forced')}</span>}
        </span>
        {running ? (
          <>
            <span className="ml-auto hidden shrink-0 text-xs font-medium text-muted-foreground @[34rem]/tray:inline">{phaseLabel(job) ?? `${t(k.doing)}…`}</span>
            <JobBar job={job} className="hidden min-w-24 flex-1 @[34rem]/tray:block" />
            <span className="ml-auto shrink-0 text-xs text-muted-foreground @[34rem]/tray:ml-0">
              <Sizes job={job} />
            </span>
          </>
        ) : (
          <span className="ml-auto flex min-w-0 shrink items-center gap-2 text-xs text-muted-foreground">
            <span className={cn('truncate', failed && 'font-medium text-destructive')}>
              {failed ? t('{verb} failed', { verb: t(k.verb) }) : [t(k.did), moved !== null ? bytes(moved) : null, took ? t('in {time}', { time: took }) : null].filter(Boolean).join(' · ')}
            </span>
            <span className="text-faint tabular-nums" title={when(job.ended)}>
              {ago(job.ended)}
            </span>
            {onDismiss && (
              <Button size="icon-xs" variant="ghost" onClick={onDismiss} aria-label={t('Dismiss: {what}', { what: endedSentence(job) })}>
                <X />
              </Button>
            )}
          </span>
        )}
      </div>
      {running && (
        <div className="mt-2 flex min-w-0 flex-col gap-1.5 pl-[38px]">
          <JobBar job={job} className="@[34rem]/tray:hidden" />
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <Stepper job={job} />
            <span className="text-[11.5px] text-muted-foreground">
              {job.pieces && `${t('piece {done} of {of}', { done: job.pieces.done, of: job.pieces.of })} · `}
              <Pace job={job} now={now} />
            </span>
          </div>
        </div>
      )}
      {form === 'card' && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-[38px] text-[11.5px] text-faint">
          <span title={when(job.started)}>{t('Started {ago}', { ago: ago(job.started) })}</span>
          {ended && took && <span>{t('Took {time}', { time: took })}</span>}
          {job.result?.bytes != null && <span>{t(job.kind === 'push' ? 'Snapshot {size}' : 'File {size}', { size: bytes(job.result.bytes) })}</span>}
          {job.result?.sha256 && (
            <span className="font-mono" title={job.result.sha256}>
              sha256 {job.result.sha256.slice(0, 12)}…
            </span>
          )}
        </div>
      )}
      {form === 'card' && failed && <RefusalCard job={job} actions={actions} className="mt-3 ml-[38px]" />}
    </div>
  )
}
