import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Exact counts are appropriate for the fully local sample, not assumed for upstream queries. */
export function PageControls({ page, size, count, onPage, onSize, label }: { page: number; size: number; count: number; onPage: (page: number) => void; onSize: (size: number) => void; label: string }) {
  const last = Math.max(1, Math.ceil(count / size))
  return <div className="fp-pagination" aria-label={`${label} pagination`}>
    <label>Per page <select aria-label={`${label} page size`} value={size} onChange={e => { onSize(Number(e.target.value)); onPage(1) }}><option value={2}>2</option><option value={5}>5</option><option value={10}>10</option></select></label>
    <span aria-live="polite">Page {page} of {last}</span>
    <button type="button" aria-label={`Previous ${label.toLowerCase()} page`} disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft size={14} /></button>
    <button type="button" aria-label={`Next ${label.toLowerCase()} page`} disabled={page >= last} onClick={() => onPage(page + 1)}><ChevronRight size={14} /></button>
  </div>
}
