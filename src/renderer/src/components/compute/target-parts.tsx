import { Star } from 'lucide-react'
import { siApple, siDocker, siLinux, siModal } from 'simple-icons'

import { Chip } from '@/components/storage/chips'
import { AWS_MARK, brandColor, Mark, Tile } from '@/components/storage/icons'
import type { TargetId } from '@/data/compute'
import { cn } from '@/lib/utils'

/** simple-icons carries no Windows, E2B or Daytona marks; those get monograms in their brand colour. */
const MONOGRAM: Partial<Record<TargetId | 'win32', { text: string; hex: string }>> = {
  e2b: { text: 'E2B', hex: 'FF8800' },
  daytona: { text: 'D', hex: '000000' },
  win32: { text: 'Win', hex: '0078D4' },
}

/** A target's tile. Native takes the mark of the OS it runs on. */
export function TargetIcon({ id, os, size = 'md' }: { id: TargetId; os?: string; size?: 'sm' | 'md' | 'lg' }) {
  const key = id === 'native' && os === 'win32' ? 'win32' : id
  const mark =
    id === 'docker'
      ? siDocker
      : id === 'aws'
        ? AWS_MARK
        : id === 'modal'
          ? siModal
          : id === 'native' && os === 'linux'
            ? siLinux
            : id === 'native' && os !== 'win32'
              ? siApple
              : undefined
  const mono = MONOGRAM[key]
  const brand = mono && brandColor(mono.hex)
  return (
    <Tile size={size}>
      {mark ? (
        <Mark icon={mark} />
      ) : (
        <span aria-hidden="true" className={cn('font-semibold tracking-tight', brand?.className)} style={brand?.style}>
          {mono?.text}
        </span>
      )}
    </Tile>
  )
}

export function DefaultChip() {
  return (
    <Chip tone="info" icon={Star}>
      Default
    </Chip>
  )
}

/** The top row every target card shares. */
export function TargetHeader({
  icon,
  title,
  subtitle,
  chips,
  control,
  className,
}: {
  icon: React.ReactNode
  title: string
  subtitle: React.ReactNode
  chips?: React.ReactNode
  control?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex items-start gap-3.5', className)}>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {chips}
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>
      </div>
      {control && <div className="flex shrink-0 items-center pt-1">{control}</div>}
    </header>
  )
}
