import { t, useI18n } from '@/i18n'
// The Sandboxes tab's tiles: one card per open Sandbox with its Workspace
// slots and each mounted Workspace's Branch; closed Sandboxes in a quiet row
// under them. A running Sandbox glows: its edge carries a turning band of
// light, its icon pulses and bytes travel from each Workspace to its Branch.
// Cards and Workspaces rise in as they appear.
import type { SandboxInfo } from '@shared/host-api'
import type { CSSProperties } from 'react'
import { FolderTree } from 'lucide-react'

import { SANDBOX_CAPACITY, sandboxTone } from '@/components/compute/sandbox-list'
import { LfsBranch, LfsSandbox, LfsWorkspace } from '@/components/lfs-icons'
import { revealStyle, spotlight } from '@/components/motion'
import { Chip } from '@/components/storage/chips'
import { shortDigest } from '@/data/format'
import { cn } from '@/lib/utils'

import '@/components/storage/storage.css'

/** The Sandbox's Workspace slots: a lit square per mounted Workspace. */
function Slots({ used }: { used: number }) {
  useI18n()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="grid grid-cols-16 gap-[3px]" aria-hidden="true">
        {Array.from({ length: SANDBOX_CAPACITY }, (_, i) => (
          <span key={i} data-on={i < used} className="sc-slot size-2 rounded-[2px]" style={{ '--d': `${250 + i * 50}ms` } as CSSProperties} />
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">{used}</span> / {SANDBOX_CAPACITY}{t("Workspaces")}</span>
    </div>
  )
}

function SandboxTile({ s, index, reading, onBrowseFiles }: { s: SandboxInfo; index: number; reading?: boolean; onBrowseFiles?: (branch: string) => void }) {
  useI18n()
  const state = sandboxTone(s.state)
  const running = s.state === 'running'
  return (
    <article
      onPointerMove={spotlight}
      className={cn('glass-liquid card-hover sheen-sweep spotlight reveal flex min-w-0 flex-col rounded-xl', running && 'live-border')}
      style={revealStyle(index)}
      aria-label={t("Sandbox {value1}, {value2}", {value1: s.name, value2: t(state.label)})}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 pt-4">
        <span
          className={cn(
            'relative flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
            running ? 'bg-primary/10 text-primary ring-primary/25' : 'bg-muted text-muted-foreground ring-foreground/[0.07]',
          )}
        >
          <LfsSandbox className="relative size-[18px]" />
          {running && <span aria-hidden="true" className="pulse-ring absolute -top-0.5 -right-0.5 size-2 rounded-full bg-success text-success" />}
        </span>
        <div className="min-w-0 flex-1 basis-36">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 max-w-full break-all font-mono text-[13px] font-medium" title={s.name}>
              {s.name}
            </p>
            <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[10px] font-medium text-foreground/80 ring-1 ring-border">{t("Docker")}</span>
          </div>
          <p className="break-all text-xs text-faint">{t("Sandbox ")}{s.id}</p>
        </div>
        <Chip tone={state.tone} live={state.live}>
          {t(state.label)}
        </Chip>
      </header>
      <div className="px-4 pt-3.5">
        <Slots used={s.workspaces.length} />
      </div>
      <ul className="mt-3 flex flex-1 flex-col gap-1.5 px-4" aria-label={t("Mounted Workspaces")}>
        {s.reach ? (
          <li className="flex items-center gap-2 rounded-lg border border-dashed border-warning/40 px-3 py-2.5 text-xs text-warning" title={s.detail}>
            <LfsWorkspace className="size-3.5 opacity-60" />
            {s.reach === 'busy' ? t('Busy: its daemon did not answer in time, so its Workspaces are not shown') : t('Not reachable: its daemon refused, so its Workspaces are not shown')}
          </li>
        ) : reading && s.workspaces.length === 0 && running ? (
          <li className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs text-faint">
            <LfsWorkspace className="size-3.5 animate-pulse opacity-60" />{t('Reading its Workspaces…')}</li>
        ) : s.workspaces.length === 0 ? (
          <li className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs text-faint">
            <LfsWorkspace className="size-3.5 opacity-60" />{t("No Workspace mounted")}</li>
        ) : (
          s.workspaces.map((ws, k) => (
            <li
              key={ws.ws}
              className="reveal flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs ring-1 ring-foreground/[0.05] ring-inset"
              style={revealStyle(index + k + 2)}
            >
              <LfsWorkspace className={cn('size-3.5 shrink-0', running ? 'text-primary' : 'text-muted-foreground')} />
              <span className="min-w-0 max-w-full break-all font-mono" title={ws.path}>
                {ws.path}
              </span>
              <span aria-hidden="true" data-live={running} className="sc-wire mx-1 min-w-6 flex-1" />
              <span className="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-card px-1.5 py-0.5 font-medium shadow-elev-1 ring-1 ring-foreground/10">
                <LfsBranch className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-all">{ws.branch || t('Unknown branch')}</span>
              </span>
              {onBrowseFiles && ws.branch && (
                <button
                  type="button"
                  onClick={() => onBrowseFiles(ws.branch)}
                  title={t('Browse the files on {branch}', { branch: ws.branch })}
                  className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FolderTree className="size-3" />
                  {t('Browse files')}
                </button>
              )}
            </li>
          ))
        )}
      </ul>
      <footer className="mt-3.5 flex items-center gap-2 border-t px-4 py-2.5 font-mono text-[11px] text-faint" title={s.image ?? undefined}>
        <span className="font-sans">{t("image")}</span>
        <span className="truncate">{shortDigest(s.image)}</span>
      </footer>
    </article>
  )
}

/** Open Sandboxes as tiles, closed ones as a row of names. */
export function SandboxTiles({ sandboxes, reading, onBrowseFiles }: { sandboxes: SandboxInfo[]; reading?: boolean; onBrowseFiles?: (branch: string) => void }) {
  useI18n()
  const open = sandboxes.filter((s) => s.state !== 'gone')
  const closed = sandboxes.filter((s) => s.state === 'gone')
  return (
    <div className="@container/sandboxes flex min-w-0 flex-col gap-4">
      <div className="grid gap-3 @min-[44rem]/sandboxes:grid-cols-2">
        {open.map((s, i) => (
          <SandboxTile key={s.id} s={s} index={i} reading={reading} onBrowseFiles={onBrowseFiles} />
        ))}
        {open.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
            <LfsSandbox className="size-6 text-faint" />
            <p className="text-sm font-medium">{t("No active Sandboxes")}</p>
            <p className="text-xs text-muted-foreground">{t("Sandboxes connected to this project will appear here.")}</p>
          </div>
        )}
      </div>
      {closed.length > 0 && (
        <div className="reveal flex flex-wrap items-center gap-2 text-xs text-faint" style={revealStyle(open.length + 2)}>
          <span className="font-medium">{t("Closed")}</span>
          {closed.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5 rounded-md bg-muted/70 px-2 py-1 font-mono text-muted-foreground ring-1 ring-foreground/[0.05] ring-inset">
              <LfsSandbox className="size-3.5 opacity-60" />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
