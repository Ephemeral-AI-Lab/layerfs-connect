import { fill } from '@/lib/text'
// The machine page's Details tab (docs/connect/README.md, "Machine page"):
// everything LayerFS says about one machine, in cards. Overview (its platform
// and what that is, state, how it came to be, tool and LayerFS versions),
// Resources (CPUs, memory, disk and how full it is), Sandboxes (how they run,
// how files reach them, the default image, how many run and their routes),
// Stores (SQLite here and how its calls run, the Stores on its disk,
// PostgreSQL Sandboxes), Connection (Docker socket, WSL) when it has one, and
// readiness in Overview (machine.platforms: ready, or the tools it misses).
// Then its
// settings (built-ins) or the danger zone. Reads only: nothing here starts,
// stops or changes the machine except the buttons at the end.
import { Check, Cpu, HardDrive, Info, Link2, Package, Trash2, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { heldWords } from '@/pages/machines/MachineCard'
import { StateChip } from '@/components/layerfs/StateChip'
import { Bar } from '@/pages/storage/Meters'
import { Card } from '@/pages/storage/RowParts'
import { go } from '@/layerfs/go'
import { Button } from '@/components/ui/button'
import { BUILT_IN, gib, inUse, kindLabel, machineState } from '@/layerfs/compute'
import { bytes, shortDigest } from '@/layerfs/format'
import { cn } from '@/lib/utils'
import type { MachineInfo, MachineLive, MachinePlatformInfo, MachineSandbox, MachineStore } from '@/layerfs/host-api'

interface Props {
  m: MachineInfo
  live: MachineLive | undefined
  /** machine.platforms()'s row for its platform, when the host lists it. */
  platform: MachinePlatformInfo | undefined
  /** The linked LayerFS's version. */
  layerfs: string | null
  /** Its Sandboxes (with their records) and the sqlite Stores on its disk. */
  sandboxes: MachineSandbox[]
  stores: MachineStore[]
  /** PostgreSQL Stores in the home: its Sandboxes reach them all when it supports that. */
  postgresql: number
  pending: string | null
  onSettings: () => void
  onRemove: () => void
}

const RUNS_AS: Record<string, string> = { docker: 'Containers', native: 'Processes, not isolated', namespaces: 'Linux namespaces and a cgroup' }
const KERNEL: Record<string, string> = { nfs: 'Loopback NFS', fuse: 'FUSE in the machine' }
const CALLS: Record<string, string> = { in_process: 'In this app’s process', worker: 'A LayerFS worker on the machine' }
const HOW: Record<string, string> = { built_in: 'Built in', created: 'Created in Connect or the CLI' }

const image = (ref: string) => (ref.startsWith('/') ? ref.slice(ref.lastIndexOf('/') + 1) : shortDigest(ref))

export function MachineDetails({ m, live, platform: p, layerfs, sandboxes, stores, postgresql, pending, onSettings, onRemove }: Props) {
  const state = machineState(m, live)
  const held = inUse(m)
  const used = m.disk && live?.freeDisk != null ? Math.max(0, m.disk - live.freeDisk) : null
  const share = used !== null && m.disk ? used / m.disk : null
  const running = sandboxes.filter((b) => b.state === 'running').length
  const workspaces = sandboxes.reduce((n, b) => n + (b.workspaces ?? 0), 0)
  const routes = [...new Set(sandboxes.flatMap((b) => (b.route ? [b.route] : [])))]
  const images = [...new Set(sandboxes.flatMap((b) => (b.image ? [b.image] : [])))]
  const storeBytes = stores.reduce((n, s) => n + (s.size ?? 0), 0)
  const builtIn = BUILT_IN.has(m.platform)
  const shared = m.platform === 'native' ? 'Shares this computer’s' : m.platform === 'docker' ? 'Docker’s own' : null
  const missing = p?.missing ?? []
  const connection = m.docker || m.wsl

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section icon={Info} title={'Overview'}>
          <Row label={'Platform'}>
            <span className="flex min-w-0 flex-col">
              <span>{fill(kindLabel(m.platform))}</span>
              {p?.description && <span className="text-xs text-muted-foreground">{p.description}</span>}
            </span>
          </Row>
          <Row label={'State'}>
            <StateChip entity="machine" state={state.state} op={state.op} />
          </Row>
          {p?.how && <Row label={'Origin'}>{fill(HOW[p.how] ?? p.how)}</Row>}
          <Row label={'Tool'} mono>{live?.toolVersion ?? p?.version ?? null}</Row>
          <Row label={'LayerFS'} mono>{layerfs}</Row>
          <Row label={'Readiness'} tone={missing.length ? 'danger' : undefined}>
            {!p ? (
              'Not listed by machine.platforms()'
            ) : missing.length ? (
              <span className="inline-flex items-center gap-1.5"><TriangleAlert aria-hidden="true" className="size-3.5" /> {`Missing ${missing.join(', ')}`}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5"><Check aria-hidden="true" className="size-3.5 text-emerald-600" /> {'Ready on this computer'}</span>
            )}
          </Row>
          {live?.down && <Row label={'Down because'} tone="danger">{live.down}</Row>}
          {state.op && <Row label={'Operation'} mono>{`${state.op.name} · ${state.op.phase}`}</Row>}
          {m.error && <Row label={'Error'} tone="danger">{m.error}</Row>}
        </Section>

        <Section icon={Cpu} title={'Resources'}>
          <Row label={'CPUs'}>{m.cpus ?? shared}</Row>
          <Row label={'Memory'}>{m.memory != null ? gib(m.memory) : shared}</Row>
          <Row label={'Disk'}>{m.disk != null ? gib(m.disk) : shared}</Row>
          {share !== null ? (
            <Row label={'Disk use'}>
              <span className="flex min-w-0 flex-col gap-1.5">
                <Bar share={share} tone={share > 0.9 ? 'danger' : share > 0.75 ? 'warning' : 'brand'} className="w-full max-w-56" />
                <span className="text-xs text-muted-foreground tabular-nums">{`${gib(used!)} used · ${gib(live!.freeDisk)} free`}</span>
              </span>
            </Row>
          ) : (
            live?.freeDisk != null && <Row label={'Free disk'}>{gib(live.freeDisk)}</Row>
          )}
        </Section>

        <Section icon={Package} title={'Sandboxes'}>
          <Row label={'Run as'}>{fill(RUNS_AS[m.backend] ?? m.backend)}</Row>
          {p?.kernel && <Row label={'Files reach them over'}>{fill(KERNEL[p.kernel] ?? p.kernel)}</Row>}
          <Row label={'Default image'} mono={!!m.image} title={m.image}>{m.image ? image(m.image) : m.backend === 'native' ? 'None: host processes' : 'None set'}</Row>
          <Row label={'Here now'}>
            {sandboxes.length
              ? `${running} of ${sandboxes.length} running · ${fill(workspaces === 1 ? '1 Workspace' : '{n} Workspaces', { n: workspaces })}`
              : 'None'}
          </Row>
          {routes.length > 0 && <Row label={'Routes in use'} mono>{routes.join(', ')}</Row>}
          {images.length > 0 && <Row label={'Images in use'} mono>{images.map(image).join(', ')}</Row>}
        </Section>

        <Section icon={HardDrive} title={'Stores'}>
          <Row label={'SQLite Stores'}>
            {m.supports?.sqlite === false ? (
              'Not here'
            ) : stores.length ? (
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                {stores.map((s, i) => (
                  <span key={s.name}>
                    <button type="button" onClick={() => go.store(s.name)} className="rounded-sm font-mono outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">{s.name}</button>
                    {i < stores.length - 1 && <span className="text-faint">,</span>}
                  </span>
                ))}
                {stores.some((s) => s.size != null) && <span className="text-muted-foreground tabular-nums">· {bytes(storeBytes)}</span>}
              </span>
            ) : (
              'None on its disk'
            )}
          </Row>
          {p?.sqlite && <Row label={'SQLite calls run in'}>{fill(CALLS[p.sqlite] ?? p.sqlite)}</Row>}
          <Row label={'PostgreSQL Sandboxes'} tone={m.supports?.postgresql_sandbox === false ? 'muted' : undefined}>
            {m.supports?.postgresql_sandbox
              ? fill(postgresql === 1 ? 'Yes · reach 1 PostgreSQL Store' : 'Yes · reach {n} PostgreSQL Stores', { n: postgresql })
              : m.supports?.postgresql_sandbox === false
                ? (m.supports.reason ?? 'No')
                : 'Not said by this LayerFS'}
          </Row>
          {p?.postgresql.store_calls && <Row label={'PostgreSQL calls run in'}>{fill(CALLS[p.postgresql.store_calls] ?? p.postgresql.store_calls)}</Row>}
        </Section>

        {connection && (
          <Section icon={Link2} title={'Connection'}>
            {m.docker && <Row label={'Docker socket'} mono>{m.docker}</Row>}
            {m.wsl && <Row label={'WSL distribution'}>{m.wsl}</Row>}
          </Section>
        )}

      </div>

      <Card index={4} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        {builtIn ? (
          <>
            <Button size="sm" variant="outline" className="h-7 rounded-md px-2.5 text-sm" onClick={onSettings}>
              {'Update settings…'}
            </Button>
            <span className="text-muted-foreground">{'Built in · can’t be removed'}</span>
          </>
        ) : (
          <>
            <span className="font-medium text-destructive">{'Danger zone'}</span>
            <Button size="sm" variant="outline" className="h-7 rounded-md border-destructive/30 px-2.5 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={!!held || pending !== null} onClick={onRemove}>
              <Trash2 className="size-3.5" />
              {`Remove ${m.name}…`}
            </Button>
            {held && <span className="text-muted-foreground">{heldWords(held)}</span>}
          </>
        )}
      </Card>
    </div>
  )
}

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: ReactNode }) {
  return (
    <Card index={1} className="flex flex-col gap-1 p-4">
      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-strong tracking-wide text-muted-foreground uppercase">
        <Icon aria-hidden="true" className="size-3.5" />
        {title}
      </h3>
      <dl className="flex flex-col divide-y divide-foreground/[0.05]">{children}</dl>
    </Card>
  )
}

function Row({ label, mono, tone, title, children }: { label: string; mono?: boolean; tone?: 'danger' | 'muted'; title?: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === ''
  return (
    <div className="grid grid-cols-[148px_minmax(0,1fr)] items-baseline gap-x-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-words', mono && 'font-mono text-xs-plus', tone === 'danger' && 'text-destructive', tone === 'muted' && 'text-muted-foreground', empty && 'text-faint')} title={title}>
        {empty ? '—' : children}
      </dd>
    </div>
  )
}
