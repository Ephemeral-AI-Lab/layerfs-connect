import { fill } from '@/lib/text'
// A machine on the Machines board (docs/ui/machines.md), and what its
// page shares with it: Start or Stop, the menu (Update settings… for the
// built-ins, Remove…, refused while it holds Stores or
// Sandboxes) and its dialogs, a Store chip linking Storage (the Stores' home:
// pushing, pulling and moving them is done there), and its facts.
import { ArrowRight, Box, Lock, Plus, Power, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { go } from '@/layerfs/go'
import { Fact, Field, KindLabel } from '@/pages/machines/TargetParts'
import { LfsStore } from '@/components/layerfs/LfsIcons'
import { Refusal } from '@/components/layerfs/Refusal'
import { StateChip } from '@/components/layerfs/StateChip'
import { Bar } from '@/pages/storage/Meters'
import { Card, MoreButton } from '@/pages/storage/RowParts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { BUILT_IN, downReason, gib, inUse, kindLabel, machineState, type Os, sizeOf, storesOn } from '@/layerfs/compute'
import type { MachineAction } from '@/layerfs/compute-sim'
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
  if (!power) return null
  return (
    <Button size="sm" variant={power === 'stop' ? 'outline' : 'default'} className={cn('h-7 rounded-md px-2.5 text-sm', className)} disabled={pending !== null} title={fill(power === 'stop' ? '{name} is running.' : '{name} is stopped: its Stores and Sandboxes can’t be used until it starts.', { name: m.name })} onClick={() => void run(power, { kind: power, name: m.name })}>
      <Power className="size-3.5" />
      {pending === 'start' ? 'Starting…' : pending === 'stop' ? 'Stopping…' : fill(power === 'stop' ? 'Stop' : 'Start')}
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
            {fill(power === 'stop' ? 'Stop' : 'Start')}
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

/**
 * A machine on the board: its mark, name and menu; its kind and size; how many
 * Sandboxes and Workspaces run on it; the Stores
 * it holds (links to Storage); its free disk; and a footer with its state and
 * Start or Stop. The whole card opens the machine's page.
 */
export function MachineTile({ m, view, os, index, act, onOpen }: TileProps) {
  const live = view.status[m.name]
  const state = machineState(m, live)
  const reason = downReason(m, live)
  const stores = storesOn(view, m)
  const boxes = view.sandboxes.filter((b) => b.machine === m.name)
  const workspaces = boxes.reduce((n, b) => n + (b.workspaces ?? 0), 0)
  const attention = attentionOf(m, live)
  const disk = m.disk && live?.freeDisk != null ? { used: Math.max(0, m.disk - live.freeDisk) / m.disk, free: live.freeDisk } : null
  // the disk bar says what is free; the size line leaves it out then
  const size = sizeOf(m, os, disk ? undefined : live)
  const { run, pending, error } = useMachineRun(act)
  const [dialog, setDialog] = useState<'settings' | 'remove' | null>(null)
  const open = (e: React.MouseEvent) => onOpen(e.metaKey || e.ctrlKey)
  return (
    <Card
      index={index}
      data-focus={`machine:${m.name}`}
      aria-labelledby={`machine-${m.name}-title`}
      className={cn('group/card relative flex flex-col gap-3 p-4 transition-shadow hover:shadow-md', attention === 'warning' && 'ring-1 ring-amber-500/45', attention === 'danger' && 'ring-1 ring-destructive/45')}
    >
      <header className="flex min-w-0 items-start gap-3">
        <KindLabel platform={m.platform} os={os} hideName className="pt-0.5" />
        <div className="min-w-0 flex-1">
          {/* the name stretches over the card: a click anywhere opens the machine, its own controls sit above */}
          <h2 id={`machine-${m.name}-title`} className="truncate text-base leading-chat font-strong tracking-tight">
            <button type="button" onClick={open} onAuxClick={(e) => e.button === 1 && onOpen(true)} title={`Open ${m.name}`} className="rounded-sm text-left outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] group-hover/card:text-primary focus-visible:ring-2 focus-visible:ring-ring">
              {m.name}
            </button>
          </h2>
          <p className="mt-0.5 truncate text-sm text-muted-foreground tabular-nums">
            {fill(kindLabel(m.platform))} · {fill(size.text, size.values)}
          </p>
        </div>
        <span className="relative z-10">
          <MachineMenu m={m} pending={pending} run={run} onOpen={() => onOpen(false)} onDialog={setDialog} className="-mt-1 -mr-1" />
        </span>
      </header>

      <div className="flex min-w-0 flex-col gap-1.5 text-md">
        {reason && (
          <p className="line-clamp-2 text-sm break-words text-destructive" title={reason}>
            {reason}
          </p>
        )}
        <p className="flex min-w-0 items-center gap-2">
          <Box aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          {boxes.length === 0 ? (
            <span className="text-muted-foreground">{m.platform === 'native' && os === 'win32' ? 'Records only' : 'No Sandboxes'}</span>
          ) : (
            <span className="truncate tabular-nums">
              {fill(boxes.length === 1 ? '1 Sandbox' : '{n} Sandboxes', { n: boxes.length })}
              <span className="text-muted-foreground"> · {fill(workspaces === 1 ? '1 Workspace' : '{n} Workspaces', { n: workspaces })}</span>
            </span>
          )}
        </p>
        <div className="relative z-10 flex min-w-0 flex-wrap items-center gap-1.5">
          {stores.length === 0 ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <LfsStore className="size-3.5 shrink-0" />
              {'No Stores'}
            </span>
          ) : (
            <>
              {stores.slice(0, STORES_SHOWN).map((s) => <StoreChip key={s.name} name={s.name} size={s.size} />)}
              {stores.length > STORES_SHOWN && <span className="text-sm text-muted-foreground">{`+${stores.length - STORES_SHOWN} more`}</span>}
            </>
          )}
        </div>
        {disk && (
          <div className="flex items-center gap-2 pt-0.5 text-xs leading-chat text-muted-foreground tabular-nums" title={`${gib(disk.free)} free of ${gib(m.disk)}`}>
            <Bar share={disk.used} tone={disk.used > 0.9 ? 'danger' : disk.used > 0.75 ? 'warning' : 'brand'} className="flex-1" />
            <span className="shrink-0">{`${gib(disk.free)} free`}</span>
          </div>
        )}
      </div>

      <footer className="mt-auto flex min-h-10 min-w-0 items-center gap-2 border-t border-foreground/[0.06] pt-3">
        <StateChip entity="machine" state={state.state} op={state.op} />
        <span className="min-w-0 flex-1 truncate text-sm text-destructive">{error !== null && <Refusal error={error} compact />}</span>
        <span className="relative z-10">
          <PowerButton m={m} pending={pending} run={run} />
        </span>
      </footer>
      <MachineDialogs m={m} os={os} dialog={dialog} onClose={() => setDialog(null)} pending={pending} run={run} />
    </Card>
  )
}

/** The dashed last card: New machine, with the kinds this host can add. */
export function NewMachineTile({ index, kinds, onClick }: { index: number; kinds: string[]; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="reveal flex min-h-44 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-foreground/15 p-4 text-center text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:bg-primary/[0.03] hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
      style={{ '--i': index } as React.CSSProperties}
    >
      <span className="flex size-9 items-center justify-center rounded-lg-plus bg-foreground/[0.04]">
        <Plus className="size-4.5" />
      </span>
      <span className="text-md font-medium">{'New machine'}</span>
      {kinds.length > 0 && <span className="max-w-56 text-sm text-faint">{kinds.map((k) => fill(kindLabel(k))).join(', ')}</span>}
    </button>
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
