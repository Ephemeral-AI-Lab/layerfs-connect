import { ChevronRight, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { CliActivity } from '@/layerfs/activity-api'

export const actionStatus = { running: 'Running', success: 'Completed', failed: 'Failed', 'no-cli': 'No CLI launched' }

export function ActionRow({ action }: { action: CliActivity }) {
  return <Link to={`/activity?action=${encodeURIComponent(action.id)}`} className="flex min-w-0 items-center gap-3 border-b px-1 py-4 transition-colors last:border-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    {action.status === 'running' ? <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" /> : <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${action.status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground/40'}`} />}
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{action.label}{action.target ? ` · ${action.target}` : ''}</span><span className="mt-1 block text-xs text-muted-foreground">{new Date(action.at).toLocaleString()} · {action.invocations.length} command{action.invocations.length === 1 ? '' : 's'}{action.origin === 'background' ? ' · Background' : ''}</span></span>
    <span className={`shrink-0 text-xs ${action.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{actionStatus[action.status]}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" />
  </Link>
}
