import { GitCommitHorizontal, Info } from 'lucide-react'
import { shortId } from '@/layerfs/format'
import type { BlameOrigin } from './FileBlame'
import type { AttributionLine } from './attribution-model'
import './files.css'

/** Commit/Layer ownership, not inferred human authorship. Unknown owners remain unknown. */
export function FileAttributionDiff({ lines, unavailable, onInspect }: { lines: AttributionLine[]; unavailable?: string; onInspect: (origin: BlameOrigin) => void }) {
  const changed = lines.filter(line => line.ownerChanged).length
  const unknown = lines.filter(line => line.ownerChanged === null).length
  if (unavailable) return <div className="fp-empty"><Info size={24} /><strong>Attribution comparison unavailable</strong><p>{unavailable}</p></div>
  return <div className="fa-comparison">
    <p className="fa-summary"><GitCommitHorizontal size={14} /><strong>{changed} {changed === 1 ? 'line has' : 'lines have'} unchanged text with a different owner.</strong><span>Owners are saved Commits or Layers.</span></p>
    <div className="fa-table" role="table" aria-label="Line attribution comparison">
      <div className="fa-row fa-table-head" role="row"><span role="columnheader">Before owner</span><span role="columnheader">After owner</span><span role="columnheader">Line</span><span role="columnheader">Content / attribution</span></div>
      {lines.map((line, index) => <div className={`fa-row ${line.ownerChanged ? 'fa-owner-changed' : ''}`} role="row" key={index}>
        <span role="cell">{line.before ? <button type="button" aria-label={`Inspect before owner ${shortId(line.before.id)} for line ${line.left}`} title={`${line.before.branch}: ${line.before.message}`} onClick={() => onInspect(line.before!)}>{shortId(line.before.id)}</button> : line.left === null ? '—' : 'Unknown'}</span>
        <span role="cell">{line.after ? <button type="button" aria-label={`Inspect after owner ${shortId(line.after.id)} for line ${line.right}`} title={`${line.after.branch}: ${line.after.message}`} onClick={() => onInspect(line.after!)}>{shortId(line.after.id)}</button> : line.right === null ? '—' : 'Unknown'}</span>
        <span role="cell" className="fa-number">{line.right ?? line.left}</span>
        <span role="cell"><code>{line.text || ' '}</code>{line.ownerChanged ? <span className="fa-label">Owner changed</span> : line.ownerChanged === null ? <span className="fa-label">Ownership unknown</span> : line.op !== ' ' ? <span className="fa-label fa-content-change">{line.op === '+' ? 'Content added' : 'Content removed'}</span> : null}</span>
      </div>)}
    </div>
    <p className="fa-explanation">Only aligned, unchanged text counts as an attribution-only change. Added and removed lines are labeled separately.{unknown ? ` Ownership is unresolved for ${unknown} aligned lines.` : ''}</p>
  </div>
}
