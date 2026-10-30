import { t, useI18n } from '@/i18n'
// Native compute: what this machine would need. Not usable yet, so it reads
// as a calm "not yet" card: dashed edge, a quiet mark, no motion.
import { Check, Clock, ShieldAlert, X } from 'lucide-react'

import { TargetHeader, TargetIcon } from '@/components/compute/target-parts'
import { spotlight } from '@/components/motion'
import { Chip } from '@/components/storage/chips'
import { nativeInfo } from '@/data/compute'

import '@/components/storage/storage.css'

/** Native compute: what this machine would need; not usable yet. */
export function NativeCard({ platform, arch }: { platform: string; arch: string }) {
  useI18n()
  const info = nativeInfo(platform)

  return (
    <section onPointerMove={spotlight} className="@container/native-card sc-soon card-hover sheen-sweep spotlight reveal min-w-0 overflow-hidden rounded-2xl" style={{ '--i': 1 } as React.CSSProperties}>
      <TargetHeader
        className="px-5 pt-5"
        icon={
          <span className="sc-soon-mark">
            <TargetIcon id="native" os={platform} size="lg" />
          </span>
        }
        title={t("Native · {value1}", {value1: info.os})}
        subtitle={t("Host loopback mount · Local SQLite")}
        chips={
          <Chip tone="neutral" icon={Clock}>{t("Not available yet")}</Chip>
        }
      />
      <dl className="mx-5 mt-5 grid grid-cols-1 gap-4 border-t border-dashed pt-4 pb-4 @min-[34rem]/native-card:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-faint">{t("Detected")}</dt>
          <dd className="mt-1 text-sm">
            {info.os} · {arch}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-faint">{t("Mount driver")}</dt>
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
            {t(info.driver)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-faint">{t("LayerFS")}</dt>
          <dd className="mt-1 text-sm text-muted-foreground">{t(info.reason)}</dd>
        </div>
      </dl>
      <p className="flex items-start gap-2 border-t border-dashed bg-warning/[0.04] px-5 py-3 text-xs text-muted-foreground">
        <ShieldAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />{t("Runs directly in host user space without container isolation.")}</p>
    </section>
  )
}
