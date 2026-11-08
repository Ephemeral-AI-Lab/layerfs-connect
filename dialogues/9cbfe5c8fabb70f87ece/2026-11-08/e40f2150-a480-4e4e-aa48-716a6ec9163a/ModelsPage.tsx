import { Check, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ContentHeader } from '@/components/shell/ContentHeader'
import { Button } from '@/components/ui/button'
import { chatHost, type ChatModels, type ModelSettings } from '@/layerfs/agent-api'
import { ProviderSignIn } from './ProviderSignIn'

const FIELD = 'h-9 w-full rounded-xs border border-[var(--border-default)] bg-[var(--card)] px-3 text-13 text-[var(--text-primary)] outline-none focus-visible:border-ring disabled:opacity-50'
const PROTOCOLS = [
  ['openai-completions', 'OpenAI compatible (Chat Completions)'],
  ['openai-responses', 'OpenAI Responses'],
  ['anthropic-messages', 'Anthropic Messages'],
  ['google-generative-ai', 'Google Generative AI'],
]

export function ModelsPage() {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<ChatModels | null>(null)
  const [provider, setProvider] = useState('')
  const [customProvider, setCustomProvider] = useState('')
  const [modelId, setModelId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [api, setApi] = useState('openai-completions')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tested, setTested] = useState(false)
  const selectedProvider = catalog?.providers.find((p) => p.id === provider)
  const models = catalog?.models.filter((m) => m.provider === provider) ?? []

  function chooseProvider(id: string, snapshot = catalog) {
    const p = snapshot?.providers.find((entry) => entry.id === id)
    setProvider(id)
    setModelId(snapshot?.selected?.provider === id ? snapshot.selected.modelId : snapshot?.models.find((m) => m.provider === id)?.id ?? '')
    setBaseUrl(p?.baseUrl ?? '')
    setApi(p?.api ?? 'openai-completions')
    setKey('')
    setError(null)
    setNotice(null)
    setTested(false)
  }

  async function load() {
    setError(null)
    try {
      const snapshot = await chatHost.models()
      setCatalog(snapshot)
      chooseProvider(snapshot.selected?.provider ?? snapshot.providers.find((p) => p.hasKey)?.id ?? snapshot.providers[0]?.id ?? 'custom', snapshot)
    } catch (cause) { setError((cause as Error).message) }
  }
  useEffect(() => { void load() }, [])

  async function save(test: boolean) {
    setBusy(true)
    setError(null)
    setNotice(null)
    setTested(false)
    const config: ModelSettings = {
      provider: provider === 'custom' ? customProvider.trim() : provider,
      modelId: modelId.trim(), thinkingLevel: 'off',
      ...(key.trim() ? { apiKey: key.trim() } : {}),
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(provider === 'custom' || !selectedProvider?.signIn ? { api } : {}),
    }
    try {
      const snapshot = await chatHost.configureModel(config)
      setCatalog(snapshot)
      setProvider(config.provider)
      setKey('')
      // The host selection is authoritative; drop an older per-browser draft choice.
      localStorage.removeItem('lfs.chat.model')
      if (test) {
        const result = await chatHost.testModel()
        setTested(true)
        setNotice(`Pi connected to ${config.provider}/${config.modelId}. Model reply: ${result.text || '(empty reply)'}`)
      } else setNotice(`Saved ${config.provider}/${config.modelId}. New chats will use this model.`)
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  function submit(event: FormEvent) { event.preventDefault(); void save(false) }

  return <div className="flex min-h-0 flex-1 flex-col">
    <ContentHeader><h1 className="text-14 font-medium">Models</h1></ContentHeader>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] space-y-6 px-6 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-20 font-medium text-[var(--text-primary)]">Connect a model</h2>
            <p className="mt-2 text-13 leading-5 text-[var(--text-secondary)]">Pi powers your chats, bash tools and subagents. Sign in to a provider or add an API key to start.</p>
          </div>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void load()} aria-label="Reload models"><RefreshCw className="size-3.5" /> Reload</Button>
        </div>
        {!catalog ? <p role="status" className="text-13">{error ? 'Could not load model providers.' : 'Loading Pi providers…'}</p> : <>
          <div className="rounded-xs border border-[var(--border-default)] px-4 py-3 text-13">
            <p className="font-medium">Pi agent runtime connected</p>
            <p className="mt-1 break-all text-[var(--text-secondary)]">{catalog.selected ? `Default model: ${catalog.selected.provider} / ${catalog.selected.modelId}` : 'No default model yet. Configure one below.'}</p>
          </div>
          <form onSubmit={submit} className="space-y-4" aria-label="Model connection">
            <label className="block space-y-1.5 text-13"><span>Provider</span>
              <select aria-label="Provider" className={FIELD} value={provider} disabled={busy} onChange={(e) => chooseProvider(e.target.value)}>
                {catalog.providers.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}{p.hasKey ? ' · Connected' : ''}</option>)}
                <option value="custom">Custom provider / local endpoint</option>
              </select>
            </label>
            {provider === 'custom' && <label className="block space-y-1.5 text-13"><span>Provider ID</span><input className={FIELD} aria-label="Provider ID" required value={customProvider} disabled={busy} onChange={(e) => setCustomProvider(e.target.value)} placeholder="my-provider" /></label>}
            {selectedProvider?.signIn && <ProviderSignIn key={provider} provider={selectedProvider} onSignedIn={(snapshot) => { setCatalog(snapshot); setNotice('Signed in. Choose a model below and save it.'); setError(null) }} disabled={busy} />}
            <label className="block space-y-1.5 text-13"><span>Model ID</span>
              <input className={FIELD} aria-label="Model ID" list="pi-model-list" required value={modelId} disabled={busy} onChange={(e) => { setModelId(e.target.value); setTested(false) }} placeholder="Choose or enter a model ID" />
              <datalist id="pi-model-list">{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>
            </label>
            <label className="block space-y-1.5 text-13"><span>{selectedProvider?.hasKey ? 'Replace API key (optional)' : selectedProvider?.signIn ? 'API key (or sign in above)' : 'API key'}</span>
              <input className={FIELD} aria-label="API key" type="password" autoComplete="new-password" spellCheck={false} value={key} disabled={busy} onChange={(e) => setKey(e.target.value)} placeholder={selectedProvider?.hasKey ? 'Credential already saved in the host' : 'Enter your provider API key'} />
            </label>
            <details open={provider === 'custom'} className="text-13">
              <summary className="cursor-pointer text-[var(--text-secondary)]">Endpoint and protocol</summary>
              <div className="mt-3 space-y-4">
                <label className="block space-y-1.5"><span>Base URL</span><input className={FIELD} aria-label="Base URL" type="url" required={provider === 'custom'} value={baseUrl} disabled={busy} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-provider.example/v1" /></label>
                <label className="block space-y-1.5"><span>API protocol</span><select className={FIELD} aria-label="API protocol" value={api} disabled={busy || !!selectedProvider?.signIn} onChange={(e) => setApi(e.target.value)}>{!PROTOCOLS.some(([value]) => value === api) && <option value={api}>{api}</option>}{PROTOCOLS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              </div>
            </details>
            <p className="text-12 leading-5 text-[var(--text-tertiary)]">Credentials are stored by the local host in Pi’s auth.json. Testing sends a short request to the selected provider.</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="submit" disabled={busy || !modelId.trim() || (provider === 'custom' && !customProvider.trim())}>Save model</Button>
              <Button type="button" variant="outline" disabled={busy || !modelId.trim() || (provider === 'custom' && (!customProvider.trim() || !baseUrl.trim()))} onClick={() => void save(true)}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : tested ? <Check className="size-3.5" /> : null} Save & test connection</Button>
              {catalog.selected && <Button type="button" variant="ghost" disabled={busy} onClick={() => navigate('/')}>Start a chat →</Button>}
            </div>
          </form>
        </>}
        {error && <p role="alert" className="break-words text-13 text-destructive">{error}</p>}
        {notice && <p role="status" className="break-words text-13 text-[var(--text-secondary)]">{notice}</p>}
      </div>
    </div>
  </div>
}
