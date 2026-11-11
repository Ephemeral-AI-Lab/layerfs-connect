import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CliInvocation, CliText } from '@/layerfs/activity-api'

const quote = (word: string) => /^[a-zA-Z0-9_./:@=-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`
export const commandText = (call: CliInvocation, compact = false) => [compact ? 'layerfs' : call.binary ?? 'layerfs', ...(call.argv ?? [])].map(quote).join(' ')
export const invocationStatus: Record<CliInvocation['status'], string> = { queued: 'Queued', running: 'Running', success: 'Completed', refused: 'Refused', uncertain: 'Uncertain outcome', 'launch-failed': 'Could not launch', 'usage-error': 'CLI syntax error', 'not-started': 'Not started', interrupted: 'Interrupted · outcome unknown' }
export const invocationFailed = (call: CliInvocation) => ['refused', 'uncertain', 'launch-failed', 'usage-error', 'interrupted'].includes(call.status) || (call.exitCode != null && call.exitCode !== 0) || (call.commandExitCode != null && call.commandExitCode !== 0)

function Output({ value, pending }: { value?: CliText | null; pending?: boolean }) {
  return <div className="space-y-2"><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-4 font-mono text-xs leading-relaxed">{value?.text || (pending ? 'Waiting for captured output…' : 'Command completed with no output.')}</pre>{value && <p className="text-xs text-muted-foreground">{value.bytes.toLocaleString()} bytes{value.truncated ? ' · Truncated: showing the first captured bytes.' : ''}</p>}</div>
}

export function InvocationDetails({ invocation: call }: { invocation: CliInvocation }) {
  const [tab, setTab] = useState<'output' | 'stderr' | 'details'>(() => invocationFailed(call) && call.stderr?.text ? 'stderr' : 'output')
  const [copyState, setCopyState] = useState('Copy command')
  const command = commandText(call)
  const pending = call.status === 'running' || call.status === 'queued'
  async function copy() {
    try { await navigator.clipboard.writeText(command); setCopyState('Copied') } catch { setCopyState('Copy unavailable') }
  }
  return <article className="min-w-0 space-y-4 rounded-xl border p-4 sm:p-5" aria-label="Selected command">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">CLI input</h3><Button variant="ghost" size="sm" onClick={() => void copy()}>{copyState}</Button></div>
    <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{command}</pre>
    {call.stdin && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Standard input</summary><div className="mt-3"><Output value={call.stdin} /></div></details>}
    {call.message && <p className={`break-words text-sm ${invocationFailed(call) ? 'text-destructive' : 'text-muted-foreground'}`}>{call.code ? `${call.code}: ` : ''}{call.message}</p>}
    <div className="flex gap-5 border-b" role="tablist" aria-label="Command information">{([['output', 'Output'], ['stderr', 'Standard error'], ['details', 'Details']] as const).map(([id, label]) => <button key={id} id={`command-tab-${id}`} type="button" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} aria-controls={`command-panel-${call.id}`} onClick={() => setTab(id)} onKeyDown={event => { const tabs = ['output', 'stderr', 'details'] as const; const index = tabs.indexOf(id); const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : undefined; if (next) { event.preventDefault(); setTab(next); document.getElementById(`command-tab-${next}`)?.focus() } }} className={`min-h-10 border-b-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === id ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground'}`}>{label}</button>)}</div>
    <div id={`command-panel-${call.id}`} role="tabpanel" aria-labelledby={`command-tab-${tab}`}>
      {tab !== 'details' ? call.outputUnavailable ? <p className="text-sm text-muted-foreground">Output was inherited by the calling terminal and was not captured.</p> : <Output value={tab === 'stderr' ? call.stderr : call.stdout} pending={pending} /> : <dl className="space-y-3 break-words text-xs"><div><dt className="text-muted-foreground">Status</dt><dd className={invocationFailed(call) ? 'mt-1 text-destructive' : 'mt-1'}>{invocationStatus[call.status]}</dd></div><div><dt className="text-muted-foreground">Started</dt><dd className="mt-1">{new Date(call.started ?? call.at).toLocaleString()}</dd></div><div><dt className="text-muted-foreground">Process</dt><dd className="mt-1">{call.pid ? `PID ${call.pid} · ` : ''}{call.durationMs !== undefined ? `${(call.durationMs / 1000).toFixed(2)} s · ` : ''}{call.exitCode != null ? `CLI exit ${call.exitCode}` : 'Exit pending'}{call.commandExitCode !== undefined ? ` · Command exit ${call.commandExitCode}` : ''}{call.signal ? ` · ${call.signal}` : ''}{call.waitMs !== undefined ? ` · Queued ${call.waitMs} ms` : ''}</dd></div>{call.identity && <div><dt className="text-muted-foreground">LayerFS CLI</dt><dd className="mt-1 break-all font-mono">{call.identity.version} · {call.identity.commit}{call.identity.dirty ? ' (dirty)' : ''}</dd></div>}<div><dt className="text-muted-foreground">Invocation ID</dt><dd className="mt-1 break-all font-mono">{call.id}</dd></div>{call.shared && <div>This action shared an existing CLI invocation; no additional process was launched.</div>}{call.progress && <div>Progress: {Object.entries(call.progress).map(([key, value]) => `${key} ${value}`).join(' · ')}</div>}</dl>}
    </div>
  </article>
}
