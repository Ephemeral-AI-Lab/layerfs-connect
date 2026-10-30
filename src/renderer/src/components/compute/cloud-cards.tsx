import { t, useI18n } from '@/i18n'
// Cloud Sandbox providers: shown, not usable yet. Quiet "not yet" cards in a
// grid that rises in; a mark takes its colour back on hover.
import { Clock, Database, Link2 } from 'lucide-react'

import { TargetIcon } from '@/components/compute/target-parts'
import { revealStyle, spotlight } from '@/components/motion'
import { Chip } from '@/components/storage/chips'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { CLOUD, STORAGE_FIT, TARGET_LABEL } from '@/data/compute'

import '@/components/storage/storage.css'

/** Cloud Sandbox providers: shown, not usable yet. */
export function CloudCards() {
  useI18n()
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 @min-[40rem]/workspace:grid-cols-2">
      {CLOUD.map((p, i) => (
        <section key={p.id} onPointerMove={spotlight} className="sc-soon card-hover sheen-sweep spotlight reveal flex min-w-0 flex-col gap-4 rounded-2xl p-5" style={revealStyle(i)}>
          <header className="flex items-start gap-3">
            <span className="sc-soon-mark">
              <TargetIcon id={p.id} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold text-foreground/80">{TARGET_LABEL[p.id]}</h3>
                <Chip tone="neutral" icon={Clock}>{t("Not available yet")}</Chip>
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{t(p.blurb)}</p>
            </div>
          </header>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-faint">
              <Database aria-hidden="true" className="size-3.5" />
              {t(STORAGE_FIT[p.id])}
            </span>
            <Unavailable reason={t("Cloud sandboxes require PostgreSQL cluster backend")}>
              <Button variant="outline" size="sm" className="rounded-full px-3" disabled>
                <Link2 />{t("Connect")}</Button>
            </Unavailable>
          </div>
        </section>
      ))}
    </div>
  )
}
