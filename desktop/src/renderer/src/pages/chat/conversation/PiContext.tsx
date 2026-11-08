import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LoaderCircle, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { chatHost, type ChatDetail } from '@/layerfs/agent-api'

export function PiContext({ chat, onChange, onCompact, readOnly = false }: { chat: ChatDetail; onChange: (chat: ChatDetail) => void; onCompact?: () => void; readOnly?: boolean }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const usage = chat.contextUsage
  const summary = chat.messages.findLast(message => message.details?.kind === 'compactionSummary')
  if (!usage && !summary) return null
  const working = chat.state === 'running' || chat.execution?.phase === 'compacting'
  async function compact() {
    if (onCompact) return onCompact()
    setPending(true); setError(null)
    try { onChange(await chatHost.compact(chat.id)) } catch (cause) { setError((cause as Error).message) } finally { setPending(false) }
  }
  const percent = usage?.percent == null ? null : Math.max(0, Math.min(100, usage.percent))
  return <div className="mb-2 space-y-2 text-12 text-muted-foreground" aria-label="Conversation context">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="flex-1 tabular-nums">{usage?.tokens != null ? `${usage.tokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens${percent !== null ? ` · ${Math.round(percent)}%` : ''}` : summary ? 'Context compacted · estimate updates after the next response' : 'Context estimate unavailable'}</span><Link to="/settings/configurations" className="underline underline-offset-2">Configurations</Link>{!readOnly && <Button size="sm" variant="ghost" className="h-7 px-2 text-12" disabled={pending || working} onClick={() => void compact()}>{pending ? <LoaderCircle className="size-3 animate-spin" /> : <Minimize2 className="size-3" />} Compact now</Button>}</div>
    {percent !== null && <div role="progressbar" aria-label="Context window used" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} className="h-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${percent >= 85 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${percent}%` }} /></div>}
    {summary && <details className="rounded-xs border border-border px-3 py-2"><summary className="cursor-pointer font-medium text-foreground">Compacted context</summary><div className="mt-2 max-h-32 overflow-y-auto"><p className="whitespace-pre-wrap leading-5">{summary.text.replace(/^### Compacted context\s*\n+/, '')}</p><p className="mt-2">Original messages remain in session history.</p></div></details>}
    {error && <p role="alert" className="text-destructive">Compaction failed: {error}</p>}
  </div>
}
