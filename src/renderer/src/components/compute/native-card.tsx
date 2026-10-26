import { Check, ShieldAlert, X } from 'lucide-react'

import { TargetHeader, TargetIcon, TargetSwitch } from '@/components/compute/target-parts'
import { Chip } from '@/components/storage/chips'
import { STORAGE_FIT, nativeInfo } from '@/data/compute'

interface NativeCardProps {
  platform: string
  arch: string
  enabled: boolean
  locked?: string
  onToggle: (on: boolean) => void
}

export function NativeCard({ platform, arch, enabled, locked, onToggle }: NativeCardProps) {
  const info = nativeInfo(platform)

  return (
    <section className="rounded-xl border bg-card">
      <TargetHeader
        className="px-5 pt-5"
        icon={<TargetIcon id="native" os={platform} size="lg" />}
        title={`Native · ${info.os}`}
        subtitle={`Mount on this machine and run commands without a container · ${STORAGE_FIT.native}`}
        chips={<Chip tone="neutral">Not supported yet</Chip>}
        control={<TargetSwitch id="native" checked={enabled} onChange={onToggle} locked={locked} />}
      />
      <dl className="mx-5 mt-5 grid grid-cols-3 gap-4 border-t pt-4 pb-4">
        <div>
          <dt className="text-xs text-faint">Detected</dt>
          <dd className="mt-0.5 text-sm">
            {info.os} · {arch}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Mount driver</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 text-sm">
            {info.driverFound ? (
              <Check aria-hidden="true" className="size-3.5 text-success" />
            ) : (
              <X aria-hidden="true" className="size-3.5 text-faint" />
            )}
            {info.driver}
            <span className="text-faint">{info.driverFound ? 'found' : 'not found'}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-faint">LayerFS</dt>
          <dd className="mt-0.5 text-sm text-muted-foreground">{info.reason}</dd>
        </div>
      </dl>
      <p className="flex items-start gap-2 rounded-b-xl border-t bg-warning/5 px-5 py-3 text-xs text-muted-foreground">
        <ShieldAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
        Agent commands would run as you, with your files and network, and no container in between. It stays off until
        you turn it on.
      </p>
    </section>
  )
}
