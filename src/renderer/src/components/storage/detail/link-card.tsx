// A SQLite Store's link (storage-links §3.2): the one remote file it pushes
// to and pulls from (layerfs#509). Linked: the connection and file, when it
// was linked, its last push or pull, the sync pill with its reason, and both
// sides in words; Push, Pull, Check now, and Send a copy… and Unlink… in a
// menu. Local only: one sentence and Publish…. After a Send, a notice names
// the new file with Load.
import { ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpFromLine, CloudUpload, Copy, CopyPlus, Download, Ellipsis, RefreshCw, Unlink } from 'lucide-react'
import { useState } from 'react'

import { count, middle, useStorage } from '@/components/storage/actions'
import { Section } from '@/components/storage/detail/parts'
import { message } from '@/components/storage/dialogs/fields'
import { providerLabel } from '@/components/storage/identity/providers'
import { ProviderTile } from '@/components/storage/identity/store-icon'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { isFailed, isRunning } from '@/components/storage/transfers/phases'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ago, bytes, when } from '@/data/format'
import { cn } from '@/lib/utils'
import type { StoreInfo, StoreLink } from '@shared/host-api'

/** "your push 3 h ago", "the last push or pull". */
const since = (link: StoreLink) => (link.last?.at ? `your ${link.last.direction} ${ago(link.last.at)}` : 'the last push or pull')

/** This machine's side, in words. */
function localWords(store: StoreInfo, link: StoreLink): string {
  if (link.local === 'changed') return `Changed since ${since(link)}`
  if (link.local === 'same') return `Unchanged since ${since(link)}`
  return `Can’t tell whether ${store.name} changed since ${since(link)}`
}

/** The linked file's side, in words. */
function remoteWords(link: StoreLink): string {
  const c = link.check
  if (link.remoteSide === 'missing') return 'Missing: the linked file was deleted'
  if (link.remoteSide === 'same') return `Same as ${since(link)}`
  if (link.remoteSide === 'changed') return `Changed since: ${bytes(c?.bytes)}${c?.modified ? `, modified ${ago(c.modified)}` : ''}`
  if (link.failedCheck) return `Didn’t answer ${ago(link.failedCheck.at)}${link.failedCheck.error ? `: ${link.failedCheck.error.message}` : ''}`
  return 'Not checked'
}

function Side({ label, words, detail }: { label: string; words: string; detail: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg bg-muted/45 px-3.5 py-2.5 ring-1 ring-foreground/[0.05] ring-inset">
      <p className="truncate text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium text-pretty">{words}</p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{detail}</p>
    </div>
  )
}

/** THIS MACHINE ↔ the linked file, with the way a transfer would go. */
function TwoSides({ store, link }: { store: StoreInfo; link: StoreLink }) {
  const way = link.sync === 'ahead' || link.sync === 'missing' ? 'push' : link.sync === 'behind' ? 'pull' : link.sync === 'diverged' ? 'both' : null
  const Arrow = way === 'both' ? ArrowLeftRight : ArrowRight
  const c = link.check
  return (
    <div className="mt-3 flex flex-col items-stretch gap-2 @min-[760px]/storage:flex-row @min-[760px]/storage:items-center">
      <Side label="This machine" words={localWords(store, link)} detail={store.size ? `${bytes(store.size.bytes)} now` : 'size unknown'} />
      <span
        role="img"
        aria-label={way === 'push' ? 'A push goes this way' : way === 'pull' ? 'A pull goes this way' : way === 'both' ? 'Both sides changed' : 'No transfer needed'}
        className={cn(
          'flex shrink-0 items-center justify-center self-center',
          way === 'both' ? 'text-destructive' : way ? 'text-primary' : 'text-faint',
          way === 'pull' ? 'rotate-90 @min-[760px]/storage:rotate-180' : 'rotate-90 @min-[760px]/storage:rotate-0',
        )}
      >
        <Arrow className="size-5" strokeWidth={way === 'both' ? 2 : 2.25} />
      </span>
      <Side
        label={`${link.remote} / ${link.file}`}
        words={remoteWords(link)}
        detail={c?.present ? `${bytes(c.bytes)} file · checked ${ago(c.at)}` : c ? `checked ${ago(c.at)}` : link.last?.bytes != null ? `${bytes(link.last.bytes)} at the last ${link.last.direction}` : 'not checked yet'}
      />
    </div>
  )
}

/** The Store's latest Send that ended well, while the page keeps it: "Sent to r2-team / x" with Load. */
function SentNotice({ store }: { store: StoreInfo }) {
  const s = useStorage()
  const sent = s.transfers.all.find((j) => j.kind === 'send' && j.store === store.name && !isRunning(j) && !isFailed(j))
  if (!sent?.file) return null
  const file = s.view.remotes.list.find((r) => r.name === sent.target)?.files?.find((f) => f.file === sent.file)
  if (file?.linkedBy) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-t bg-primary/[0.03] px-5 py-2.5 text-[13px]">
      <CopyPlus aria-hidden="true" className="size-4 text-primary" />
      <span>
        Sent to{' '}
        <span className="font-mono text-[12.5px]">
          {sent.target} / {sent.file}
        </span>
        {sent.ended ? <span className="text-muted-foreground"> · {ago(sent.ended)}</span> : null}
      </span>
      <Button size="xs" variant="outline" className="ml-auto" onClick={() => s.load({ remote: sent.target, file: sent.file! })}>
        <Download /> Load…
      </Button>
    </div>
  )
}

function LinkMenu({ store }: { store: StoreInfo }) {
  const s = useStorage()
  const running = !!s.transfers.runningFor(store.name)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`More for ${store.name}'s link`} className="text-muted-foreground">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => s.send(store)} disabled={running || !store.projects.length}>
          <CopyPlus className="text-muted-foreground" /> Send a copy…
        </DropdownMenuItem>
        {store.link && (
          <DropdownMenuItem onSelect={() => s.unlink(store)} disabled={running}>
            <Unlink className="text-muted-foreground" /> Unlink…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function LinkCard({ store, index }: { store: StoreInfo; index?: number }) {
  const s = useStorage()
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const remotes = s.view.remotes
  const link = store.link
  const running = !!s.transfers.runningFor(store.name)
  const go = (fn: () => Promise<void>) => {
    setError(undefined)
    fn().catch((e: unknown) => setError(message(e)))
  }
  const copyPath = () => {
    if (!link) return
    void navigator.clipboard?.writeText(link.object).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  const showPanel = !!link && link.sync !== 'in_sync' && link.sync !== 'unknown' && link.sync !== 'checking' && link.sync !== 'unreachable'
  return (
    <Section
      index={index}
      title="Link"
      note={`The one remote file this Store pushes to and pulls from. A push uploads ${store.projects.length === 1 ? 'its project' : `all ${count(store.projects.length, 'project')}`}; a pull replaces them.`}
      aside={
        link &&
        s.view.supports.check && (
          <Button size="sm" variant="ghost" onClick={() => void s.check({ store: store.name })} disabled={s.checking}>
            <RefreshCw className={s.checking ? 'animate-spin' : undefined} /> Check now
          </Button>
        )
      }
    >
      {!remotes.available ? (
        <p className="px-5 pt-2 pb-4 text-xs text-faint">{remotes.reason}</p>
      ) : !link ? (
        <div className="flex flex-wrap items-center gap-3 px-5 pt-2 pb-4">
          <p className="text-[13px] text-muted-foreground">Not linked to any remote file.</p>
          <Button size="sm" disabled={running || !store.projects.length} title={!store.projects.length ? 'Nothing to publish yet' : undefined} onClick={() => s.publish(store)}>
            <CloudUpload /> Publish…
          </Button>
          <LinkMenu store={store} />
        </div>
      ) : (
        <div className="px-5 pt-3 pb-4">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <ProviderTile provider={link.provider} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button type="button" onClick={() => s.open({ view: 'location', id: link.remote })} className="rounded-sm font-mono text-[13.5px] font-semibold outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                  {link.remote}
                </button>
                <span aria-hidden="true" className="text-faint">
                  /
                </span>
                <span className="font-mono text-[13.5px]">{link.file}</span>
                <span className="text-xs text-muted-foreground">{providerLabel(link.provider)}</span>
              </div>
              <button
                type="button"
                onClick={copyPath}
                title={`${link.object} (click to copy)`}
                className="group mt-0.5 inline-flex max-w-full items-center gap-1 rounded-sm font-mono text-[11.5px] text-faint outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate">{middle(link.object, 64)}</span>
                <Copy aria-hidden="true" className="size-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
                <span aria-live="polite" className="shrink-0 font-sans text-success">
                  {copied ? 'Copied' : ''}
                </span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={running || !store.projects.length} title={running ? 'A transfer is running' : undefined} onClick={() => go(() => s.push(store))} aria-label={`Push ${store.name} to ${link.remote} / ${link.file}`}>
                <ArrowUpFromLine /> Push
              </Button>
              <Button size="sm" variant="outline" disabled={running} onClick={() => go(() => s.pull(store))} aria-label={`Pull ${store.name} from ${link.remote} / ${link.file}`}>
                <ArrowDownToLine /> Pull
              </Button>
              <LinkMenu store={store} />
            </div>
          </div>
          <div className="mt-2.5 pl-10 @max-[759px]/storage:pl-0">
            <SyncPill state={link.sync} copy={link} />
            {link.reason && link.sync !== 'in_sync' && <p className="mt-1.5 text-[12.5px] text-muted-foreground text-pretty">{link.reason}</p>}
            {showPanel && <TwoSides store={store} link={link} />}
            <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
              <span title={when(link.linked)}>Linked {link.linked ? ago(link.linked) : '—'}</span>
              <span title={when(link.last?.at)}>
                Last {link.last ? `${link.last.direction} ${ago(link.last.at)}${link.last.bytes !== null ? ` · ${bytes(link.last.bytes)}` : ''}` : 'push or pull: none yet'}
              </span>
              {link.check && <span title={when(link.check.at)}>Checked {ago(link.check.at)}</span>}
            </p>
            {error && (
              <p role="alert" className="mt-2 text-[12px] break-words text-destructive">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
      <SentNotice store={store} />
    </Section>
  )
}
