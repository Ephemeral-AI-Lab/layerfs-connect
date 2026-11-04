// A Storage job's progress (docs/ui/layerfs-storage.md), drawn the same way
// wherever it shows: the bar of its steps (the byte step wide, filling by
// bytes; the others small, filling as each ends; a move's two halves side by
// side), what it is doing in words, its bytes, speed and time left; how it
// ended (done for a minute, a failure until dismissed, with Try again). The
// card's footer, a Store page's steps and activity, and a Machines tile's chip.
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Refusal } from '@/components/refusal'
import { Button } from '@/components/ui/button'
import { ago, bytes } from '@/data/format'
import { barOf, doingWords, endedWords, halfOf, leftWords, rateOf, rateWords, secondsLeft, type Segment, stepCount, stepShare, stepWords, tookWords } from '@/data/job-progress'
import { opWords } from '@/data/states'
import { dismissJob, samplesOf, stepSeen } from '@/host/storage-jobs'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { StorageJob, StoreRow } from '@shared/host-api'

import '@/components/storage/storage.css'

/** Re-renders every `ms` while mounted: "just now", elapsed times. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

/** A place in words: `native` is the home. */
const place = (m: string | null | undefined) => (m === 'native' ? t('Home') : (m ?? '?'))

function SegmentBar({ s }: { s: Segment }) {
  return (
    <span title={stepWords(s.step)} className={cn('relative block h-1.5 min-w-1.5 overflow-hidden rounded-full', s.state === 'done' ? 'bg-primary/75' : s.state === 'failed' ? 'bg-destructive' : s.state === 'now' && s.share === null ? 'job-now' : 'bg-muted ring-1 ring-foreground/[0.07] ring-inset')} style={{ flexGrow: s.weight, flexBasis: 0 }}>
      {s.state === 'now' && s.share !== null && <span className="sc-bar-brand absolute inset-y-0 left-0 rounded-full transition-[width] duration-(--dur-slow) ease-out-expo" style={{ width: `${s.share * 100}%` }} />}
    </span>
  )
}

/** The bar of a job's steps: one group, or a move's pull and push. */
export function JobBar({ job, className }: { job: StorageJob; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {barOf(job).map((group, g) => (
        <span key={g} className="flex min-w-0 flex-1 items-center gap-[3px]">
          {group.map((s) => (
            <SegmentBar key={s.step} s={s} />
          ))}
        </span>
      ))}
    </span>
  )
}

/** Bytes, speed and time left while it sends; the step it is on otherwise. */
function Measures({ job: j }: { job: StorageJob }) {
  const share = stepShare(j)
  const rate = share !== null ? rateOf(samplesOf(j.id)) : null
  const left = secondsLeft(j, rate)
  const { at, of } = stepCount(j)
  return (
    <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
      <span className="shrink-0">{share !== null ? `${bytes(j.done)} / ${bytes(j.total)}` : t('step {at} of {of}', { at, of })}</span>
      {rate !== null && (
        <span className="ml-auto truncate text-right">
          {rateWords(rate)}
          {left !== null && <span className="@max-[15rem]/job:hidden"> · {leftWords(left)}</span>}
        </span>
      )}
    </span>
  )
}

/** A move's halves in words: "Pull to Home ✓ ▸ Push to lima-dev". */
function Halves({ job: j }: { job: StorageJob }) {
  const half = halfOf(j)
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={cn('inline-flex shrink-0 items-center gap-1', half === 0 && 'text-foreground/85')}>
        {t('Pull to Home')}
        {half === 1 && <Check className="size-3 text-emerald-600" />}
      </span>
      <span aria-hidden="true" className="text-faint">▸</span>
      <span className={cn('truncate', half === 1 && 'text-foreground/85')}>{t('Push to {place}', { place: place(j.target) })}</span>
    </span>
  )
}

interface PanelProps {
  job: StorageJob
  /** Starts the same job again (a move whose push failed: its push). */
  onRetry?: () => void
  /** Opens the Store's page, where the job's steps and refusal show in full. */
  onDetails?: () => void
}

/** A card's footer while a job runs or just ended. */
export function JobPanel({ job: j, onRetry, onDetails }: PanelProps) {
  useI18n()
  useNow(5000)
  if (!j.ended)
    return (
      <div role="status" aria-label={doingWords(j)} className="@container/job flex min-w-0 flex-col gap-1.5">
        <span className="flex min-w-0 items-baseline gap-2 text-xs">
          <span className="truncate font-medium text-foreground/85">{doingWords(j)}</span>
          <span className="ml-auto shrink-0 text-muted-foreground">{j.kind === 'move' ? t('{n} of 2', { n: (halfOf(j) ?? 0) + 1 }) : stepWords(j.phase)}</span>
        </span>
        {j.kind === 'move' && <Halves job={j} />}
        <JobBar job={j} />
        <Measures job={j} />
      </div>
    )
  if (!j.error)
    return (
      <div role="status" className="flex min-w-0 flex-col gap-0.5 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          <Check className="size-3.5 shrink-0 text-emerald-600" />
          <span className="truncate font-medium text-foreground/85">{endedWords(j)}</span>
          <span className="shrink-0 text-muted-foreground">· {ago(j.ended)}</span>
          {j.total != null && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">{bytes(j.total)}</span>}
        </span>
        <span className="pl-5 text-[11px] text-muted-foreground">{t('took {time}', { time: tookWords(j.ended - j.started) })}</span>
      </div>
    )
  const pulled = j.error.note === 'pulled'
  return (
    <div role="alert" className="flex min-w-0 flex-col gap-1 text-xs">
      {pulled && (
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Check className="size-3.5 shrink-0 text-emerald-600" />
          {t('Pulled to Home')}
        </span>
      )}
      <span className="flex min-w-0 items-center gap-1.5">
        <X className="size-3.5 shrink-0 text-destructive" />
        <span className="truncate font-medium text-destructive">{pulled ? t('Push to {place} failed in {phase}', { place: place(j.target), phase: j.error.phase ?? t('an unknown phase') }) : endedWords(j)}</span>
        <button type="button" onClick={() => dismissJob(j.id)} aria-label={t('Dismiss')} title={t('Dismiss')} className="relative z-10 -my-1 -mr-1 ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-3.5" />
        </button>
      </span>
      <p className="line-clamp-2 pl-5 text-[11px] break-words text-muted-foreground" title={j.error.message}>
        <span className="font-semibold text-foreground/80">{j.error.code}</span>: {j.error.message}
      </p>
      <span className="relative z-10 flex flex-wrap items-center gap-1.5 pt-1 pl-5">
        {onRetry && (
          <Button size="xs" variant="outline" className="rounded-lg" onClick={onRetry}>
            {pulled ? t('Push to {place} again', { place: place(j.target) }) : t('Try again')}
          </Button>
        )}
        {onDetails && (
          <Button size="xs" variant="ghost" className="rounded-lg" onClick={onDetails}>
            {t('Details')}
          </Button>
        )}
      </span>
    </div>
  )
}

/** An operation LayerFS records on a Store that this window did not start (the CLI's, another window's). */
export function OpPanel({ store: s }: { store: StoreRow }) {
  useI18n()
  useNow(30_000)
  const op = s.op!
  const words = op.name === 'store.push' ? t('Being pushed by another client') : op.name === 'store.pull' ? t('Being pulled by another client') : op.name.startsWith('backup.') ? t('Being backed up by another client') : t('Busy: {op}', { op: opWords(op) ?? '' })
  return (
    <div role="status" className="flex min-w-0 flex-col gap-1.5 text-xs">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate font-medium text-foreground/85">{words}</span>
        {op.phase && <span className="ml-auto shrink-0 text-muted-foreground">{stepWords(op.phase)}</span>}
      </span>
      <span aria-hidden="true" className="job-now block h-1.5 rounded-full" />
      {op.started != null && <span className="text-[11px] text-muted-foreground">{t('started {when}', { when: ago(op.started) })}</span>}
    </div>
  )
}

/** A Store page's view of its job: each step with its state and how long it took (as this window saw it). */
export function JobSteps({ job: j, onRetry }: PanelProps) {
  useI18n()
  const now = useNow(1000)
  const halves = j.kind === 'move' ? ([0, 1] as const) : ([null] as const)
  const groups = barOf(j)
  const share = stepShare(j)
  const rate = share !== null ? rateOf(samplesOf(j.id)) : null
  const left = secondsLeft(j, rate)
  return (
    <section aria-label={doingWords(j)} className="glass-liquid flex min-w-0 flex-col gap-3 rounded-2xl p-4 text-xs">
      <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-semibold tracking-tight">{j.ended ? endedWords(j) : doingWords(j)}</h3>
        <span className="text-muted-foreground">{j.ended ? t('took {time}', { time: tookWords(j.ended - j.started) }) : t('for {time}', { time: tookWords(now - j.started) })}</span>
        {rate !== null && (
          <span className="ml-auto text-muted-foreground tabular-nums">
            {rateWords(rate)}
            {left !== null && ` · ${leftWords(left)}`}
          </span>
        )}
      </header>
      <div className={cn('grid gap-4', halves.length === 2 && '@min-[40rem]/storage:grid-cols-2')}>
        {halves.map((h, g) => (
          <ol key={g} className="flex flex-col gap-1">
            {h !== null && <li className="pb-1 text-[11px] font-medium text-muted-foreground">{h === 0 ? t('1 of 2: pull to Home') : t('2 of 2: push to {place}', { place: place(j.target) })}</li>}
            {groups[g].map((s, i) => {
              const started = h === null || h === halfOf(j) ? stepSeen(j, s.step) : undefined
              const next = groups[g][i + 1]
              const ended = next && (h === null || h === halfOf(j)) ? stepSeen(j, next.step) : undefined
              return (
                <li key={s.step} className="grid min-h-6 grid-cols-[1rem_6rem_minmax(0,1fr)_auto] items-center gap-2">
                  <StepMark state={s.state} />
                  <span className={cn(s.state === 'todo' ? 'text-muted-foreground' : 'text-foreground/85', s.state === 'failed' && 'text-destructive')}>{s.step}</span>
                  {s.state === 'now' && s.share !== null ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <SegmentBar s={{ ...s, weight: 1 }} />
                    </span>
                  ) : (
                    <span />
                  )}
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {s.state === 'now' && s.share !== null ? `${bytes(j.done)} / ${bytes(j.total)}` : s.state === 'done' && started && ended ? tookWords(ended - started) : s.state === 'now' && started ? tookWords(now - started) : ''}
                  </span>
                </li>
              )
            })}
          </ol>
        ))}
      </div>
      {j.error && (
        <div className="flex flex-col gap-2 border-t border-foreground/[0.06] pt-3">
          <Refusal error={j.error} className="text-destructive" />
          <span className="flex items-center gap-1.5">
            {onRetry && (
              <Button size="xs" variant="outline" className="rounded-lg" onClick={onRetry}>
                {j.error.note === 'pulled' ? t('Push to {place} again', { place: place(j.target) }) : t('Try again')}
              </Button>
            )}
            <Button size="xs" variant="ghost" className="rounded-lg text-muted-foreground" onClick={() => dismissJob(j.id)}>
              {t('Dismiss')}
            </Button>
          </span>
        </div>
      )}
    </section>
  )
}

function StepMark({ state }: { state: Segment['state'] }) {
  if (state === 'done') return <Check aria-label={t('done')} className="size-3.5 text-emerald-600" />
  if (state === 'failed') return <X aria-label={t('failed')} className="size-3.5 text-destructive" />
  if (state === 'now') return <LoaderCircle aria-label={t('running')} className="size-3.5 animate-spin text-primary" />
  return <span aria-label={t('to come')} className="ml-[3px] size-2 rounded-full ring-1 ring-foreground/25 ring-inset" />
}

const KIND = { push: 'Push', pull: 'Pull', move: 'Move', backup: 'Backup', restore: 'Restore' } as const

/** A job's route in words: `Home → docker`, `r2/shop.lfs → Home`. */
export function routeWords(j: StorageJob): string {
  if (j.kind === 'pull') return `${place(j.from)} → ${t('Home')}`
  if (j.kind === 'move') return `${place(j.from)} → ${place(j.target)}`
  if (j.kind === 'backup') return `→ ${j.target}${j.file ? `/${j.file}` : ''}`
  if (j.kind === 'restore') return `${j.target}${j.file ? `/${j.file}` : ''} → ${t('Home')}`
  return `${t('Home')} → ${place(j.target)}`
}

/** A Store page's jobs this session: newest first; a failure opens to its refusal. */
export function JobActivity({ jobs }: { jobs: StorageJob[] }) {
  useI18n()
  const now = useNow(5000)
  const [open, setOpen] = useState<string | null>(null)
  if (!jobs.length) return null
  return (
    <section aria-labelledby="store-activity" className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2.5 px-1">
        <h2 id="store-activity" className="text-[13px] font-semibold tracking-tight">
          {t('Activity')}
        </h2>
        <span className="text-xs text-muted-foreground">{t('this session')}</span>
      </div>
      <ul className="glass-liquid flex flex-col divide-y divide-foreground/[0.05] rounded-2xl text-xs">
        {jobs.map((j) => {
          const failed = !!j.error
          return (
            <li key={j.id} className="flex min-w-0 flex-col gap-1.5 px-4 py-2">
              <span className="grid min-w-0 grid-cols-[1rem_4.5rem_minmax(0,1fr)_auto] items-center gap-2 @max-[30rem]/storage:grid-cols-[1rem_4.5rem_minmax(0,1fr)]">
                {!j.ended ? <LoaderCircle className="size-3.5 animate-spin text-primary" /> : failed ? <X className="size-3.5 text-destructive" /> : <Check className="size-3.5 text-emerald-600" />}
                <span className="font-medium text-foreground/85">{t(KIND[j.kind])}</span>
                <span className="truncate font-mono text-[11.5px] text-muted-foreground">{routeWords(j)}</span>
                <span className="flex items-center gap-2 text-muted-foreground tabular-nums @max-[30rem]/storage:col-start-3">
                  {j.total != null && <span>{bytes(j.total)}</span>}
                  <span className={cn(failed && 'text-destructive')}>
                    {!j.ended ? t('running · {time}', { time: tookWords(now - j.started) }) : failed ? t('failed in {phase}', { phase: j.error!.phase ?? t('an unknown phase') }) : t('took {time}', { time: tookWords(j.ended - j.started) })}
                  </span>
                  <span className="text-faint">{new Date(j.started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {failed && (
                    <button type="button" aria-expanded={open === j.id} aria-label={t('Show why')} onClick={() => setOpen(open === j.id ? null : j.id)} className="rounded-md p-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      <ChevronDown className={cn('size-3.5 transition-transform', open !== j.id && '-rotate-90')} />
                    </button>
                  )}
                </span>
              </span>
              {failed && open === j.id && <Refusal error={j.error} compact className="pl-6 text-destructive" />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Scrolls to a Store's card and rings it once. */
export function flashStore(store: string) {
  const el = document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(`store:${store}`)}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('live-flash')
  void el.offsetWidth
  el.classList.add('live-flash')
}

/** The Storage header's mark: how many jobs run, else how many failed; it shows the first such card. */
export function JobsChip({ running, failed, onShow }: { running: number; failed: number; onShow?: () => void }) {
  useI18n()
  if (!running && !failed) return null
  const bad = !running
  return (
    <button
      type="button"
      onClick={onShow}
      className={cn('ml-2 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 outline-none ring-inset focus-visible:ring-2 focus-visible:ring-ring', bad ? 'bg-destructive/10 text-destructive ring-destructive/25' : 'bg-primary/10 text-primary ring-primary/25')}
      title={bad ? t('Show the Store whose job failed') : t('Show the Store with a running job')}
    >
      {bad ? <X className="size-3.5" /> : <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />}
      {bad ? t(failed === 1 ? '1 failed' : '{n} failed', { n: failed }) : t('{n} running', { n: running })}
      {!bad && failed > 0 && <span className="text-destructive">· {t('{n} failed', { n: failed })}</span>}
    </button>
  )
}

/** A small chip for a Store being moved onto or off a machine: a thin bar and the verb. */
export function JobChip({ job: j, className }: { job: StorageJob; className?: string }) {
  useI18n()
  const share = stepShare(j)
  const verb = j.kind === 'pull' || (j.kind === 'move' && halfOf(j) === 0) ? 'pulling…' : j.kind === 'backup' ? 'backing up…' : j.kind === 'restore' ? 'restoring…' : 'pushing…'
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 text-[11px] text-primary', className)} title={`${doingWords(j)} · ${stepWords(j.phase)}`}>
      <span className="relative block h-1 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
        {share !== null ? <span className="sc-bar-brand absolute inset-y-0 left-0" style={{ width: `${share * 100}%` }} /> : <span className="job-now absolute inset-0" />}
      </span>
      {t(verb)}
    </span>
  )
}
