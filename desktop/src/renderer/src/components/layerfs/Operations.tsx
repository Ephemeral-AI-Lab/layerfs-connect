// A tool call's LayerFS operations and their saved-version links, shared by
// Chat steps and Trace rows (docs/ui/chat.md, Operations). Each row is one
// recorded operation; its links name exact Commit/Layer versions and open
// History at that version. Counts are links, not new Commits.
import { ArrowUpRight, CircleHelp, ListTree, LoaderCircle, RefreshCw, Save } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { duration } from '@/layerfs/call-labels'
import { plural } from '@/layerfs/format'
import {
  effectLabel, operationHref, operationsHost, operationTarget, persistenceLabel, shortId, statusLabel, versionHref,
  type OperationDetail, type OperationItem, type Persistence, type SavedVersionRef, type ToolOperations, type VersionLink,
} from '@/layerfs/operations-api'
import { cn } from '@/lib/utils'

export function opSummary(ops: ToolOperations) {
  const parts = [plural(ops.count, 'LayerFS operation'), plural(ops.links, 'saved-version link')]
  if (ops.unknown) parts.push(`${ops.unknown} unknown`)
  return parts.join(' · ')
}

function StatusMark({ op }: { op: Pick<OperationItem, 'status'> }) {
  if (op.status === 'running') return <LoaderCircle aria-label="Running" className="size-3 animate-spin text-[var(--text-tertiary)]" />
  if (op.status === 'unknown') return <CircleHelp aria-label="Unknown outcome" className="size-3 text-[var(--warning,#b7791f)]" />
  return op.status === 'failed' ? <span aria-label="Failed" className="text-destructive">✗</span> : <span aria-label="Succeeded" className="text-success">✓</span>
}

/** Store/project shown when it differs from the conversation's own project. */
function refContext(ref: SavedVersionRef, project?: string | null) {
  const key = `${ref.store_id}/${ref.project_id}`
  return project && key !== project ? `${key} · ` : ''
}

export function LinkChip({ link, chatPath, operationId, project }: { link: VersionLink; chatPath: string; operationId: string; project?: string | null }) {
  const label = `${effectLabel(link.effect)} ${link.ref.version_kind === 'Layer' ? 'Layer' : 'Commit'} ${shortId(link.ref.commit_id)}`
  return (
    <Link
      to={versionHref(chatPath, link.ref, operationId)}
      title={`${link.ref.store_id}/${link.ref.project_id} · ${link.ref.branch_id} · ${link.ref.version_kind} ${link.ref.commit_id}`}
      className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-default)] px-1.5 py-px font-mono text-11 text-[var(--text-secondary)] hover:border-[var(--ring)] hover:text-[var(--text-primary)]"
    >
      {refContext(link.ref, project)}{link.ref.branch_id} · {label}
      <ArrowUpRight className="size-3" />
    </Link>
  )
}

/** One tool call's operations; `onSelect` opens an operation's inspector instead of navigating. */
export function OperationList({ ops, chatPath, project, selected, onSelect }: { ops: ToolOperations; chatPath: string; project?: string | null; selected?: string | null; onSelect?: (id: string) => void }) {
  return (
    <div className="flex flex-col py-1 text-12" role="list" aria-label="LayerFS operations">
      {ops.items.map((op) => (
        <div key={op.operation_id} role="listitem" className={cn('flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-0.5', selected === op.operation_id && 'bg-[color-mix(in_srgb,var(--ring)_8%,transparent)] ring-1 ring-inset ring-[var(--ring)]')} data-operation={op.operation_id}>
          <StatusMark op={op} />
          {onSelect ? (
            <button type="button" onClick={() => onSelect(op.operation_id)} className="w-36 shrink-0 truncate text-left font-medium text-[var(--text-primary)] underline-offset-2 hover:underline" title="Inspect this operation">{op.method}</button>
          ) : (
            <Link to={operationHref(chatPath, op.operation_id)} className="w-36 shrink-0 truncate font-medium text-[var(--text-primary)] underline-offset-2 hover:underline" title="Open this operation in Trace">{op.method}</Link>
          )}
          <code className="min-w-[6ch] flex-1 truncate font-mono text-[var(--text-secondary)]" title={operationTarget(op)}>{operationTarget(op)}</code>
          {op.cause && op.cause !== 'tool' && <span className="shrink-0 text-11 text-[var(--text-tertiary)]">{op.cause === 'session_boundary' ? 'restore point' : 'lifecycle'}</span>}
          {op.checkpoints.map((link, i) => <LinkChip key={i} link={link} chatPath={chatPath} operationId={op.operation_id} project={project} />)}
          {!op.checkpoints.length && <span className={cn('shrink-0 text-[var(--text-tertiary)]', op.status === 'failed' && 'text-destructive')} title={op.unresolved ?? undefined}>{statusLabel(op)}{op.unresolved && op.status === 'succeeded' && op.method.match(/^(file|fs)\.|commit|fork|merge|publish/) ? ' · link unresolved' : ''}</span>}
          <span className="w-10 shrink-0 text-right tabular-nums text-[var(--text-tertiary)]">{duration(op.ms)}</span>
        </div>
      ))}
      {ops.truncated && <p className="px-3 py-1 text-11 text-[var(--text-tertiary)]">Showing the first {ops.items.length} of {ops.count}. The Trace's Operations view pages the rest.</p>}
    </div>
  )
}

/** A conversation's journal: locally recorded, saved to its project, unknown, failed or conflicted, with explicit actions. */
export function PersistenceBadge({ chatId, persistence, onChanged }: { chatId: string; persistence: Persistence | null | undefined; onChanged?: (p: Persistence) => void }) {
  const [busy, setBusy] = useState<'save' | 'reconcile' | 'adopt' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!persistence) return null
  const tone = persistence.state === 'saved' && persistence.portable ? 'ok' : ['failed', 'conflict', 'save-unknown'].includes(persistence.state) ? 'warn' : 'quiet'
  const run = (action: 'save' | 'reconcile' | 'adopt') => {
    setBusy(action); setError(null)
    void (action === 'save' ? operationsHost.save(chatId) : action === 'adopt' ? operationsHost.adopt(chatId) : operationsHost.reconcile(chatId).then((r) => r.status))
      .then((p) => onChanged?.(p)).catch((e: Error) => setError(e.message)).finally(() => setBusy(null))
  }
  const detail = persistence.conflict?.message ?? persistence.error?.message ?? (persistence.local_only === 'simulation' ? 'A simulation run’s conversation is recorded in this home and not saved to its project, so the run’s branch graph stays exactly as planned.' : persistence.portable && persistence.pending ? `${plural(persistence.pending, 'event')} not yet saved to the project` : persistence.branch ? `Session branch ${persistence.branch}` : null)
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-12">
      <span title={detail ?? undefined} className={cn('flex items-center gap-1 rounded-full border px-2 py-px', tone === 'ok' ? 'border-[color-mix(in_srgb,var(--success,#2f8a5b)_40%,transparent)] text-[var(--text-secondary)]' : tone === 'warn' ? 'border-[color-mix(in_srgb,var(--destructive)_40%,transparent)] text-destructive' : 'border-[var(--border-default)] text-[var(--text-tertiary)]')}>
        <Save className="size-3" /> {persistenceLabel(persistence)}{persistence.portable && persistence.state !== 'saved' && persistence.pending > 0 ? ` (${persistence.pending})` : ''}
      </span>
      {persistence.portable && persistence.state !== 'conflict' && (persistence.state !== 'saved' || persistence.pending > 0) && (
        <button type="button" disabled={!!busy} onClick={() => run('save')} className="text-[var(--text-tertiary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save to project'}</button>
      )}
      {(persistence.state === 'save-unknown' || persistence.state === 'failed') && (
        <button type="button" disabled={!!busy} onClick={() => run('reconcile')} className="flex items-center gap-1 text-[var(--text-tertiary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline disabled:opacity-50"><RefreshCw className="size-3" />{busy === 'reconcile' ? 'Checking…' : 'Check saved state'}</button>
      )}
      {persistence.state === 'conflict' && (
        <button type="button" disabled={!!busy} title="Make this installation the conversation's only owner. Refused when the saved branch holds history this conversation lacks." onClick={() => run('adopt')} className="text-[var(--text-tertiary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline disabled:opacity-50">{busy === 'adopt' ? 'Taking over…' : 'Take over ownership'}</button>
      )}
      {error && <span role="alert" className="text-destructive">{error}</span>}
    </span>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[110px_minmax(0,1fr)] gap-x-3 text-12 leading-5">
      <dt className="text-[var(--text-tertiary)]">{label}</dt>
      <dd className="min-w-0 break-all text-[var(--text-secondary)]">{children}</dd>
    </div>
  )
}

function RefBlock({ refv, effect, chatPath, operationId }: { refv: SavedVersionRef; effect?: string; chatPath: string; operationId: string }) {
  return (
    <div className="rounded-xs border border-[var(--border-default)] bg-[var(--card)] px-3 py-2">
      <dl className="flex flex-col gap-0.5">
        {effect && <Field label="Effect">{effect}</Field>}
        <Field label="Store / Project">{refv.store_id} / {refv.project_id}</Field>
        <Field label="Branch">{refv.branch_id}</Field>
        <Field label={refv.version_kind}><code className="font-mono">{refv.commit_id}</code></Field>
      </dl>
      <Link to={versionHref(chatPath, refv, operationId)} className="mt-1 inline-flex items-center gap-1 text-12 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><ArrowUpRight className="size-3.5" /> Open in History</Link>
    </div>
  )
}

const Json = ({ value }: { value: unknown }) => (
  <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-xs border border-[var(--border-default)] bg-[var(--card)] px-3 py-2 font-mono text-12 leading-5 text-[var(--text-secondary)]">{JSON.stringify(value, null, 2)}</pre>
)

const TABS = ['Result', 'Inputs', 'Arguments', 'Receipt', 'Execution'] as const

/** One operation's exact record: typed outputs and inputs, arguments, receipt, error and execution facts. */
export function OperationInspector({ chatId, chatPath, operationId, onClose }: { chatId: string; chatPath: string; operationId: string; onClose?: () => void }) {
  const [op, setOp] = useState<OperationDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]>('Result')
  useEffect(() => {
    let live = true
    setOp(null); setError(null)
    operationsHost.get(chatId, operationId).then((r) => live && setOp(r)).catch((e: Error) => live && setError(e.message))
    return () => { live = false }
  }, [chatId, operationId])
  if (error) return <p role="alert" className="px-3 py-2 text-12 text-destructive">The operation could not load: {error}</p>
  if (!op) return <p className="flex items-center gap-1.5 px-3 py-2 text-12 text-[var(--text-tertiary)]"><LoaderCircle className="size-3 animate-spin" /> Loading operation…</p>
  return (
    <section aria-label={`Operation ${op.method}`} className="flex min-w-0 flex-col gap-2 rounded-xs border border-[var(--border-default)] bg-[var(--surface,transparent)] p-3">
      <header className="flex flex-wrap items-center gap-2 text-13">
        <StatusMark op={op} />
        <strong className="text-[var(--text-primary)]">{op.method}</strong>
        <span className="text-12 text-[var(--text-tertiary)]">{statusLabel(op)} · {op.origin ?? 'unknown origin'} · {op.cause ?? 'tool'}{op.inherited_from ? ` · inherited from ${shortId(op.inherited_from)}` : ''}</span>
        <code className="ml-auto font-mono text-11 text-[var(--text-tertiary)]" title="Operation id">{op.operation_id}</code>
        {onClose && <button type="button" onClick={onClose} className="text-12 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Close</button>}
      </header>
      <dl className="flex flex-col gap-0.5">
        <Field label="Agent / tool">{op.agent_id ?? 'root'} · {op.tool_call_id ?? 'no tool call'}{op.entry_id ? ` · entry ${shortId(op.entry_id)}` : ''}</Field>
        <Field label="Timing">{op.started_at ? new Date(op.started_at).toLocaleString() : '—'}{op.ms != null ? ` · ${duration(op.ms)}` : ''}</Field>
        {op.unresolved && <Field label="Unresolved">{op.unresolved}</Field>}
        {op.error && <Field label="Error"><span className="text-destructive">{op.error.code}: {op.error.message}</span></Field>}
      </dl>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-[var(--border-default)]">
        {TABS.map((t) => <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('-mb-px border-b-2 px-2 py-1 text-12', tab === t ? 'border-[var(--ring)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>{t}{t === 'Result' && op.checkpoints.length ? ` (${op.checkpoints.length})` : t === 'Inputs' && op.inputs.length ? ` (${op.inputs.length})` : ''}</button>)}
      </div>
      {tab === 'Result' && (op.checkpoints.length ? <div className="grid gap-2 @min-[640px]/chat:grid-cols-2">{op.checkpoints.map((l, i) => <RefBlock key={i} refv={l.ref} effect={effectLabel(l.effect)} chatPath={chatPath} operationId={op.operation_id} />)}</div> : <p className="text-12 text-[var(--text-tertiary)]">{op.status === 'unknown' ? 'No confirmed receipt: this operation has no saved-version link until it is reconciled.' : op.canonical ? 'No saved-version link in this receipt.' : 'This operation cannot link saved versions (reads, exec, mounts and Sandbox calls never do).'}</p>)}
      {tab === 'Inputs' && (op.inputs.length || op.pending.length ? <div className="grid gap-2">{op.inputs.map((r, i) => <RefBlock key={i} refv={r} chatPath={chatPath} operationId={op.operation_id} />)}{op.pending.map((p, i) => <p key={`p${i}`} className="text-12 text-[var(--text-tertiary)]">{p.branch} <code className="font-mono">{p.commit}</code> — kind not yet confirmed</p>)}</div> : <p className="text-12 text-[var(--text-tertiary)]">No saved-version inputs.</p>)}
      {tab === 'Arguments' && <Json value={op.full_arguments ?? op.arguments} />}
      {tab === 'Receipt' && (op.receipt ? <Json value={op.receipt.error ?? op.receipt.value} /> : <p className="text-12 text-[var(--text-tertiary)]">No receipt was recorded.</p>)}
      {tab === 'Execution' && <Json value={{ execution_context: op.execution_context, mount_facts: op.mount_facts, reconciliation: op.reconciliation }} />}
      <Link to={operationHref(chatPath, op.operation_id)} className="flex items-center gap-1 self-start text-12 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><ListTree className="size-3.5" /> Show in Trace</Link>
    </section>
  )
}
