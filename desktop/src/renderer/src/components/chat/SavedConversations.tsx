// Conversations saved in a LayerFS project (its connect.session.<id> branches),
// read on request, each rebuilt into this home by Import. A conversation saved
// under another Store or project name imports only with an explicit binding from
// that origin to this project; identical names are never joined silently.
import { History, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HostError } from '@/layerfs/client'
import { portableHost, shortId, type SavedConversation } from '@/layerfs/operations-api'

const origin = (s: SavedConversation) => (s.manifest?.project ? `${s.manifest.project.store_id}/${s.manifest.project.project_id}` : null)

export function SavedConversations({ project }: { project: string }) {
  const navigate = useNavigate()
  const [items, setItems] = useState<SavedConversation[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState<string | null>(null)
  const [binding, setBinding] = useState<{ id: string; from: string } | null>(null)
  useEffect(() => { setItems(null); setError(null); setBinding(null) }, [project])
  const find = () => {
    setLoading(true); setError(null)
    void portableHost.list(project).then(setItems).catch((e: Error) => setError(e.message)).finally(() => setLoading(false))
  }
  const run = async (s: SavedConversation, bound?: { from: string; to: string }) => {
    setImporting(s.session_id); setError(null)
    try {
      const r = await portableHost.import(project, s.session_id, bound)
      navigate(`/chat/${encodeURIComponent(r.session.id)}`)
    } catch (e) {
      if ((e instanceof HostError && e.code === 'BindingRequired') || /explicit binding/.test((e as Error).message)) setBinding({ id: s.session_id, from: origin(s) ?? '' })
      else setError((e as Error).message)
    } finally { setImporting(null) }
  }
  if (!items) {
    return (
      <div className="mt-3 flex items-center gap-2 px-1 text-12 text-[var(--text-tertiary)]">
        <button type="button" onClick={find} disabled={loading} className="flex items-center gap-1 underline-offset-2 hover:text-[var(--text-primary)] hover:underline disabled:opacity-50">
          {loading ? <LoaderCircle className="size-3 animate-spin" /> : <History className="size-3" />} Find conversations saved in this project
        </button>
        {error && <span role="alert" className="text-destructive">{error}</span>}
      </div>
    )
  }
  const others = items.filter((s) => !s.local)
  return (
    <section aria-label="Saved conversations" className="mt-3 rounded-xs border border-[var(--border-default)] px-3 py-2 text-12">
      <p className="mb-1 font-medium text-[var(--text-secondary)]">Saved in this project{items.length > others.length ? ` · ${items.length - others.length} already here` : ''}</p>
      {!others.length && <p className="text-[var(--text-tertiary)]">No other conversations are saved in this project.</p>}
      <ul className="flex flex-col">
        {others.map((s) => (
          <li key={s.branch} className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border-default)] py-1 first:border-t-0">
            <code className="font-mono text-[var(--text-secondary)]" title={s.branch}>{shortId(s.session_id)}</code>
            <span className="min-w-0 flex-1 truncate text-[var(--text-tertiary)]">
              {s.valid ? `${s.manifest?.last_seq ?? 0} events${s.manifest?.updated_at ? ` · saved ${new Date(s.manifest.updated_at).toLocaleString()}` : ''}${origin(s) && origin(s) !== project ? ` · saved as ${origin(s)}` : ''}` : s.problem}
            </span>
            {s.valid && <button type="button" disabled={!!importing} onClick={() => void run(s)} className="rounded-full border border-[var(--border-default)] px-2.5 py-0.5 text-[var(--text-primary)] hover:border-[var(--ring)] disabled:opacity-50">{importing === s.session_id ? 'Importing…' : 'Import'}</button>}
            {binding?.id === s.session_id && (
              <form className="flex w-full flex-wrap items-center gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); void run(s, { from: binding.from, to: project }) }}>
                <span className="text-[var(--text-secondary)]">This conversation was saved as</span>
                <input aria-label="Saved origin project" value={binding.from} onChange={(e) => setBinding({ ...binding, from: e.target.value })} className="h-6 w-40 rounded-xs border border-[var(--border-default)] bg-[var(--card)] px-2 font-mono" />
                <span className="text-[var(--text-secondary)]">→ {project}. Its saved references keep their origin names.</span>
                <button type="submit" disabled={!!importing} className="rounded-full bg-primary px-2.5 py-0.5 text-primary-foreground disabled:opacity-50">Import with this binding</button>
                <button type="button" onClick={() => setBinding(null)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Cancel</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 text-destructive">{error}</p>}
    </section>
  )
}
