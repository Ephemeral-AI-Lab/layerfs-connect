// Hallmark · genre: modern-minimal · macrostructure: Workbench · design-system: design.md · designed-as-app
// Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
import { Check, ChevronRight, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLayout } from '@/components/shell/layout-context'
import { Button } from '@/components/ui/button'
import { chatHost, type ChatModel, type ChatModels, type ChatProvider } from '@/layerfs/agent-api'
import { cn } from '@/lib/utils'
import { CHROME_CLUSTER_PX, macChrome, TRAFFIC_LIGHTS_PX } from '@/lib/platform'
import { connectionLabel, providerReady, ProviderConnection } from './ProviderConnection'

const NEW_PROVIDER = '__new_provider__'
const connected = (p: ChatProvider) => p.hasKey || p.signedIn

function SearchBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="relative block min-w-0">
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    <input type="search" aria-label={label} placeholder={label} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onChange('') }} className="h-9 w-full min-w-0 rounded-full border border-border bg-card pl-9 pr-3 text-13 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
  </label>
}

function ModelFacts({ model }: { model: ChatModel }) {
  const facts = [model.reasoning ? 'Reasoning' : null, model.input?.includes('image') ? 'Image input' : null, model.contextWindow ? `${model.contextWindow.toLocaleString()} context` : null].filter(Boolean)
  return facts.length ? <p className="mt-1 text-12 text-muted-foreground">{facts.join(' · ')}</p> : null
}

export function ModelsPage() {
  const navigate = useNavigate()
  const { sidebarOpen } = useLayout()
  const [catalog, setCatalog] = useState<ChatModels | null>(null)
  const [providerId, setProviderId] = useState('')
  const [providerQuery, setProviderQuery] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [manualId, setManualId] = useState('')
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [verified, setVerified] = useState<string | null>(null)
  const locked = busy || connecting
  const provider = catalog?.providers.find((p) => p.id === providerId)
  const custom = providerId === NEW_PROVIDER
  const models = useMemo(() => catalog?.models.filter((m) => m.provider === providerId) ?? [], [catalog, providerId])
  const filteredModels = models.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(modelQuery.trim().toLowerCase()))
  const providers = catalog?.providers.filter((p) => `${p.name ?? ''} ${p.id}`.toLowerCase().includes(providerQuery.trim().toLowerCase())) ?? []
  const selected = catalog?.selected
  const defaultModel = catalog?.models.find((m) => m.provider === selected?.provider && m.id === selected?.modelId)

  function choose(id: string) {
    setProviderId(id); setModelQuery(''); setManualId(''); setError(null); setNotice(null)
  }
  async function load(preferred = providerId) {
    setBusy(true); setError(null)
    try {
      const snapshot = await chatHost.models()
      setCatalog(snapshot)
      const next = snapshot.providers.some((p) => p.id === preferred) ? preferred : snapshot.selected?.provider ?? snapshot.providers.find(connected)?.id ?? snapshot.providers[0]?.id ?? NEW_PROVIDER
      choose(next)
      setVerified(null)
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  useEffect(() => { void load('') }, [])

  const saved = useCallback((snapshot: ChatModels, id: string) => {
    setCatalog(snapshot); setProviderId(id); setVerified(null); setError(null)
    setNotice('Provider connection saved. Choose a default model below.')
  }, [])

  async function setDefault(modelId: string) {
    if (!provider || locked) return
    setBusy(true); setError(null); setNotice(null); setVerified(null)
    try {
      const snapshot = await chatHost.configureModel({ provider: provider.id, modelId, thinkingLevel: selected?.provider === provider.id && selected.modelId === modelId ? selected.thinkingLevel : 'off' })
      setCatalog(snapshot)
      try { localStorage.removeItem('lfs.chat.model') } catch { /* restricted storage */ }
      setNotice('Default model saved. New chats will use this model.')
      setManualId('')
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  async function testDefault() {
    if (!selected || locked) return
    setBusy(true); setError(null); setNotice(null); setVerified(null)
    try {
      const result = await chatHost.testModel()
      setVerified(`${selected.provider}/${selected.modelId}`)
      setNotice(`Connection verified for ${selected.provider}/${selected.modelId}. Reply: ${result.text || '(empty reply)'}`)
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="@container/models mx-auto w-full max-w-[1200px] px-5 py-6">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3" style={{ paddingLeft: sidebarOpen ? undefined : (macChrome ? TRAFFIC_LIGHTS_PX : 8) + CHROME_CLUSTER_PX }}>
          <div><h1 className="text-20 font-medium">Providers & models</h1><p className="mt-1.5 text-13 leading-5 text-muted-foreground">Connect a provider, explore its models, and choose a default for new chats.</p></div>
          <Button variant="ghost" disabled={locked} onClick={() => void load()} aria-label="Reload models"><RefreshCw className={cn('size-3.5', busy && 'animate-spin')} /> Refresh</Button>
        </header>
        {error && <p role="alert" className="mb-4 break-words rounded-lg border border-destructive/20 px-4 py-3 text-13 text-destructive">{error}</p>}
        {!catalog ? <div role="status" className="py-8 text-13 text-muted-foreground">{error ? 'Use Refresh to try loading providers again.' : 'Loading providers…'}</div> : <>
          <div className="grid min-w-0 gap-6 @min-[560px]/models:grid-cols-[180px_minmax(0,1fr)] @min-[760px]/models:grid-cols-[210px_minmax(0,1fr)] @min-[960px]/models:grid-cols-[240px_minmax(0,1fr)]">
            <aside aria-label="Providers" className="min-w-0 self-start @min-[560px]/models:sticky @min-[560px]/models:top-0">
              <div className="mb-3 flex items-center justify-between"><h3 className="text-14 font-medium">Providers</h3><span className="text-12 tabular-nums text-muted-foreground">{catalog.providers.length}</span></div>
              <SearchBox label="Search providers" value={providerQuery} onChange={setProviderQuery} />
              <nav aria-label="Choose a provider" className="mt-3 max-h-56 overflow-y-auto pr-1 @min-[560px]/models:max-h-[calc(100vh-300px)]">
                {['Connected', 'Available'].map((group) => {
                  const rows = providers.filter((p) => group === 'Connected' ? connected(p) : !connected(p))
                  return rows.length > 0 && <div key={group} className="mb-3">
                    <p className="px-2 py-2 text-11 font-medium text-muted-foreground">{group}</p>
                    {rows.map((p) => <button key={p.id} type="button" aria-pressed={providerId === p.id} disabled={locked} onClick={() => choose(p.id)} className={cn('mb-0.5 flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50', providerId === p.id ? 'bg-muted' : 'hover:bg-muted/60')}>
                      <span className="min-w-0 flex-1"><span className="block truncate text-13 font-medium">{p.name || p.id}</span><span className="mt-0.5 block truncate text-11 text-muted-foreground">{connected(p) ? connectionLabel(p) : p.signIn ? 'Sign in or use API key' : p.builtIn === false && p.baseUrl ? 'Endpoint configured' : 'API key'}</span></span>
                      {providerId === p.id && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
                    </button>)}
                  </div>
                })}
                {providers.length === 0 && <p className="px-2 py-6 text-13 text-muted-foreground">No providers match “{providerQuery}”.</p>}
              </nav>
              <Button variant={custom ? 'secondary' : 'ghost'} disabled={locked} className="mt-2 w-full justify-start text-13" onClick={() => choose(NEW_PROVIDER)}><Plus className="size-3.5" /> Add custom provider</Button>
            </aside>
            <section aria-label="Provider details" className="min-w-0 border-t border-border pt-5 @min-[560px]/models:border-l @min-[560px]/models:border-t-0 @min-[560px]/models:pl-6 @min-[560px]/models:pt-0">
              <div className="mb-6"><h3 className="break-words text-20 font-medium">{custom ? 'Add custom provider' : provider?.name || providerId}</h3><p className="mt-1.5 text-13 text-muted-foreground">{custom ? 'Connect your own API or local model server.' : 'Connect once, then choose from the models below.'}</p></div>
              {(provider || custom) && <ProviderConnection key={providerId} provider={provider} disabled={locked} onActiveChange={setConnecting} onSaved={saved} />}
              {notice && <p role="status" className="my-4 break-words text-13 text-muted-foreground">{notice}</p>}
              {!custom && provider && <section aria-label="Provider models" className="pt-6">
                <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-14 font-medium">Models <span className="ml-1 text-12 font-normal tabular-nums text-muted-foreground">{models.length}</span></h3></div>
                <SearchBox label="Search models" value={modelQuery} onChange={setModelQuery} />
                {!providerReady(provider) && <p className="mt-3 text-12 leading-5 text-muted-foreground">Browse the catalog below. Connect this provider to use its models.</p>}
                <ul aria-label="Models for this provider" className="mt-3 max-h-[420px] overflow-y-auto pr-1 divide-y divide-border">
                  {filteredModels.map((model) => {
                    const isDefault = selected?.provider === model.provider && selected.modelId === model.id
                    return <li key={model.id} className="flex min-w-0 flex-wrap items-center gap-3 py-4">
                      <div className="min-w-0 flex-1 basis-44"><p className="break-words text-14 font-medium">{model.name || model.id}</p><p className="mt-1 break-all font-mono text-11 text-muted-foreground">{model.id}</p><ModelFacts model={model} /></div>
                      {isDefault ? <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-12"><Check className="size-3" /> Default</span> : <Button variant="outline" disabled={locked || !providerReady(provider)} aria-label={`Set ${model.name || model.id} as default`} onClick={() => void setDefault(model.id)} className="text-12">Set as default</Button>}
                    </li>
                  })}
                </ul>
                {!filteredModels.length && <p className="py-8 text-center text-13 text-muted-foreground">{models.length ? 'No models match your search.' : 'No models listed for this provider yet.'}</p>}
                <details className="mt-3 text-13"><summary className="w-fit cursor-pointer rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">Model missing? Enter its ID</summary><form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); if (manualId.trim()) void setDefault(manualId.trim()) }}><input aria-label="Model ID" required value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="Exact model ID" disabled={locked} className="h-9 min-w-0 flex-1 basis-44 rounded-md border border-border bg-card px-3 text-13 outline-none focus-visible:ring-2 focus-visible:ring-ring" /><Button type="submit" disabled={locked || !providerReady(provider) || !manualId.trim()}>Set as default</Button></form></details>
              </section>}
            </section>
          </div>
          <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border pt-4">
            <div className="min-w-0 flex-1 basis-56"><p className="text-12 text-muted-foreground">Default for new chats</p><p className="mt-1 break-words text-13">{selected ? `${defaultModel?.name ?? selected.modelId} · ${catalog.providers.find((p) => p.id === selected.provider)?.name ?? selected.provider}` : 'No default model selected'}</p>{selected && verified === `${selected.provider}/${selected.modelId}` && <p className="mt-1 text-12 text-success">Connection verified</p>}</div>
            {selected && <><Button variant="outline" disabled={locked} onClick={() => void testDefault()} className="text-13">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}Test default model</Button><Button disabled={locked} onClick={() => navigate('/')} className="text-13">Start a chat</Button></>}
            {selected && <p className="w-full text-12 text-muted-foreground">Testing sends a short request to the default model and may incur provider usage charges.</p>}
          </footer>
        </>}
      </div>
    </div>
  </div>
}
