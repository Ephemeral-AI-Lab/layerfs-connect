// This machine (storage-redesign §3.6): where SQLite Stores live. Free disk
// as gauges, the LayerFS box that opens every Store, and the home's facts.
import { TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'

import { count, useStorage } from '@/components/storage/actions'
import { Chip } from '@/components/storage/chips'
import { Breadcrumb } from '@/components/storage/detail/breadcrumb'
import { DetailHeader, Section } from '@/components/storage/detail/parts'
import { FamilyTile } from '@/components/storage/identity/store-icon'
import { Fact, workerChip, WorkerSection } from '@/components/storage/machine/worker'
import { DiskGauge, LOW_DISK } from '@/components/storage/meters'
import { Notice } from '@/components/storage/notice'
import { totalText } from '@/components/storage/size'
import { Loading } from '@/components/projects/states'

export function MachineDetail() {
  const s = useStorage()
  const st = s.status
  if (!st)
    return (
      <>
        <Breadcrumb items={[{ label: 'This machine' }]} />
        <Loading label="Reading this machine" />
      </>
    )
  const chip = workerChip(st)
  const sqlite = s.view.stores.list.filter((x) => x.kind === 'sqlite')
  const known = sqlite.filter((x) => x.size)
  const low = (n: number | null) => n !== null && n < LOW_DISK
  return (
    <>
      <Breadcrumb items={[{ label: 'This machine' }]} />
      <DetailHeader
        icon={<FamilyTile family="sqlite" size="lg" />}
        eyebrow="Where SQLite Stores live"
        title="This machine"
        badges={
          <Chip tone={chip.tone} live={chip.live}>
            {chip.label}
          </Chip>
        }
      >
        <p className="tabular-nums">
          {count(sqlite.length, 'Store')} · {totalText(known.reduce((n, x) => n + x.size!.bytes, 0), sqlite.length - known.length, sqlite.length)}
        </p>
        <p className="truncate font-mono text-xs text-faint" title={st.settings.home}>
          {st.settings.home}
        </p>
      </DetailHeader>

      {(low(st.disk.home) || low(st.disk.volumes)) && (
        <Notice tone="warning" icon={TriangleAlert} title="Disk space is low">
          Init and Commits write into the Store volumes, and a push stages a copy beside its Store; a full disk fails them.
        </Notice>
      )}

      <Section index={2} title="Disk" note="free space where the Stores are written">
        <dl className="grid grid-cols-1 gap-8 px-5 pt-3 pb-4 @min-[760px]/storage:grid-cols-2">
          <DiskGauge label="Beside the home" free={st.disk.home} index={3} />
          <DiskGauge label="For Docker volumes" free={st.disk.volumes} unknown="Docker is not answering" index={4} />
        </dl>
      </Section>

      <WorkerSection status={st} index={3} />

      <section className="surface reveal rounded-xl" style={{ '--i': 4 } as CSSProperties}>
        <dl className="grid grid-cols-2 gap-4 px-5 py-4 @min-[760px]/storage:grid-cols-3">
          <Fact label="Volume prefix" mono>
            {st.settings.containerPrefix}
          </Fact>
          <Fact label="Store volumes">{sqlite.filter((x) => x.volume).length}</Fact>
          <Fact label="Docker">{st.docker.level === 'ok' ? `running${st.docker.version ? ` · ${st.docker.version}` : ''}` : 'not answering'}</Fact>
        </dl>
      </section>
    </>
  )
}
