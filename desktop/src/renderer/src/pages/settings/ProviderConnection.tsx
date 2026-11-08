import { KeyRound, LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { chatHost, type ChatModels, type ChatProvider } from '@/layerfs/agent-api'
import { ProviderSignIn } from './ProviderSignIn'

const FIELD = 'h-9 w-full min-w-0 rounded-md border border-border bg-card px-3 text-13 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
const PROTOCOLS = [
  ['openai-completions', 'OpenAI compatible (Chat Completions)'],
  ['openai-responses', 'OpenAI Responses'],
  ['anthropic-messages', 'Anthropic Messages'],
  ['google-generative-ai', 'Google Generative AI'],
]

export const providerReady = (provider: ChatProvider) => provider.hasKey || provider.signedIn || (provider.builtIn === false && !!provider.baseUrl)
export const connectionLabel = (provider: ChatProvider) => provider.signedIn ? 'Signed in' : provider.hasKey ? 'Credential available' : provider.builtIn === false && provider.baseUrl ? 'Endpoint configured' : 'Not connected'

/** Saving a connection does not select a default model or send a model request. */
export function ProviderConnection({ provider, disabled, onActiveChange, onSaved }: {
  provider?: ChatProvider
  disabled: boolean
  onActiveChange: (active: boolean) => void
  onSaved: (catalog: ChatModels, provider: string) => void
}) {
  const custom = !provider
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '')
  const [api, setApi] = useState(provider?.api ?? 'openai-completions')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = disabled || saving

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    onActiveChange(true)
    setError(null)
    try {
      const providerId = provider?.id ?? id.trim()
      const snapshot = await chatHost.configureProvider({
        provider: providerId,
        ...(custom ? { name: name.trim() || providerId, models: [{ id: model.trim(), name: model.trim() }] } : {}),
        ...(key.trim() ? { apiKey: key.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(!provider?.signIn ? { api } : {}),
      })
      setKey('')
      onSaved(snapshot, providerId)
    } catch (cause) { setError((cause as Error).message) }
    finally { setSaving(false); onActiveChange(false) }
  }

  const fields = <>
    <label className="block space-y-1.5 text-13"><span>{provider?.hasKey ? 'Replace API key (optional)' : 'API key'}</span>
      <input className={FIELD} aria-label="API key" type="password" autoComplete="new-password" spellCheck={false} value={key} disabled={busy} onChange={(e) => setKey(e.target.value)} placeholder={provider?.hasKey ? 'Leave blank to keep your credential' : custom ? 'Optional for local endpoints' : 'Enter your provider API key'} />
    </label>
    <details open={custom} className="text-13">
      <summary className="w-fit cursor-pointer rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">Advanced connection settings</summary>
      <div className="mt-3 space-y-4">
        <label className="block space-y-1.5"><span>Base URL</span><input className={FIELD} aria-label="Base URL" type="url" required={custom} value={baseUrl} disabled={busy} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-provider.example/v1" /></label>
        <label className="block space-y-1.5"><span>API protocol</span><select className={FIELD} aria-label="API protocol" value={api} disabled={busy || !!provider?.signIn} onChange={(e) => setApi(e.target.value)}>{!PROTOCOLS.some(([value]) => value === api) && <option value={api}>{api}</option>}{PROTOCOLS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
    </details>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={busy || (custom && (!id.trim() || !model.trim() || !baseUrl.trim())) || (!custom && !key.trim() && !baseUrl.trim())}>
        {saving && <LoaderCircle className="size-3.5 animate-spin" />}{custom ? 'Add provider' : providerReady(provider!) ? 'Save connection' : 'Connect provider'}
      </Button>
      <span className="text-12 text-muted-foreground">No model request is sent.</span>
    </div>
  </>

  return <section aria-label="Provider connection" className="space-y-4 border-b border-border pb-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-14 font-medium">{custom ? 'Connection details' : 'Connection'}</h3>
      {provider && <span className="text-12 text-muted-foreground">{connectionLabel(provider)}</span>}
    </div>
    {provider?.signIn && <ProviderSignIn provider={provider} disabled={busy} onActiveChange={onActiveChange} onSignedIn={(snapshot) => onSaved(snapshot, provider.id)} />}
    <form aria-label={custom ? 'Add custom provider' : 'Provider credentials'} onSubmit={(event) => void save(event)} className="space-y-4">
      {custom && <>
        <label className="block space-y-1.5 text-13"><span>Provider name</span><input className={FIELD} aria-label="Provider name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="My local provider" /></label>
        <label className="block space-y-1.5 text-13"><span>Provider ID</span><input className={FIELD} aria-label="Provider ID" required value={id} disabled={busy} onChange={(e) => setId(e.target.value)} placeholder="my-provider" pattern="[a-zA-Z0-9_-]+" /></label>
        <label className="block space-y-1.5 text-13"><span>Initial model ID</span><input className={FIELD} aria-label="Initial model ID" required value={model} disabled={busy} onChange={(e) => setModel(e.target.value)} placeholder="Model ID served by this endpoint" /><p className="text-12 text-muted-foreground">Add a model so this provider appears in the model browser.</p></label>
      </>}
      {provider?.signIn || provider?.hasKey ? <details className="text-13">
        <summary className="flex w-fit cursor-pointer items-center gap-1.5 rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><KeyRound className="size-3.5" />{provider.signIn ? 'Use an API key instead' : 'Edit connection'}</summary>
        <div className="mt-4 space-y-4">{fields}</div>
      </details> : fields}
    </form>
    {error && <p role="alert" className="break-words text-13 text-destructive">{error}</p>}
  </section>
}
