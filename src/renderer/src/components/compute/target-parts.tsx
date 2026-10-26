import { Star } from 'lucide-react'
import { type SimpleIcon, siApple, siDocker, siLinux, siModal } from 'simple-icons'

import { Chip } from '@/components/storage/chips'
import { Tile } from '@/components/storage/icons'
import { Unavailable } from '@/components/storage/unavailable'
import { Switch } from '@/components/ui/switch'
import { TARGET_LABEL, type TargetId } from '@/data/compute'
import { cn } from '@/lib/utils'

function Mark({ icon }: { icon: SimpleIcon }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="fill-current">
      <path d={icon.path} />
    </svg>
  )
}

/** simple-icons carries no Windows, AWS, E2B or Daytona marks; those get monograms. */
const MONOGRAM: Partial<Record<TargetId | 'win32', string>> = {
  e2b: 'E2B',
  daytona: 'D',
  aws: 'AWS',
  win32: 'Win',
}

/** A target's tile. Native takes the mark of the OS it runs on. */
export function TargetIcon({ id, os, size = 'md' }: { id: TargetId; os?: string; size?: 'sm' | 'md' | 'lg' }) {
  const key = id === 'native' && os === 'win32' ? 'win32' : id
  const mark =
    id === 'docker'
      ? siDocker
      : id === 'modal'
        ? siModal
        : id === 'native' && os === 'linux'
          ? siLinux
          : id === 'native' && os !== 'win32'
            ? siApple
            : undefined
  return (
    <Tile size={size}>
      {mark ? (
        <Mark icon={mark} />
      ) : (
        <span aria-hidden="true" className="font-semibold tracking-tight">
          {MONOGRAM[key]}
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

interface TargetSwitchProps {
  id: TargetId
  checked: boolean
  onChange: (on: boolean) => void
  /** Why the switch can't move right now; undefined when it can. */
  locked?: string
}

/** The on/off switch for a target, with the reason when it's locked. */
export function TargetSwitch({ id, checked, onChange, locked }: TargetSwitchProps) {
  const control = (
    <Switch
      aria-label={`Use ${TARGET_LABEL[id]}`}
      checked={checked}
      onCheckedChange={onChange}
      disabled={locked !== undefined}
    />
  )
  return locked ? <Unavailable reason={locked}>{control}</Unavailable> : control
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
