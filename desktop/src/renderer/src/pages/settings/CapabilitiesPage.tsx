import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { useLayout } from '@/components/shell/layout-context'
import { CHROME_CLUSTER_PX, macChrome, TRAFFIC_LIGHTS_PX } from '@/lib/platform'
import { Button } from '@/components/ui/button'
import { capabilityHost, type AgentCapabilities, type AgentCapabilityChange, type AgentKind } from '@/layerfs/capabilities-api'

const AGENTS: Record<AgentKind, string> = { main: 'Main agent', worker: 'Worker', lead: 'Lead' }
type Section = 'tools' | 'agents' | 'hooks'
const TITLES = { tools: 'Tools', agents: 'Agents', hooks: 'Hooks' }
const INTRO = {
  tools: 'The tools your agents can call, grouped by the extension that provides them. Changes here apply to all agents.',
  agents: 'The agents Connect configures for Pi. Inspect each agent’s tools, prompt and hooks, or adjust its individual configuration.',
  hooks: 'The Pi events Connect and its extensions handle. Required lifecycle hooks stay enabled; subagent hooks switch with the extension.',
}

function useCapabilities() {
  const [data, setData] = useState<AgentCapabilities | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const load = useCallback(async () => {
    setError(null)
    try { setData(await capabilityHost.get()) }
    catch (cause) { setError((cause as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [load])
  async function change(input: AgentCapabilityChange) {
    setPending(true); setSaved(false); setError(null)
    try { setData(await capabilityHost.change(input)); setSaved(true) }
    catch (cause) { setError((cause as Error).message); try { setData(await capabilityHost.get()) } catch { /* keep the last snapshot */ } }
    finally { setPending(false) }
  }
  return { data, error, pending, saved, load, change }
}

function Toggle({ label, enabled, locked, disabled, onChange }: { label: string; enabled: boolean; locked: string | null; disabled: boolean; onChange: (enabled: boolean) => void }) {
  return <div className="flex shrink-0 items-center gap-2">
    <span className="text-12 text-[var(--text-tertiary)]">{enabled ? 'On' : 'Off'}</span>
    <button type="button" role="switch" aria-label={label} aria-checked={enabled} disabled={disabled || !!locked} title={locked ?? undefined} onClick={() => onChange(!enabled)} className={`relative h-5 w-9 rounded-full border border-[var(--border-default)] transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'bg-primary' : 'bg-[var(--surface-hover)]'}`}>
      <span className={`absolute left-0.5 top-0.5 size-3.5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : ''}`} />
    </button>
  </div>
}

function Card({ title, description, enabled, locked, disabled, onChange, children, identifier }: {
  title: string; description?: string; enabled: boolean; locked: string | null; disabled: boolean; onChange: (enabled: boolean) => void; children?: ReactNode; identifier?: string
}) {
  return <article className="space-y-3 rounded-xs border border-[var(--border-default)] bg-[var(--card)] p-4">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0"><h3 className="break-words text-14 font-medium">{title}</h3>{identifier && <p className="mt-1 break-all font-mono text-12 text-[var(--text-tertiary)]">{identifier}</p>}</div>
      <Toggle label={title} enabled={enabled} locked={locked} disabled={disabled} onChange={onChange} />
    </div>
    {description && <p className="text-13 leading-5 text-[var(--text-secondary)]">{description}</p>}
    {locked && <p className="text-12 text-[var(--text-tertiary)]">{locked}</p>}
    {children}
  </article>
}

function Tags({ items }: { items: string[] }) {
  return <div className="flex flex-wrap gap-1.5">{items.map((item) => <span key={item} className="max-w-full break-all rounded-full border border-[var(--border-default)] px-2 py-0.5 text-12 text-[var(--text-secondary)]">{item}</span>)}</div>
}

function CapabilitiesPage({ section }: { section: Section }) {
  const { sidebarOpen } = useLayout()
  const caps = useCapabilities()
  const { data, error, pending, saved } = caps
  const disabled = pending || !!data?.busy.length
  const subagents = data?.extensions.find((extension) => extension.id === 'pi-subagents')
  const names = Object.fromEntries(data?.extensions.map((extension) => [extension.id, extension.title]) ?? [])
  const change = (input: AgentCapabilityChange) => void caps.change(input)
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[880px] space-y-5 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4" style={{ paddingLeft: sidebarOpen ? undefined : (macChrome ? TRAFFIC_LIGHTS_PX : 8) + CHROME_CLUSTER_PX }}><div><h1 className="text-20 font-medium">{TITLES[section]}</h1><p className="mt-2 max-w-[640px] text-13 leading-5 text-[var(--text-secondary)]">{INTRO[section]}</p></div><Button type="button" variant="outline" disabled={pending} onClick={() => void caps.load()}><RefreshCw className="size-3.5" /> Reload</Button></header>
      {error && <p role="alert" className="break-words text-13 text-destructive">{error}</p>}
      {!data && !error && <p role="status" className="flex items-center gap-2 text-13"><LoaderCircle className="size-4 animate-spin" /> Loading Pi configuration…</p>}
      {data && <>
        <div className="space-y-2 rounded-xs border border-[var(--border-default)] px-4 py-3 text-13" aria-label="Pi setup status">
          <p className="font-medium">Pi {data.runtime.version ?? 'version unavailable'} · {data.live ? 'Live session' : 'Configured setup'}</p>
          <p className="text-[var(--text-secondary)]">{subagents?.version ? `pi-subagents ${subagents.version} installed · ${subagents.enabled ? 'Enabled' : 'Disabled'}` : 'pi-subagents is not installed.'}</p>
          <p className="text-12 text-[var(--text-tertiary)]">{data.live ? 'Tool parameters and hook registrations include the open Pi session.' : 'No Pi session is open. This shows the saved configuration; start a chat to inspect live registrations.'}</p>
          {!!data.busy.length && <p role="status" className="text-12">Finish or stop active chats before changing this setup: {data.busy.join(', ')}.</p>}
          {saved && <p role="status" className="text-12">Saved. Agents use the updated configuration on their next message.</p>}
        </div>
        {section === 'tools' && <>
          {subagents && <Card title="pi-subagents" identifier={subagents.version ? `Installed package · ${subagents.version}` : 'Package unavailable'} description={subagents.description} enabled={subagents.enabled} locked={subagents.locked} disabled={disabled || !subagents.version} onChange={(enabled) => change({ kind: 'extension', id: subagents.id, enabled })}>
            <p className="text-12 text-[var(--text-tertiary)]">Connect enables its worker and lead definitions. Package workflow shortcuts and skills are not automatically loaded.</p>
            <a className="text-12 underline underline-offset-4" href="https://pi.dev/packages/pi-subagents" target="_blank" rel="noreferrer">Package documentation</a>
          </Card>}
          {data.extensions.map((extension) => <section key={extension.id} className="space-y-3" aria-label={`${extension.title} tools`}>
            <h3 className="text-13 font-medium">{extension.title}</h3>
            {data.tools.filter((tool) => tool.extension === extension.id).map((tool) => <Card key={tool.name} title={tool.name} description={tool.description} enabled={tool.enabled} locked={tool.locked} disabled={disabled} onChange={(enabled) => change({ kind: 'tool', id: tool.name, enabled })}>
              <p className="text-12 text-[var(--text-tertiary)]">Available to {tool.agents.map((agent) => AGENTS[agent]).join(', ')}{tool.offFor.length ? ` · Off for ${tool.offFor.map((agent) => AGENTS[agent]).join(', ')}` : ''}</p>
              <Tags items={tool.parameters} />
            </Card>)}
          </section>)}
        </>}
        {section === 'agents' && data.agents.map((agent) => <Card key={agent.id} title={agent.title} identifier={agent.name ?? undefined} description={agent.description} enabled={agent.enabled} locked={agent.locked} disabled={disabled} onChange={(enabled) => change({ kind: 'agent', id: agent.id, enabled })}>
          <dl className="space-y-1 text-12 text-[var(--text-secondary)]"><div><dt className="inline font-medium">Started by: </dt><dd className="inline">{agent.startedBy}</dd></div><div><dt className="inline font-medium">Model: </dt><dd className="inline">{agent.model}</dd></div><div><dt className="inline font-medium">Instructions: </dt><dd className="inline">{agent.instructions}</dd></div></dl>
          <Tags items={agent.extensions.map((id) => names[id] ?? id)} />
          <details><summary className="cursor-pointer text-13 font-medium">Tools ({agent.tools.length})</summary><div className="mt-2 divide-y divide-[var(--border-default)]">{agent.tools.map((tool) => <div key={tool.name} className="flex items-center justify-between gap-3 py-2"><div><code className="text-12">{tool.name}</code>{tool.locked && <p className="mt-1 text-12 text-[var(--text-tertiary)]">{tool.locked}</p>}</div><Toggle label={`${agent.title}: ${tool.name}`} enabled={tool.enabled} locked={tool.locked} disabled={disabled} onChange={(enabled) => change({ kind: 'tool', id: tool.name, agent: agent.id, enabled })} /></div>)}</div></details>
          <details><summary className="cursor-pointer text-13 font-medium">Prompt</summary><p className="mt-2 text-12 text-[var(--text-tertiary)]">{agent.prompt.source}. {agent.prompt.note}</p><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xs bg-[var(--surface-soft)] p-3 font-mono text-12 leading-5">{agent.prompt.text}</pre></details>
          <details><summary className="cursor-pointer text-13 font-medium">Hooks ({agent.hooks.length})</summary><div className="mt-2 divide-y divide-[var(--border-default)]">{agent.hooks.map((hook) => <div key={hook.id} className="flex items-start justify-between gap-3 py-2"><div className="min-w-0"><p className="break-all font-mono text-12">{hook.event}</p><p className="mt-1 text-12 text-[var(--text-tertiary)]">{names[hook.extension] ?? hook.extension}{hook.purpose ? ` · ${hook.purpose}` : ''}</p>{hook.locked && <p className="mt-1 text-12 text-[var(--text-tertiary)]">{hook.locked}</p>}</div><Toggle label={`${agent.title}: ${hook.event} (${hook.extension})`} enabled={hook.enabled} locked={hook.locked} disabled={disabled} onChange={(enabled) => change({ kind: 'hook', id: hook.id, agent: agent.id, enabled })} /></div>)}</div>{agent.hooksNote && <p className="mt-2 text-12 text-[var(--text-tertiary)]">{agent.hooksNote}</p>}</details>
        </Card>)}
        {section === 'hooks' && data.extensions.map((extension) => <section key={extension.id} className="space-y-3" aria-label={`${extension.title} hooks`}><h3 className="text-13 font-medium">{extension.title}</h3>{data.hooks.filter((hook) => hook.extension === extension.id).map((hook) => <Card key={hook.id} title={hook.event} description={hook.purpose || hook.description} enabled={hook.enabled} locked={hook.locked} disabled={disabled} onChange={(enabled) => change({ kind: 'hook', id: hook.id, enabled })}>
          <p className="text-12 text-[var(--text-tertiary)]">{hook.handlers === null ? 'Configured event; live handler count available after starting a chat.' : `${hook.handlers} registered ${hook.handlers === 1 ? 'handler' : 'handlers'}`}{hook.offFor.length ? ` · Off for ${hook.offFor.map((agent) => AGENTS[agent]).join(', ')}` : ''}</p>
        </Card>)}</section>)}
      </>}
    </div></div>
  </div>
}

export function ToolsPage() { return <CapabilitiesPage section="tools" /> }
export function AgentsPage() { return <CapabilitiesPage section="agents" /> }
export function HooksPage() { return <CapabilitiesPage section="hooks" /> }
