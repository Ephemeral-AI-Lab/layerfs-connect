import { MachineProgress } from '@/pages/machines/MachineProgress'
import { useMachineProgress } from '@/layerfs/use-machine-progress'
import { useElapsed } from '@/layerfs/use-elapsed'
import { host } from '@/layerfs/client'
import { fill } from '@/lib/text'
// A machine on the Machines board (docs/ui/machines.md), and what its
// page shares with it: Start or Stop, the menu (Update settings… for the
// built-ins, Remove…, refused while it holds Stores or
// Sandboxes) and its dialogs, a Store chip linking Storage (the Stores' home:
// pushing, pulling and moving them is done there), and its facts.
import { ArrowRight, Lock, Power, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { go } from '@/layerfs/go'
import { Fact, Field, KindLabel } from '@/pages/machines/TargetParts'
import { LfsStore } from '@/components/layerfs/LfsIcons'
import { Refusal } from '@/components/layerfs/Refusal'
import { StateChip } from '@/components/layerfs/StateChip'
import { MoreButton } from '@/pages/storage/RowParts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { BUILT_IN, downReason, gib, inUse, kindLabel, machineState, type Os, storesOn } from '@/layerfs/compute'
import type { MachineAction } from '@/layerfs/machine-actions'
import { clearingCall } from '@/layerfs/states'
import { bytes, shortDigest } from '@/layerfs/format'
import { cn } from '@/lib/utils'
import type { MachineInfo, MachineLive, MachinesView } from '@/layerfs/host-api'

type Available = Extract<MachinesView, { available: true }>
export type Run = (key: string, action: MachineAction) => Promise<boolean>

/** A machine's actions: one at a time (`pending` names it), LayerFS's refusal kept to show. */
export function useMachineRun(act: (action: MachineAction) => Promise<void>) {
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState<string | null>(null)
  const run: Run = async (key, action) => {
    setPending(key)
    setError(null)
    try {
      await act(action)
      return true
    } catch (e) {
      setError(e)
      return false
    } finally {
      setPending(null)
    }
  }
  return { run, pending, error }
}

/** Start or Stop, when the machine is one that starts and is running or stopped (never native). */
export const powerOf = (m: MachineInfo) => (m.platform !== 'native' && (m.state === 'running' || m.state === 'stopped') ? (m.state === 'running' ? 'stop' : 'start') : null)

/** A Start or Stop button. */
export function PowerButton({ m, pending, run, className }: { m: MachineInfo; pending: string | null; run: Run; className?: string }) {
  const power = powerOf(m)
  const elapsed = useElapsed(pending !== null)
  if (!power) return null
  return (
    <Button size="sm" variant={power === 'stop' ? 'outline' : 'default'} className={cn('h-7 rounded-md px-2.5 text-sm', className)} disabled={pending !== null} title={fill(power === 'stop' ? '{name} is running.' : '{name} is stopped: its Stores and Sandboxes can’t be used until it starts.', { name: m.name })} onClick={() => void run(power, { kind: power, name: m.name })}>
      <Power className="size-3.5" />
      {pending === 'start' ? 'Starting…' : pending === 'stop' ? `Stopping… ${elapsed}s` : fill(m.platform === 'docker' ? power === 'stop' ? 'Stop worker' : 'Start worker' : power === 'stop' ? 'Stop' : 'Start')}
    </Button>
  )
}

/** The `…` menu: Open (on the board), Start or Stop, Update settings… (the built-ins) and Remove…, refused while it holds anything. */
export function MachineMenu({ m, pending, run, onOpen, onDialog, className }: { m: MachineInfo; pending: string | null; run: Run; onOpen?: () => void; onDialog: (d: 'settings' | 'remove') => void; className?: string }) {
  const power = powerOf(m)
  const builtIn = BUILT_IN.has(m.platform)
  const held = inUse(m)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MoreButton label={`More for ${m.name}`} className={className} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {onOpen && (
          <DropdownMenuItem onSelect={onOpen}>
            <ArrowRight />
            {'Open'}
          </DropdownMenuItem>
        )}
        {power && (
          <DropdownMenuItem disabled={pending !== null} onSelect={() => void run(power, { kind: power, name: m.name })}>
            <Power />
            {fill(m.platform === 'docker' ? power === 'stop' ? 'Stop worker' : 'Start worker' : power === 'stop' ? 'Stop' : 'Start')}
          </DropdownMenuItem>
        )}
        {builtIn ? (
          <>
            <DropdownMenuItem onSelect={() => onDialog('settings')}>
              <Settings2 />
              {'Update settings…'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5 text-sm font-normal text-muted-foreground">
              <Lock aria-hidden="true" className="size-3" />
              {'Built in · can’t be removed'}
            </DropdownMenuLabel>
          </>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={!!held || pending !== null} onSelect={() => onDialog('remove')}>
              <Trash2 />
              {'Remove…'}
            </DropdownMenuItem>
            {held && <DropdownMenuLabel className="max-w-64 text-sm font-normal text-muted-foreground">{heldWords(held)}</DropdownMenuLabel>}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The menu's dialogs: a built-in's settings, or removing a VM. */
export function MachineDialogs({ m, os, dialog, onClose, pending, run, onRemoved }: { m: MachineInfo; os: Os; dialog: 'settings' | 'remove' | null; onClose: () => void; pending: string | null; run: Run; onRemoved?: () => void }) {
  return BUILT_IN.has(m.platform) ? (
    <SettingsDialog key={String(dialog === 'settings')} m={m} os={os} open={dialog === 'settings'} onClose={onClose} pending={pending} run={run} />
  ) : (
    <RemoveDialog m={m} open={dialog === 'remove'} onClose={onClose} pending={pending} run={run} onRemoved={onRemoved} />
  )
}

/** How much a machine needs you: failed, missing or unresolved (danger); stopped while it holds Stores (warning). */
export function attentionOf(m: MachineInfo, live?: MachineLive): 'danger' | 'warning' | null {
  if (machineState(m, live).key === 'needs') return 'danger'
  return m.state === 'stopped' && m.stores.length > 0 ? 'warning' : null
}

/** Stores a card names before "+N". */
const STORES_SHOWN = 3

interface TileProps {
  m: MachineInfo
  view: Available
  os: Os
  index: number
  act: (action: MachineAction) => Promise<void>
  /** Opens the machine's page; `newTab` on ⌘/Ctrl-click or a middle click. */
  onOpen: (newTab: boolean) => void
}

/** A machine overview: identity, allocation, inventory, disk and manual power. */
export function MachineTile({ m, view, os, act, onOpen }: TileProps) {
  const startup = useMachineProgress(m.name)
  const live = view.status[m.name]
  const state = machineState(m, live)
  const reason = startup?.status === 'running' ? null : downReason(m, live)
  const stores = storesOn(view, m)
  const boxes = m.sandboxes.map(name => view.sandboxes.find(b => b.name === name) ?? { name, workspaces: null })
  const knownWorkspaces = boxes.reduce((n, b) => n + (b.workspaces ?? 0), 0)
  const workspaces = boxes.some(b => b.workspaces === null) ? knownWorkspaces > 0 ? `${knownWorkspaces}+` : '—' : knownWorkspaces
  const attention = startup?.status === 'running' ? null : attentionOf(m, live)
  const { run, pending: localPending, error } = useMachineRun(act)
  const pending = localPending ?? (startup?.status === 'running' ? startup.kind : null)
  const [inspection, setInspection] = useState<string | null>(null)
  const inspect = async () => { try { const answer = await host.inspectMachine(m.name); setInspection(`Observed ${new Date().toLocaleTimeString()}: ${answer.state ?? 'unknown'}`) } catch (e) { setInspection(e instanceof Error ? e.message : String(e)) } }
  const [dialog, setDialog] = useState<'settings' | 'remove' | null>(null)
  const open = (e: React.MouseEvent) => onOpen(e.metaKey || e.ctrlKey)
  const runtime = m.platform === 'native' && os === 'win32' ? 'Records only' : m.backend === 'native' ? 'Host processes' : m.backend === 'docker' ? 'Containers' : m.backend === 'namespaces' ? 'Linux namespaces' : m.backend || 'Runtime not reported'
  const noAllocation = m.platform === 'native' || m.cpus == null && m.memory == null && m.disk == null
  const calls = state.state === 'unresolved' ? clearingCall('machine', m.name, state.op) : null
  return (
    <article data-focus={`machine:${m.name}`} aria-labelledby={`machine-${m.name}-title`} className="machine-board-card" data-attention={attention ?? undefined}>
      <header className="machine-board-identity">
        <KindLabel platform={m.platform} os={os} hideName className="[&>span]:size-9 [&>span_svg]:size-4.5" />
        <div className="min-w-0 flex-1">
          <h2 id={`machine-${m.name}-title`}>
            <button type="button" onClick={open} onAuxClick={e => e.button === 1 && onOpen(true)} title={`Open ${m.name}`} className="machine-board-open">{m.name}</button>
          </h2>
          <p title={`${fill(kindLabel(m.platform))} · ${runtime}`}>{fill(kindLabel(m.platform))} · {runtime}</p>
        </div>
        <div className="machine-board-control"><MachineMenu m={m} pending={pending} run={run} onOpen={() => onOpen(false)} onDialog={setDialog} className="-mr-1" /></div>
      </header>

      {noAllocation ? <div className="machine-board-shared" aria-label="Machine resource allocation">
        {m.platform === 'native' ? os === 'win32' ? 'Sandbox records only · run workloads on Docker' : 'Uses this computer’s resources' : m.platform === 'docker' ? 'CPU, memory and disk managed by Docker' : 'Resource allocation not reported'}
      </div> : <dl className="machine-board-capacity" aria-label="Machine resource allocations">
        <div><dt>CPU</dt><dd>{m.cpus != null ? `${m.cpus} ${m.cpus === 1 ? 'core' : 'cores'}` : 'Not reported'}</dd></div>
        <div><dt>Memory</dt><dd>{m.memory != null ? gib(m.memory) : 'Not reported'}</dd></div>
        <div><dt>Disk capacity</dt><dd>{m.disk != null ? gib(m.disk) : 'Not reported'}</dd></div>
      </dl>}

      <dl className="machine-board-inventory" aria-label="Machine inventory">
        <div><dt>{boxes.length === 1 ? 'Sandbox' : 'Sandboxes'}</dt><dd>{boxes.length}</dd></div>
        <div title={typeof workspaces === 'string' ? 'Some workspace counts could not be read' : undefined}><dt>{workspaces === 1 ? 'Workspace' : 'Workspaces'}</dt><dd>{workspaces}</dd></div>
        <div><dt>{stores.length === 1 ? 'Local Store' : 'Local Stores'}</dt><dd>{view.readErrors?.stores ? 'Unknown' : stores.length}</dd></div>
      </dl>

      <div className="machine-board-stores">
        <span>Stores</span>
        <div>{stores.length ? <>
          {stores.slice(0, STORES_SHOWN).map(store => <button key={store.name} type="button" className="machine-board-store-link" onClick={() => go.store(store.name)} title={`Open ${store.name} in Storage${store.size != null ? ` · ${bytes(store.size)}` : ''}`}>{store.name}</button>)}
          {stores.length > STORES_SHOWN && <span className="text-muted-foreground">+{stores.length - STORES_SHOWN} more</span>}
        </> : <span className="text-faint">{view.readErrors?.stores ? 'Stores could not be read' : 'None on this machine'}</span>}</div>
      </div>

      {(reason || attention || error !== null) && <div className="machine-board-notice" data-tone={attention === 'warning' ? 'warning' : 'danger'}>
        {(reason || attention) && <p title={reason ?? undefined}>{reason || (attention === 'warning' ? `Start to use ${stores.length === 1 ? 'its local Store' : 'its local Stores'}.` : `${state.label}. Open details to inspect the machine.`)}</p>}
        {calls && <p className="font-mono" title={`${calls.status} · ${calls.clear}`}>{`Inspect: ${calls.status}`}</p>}
        {error !== null && <><Refusal error={error} compact /><button type="button" onClick={() => void inspect()}>Inspect current state</button>{inspection && <p>{inspection}</p>}</>}
        {attention && <button type="button" className="machine-board-control" onClick={() => onOpen(false)}>View details <ArrowRight className="size-3" /></button>}
      </div>}

      <div className="machine-board-disk" aria-label="Machine disk status">
        <div><span>Disk</span><span>{live?.freeDisk != null ? `${gib(live.freeDisk)} free (guest)${m.disk != null ? ` · ${gib(m.disk)} allocated` : ''}` : m.platform === 'native' ? 'Shared with this computer' : 'Free space not reported'}</span></div>
      </div>

      {m.platform === 'docker' && m.state === 'stopped' && pending !== 'start' && <p className="px-5 pb-3 text-sm text-muted-foreground">LayerFS worker is stopped. Docker Desktop can be running independently. Start the worker to use LayerFS on Docker.</p>}
      <MachineProgress name={m.name} compact />
      <footer className="machine-board-footer">
        {pending === 'start' ? <span className="text-sm font-medium">{m.platform === 'docker' ? 'Starting worker…' : 'Starting…'}</span> : <StateChip entity="machine" state={state.state} op={state.op} />}
        <div className="machine-board-control">{m.platform === 'native' ? <span className="machine-board-native">This computer</span> : <PowerButton m={m} pending={pending} run={run} />}</div>
      </footer>
      <MachineDialogs m={m} os={os} dialog={dialog} onClose={() => setDialog(null)} pending={pending} run={run} />
    </article>
  )
}

/** A Store the machine holds, as a link to its card on Storage (its home: pushing, pulling and moving it is done there). */
export function StoreChip({ name, size, className }: { name: string; size: number | null; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => go.store(name)}
      title={`Show ${name} on Storage`}
      className={cn('glass-liquid group inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full py-0.5 pr-2 pl-1.5 text-sm shadow-xs outline-none hover:ring-1 hover:ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      <LfsStore className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{name}</span>
      {size != null && <span className="shrink-0 text-muted-foreground tabular-nums">{bytes(size)}</span>}
      <ArrowRight aria-hidden="true" className="size-3 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </button>
  )
}

/** Why Remove is refused (InUse) before it is asked. */
export const heldWords = (held: { stores: number }) =>
  held.stores > 0 ? fill(held.stores === 1 ? 'In use: holds 1 Store. Pull it to native first.' : 'In use: holds {n} Stores. Pull them to native first.', { n: held.stores }) : 'In use: Sandboxes are running on it.'

/** The machine's facts: its tool, free disk, Sandbox image, paths, and how its Sandboxes run. */
export function MachineFacts({ m, live }: { m: MachineInfo; live?: MachineLive }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-6 gap-y-3">
      <Fact label={'Platform'}>{fill(kindLabel(m.platform))}</Fact>
      {live?.toolVersion && <Fact label={'Tool'}>{live.toolVersion}</Fact>}
      {m.cpus != null && <Fact label={'CPUs'}>{m.cpus}</Fact>}
      {m.memory != null && <Fact label={'Memory'}>{gib(m.memory)}</Fact>}
      {m.disk != null && <Fact label={'Disk'}>{gib(m.disk)}</Fact>}
      {live?.freeDisk != null && <Fact label={'Free disk'}>{gib(live.freeDisk)}</Fact>}
      {m.image && (
        <Fact label={'Sandbox image'} mono>
          <span title={m.image}>{m.image.startsWith('/') ? m.image : shortDigest(m.image)}</span>
        </Fact>
      )}
      {'os_image' in m && typeof (m as { os_image?: unknown }).os_image === 'string' && (
        <Fact label={'OS image'} mono>
          {(m as { os_image: string }).os_image}
        </Fact>
      )}
      {m.docker && (
        <Fact label={'Docker socket'} mono>
          {m.docker}
        </Fact>
      )}
      {m.wsl && <Fact label={'WSL distribution'}>{m.wsl}</Fact>}
      <Fact label={'Sandboxes run as'}>{fill(m.backend === 'docker' ? 'Containers' : m.backend === 'native' ? 'Processes, not isolated' : 'Linux namespaces')}</Fact>
    </dl>
  )
}

/** A built-in's settings (machine.update): its Sandbox image; docker also its socket and, on Windows, its WSL distribution. */
function SettingsDialog({ m, os, open, onClose, pending, run }: { m: MachineInfo; os: Os; open: boolean; onClose: () => void; pending: string | null; run: Run }) {
  const [image, setImage] = useState(m.image ?? '')
  const [socket, setSocket] = useState(m.docker ?? '')
  const [wsl, setWsl] = useState(m.wsl ?? '')
  const docker = m.platform === 'docker'
  const imageBad = image !== '' && !/^sha256:[0-9a-f]{12,64}$/.test(image) && !image.startsWith('/')
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{'Update settings'}</DialogTitle>
          <DialogDescription>{m.name}</DialogDescription>
        </DialogHeader>
        <form
          id={`settings-${m.name}`}
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (imageBad) return
            void run('update', { kind: 'update', name: m.name, changes: { image: image || undefined, ...(docker ? { docker: socket || undefined, wsl: wsl || undefined } : {}) } }).then((ok) => ok && onClose())
          }}
        >
          <Field label={'Sandbox image'} error={imageBad ? 'A sha256: digest, or an archive’s absolute path' : null}>
            <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="sha256:…" aria-invalid={imageBad} className="h-8 font-mono text-sm" />
          </Field>
          {docker && (
            <Field label={'Docker socket'}>
              <Input value={socket} onChange={(e) => setSocket(e.target.value)} placeholder="/var/run/docker.sock" className="h-8 font-mono text-sm" />
            </Field>
          )}
          {docker && os === 'win32' && (
            <Field label={'WSL distribution'}>
              <Input value={wsl} onChange={(e) => setWsl(e.target.value)} placeholder="Ubuntu-24.04" className="h-8 text-sm" />
            </Field>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {'Cancel'}
          </Button>
          <Button type="submit" form={`settings-${m.name}`} disabled={pending !== null || imageBad}>
            {pending === 'update' ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Remove a VM and its disk; LayerFS's refusal shows in the card. */
function RemoveDialog({ m, open, onClose, pending, run, onRemoved }: { m: MachineInfo; open: boolean; onClose: () => void; pending: string | null; run: Run; onRemoved?: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Remove ${m.name} and its disk?`}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {'Cancel'}
          </Button>
          <Button variant="destructive" disabled={pending !== null} onClick={() => void run('remove', { kind: 'remove', name: m.name }).then((ok) => (onClose(), ok && onRemoved?.()))}>
            {pending === 'remove' ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
