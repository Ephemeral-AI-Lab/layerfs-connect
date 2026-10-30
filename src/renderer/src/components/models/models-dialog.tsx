// Settings → Models: the model providers live agents may use, after
// deepseek-harness's Models page. Each configured provider is a card with its
// key's state (a green dot: stored or found in the environment; red: none)
// and Edit / Delete; one editor is open at a time. "Add model provider" opens
// one card with two ways in: a provider from pi's catalog, or a custom
// OpenAI-, Anthropic- or Google-compatible endpoint. Keys are write-only: an
// input starts empty, and a blank one keeps what is stored.
import type { LoginView, ModelProvider, ModelsView } from '@shared/host-api'
import { Check, ChevronRight, Copy, Cpu, ExternalLink, Eye, EyeOff, LoaderCircle, LogIn, Plus, Sparkles } from 'lucide-react'
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { HostError, host } from '@/host/client'
import { cn } from '@/lib/utils'

/** Which editor is open: a listed provider's, or the add card. */
type Editing = { kind: 'row'; id: string } | { kind: 'add' } | null

const message = (e: unknown) => (e instanceof HostError || e instanceof Error ? e.message : String(e))

/** Providers the add card offers first. */
const FIRST = ['openai-codex', 'anthropic', 'openai', 'google', 'deepseek', 'openrouter', 'xai', 'mistral', 'groq']

const PROTOCOL_LABEL: Record<string, string> = {
  'openai-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
  'google-generative-ai': 'Google Generative AI',
}

/** The model providers, loaded while the dialog is open. */
function useModels(open: boolean) {
  const [view, setView] = useState<ModelsView>()
  const [error, setError] = useState<string>()
  const load = () => {
    setError(undefined)
    host.models().then(setView, (e) => setError(message(e)))
  }
  useEffect(() => {
    if (open) load()
  }, [open])
  return { view, setView, error, load }
}

export function ModelsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { view, setView, error, load } = useModels(open)
  const [editing, setEditing] = useState<Editing>(null)
  const [saved, setSaved] = useState<string>()
  useEffect(() => {
    if (!open) {
      setEditing(null)
      setSaved(undefined)
    }
  }, [open])

  const listed = useMemo(() => (view?.providers ?? []).filter((p) => p.listed), [view])
  const done = (next: ModelsView, what?: string) => {
    setView(next)
    setEditing(null)
    setSaved(what)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(720px,88vh)] grid-cols-[200px_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[920px]">
        <nav aria-label="Settings" className="flex flex-col gap-1 border-r border-border bg-sidebar/60 px-3 pt-5">
          <DialogTitle className="px-2.5 pb-3 text-[17px] font-semibold tracking-[-0.01em]">Settings</DialogTitle>
          <span className="flex h-9 items-center gap-2.5 rounded-lg bg-foreground/[0.06] px-2.5 text-[14px] font-medium">
            <Sparkles aria-hidden="true" className="size-4 text-primary" />
            Models
          </span>
        </nav>

        <section className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-7 pt-6 pb-8">
            <div className="flex max-w-[680px] flex-col gap-3">
              <h2 className="text-[16px] leading-6 font-semibold">Models</h2>
              <DialogDescription className="text-[13.5px] leading-[22px] text-muted-foreground">
                Enter your API keys to use models from these providers. Live sessions run on the default model.
              </DialogDescription>
              <p role="status" aria-live="polite" className="sr-only">
                {saved ? `Saved ${view?.providers.find((p) => p.id === saved)?.name ?? saved}.` : ''}
              </p>

              {error ? (
                <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/[0.04] px-4 py-3 text-[13px] text-destructive">
                  <span className="min-w-0 flex-1">Loading the providers failed: {error}</span>
                  <Button variant="outline" size="sm" onClick={load}>
                    Retry
                  </Button>
                </div>
              ) : !view ? (
                <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Reading the providers…
                </div>
              ) : (
                <>
                  <DefaultModel view={view} onSaved={(next) => setView(next)} />

                  <ul className="mt-3 flex flex-col gap-2">
                    {listed.map((p) => (
                      <li key={p.id}>
                        <ProviderRow
                          provider={p}
                          protocols={view.protocols}
                          editing={editing?.kind === 'row' && editing.id === p.id}
                          justSaved={saved === p.id}
                          onEdit={() => {
                            setSaved(undefined)
                            setEditing({ kind: 'row', id: p.id })
                          }}
                          onClose={() => setEditing(null)}
                          onSaved={(next) => done(next, p.id)}
                        />
                      </li>
                    ))}
                  </ul>

                  {editing?.kind === 'add' ? (
                    <AddCard view={view} onClose={() => setEditing(null)} onSaved={(next, id) => done(next, id)} />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSaved(undefined)
                        setEditing({ kind: 'add' })
                      }}
                      className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/20 text-[13.5px] font-medium text-foreground transition-colors outline-none hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <Plus aria-hidden="true" className="size-4" /> Add model provider
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}

// ---------- default model ----------

/** The model new live sessions use, and its thinking level: saved as soon as either changes. */
function DefaultModel({ view, onSaved }: { view: ModelsView; onSaved: (next: ModelsView) => void }) {
  const usable = view.providers.filter((p) => p.configured && p.models.length)
  const current = view.default
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const id = useId()
  const model = current ? view.providers.find((p) => p.id === current.provider)?.models.find((m) => m.id === current.model) : undefined
  const levels = model?.thinking ?? ['off']

  const save = async (provider: string, modelId: string, thinking: string) => {
    setBusy(true)
    setError(undefined)
    try {
      onSaved(await host.setDefaultModel({ provider, model: modelId, thinking }))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3.5 shadow-[var(--highlight)]">
      <div className="flex items-center gap-2">
        <Cpu aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="text-[14px] font-medium">Default model</span>
        {current && !current.usable && <Dot tone="bad" label="Its provider has no API key" />}
        {busy && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      {usable.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">Add a provider with an API key below, then choose the model live sessions use.</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
          <Field label="Model" htmlFor={`${id}-model`}>
            <select
              id={`${id}-model`}
              className={selectClass}
              value={current ? `${current.provider}/${current.model}` : ''}
              disabled={busy}
              onChange={(e) => {
                const [provider, ...rest] = e.target.value.split('/')
                const modelId = rest.join('/')
                const picked = usable.find((p) => p.id === provider)?.models.find((m) => m.id === modelId)
                const thinking = picked && current && picked.thinking.includes(current.thinking) ? current.thinking : picked?.thinking.includes('medium') ? 'medium' : (picked?.thinking[0] ?? 'off')
                void save(provider, modelId, thinking)
              }}
            >
              {!current && <option value="">Choose a model…</option>}
              {current && !usable.some((p) => p.id === current.provider) && (
                <option value={`${current.provider}/${current.model}`}>
                  {current.provider}/{current.model} (no key)
                </option>
              )}
              {usable.map((p) => (
                <optgroup key={p.id} label={p.name}>
                  {p.models.map((m) => (
                    <option key={m.id} value={`${p.id}/${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Thinking" htmlFor={`${id}-thinking`}>
            <select
              id={`${id}-thinking`}
              className={selectClass}
              value={current?.thinking ?? 'off'}
              disabled={busy || !current || levels.length < 2}
              onChange={(e) => current && void save(current.provider, current.model, e.target.value)}
            >
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  )
}

// ---------- provider rows ----------

/** A key's state in words, and its dot: stored, from the environment, signed in, or missing. */
function keyState(p: ModelProvider): { tone: 'good' | 'bad' | 'none'; text: string } {
  if (p.credential === 'oauth') return { tone: 'good', text: 'Signed in' }
  if (p.credential === 'api_key') return { tone: 'good', text: 'API key saved' }
  if (p.source === 'environment' && p.envFound.length) return { tone: 'good', text: `From ${p.envFound[0]}` }
  if (p.configured) return { tone: 'good', text: 'Configured' }
  if (!p.keyAuth) return { tone: 'none', text: 'Uses its own credentials' }
  return { tone: 'bad', text: 'API key missing' }
}

interface ProviderRowProps {
  provider: ModelProvider
  protocols: string[]
  editing: boolean
  justSaved: boolean
  onEdit: () => void
  onClose: () => void
  onSaved: (next: ModelsView) => void
}

function ProviderRow({ provider: p, protocols, editing, justSaved, onEdit, onClose, onSaved }: ProviderRowProps) {
  const state = keyState(p)
  // what Connect keeps is deleted; a key from the environment is ignored by Connect from then on (the shell keeps it)
  const fromEnv = !p.credential && p.envFound.length > 0
  const removable = !!p.credential || p.custom || p.baseUrl !== null || (!p.configured && p.listed) || fromEnv
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const remove = async () => {
    setBusy(true)
    setError(undefined)
    try {
      onSaved(await host.removeProvider(p.id))
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  return (
    <div className={cn('rounded-xl border border-border bg-card shadow-[var(--highlight)] transition-shadow', editing && 'shadow-[var(--highlight),var(--elev-1)]')}>
      <div className="flex min-h-[56px] items-center gap-2.5 px-4 py-2.5">
        <span className="text-[14px] font-medium">{p.name}</span>
        {p.custom && <span className="rounded-md bg-foreground/[0.05] px-1.5 text-[11px] leading-5 text-muted-foreground">Custom</span>}
        <Dot tone={state.tone} label={state.text} />
        <span className={cn('text-[12px]', state.tone === 'good' ? 'text-success' : state.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>{state.text}</span>
        {justSaved && (
          <span className="flex items-center gap-1 text-[12px] text-success animate-in fade-in">
            <Check aria-hidden="true" className="size-3.5" /> Saved
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {confirming ? (
            <>
              <span className="text-[12px] text-muted-foreground">
                {p.credential === 'oauth' ? `Sign out of ${p.name}?` : fromEnv ? `Remove ${p.name}? Connect will ignore ${p.envFound[0]}.` : `Delete ${p.name}?`}
              </span>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>
                {busy ? (p.credential === 'oauth' ? 'Signing out…' : 'Removing…') : p.credential === 'oauth' ? 'Sign out' : fromEnv ? 'Remove' : 'Delete'}
              </Button>
            </>
          ) : (
            !editing && (
              <>
                {p.signIn && !p.configured ? (
                  <Button size="sm" onClick={onEdit}>
                    <LogIn aria-hidden="true" /> {p.signIn.label}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={onEdit}>
                    Edit
                  </Button>
                )}
                {removable && (
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirming(true)}>
                    {p.credential === 'oauth' ? 'Sign out' : 'Delete'}
                  </Button>
                )}
              </>
            )
          )}
        </span>
      </div>
      {error && <p className="px-4 pb-3 text-[12px] text-destructive">{error}</p>}
      {editing && (
        <div className="px-3 pb-3">
          {p.custom ? (
            <CustomEditor protocols={protocols} existing={p} onClose={onClose} onSaved={(next) => onSaved(next)} />
          ) : (
            <ProviderEditor provider={p} onClose={onClose} onSaved={onSaved} />
          )}
        </div>
      )}
    </div>
  )
}

// ---------- editors ----------

/** A built-in provider's editor: its API key, and under Customized settings its base URL and models. */
function ProviderEditor({ provider: p, onClose, onSaved, bare = false }: { provider: ModelProvider; onClose: () => void; onSaved: (next: ModelsView) => void; bare?: boolean }) {
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(p.baseUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const id = useId()

  const save = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const change: { key?: string; baseUrl?: string | null } = {}
      if (key.trim()) change.key = key.trim()
      if (baseUrl.trim() !== (p.baseUrl ?? '')) change.baseUrl = baseUrl.trim() || null
      onSaved(await host.saveProvider(p.id, change))
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  return (
    <EditorShell bare={bare} busy={busy} error={error} saveLabel="Save" onClose={onClose} onSave={() => void save()}>
      {p.signIn && <SignInPanel provider={p} onSignedIn={onSaved} />}
      {p.keyAuth ? (
        <Field label={p.signIn ? 'Or use an API key' : 'API key'} htmlFor={`${id}-key`} help={p.envVars.length ? `A saved key is used first, then ${p.envVars.join(', ')} from the host's environment.` : undefined}>
          <KeyInput id={`${id}-key`} value={key} onChange={setKey} placeholder={keyPlaceholder(p)} />
          {!key && <KeyHint provider={p} />}
        </Field>
      ) : p.signIn ? null : (
        <p className="text-[12.5px] text-muted-foreground">{p.name} signs in with its own credentials (for example a cloud account on this machine); it takes no API key here.</p>
      )}
      <Fold label="Customized settings">
        <Field label="Base URL" htmlFor={`${id}-base`}>
          <input id={`${id}-base`} className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={p.defaultBaseUrl ?? 'https://…'} spellCheck={false} />
          <span className="text-[11.5px] text-faint">Leave blank to use the provider's own endpoint. A proxy or gateway goes here.</span>
        </Field>
        <ModelList provider={p} />
      </Fold>
    </EditorShell>
  )
}

/** A custom provider's editor: ID, name, protocol, endpoint, key and model IDs. */
function CustomEditor({
  protocols,
  existing,
  taken = [],
  onClose,
  onSaved,
  bare = false,
}: {
  protocols: string[]
  existing?: ModelProvider
  taken?: string[]
  onClose: () => void
  onSaved: (next: ModelsView, id: string) => void
  bare?: boolean
}) {
  const [providerId, setProviderId] = useState(existing?.id ?? '')
  const [name, setName] = useState(existing && existing.name !== existing.id ? existing.name : '')
  const [api, setApi] = useState(existing?.api ?? protocols[0] ?? 'openai-completions')
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '')
  const [key, setKey] = useState('')
  const [models, setModels] = useState(existing?.models.map((m) => m.id).join('\n') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const id = useId()

  const idProblem = !existing && providerId && (!/^[a-z][a-z0-9-]*$/.test(providerId) ? 'Start with a lowercase letter; then lowercase letters, digits and dashes.' : taken.includes(providerId) ? 'A provider already uses this ID.' : undefined)
  const modelIds = models.split(/[\n,]/).map((m) => m.trim()).filter(Boolean)

  const save = async () => {
    setBusy(true)
    setError(undefined)
    try {
      onSaved(await host.saveCustomProvider({ id: providerId.trim(), ...(name.trim() ? { name: name.trim() } : {}), api, baseUrl: baseUrl.trim(), ...(key.trim() ? { key: key.trim() } : {}), models: modelIds }), providerId.trim())
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  return (
    <EditorShell
      bare={bare}
      busy={busy}
      error={error}
      saveLabel={existing ? 'Save' : 'Create provider'}
      canSave={!!providerId && !idProblem && !!baseUrl.trim() && modelIds.length > 0}
      onClose={onClose}
      onSave={() => void save()}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Provider ID" htmlFor={`${id}-id`} help="Lowercase; names this provider in requests and its stored key. It cannot change later.">
          <input id={`${id}-id`} className={inputClass} value={providerId} disabled={!!existing} onChange={(e) => setProviderId(e.target.value)} placeholder="my-gateway" spellCheck={false} aria-invalid={!!idProblem} />
          {idProblem && <span className="text-[11.5px] text-destructive">{idProblem}</span>}
        </Field>
        <Field label="Display name" htmlFor={`${id}-name`}>
          <input id={`${id}-name`} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={providerId || 'My Gateway'} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="API protocol" htmlFor={`${id}-api`}>
          <select id={`${id}-api`} className={selectClass} value={api} onChange={(e) => setApi(e.target.value)}>
            {protocols.map((p) => (
              <option key={p} value={p}>
                {PROTOCOL_LABEL[p] ?? p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Base URL" htmlFor={`${id}-base`}>
          <input id={`${id}-base`} className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={api === 'anthropic-messages' ? 'https://gateway.example' : 'https://gateway.example/v1'} spellCheck={false} />
        </Field>
      </div>
      <Field label="API key" htmlFor={`${id}-key`}>
        <KeyInput id={`${id}-key`} value={key} onChange={setKey} placeholder={existing?.credential ? 'Leave blank to keep the saved key' : 'Enter your API key (blank if the endpoint needs none)'} />
      </Field>
      <Field label="Models" htmlFor={`${id}-models`} help="The model IDs the endpoint serves, one per line.">
        <textarea id={`${id}-models`} className={cn(inputClass, 'h-auto min-h-[84px] py-2 font-mono text-[12.5px]')} value={models} onChange={(e) => setModels(e.target.value)} placeholder={'gpt-4o\nllama-3.1-70b'} spellCheck={false} />
      </Field>
    </EditorShell>
  )
}

/** The add card: a catalog provider or a custom endpoint, one switch between them. */
function AddCard({ view, onClose, onSaved }: { view: ModelsView; onClose: () => void; onSaved: (next: ModelsView, id: string) => void }) {
  // the common ones first, then the rest by name
  const addable = useMemo(() => {
    const rank = (id: string) => (FIRST.indexOf(id) + 1 || FIRST.length + 1)
    return view.providers.filter((p) => !p.listed && !p.custom).sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
  }, [view])
  const [mode, setMode] = useState<'catalog' | 'custom'>(addable.length ? 'catalog' : 'custom')
  const [picked, setPicked] = useState(addable[0]?.id ?? '')
  const provider = addable.find((p) => p.id === picked)
  const id = useId()

  return (
    <div className="flex flex-col gap-3.5 rounded-xl bg-muted/70 px-4 py-4 ring-1 ring-foreground/[0.04]">
      <div role="tablist" aria-label="How to add" className="inline-flex w-fit gap-0.5 rounded-lg bg-foreground/[0.06] p-0.5">
        {(
          [
            ['catalog', 'Third-party model provider', !addable.length],
            ['custom', 'Custom model API', false],
          ] as const
        ).map(([value, label, disabled]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            disabled={disabled}
            onClick={() => setMode(value)}
            className={cn(
              'h-8 rounded-md px-3.5 text-[13px] font-medium transition-[background-color,color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40',
              mode === value ? 'bg-background text-foreground shadow-[var(--highlight),var(--elev-1)]' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="-mt-1 text-[12px] text-muted-foreground">
        {mode === 'catalog'
          ? 'Pick OpenAI, Anthropic, Kimi or another provider from the built-in catalog and enter its API key.'
          : 'Connect a relay, a self-hosted server or any other OpenAI-, Anthropic- or Google-compatible endpoint by its base URL, protocol and models.'}
      </p>
      {mode === 'catalog' && provider ? (
        <>
          <Field label="Provider" htmlFor={`${id}-provider`}>
            <select id={`${id}-provider`} className={cn(selectClass, 'max-w-[320px]')} value={picked} onChange={(e) => setPicked(e.target.value)}>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <ProviderEditor key={provider.id} bare provider={provider} onClose={onClose} onSaved={(next) => onSaved(next, provider.id)} />
        </>
      ) : (
        <CustomEditor bare protocols={view.protocols} taken={view.providers.map((p) => p.id)} onClose={onClose} onSaved={onSaved} />
      )}
    </div>
  )
}

// ---------- sign-in ----------

const POLL_MS = 1000

/**
 * A subscription sign-in (Sign in with ChatGPT, …) run by the host on pi's
 * flow: choose browser or device code, then follow its step (the page opens in
 * the system browser, or a code to enter on the provider's page). Polled while
 * it runs; leaving the dialog cancels it. Connect gets its own token.
 */
function SignInPanel({ provider: p, onSignedIn }: { provider: ModelProvider; onSignedIn: (next: ModelsView) => void }) {
  const [login, setLogin] = useState<LoginView | null>(null)
  const [error, setError] = useState<string>()
  const [pasted, setPasted] = useState('')
  const [copied, setCopied] = useState(false)
  const opened = useRef<string | null>(null)
  const live = login && (login.state === 'starting' || login.state === 'waiting') ? login.id : null

  // follow the sign-in while it runs
  useEffect(() => {
    if (!live) return
    let stop = false
    const tick = async () => {
      try {
        const next = await host.login(live)
        if (stop) return
        setLogin(next)
        if (next.state === 'done') onSignedIn(await host.models())
      } catch (e) {
        if (!stop) setError(message(e))
      }
    }
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [live])

  // leaving (the editor or the dialog closes) cancels a sign-in still running
  const liveRef = useRef(live)
  liveRef.current = live
  useEffect(() => () => void (liveRef.current && host.cancelLogin(liveRef.current).catch(() => {})), [])

  // the browser way opens its page once, as soon as there is one
  useEffect(() => {
    if (login?.step?.type === 'auth_url' && opened.current !== login.step.url) {
      opened.current = login.step.url
      void host.openLogin(login.id).catch((e) => setError(message(e)))
    }
  }, [login])

  const act = async (f: () => Promise<LoginView>) => {
    setError(undefined)
    try {
      setLogin(await f())
    } catch (e) {
      setError(message(e))
    }
  }
  const start = () => {
    opened.current = null
    setPasted('')
    void act(() => host.startLogin(p.id))
  }

  const signedIn = p.credential === 'oauth'
  const step = login?.step
  const prompt = login?.prompt

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-background px-3.5 py-3 ring-1 ring-foreground/[0.06]">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">{p.signIn!.plan}</span>
          <span className="block text-[11.5px] text-muted-foreground">
            {signedIn ? 'Signed in. Connect has its own sign-in; other apps on this machine stay signed in.' : 'Use your subscription. Connect gets its own sign-in; other apps on this machine stay signed in.'}
          </span>
        </span>
        {!live && (
          <Button type="button" size="lg" variant={signedIn ? 'outline' : 'default'} className="px-3.5" onClick={start}>
            <LogIn aria-hidden="true" /> {signedIn ? 'Sign in again' : p.signIn!.label}
          </Button>
        )}
        {live && (
          <Button type="button" size="lg" variant="outline" className="px-3.5" onClick={() => void act(() => host.cancelLogin(live))}>
            Cancel
          </Button>
        )}
      </div>

      {live && login && (
        <div className="flex flex-col gap-3 border-t border-foreground/[0.06] pt-3 animate-in fade-in">
          {prompt?.type === 'select' && prompt.options ? (
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-muted-foreground">How to sign in</span>
              <div className="grid grid-cols-2 gap-2">
                {prompt.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => void act(() => host.respondLogin(login.id, o.id))}
                    className="flex flex-col items-start gap-0.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-[border-color,box-shadow] outline-none hover:border-primary/40 hover:shadow-[0_0_14px_-8px_var(--glow)] focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="text-[13px] font-medium">{methodLabel(o.id, o.label)}</span>
                    <span className="text-[11.5px] text-muted-foreground">{methodHint(o.id, o.description)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : step?.type === 'device_code' ? (
            <div className="flex flex-col items-start gap-2.5">
              <span className="text-[12.5px] text-muted-foreground">Open the sign-in page, sign in, and enter this code:</span>
              <div className="flex items-center gap-2">
                <code className="rounded-lg bg-muted px-3 py-1.5 font-mono text-[20px] font-semibold tracking-[0.12em]">{step.userCode}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy the code"
                  onClick={() => {
                    void navigator.clipboard?.writeText(step.userCode).then(() => setCopied(true))
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {copied ? <Check className="text-success" /> : <Copy />}
                </Button>
              </div>
              <Button type="button" variant="outline" onClick={() => void act(() => host.openLogin(login.id))}>
                <ExternalLink aria-hidden="true" /> Open {hostOf(step.verificationUri)}
              </Button>
              <Waiting text="Waiting for you to approve it…" />
            </div>
          ) : step?.type === 'auth_url' ? (
            <div className="flex flex-col gap-2.5">
              <span className="text-[12.5px] text-muted-foreground">Your browser opened {hostOf(step.url)}. Sign in there and come back; this finishes by itself.</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => void act(() => host.openLogin(login.id))}>
                  <ExternalLink aria-hidden="true" /> Open again
                </Button>
              </div>
              <Waiting text="Waiting for the browser…" />
              {prompt && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] text-faint">If the browser cannot reach Connect, paste the address it ended on:</span>
                  <div className="flex gap-2">
                    <input
                      className={cn(inputClass, 'font-mono text-[12px]')}
                      value={pasted}
                      onChange={(e) => setPasted(e.target.value)}
                      placeholder={prompt.placeholder ?? 'http://localhost:1455/auth/callback?code=…'}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <Button type="button" variant="outline" size="lg" disabled={!pasted.trim()} onClick={() => void act(() => host.respondLogin(login.id, pasted.trim()))}>
                      Submit
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : prompt ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-muted-foreground">{prompt.message}</span>
              <div className="flex gap-2">
                <input className={inputClass} type={prompt.type === 'secret' ? 'password' : 'text'} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={prompt.placeholder} autoComplete="off" />
                <Button type="button" variant="outline" size="lg" disabled={!pasted.trim()} onClick={() => void act(() => host.respondLogin(login.id, pasted.trim()))}>
                  Submit
                </Button>
              </div>
            </div>
          ) : (
            <Waiting text={login.progress ?? 'Starting the sign-in…'} />
          )}
        </div>
      )}

      {login?.state === 'failed' && (
        <p role="alert" className="text-[12.5px] text-destructive">
          Sign-in failed: {login.error}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

const methodLabel = (id: string, label: string) => (id === 'browser' ? 'Browser' : id === 'device_code' ? 'Device code' : label)
const methodHint = (id: string, description?: string) =>
  id === 'browser' ? 'Opens your browser; finishes by itself.' : id === 'device_code' ? 'Enter a short code on the sign-in page.' : (description ?? '')
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function Waiting({ text }: { text: string }) {
  return (
    <span role="status" className="flex items-center gap-2 text-[12px] text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-primary" /> {text}
    </span>
  )
}

// ---------- parts ----------

const inputClass =
  'h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-[13.5px] transition-[border-color,box-shadow] outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60 aria-invalid:border-destructive'
const selectClass = cn(inputClass, 'appearance-auto pr-2')

function EditorShell({
  bare,
  busy,
  error,
  saveLabel,
  canSave = true,
  onClose,
  onSave,
  children,
}: {
  bare: boolean
  busy: boolean
  error?: string
  saveLabel: string
  canSave?: boolean
  onClose: () => void
  onSave: () => void
  children: ReactNode
}) {
  return (
    <form
      className={cn('flex flex-col gap-3.5', !bare && 'rounded-lg bg-muted/70 px-4 py-4 ring-1 ring-foreground/[0.04]')}
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave && !busy) onSave()
      }}
    >
      {children}
      {error && (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-foreground/[0.06] pt-3.5">
        <Button type="button" variant="outline" size="lg" className="px-4" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="px-4" disabled={busy || !canSave}>
          {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {busy ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </form>
  )
}

function Field({ label, htmlFor, help, children }: { label: string; htmlFor: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        {label}
        {help && (
          <span title={help} aria-label={help} className="flex size-4 cursor-help items-center justify-center rounded-full border border-foreground/15 text-[10px] text-faint">
            ?
          </span>
        )}
      </label>
      {children}
    </div>
  )
}

/** A write-only key: starts empty, masked unless shown; a change masks it again. */
function KeyInput({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        autoComplete="new-password"
        spellCheck={false}
        className={cn(inputClass, 'pr-9 font-mono')}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          setShown(false)
          onChange(e.target.value)
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => setShown(!shown)}
          aria-label={shown ? 'Hide secret' : 'Show secret'}
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      )}
    </div>
  )
}

function keyPlaceholder(p: ModelProvider): string {
  if (p.credential === 'api_key') return 'Leave blank to keep the saved key'
  if (p.envVars.length) return `Leave blank to use the environment (${p.envVars.at(-1)})`
  return 'Enter your API key'
}

/** Under an empty key field: whether the environment has the key. */
function KeyHint({ provider: p }: { provider: ModelProvider }) {
  if (p.credential === 'api_key' || !p.envVars.length) return null
  if (p.envFound.length) return <span className="text-[12px] text-success">Env var detected ({p.envFound[0]}).</span>
  return <span className="text-[12px] text-warning">Env var not detected. Enter an API key, or set {p.envVars.at(-1)} in the host's environment.</span>
}

function ModelList({ provider: p }: { provider: ModelProvider }) {
  if (!p.models.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-muted-foreground">Models ({p.models.length})</span>
      <ul className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
        {p.models.map((m) => (
          <li key={m.id} title={[m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K context` : null, m.reasoning ? 'reasons' : null].filter(Boolean).join(' · ')} className="rounded-md bg-background px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground ring-1 ring-foreground/[0.06]">
            {m.id}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-3 border-t border-foreground/[0.06] pt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-fit items-center gap-1 text-[13px] font-medium text-foreground outline-none focus-visible:underline">
        <ChevronRight aria-hidden="true" className={cn('size-3.5 transition-transform duration-(--dur-base)', open && 'rotate-90')} />
        {label}
      </button>
      {open && <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-1">{children}</div>}
    </div>
  )
}

function Dot({ tone, label }: { tone: 'good' | 'bad' | 'none'; label: string }) {
  if (tone === 'none') return null
  return <span role="img" aria-label={label} title={label} className={cn('size-2 shrink-0 rounded-full', tone === 'good' ? 'bg-success' : 'bg-destructive')} />
}
