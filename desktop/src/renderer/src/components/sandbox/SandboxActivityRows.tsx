import { Check, ChevronDown, CircleAlert, Radio } from 'lucide-react'
import { clock } from './model'
import { useSandboxDetail } from './detail-context'
import type { Activity } from './types'
export function SandboxActivityRows({ rows, limit }: { rows: Activity[]; limit?: number }) {
  const { time, eventId, setEventId, openWorkspace, actorName, actorLink } = useSandboxDetail()
  return rows.length ? <div className="sd-events">{[...rows].reverse().slice(0,limit).map(e => <div className="sd-event" key={e.id}>
      <button className="sd-event-row" aria-expanded={eventId === e.id} onClick={() => setEventId(id => id === e.id ? null : e.id)}>
        {time < e.end ? <Radio size={14} className="sd-running" /> : e.outcome === 'ok' ? <Check size={14} className="sd-success" /> : <CircleAlert size={14} className="sd-warning" />}
        <time>{clock(e.start)}</time><strong>{e.method}</strong><span>{e.detail}</span><small>{actorName(e.actor)}</small><ChevronDown size={12} />
      </button>
      {eventId === e.id && <div className="sd-event-expanded"><dl className="sd-properties"><dt>Requested by</dt><dd>{actorLink(e.actor)}</dd><dt>Workspace</dt><dd>{e.workspace ? <button className="sd-text-link" onClick={() => openWorkspace(e.workspace!)}>{e.workspace}</button> : 'Sandbox lifecycle'}</dd><dt>Timing</dt><dd>{clock(e.start)} → {time < e.end ? 'Running' : clock(e.end)}</dd><dt>Operation</dt><dd><code>{e.detail}</code></dd></dl><pre>{time < e.end ? 'In flight. Output is available after the command completes.' : e.result}</pre></div>}
    </div>)}</div> : <p className="sd-empty">No activity recorded for this selection yet.</p>
}
