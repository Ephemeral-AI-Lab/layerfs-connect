import { fill } from '@/lib/text'
// Storage's operations tray: the moves, backups and restores this host started
// (live, or ended in the last minutes) and the operations LayerFS records on
// Stores this host is not running a job on (the CLI's too).

import { Refusal } from '@/components/layerfs/Refusal'
import { StateChip } from '@/components/layerfs/StateChip'
import { Chip } from '@/components/layerfs/Chips'
import { Bar } from '@/pages/storage/Meters'
import { ago, bytes } from '@/layerfs/format'
import { clearingCall, opWords } from '@/layerfs/states'
import type { StorageJob, StoreRow } from '@/layerfs/host-api'

/** How long an ended job stays in the tray. */
const RECENT_MS = 15 * 60e3

/** The jobs worth showing: running, or ended within RECENT_MS. */
export const trayJobs = (jobs: StorageJob[], now = Date.now()) => jobs.filter((j) => !j.ended || now - j.ended < RECENT_MS).slice(0, 8)

/** A running job's share done, when its call gives a total. */
export const jobShare = (j: StorageJob) => (j.total && !j.ended ? Math.min(1, (j.done ?? 0) / j.total) : null)

export function Operations({ jobs, stores }: { jobs: StorageJob[]; stores: StoreRow[] }) {
  const recorded = stores.filter((s) => s.op && ['busy', 'unresolved'].includes(s.state) && !jobs.some((j) => j.store === s.name && !j.ended))
  if (!jobs.length && !recorded.length) return null
  return (
    <section aria-label={'Operations'} className="glass-liquid reveal flex flex-col divide-y divide-foreground/[0.05] rounded-2xl text-sm shadow-xs">
      {recorded.map((s) => (
        <OpRow key={s.name} store={s} />
      ))}
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
    </section>
  )
}

/** An operation LayerFS records on a Store that this host did not start (or no longer tracks): a push from the CLI, an unresolved one. */
function OpRow({ store: s }: { store: StoreRow }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <StateChip entity="store" state={s.state} />
        <span className="font-mono">{s.name}</span>
        <span className="text-muted-foreground">{opWords(s.op)}</span>
        {s.op?.started && <span className="ml-auto text-muted-foreground">{`started ${ago(s.op.started)}`}</span>}
      </div>
      {s.state === 'unresolved' && <p className="font-mono text-xs text-destructive">{fill('see {status} · clear: {clear}', clearingCall('store', s.name, s.op))}</p>}
    </div>
  )
}

export const KIND = { push: 'Push', pull: 'Pull', move: 'Move', backup: 'Backup', restore: 'Restore' } as const

/** A job's route: `shop → ui535-ac`, `shop ← r2/shop.lfs`. */
export const jobRoute = (j: StorageJob) => `${j.store} ${j.kind === 'restore' || j.kind === 'pull' ? '←' : '→'} ${j.kind === 'pull' ? (j.from ?? j.target) : j.target}${j.file ? `/${j.file}` : ''}`

/** A job this host started: its phase, done/total where the call gives it, and how it ended. */
function JobRow({ job: j }: { job: StorageJob }) {
  const running = !j.ended
  const share = jobShare(j)
  return (
    <div className="flex flex-col gap-1.5 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={j.error ? 'danger' : running ? 'info' : 'success'} live={running}>
          {KIND[j.kind]}
        </Chip>
        <span className="font-mono">{jobRoute(j)}</span>
        {j.kind === 'move' && j.half && <span className="text-muted-foreground">{fill(j.half === 'pull' ? '1 of 2: pull to home' : '2 of 2: push to {machine}', { machine: j.target })}</span>}
        <span className="text-muted-foreground">{j.error ? `failed in ${j.error.phase ?? 'an unknown phase'}` : running ? (j.phase ?? 'starting') : `done ${ago(j.ended)}`}</span>
        {share !== null && (
          <span className="ml-auto flex min-w-40 items-center gap-2 tabular-nums text-muted-foreground">
            <Bar share={share} live className="flex-1" />
            {bytes(j.done)} / {bytes(j.total)}
          </span>
        )}
      </div>
      {j.error && <Refusal error={j.error} className="text-destructive" />}

    </div>
  )
}
