// Add a connection (storage-redesign §3.7): one dialog, two steps. The picker
// lists every provider in the registry, available ones as glass tiles and the
// rest as quiet dashed "Coming" tiles; the second step is that provider's
// form. After an add, the dialog stays open on one line while the host runs
// the first check, so the user leaves knowing whether it is reachable.
import { ChevronLeft, CircleCheck, Clock, LoaderCircle, Plus, Search, TriangleAlert } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react'

import { BTN, FormError, message, SHEET, SheetFooter, SheetHeader } from '@/components/storage/dialogs/fields'
import { formState, initialValues, PostgresqlForm, postgresqlState, ProviderForm, type PostgresqlValues } from '@/components/storage/dialogs/provider-forms'
import { type FieldValues, PROVIDERS, providerEntry, providerInfos, providerMatches, type ProviderEntry } from '@/components/storage/identity/providers'
import { FamilyTile, ProviderTile } from '@/components/storage/identity/store-icon'
import { normalizeView } from '@/components/storage/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { host } from '@/host/client'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { StorageView } from '@shared/host-api'

/** After adding a bucket: reachable, and what it holds (each file Loads from the bucket's page). */
function reachableBucket(files: { linkedBy: string | null }[] | null | undefined): string {
  if (!files) return t('Reachable. Open it to see its files.')
  if (!files.length) return t('Reachable. No Store files yet: publish a Store to it.')
  const loose = files.filter((f) => !f.linkedBy).length
  return loose ? t('Reachable. {n} Store files, {loose} not loaded: open it to Load.', { n: files.length, loose }) : t('Reachable. {n} Store files.', { n: files.length })
}

export type LocationFamily = 'copy' | 'database'

type Step = { kind: 'pick' } | { kind: 'copy'; entry: ProviderEntry } | { kind: 'postgresql' }
type After = { state: 'checking' | 'ok' | 'failed'; text: string; name: string; what: 'remote' | 'connection' }

interface AddLocationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: StorageView
  /** Open filtered to one family (the header's Add connection ▾ menu). */
  family?: LocationFamily
  /** Open on one provider's form. */
  provider?: string
  /** The view changed: a connection was added or removed. */
  onChanged: () => void
}

const PG_DEFAULT = (taken: Set<string>): PostgresqlValues => ({ name: taken.size ? '' : 'main', url: 'postgresql://layerfs@localhost:5432/layerfs', synchronousCommit: 'off' })

/** A picker tile: the mark, the label, and "N added" or "Coming". */
function PickTile({ label, mark, added, coming, reason, onPick }: { label: string; mark: React.ReactNode; added: number; coming: boolean; reason: string | null; onPick: () => void }) {
  const tile = (
    <button
      type="button"
      data-tile
      aria-disabled={coming || undefined}
      onClick={coming ? undefined : onPick}
      className={cn(
        'group flex min-h-[92px] w-full flex-col items-start gap-2.5 p-3 text-left outline-none transition-[background-color,border-color,box-shadow,transform] duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring',
        coming ? 'sc-soon cursor-default rounded-2xl' : 'glass-liquid card-hover rounded-2xl shadow-xs hover:border-primary/35',
      )}
    >
      <span className={cn(coming && 'sc-soon-mark')}>{mark}</span>
      <span className="min-w-0">
        <span className={cn('block text-[13px] leading-4 font-semibold', coming && 'text-muted-foreground')}>{label}</span>
        <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          {coming ? (
            <>
              <Clock aria-hidden="true" className="size-3" /> {t('Coming')}
            </>
          ) : added ? (
            t('{n} added', { n: added })
          ) : (
            t('Add one')
          )}
        </span>
      </span>
    </button>
  )
  if (!coming) return tile
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent className="max-w-72">{reason ? t(reason) : t('Not available yet')}</TooltipContent>
    </Tooltip>
  )
}

/** Arrow keys move between tiles in the grid; Home and End jump. */
function roving(e: KeyboardEvent<HTMLDivElement>) {
  const tiles = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-tile]')]
  const at = tiles.indexOf(document.activeElement as HTMLButtonElement)
  if (at < 0) return
  const grid = e.currentTarget.querySelector<HTMLElement>('[data-grid]')
  const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 4
  const to = { ArrowRight: at + 1, ArrowLeft: at - 1, ArrowDown: at + cols, ArrowUp: at - cols, Home: 0, End: tiles.length - 1 }[e.key]
  if (to === undefined) return
  e.preventDefault()
  tiles[Math.max(0, Math.min(tiles.length - 1, to))]?.focus()
}

function GroupHead({ id, title, about }: { id: string; title: string; about: string }) {
  return (
    <header className="mb-2.5 flex flex-wrap items-baseline gap-x-2">
      <h3 id={id} className="text-[10.5px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
        {title}
      </h3>
      <span className="text-[11.5px] text-muted-foreground">{about}</span>
    </header>
  )
}

export function AddLocationDialog({ open, onOpenChange, view, family, provider, onChanged }: AddLocationDialogProps) {
  useI18n()
  const remotesTaken = useMemo(() => new Set(view.remotes.list.map((r) => r.name)), [view.remotes.list])
  const pgTaken = useMemo(() => new Set(view.postgresql.connections.map((c) => c.name)), [view.postgresql.connections])
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  const [search, setSearch] = useState('')
  const [values, setValues] = useState<FieldValues>({})
  const [pg, setPg] = useState<PostgresqlValues>(() => PG_DEFAULT(pgTaken))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [after, setAfter] = useState<After | null>(null)

  const choose = (next: Step) => {
    setError(undefined)
    setAfter(null)
    if (next.kind === 'copy') setValues(initialValues(next.entry, remotesTaken))
    if (next.kind === 'postgresql') setPg(PG_DEFAULT(pgTaken))
    setStep(next)
  }

  // a fresh dialog each time it opens, on the picker or the asked-for form
  useEffect(() => {
    if (!open) return
    setSearch('')
    if (provider === 'postgresql') choose({ kind: 'postgresql' })
    else if (provider) choose({ kind: 'copy', entry: providerEntry(provider) })
    else choose({ kind: 'pick' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider])

  const infos = providerInfos(view)
  const added = (id: string) => view.remotes.list.filter((r) => r.provider === id).length
  const copyTiles = PROVIDERS.filter((p) => providerMatches(p, search))
    .map((p) => ({ entry: p, info: infos.find((i) => i.id === p.id) }))
    .sort((a, b) => Number(!!b.info?.available) - Number(!!a.info?.available) || added(String(b.entry.id)) - added(String(a.entry.id)) || a.entry.label.localeCompare(b.entry.label))
  const pgMatches = !search.trim() || 'postgresql postgres database pg'.includes(search.trim().toLowerCase())
  const showSearch = PROVIDERS.length + 1 > 8

  const copyForm = step.kind === 'copy' ? formState(step.entry, values, remotesTaken) : null
  const pgForm = step.kind === 'postgresql' ? postgresqlState(pg, pgTaken) : null
  const form = copyForm ?? pgForm
  const locked = busy || after?.state === 'checking'

  const firstCheck = async (name: string, what: After['what']) => {
    const supported = what === 'remote' ? view.supports.check : view.supports.postgresqlStatus
    if (!supported) return onOpenChange(false)
    setAfter({ state: 'checking', text: t('Checking {name}…', { name }), name, what })
    try {
      const v = normalizeView(await host.checkStorage(what === 'remote' ? { remote: name } : { connection: name }))
      onChanged()
      const h = what === 'remote' ? v.remotes.list.find((r) => r.name === name)?.health : v.postgresql.connections.find((c) => c.name === name)?.health
      const version = what === 'connection' ? v.postgresql.connections.find((c) => c.name === name)?.health.serverVersion : null
      if (h?.state === 'ok')
        setAfter({ state: 'ok', text: what === 'remote' ? reachableBucket(v.remotes.list.find((r) => r.name === name)?.files) : `${t('Reachable.')}${version ? ` PostgreSQL ${version}.` : ''}`, name, what })
      else setAfter({ state: 'failed', text: `${t('Added, but not reachable')}${h?.message ? `: ${h.message}` : '.'}`, name, what })
    } catch (e) {
      setAfter({ state: 'failed', text: `${t('Added, but the check failed')}: ${message(e)}`, name, what })
    }
  }

  const add = async () => {
    if (!form?.ready || locked) return
    setBusy(true)
    setError(undefined)
    try {
      if (step.kind === 'copy' && step.entry.request) {
        await host.addRemote(step.entry.request(values))
        onChanged()
        setBusy(false)
        await firstCheck(values.name, 'remote')
      } else if (step.kind === 'postgresql') {
        await host.addPostgresql(pg)
        onChanged()
        setBusy(false)
        await firstCheck(pg.name, 'connection')
      }
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  /** "Remove it": back to the form with the fields kept and the secret cleared. */
  const undo = async () => {
    if (!after) return
    setBusy(true)
    try {
      await (after.what === 'remote' ? host.removeRemote(after.name) : host.removePostgresql(after.name))
      onChanged()
      setAfter(null)
      setValues((v) => ({ ...v, secretKey: '' }))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const entry = step.kind === 'copy' ? step.entry : null
  return (
    <Dialog open={open} onOpenChange={(next) => (locked && !next ? undefined : onOpenChange(next))}>
      <DialogContent className={`${SHEET} sm:max-w-[640px]`}>
        {step.kind === 'pick' ? (
          <>
            <SheetHeader icon={Plus} title={t('Add a connection')}>
              {t('A bucket that holds SQLite Store files, or a database where PostgreSQL Stores live. Adding one links no Store.')}
            </SheetHeader>
            {showSearch && (
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search providers')} aria-label={t('Search providers')} className="rounded-xl pl-8.5" />
              </div>
            )}
            <div className="flex flex-col gap-5" onKeyDown={roving}>
              {family !== 'database' && (
                <section aria-labelledby="add-copy-h">
                  <GroupHead id="add-copy-h" title={t('Buckets')} about={t('For SQLite Stores: publish, push, pull and load whole Store files')} />
                  {copyTiles.length ? (
                    <div data-grid className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      {copyTiles.map(({ entry: p, info }) => (
                        <PickTile
                          key={String(p.id)}
                          label={p.label}
                          mark={<ProviderTile provider={String(p.id)} size="sm" />}
                          added={added(String(p.id))}
                          coming={!info?.available}
                          reason={info?.reason ?? null}
                          onPick={() => choose({ kind: 'copy', entry: p })}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('No bucket provider matches “{q}”.', { q: search })}</p>
                  )}
                </section>
              )}
              {family !== 'copy' && pgMatches && (
                <section aria-labelledby="add-db-h">
                  <GroupHead id="add-db-h" title={t('Live databases')} about={t('For PostgreSQL Stores: live, nothing to sync')} />
                  <div data-grid className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <PickTile
                      label="PostgreSQL"
                      mark={<FamilyTile family="postgresql" size="sm" />}
                      added={view.postgresql.connections.length}
                      coming={!view.postgresql.available}
                      reason={view.postgresql.reason}
                      onPick={() => choose({ kind: 'postgresql' })}
                    />
                  </div>
                </section>
              )}
            </div>
            <SheetFooter>
              <Button type="button" variant="outline" size="sm" className={BTN} onClick={() => onOpenChange(false)}>
                {t('Cancel')}
              </Button>
            </SheetFooter>
          </>
        ) : (
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (after?.state === 'ok' || after?.state === 'failed') onOpenChange(false)
              else void add()
            }}
          >
            <SheetHeader mark={entry ? <ProviderTile provider={String(entry.id)} size="sm" /> : <FamilyTile family="postgresql" size="sm" />} title={entry ? t('Add a {provider} bucket', { provider: entry.label }) : t('Add a PostgreSQL connection')}>
              {entry ? t(entry.about) : t('A database that holds PostgreSQL Stores live, one schema each. The LayerFS box connects directly.')}
            </SheetHeader>
            {!provider && (
              <Button type="button" size="xs" variant="ghost" className="-mt-3 w-fit rounded-lg" onClick={() => choose({ kind: 'pick' })} disabled={locked || !!after}>
                <ChevronLeft /> {t('All providers')}
              </Button>
            )}
            {entry && copyForm && <ProviderForm entry={entry} values={values} onChange={setValues} problems={copyForm.problems} disabled={locked || !!after} />}
            {pgForm && <PostgresqlForm values={pg} onChange={setPg} problems={pgForm.problems} disabled={locked || !!after} />}
            {after && (
              <div
                role="status"
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-medium',
                  after.state === 'ok' ? 'bg-success/[0.08] text-success' : after.state === 'failed' ? 'bg-warning/[0.08] text-warning' : 'bg-muted/60',
                )}
              >
                {after.state === 'checking' ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-primary" />
                ) : after.state === 'ok' ? (
                  <CircleCheck aria-hidden="true" className="size-4" />
                ) : (
                  <TriangleAlert aria-hidden="true" className="size-4" />
                )}
                <span className={cn('min-w-0 break-words', after.state === 'checking' && 'text-muted-foreground')}>{after.text}</span>
              </div>
            )}
            <FormError error={error} />
            {!after && form && form.missing.length > 0 && <p className="-mb-2 text-right text-[11.5px] text-muted-foreground">{t('Still needed: {fields}.', { fields: form.missing.join(', ') })}</p>}
            <SheetFooter>
              {after?.state === 'failed' ? (
                <>
                  <Button type="button" variant="outline" size="sm" className={BTN} onClick={() => void undo()} disabled={busy}>
                    {t('Remove it')}
                  </Button>
                  <Button type="submit" size="sm" className={BTN}>
                    {t('Keep it')}
                  </Button>
                </>
              ) : after?.state === 'ok' ? (
                <Button type="submit" size="sm" className={BTN}>
                  {t('Done')}
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" size="sm" className={BTN} onClick={() => onOpenChange(false)} disabled={locked}>
                    {t('Cancel')}
                  </Button>
                  <Button type="submit" size="sm" className={BTN} disabled={!form?.ready || locked}>
                    {locked ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    {after?.state === 'checking' ? t('Checking…') : busy ? t('Adding…') : t('Add connection')}
                  </Button>
                </>
              )}
            </SheetFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
