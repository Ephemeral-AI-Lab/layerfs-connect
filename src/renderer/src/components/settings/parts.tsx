import { Eye, EyeOff } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useState, type InputHTMLAttributes, type ReactNode } from 'react'

import { useI18n } from '@/i18n'

/** The API protocols a custom provider can speak (Pi's `api`). */
export const PROTOCOLS = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Gemini' },
] as const

export const protocolLabel = (api: string) => PROTOCOLS.find((p) => p.value === api)?.label ?? api

/** A password field with a reveal toggle that shows only once something is typed. */
export function ApiKeyInput({ value, onChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const [revealed, setRevealed] = useState(false)
  const shown = revealed && value.length > 0
  return <div className="st-key">
    <input
      {...props}
      className={`st-input ${value.length > 0 ? 'st-key-filled' : ''}`}
      type={shown ? 'text' : 'password'}
      autoComplete="new-password"
      spellCheck={false}
      value={value}
      onChange={(event) => { setRevealed(false); onChange(event.target.value) }}
    />
    {value.length > 0 && <button
      type="button"
      className="st-key-toggle"
      aria-label={shown ? t('Hide secret') : t('Show secret')}
      aria-pressed={shown}
      disabled={props.disabled}
      onClick={() => setRevealed(!shown)}
    >
      {shown ? <EyeOff /> : <Eye />}
    </button>}
  </div>
}

/** Cancel on the left of the commit; Cancel holds still only while the commit runs. */
export function EditorFooter({ busy, submitDisabled, label, busyLabel, onCancel, onSubmit }: {
  busy: boolean
  submitDisabled: boolean
  label: string
  busyLabel: string
  onCancel: () => void
  onSubmit: () => void
}) {
  const { t } = useI18n()
  return <div className="st-actions">
    <button type="button" className="st-btn" disabled={busy} onClick={onCancel}>{t('Cancel')}</button>
    <button type="button" className="st-btn-primary" disabled={submitDisabled || busy} onClick={onSubmit}>{busy ? busyLabel : label}</button>
  </div>
}

/** A small modal over the Settings panel: a title, a line of text, a body and a footer. */
export function SmallModal({ open, title, description, onClose, footer, children, role }: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  footer: ReactNode
  children?: ReactNode
  role?: 'dialog' | 'alertdialog'
}) {
  return <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="st-mask st-modal-mask" />
      <DialogPrimitive.Content className="st-root st-modal" role={role}>
        <DialogPrimitive.Title className="st-modal-title">{title}</DialogPrimitive.Title>
        {description ? <DialogPrimitive.Description className="st-modal-text">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
        {children}
        <div className="st-actions">{footer}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}
