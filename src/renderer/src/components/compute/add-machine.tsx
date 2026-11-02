import { t, useI18n } from '@/i18n'
// Add a machine (docs/ui/layerfs-compute.md): one row per kind this host
// could create (machine.list().can_create), with its tool's version or what
// it is missing. A ready kind opens its form inline: Create for a VM kind,
// Connect for an ssh host; a missing tool shows how to install it. Each form
// checks itself (data/compute.ts vmErrors, sshErrors) before it is sent.
import { ChevronDown, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { Field } from '@/components/compute/machines-table'
import { CopyCode, KindLabel } from '@/components/compute/target-parts'
import { revealStyle } from '@/components/motion'
import { Card } from '@/components/storage/overview/row-parts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DEFAULT_SANDBOX_IMAGE,
  emptySsh,
  freeMachineName,
  emptyVm,
  type FormErrors,
  installHelp,
  isVmKind,
  KIND_BLURB,
  kindLabel,
  needWords,
  nestedHosts,
  type Os,
  parseSize,
  type SshForm,
  sshErrors,
  type VmForm,
  vmErrors,
  type VmKind,
} from '@/data/compute'
import type { MachineAction } from '@/data/compute-sim'
import { cn } from '@/lib/utils'
import type { MachineCreatable, MachineInfo } from '@shared/host-api'

interface Props {
  canCreate: MachineCreatable[]
  machines: MachineInfo[]
  os: Os
  /** The kind whose form is open (the header's New machine menu opens one too). */
  open: string | null
  onOpen: (platform: string | null) => void
  act: (action: MachineAction) => Promise<void>
  /** A machine was made: the page opens its row. */
  onMade: (name: string) => void
  /** The linked LayerFS's version, for the bundle's folder. */
  layerfs?: string | null
}

export function AddMachine({ canCreate, machines, os, open, onOpen, act, onMade, layerfs = null }: Props) {
  useI18n()
  const [help, setHelp] = useState<string | null>(null)
  return (
    <Card index={6} className="@container/add overflow-hidden">
      {canCreate.map((c, i) => {
        const tool = installHelp(c.missing, layerfs)
        const expanded = open === c.platform
        const ssh = c.platform === 'ssh'
        return (
          <div key={c.platform} id={`add-${c.platform}`} className={cn('reveal scroll-mt-24', i > 0 && 'border-t', expanded && 'bg-muted/25')} style={revealStyle(i + 7)}>
            <div className="flex items-center gap-3 px-4 py-2.5">
              <KindLabel platform={c.platform} os={os} hideName />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold tracking-tight">{t(kindLabel(c.platform))}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.ready ? (
                    <>
                      <span className="hidden @min-[34rem]/add:inline">{t(KIND_BLURB[c.platform as keyof typeof KIND_BLURB] ?? '')} · </span>
                      <span className="tabular-nums">{c.version ?? t('Ready')}</span>
                    </>
                  ) : (
                    <span className="inline-flex min-w-0 items-center gap-1 text-warning">
                      <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
                      <span className="truncate">{c.missing.map((n) => t(needWords(n).text, needWords(n).values)).join(' · ')}</span>
                    </span>
                  )}
                </p>
              </div>
              {c.ready ? (
                <Button size="sm" variant={expanded ? 'secondary' : 'outline'} className="h-7 shrink-0 rounded-lg px-3 text-xs" aria-expanded={expanded} onClick={() => onOpen(expanded ? null : c.platform)}>
                  {t(ssh ? 'Connect' : 'Create')}
                </Button>
              ) : tool ? (
                <Button size="sm" variant="ghost" className="h-7 shrink-0 rounded-lg px-2.5 text-xs" aria-expanded={help === c.platform} onClick={() => setHelp(help === c.platform ? null : c.platform)}>
                  {t(tool.label)}
                  <ChevronDown className={cn('size-3.5 transition-transform', help === c.platform && 'rotate-180')} />
                </Button>
              ) : null}
            </div>
            {!c.ready && tool && help === c.platform && (
              <div className="flex flex-col items-start gap-1.5 px-4 pb-3 pl-[3.25rem] text-xs text-muted-foreground">
                <p>{t(tool.words, tool.values)}</p>
                {tool.commands.map((line) => (
                  <CopyCode key={line} text={line} />
                ))}
                <p className="text-faint">{t('Then press Refresh.')}</p>
              </div>
            )}
            {expanded && c.ready && (
              <div className="px-4 pb-4 @min-[34rem]/add:pl-[3.25rem]">
                {ssh ? (
                  <SshMachineForm machines={machines} act={act} onDone={(name) => (onOpen(null), onMade(name))} onCancel={() => onOpen(null)} />
                ) : isVmKind(c.platform) ? (
                  <VmMachineForm kind={c.platform} machines={machines} canCreate={canCreate} act={act} onDone={(name) => (onOpen(null), onMade(name))} onCancel={() => onOpen(null)} />
                ) : null}
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}

/** The words of a form error. */
const say = <F,>(errors: FormErrors<F>, key: keyof F) => (errors[key] ? t(errors[key]!.text, errors[key]!.values) : null)
const refusal = (e: unknown) => (e instanceof Error ? e.message.replace(/^[A-Za-z]+: /, '') : String(e))

/** Focus the first field when the form opens. */
function useFirstFocus() {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return ref
}

const NEW_HOST = 'new:'
const ARCHIVE = 'archive'

function VmMachineForm({ kind, machines, canCreate, act, onDone, onCancel }: { kind: VmKind; machines: MachineInfo[]; canCreate: MachineCreatable[]; act: Props['act']; onDone: (name: string) => void; onCancel: () => void }) {
  useI18n()
  const id = useId()
  const first = useFirstFocus()
  const hosts = nestedHosts(machines)
  const limaReady = canCreate.some((c) => c.platform === 'lima' && c.ready)
  // a free name to start from; a Mac that can nest but has no nested Lima machine yet: the form makes one first
  const suggested = freeMachineName(kind, machines)
  const [f, setF] = useState<VmForm>(() => ({ ...emptyVm(), name: suggested, host: kind === 'firecracker' && hosts.length === 0 && limaReady ? NEW_HOST : '' }))
  const [imageMode, setImageMode] = useState<'default' | typeof ARCHIVE>('default')
  const [newHost, setNewHost] = useState(() => (kind === 'firecracker' && hosts.length === 0 ? freeMachineName('lima', machines) : ''))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hostChoice = f.host.startsWith(NEW_HOST) ? NEW_HOST : f.host
  const form = { ...f, host: hostChoice === NEW_HOST ? `${NEW_HOST}${newHost}` : f.host }
  const errors = vmErrors(kind, form, machines)
  const shown: FormErrors<VmForm> = tried ? errors : {}
  const set = (key: keyof VmForm) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [key]: e.target.value })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (Object.keys(errors).length) return
    setBusy(true)
    setError(null)
    const name = f.name.trim()
    const size = { cpus: Number(f.cpus), memory: parseSize(f.memory)!, disk: parseSize(f.disk)! }
    const image = imageMode === ARCHIVE ? f.image.trim() : undefined
    try {
      let host = form.host
      if (kind === 'firecracker' && host.startsWith(NEW_HOST)) {
        // the Lima machine it runs in, made with --nested first
        host = host.slice(NEW_HOST.length)
        await act({ kind: 'create', input: { platform: 'lima', name: host, nested: true } })
      }
      await act({ kind: 'create', input: { platform: kind, name, ...size, ...(image ? { image } : {}), ...(f.osImage.trim() ? { os_image: f.osImage.trim() } : {}), ...(kind === 'firecracker' ? { host } : {}) } })
      onDone(name)
    } catch (err) {
      setError(refusal(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 rounded-xl bg-card/70 p-3.5 ring-1 ring-foreground/8" aria-label={t('New {kind} machine', { kind: t(kindLabel(kind)) })}>
      <div className="grid grid-cols-2 gap-3 @min-[34rem]/add:grid-cols-4">
        <Field label={t('Name')} error={say(shown, 'name')} className="col-span-2 @min-[34rem]/add:col-span-1">
          <Input ref={first} value={f.name} onChange={set('name')} placeholder={suggested} aria-invalid={!!shown.name} autoComplete="off" spellCheck={false} className="h-8 text-[13px]" />
        </Field>
        <Field label={t('CPUs')} error={say(shown, 'cpus')}>
          <Input value={f.cpus} onChange={set('cpus')} inputMode="numeric" aria-invalid={!!shown.cpus} className="h-8 text-[13px] tabular-nums" />
        </Field>
        <Field label={t('Memory')} error={say(shown, 'memory')}>
          <Input value={f.memory} onChange={set('memory')} aria-invalid={!!shown.memory} className="h-8 text-[13px] tabular-nums" />
        </Field>
        <Field label={t('Disk')} error={say(shown, 'disk')} hint={t('Holds its Stores')}>
          <Input value={f.disk} onChange={set('disk')} aria-invalid={!!shown.disk} className="h-8 text-[13px] tabular-nums" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 @min-[34rem]/add:grid-cols-2">
        <Field label={t('Sandbox image')} error={imageMode === ARCHIVE ? say(shown, 'image') : null}>
          <Select value={imageMode} onValueChange={(v) => setImageMode(v === ARCHIVE ? ARCHIVE : 'default')}>
            <SelectTrigger size="sm" className="h-8 w-full rounded-xl text-[13px]" aria-label={t('Sandbox image')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">
                {t('layerfs runtime')} <span className="font-mono text-[11px] text-muted-foreground">{DEFAULT_SANDBOX_IMAGE.digest.slice(0, 19)}…</span>
              </SelectItem>
              <SelectItem value={ARCHIVE}>{t('Choose an archive…')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {imageMode === ARCHIVE && (
          <Field label={t('Archive path or digest')} error={say(shown, 'image')}>
            <Input value={f.image} onChange={set('image')} placeholder="/path/to/sandbox-image.tar" aria-invalid={!!shown.image} className="h-8 font-mono text-xs" />
          </Field>
        )}
        {kind === 'firecracker' && (
          <Field label={t('Lima host')} error={say(shown, 'host')} hint={t('Firecracker runs inside a Lima machine made with --nested')} className="@min-[34rem]/add:col-start-1">
            <Select value={hostChoice || undefined} onValueChange={(v) => setF({ ...f, host: v === NEW_HOST ? NEW_HOST : v })}>
              <SelectTrigger size="sm" className="h-8 w-full rounded-xl text-[13px]" aria-label={t('Lima host')} aria-invalid={!!shown.host}>
                <SelectValue placeholder={t('Choose…')} />
              </SelectTrigger>
              <SelectContent>
                {hosts.map((h) => (
                  <SelectItem key={h.name} value={h.name}>
                    {h.name}
                  </SelectItem>
                ))}
                {limaReady && <SelectItem value={NEW_HOST}>{t('Create a nested Lima machine…')}</SelectItem>}
              </SelectContent>
            </Select>
          </Field>
        )}
        {kind === 'firecracker' && hostChoice === NEW_HOST && (
          <Field label={t('New Lima machine’s name')}>
            <Input value={newHost} onChange={(e) => setNewHost(e.target.value)} placeholder={freeMachineName('lima', machines, [f.name.trim()])} className="h-8 text-[13px]" />
          </Field>
        )}
      </div>

      <details className="group/adv">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown aria-hidden="true" className="size-3.5 -rotate-90 transition-transform group-open/adv:rotate-0" />
          {t('Advanced')}
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-3 @min-[34rem]/add:grid-cols-2">
          <Field label={t('OS image')} hint={t('Left empty, LayerFS chooses the VM’s OS image')}>
            <Input id={`${id}-os`} value={f.osImage} onChange={set('osImage')} placeholder="ubuntu-24.04" className="h-8 text-[13px]" />
          </Field>
        </div>
      </details>

      <FormButtons busy={busy} label={t('Create')} busyLabel={t('Creating…')} onCancel={onCancel} error={error} invalid={tried && Object.keys(errors).length > 0} />
    </form>
  )
}

function SshMachineForm({ machines, act, onDone, onCancel }: { machines: MachineInfo[]; act: Props['act']; onDone: (name: string) => void; onCancel: () => void }) {
  useI18n()
  const first = useFirstFocus()
  const suggested = freeMachineName('ssh', machines)
  const [f, setF] = useState<SshForm>(() => ({ ...emptySsh(), name: suggested }))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errors = sshErrors(f, machines)
  const shown: FormErrors<SshForm> = tried ? errors : {}
  const set = (key: keyof SshForm) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [key]: e.target.value })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (Object.keys(errors).length) return
    setBusy(true)
    setError(null)
    const name = f.name.trim()
    const [user, host] = f.host.includes('@') ? f.host.trim().split('@') : [undefined, f.host.trim()]
    try {
      await act({ kind: 'create', input: { platform: 'ssh', name, host, ...(user ? { user } : {}), port: Number(f.port), ...(f.identity.trim() ? { identity: f.identity.trim() } : {}), root: f.root.trim() } })
      onDone(name)
    } catch (err) {
      setError(refusal(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 rounded-xl bg-card/70 p-3.5 ring-1 ring-foreground/8" aria-label={t('Connect an ssh host')}>
      <div className="grid grid-cols-2 gap-3 @min-[34rem]/add:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_5rem]">
        <Field label={t('Name')} error={say(shown, 'name')}>
          <Input ref={first} value={f.name} onChange={set('name')} placeholder={suggested} aria-invalid={!!shown.name} autoComplete="off" spellCheck={false} className="h-8 text-[13px]" />
        </Field>
        <Field label={t('Host')} error={say(shown, 'host')} className="col-span-2 row-start-2 @min-[34rem]/add:col-span-1 @min-[34rem]/add:row-start-auto">
          <Input value={f.host} onChange={set('host')} placeholder="ubuntu@gpu-box.lan" aria-invalid={!!shown.host} autoComplete="off" spellCheck={false} className="h-8 font-mono text-xs" />
        </Field>
        <Field label={t('Port')} error={say(shown, 'port')}>
          <Input value={f.port} onChange={set('port')} inputMode="numeric" aria-invalid={!!shown.port} className="h-8 text-[13px] tabular-nums" />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 @min-[34rem]/add:grid-cols-2">
        <Field label={t('Identity')} error={say(shown, 'identity')} hint={t('Left empty, the ssh agent’s keys')}>
          <Input value={f.identity} onChange={set('identity')} placeholder="~/.ssh/id_ed25519" aria-invalid={!!shown.identity} className="h-8 font-mono text-xs" />
        </Field>
        <Field label={t('Data root')} error={say(shown, 'root')} hint={t('Holds its Stores; it stays when disconnected')}>
          <Input value={f.root} onChange={set('root')} aria-invalid={!!shown.root} className="h-8 font-mono text-xs" />
        </Field>
      </div>
      <p className="text-xs text-warning">{t('LayerFS logs in as root by default and turns off user namespaces on that host for everyone. Use a host you keep for this.')}</p>
      <FormButtons busy={busy} label={t('Connect')} busyLabel={t('Connecting…')} onCancel={onCancel} error={error} invalid={tried && Object.keys(errors).length > 0} />
    </form>
  )
}

function FormButtons({ busy, label, busyLabel, onCancel, error, invalid }: { busy: boolean; label: string; busyLabel: string; onCancel: () => void; error: string | null; invalid: boolean }) {
  useI18n()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" className="h-7 rounded-lg px-3 text-xs" disabled={busy}>
        {busy ? busyLabel : label}
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 rounded-lg px-2.5 text-xs" onClick={onCancel} disabled={busy}>
        {t('Cancel')}
      </Button>
      {invalid && !error && <span className="text-xs text-destructive">{t('Check the fields marked above.')}</span>}
      {error && (
        <span role="alert" className="text-xs break-words text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
