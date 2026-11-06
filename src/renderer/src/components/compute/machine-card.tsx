import { t, useI18n } from '@/i18n'
// A machine on the Machines board (docs/ui/machines.md), and what its
// page shares with it: Start or Stop, the menu (Update settings… for the
// built-ins, Remove… or Disconnect…, refused while it holds Stores or
// Sandboxes) and its dialogs, a Store chip linking Storage (the Stores' home:
// pushing, pulling and moving them is done there), and its facts.
import { ArrowRight, Box, Lock, Plus, Power, Settings2, Trash2, Unplug } from 'lucide-react'
import { useState } from 'react'

import { go } from '@/components/tabs/go'
import { Fact, Field, KindLabel } from '@/components/compute/target-parts'
import { LfsStore } from '@/components/lfs-icons'
import { Refusal } from '@/components/refusal'
import { StateChip } from '@/components/state-chip'
import { Bar } from '@/components/storage/meters'
import { Card, MoreButton } from '@/components/storage/overview/row-parts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { BUILT_IN, downReason, gib, inUse, kindLabel, machineState, type Os, sizeOf, storesOn } from '@/data/compute'
import type { MachineAction } from '@/data/compute-sim'
import { bytes, shortDigest } from '@/data/format'
import { chatLive } from '@/host/use-chat-sessions'
import { cn } from '@/lib/utils'
import type { AgentSessionSummary } from '@shared/agent-api'
import type { MachineInfo, MachineLive, MachinesView } from '@shared/host-api'

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
  useI18n()
  const power = powerOf(m)
  if (!power) return null
  return (
    <Button size="sm" variant={power === 'stop' ? 'outline' : 'default'} className={cn('h-7 rounded-lg px-2.5 text-xs', className)} disabled={pending !== null} title={t(power === 'stop' ? '{name} is running.' : '{name} is stopped: its Stores and Sandboxes can’t be used until it starts.', { name: m.name })} onClick={() => void run(power, { kind: power, name: m.name })}>
      <Power className="size-3.5" />
      {pending === 'start' ? t('Starting…') : pending === 'stop' ? t('Stopping…') : t(power === 'stop' ? 'Stop' : 'Start')}
    </Button>
  )
}

/** The `…` menu: Open (on the board), Start or Stop, Update settings… (the built-ins) and Remove… or Disconnect…, refused while it holds anything. */
export function MachineMenu({ m, pending, run, onOpen, onDialog, className }: { m: MachineInfo; pending: string | null; run: Run; onOpen?: () => void; onDialog: (d: 'settings' | 'remove') => void; className?: string }) {
  useI18n()
  const power = powerOf(m)
  const builtIn = BUILT_IN.has(m.platform)
  const held = inUse(m)
  const ssh = m.platform === 'ssh'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MoreButton label={t('More for {name}', { name: m.name })} className={className} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {onOpen && (
          <DropdownMenuItem onSelect={onOpen}>
            <ArrowRight />
            {t('Open')}
          </DropdownMenuItem>
        )}
        {power && (
          <DropdownMenuItem disabled={pending !== null} onSelect={() => void run(power, { kind: power, name: m.name })}>
            <Power />
            {t(power === 'stop' ? 'Stop' : 'Start')}
          </DropdownMenuItem>
        )}
        {builtIn ? (
          <>
            <DropdownMenuItem onSelect={() => onDialog('settings')}>
              <Settings2 />
              {t('Update settings…')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <Lock aria-hidden="true" className="size-3" />
              {t('Built in · can’t be removed')}
            </DropdownMenuLabel>
          </>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={!!held || pending !== null} onSelect={() => onDialog('remove')}>
              {ssh ? <Unplug /> : <Trash2 />}
              {t(ssh ? 'Disconnect…' : 'Remove…')}
            </DropdownMenuItem>
            {held && <DropdownMenuLabel className="max-w-64 text-xs font-normal text-muted-foreground">{heldWords(held)}</DropdownMenuLabel>}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The menu's dialogs: a built-in's settings, or removing a VM / disconnecting an ssh host. */
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
  chats?: AgentSessionSummary[]
  /** Opens the machine's page; `newTab` on ⌘/Ctrl-click or a middle click. */
  onOpen: (newTab: boolean) => void
}

/**
 * A machine on the board: its mark, name and menu; its kind and size; how many
 * Sandboxes and Workspaces run on it and how many chats work there; the Stores
 * it holds (links to Storage); its free disk; and a footer with its state and
 * Start or Stop. The whole card opens the machine's page.
 */
export function MachineTile({ m, view, os, index, act, chats, onOpen }: TileProps) {
  useI18n()
  const live = view.status[m.name]
  const state = machineState(m, live)
  const reason = downReason(m, live)
  const stores = storesOn(view, m)
  const boxes = view.sandboxes.filter((b) => b.machine === m.name)
  const workspaces = boxes.reduce((n, b) => n + (b.workspaces ?? 0), 0)
  const working = (chats ?? []).filter((c) => chatLive(c) && c.workspace?.sandbox && boxes.some((b) => b.name === c.workspace!.sandbox)).length
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
          <h2 id={`machine-${m.name}-title`} className="truncate text-[14.5px] font-semibold tracking-tight">
            <button type="button" onClick={open} onAuxClick={(e) => e.button === 1 && onOpen(true)} title={t('Open {name}', { name: m.name })} className="rounded-md text-left outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] group-hover/card:text-primary focus-visible:ring-2 focus-visible:ring-ring">
              {m.name}
            </button>
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
            {t(kindLabel(m.platform))} · {t(size.text, size.values)}
          </p>
        </div>
        <span className="relative z-10">
          <MachineMenu m={m} pending={pending} run={run} onOpen={() => onOpen(false)} onDialog={setDialog} className="-mt-1 -mr-1" />
        </span>
      </header>

      <div className="flex min-w-0 flex-col gap-1.5 text-[13px]">
        {reason && (
          <p className="line-clamp-2 text-xs break-words text-destructive" title={reason}>
            {reason}
          </p>
        )}
        <p className="flex min-w-0 items-center gap-2">
          <Box aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          {boxes.length === 0 ? (
            <span className="text-muted-foreground">{m.platform === 'native' && os === 'win32' ? t('Records only') : t('No Sandboxes')}</span>
          ) : (
            <span className="truncate tabular-nums">
              {t(boxes.length === 1 ? '1 Sandbox' : '{n} Sandboxes', { n: boxes.length })}
              <span className="text-muted-foreground"> · {t(workspaces === 1 ? '1 Workspace' : '{n} Workspaces', { n: workspaces })}</span>
            </span>
          )}
        </p>
        {working > 0 && (
          <p className="flex items-center gap-2 text-primary">
            <span aria-hidden="true" className="ml-1 pulse-ring size-1.5 rounded-full bg-primary text-primary" />
            <span className="pl-0.5">{t(working === 1 ? '1 chat working' : '{n} chats working', { n: working })}</span>
          </p>
        )}
        <div className="relative z-10 flex min-w-0 flex-wrap items-center gap-1.5">
          {stores.length === 0 ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <LfsStore className="size-3.5 shrink-0" />
              {t('No Stores')}
            </span>
          ) : (
            <>
              {stores.slice(0, STORES_SHOWN).map((s) => <StoreChip key={s.name} name={s.name} size={s.size} />)}
              {stores.length > STORES_SHOWN && <span className="text-xs text-muted-foreground">{t('+{n} more', { n: stores.length - STORES_SHOWN })}</span>}
            </>
          )}
        </div>
        {disk && (
          <div className="flex items-center gap-2 pt-0.5 text-[11px] text-muted-foreground tabular-nums" title={t('{free} free of {disk}', { free: gib(disk.free), disk: gib(m.disk) })}>
            <Bar share={disk.used} tone={disk.used > 0.9 ? 'danger' : disk.used > 0.75 ? 'warning' : 'brand'} className="flex-1" />
            <span className="shrink-0">{t('{free} free', { free: gib(disk.free) })}</span>
          </div>
        )}
      </div>

      <footer className="mt-auto flex min-h-10 min-w-0 items-center gap-2 border-t border-foreground/[0.06] pt-3">
        <StateChip entity="machine" state={state.state} op={state.op} />
        <span className="min-w-0 flex-1 truncate text-xs text-destructive">{error !== null && <Refusal error={error} compact />}</span>
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
  useI18n()
  return (
    <button
      type="button"
      onClick={onClick}
      className="reveal flex min-h-44 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-foreground/15 p-4 text-center text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:bg-primary/[0.03] hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
      style={{ '--i': index } as React.CSSProperties}
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-foreground/[0.04]">
        <Plus className="size-4.5" />
      </span>
      <span className="text-[13px] font-medium">{t('New machine')}</span>
      {kinds.length > 0 && <span className="max-w-56 text-xs text-faint">{kinds.map((k) => t(kindLabel(k))).join(', ')}</span>}
    </button>
  )
}

/** A Store the machine holds, as a link to its card on Storage (its home: pushing, pulling and moving it is done there). */
export function StoreChip({ name, size, className }: { name: string; size: number | null; className?: string }) {
  useI18n()
  return (
    <button
      type="button"
      onClick={() => go.store(name)}
      title={t('Show {store} on Storage', { store: name })}
      className={cn('glass-liquid group inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full py-0.5 pr-2 pl-1.5 text-xs shadow-xs outline-none hover:ring-1 hover:ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      <LfsStore className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{name}</span>
      {size != null && <span className="shrink-0 text-muted-foreground tabular-nums">{bytes(size)}</span>}
      <ArrowRight aria-hidden="true" className="size-3 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </button>
  )
}

/** Why Remove or Disconnect is refused (InUse) before it is asked. */
export const heldWords = (held: { stores: number }) =>
  held.stores > 0 ? t(held.stores === 1 ? 'In use: holds 1 Store. Pull it to native first.' : 'In use: holds {n} Stores. Pull them to native first.', { n: held.stores }) : t('In use: Sandboxes are running on it.')

/** The machine's facts: its tool, free disk, Sandbox image, hosts and paths, and how its Sandboxes run. */
export function MachineFacts({ m, live }: { m: MachineInfo; live?: MachineLive }) {
  useI18n()
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-6 gap-y-3">
      <Fact label={t('Platform')}>{t(kindLabel(m.platform))}</Fact>
      {live?.toolVersion && <Fact label={t('Tool')}>{live.toolVersion}</Fact>}
      {m.cpus != null && <Fact label={t('CPUs')}>{m.cpus}</Fact>}
      {m.memory != null && <Fact label={t('Memory')}>{gib(m.memory)}</Fact>}
      {m.disk != null && <Fact label={t('Disk')}>{gib(m.disk)}</Fact>}
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
  )
}

/** A built-in's settings (machine.update): its Sandbox image; docker also its socket and, on Windows, its WSL distribution. */
function SettingsDialog({ m, os, open, onClose, pending, run }: { m: MachineInfo; os: Os; open: boolean; onClose: () => void; pending: string | null; run: Run }) {
  useI18n()
  const [image, setImage] = useState(m.image ?? '')
  const [socket, setSocket] = useState(m.docker ?? '')
  const [wsl, setWsl] = useState(m.wsl ?? '')
  const docker = m.platform === 'docker'
  const imageBad = image !== '' && !/^sha256:[0-9a-f]{12,64}$/.test(image) && !image.startsWith('/')
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Update settings')}</DialogTitle>
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
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button type="submit" form={`settings-${m.name}`} disabled={pending !== null || imageBad}>
            {pending === 'update' ? t('Saving…') : t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Remove a VM and its disk, or disconnect an ssh host (its data root stays); LayerFS's refusal shows in the card. */
function RemoveDialog({ m, open, onClose, pending, run, onRemoved }: { m: MachineInfo; open: boolean; onClose: () => void; pending: string | null; run: Run; onRemoved?: () => void }) {
  useI18n()
  const ssh = m.platform === 'ssh'
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ssh ? t('Disconnect {name}? Its data root stays on the host.', { name: m.name }) : t('Remove {name} and its disk?', { name: m.name })}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="destructive" disabled={pending !== null} onClick={() => void run('remove', { kind: 'remove', name: m.name }).then((ok) => (onClose(), ok && onRemoved?.()))}>
            {pending === 'remove' ? t(ssh ? 'Disconnecting…' : 'Removing…') : t(ssh ? 'Disconnect' : 'Remove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
