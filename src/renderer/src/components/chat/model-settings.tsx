import { useI18n } from '@/i18n'
import { Check, ChevronDown, Eye, EyeOff, Globe, KeyRound, LoaderCircle, PlugZap, Plus, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentModels, DiscoveredModel, ModelSettings } from '@shared/agent-api'

import { DeleteProviderDialog } from '@/components/chat/delete-provider-dialog'
import { ModelDiscovery } from '@/components/chat/model-discovery'
import { RequestHeaders, type RequestHeaderRow } from '@/components/chat/request-headers'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { agentHost } from '@/host/agent-client'
import { cn } from '@/lib/utils'

const APIS = [
  { value: 'openai-completions', label: 'Chat Completions', description: 'OpenAI-compatible APIs' },
  { value: 'openai-responses', label: 'Responses', description: 'OpenAI Responses API' },
  { value: 'anthropic-messages', label: 'Messages', description: 'Anthropic Claude API' },
  { value: 'google-generative-ai', label: 'Gemini', description: 'Google Generative AI' },
] as const
const DEFAULT_API = 'provider-default'

export function ModelSettingsDialog({
  open,
  onOpenChange,
  models,
  onSaved,
  onSynced,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  models: AgentModels | undefined
  onSaved: (models: AgentModels) => void
  onSynced: () => Promise<void>
}) {
  const { t } = useI18n()
  const [provider, setProvider] = useState('')
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [api, setApi] = useState('')
  const [thinkingLevel, setThinkingLevel] = useState('off')
  const [contextWindow, setContextWindow] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [reasoning, setReasoning] = useState(false)
  const [limitsOpen, setLimitsOpen] = useState(false)
  const [discoveryOpen, setDiscoveryOpen] = useState(false)
  const [busy, setBusy] = useState<'provider' | 'save' | 'test' | null>(null)
  const [error, setError] = useState('')
  const [tested, setTested] = useState('')
  const [testedIsResponse, setTestedIsResponse] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [headerRows, setHeaderRows] = useState<RequestHeaderRow[]>([])
  const headers = useMemo(() => Object.fromEntries(headerRows
    .filter((row) => row.name.trim() || row.value)
    .map((row) => [row.name.trim(), row.value])), [headerRows])

  const knownProvider = models?.providers.find((p) => p.id === provider.trim())
  const isNewProvider = Boolean(provider.trim() && !knownProvider)
  const effectiveApi = api || (isNewProvider ? 'openai-completions' : '')
  const defaultApiDescription = isNewProvider ? 'OpenAI-compatible Chat Completions' : 'Use the provider’s configured format'
  const providerModels = models?.models.filter((m) => m.provider === provider.trim()) ?? []

  // Only providers that the user has actually configured / authenticated
  const configuredProviders = models?.providers.filter((p) => p.custom || p.hasKey) ?? []
  const savedModels = configuredProviders.some((p) => p.id === provider.trim()) ? providerModels : []

  useEffect(() => {
    if (!open) return
    resetProvider()
  }, [open])

  function resetProvider() {
    setProvider('')
    setModelId('')
    setThinkingLevel('off')
    setBaseUrl('')
    setApi('')
    setApiKey('')
    setHeaderRows([])
    setShowKey(false)
    setContextWindow('')
    setMaxTokens('')
    setReasoning(false)
    setLimitsOpen(false)
    setDiscoveryOpen(false)
    setError('')
    setTested('')
  }

  function changeProvider(name: string) {
    setProvider(name)
    const config = models?.providers.find((p) => p.id === name.trim())
    setBaseUrl(config?.baseUrl ?? '')
    setApi(config?.api ?? (name.trim() && !config ? 'openai-completions' : ''))
    setApiKey('')
    setHeaderRows(Object.entries(config?.headers ?? {}).map(([name, value]) => ({ id: crypto.randomUUID(), name, value })))
    setShowKey(false)
    setModelId('')
    setReasoning(false)
    setContextWindow('')
    setMaxTokens('')
    setThinkingLevel('off')
    setLimitsOpen(false)
    setDiscoveryOpen(false)
    setTested('')
    setError('')
  }

  function chooseModel(model: DiscoveredModel) {
    setModelId(model.id)
    setReasoning(model.reasoning ?? providerModels.find((known) => known.id === model.id)?.reasoning ?? false)
    setContextWindow(model.contextWindow !== undefined ? String(model.contextWindow) : '')
    setMaxTokens(model.maxTokens !== undefined ? String(model.maxTokens) : '')
    setThinkingLevel('off')
    setTested('')
    setError('')
  }

  async function saveProvider() {
    setBusy('provider')
    setError('')
    setTested('')
    setTestedIsResponse(false)
    try {
      onSaved(await agentHost.saveProvider({
        provider: provider.trim(),
        headers,
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(effectiveApi ? { api: effectiveApi } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      }))
      setApiKey('')
      setShowKey(false)
      setTested('Provider saved. Fetch models or add a model below.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function save(test: boolean) {
    setBusy(test ? 'test' : 'save')
    setError('')
    setTested('')
    setTestedIsResponse(test)
    const settings: ModelSettings = {
      provider: provider.trim(),
      modelId: modelId.trim(),
      headers,
      thinkingLevel,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(effectiveApi ? { api: effectiveApi } : {}),
      ...(contextWindow ? { contextWindow: Number(contextWindow) } : {}),
      ...(maxTokens ? { maxTokens: Number(maxTokens) } : {}),
      reasoning,
    }
    try {
      if (test) {
        const result = await agentHost.testModel(settings)
        onSaved(await agentHost.models())
        setTested(result.text || 'OK')
        setApiKey('')
      } else {
        onSaved(await agentHost.saveModels(settings))
        setApiKey('')
        setShowKey(false)
        setTested('Model saved and available in the main model selector.')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const canSubmit = !busy && provider.trim().length > 0 && modelId.trim().length > 0
  const selectedApi = APIS.find((option) => option.value === api)

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => { if (!deleteTarget && !busy) onOpenChange(next) }}>
      <DialogContent
        className="chat-dialog max-h-[90vh] overflow-y-auto rounded-2xl border p-5 [--dialog-inset:1.25rem] sm:max-w-[600px] sm:p-6 sm:[--dialog-inset:1.5rem]"
        onEscapeKeyDown={(event) => {
          if (!discoveryOpen) return
          event.preventDefault()
          setDiscoveryOpen(false)
          document.getElementById('agent-fetch-models')?.focus({ preventScroll: true })
        }}
      >
        <DialogHeader className="space-y-1 pb-1">
          <DialogTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </span>
            {t("Model Settings")}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("Manage separate connections and models for each provider.")}</DialogDescription>
        </DialogHeader>

        <section aria-label={t("Saved providers")} className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium text-muted-foreground">{t("Saved providers")} <span className="ml-1 tabular-nums text-faint">{configuredProviders.length}</span></span>
            <Button id="agent-add-provider" type="button" variant="ghost" size="sm" disabled={!!busy} onClick={resetProvider} className="h-7 rounded-lg px-2 text-[11px]">
              <Plus className="size-3.5" /> {t("Add provider")}</Button>
          </div>
          {configuredProviders.length > 0 ? (
            <div className="grid max-h-36 grid-cols-1 gap-2 overflow-y-auto p-0.5 sm:grid-cols-2">
              {configuredProviders.map((p) => {
                const active = provider.trim() === p.id
                const count = models?.models.filter((model) => model.provider === p.id).length ?? 0
                return <div
                  key={p.id}
                  className={cn('flex min-w-0 items-start gap-2 rounded-xl border px-3 py-2.5 transition-colors', active ? 'border-primary/25 bg-primary/[0.06]' : 'border-foreground/[0.07] bg-background/40 hover:border-primary/20 hover:bg-background/70')}
                >
                  <button
                    type="button"
                    aria-label={t("Edit provider {provider}", { provider: p.id })}
                    aria-pressed={active}
                    disabled={!!busy}
                    onClick={() => changeProvider(p.id)}
                    className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', p.hasKey ? 'bg-success' : 'bg-muted-foreground/35')} />
                    <span className="min-w-0 flex-1">
                    <span className="flex h-5 min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-medium leading-5" title={p.id}>{p.id}</span>{active && <Check className="size-3.5 shrink-0 text-primary" />}</span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">{count} {count === 1 ? t("model") : t("models")} · {p.hasKey ? t("Key configured") : t("No saved key")}</span>
                    </span>
                  </button>
                  <button type="button" aria-label={t("Delete provider {provider}", { provider: p.id })} title={t("Delete {name}", { name: p.id })} disabled={!!busy} onClick={() => setDeleteTarget(p.id)} className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-destructive/[0.08] hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><X className="size-3.5" /></button>
                </div>
              })}
            </div>
          ) : <p className="rounded-xl border border-dashed border-foreground/[0.09] px-3 py-3 text-xs text-muted-foreground">{t("Add your first provider below.")}</p>}
        </section>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) void save(false)
            else if (!busy && provider.trim()) void saveProvider()
          }}
          className="space-y-4 pt-1"
        >
          {/* Row 1: Provider & Model ID (Manual Entry) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-provider" className="text-xs font-medium text-foreground/85">
                {t("Provider")}</Label>
              <div className="relative">
                <Input
                  id="agent-provider"
                  value={provider}
                  onChange={(e) => changeProvider(e.target.value)}
                  required
                  placeholder={t("Enter provider ID…")}
                  disabled={!!busy}
                  className="h-9 pr-9 font-mono text-xs"
                />
                {provider && (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={t("Clear provider")}
                    disabled={!!busy}
                    onClick={() => changeProvider('')}
                    className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-lg text-faint outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="agent-model" className="text-xs font-medium text-foreground/85">
                {t("Model ID")}</Label>
              <div className="relative">
                <Input
                  id="agent-model"
                  value={modelId}
                  onChange={(e) => chooseModel({ id: e.target.value, name: e.target.value })}
                  disabled={!!busy}
                  placeholder={t("Enter model ID…")}
                  className="h-9 pr-9 font-mono text-xs"
                />
                {modelId && (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={t("Clear model ID")}
                    disabled={!!busy}
                    onClick={() => chooseModel({ id: '', name: '' })}
                    className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-lg text-faint outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              {savedModels.length > 0 && <Select
                value={savedModels.some((model) => model.id === modelId) ? modelId : ''}
                disabled={!!busy}
                onValueChange={(id) => {
                  const model = savedModels.find((item) => item.id === id)
                  if (model) chooseModel(model)
                }}
              >
                <SelectTrigger aria-label={t("Saved models for {provider}", { provider: provider.trim() })} className="h-8 w-full min-w-0 rounded-lg border-foreground/[0.06] bg-foreground/[0.02] text-[11px] data-[size=default]:h-8">
                  <SelectValue placeholder={t("Choose from {count} saved models", { count: savedModels.length })} />
                </SelectTrigger>
                <SelectContent className="chat-popover max-h-52">
                  {savedModels.map((model) => <SelectItem key={model.id} value={model.id} textValue={model.id} className="text-xs"><span className="block max-w-72 truncate" title={model.id}>{model.id}</span></SelectItem>)}
                </SelectContent>
              </Select>}
            </div>
          </div>

          {/* Row 2: Base URL & API Format (Directly visible for manual entry) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-base-url" className="flex items-center gap-1.5 text-xs font-medium text-foreground/85">
                <Globe className="size-3.5 text-faint" />
                {t("Base URL")} <span className="font-normal text-faint">{t("· optional")}</span>
              </Label>
              <div className="relative">
                <Input
                  id="agent-base-url"
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={t("Enter API endpoint…")}
                  disabled={!!busy}
                  className="h-9 pr-9 font-mono text-xs"
                />
                {baseUrl && (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={t("Clear base URL")}
                    disabled={!!busy}
                    onClick={() => setBaseUrl('')}
                    className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-lg text-faint outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="agent-api" className="text-xs font-medium text-foreground/85">
                {t("API format")}</Label>
              <Select
                value={api || DEFAULT_API}
                disabled={!!busy}
                onValueChange={(value) => {
                  setApi(value === DEFAULT_API ? '' : value)
                  setTested('')
                }}
              >
                <SelectTrigger
                  id="agent-api"
                  type="button"
                  title={t(selectedApi?.description ?? (api || defaultApiDescription))}
                  className="w-full min-w-0 gap-3 rounded-xl border-input/80 bg-background/70 px-3 text-xs backdrop-blur-xs transition-colors hover:border-primary/25 hover:bg-background/90 data-[size=default]:h-9 data-[state=open]:border-primary/40 data-[state=open]:ring-2 data-[state=open]:ring-ring/20 [&>svg]:size-3.5 [&>svg]:transition-transform [&[data-state=open]>svg]:rotate-180"
                >
                  <SelectValue className="min-w-0 flex-1 text-left">
                    <span className="truncate">{selectedApi?.label ?? (api || t("Provider default"))}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent position="popper" align="end" sideOffset={5} collisionPadding={16} className="glass-strong w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-transparent shadow-xl ring-0">
                  <SelectGroup className="p-1.5">
                    <SelectItem value={DEFAULT_API} textValue={t("Provider default")} className="rounded-xl py-2 pr-8 pl-3 data-[state=checked]:bg-primary/[0.07]">
                      <span className="block">
                        <span className="block text-xs font-medium">{t("Provider default")}</span>
                        <span className="mt-0.5 block text-[10.5px] leading-relaxed text-muted-foreground">{t(defaultApiDescription)}</span>
                      </span>
                    </SelectItem>
                    <SelectSeparator className="mx-2 my-1 bg-foreground/[0.06]" />
                    {api && !selectedApi && (
                      <SelectItem value={api} textValue={api} className="rounded-xl py-2 pr-8 pl-3 text-xs [overflow-wrap:anywhere] data-[state=checked]:bg-primary/[0.07] [&>span:last-child]:min-w-0">
                        {api}
                      </SelectItem>
                    )}
                    {APIS.map((option) => (
                      <SelectItem key={option.value} value={option.value} textValue={option.label} className="rounded-xl py-2 pr-8 pl-3 data-[state=checked]:bg-primary/[0.07]">
                        <span className="block">
                          <span className="block text-xs font-medium">{option.label}</span>
                          <span className="mt-0.5 block text-[10.5px] leading-relaxed text-muted-foreground">{t(option.description)}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 3: API Key with Show/Hide toggle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="agent-api-key" className="flex items-center gap-1.5 text-xs font-medium text-foreground/85">
                <KeyRound className="size-3.5 text-faint" />
                {t("API key")}{knownProvider?.hasKey && (
                  <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-medium text-success">
                    <span className="size-1.5 rounded-full bg-success" />
                    {t("Configured")}</span>
                )}
              </Label>
              <span className="text-[11px] text-faint">
                {knownProvider?.hasKey ? t("Leave blank to keep saved key") : t("Stored locally (0600)")}
              </span>
            </div>
            <div className="relative">
              <Input
                id="agent-api-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                disabled={!!busy}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={knownProvider?.hasKey ? t("Leave blank to keep the saved key") : t("Enter API key or environment credential")}
                className="h-9 pr-9 font-mono text-xs"
              />
              <button
                type="button"
                aria-label={showKey ? t("Hide API key") : t("Show API key")}
                disabled={!!busy}
                onClick={() => setShowKey(!showKey)}
                className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-lg text-faint outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>

          <RequestHeaders key={provider.trim()} rows={headerRows} disabled={!!busy} onChange={(next) => { setHeaderRows(next); setTested(''); setError('') }} />

          <ModelDiscovery
            active={open}
            provider={provider}
            baseUrl={baseUrl}
            api={effectiveApi}
            apiKey={apiKey}
            headers={headers}
            selectedId={modelId}
            disabled={!!busy}
            expanded={discoveryOpen}
            onExpandedChange={setDiscoveryOpen}
            onSynced={onSynced}
            onSelect={chooseModel}
          />

          {/* Row 4: Optional Context & Token Limits */}
          <div className="overflow-hidden rounded-xl border border-foreground/[0.08] bg-foreground/[0.015]">
            <button
              type="button"
              aria-expanded={limitsOpen}
              onClick={() => setLimitsOpen(!limitsOpen)}
              className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.025] hover:text-foreground"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="size-3.5 text-faint" />
                <span>{t("Custom model limits")}</span>
                <span className="font-normal text-faint">{t("· optional")}</span>
              </span>
              <ChevronDown className={cn('size-3.5 text-faint transition-transform duration-(--dur-base)', limitsOpen && 'rotate-180')} />
            </button>

            {limitsOpen && (
              <div className="space-y-3 border-t border-foreground/[0.05] px-3.5 pt-3 pb-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-context" className="text-[11px] text-muted-foreground">
                      {t("Context window")}</Label>
                    <Input
                      id="agent-context"
                      type="number"
                      min="1"
                      value={contextWindow}
                      onChange={(e) => setContextWindow(e.target.value)}
                      placeholder={t("Provider default")}
                      className="h-8.5 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-output" className="text-[11px] text-muted-foreground">
                      {t("Max output tokens")}</Label>
                    <Input
                      id="agent-output"
                      type="number"
                      min="1"
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(e.target.value)}
                      placeholder={t("Provider default")}
                      className="h-8.5 font-mono text-xs"
                    />
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-xs text-muted-foreground select-none hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={reasoning}
                    onChange={(e) => setReasoning(e.target.checked)}
                    className="size-3.5 rounded accent-primary"
                  />
                  <span>{t("Supports reasoning")}</span>
                </label>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/[0.07] px-3.5 py-2.5 text-xs break-words text-destructive">
              {t(error)}
            </p>
          )}
          {tested && (
            <p role="status" className="flex items-center gap-2 rounded-2xl border border-success/20 bg-success/[0.08] px-3.5 py-2.5 text-xs font-medium text-success">
              <Check className="size-4 shrink-0" />
              <span>{testedIsResponse ? tested : t(tested)}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-foreground/[0.06] pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mr-auto h-8.5 rounded-xl px-3.5 text-xs"
              disabled={!!busy || !provider.trim()}
              onClick={() => void saveProvider()}
            >
              {busy === 'provider' && <LoaderCircle className="size-3.5 animate-spin" />}
              {t("Save provider")}</Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8.5 rounded-xl px-3.5 text-xs"
              disabled={!canSubmit}
              onClick={() => void save(true)}
            >
              {busy === 'test' ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
              {t("Save & test")}</Button>
            <Button
              type="submit"
              size="sm"
              className="btn-primary h-8.5 rounded-xl px-4 text-xs"
              disabled={!canSubmit}
            >
              {busy === 'save' && <LoaderCircle className="size-3.5 animate-spin" />}
              {t("Save model")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    {deleteTarget && <DeleteProviderDialog
      provider={deleteTarget}
      modelCount={models?.models.filter((model) => model.provider === deleteTarget).length ?? 0}
      onClose={() => setDeleteTarget(null)}
      onDelete={async (id) => {
        const catalog = await agentHost.removeProvider(id)
        onSaved(catalog)
        if (provider.trim() === id) resetProvider()
      }}
    />}
    </>
  )
}
