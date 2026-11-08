import { FileQuestion } from 'lucide-react'
import { exactCount } from '@/layerfs/exact-count'
import { shortId } from '@/layerfs/format'
import './files.css'

export interface BlameOrigin { id: string; branch: string | null; message: string }

/** Origin navigation belongs to the caller, so Files and History keep their own context. */
export function FileBlame({ lines, unavailable, onInspect, onRevisions }: {
  lines: { text: string; owner: BlameOrigin | null; n?: number; clipped?: boolean }[]
  unavailable?: string
  onInspect: (owner: BlameOrigin) => void
  onRevisions?: () => void
}) {
  if (unavailable) return <div className="fp-empty"><FileQuestion size={24} /><strong>Line blame is unavailable</strong><p>{unavailable}</p>{onRevisions && <button type="button" onClick={onRevisions}>View revisions</button>}</div>
  return <div className="fp-blame">
    <p className="fp-context">Each line links to the commit that last changed it. Inherited lines retain their original branch.</p>
    {lines.map((line, index) => {
      const group = index === 0 || lines[index - 1].owner?.id !== line.owner?.id
      return <div key={index} className={`fp-blame-line ${group ? 'fp-blame-start' : ''}`}>
        <button type="button" aria-label={`Inspect commit ${shortId(line.owner?.id)} for line ${index + 1}`} disabled={!line.owner?.branch} onClick={() => line.owner?.branch && onInspect(line.owner)} title={line.owner ? `${line.owner.message} · ${line.owner.branch}` : 'Unknown owner'}>
          <code>{group ? (line.owner ? shortId(line.owner.id) : 'Unknown') : '·'}</code>{group && <span>{line.owner?.message}</span>}
        </button>
        <span className="fp-line-number">{exactCount(line.n ?? index + 1)}</span><code className="fp-line-content">{line.text || ' '}</code>
      </div>
    })}
  </div>
}
