import { t, useI18n } from '@/i18n'
// What the Compute page's parts share: a machine kind's mark, a Sandbox's
// platform badge, a machine's state pill, a fact, a command to copy and a
// section title.
import { Check, Copy, Monitor, Server } from 'lucide-react'
import { useState } from 'react'
import { siApple, siDocker, siLinux } from 'simple-icons'

import { Chip } from '@/components/storage/chips'
import { brandColor, Mark } from '@/components/storage/icons'
import { kindLabel, type MachineTone, type Os, PLATFORM_LABEL } from '@/data/compute'
import { cn } from '@/lib/utils'
import type { SandboxPlatform } from '@shared/host-api'

/** Kinds simple-icons has no mark for: monograms in a colour of their own. */
const MONOGRAM: Record<string, { text: string; hex: string }> = {
  microsandbox: { text: 'msb', hex: '7C3AED' },
  lima: { text: 'L', hex: '2F80ED' },
  firecracker: { text: 'FC', hex: 'F05A28' },
}

/** A Sandbox platform's or machine kind's mark, sized by its parent: the brand's own, a server for SSH, this computer for native, or a monogram. */
export function PlatformMark({ id, os }: { id: SandboxPlatform | string; os?: Os }) {
  const native = id === 'native' ? (os === 'darwin' ? 'mac' : os === 'linux' ? 'linux' : 'pc') : id
  const mark = native === 'docker' ? siDocker : native === 'mac' || native === 'apple-container' ? siApple : native === 'linux' ? siLinux : undefined
  if (mark) return <Mark icon={mark} />
  if (native === 'ssh') return <Server aria-hidden="true" className="text-foreground/70" />
  if (native === 'pc') return <Monitor aria-hidden="true" className="text-foreground/70" />
  const mono = MONOGRAM[native] ?? { text: native.slice(0, 2).toUpperCase(), hex: '6B7280' }
  const brand = brandColor(mono.hex)
  return (
    <span aria-hidden="true" className={cn('text-[9px] leading-none font-bold tracking-tight', brand.className)} style={brand.style}>
      {mono.text}
    </span>
  )
}

/** A Sandbox's platform as a small badge: its mark and its name. Every row has one, Docker's too. */
export function PlatformBadge({ id, className, labelClassName }: { id: SandboxPlatform; className?: string; labelClassName?: string }) {
  useI18n()
  return (
    <span
      title={t('Platform: {platform}', { platform: t(PLATFORM_LABEL[id]) })}
      className={cn('inline-flex h-5 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-md bg-card px-1.5 text-[11px] font-medium text-foreground/85 shadow-elev-1 ring-1 ring-foreground/10 [&_svg]:size-3 [&_svg]:shrink-0', className)}
    >
      <PlatformMark id={id} />
      <span className={cn('truncate', labelClassName)}>{t(PLATFORM_LABEL[id])}</span>
    </span>
  )
}

/** A machine's kind: its mark in a small tile and its name. */
export function KindLabel({ platform, os, className, hideName }: { platform: string; os: Os; className?: string; hideName?: boolean }) {
  useI18n()
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2 text-[13px] text-foreground/85', className)}>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-card shadow-elev-1 ring-1 ring-foreground/10 [&_svg]:size-3.5">
        <PlatformMark id={platform} os={os} />
      </span>
      {!hideName && <span className="truncate">{t(kindLabel(platform))}</span>}
    </span>
  )
}

/** A machine's state as a pill. */
export function StatePill({ tone, label, className }: { tone: MachineTone; label: string; className?: string }) {
  useI18n()
  return (
    <Chip tone={tone} live={tone === 'warning'} className={className}>
      {tone !== 'neutral' && tone !== 'warning' && <span aria-hidden="true" className={cn('size-1.5 rounded-full', tone === 'success' ? 'bg-emerald-500' : 'bg-destructive')} />}
      {t(label)}
    </Chip>
  )
}

/** A label over a value. */
export function Fact({ label, children, className, mono }: { label: string; children: React.ReactNode; className?: string; mono?: boolean }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-[13px]', mono && 'font-mono text-[12.5px]')}>{children}</dd>
    </div>
  )
}

/** A section's heading, with an aside (a count, a note) after it. */
export function SectionTitle({ children, aside, id }: { children: React.ReactNode; aside?: React.ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-1">
      <h2 id={id} className="text-[13px] font-semibold tracking-tight">
        {children}
      </h2>
      {aside && <span className="text-xs text-muted-foreground tabular-nums">{aside}</span>}
    </div>
  )
}

/** A command or an address, with a button that copies it. */
export function CopyCode({ text, className }: { text: string; className?: string }) {
  useI18n()
  const [copied, setCopied] = useState(false)
  const copy = () =>
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => undefined,
    )
  return (
    <span className={cn('inline-flex max-w-full min-w-0 items-center gap-1 rounded-lg bg-muted/70 px-1.5 py-0.5 font-mono text-[12px] text-foreground ring-1 ring-foreground/8', className)}>
      <code className="min-w-0 flex-1 truncate">{text}</code>
      <button type="button" onClick={copy} aria-label={t('Copy')} title={t('Copy')} className="flex size-4.5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      </button>
    </span>
  )
}
