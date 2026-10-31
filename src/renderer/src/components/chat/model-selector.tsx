import { useI18n } from '@/i18n'
import { Brain, Check, ChevronDown, LoaderCircle, Settings2 } from 'lucide-react'
import type { AgentModel } from '@shared/agent-api'

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export function ModelSelector({ models, provider, modelId, thinking, thinkingOptions, disabled, busy, open, onOpenChange, onModel, onThinking, onManage }: {
  models: AgentModel[]
  provider: string | null | undefined
  modelId: string | null | undefined
  thinking: string
  thinkingOptions: string[]
  disabled?: boolean
  busy?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onModel: (provider: string, modelId: string) => void
  onThinking: (level: string) => void
  onManage: () => void
}) {
  const { t } = useI18n()
  const current = models.find((model) => model.provider === provider && model.id === modelId)
  const name = current?.name || modelId || t("Select model")
  const displayName = name === modelId ? name.split('/').at(-1) : name
  return <div className="chat-model-selectors">
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
    <DropdownMenuTrigger
      aria-label={modelId ? t("Select model: {model}", { model: name }) : t("Select model")}
      title={modelId ? t("{model} · Thinking: {level}", { model: `${provider}/${modelId}`, level: t(thinking) }) : t("Select model")}
      disabled={busy}
      className="chat-model-trigger"
    >
      {busy && <LoaderCircle className="size-3.5 shrink-0 animate-spin" />}
      <span className="min-w-0 truncate">{displayName}</span>
      <ChevronDown className="size-3 shrink-0 opacity-60" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="top" className="chat-popover w-72 p-1.5">
      <DropdownMenuLabel className="px-2.5 text-[11px]">{t("Model")} {disabled && <span className="font-normal text-faint">{t("· available after this turn")}</span>}</DropdownMenuLabel>
      <div className="max-h-60 overflow-y-auto">
        {models.length === 0 ? <p className="px-2.5 py-3 text-xs text-muted-foreground">{t("Add a provider in Manage models to get started.")}</p> : models.map((model) => {
          const selected = provider === model.provider && modelId === model.id
          return <DropdownMenuItem key={`${model.provider}/${model.id}`} disabled={disabled} onSelect={() => onModel(model.provider, model.id)} className="gap-2 rounded-lg px-2.5 py-2">
            <span className="min-w-0 flex-1"><span className={cn('block truncate text-xs', selected && 'font-medium text-foreground')}>{model.name || model.id}</span><span className="mt-0.5 block truncate font-mono text-[10px] text-faint">{model.provider}/{model.id}</span></span>
            {selected && <Check className="size-3.5 shrink-0 text-foreground" />}
          </DropdownMenuItem>
        })}
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={disabled} onSelect={onManage} aria-label={t("Manage models")} className="gap-2 rounded-lg px-2.5 py-2 text-xs"><Settings2 className="size-3.5 text-muted-foreground" /> {t("Manage models…")}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  <DropdownMenu>
    <DropdownMenuTrigger
      aria-label={t("Thinking level: {level}", { level: t(thinking) })}
      title={t("Thinking intensity")}
      disabled={!modelId || disabled || busy}
      className="chat-thinking-trigger"
    >
      <Brain className="size-3.5 opacity-75" />
      <span>{t("Thinking: {level}", { level: t(thinking) })}</span>
      <ChevronDown className="size-3 opacity-50" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="top" sideOffset={8} collisionPadding={16} className="chat-popover chat-choice-menu chat-thinking-menu">
      <DropdownMenuLabel>{t("Thinking intensity")}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={thinking} onValueChange={onThinking} aria-label={t("Thinking intensity")}>
        {thinkingOptions.map((level) => <DropdownMenuRadioItem key={level} value={level} className="capitalize"><span>{t(level)}</span></DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
  </div>
}
