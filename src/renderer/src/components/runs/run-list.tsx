// Project > Sessions: the project's scenario runs, newest first, each a row
// that opens its run page. A playing run can be stopped; an ended one deleted
// (its saved record and traces; the project and its history stay).
import './run-list.css'

import type { RunSummary } from '@shared/host-api'
import { ChevronRight, Hourglass, LoaderCircle, PlayCircle, Square, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { revealStyle } from '@/components/motion/reveal'
import { spotlight } from '@/components/motion/spotlight'
import { Empty, LoadError } from '@/components/projects/states'
import { RunDot } from '@/components/runs/run-badges'
import { RUN_LABEL, agentColors, ago, clock, duration, isLive, plural, runName } from '@/components/runs/run-format'
import { useNow } from '@/components/runs/use-run'
import { Chip } from '@/components/storage/chips'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { host } from '@/host/client'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface RunListProps {
  runs: RunSummary[] | undefined
  error: Error | undefined
  reload: () => void
  onOpenRun: (runId: string) => void
  /** A scenario's title by id, for the line under a run's name. */
  titleOf?: (demo: string) => string | undefined
  /** The empty list's action: the Play scenario picker. */
  action?: React.ReactNode
}

const COLS = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 @min-[44rem]/runs:grid-cols-[minmax(0,1fr)_6rem_5rem_9.5rem_4rem_auto]'
const HEAD = 'text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'
const WIDE = 'hidden @min-[44rem]/runs:block'

/** A project's scenario runs, newest first. */
export function RunList({ runs, error, reload, onOpenRun, titleOf, action }: RunListProps) {
  useI18n()
  const playing = runs?.filter((r) => isLive(r.state)).length ?? 0
  const now = useNow(playing > 0)
  // one colour per agent name across the project's runs
  const colorOf = useMemo(() => agentColors((runs ?? []).flatMap((r) => r.agents.map((a) => a.name))), [runs])

  return (
    <section aria-label={t('Sessions')} onPointerMove={spotlight} className="glass-liquid spotlight reveal @container/runs overflow-hidden rounded-2xl">
      <header className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">{t('Sessions')}</h2>
        {runs && <span className="rounded-full bg-foreground/[0.05] px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">{runs.length}</span>}
        {playing > 0 && (
          <Chip tone="info" live>
            {t('{n} playing', { n: playing })}
          </Chip>
        )}
      </header>

      {error && !runs ? (
        <LoadError error={error} what={t('the sessions')} onRetry={reload} className="mx-5 mb-5" />
      ) : !runs ? (
        <div aria-busy="true" aria-label={t('Loading sessions')} className="flex flex-col gap-2 px-5 pb-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="reveal h-11 rounded-xl" style={revealStyle(i)} />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <Empty icon={PlayCircle} title={t('No sessions yet')} action={action} className="mx-5 mb-5 rounded-2xl">
          {t('A session plays a scenario’s agents on this project, in a folder of its own, on the real LayerFS backend.')}
        </Empty>
      ) : (
        <>
          <div aria-hidden="true" className={cn(COLS, 'border-y border-foreground/[0.06] bg-foreground/[0.02] px-5 py-2')}>
            <span className={HEAD}>{t('Session')}</span>
            <span className={cn(HEAD, WIDE)}>{t('Started')}</span>
            <span className={cn(HEAD, WIDE)}>{t('Duration')}</span>
            <span className={cn(HEAD, WIDE)}>{t('Steps')}</span>
            <span className={cn(HEAD, WIDE)}>{t('Agents')}</span>
            <span />
          </div>
          <ol>
            {runs.map((run, i) => (
              <RunRow key={run.id} run={run} index={i} now={now} colorOf={colorOf} title={titleOf?.(run.demo)} onOpen={() => onOpenRun(run.id)} />
            ))}
          </ol>
        </>
      )}
    </section>
  )
}

interface RunRowProps {
  run: RunSummary
  index: number
  now: number
  colorOf: ReturnType<typeof agentColors>
  title: string | undefined
  onOpen: () => void
}

/** At most this many agent dots in a row. */
const DOTS = 6

function RunRow({ run, index, now, colorOf, title, onOpen }: RunRowProps) {
  const live = isLive(run.state)
  const share = run.of ? Math.min(1, Math.max(0, run.done / run.of)) : 0
  const [busy, setBusy] = useState<'stop' | 'delete' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState('')
  const act = async (what: 'stop' | 'delete') => {
    setBusy(what)
    setFailure('')
    try {
      if (what === 'stop') await host.stopRun(run.id)
      else await host.removeRun(run.id)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setConfirming(false)
    }
  }
  const status = run.queued ? (
    <Chip tone="neutral" icon={Hourglass}>
      {t('Queued')}
    </Chip>
  ) : live || run.state === 'stopped' ? (
    <span className={cn('text-xs', live ? 'text-primary' : 'text-warning')}>{t(RUN_LABEL[run.state])}</span>
  ) : null
  const sub = [title ?? run.demo, live && run.phase ? run.phase : null].filter(Boolean).join(' · ')

  return (
    <li data-live={(live && !run.queued) || undefined} style={revealStyle(index)} className="run-row reveal border-b border-foreground/[0.05] last:border-b-0">
      <div className={cn(COLS, 'px-5 py-2.5 transition-colors hover:bg-foreground/[0.02]')}>
        <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <RunDot state={run.state} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-[13px] font-medium text-foreground">{runName(run)}</span>
              {status}
            </span>
            <span className="block truncate text-xs text-muted-foreground" title={run.queued ? (run.phase ?? undefined) : undefined}>
              {sub}
            </span>
          </span>
        </button>
        <span className={cn(WIDE, 'text-[13px] text-muted-foreground tabular-nums')} title={clock(run.started)}>
          {ago(run.started, now)}
        </span>
        <span className={cn(WIDE, 'text-[13px] tabular-nums', live ? 'text-foreground' : 'text-muted-foreground')}>{run.queued ? '–' : duration((run.ended ?? now) - run.started)}</span>
        <span className={WIDE}>
          {run.of ? (
            <span className="flex items-center gap-2.5" title={t('{done} of {total}', { done: run.done, total: plural(run.of, 'step') })}>
              <span
                role="progressbar"
                aria-label={t('{name} steps', { name: runName(run) })}
                aria-valuemin={0}
                aria-valuemax={run.of}
                aria-valuenow={run.done}
                className="run-bar"
                data-tone={live ? 'live' : run.state === 'stopped' ? 'stopped' : 'ended'}
              >
                <span style={{ transform: `scaleX(${share})` }} />
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                <span className={cn(live && 'font-medium text-foreground')}>{run.done}</span>/{run.of}
              </span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground tabular-nums">{plural(run.done, 'step')}</span>
          )}
        </span>
        <span className={WIDE}>
          {run.agents.length > 0 ? (
            <span className="flex items-center gap-2" title={run.agents.map((a) => a.name).join(', ')}>
              <span aria-hidden="true" className="run-agents flex">
                {run.agents.slice(0, DOTS).map((a) => (
                  <span key={a.name} className={cn('size-2.5 rounded-full', colorOf(a.name).dot)} />
                ))}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{run.agents.length}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">–</span>
          )}
        </span>
        <span className="flex items-center justify-end gap-1">
          {live ? (
            <Button variant="ghost" size="sm" className="h-7 rounded-xl px-2 text-xs text-muted-foreground" disabled={busy !== null} onClick={() => void act('stop')} title={t('Stop this session')}>
              {busy === 'stop' ? <LoaderCircle className="animate-spin" /> : <Square className="size-3" />}
              {t('Stop')}
            </Button>
          ) : confirming ? (
            <>
              <Button variant="destructive" size="sm" className="h-7 rounded-xl px-2 text-xs" disabled={busy !== null} onClick={() => void act('delete')}>
                {busy === 'delete' ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                {t('Delete')}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 rounded-xl px-2 text-xs" disabled={busy !== null} onClick={() => setConfirming(false)}>
                {t('Cancel')}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={t('Delete session {name}', { name: runName(run) })}
              title={t('Delete this session’s record and traces; the project and its history stay')}
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={onOpen} className="run-open flex size-7 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-4" />
          </button>
        </span>
      </div>
      {failure && (
        <p role="alert" className="mx-5 mb-2.5 rounded-xl bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
          {failure}
        </p>
      )}
    </li>
  )
}
