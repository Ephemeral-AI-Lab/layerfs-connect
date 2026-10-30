// Every Storage dialog, with one owner and one copy of each: StoragePage holds
// which one is open, and rows, cards and detail pages ask for one through
// useStorage().
import { Unlink, Unplug } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { count, type RemoveTarget, useStorage } from '@/components/storage/actions'
import { AddLocationDialog, type LocationFamily } from '@/components/storage/dialogs/add-location-dialog'
import { AddProjectDialog } from '@/components/storage/dialogs/add-project-dialog'
import { ConfirmByName } from '@/components/storage/dialogs/confirm-by-name'
import { ImportDialog } from '@/components/storage/dialogs/import-dialog'
import { LoadDialog } from '@/components/storage/dialogs/load-dialog'
import { NewStoreDialog } from '@/components/storage/dialogs/new-store-dialog'
import { PublishDialog } from '@/components/storage/dialogs/publish-dialog'
import { PullDialog, pullDiscards } from '@/components/storage/dialogs/pull-dialog'
import { PushConflictDialog } from '@/components/storage/dialogs/push-conflict-dialog'
import { SendDialog } from '@/components/storage/dialogs/send-dialog'
import { host } from '@/host/client'
import { t, useI18n } from '@/i18n'
import type { StoreInfo } from '@shared/host-api'

export type DialogState =
  | { kind: 'publish'; store: StoreInfo; remote?: string }
  | { kind: 'send'; store: StoreInfo }
  | { kind: 'load'; remote: string; file: string }
  | { kind: 'pull'; store: StoreInfo }
  | { kind: 'conflict'; store: StoreInfo }
  | { kind: 'unlink'; store: StoreInfo }
  | { kind: 'import'; store?: string; connection?: string }
  | { kind: 'location'; family?: LocationFamily; provider?: string }
  | { kind: 'new-store' }
  | { kind: 'add-project'; store: StoreInfo }
  | { kind: 'remove'; target: RemoveTarget }
  | null

/** What a removal says: what goes, what stays, and the name to type where data is lost. */
function removeText(target: RemoveTarget): { title: string; body: string; name?: string; action: string } {
  if (target.kind === 'store') {
    const st = target.store
    const n = st.projects.length
    if (st.kind === 'sqlite') {
      const what = n === 1 ? t('Deletes {store} and its project from this machine.', { store: st.name }) : t('Deletes {store} and all {n} of its projects from this machine.', { store: st.name, n })
      const stays = st.link ? ` ${t('Its linked file {where} stays.', { where: `${st.link.remote} / ${st.link.file}` })}` : ''
      return { title: t('Remove {name}?', { name: st.name }), body: what + stays, name: st.name, action: t('Remove Store') }
    }
    return {
      title: t('Remove {name}?', { name: st.name }),
      body: t('Drops the schema {schema} and {projects} from {where}.', { schema: st.schema ?? '', projects: count(n, 'project'), where: st.connection ?? t('its database') }),
      name: st.name,
      action: t('Remove Store'),
    }
  }
  if (target.kind === 'remote')
    return { title: t('Remove {name}?', { name: target.name }), body: t('The files in the bucket stay. LayerFS forgets the connection, and Connect deletes its keys. Refused while a Store links to it.'), action: t('Remove connection') }
  return {
    title: t('Forget {name}?', { name: target.name }),
    body: t('Its {stores} stay in the database. Connect forgets the URL and can’t open them until you add it again.', { stores: count(target.stores, 'Store') }),
    action: t('Forget connection'),
  }
}

interface StorageDialogsProps {
  dialog: DialogState
  setDialog: (d: DialogState) => void
  started: (job: unknown) => void
  reveal: (store: string) => void
  reload: () => void
}

export function StorageDialogs({ dialog: d, setDialog, started, reveal, reload }: StorageDialogsProps) {
  useI18n()
  const s = useStorage()
  const view = s.view
  const close = useCallback((open: boolean) => !open && setDialog(null), [setDialog])
  const remove = d?.kind === 'remove' ? d.target : null
  const taken = useMemo(() => new Set(view.stores.list.map((x) => x.name)), [view.stores.list])
  return (
    <>
      {d?.kind === 'publish' && <PublishDialog open onOpenChange={close} view={view} store={d.store} remote={d.remote} onDone={reveal} />}
      {d?.kind === 'send' && <SendDialog open onOpenChange={close} view={view} store={d.store} onDone={reveal} />}
      {d?.kind === 'load' && (
        <LoadDialog
          open
          onOpenChange={close}
          view={view}
          remote={d.remote}
          file={d.file}
          free={s.status?.disk.volumes ?? null}
          onDone={reveal}
          onOpenStore={(store) => {
            setDialog(null)
            s.open({ view: 'store', id: store })
          }}
        />
      )}
      {d?.kind === 'pull' && <PullDialog open onOpenChange={close} store={d.store} onPull={async (typed) => started(await host.pull(d.store.name, typed))} />}
      {d?.kind === 'conflict' && (
        <PushConflictDialog
          open
          onOpenChange={close}
          store={d.store}
          onOverwrite={async () => started(await host.push(d.store.name, { force: true }))}
          onPullFirst={() => {
            if (pullDiscards(d.store)) setDialog({ kind: 'pull', store: d.store })
            else {
              setDialog(null)
              void host.pull(d.store.name, d.store.name).then(started, () => undefined)
            }
          }}
        />
      )}
      {d?.kind === 'unlink' && d.store.link && (
        <ConfirmByName
          open
          onOpenChange={close}
          icon={Unlink}
          title={t('Unlink {name}?', { name: d.store.name })}
          body={t('{store} becomes local only. The file {where} stays in the bucket, not loaded, and can be loaded again.', { store: d.store.name, where: `${d.store.link.remote} / ${d.store.link.file}` })}
          name={d.store.name}
          action={t('Unlink')}
          onConfirm={async (typed) => {
            await host.unlink(d.store.name, typed)
            reload()
          }}
        />
      )}
      <ImportDialog
        open={d?.kind === 'import'}
        onOpenChange={close}
        view={view}
        store={d?.kind === 'import' ? d.store : undefined}
        connection={d?.kind === 'import' ? d.connection : undefined}
        onDone={reveal}
      />
      <AddLocationDialog
        open={d?.kind === 'location'}
        onOpenChange={close}
        view={view}
        family={d?.kind === 'location' ? d.family : undefined}
        provider={d?.kind === 'location' ? d.provider : undefined}
        onChanged={reload}
      />
      <NewStoreDialog
        open={d?.kind === 'new-store'}
        onOpenChange={close}
        taken={taken}
        onCreated={(name) => {
          reload()
          reveal(name)
        }}
      />
      {d?.kind === 'add-project' && <AddProjectDialog store={d.store} open onOpenChange={close} onDone={reload} />}
      {remove && (
        <ConfirmByName
          open
          onOpenChange={close}
          icon={remove.kind === 'connection' ? Unplug : undefined}
          {...removeText(remove)}
          onConfirm={async (typed) => {
            if (remove.kind === 'store') await host.removeStore(remove.store.name, typed)
            else if (remove.kind === 'remote') await host.removeRemote(remove.name)
            else await host.removePostgresql(remove.name)
            reload()
            s.open({ view: 'overview' })
          }}
        />
      )}
    </>
  )
}
