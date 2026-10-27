// Native compute: what this machine would need. Not usable yet, so it reads
// as a calm "not yet" card: dashed edge, a quiet mark, no motion.
import { Check, Clock, ShieldAlert, X } from 'lucide-react'

import { TargetHeader, TargetIcon } from '@/components/compute/target-parts'
import { Chip } from '@/components/storage/chips'
import { STORAGE_FIT, nativeInfo } from '@/data/compute'

import '@/components/storage/storage.css'

/** Native compute: what this machine would need; not usable yet. */
export function NativeCard({ platform, arch }: { platform: string; arch: string }) {
  const info = nativeInfo(platform)

  return (
    <section className="sc-soon reveal overflow-hidden rounded-2xl" style={{ '--i': 1 } as React.CSSProperties}>
      <TargetHeader
        className="px-5 pt-5"
        icon={
          <span className="sc-soon-mark">
            <TargetIcon id="native" os={platform} size="lg" />
          </span>
        }
        title={`Native · ${info.os}`}
        subtitle={`Mount on this machine and run commands without a container · ${STORAGE_FIT.native}`}
        chips={
          <Chip tone="neutral" icon={Clock}>
            Not available yet
          </Chip>
        }
      />
      <dl className="mx-5 mt-5 grid grid-cols-3 gap-4 border-t border-dashed pt-4 pb-4">
        <div>
          <dt className="text-xs text-faint">Detected</dt>
          <dd className="mt-1 text-sm">
            {info.os} · {arch}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Mount driver</dt>
          <dd className="mt-1 flex items-center gap-1.5 text-sm">
            <span
              className={
                info.driverFound
                  ? 'flex size-4 items-center justify-center rounded-full bg-success/12 text-success'
                  : 'flex size-4 items-center justify-center rounded-full bg-muted text-faint'
              }
            >
              {info.driverFound ? <Check aria-hidden="true" className="size-2.5" strokeWidth={3} /> : <X aria-hidden="true" className="size-2.5" strokeWidth={3} />}
            </span>
            {info.driver}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-faint">LayerFS</dt>
          <dd className="mt-1 text-sm text-muted-foreground">{info.reason}</dd>
        </div>
      </dl>
      <p className="flex items-start gap-2 border-t border-dashed bg-warning/[0.04] px-5 py-3 text-xs text-muted-foreground">
        <ShieldAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
        Agent commands would run as you, with your files and network, and no container in between.
      </p>
    </section>
  )
}
