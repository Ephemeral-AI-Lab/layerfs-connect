// The Trace's Operations view: every recorded LayerFS operation of the
// conversation in journal order, filtered by agent, operation, project,
// status and links, paged from the newest, with one operation's inspector.
// Counts are of this conversation's records; uninstrumented calls are named
// as coverage gaps, not counted.
import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { OperationInspector, OperationList } from '@/components/layerfs/Operations'
import { onHostEvent } from '@/layerfs/client'
import { chatRefresh } from '@/layerfs/chat-refresh'
import { plural } from '@/layerfs/format'
import { operationsHost, type OperationPage, type OperationQuery } from '@/layerfs/operations-api'

const PAGE = 100
/** The most rows one view holds (the host's page bound). */
const WINDOW = 1000

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex h-7 items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--card)] pl-2.5 pr-1 text-12 text-[var(--text-secondary)]">
      <span className="text-[var(--text-tertiary)]">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="max-w-[16ch] bg-transparent text-[var(--text-primary)] outline-none">
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

export function OperationsView({ chatId, chatPath, agent, focus }: { chatId: string; chatPath: string; agent?: string; focus: string | null }) {
  const [query, setQuery] = useState<OperationQuery>({ agent })
  const [page, setPage] = useState<OperationPage | null>(null)
  // null: the newest page, following new operations; a number: the view was paged back and holds one contiguous range from there
  const [anchor, setAnchor] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(focus)
  useEffect(() => setSelected(focus), [focus])
  useEffect(() => setAnchor(null), [chatId, JSON.stringify(query)])
  useEffect(() => {
    let live = true
    const refresh = chatRefresh(async () => {
      try {
        const next = await operationsHost.page(chatId, anchor === null ? { ...query, limit: PAGE } : { ...query, from: anchor, limit: WINDOW })
        if (live) { setPage(next); setError(null); setLoading(false) }
      }
      // a failed refresh keeps the operations already shown
      catch (e) { if (live) { setError((e as Error).message); setLoading(false) } }
    }, 1500)
    const off = onHostEvent((event) => { if ((event.type === 'chat' || event.type === 'chat-summary') && event.session.id === chatId) refresh.request() }, () => refresh.request(true))
    refresh.request(true)
    return () => { live = false; refresh.dispose(); off() }
  }, [chatId, JSON.stringify(query), anchor])
  const from = page?.from ?? 0
  const loadEarlier = () => {
    if (!page || from <= 0) return
    setLoading(true)
    // the range grows back to the earlier rows; past the bound of one view its newest rows leave it
    setAnchor(Math.max(0, from - PAGE))
  }
  const set = (patch: OperationQuery) => setQuery((q) => ({ ...q, ...patch }))
  if (!page) return <div className="flex items-center gap-1.5 py-10 text-13 text-[var(--text-tertiary)]">{error ? <span role="alert" className="text-destructive">Operations could not load: {error}</span> : <><LoaderCircle className="size-4 animate-spin" /> Reading operations…</>}</div>
  const items = page.items
  const newer = page.total - (page.from + items.length)
  const ops = { count: items.length, links: 0, created: 0, distinct: 0, unknown: 0, failed: 0, running: 0, items, truncated: false }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select label="Agent" value={query.agent ?? ''} options={page.facets.agents} onChange={(v) => set({ agent: v || undefined })} />
        <Select label="Operation" value={query.method ?? ''} options={page.facets.methods} onChange={(v) => set({ method: v || undefined })} />
        <Select label="Project" value={query.project ?? ''} options={page.facets.projects} onChange={(v) => set({ project: v || undefined })} />
        <Select label="Status" value={query.status ?? ''} options={page.facets.statuses} onChange={(v) => set({ status: v || undefined })} />
        <label className="flex h-7 items-center gap-1.5 text-12 text-[var(--text-secondary)]"><input type="checkbox" checked={!!query.linked} onChange={(e) => set({ linked: e.target.checked || undefined })} /> With saved-version links</label>
      </div>
      <p className="flex flex-wrap gap-x-3 text-12 tabular-nums text-[var(--text-tertiary)]">
        <span>{page.total === page.counts.operations ? plural(page.total, 'operation') : `${page.total} of ${plural(page.counts.operations, 'operation')}`}</span>
        <span>{plural(page.counts.links, 'saved-version link')}</span>
        <span>{plural(page.counts.distinct_versions, 'distinct version')}</span>
        {page.counts.unknown > 0 && <span className="text-[var(--warning,#b7791f)]">{page.counts.unknown} unknown</span>}
        {anchor === null ? from > 0 && <span className="italic">showing the newest {items.length}</span> : (from > 0 || newer > 0) && <span className="italic">showing {from + 1}–{from + items.length}</span>}
      </p>
      {page.coverage.gaps.map((g, i) => <p key={i} role="note" className="rounded-xs border border-dashed border-[var(--border-default)] px-3 py-1.5 text-12 text-[var(--text-tertiary)]">Coverage: {g.reason}</p>)}
      {error && <p role="alert" className="text-12 text-destructive">Refresh failed; showing the last operations read. {error}</p>}
      {from > 0 && <button type="button" disabled={loading} onClick={() => void loadEarlier()} className="h-8 rounded-md border border-dashed border-[var(--border-default)] text-12 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{loading ? 'Loading…' : `Load earlier (${Math.min(from, PAGE)} more of ${from})`}</button>}
      {items.length === 0 ? <p className="py-10 text-center text-13 text-[var(--text-tertiary)]">{page.counts.operations ? 'No operation matches these filters.' : 'No LayerFS operations recorded in this conversation.'}</p> : (
        <div className="grid min-w-0 gap-3 @min-[900px]/chat:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-xs border border-[var(--border-default)] bg-[var(--card)]">
            <OperationList ops={ops} chatPath={chatPath} selected={selected} onSelect={(id) => setSelected(selected === id ? null : id)} />
          </div>
          {selected && <div className="min-w-0"><OperationInspector chatId={chatId} chatPath={chatPath} operationId={selected} onClose={() => setSelected(null)} /></div>}
        </div>
      )}
      {anchor !== null && newer > 0 && <button type="button" onClick={() => setAnchor(null)} className="h-8 rounded-md border border-dashed border-[var(--border-default)] text-12 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{`Show the newest (${newer} newer not in this view)`}</button>}
    </div>
  )
}
