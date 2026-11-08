import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { call } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import { LoadError } from '@/components/layerfs/States'
import { SavedFileExplorer } from '@/components/files/SavedFileExplorer'
export function HistoryComparison({ project }: { project: string }) {
  const [params, setParams] = useSearchParams()
  const to = params.get('commit') ?? '', from = params.get('from') ?? '', branch = params.get('branch') ?? 'main', leftBranch = params.get('fromBranch') ?? branch
  const [readError, setReadError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [tokens, setTokens] = useState<(string | undefined)[]>([undefined])
  const [path, setPath] = useState(params.get('path') ?? '')
  const retained = useRef(new Map<string, Awaited<ReturnType<typeof loadPage>>>())
  const loadPage = (query: string) => call<{ items: { path: string; kind: string; changes?: { attribution?: boolean } }[]; continuation?: string; has_more: boolean; coverage?: { complete?: boolean; reason?: string } }>('GET', `/api/projects/${encodeURIComponent(project)}/file-query?${query}`)
  const q = useHostQuery(async () => {
    if (!from || !to) return null
    const search = new URLSearchParams({ branch, rightBranch: leftBranch, pin: to, left: from, path: '/', kind: 'branch-diff', size: '50' })
    if (tokens[page - 1]) search.set('continuation', tokens[page - 1]!)
    else search.set('page', String(page))
    const key = search.toString()
    const cached = retained.current.get(key)
    if (cached) return cached
    const result = await loadPage(key)
    retained.current.set(key,result)
    return result
  }, [project, branch, leftBranch, to, from, page, tokens])
  return <div className="flex min-h-0 flex-1 flex-col"><div className="fp-context"><Link to={`/storage/${project}/history`}>Back to History</Link> · Saved comparison</div><div className="fp-context"><label>From full saved id <input value={from} aria-label="Comparison from id" onChange={e => { setPage(1); setTokens([undefined]); setParams(p => { p.set('from', e.target.value); return p }) }} /></label><label>To full saved id <input value={to} aria-label="Comparison to id" onChange={e => { setPage(1); setTokens([undefined]); setParams(p => { p.set('commit', e.target.value); return p }) }} /></label></div>
    {readError && <p role="alert" className="fp-context">{readError}</p>}{q.error ? <LoadError error={q.error} what="pinned comparison" onRetry={q.reload} /> : !q.data ? <p className="fp-context">Select two saved versions to compare.</p> : <><div className="fp-context">{q.data.coverage?.complete === false ? `Incomplete: ${q.data.coverage.reason ?? 'query coverage'}` : 'Pinned changed paths'} · Page {page}</div><div className="fp-context">{q.data.items.map(c => <button key={c.path} onClick={() => setPath(c.path)}>{c.kind} {c.path}{c.changes?.attribution ? ' · Attribution' : ''}</button>)}{!q.data.items.length && <span>No changed paths in this page.</span>}</div><div className="fp-pagination"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page}</span><button disabled={!q.data.has_more || !q.data.continuation} onClick={() => { setTokens(t => [...t.slice(0, page), q.data!.continuation]); setPage(p => p + 1) }}>Next</button></div>{path && <SavedFileExplorer key={`${from}:${to}:${path}`} project={project} branch={branch} path={path} pin={to} initialLeft={from} leftBranch={leftBranch} initialMode="compare" onPin={pin => { if (pin === 'latest') void call<{ saved_head?: { id: string }; head?: string; base: string }>('GET', `/api/projects/${encodeURIComponent(project)}/branches?branch=${encodeURIComponent(branch)}`).then(b => setParams(p => { p.set('commit', b.saved_head?.id ?? b.head ?? b.base); return p })).catch(e => setReadError(e.message)); else setParams(p => { p.set('commit', pin); return p }) }} />}</>}
  </div>
}
