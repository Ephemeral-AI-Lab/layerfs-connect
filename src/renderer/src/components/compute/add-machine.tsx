import { t, useI18n } from '@/i18n'
// Add a machine (docs/ui/machines.md), the dialog New machine opens:
// one row per platform this host creates (machine.platforms), with its
// tool's version or what it is missing. A ready platform opens its Create
// form in its row; a missing tool shows how to install it. A form shows the
// fields of the options its platform declares (cpus, memory, disk, image) and
// checks itself (data/compute.ts vmErrors) before it is sent. SSH hosts and
// Firecracker are turned off in Connect (host/machines.js).
import { ChevronDown, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { CopyCode, Field, KindLabel } from '@/components/compute/target-parts'
import { revealStyle } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  freeMachineName,
  emptyVm,
  type FormErrors,
  installHelp,
  isVmKind,
  KIND_BLURB,
  kindLabel,
  needWords,
  type Os,
  parseSize,
  type VmForm,
  vmErrors,
  type VmKind,
  declares,
} from '@/data/compute'
import type { MachineAction } from '@/data/machine-actions'
import { cn } from '@/lib/utils'
import type { MachineInfo, MachinePlatformInfo } from '@shared/host-api'

import { Refusal } from '@/components/refusal'

interface Props {
  /** The platforms a machine is created on (machine.platforms rows). */
  platforms: MachinePlatformInfo[]
  machines: MachineInfo[]
  os: Os
  /** The kind whose form is open. */
  open: string | null
  onOpen: (platform: string | null) => void
  act: (action: MachineAction) => Promise<void>
  /** A machine was made: the page shows its card. */
  onMade: (name: string) => void
  /** The linked LayerFS's version, for the bundle's folder. */
  layerfs?: string | null
}

/** New machine's dialog: the platforms, each with its readiness and its form. */
export function AddMachineDialog({ open, onOpenChange, onMade, ...rest }: Omit<Props, 'open' | 'onOpen'> & { open: boolean; onOpenChange: (open: boolean) => void }) {
  useI18n()
  const [form, setForm] = useState<string | null>(null)
  const change = (o: boolean) => {
    onOpenChange(o)
    if (!o) setForm(null)
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Add a machine')}</DialogTitle>
          <DialogDescription>{t('Create a VM on this computer.')}</DialogDescription>
        </DialogHeader>
        <AddMachine {...rest} open={form} onOpen={setForm} onMade={(name) => (change(false), onMade(name))} />
      </DialogContent>
    </Dialog>
  )
}

export function AddMachine({ platforms, machines, os, open, onOpen, act, onMade, layerfs = null }: Props) {
  useI18n()
  const [help, setHelp] = useState<string | null>(null)
  return (
    <div className="@container/add min-w-0 overflow-hidden rounded-xl bg-card/50 ring-1 ring-foreground/8">
      {platforms.map((c, i) => {
        const tool = installHelp(c.missing, layerfs)
        const expanded = open === c.platform
        return (
          <div key={c.platform} id={`add-${c.platform}`} className={cn('reveal scroll-mt-24', i > 0 && 'border-t', expanded && 'bg-muted/25')} style={revealStyle(i)}>
            <div className="flex items-center gap-3 px-4 py-2.5">
              <KindLabel platform={c.platform} os={os} hideName />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold tracking-tight">{t(kindLabel(c.platform))}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.ready ? (
                    <>
                      <span className="hidden @min-[34rem]/add:inline" title={c.description || undefined}>{t(KIND_BLURB[c.platform as keyof typeof KIND_BLURB] ?? c.description)} · </span>
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
                  {t('Create')}
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
                {isVmKind(c.platform) ? (
                  <VmMachineForm kind={c.platform} machines={machines} platforms={platforms} act={act} onDone={(name) => (onOpen(null), onMade(name))} onCancel={() => onOpen(null)} />
                ) : null}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The words of a form error. */
const say = <F,>(errors: FormErrors<F>, key: keyof F) => (errors[key] ? t(errors[key]!.text, errors[key]!.values) : null)

/** Focus the first field when the form opens. */
function useFirstFocus() {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return ref
}

const ARCHIVE = 'archive'

function VmMachineForm({ kind, machines, platforms, act, onDone, onCancel }: { kind: VmKind; machines: MachineInfo[]; platforms: MachinePlatformInfo[]; act: Props['act']; onDone: (name: string) => void; onCancel: () => void }) {
  useI18n()
  const first = useFirstFocus()
  // the fields this platform's machine.create takes (machine.platforms options)
  const has = (option: string) => declares(platforms, kind, option)
  // a free name to start from
  const suggested = freeMachineName(kind, machines)
  const [f, setF] = useState<VmForm>(() => ({ ...emptyVm(), name: suggested }))
  const [imageMode, setImageMode] = useState<'default' | typeof ARCHIVE>('default')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const errors = vmErrors(f, machines)
  const shown: FormErrors<VmForm> = tried ? errors : {}
  const set = (key: keyof VmForm) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [key]: e.target.value })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (Object.keys(errors).length) return
    // checked once: while it is made, the machine list holds its name, which is not a clash
    setTried(false)
    setBusy(true)
    setError(null)
    const name = f.name.trim()
    const size = { ...(has('cpus') ? { cpus: Number(f.cpus) } : {}), ...(has('memory') ? { memory: parseSize(f.memory)! } : {}), ...(has('disk') ? { disk: parseSize(f.disk)! } : {}) }
    const image = has('image') && imageMode === ARCHIVE ? f.image.trim() : undefined
    try {
      await act({ kind: 'create', input: { platform: kind, name, ...size, ...(image ? { image } : {}) } })
      onDone(name)
    } catch (err) {
      setError(err)
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
        {has('cpus') && (
          <Field label={t('CPUs')} error={say(shown, 'cpus')}>
            <Input value={f.cpus} onChange={set('cpus')} inputMode="numeric" aria-invalid={!!shown.cpus} className="h-8 text-[13px] tabular-nums" />
          </Field>
        )}
        {has('memory') && (
          <Field label={t('Memory')} error={say(shown, 'memory')}>
            <Input value={f.memory} onChange={set('memory')} aria-invalid={!!shown.memory} className="h-8 text-[13px] tabular-nums" />
          </Field>
        )}
        {has('disk') && (
          <Field label={t('Disk')} error={say(shown, 'disk')} hint={t('Holds its Stores')}>
            <Input value={f.disk} onChange={set('disk')} aria-invalid={!!shown.disk} className="h-8 text-[13px] tabular-nums" />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 @min-[34rem]/add:grid-cols-2">
        {has('image') && <Field label={t('Sandbox image')} error={imageMode === ARCHIVE ? say(shown, 'image') : null}>
          <Select value={imageMode} onValueChange={(v) => setImageMode(v === ARCHIVE ? ARCHIVE : 'default')}>
            <SelectTrigger size="sm" className="h-8 w-full rounded-xl text-[13px]" aria-label={t('Sandbox image')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">
                {t('The bundle’s image')}
              </SelectItem>
              <SelectItem value={ARCHIVE}>{t('Choose an archive…')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>}
        {has('image') && imageMode === ARCHIVE && (
          <Field label={t('Archive path or digest')} error={say(shown, 'image')}>
            <Input value={f.image} onChange={set('image')} placeholder="/path/to/sandbox-image.tar" aria-invalid={!!shown.image} className="h-8 font-mono text-xs" />
          </Field>
        )}
      </div>

      <FormButtons busy={busy} label={t('Create')} busyLabel={t('Creating…')} onCancel={onCancel} error={error} invalid={tried && Object.keys(errors).length > 0} />
    </form>
  )
}

function FormButtons({ busy, label, busyLabel, onCancel, error, invalid }: { busy: boolean; label: string; busyLabel: string; onCancel: () => void; error: unknown; invalid: boolean }) {
  useI18n()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" className="h-7 rounded-lg px-3 text-xs" disabled={busy}>
        {busy ? busyLabel : label}
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 rounded-lg px-2.5 text-xs" onClick={onCancel} disabled={busy}>
        {t('Cancel')}
      </Button>
      {invalid && error === null && <span className="text-xs text-destructive">{t('Check the fields marked above.')}</span>}
      {error !== null && <Refusal error={error} className="basis-full text-destructive" />}
    </div>
  )
}
