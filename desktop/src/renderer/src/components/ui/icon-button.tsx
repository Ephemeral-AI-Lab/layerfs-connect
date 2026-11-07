import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { Tip } from './tooltip'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  /** chrome: title-bar icons; header: tertiary-ink header actions; action: 24px message actions. */
  tone?: 'chrome' | 'header' | 'action'
  iconSize?: number
}

const TONES = {
  chrome: 'h-7 w-7 text-titlebar-icon hover:bg-titlebar-button-hover',
  header: 'h-7 w-7 text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]',
  action: 'h-6 w-6 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]',
}

export function IconButton({ icon: Icon, label, tone = 'chrome', iconSize, className, ...rest }: Props) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        className={cn('inline-flex shrink-0 items-center justify-center rounded-full transition-colors', TONES[tone], className)}
        {...rest}
      >
        <Icon size={iconSize ?? (tone === 'action' ? 14 : 15)} strokeWidth={tone === 'action' ? 2 : 1.8} />
      </button>
    </Tip>
  )
}
