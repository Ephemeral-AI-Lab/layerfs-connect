import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLayout } from '@/components/shell/layout-context'
import { CHROME_CLUSTER_PX, macChrome, TRAFFIC_LIGHTS_PX } from '@/lib/platform'
import { piPolicyHost, type PiPolicies, type PiPolicyView } from '@/layerfs/pi-policies'

const INPUT = 'h-9 w-36 max-w-full rounded-xs border border-border bg-card px-3 text-13 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return <label className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border py-4 first:border-t-0"><span className="min-w-48 flex-1"><span className="block text-14 font-medium">{label}</span><span className="mt-1 block text-12 leading-5 text-muted-foreground">{hint}</span></span>{children}</label>
}
function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="flex h-9 shrink-0 items-center gap-2 rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><span className="text-12 text-muted-foreground">{checked ? 'On' : 'Off'}</span><span className={`relative h-5 w-9 rounded-full border border-border ${checked ? 'bg-primary' : 'bg-muted'}`}><span className={`absolute left-0.5 top-0.5 size-3.5 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} /></span></button>
}
export function PiPoliciesPage() {
  const { sidebarOpen } = useLayout()
  const [view, setView] = useState<PiPolicyView | null>(null)
  const [draft, setDraft] = useState<PiPolicies | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  function take(next: PiPolicyView) { setView(next); setDraft(structuredClone(next.policies)) }
  async function reload() {
    setPending(true); setError(null); setNotice(null)
    try { take(await piPolicyHost.get()) } catch (cause) { setError((cause as Error).message) } finally { setPending(false) }
  }
  useEffect(() => { void reload() }, [])
  const locked = pending || !!view?.busy.length
  const dirty = !!draft && !!view && JSON.stringify(draft) !== JSON.stringify(view.policies)
  const valid = !!draft && [draft.compaction.reserveTokens, draft.compaction.keepRecentTokens].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 10000000)
    && Number.isSafeInteger(draft.retry.maxRetries) && draft.retry.maxRetries >= 0 && draft.retry.maxRetries <= 5
    && [draft.retry.baseDelayMs, draft.retry.maxAgentDelayMs].every(v => Number.isSafeInteger(v) && v >= 1 && v <= 60000)
    && draft.retry.baseDelayMs <= draft.retry.maxAgentDelayMs
  function change(group: 'compaction' | 'retry', key: string, value: number | boolean) {
    setDraft(current => current ? { ...current, [group]: { ...current[group], [key]: value } } : current); setNotice(null)
  }
  function number(group: 'compaction' | 'retry', key: string, value: number, label: string, disabled: boolean, min: number, max: number) {
    return <input aria-label={label} className={INPUT} type="number" inputMode="numeric" min={min} max={max} step={1} disabled={locked || disabled} value={Number.isNaN(value) ? '' : value} onChange={event => change(group, key, event.target.valueAsNumber)} />
  }
  async function save() {
    if (!draft || !valid || locked) return
    setPending(true); setError(null); setNotice(null)
    try { take(await piPolicyHost.save(draft)); setNotice('Configurations saved. They apply to the next agent run.') }
    catch (cause) { setError((cause as Error).message); try { setView(await piPolicyHost.get()) } catch { /* preserve the draft */ } }
    finally { setPending(false) }
  }
  return <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[880px] space-y-6 px-6 py-8">
    <header className="flex flex-wrap items-start justify-between gap-4" style={{ paddingLeft: sidebarOpen ? undefined : (macChrome ? TRAFFIC_LIGHTS_PX : 8) + CHROME_CLUSTER_PX }}><div><h1 className="text-20 font-medium">Configurations</h1><p className="mt-2 max-w-[580px] text-13 leading-5 text-muted-foreground">How agents manage long conversations and recover from temporary provider errors.</p></div><Button variant="outline" disabled={pending} onClick={() => void reload()}><RefreshCw className="size-3.5" /> Reload</Button></header>
    {error && <p role="alert" className="text-13 text-destructive">{error}</p>}
    {!draft && pending && <p role="status" className="flex items-center gap-2 text-13"><LoaderCircle className="size-4 animate-spin" /> Loading configurations…</p>}
    {draft && <form className="space-y-6" onSubmit={event => { event.preventDefault(); void save() }}>
      <p className="text-12 leading-5 text-muted-foreground">Applies to main chats and newly started subagents. Existing history is preserved. Finish or stop active agents before saving.</p>
      {!!view?.busy.length && <p role="status" className="rounded-xs border border-border p-3 text-13">{view.busy.length} active chat(s). Finish or stop them, then reload to edit configurations.</p>}
      <section aria-labelledby="context-policies" className="rounded-xs border border-border bg-card px-5"><h2 id="context-policies" className="pt-5 text-15 font-medium">Context & compaction</h2><p className="mb-1 mt-1 text-13 leading-5 text-muted-foreground">Pi summarizes older messages and keeps recent context intact. Summarization uses model tokens.</p>
        <Field label="Automatic compaction" hint="Compact near the context limit and allow Pi’s overflow recovery."><Toggle label="Automatic compaction" checked={draft.compaction.enabled} disabled={locked} onChange={value => change('compaction', 'enabled', value)} /></Field>
        <Field label="Reserved tokens" hint="Start compaction when fewer than this many context tokens remain.">{number('compaction', 'reserveTokens', draft.compaction.reserveTokens, 'Reserved tokens', !draft.compaction.enabled, 0, 10000000)}</Field>
        <Field label="Recent tokens to keep" hint="Keep approximately this many recent tokens without summarizing them.">{number('compaction', 'keepRecentTokens', draft.compaction.keepRecentTokens, 'Recent tokens to keep', !draft.compaction.enabled, 0, 10000000)}</Field>
        <p className="border-t border-border py-3 text-12 leading-5 text-muted-foreground">Context limits come from the selected model. <Link to="/settings/models" className="underline underline-offset-2">Manage models</Link>. Project instructions are configured under <Link to="/settings/hooks" className="underline underline-offset-2">Hooks</Link>.</p>
      </section>
      <section aria-labelledby="retry-policies" className="rounded-xs border border-border bg-card px-5"><h2 id="retry-policies" className="pt-5 text-15 font-medium">Retries</h2><p className="mb-1 mt-1 text-13 leading-5 text-muted-foreground">Retry temporary model failures with exponential backoff. Failed commands and tests are not automatically rerun.</p>
        <Field label="Automatic retries" hint="Allow Pi to retry transient provider failures."><Toggle label="Automatic retries" checked={draft.retry.enabled} disabled={locked} onChange={value => change('retry', 'enabled', value)} /></Field>
        <Field label="Maximum retries" hint="Extra attempts after the initial request. Set to 0 to disable retries.">{number('retry', 'maxRetries', draft.retry.maxRetries, 'Maximum retries', !draft.retry.enabled, 0, 5)}</Field>
        <Field label="Initial delay (ms)" hint="Delay before the first retry; increases with each attempt.">{number('retry', 'baseDelayMs', draft.retry.baseDelayMs, 'Initial delay (ms)', !draft.retry.enabled, 1, 60000)}</Field>
        <Field label="Maximum delay (ms)" hint="Upper limit for Pi’s retry backoff, up to 60,000 ms.">{number('retry', 'maxAgentDelayMs', draft.retry.maxAgentDelayMs, 'Maximum delay (ms)', !draft.retry.enabled, 1, 60000)}</Field>
      </section>
      {dirty && !valid && <p role="alert" className="text-13 text-destructive">Use whole numbers within the field limits. Initial retry delay must not exceed the maximum delay.</p>}
      {notice && <p role="status" className="text-13">{notice}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><Button type="button" variant="outline" disabled={locked} onClick={() => { if (view) setDraft(structuredClone(view.defaults)); setNotice(null) }}>Restore defaults</Button><div className="flex gap-2"><Button type="button" variant="ghost" disabled={locked || !dirty} onClick={() => { if (view) take(view); setNotice(null) }}>Discard</Button><Button type="submit" disabled={locked || !dirty || !valid}>{pending ? 'Saving…' : 'Save configurations'}</Button></div></div>
    </form>}
  </div></div>
}
