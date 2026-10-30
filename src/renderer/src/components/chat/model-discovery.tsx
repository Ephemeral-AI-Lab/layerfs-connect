import { useI18n } from '@/i18n'
import type { DiscoveredModel, ModelDiscoveryInput, ModelDiscoveryResult } from '@shared/agent-api'
import { Check, ChevronDown, Download, LoaderCircle, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { agentHost } from '@/host/agent-client'
import { cn } from '@/lib/utils'

interface ModelDiscoveryProps extends ModelDiscoveryInput {
  active: boolean
  disabled: boolean
  selectedId: string
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onSynced: () => Promise<void>
  onSelect: (model: DiscoveredModel) => void
}

export function ModelDiscovery({ provider, baseUrl, api, apiKey, headers, active, disabled, selectedId, expanded, onExpandedChange: setExpanded, onSynced, onSelect }: ModelDiscoveryProps) {
  const { t, locale } = useI18n()
  const [result, setResult] = useState<ModelDiscoveryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const request = useRef(0)
  const inFlight = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const composing = useRef(false)
  const compositionEndedAt = useRef(0)
  const q = query.trim().toLowerCase()
  const shown = result?.models.filter((model) => !q || `${model.id} ${model.name}`.toLowerCase().includes(q)) ?? []

  useEffect(() => {
    request.current += 1
    inFlight.current = false
    setResult(null)
    setLoading(false)
    setError('')
    setExpanded(false)
    setQuery('')
    return () => { request.current += 1 }
  }, [provider, baseUrl, api, apiKey, headers, active, setExpanded])

  useEffect(() => {
    if (!expanded) return
    panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    if (result && !loading) search.current?.focus({ preventScroll: true })
  }, [expanded, result, loading])

  async function fetchModels() {
    if (disabled || !provider.trim() || inFlight.current) return
    const version = ++request.current
    inFlight.current = true
    setLoading(true)
    setExpanded(true)
    setError('')
    setQuery('')
    setResult(null)
    try {
      const next = await agentHost.syncModels({
        provider: provider.trim(),
        ...(baseUrl?.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(api ? { api } : {}),
        ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(headers !== undefined ? { headers } : {}),
      })
      // Sync persists even if this dialog has since closed or changed provider.
      await onSynced()
      if (version === request.current) setResult({ models: next.models, source: next.source })
    } catch (e) {
      if (version === request.current) setError((e as Error).message)
    } finally {
      if (version === request.current) {
        inFlight.current = false
        setLoading(false)
      }
    }
  }

  function choose(model: DiscoveredModel) {
    onSelect(model)
    setExpanded(false)
    trigger.current?.focus({ preventScroll: true })
  }

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          ref={trigger}
          id="agent-fetch-models"
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || loading || !provider.trim()}
          onClick={() => void fetchModels()}
          className="h-8 rounded-xl px-3 text-xs"
        >
          {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : result ? <RefreshCw className="size-3.5" /> : <Download className="size-3.5" />}
          {loading ? t("Fetching models…") : result ? t("Refresh models") : t("Fetch models")}
        </Button>
        {result ? (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-muted-foreground outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring">
            <span>{t(result.models.length === 1 ? '{count} model' : '{count} models', { count: result.models.length })}{result.models.length ? result.source === 'catalog' ? t(' · catalog ready') : t(' · synced') : t(' · returned')}</span>
            <ChevronDown className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-180')} />
          </button>
        ) : !loading && !error && <span className="text-[11px] text-faint">{t("Adds all models to the model selector.")}</span>}
      </div>
      {!!result?.models.length && <p role="status" className="flex items-center gap-1.5 px-0.5 text-[11px] text-success"><Check className="size-3.5 shrink-0" />{t("Ready in the main model selector. No extra save needed.")}</p>}

      {expanded && (
        <div ref={panel} aria-label={t("Available models")} className="chat-inset overflow-hidden rounded-2xl border border-foreground/[0.08]">
          {loading ? (
            <p role="status" className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin text-primary" /> {t("Fetching and syncing the model list…")}</p>
          ) : error ? (
            <div role="alert" className="space-y-2 px-3.5 py-3 text-xs leading-relaxed">
              <p className="break-words text-destructive">{t(error)}</p>
              <p className="text-muted-foreground">{t("You can retry or enter the model ID above.")}</p>
            </div>
          ) : result && (
            <>
              <div className="flex items-center gap-2 border-b border-foreground/[0.06] px-2.5 py-2">
                <div className="relative min-w-0 flex-1">
                  <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={search}
                    aria-label={t("Search available models")}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onCompositionStart={() => { composing.current = true }}
                    onCompositionEnd={() => { composing.current = false; compositionEndedAt.current = Date.now() }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.preventDefault()
                      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || Date.now() - compositionEndedAt.current < 250) return
                      if (event.key === 'Enter') {
                        if (shown[0] && !disabled) choose(shown[0])
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        panel.current?.querySelector<HTMLButtonElement>('button[data-model-id]')?.focus()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        setExpanded(false)
                        trigger.current?.focus()
                      }
                    }}
                    placeholder={t("Search by name or model ID…")}
                    className="h-8 border-transparent bg-transparent pl-8 text-xs shadow-none"
                  />
                </div>
                <button type="button" aria-label={t("Close model list")} onClick={() => { setExpanded(false); trigger.current?.focus() }} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3.5" /></button>
              </div>
              <div className="max-h-44 overflow-y-auto overscroll-contain p-1.5" onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-model-id]')]
                const index = buttons.indexOf(event.target as HTMLButtonElement)
                if (index < 0) return
                event.preventDefault()
                if (event.key === 'ArrowUp' && index === 0) search.current?.focus()
                else buttons[Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))]?.focus()
              }}>
                {shown.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    data-model-id={model.id}
                    title={model.id}
                    aria-pressed={selectedId === model.id}
                    disabled={disabled}
                    onClick={() => choose(model)}
                    className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors hover:bg-primary/[0.07] focus-visible:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50', selectedId === model.id && 'bg-primary/[0.06]')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">{model.name || model.id}</span>
                      {model.name !== model.id && <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{model.id}</span>}
                    </span>
                    {model.contextWindow !== undefined && <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(model.contextWindow)} {t("ctx")}</span>}
                    {selectedId === model.id && <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" />}
                  </button>
                ))}
                {shown.length === 0 && <p role="status" className="px-3 py-5 text-center text-xs text-muted-foreground">{result.models.length ? t("No models match your search.") : t("No models were returned. You can enter a model ID manually.")}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
