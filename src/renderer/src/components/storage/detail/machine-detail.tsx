// This machine: the LayerFS home and its sqlite Stores. Machines and their
// Stores are on Compute (LayerFS 2.0); there is no worker to watch.
import { Folder } from 'lucide-react'

import { Loading } from '@/components/projects/states'
import { count, useStorage } from '@/components/storage/actions'
import { Breadcrumb } from '@/components/storage/detail/breadcrumb'
import { DetailHeader, Section } from '@/components/storage/detail/parts'
import { FamilyTile } from '@/components/storage/identity/store-icon'
import { Fact } from '@/components/storage/machine/worker'
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
  const sqlite = s.view.stores.list.filter((x) => x.kind === 'sqlite')
  const known = sqlite.filter((x) => x.size)
  return (
    <>
      <Breadcrumb items={[{ label: t('This machine') }]} />
      <DetailHeader icon={<FamilyTile family="sqlite" size="lg" />} eyebrow={t('Where SQLite Stores live')} title={t('This machine')}>
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
      <Section index={2}>
        <dl className="grid grid-cols-2 gap-4 px-5 py-4 @min-[760px]/storage:grid-cols-3">
          <Fact label="LayerFS">{st.layerfs ?? t('unknown')}</Fact>
          <Fact label={t('Machines')}>{st.machines.length}</Fact>
          <Fact label={t('Stores')}>{st.stores}</Fact>
        </dl>
      </Section>
    </>
  )
}
