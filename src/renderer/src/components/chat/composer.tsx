import { t, useI18n } from '@/i18n'
import { ArrowUp, Check, ChevronDown, LoaderCircle, Plus, Sparkles, Square } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import type { AgentAttachment } from '@shared/agent-api'
import { AttachmentList, readAttachments } from '@/components/chat/attachments'
import { spotlight } from '@/components/motion/spotlight'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const SEND_KEY_STORAGE = 'connect.agent.send-key'
type SendKey = 'enter' | 'modifier'

export interface ComposerCommand {
  id: string
  label: string
  description: string
  disabled?: boolean
  onSelect: () => void
  /** A command that takes an argument (`/scenario <name>`): picking it completes `/<id> `, and its choices show after the space. */
  options?: ComposerOption[]
  /** Runs `/<id> <argument>`; set together with `options`. */
  onArgument?: (argument: string) => void
}

/** One choice of a command's argument. */
export interface ComposerOption {
  id: string
  label: string
  description?: string
}

/** One row of the slash menu: a command, or a choice of a command's argument. */
interface MenuItem {
  key: string
  /** The row's mono lead: `/scenario`, or a choice's id. */
  lead: string
  label: string
  description?: string
  disabled?: boolean
  /** What Tab completes the input to. */
  complete: string
  /** What Enter or a click does: run it, or (a command taking an argument) complete it. */
  run: () => void
}

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  disabled?: boolean
  loading?: boolean
  onStop?: () => void
  controls?: ReactNode
  /** Controls on the right of the bar, before the send shortcut (the model and thinking pickers). */
  trailing?: ReactNode
  commands?: ComposerCommand[]
  sendLabel?: string
  placeholder?: string
  className?: string
  attachments?: AgentAttachment[]
  onAttachments?: (attachments: AgentAttachment[]) => void
  supportsImages?: boolean
}

export function Composer({
  value,
  onChange,
  onSend,
  disabled = false,
  loading = false,
  onStop,
  controls,
  trailing,
  commands = [],
  sendLabel = t("Send message"),
  placeholder = t("Give the agent a task…"),
  className,
  attachments = [], onAttachments, supportsImages = false,
}: ComposerProps) {
  const { t } = useI18n()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const readingRef = useRef(false)
  const [reading, setReading] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function addFiles(files: File[]) {
    if (disabled || readingRef.current || !onAttachments || !files.length) return
    readingRef.current = true; setReading(true); setAttachmentError('')
    try { const next = await readAttachments(files, attachments, supportsImages); if (mounted.current) onAttachments(next) }
    catch (e) { if (mounted.current) setAttachmentError((e as Error).message) }
    finally { readingRef.current = false; if (mounted.current) setReading(false) }
  }
  const composing = useRef(false)
  const compositionEndedAt = useRef(0)
  const commandListId = useId()
  const [focused, setFocused] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const [commandsDismissed, setCommandsDismissed] = useState(false)
  const [sendKey, setSendKey] = useState<SendKey>(() => localStorage.getItem(SEND_KEY_STORAGE) === 'modifier' ? 'modifier' : 'enter')
  const modifierLabel = window.connect.platform === 'darwin' ? '⌘' : 'Ctrl+'
  const sendShortcut = sendKey === 'enter' ? '↵' : `${modifierLabel}↵`
  const query = /^\/([^\s/]*)$/.exec(value)?.[1].toLowerCase()
  // `/<command> <argument>`: a command that takes one, and the argument typed so far
  const argument = /^\/([^\s/]+)\s+(\S*)$/.exec(value)
  const argCommand = argument ? commands.find((command) => command.onArgument && command.id.toLowerCase() === argument[1].toLowerCase()) : undefined
  const argQuery = argument?.[2].toLowerCase() ?? ''
  const matches: MenuItem[] = argCommand
    ? (argCommand.options ?? [])
        .filter((option) => option.id.toLowerCase().startsWith(argQuery) || option.label.toLowerCase().includes(argQuery))
        .map((option) => ({
          key: option.id,
          lead: option.id,
          label: option.label,
          description: option.description,
          complete: `/${argCommand.id} ${option.id}`,
          run: () => runArgument(argCommand, option.id),
        }))
    : query === undefined
      ? []
      : commands
          .filter((command) => command.id.toLowerCase().startsWith(query))
          .map((command) => ({
            key: command.id,
            lead: `/${command.id}`,
            label: command.label,
            description: command.description,
            disabled: command.disabled,
            complete: command.onArgument ? `/${command.id} ` : `/${command.id}`,
            run: command.onArgument ? () => onChange(`/${command.id} `) : () => selectCommand(command),
          }))
  const selectedIndex = Math.min(commandIndex, Math.max(0, matches.length - 1))
  const showCommands = focused && !disabled && !commandsDismissed && matches.length > 0
  const selectedItem = showCommands ? matches[selectedIndex] : undefined
  const exactCommand = query === undefined ? undefined : commands.find((command) => command.id.toLowerCase() === query)
  const exactItem: MenuItem | undefined = argCommand
    ? argQuery ? { key: argQuery, lead: argQuery, label: argCommand.label, complete: value, run: () => runArgument(argCommand, argument![2]) } : undefined
    : exactCommand && { key: exactCommand.id, lead: `/${exactCommand.id}`, label: exactCommand.label, disabled: exactCommand.disabled, complete: value, run: exactCommand.onArgument ? () => onChange(`/${exactCommand.id} `) : () => selectCommand(exactCommand) }
  const submitItem = selectedItem ?? exactItem
  const canSend = (value.trim().length > 0 || attachments.length > 0) && !disabled && !reading && !submitItem?.disabled

  useEffect(() => {
    setCommandIndex(0)
    setCommandsDismissed(false)
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(Math.min(el.scrollHeight, 180), 44)}px`
  }, [value])

  useEffect(() => {
    if (showCommands) document.getElementById(`${commandListId}-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [showCommands, commandListId, selectedIndex])

  function isComposing(event?: KeyboardEvent<HTMLTextAreaElement>) {
    // Some IMEs end composition before delivering the Enter used to confirm it.
    return composing.current || event?.nativeEvent.isComposing || event?.nativeEvent.keyCode === 229 || Date.now() - compositionEndedAt.current < 250
  }

  function selectCommand(command: ComposerCommand) {
    if (disabled || command.disabled || isComposing()) return
    onChange('')
    setCommandsDismissed(true)
    command.onSelect()
  }

  function runArgument(command: ComposerCommand, value: string) {
    if (disabled || isComposing()) return
    onChange('')
    setCommandsDismissed(true)
    command.onArgument?.(value)
  }

  function submit() {
    if (!canSend || isComposing()) return
    if (submitItem) submitItem.run()
    else onSend()
  }

  function changeSendKey(next: SendKey) {
    setSendKey(next)
    localStorage.setItem(SEND_KEY_STORAGE, next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isComposing(event)) return
    if (showCommands) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setCommandsDismissed(true)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setCommandIndex((selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
        return
      }
      if (event.key === 'Tab' && !event.shiftKey && selectedItem && value !== selectedItem.complete) {
        event.preventDefault()
        onChange(selectedItem.complete)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        submit()
        return
      }
    }
    if (event.key === 'Escape' && loading && onStop && !disabled) {
      event.preventDefault()
      onStop()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && (sendKey === 'enter' || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className={cn('relative mx-auto w-full max-w-3xl', className)} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles([...event.dataTransfer.files]) } }}>
      {showCommands && (
        <div className="chat-popover glass-strong absolute right-0 bottom-full left-0 z-30 mb-2 overflow-hidden rounded-2xl border border-foreground/[0.08] p-1.5 shadow-lg">
          <div id={commandListId} role="listbox" aria-label={t("Chat commands")} className="max-h-60 overflow-y-auto">
            {matches.map((command, index) => (
              <button
                key={command.key}
                id={`${commandListId}-${index}`}
                type="button"
                role="option"
                aria-selected={selectedIndex === index}
                aria-disabled={command.disabled}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setCommandIndex(index)}
                onClick={() => { if (!command.disabled) command.run() }}
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors', selectedIndex === index && 'bg-foreground/[0.06]', command.disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-foreground/[0.06]')}
              >
                <span className="min-w-20 font-mono text-xs text-foreground">{command.lead}</span>
                <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-foreground">{command.label}</span>{command.description && <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-muted-foreground">{command.description}</span>}</span>
                {command.disabled && <span className="shrink-0 text-[10px] text-muted-foreground">{t("Unavailable")}</span>}
              </button>
            ))}
          </div>
          <p className="border-t border-foreground/[0.05] px-3 pt-1.5 pb-0.5 text-[10px] text-faint">{t("↑↓ choose · Tab complete · Enter run · Esc dismiss")}</p>
        </div>
      )}
      <div
        onPointerMove={spotlight}
        className="glass-liquid spotlight relative flex flex-col gap-1.5 rounded-3xl p-2.5 transition-all duration-(--dur-base) focus-within:border-primary/25 focus-within:shadow-[0_14px_36px_-10px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,1)] dark:focus-within:border-primary/35 dark:focus-within:shadow-[0_16px_36px_-12px_rgba(0,0,0,0.7)]"
      >
        {onAttachments && <input ref={picker} type="file" multiple className="hidden" tabIndex={-1} accept="text/*,application/json,application/javascript,application/typescript,application/xml,application/yaml,application/x-yaml,image/png,image/jpeg,image/webp,image/gif,.md,.ts,.tsx,.jsx,.py,.sh,.toml,.log" aria-label={t("Attach files")} onChange={(event) => { void addFiles([...event.target.files ?? []]); event.target.value = '' }} />}
        {!!attachments.length && <div className="px-2 pt-1"><AttachmentList attachments={attachments} disabled={disabled || reading} onRemove={(id) => onAttachments?.(attachments.filter((attachment) => attachment.id !== id))} /></div>}
        {attachmentError && <p role="alert" className="px-3 pt-1 text-xs text-destructive">{t(attachmentError)}</p>}
        <textarea
          ref={textareaRef}
          data-chat-composer
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => { if (event.clipboardData.files.length) { event.preventDefault(); void addFiles([...event.clipboardData.files]) } }}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false; compositionEndedAt.current = Date.now() }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={t("Message")}
          aria-autocomplete={commands.length ? 'list' : undefined}
          aria-controls={showCommands ? commandListId : undefined}
          aria-activedescendant={showCommands ? `${commandListId}-${selectedIndex}` : undefined}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          className="w-full resize-none bg-transparent px-3 py-1.5 text-[14.5px] leading-relaxed text-foreground placeholder:text-faint outline-none scrollbar-none"
        />

        <div className="flex items-center justify-between gap-2 px-2 pt-0.5 pb-0.5 text-xs text-faint">
          <div className="flex min-w-0 items-center gap-1">
          {onAttachments && <button type="button" aria-label={t("Add attachments")} title={t("Attach text files or images")} disabled={disabled || reading} onClick={() => picker.current?.click()} className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{reading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-4" />}</button>}
          {controls ?? (
            <span className="flex items-center gap-1.5 text-muted-foreground/80">
              <Sparkles className="size-3.5 text-primary" />
              <span>{t("Shift+↵ for new line")}</span>
            </span>
          )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {trailing}
            <DropdownMenu>
              <DropdownMenuTrigger aria-label={t("Send shortcut")} title={t("Send with {shortcut}", { shortcut: sendShortcut })} className="flex items-center gap-0.5 rounded-md px-1 py-1 text-[10px] text-muted-foreground outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring">
                <span>{sendShortcut}</span><ChevronDown className="size-2.5 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="chat-popover w-52 p-1" onCloseAutoFocus={(event) => { event.preventDefault(); textareaRef.current?.focus() }}>
                <DropdownMenuLabel className="text-[11px]">{t("Send shortcut")}</DropdownMenuLabel>
                {(['enter', 'modifier'] as const).map((key) => (
                  <DropdownMenuItem key={key} onSelect={() => changeSendKey(key)} className="justify-between text-xs">
                    <span>{key === 'enter' ? t("Enter to send") : t("{shortcut}Enter to send", { shortcut: modifierLabel })}</span>
                    {sendKey === key && <Check className="size-3" />}
                  </DropdownMenuItem>
                ))}
                <p className="px-2 py-1.5 text-[10px] text-faint">{t("Shift+Enter always adds a new line.")}</p>
              </DropdownMenuContent>
            </DropdownMenu>
            {loading && onStop && (
              <button
                type="button"
                onClick={() => { if (!disabled && !isComposing()) onStop() }}
                disabled={disabled}
                title={t("Stop agent (Esc)")}
                aria-label={t("Stop agent")}
                className="flex size-8 items-center justify-center rounded-full bg-foreground/90 text-background shadow-xs transition-transform hover:bg-foreground hover:scale-105 active:scale-95"
              >
                <Square className="size-3 fill-current" />
              </button>
            )}
            <button
              type="button"
              disabled={!canSend}
              onMouseDown={(event) => event.preventDefault()}
              onClick={submit}
              title={submitItem ? t("{status}: {command}", { status: submitItem.disabled ? t("Unavailable") : t("Run"), command: submitItem.lead }) : `${sendLabel} (${sendShortcut})`}
              aria-label={submitItem ? t("Run {command}", { command: submitItem.label }) : sendLabel}
              className={cn(
                'flex size-8 items-center justify-center rounded-full transition-all duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-ring',
                canSend
                  ? 'btn-primary bg-primary text-primary-foreground shadow-sm hover:scale-105 active:scale-95'
                  : 'bg-foreground/[0.06] text-faint/60 cursor-not-allowed',
              )}
            >
              <ArrowUp className="size-4 stroke-[2.25]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
