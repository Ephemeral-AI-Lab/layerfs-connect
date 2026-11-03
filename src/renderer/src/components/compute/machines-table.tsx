import { t, useI18n } from '@/i18n'
// The Machines table (docs/ui/layerfs-compute.md): native and docker first,
// then the VMs and ssh hosts. A row opens to the Stores it holds (each can
// move to another machine), its Sandboxes, its facts and what can be done
// with it: remove a VM or disconnect an ssh host (refused while it holds
// Stores or Sandboxes), or update a built-in's settings.
import { ArrowRightLeft, ChevronRight, Lock, Power } from 'lucide-react'
import { useState } from 'react'

import { go } from '@/components/tabs/go'
import { Fact, KindLabel } from '@/components/compute/target-parts'
import { StateChip } from '@/components/state-chip'
import { Refusal } from '@/components/refusal'
import { Collapse, revealStyle } from '@/components/motion'
import { Card } from '@/components/storage/overview/row-parts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { BUILT_IN, downReason, gib, inUse, kindLabel, machineOrder, machineState, moveTargets, type Os, sizeOf } from '@/data/compute'
import type { MachineAction } from '@/data/compute-sim'
import { bytes, shortDigest } from '@/data/format'
import { cn } from '@/lib/utils'
import type { MachineInfo, MachinesView } from '@shared/host-api'

type Available = Extract<MachinesView, { available: true }>

/** Columns: Machine, Platform, State, Size, Stores, Sandboxes, the opener. */
const COLS = '@min-[46rem]/machines:grid-cols-[minmax(0,1.15fr)_minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1.35fr)_3.75rem_5rem_1rem]'

interface Props {
  view: Available
  os: Os
  open: string | null
  onOpen: (name: string | null) => void
  /** Runs an action; it rejects with LayerFS's refusal. */
  act: (action: MachineAction) => Promise<void>
}

export function MachinesTable({ view, os, open, onOpen, act }: Props) {
  useI18n()
  const machines = machineOrder(view.machines)
  return (
    <Card index={2} className="@container/machines overflow-hidden" aria-label={t('Machines')}>
      <div role="row" className={cn('hidden gap-x-3 border-b px-4 py-2 text-[11px] font-medium text-faint @min-[46rem]/machines:grid', COLS)}>
        <span role="columnheader">{t('Machine')}</span>
        <span role="columnheader">{t('Platform')}</span>
        <span role="columnheader">{t('State')}</span>
        <span role="columnheader">{t('Size')}</span>
        <span role="columnheader" className="text-right">
          {t('Stores')}
        </span>
        <span role="columnheader" className="text-right">
          {t('Sandboxes')}
        </span>
        <span />
      </div>
      {machines.map((m, i) => {
        const live = view.status[m.name]
        const state = machineState(m, live)
        const size = sizeOf(m, os, live)
        const expanded = open === m.name
        return (
          <div key={m.name} id={`machine-${m.name}`} data-focus={`machine:${m.name}`} className={cn('reveal scroll-mt-24', i > 0 && 'border-t', expanded && 'bg-muted/25')} style={revealStyle(i + 3)}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => onOpen(expanded ? null : m.name)}
              className={cn(
                'grid w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left outline-none hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                COLS,
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <KindLabel platform={m.platform} os={os} hideName className="@min-[46rem]/machines:hidden" />
                <span className="truncate text-[13.5px] font-semibold tracking-tight">{m.name}</span>
              </span>
              <KindLabel platform={m.platform} os={os} className="hidden @min-[46rem]/machines:inline-flex" />
              <span className="justify-self-end @min-[46rem]/machines:justify-self-start">
                <StateChip entity="machine" state={state.state} op={state.op} />
              </span>
              <span className="hidden truncate text-[13px] text-muted-foreground tabular-nums @min-[46rem]/machines:block">{t(size.text, size.values)}</span>
              <span className="hidden text-right text-[13px] tabular-nums @min-[46rem]/machines:block">{m.stores.length}</span>
              <span className="hidden text-right text-[13px] tabular-nums @min-[46rem]/machines:block">{m.sandboxes.length}</span>
              <ChevronRight aria-hidden="true" className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
              {/* narrow: kind, size and counts on a second line */}
              <span className="col-span-3 truncate text-xs text-muted-foreground tabular-nums @min-[46rem]/machines:hidden">
                {[t(kindLabel(m.platform)), t(size.text, size.values), t(m.stores.length === 1 ? '1 Store' : '{n} Stores', { n: m.stores.length }), t(m.sandboxes.length === 1 ? '1 Sandbox' : '{n} Sandboxes', { n: m.sandboxes.length })].join(' · ')}
              </span>
            </button>
            <Collapse open={expanded} appear={false}>
              <MachineDetail m={m} view={view} os={os} act={act} />
            </Collapse>
          </div>
        )
      })}
    </Card>
  )
}


function MachineDetail({ m, view, os, act }: { m: MachineInfo; view: Available; os: Os; act: Props['act'] }) {
  useI18n()
  const live = view.status[m.name]
  const reason = downReason(m, live)
  const stores = view.stores.filter((s) => s.machine === m.name)
  // a store.list() that omits one still shows its name from the machine
  const storeRows = m.stores.map((name) => stores.find((s) => s.name === name) ?? { name, machine: m.name, projects: null as number | null, size: null as number | null })
  const sandboxes = view.sandboxes.filter((b) => b.machine === m.name)
  const sandboxRows = m.sandboxes.map((name) => sandboxes.find((b) => b.name === name) ?? { name, machine: m.name, project: null, workspaces: 0 })
  const targets = moveTargets(view, m.name)
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState<string | null>(null)
  const run = async (key: string, action: MachineAction) => {
    setPending(key)
    setError(null)
    try {
      await act(action)
    } catch (e) {
      setError(e)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-1 pb-4 @min-[46rem]/machines:pl-[2.75rem]">
      {reason && <p className="text-xs break-words text-destructive">{reason}</p>}

      <div className="grid grid-cols-1 gap-4 @min-[40rem]/machines:grid-cols-2">
        <section aria-label={t('Stores on {machine}', { machine: m.name })} className="min-w-0">
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{t('Stores on it')}</h3>
          {storeRows.length === 0 ? (
            <p className="text-xs text-faint">{t('No Stores. Push one here from native.')}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl bg-card/60 ring-1 ring-foreground/8">
              {storeRows.map((s) => (
                <li key={s.name} className="flex min-w-0 items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1">
                    {/* the Store's row on Storage; its projects' pages (#537 §7) */}
                    <button type="button" className="block max-w-full truncate text-left text-[13px] font-medium underline-offset-2 hover:underline" title={t('Show {store} on Storage', { store: s.name })} onClick={() => go.store(s.name)}>
                      {s.name}
                    </button>
                    {'names' in s && s.names && s.names.length > 0 && (
                      <span className="flex min-w-0 flex-wrap gap-x-2 text-xs">
                        {s.names.map((p) => (
                          <button key={p} type="button" className="truncate font-mono text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => go.project(`${s.name}/${p}`)}>
                            {p}
                          </button>
                        ))}
                      </span>
                    )}
                    <span className="block truncate text-xs text-muted-foreground tabular-nums">
                      {[s.projects !== null && t(s.projects === 1 ? '1 project' : '{n} projects', { n: s.projects }), s.size !== null && bytes(s.size)].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-7 shrink-0 rounded-lg px-2 text-xs" disabled={pending !== null || (m.name === 'native' && targets.length === 0)}>
                        <ArrowRightLeft className="size-3.5" />
                        {pending === `move:${s.name}` ? t('Starting…') : t(m.name === 'native' ? 'Push to…' : 'Pull or move…')}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {m.name !== 'native' && (
                        <DropdownMenuItem onSelect={() => void run(`move:${s.name}`, { kind: 'move', store: s.name, machine: 'native' })}>
                          <span>{t('Pull to native')}</span>
                        </DropdownMenuItem>
                      )}
                      {targets.length > 0 && <DropdownMenuLabel className="text-xs">{t(m.name === 'native' ? 'Push {store} to' : 'Move {store} to (pull, then push)', { store: s.name })}</DropdownMenuLabel>}
                      {targets.map((x) => (
                        <DropdownMenuItem key={x.name} onSelect={() => void run(`move:${s.name}`, { kind: 'move', store: s.name, machine: x.name })}>
                          <KindLabel platform={x.platform} os={os} hideName />
                          <span>{x.name}</span>
                          <span className="ml-auto pl-3 text-xs text-muted-foreground">{t(kindLabel(x.platform))}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label={t('Sandboxes on {machine}', { machine: m.name })} className="min-w-0">
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{t('Sandboxes')}</h3>
          {sandboxRows.length === 0 ? (
            <p className="text-xs text-faint">{m.platform === 'native' && os === 'win32' ? t('Native on Windows keeps records only; Sandboxes run on docker.') : t('No Sandboxes running.')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sandboxRows.map((b, i) => (
                <li key={`${b.name}-${i}`} className="truncate text-[13px] tabular-nums">
                  <span className="font-medium">{t('Sandbox {name}', { name: b.name })}</span>
                  <span className="text-muted-foreground">
                    {b.project ? ` · ${b.project}` : ''}
                    {b.workspaces != null && <> · {t(b.workspaces === 1 ? '1 Workspace' : '{n} Workspaces', { n: b.workspaces })}</>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 @min-[40rem]/machines:grid-cols-4">
        {live?.toolVersion && <Fact label={t('Tool')}>{live.toolVersion}</Fact>}
        {live?.freeDisk != null && <Fact label={t('Free disk')}>{gib(live.freeDisk)}</Fact>}
        {m.image && (
          <Fact label={t('Sandbox image')} mono>
            <span title={m.image}>{m.image.startsWith('/') ? m.image : shortDigest(m.image)}</span>
          </Fact>
        )}
        {'os_image' in m && typeof (m as { os_image?: unknown }).os_image === 'string' && (
          <Fact label={t('OS image')} mono>
            {(m as { os_image: string }).os_image}
          </Fact>
        )}
        {m.host && <Fact label={t('Lima host')}>{m.host}</Fact>}
        {m.nested && <Fact label={t('Nested')}>{t('Can host Firecracker machines')}</Fact>}
        {m.ssh && (
          <>
            <Fact label={t('SSH host')} mono>
              {`${m.ssh.user}@${m.ssh.host}${m.ssh.port !== 22 ? `:${m.ssh.port}` : ''}`}
            </Fact>
            <Fact label={t('Data root')} mono>
              {m.ssh.root ?? '/layerfs/data'}
            </Fact>
            {m.ssh.identity && (
              <Fact label={t('Identity')} mono>
                {m.ssh.identity}
              </Fact>
            )}
          </>
        )}
        {m.docker && (
          <Fact label={t('Docker socket')} mono>
            {m.docker}
          </Fact>
        )}
        {m.wsl && <Fact label={t('WSL distribution')}>{m.wsl}</Fact>}
        <Fact label={t('Sandboxes run as')}>{t(m.backend === 'docker' ? 'Containers' : m.backend === 'native' ? 'Processes, not isolated' : 'Linux namespaces')}</Fact>
      </dl>

      {m.platform !== 'native' && <PowerAction m={m} pending={pending} run={run} />}
      {BUILT_IN.has(m.platform) ? <BuiltInActions m={m} os={os} pending={pending} run={run} /> : <RemoveAction m={m} pending={pending} run={run} />}
      {error !== null && <Refusal error={error} className="text-destructive" />}
    </div>
  )
}

/**
 * Start and Stop (#535 D11): a machine runs only between them. Start waits
 * until its worker answers; Stop is refused InUse while Sandboxes run on it,
 * the refusal naming them.
 */
function PowerAction({ m, pending, run }: { m: MachineInfo; pending: string | null; run: (key: string, a: MachineAction) => Promise<void> }) {
  useI18n()
  const running = m.state === 'running'
  const stopped = m.state === 'stopped'
  if (!running && !stopped) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{t(running ? '{name} is running.' : '{name} is stopped: its Stores and Sandboxes can’t be used until it starts.', { name: m.name })}</span>
      <Button size="sm" variant={running ? 'outline' : 'default'} className="h-7 rounded-lg px-2.5 text-xs" disabled={pending !== null} onClick={() => void run(running ? 'stop' : 'start', { kind: running ? 'stop' : 'start', name: m.name })}>
        <Power className="size-3.5" />
        {pending === 'start' ? t('Starting…') : pending === 'stop' ? t('Stopping…') : t(running ? 'Stop' : 'Start')}
      </Button>
    </div>
  )
}

function RemoveAction({ m, pending, run }: { m: MachineInfo; pending: string | null; run: (key: string, a: MachineAction) => Promise<void> }) {
  useI18n()
  const held = inUse(m)
  const [confirm, setConfirm] = useState(false)
  const ssh = m.platform === 'ssh'
  const verb = ssh ? 'Disconnect' : 'Remove'
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {confirm ? (
        <>
          <span className="text-xs text-foreground">{ssh ? t('Disconnect {name}? Its data root stays on the host.', { name: m.name }) : t('Remove {name} and its disk?', { name: m.name })}</span>
          <Button size="sm" variant="destructive" className="h-7 rounded-lg px-2.5 text-xs" disabled={pending !== null} onClick={() => void run('remove', { kind: 'remove', name: m.name }).then(() => setConfirm(false))}>
            {pending === 'remove' ? t(ssh ? 'Disconnecting…' : 'Removing…') : t(verb)}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2.5 text-xs" onClick={() => setConfirm(false)}>
            {t('Cancel')}
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="outline" className="h-7 rounded-lg px-2.5 text-xs text-destructive hover:text-destructive" disabled={!!held || pending !== null} onClick={() => setConfirm(true)}>
            {t(verb)}
          </Button>
          {held && (
            <span className="text-xs text-muted-foreground">
              {held.stores > 0
                ? t(held.stores === 1 ? 'In use: holds 1 Store. Pull it to native first.' : 'In use: holds {n} Stores. Pull them to native first.', { n: held.stores })
                : t('In use: Sandboxes are running on it.')}
            </span>
          )}
        </>
      )}
    </div>
  )
}

function BuiltInActions({ m, os, pending, run }: { m: MachineInfo; os: Os; pending: string | null; run: (key: string, a: MachineAction) => Promise<void> }) {
  useI18n()
  const [editing, setEditing] = useState(false)
  const [image, setImage] = useState(m.image ?? '')
  const [socket, setSocket] = useState(m.docker ?? '')
  const [wsl, setWsl] = useState(m.wsl ?? '')
  const docker = m.platform === 'docker'
  const imageBad = image !== '' && !/^sha256:[0-9a-f]{12,64}$/.test(image) && !image.startsWith('/')
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" variant="outline" className="h-7 rounded-lg px-2.5 text-xs" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {t('Update settings')}
        </Button>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock aria-hidden="true" className="size-3" />
          {t('Built in · can’t be removed')}
        </span>
      </div>
      {editing && (
        <form
          className="grid max-w-xl grid-cols-1 gap-2.5 rounded-xl bg-card/60 p-3 ring-1 ring-foreground/8 @min-[40rem]/machines:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (imageBad) return
            void run('update', { kind: 'update', name: m.name, changes: { image: image || undefined, ...(docker ? { docker: socket || undefined, wsl: wsl || undefined } : {}) } }).then(() => setEditing(false))
          }}
        >
          <Field label={t('Sandbox image')} error={imageBad ? t('A sha256: digest, or an archive’s absolute path') : null}>
            <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="sha256:…" aria-invalid={imageBad} className="h-8 font-mono text-xs" />
          </Field>
          {docker && (
            <Field label={t('Docker socket')}>
              <Input value={socket} onChange={(e) => setSocket(e.target.value)} placeholder="/var/run/docker.sock" className="h-8 font-mono text-xs" />
            </Field>
          )}
          {docker && os === 'win32' && (
            <Field label={t('WSL distribution')}>
              <Input value={wsl} onChange={(e) => setWsl(e.target.value)} placeholder="Ubuntu-24.04" className="h-8 text-xs" />
            </Field>
          )}
          <div className="flex items-end gap-2 @min-[40rem]/machines:col-span-2">
            <Button type="submit" size="sm" className="h-7 rounded-lg px-3 text-xs" disabled={pending !== null || imageBad}>
              {pending === 'update' ? t('Saving…') : t('Save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 rounded-lg px-2.5 text-xs" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

/** A form field: its label, the control, and its error under it. */
export function Field({ label, error, hint, children, className }: { label: string; error?: string | null; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </label>
  )
}
