// Compute's top-level Sandboxes table (#537 §6, U6): every Sandbox in the
// home by name, as sandbox.list answers it (project, machine, backend, kernel
// route, state and any operation in flight). A row opens its Workspaces
// (sandbox.get) with their names, and closes it; an unresolved Sandbox shows
// the call that clears it. Project and machine names link to their pages.
import { ChevronRight, LoaderCircle } from 'lucide-react'
import { useState } from 'react'

import { Collapse, revealStyle } from '@/components/motion'
import { CloseSandbox } from '@/components/projects/sandbox-tiles'
import { Refusal } from '@/components/refusal'
import { StateChip } from '@/components/state-chip'
import { Card } from '@/components/storage/overview/row-parts'
import { clearingCall } from '@/data/states'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { MachineSandbox } from '@shared/host-api'

import { SANDBOX_CAPACITY } from './sandbox-list'

const COLS = '@min-[46rem]/sbx:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_4rem_1rem]'

export function SandboxesTable({ sandboxes, onChanged, onOpenProject, onShowMachine }: { sandboxes: MachineSandbox[]; onChanged: () => void; onOpenProject?: (key: string, tab?: string) => void; onShowMachine?: (name: string) => void }) {
  useI18n()
  const [open, setOpen] = useState<string | null>(null)
  if (sandboxes.length === 0) return <p className="px-1 text-xs text-muted-foreground">{t('No Sandboxes. A project’s Sandboxes page starts one.')}</p>
  const rows = [...sandboxes].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <Card index={4} className="@container/sbx overflow-hidden" aria-label={t('Sandboxes')}>
      <div role="row" className={cn('hidden gap-x-3 border-b px-4 py-2 text-[11px] font-medium text-faint @min-[46rem]/sbx:grid', COLS)}>
        <span>{t('Name')}</span>
        <span>{t('Project')}</span>
        <span>{t('Machine')}</span>
        <span>{t('Backend · route')}</span>
        <span>{t('State')}</span>
        <span className="text-right">{t('Workspaces')}</span>
        <span />
      </div>
      {rows.map((b, i) => {
        const expanded = open === b.name
        return (
          <div key={b.name} className={cn('reveal', i > 0 && 'border-t', expanded && 'bg-muted/25')} style={revealStyle(i + 5)}>
            <div className={cn('grid grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 gap-y-1 px-4 py-2', COLS)}>
              <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : b.name)} className="min-w-0 truncate text-left font-mono text-[13px] font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                {b.name}
              </button>
              <span className="hidden min-w-0 truncate text-[13px] @min-[46rem]/sbx:block">
                {b.project ? (
                  <button type="button" className="truncate font-mono hover:underline" onClick={() => onOpenProject?.(b.project!, 'sandboxes')} disabled={!onOpenProject}>
                    {b.project}
                  </button>
                ) : (
                  '—'
                )}
              </span>
              <span className="hidden min-w-0 truncate text-[13px] @min-[46rem]/sbx:block">
                {b.machine ? (
                  <button type="button" className="truncate hover:underline" onClick={() => onShowMachine?.(b.machine!)} disabled={!onShowMachine}>
                    {b.machine}
                  </button>
                ) : (
                  '—'
                )}
              </span>
              <span className="hidden truncate font-mono text-xs text-muted-foreground @min-[46rem]/sbx:block">{[b.backend, b.route].filter(Boolean).join(' · ') || '—'}</span>
              <span className="justify-self-end @min-[46rem]/sbx:justify-self-start">
                <StateChip entity="sandbox" state={b.state} op={b.op} />
              </span>
              <span className="hidden text-right text-[13px] tabular-nums @min-[46rem]/sbx:block">
                {b.workspaces}/{SANDBOX_CAPACITY}
              </span>
              <ChevronRight aria-hidden="true" className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
              <span className="col-span-3 truncate text-xs text-muted-foreground @min-[46rem]/sbx:hidden">
                {[b.project, b.machine, [b.backend, b.route].filter(Boolean).join(' · '), `${b.workspaces}/${SANDBOX_CAPACITY}`].filter(Boolean).join(' · ')}
              </span>
            </div>
            <Collapse open={expanded} appear={false}>
              {expanded && <SandboxDetail sandbox={b} onChanged={onChanged} />}
            </Collapse>
          </div>
        )
      })}
    </Card>
  )
}

/** An opened row: its Workspaces with their names (sandbox.get), Close, and an unresolved one's clearing call. */
function SandboxDetail({ sandbox: b, onChanged }: { sandbox: MachineSandbox; onChanged: () => void }) {
  useI18n()
  const read = useHostQuery(() => host.sandbox(b.name), [b.name])
  const s = read.data
  return (
    <div className="flex flex-col gap-2 px-4 pt-1 pb-3 text-xs">
      {b.state === 'unresolved' && <p className="font-mono text-[11.5px] text-destructive">{t('see {status} · clear: {clear}', clearingCall('sandbox', b.name, b.op))}</p>}
      {read.error ? (
        <Refusal error={read.error} className="text-warning" />
      ) : !s ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> {t('Reading its Workspaces…')}
        </p>
      ) : s.workspaces.length === 0 ? (
        <p className="text-muted-foreground">{t('No Workspace mounted')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {s.workspaces.map((w) => (
            <li key={w.ws} className="flex min-w-0 flex-wrap items-center gap-x-3 rounded-lg bg-muted/40 px-3 py-1.5">
              <span className="font-semibold">{w.name ?? t('unnamed')}</span>
              <span className="font-mono text-muted-foreground">{w.ws}</span>
              <span className="text-muted-foreground">{t('Branch {branch}', { branch: w.branch || '?' })}</span>
            </li>
          ))}
        </ul>
      )}
      {b.state !== 'gone' && (
        <div className="flex justify-end">
          <CloseSandbox name={b.name} onClosed={onChanged} />
        </div>
      )}
    </div>
  )
}
