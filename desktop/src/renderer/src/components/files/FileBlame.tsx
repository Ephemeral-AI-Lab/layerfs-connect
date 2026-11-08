import { FileQuestion } from 'lucide-react'
import { shortId } from '@/layerfs/format'
import './files.css'

export interface BlameOrigin { id: string; branch: string; message: string }

/** Origin navigation belongs to the caller, so Files and History keep their own context. */
export function FileBlame({ lines, unavailable, onInspect, onRevisions }: {
  lines: { text: string; owner: BlameOrigin }[]
  unavailable?: string
  onInspect: (owner: BlameOrigin) => void
  onRevisions?: () => void
}) {
  if (unavailable) return <div className="fp-empty"><FileQuestion size={24} /><strong>Line blame is unavailable</strong><p>{unavailable}</p>{onRevisions && <button type="button" onClick={onRevisions}>View revisions</button>}</div>
  return <div className="fp-blame">
    <p className="fp-context">Each line links to the commit that last changed it. Inherited lines retain their original branch.</p>
    {lines.map((line, index) => {
      const group = index === 0 || lines[index - 1].owner.id !== line.owner.id
      return <div key={index} className={`fp-blame-line ${group ? 'fp-blame-start' : ''}`}>
        <button type="button" aria-label={`Inspect commit ${shortId(line.owner.id)} for line ${index + 1}`} onClick={() => onInspect(line.owner)} title={`${line.owner.message} · ${line.owner.branch}`}>
          <code>{group ? shortId(line.owner.id) : '·'}</code>{group && <span>{line.owner.message}</span>}
        </button>
        <span className="fp-line-number">{index + 1}</span><code className="fp-line-content">{line.text || ' '}</code>
      </div>
    })}
  </div>
}
