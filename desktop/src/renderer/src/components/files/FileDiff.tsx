import { exactCount, exactBytes } from '@/layerfs/exact-count'
import { Check, FileQuestion } from 'lucide-react'
import './files.css'

export interface FileDiffLine { op: ' ' | '+' | '-'; text: string; left: number | null; right: number | null }

/** Presentation only: callers supply saved file facts and normalized diff lines. */
export function FileDiff({ path, lines, before, after, onPrevious }: {
  path: string
  lines: FileDiffLine[]
  before?: { text: string | null; size: number }
  after?: { text: string | null; size: number }
  onPrevious?: () => void
}) {
  const binary = before?.text === null || after?.text === null
  const changed = lines.some(line => line.op !== ' ')
  if (binary) return <div className="fp-empty"><FileQuestion size={24} /><strong>Binary comparison</strong><p>{exactBytes(before?.size ?? 0)} before · {exactBytes(after?.size ?? 0)} after</p></div>
  if (!changed) return <div className="fp-empty"><Check size={24} /><strong>No content changes</strong><p>This file has the same content on both sides.</p>{onPrevious && <button type="button" onClick={onPrevious}>Compare with previous commit</button>}</div>
  return <div className="fp-diff-lines" aria-label="File comparison">
    <div className="fp-diff-location">{!before ? 'Added file' : !after ? 'Removed file' : 'Unified comparison'} · {path}</div>
    {lines.map((line, index) => <div key={index} className={`fp-diff-line ${line.op === '+' ? 'fp-line-added' : line.op === '-' ? 'fp-line-removed' : ''}`}>
      <span>{line.left == null ? '' : exactCount(line.left)}</span><span>{line.right == null ? '' : exactCount(line.right)}</span>
      <span aria-label={line.op === '+' ? 'Added' : line.op === '-' ? 'Removed' : 'Unchanged'}>{line.op}</span>
      <code>{line.text || ' '}</code>
    </div>)}
  </div>
}
