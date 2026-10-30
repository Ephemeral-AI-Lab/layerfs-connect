// This machine (storage-redesign §3.6): where SQLite Stores live. Free disk
// as gauges, the LayerFS box that opens every Store, and the home's facts.
import { Folder, HardDrive, TriangleAlert } from 'lucide-react'

import { Loading } from '@/components/projects/states'
import { count, useStorage } from '@/components/storage/actions'
import { Chip } from '@/components/storage/chips'
import { Breadcrumb } from '@/components/storage/detail/breadcrumb'
import { DetailHeader, Section } from '@/components/storage/detail/parts'
import { FamilyTile } from '@/components/storage/identity/store-icon'
import { Fact, workerChip, WorkerSection } from '@/components/storage/machine/worker'
import { DiskGauge, LOW_DISK } from '@/components/storage/meters'
import { Notice } from '@/components/storage/notice'
import { totalText } from '@/components/storage/size'
import { t, useI18n } from '@/i18n'

export function MachineDetail() {
  useI18n()
  const s = useStorage()
  const st = s.status
  if (!st)
    return (
      <>
        <Breadcrumb items={[{ label: t('This machine') }]} />
        <Loading label={t('Reading this machine')} />
      </>
    )
  const chip = workerChip(st)
  const sqlite = s.view.stores.list.filter((x) => x.kind === 'sqlite')
  const known = sqlite.filter((x) => x.size)
  const low = (n: number | null) => n !== null && n < LOW_DISK
  return (
    <>
      <Breadcrumb items={[{ label: t('This machine') }]} />
      <DetailHeader
        icon={<FamilyTile family="sqlite" size="lg" />}
        eyebrow={t('Where SQLite Stores live')}
        title={t('This machine')}
        badges={
          <Chip tone={chip.tone} live={chip.live}>
            {t(chip.label)}
          </Chip>
        }
      >
        <p className="tabular-nums">
          {count(sqlite.length, 'Store')} · {totalText(known.reduce((n, x) => n + x.size!.bytes, 0), sqlite.length - known.length, sqlite.length)}
        </p>
        <p className="mt-1 inline-flex max-w-full items-center gap-2 self-start rounded-xl bg-muted/40 px-3 py-1 ring-1 ring-border/50">
          <Folder aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate font-mono" title={st.settings.home}>
            {st.settings.home}
          </span>
        </p>
      </DetailHeader>

      {(low(st.disk.home) || low(st.disk.volumes)) && (
        <Notice tone="warning" icon={TriangleAlert} title={t('Disk space is low')}>
          {t('Init and Commits write into the Store volumes, and a push stages a copy beside its Store; a full disk fails them.')}
        </Notice>
      )}

      <Section
        index={2}
        title={
          <span className="flex items-center gap-2">
            <HardDrive aria-hidden="true" className="size-4 text-primary" /> {t('Disk')}
          </span>
        }
        note={t('Free space where the Stores are written')}
      >
        <dl className="grid grid-cols-1 gap-8 px-5 pt-4 pb-5 @min-[760px]/storage:grid-cols-2">
          <DiskGauge label={t('Beside the home')} free={st.disk.home} index={3} />
          <DiskGauge label={t('For Docker volumes')} free={st.disk.volumes} unknown={t('Docker is not answering')} index={4} />
        </dl>
      </Section>

      <WorkerSection status={st} index={3} />

      <Section index={4}>
        <dl className="grid grid-cols-2 gap-4 px-5 py-4 @min-[760px]/storage:grid-cols-3">
          <Fact label={t('Volume prefix')} mono>
            {st.settings.containerPrefix}*
          </Fact>
          <Fact label={t('Store volumes')}>{sqlite.filter((x) => x.volume).length}</Fact>
          <Fact label="Docker">{st.docker.level === 'ok' ? `${t('running')}${st.docker.version ? ` · ${st.docker.version}` : ''}` : t('not answering')}</Fact>
        </dl>
      </Section>
    </>
  )
}
